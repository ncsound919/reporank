/**
 * file-cache.ts — per-file analysis cache for incremental scans.
 *
 * The cache stores the *file-local* analyzer output for each source file, keyed
 * by a SHA-256 of its normalized text (line endings collapsed to `\n`). Only
 * analyzers whose result for one file is independent of every other file are
 * cached here — currently `analyzeComplexity` hot spots and `scanCodeHygiene`
 * findings. Cross-file graph findings (import cycles, coupling, layering,
 * dead-code, architecture, dependencies, enterprise) are always recomputed from
 * the full source set, so reusing this cache can never change the resulting
 * index.
 *
 * Reads/writes are best-effort: a missing, malformed, or wrong-version file is
 * treated as an empty cache, and a failed write never crashes a scan.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CodeHygieneFinding } from "../analyzers/code-hygiene";
import type { FileHotSpot } from "../analyzers/complexity";
import { loadRepoConfig, type RepoRankConfig } from "./config";

export const FILE_CACHE_VERSION = 1;
export const FILE_CACHE_FILENAME = "cache.json";

export interface FileCacheEntry {
  /** sha256 of the normalized file text. */
  hash: string;
  /** Source lines, for cohort normalization when the repo is replayed partially. */
  loc: number;
  /** `analyzeComplexity([file]).hotSpots` — a pure function of this file. */
  hotSpots: FileHotSpot[];
  /** `scanCodeHygiene([file]).findings` — a pure function of this file. */
  hygiene: CodeHygieneFinding[];
  /** ISO-8601 timestamp of the last time this entry was (re)computed. */
  updatedAt: string;
}

export interface FileCacheStore {
  version: number;
  repo: string;
  algo: "sha256";
  entries: Record<string, FileCacheEntry>;
}

export interface FileCacheLocationOptions {
  /** Explicit store file. Wins over every other source. */
  storePath?: string;
  /** Directory that contains `cache.json`. */
  cacheDir?: string;
  /** Environment override (testable without mutating process.env). */
  env?: Record<string, string | undefined>;
  /** Pre-loaded config (avoids re-reading the file). */
  config?: RepoRankConfig;
}

/** Hash normalized file text so CRLF/LF checkouts share a cache entry. */
export function hashFileContent(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return createHash("sha256").update(normalized, "utf-8").digest("hex");
}

/** Resolve the cache path from explicit options, env, config, or the default. */
export function resolveFileCachePath(repoRoot: string, options: FileCacheLocationOptions = {}): string {
  if (options.storePath) return resolve(options.storePath);
  if (options.cacheDir) return join(options.cacheDir, FILE_CACHE_FILENAME);
  const env = options.env ?? process.env;
  if (env.REPORANK_CACHE_FILE) return resolve(env.REPORANK_CACHE_FILE);
  if (env.REPORANK_CACHE_DIR) return join(env.REPORANK_CACHE_DIR, FILE_CACHE_FILENAME);
  const config = options.config ?? loadRepoConfig(repoRoot);
  if (config.cache?.dir) return join(resolve(repoRoot, config.cache.dir), FILE_CACHE_FILENAME);
  return join(repoRoot, ".reporank", FILE_CACHE_FILENAME);
}

export function createEmptyFileCache(repoRoot: string): FileCacheStore {
  return { version: FILE_CACHE_VERSION, repo: repoRoot, algo: "sha256", entries: {} };
}

function isEntry(value: unknown): value is FileCacheEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<FileCacheEntry>;
  return (
    typeof entry.hash === "string" &&
    Array.isArray(entry.hotSpots) &&
    Array.isArray(entry.hygiene)
  );
}

/** Load the cache, degrading to an empty store on a missing/corrupt file. */
export function loadFileCache(repoRoot: string, options: FileCacheLocationOptions = {}): FileCacheStore {
  const path = resolveFileCachePath(repoRoot, options);
  const empty = createEmptyFileCache(repoRoot);
  if (!existsSync(path)) return empty;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<FileCacheStore> | null;
    if (!parsed || typeof parsed !== "object" || parsed.version !== FILE_CACHE_VERSION) return empty;
    if (!parsed.entries || typeof parsed.entries !== "object") return empty;
    const entries: Record<string, FileCacheEntry> = {};
    for (const [file, value] of Object.entries(parsed.entries)) {
      if (isEntry(value)) entries[file] = value;
    }
    return { version: FILE_CACHE_VERSION, repo: repoRoot, algo: "sha256", entries };
  } catch {
    return empty;
  }
}

/** Persist the cache. Best-effort creation of the parent directory. */
export function saveFileCache(
  repoRoot: string,
  store: FileCacheStore,
  options: FileCacheLocationOptions = {},
): string {
  const path = resolveFileCachePath(repoRoot, options);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  } catch {
    // Best-effort: a failed cache write must never fail a scan.
  }
  return path;
}
