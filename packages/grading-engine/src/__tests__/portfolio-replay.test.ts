/**
 * Per-file incremental replay: equivalence with a full scan, cache hits and
 * invalidation, and corrupt-cache recovery. Uses real temp repos so the loader,
 * analyzers, cache, and history are all exercised together.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  createEmptyFileCache,
  hashFileContent,
  loadFileCache,
  resolveFileCachePath,
} from "../portfolio/file-cache";
import { analyzeLoadedRepo, loadRepo } from "../portfolio/loader";
import { scanRepoHistory } from "../portfolio/portfolio";
import { replayRepoAnalysis } from "../portfolio/replay";

let root: string;

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

const FILE_A = "export const a = 1;\nexport function alpha() {\n  return a;\n}\n";
const FILE_B = 'export function beta() {\n  process.stdout.write("beta");\n  return 2;\n}\n';
const FILE_C = "export function gamma() {\n  debugger;\n  return 3;\n}\n";

function seedRepo(): void {
  write(join(root, "package.json"), JSON.stringify({ name: "replay-repo", version: "1.0.0" }));
  write(join(root, "src", "a.ts"), FILE_A);
  write(join(root, "src", "b.ts"), FILE_B);
  write(join(root, "src", "c.ts"), FILE_C);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "reporank-replay-"));
  seedRepo();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("hashFileContent", () => {
  it("treats CRLF and LF as the same content", () => {
    expect(hashFileContent("a\nb\n")).toBe(hashFileContent("a\r\nb\r\n"));
    expect(hashFileContent("a\n")).not.toBe(hashFileContent("b\n"));
  });
});

describe("loadFileCache", () => {
  it("returns an empty cache for a corrupt file", () => {
    write(join(root, ".reporank", "cache.json"), "{ not valid json");
    const cache = loadFileCache(root);
    expect(cache.entries).toEqual({});
    expect(cache.version).toBe(1);
  });

  it("ignores a mismatched cache version", () => {
    write(join(root, ".reporank", "cache.json"), JSON.stringify({ version: 999, entries: { "a.ts": {} } }));
    expect(loadFileCache(root).entries).toEqual({});
  });

  it("resolves the default path under .reporank", () => {
    expect(resolveFileCachePath(root)).toBe(join(root, ".reporank", "cache.json"));
  });

  it("returns an empty cache when no file exists", () => {
    expect(loadFileCache(root).entries).toEqual(createEmptyFileCache(root).entries);
  });
});

describe("replayRepoAnalysis", () => {
  it("matches the established full-analysis index exactly", () => {
    const loaded = loadRepo(root);
    const full = replayRepoAnalysis({
      root,
      mainLanguage: loaded.mainLanguage,
      totalLoc: loaded.totalLoc,
      fileTree: loaded.fileTree,
      sourceFiles: loaded.sourceFiles,
      packageJson: loaded.packageJson,
      cache: createEmptyFileCache(root),
      cursor: null,
      git: null,
      changedSince: null,
      forceFull: true,
      now: "2026-01-01T00:00:00.000Z",
    });

    expect(full.index).toEqual(analyzeLoadedRepo(loaded).index);
  });

  it("produces an index deep-equal to a full analysis while reusing cached files", () => {
    const loaded = loadRepo(root);
    const common = {
      root,
      mainLanguage: loaded.mainLanguage,
      totalLoc: loaded.totalLoc,
      fileTree: loaded.fileTree,
      sourceFiles: loaded.sourceFiles,
      packageJson: loaded.packageJson,
    };
    const full = replayRepoAnalysis({
      ...common,
      cache: createEmptyFileCache(root),
      cursor: null,
      git: { commit: "c1", changed: [] },
      changedSince: null,
      forceFull: true,
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(full.incremental.changedFiles).toHaveLength(3);

    const incremental = replayRepoAnalysis({
      ...common,
      cache: full.cache,
      cursor: { lastCommit: "c1", lastScannedAt: "2026-01-01T00:00:00.000Z" },
      git: { commit: "c2", changed: ["src/a.ts"] },
      changedSince: "c1",
      now: "2026-01-02T00:00:00.000Z",
    });

    expect(incremental.index).toEqual(full.index);
    expect(incremental.incremental.changedFiles).toEqual(["src/a.ts"]);
    expect(incremental.incremental.reusedFiles).toBe(2);
    expect(incremental.incremental.reusedFindings).toBe(2);
    expect(incremental.incremental.cacheHitRate).toBe(0.667);
  });
});

describe("scanRepoHistory incremental cache", () => {
  it("matches a full scan while reusing cached files", () => {
    const full = scanRepoHistory(root, {
      forceFull: true,
      git: { commit: "c1", changed: [] },
      now: "2026-01-01T00:00:00.000Z",
    });

    const incremental = scanRepoHistory(root, {
      changedSince: "c1",
      git: { commit: "c2", changed: ["src/a.ts"] },
      now: "2026-01-02T00:00:00.000Z",
    });

    expect(incremental.index).toBe(full.index);
    expect(incremental.snapshot.dimensions).toEqual(full.snapshot.dimensions);
    expect(incremental.incremental.changedFiles).toEqual(["src/a.ts"]);
    expect(incremental.incremental.reusedFiles).toBe(2);
    expect(incremental.incremental.cacheHitRate).toBe(0.667);
    expect(incremental.incremental.reusedFindings).toBe(2);
    expect(incremental.incremental.cursor).toEqual({
      lastCommit: "c2",
      lastScannedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("reuses every file when nothing changed", () => {
    scanRepoHistory(root, { forceFull: true, git: { commit: "c1", changed: [] } });
    const again = scanRepoHistory(root, {
      changedSince: "c1",
      git: { commit: "c1", changed: [] },
    });
    expect(again.incremental.changedFiles).toEqual([]);
    expect(again.incremental.reusedFiles).toBe(3);
    expect(again.incremental.cacheHitRate).toBe(1);
  });

  it("invalidates only the changed file's entry", () => {
    const first = scanRepoHistory(root, { forceFull: true, git: { commit: "c1", changed: [] } });
    const cachePath = resolveFileCachePath(root);
    const before = JSON.parse(readFileSync(cachePath, "utf-8"));
    const hashA = before.entries["src/a.ts"].hash as string;

    write(join(root, "src", "b.ts"), `${FILE_B}export function betaTwo() {\n  debugger;\n  return 4;\n}\n`);

    const second = scanRepoHistory(root, {
      changedSince: "c1",
      git: { commit: "c2", changed: ["src/b.ts"] },
    });
    expect(second.incremental.changedFiles).toEqual(["src/b.ts"]);
    expect(second.incremental.reusedFiles).toBe(2);

    const after = JSON.parse(readFileSync(cachePath, "utf-8"));
    expect(after.entries["src/a.ts"].hash).toBe(hashA);
    expect(after.entries["src/b.ts"].hash).not.toBe(before.entries["src/b.ts"].hash);

    const fullAfterChange = scanRepoHistory(root, {
      forceFull: true,
      git: { commit: "c2", changed: [] },
      now: "2026-01-03T00:00:00.000Z",
    });
    expect(second.index).toBe(fullAfterChange.index);
    expect(second.snapshot.dimensions).toEqual(fullAfterChange.snapshot.dimensions);
  });

  it("recovers from a corrupt cache by treating every file as a miss", () => {
    scanRepoHistory(root, { forceFull: true, git: { commit: "c1", changed: [] } });
    write(join(root, ".reporank", "cache.json"), "%%% not json %%%");

    const recovered = scanRepoHistory(root, {
      changedSince: "c1",
      git: { commit: "c2", changed: [] },
    });
    expect(recovered.incremental.changedFiles).toHaveLength(3);
    expect(recovered.incremental.reusedFiles).toBe(0);
    expect(recovered.incremental.cacheHitRate).toBe(0);

    const next = scanRepoHistory(root, {
      changedSince: "c2",
      git: { commit: "c3", changed: [] },
    });
    expect(next.incremental.reusedFiles).toBe(3);
  });

  it("drops entries for files removed from the tree", () => {
    scanRepoHistory(root, { forceFull: true, git: { commit: "c1", changed: [] } });
    unlinkSync(join(root, "src", "c.ts"));

    scanRepoHistory(root, {
      changedSince: "c1",
      git: { commit: "c2", changed: [] },
    });
    const cache = loadFileCache(root);
    expect(Object.keys(cache.entries).sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });
});
