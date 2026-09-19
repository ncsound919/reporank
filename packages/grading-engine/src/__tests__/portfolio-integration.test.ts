/**
 * End-to-end portfolio test over real temp directories.
 *
 * Unlike the other portfolio tests (which inject synthetic indices), this one
 * exercises the actual loader -> runDeepAnalysis -> structural index path so
 * the CLI wiring is covered without Postgres/Redis/network.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { analyzePortfolio, scanRepoHistory } from "../portfolio/portfolio";
import { buildCrossRepoReport } from "../portfolio/cross-repo";
import { loadRepo } from "../portfolio/loader";

const DUPLICATED = `export function reconcile(ledger, entries) {
  const totals = new Map();
  for (const entry of entries) {
    const current = totals.get(entry.account) || 0;
    const delta = entry.credit - entry.debit;
    totals.set(entry.account, current + delta);
  }
  return [...totals.values()];
}
`;

let root: string;

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "reporank-portfolio-"));
  write(join(root, "repo-a", "package.json"), JSON.stringify({ name: "repo-a", version: "1.0.0" }));
  write(join(root, "repo-a", "src", "index.ts"), 'import { helper } from "shared-lib";\nexport const x = helper();\n');
  write(join(root, "repo-a", "src", "dup-copy.ts"), DUPLICATED);

  write(join(root, "repo-b", "package.json"), JSON.stringify({ name: "shared-lib", version: "1.0.0" }));
  write(join(root, "repo-b", "src", "index.ts"), "export function helper() {\n  return 42;\n}\n");
  write(join(root, "repo-b", "src", "dup.ts"), DUPLICATED);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("portfolio integration over temp repos", () => {
  it("loads, indexes, and ranks discovered repos deterministically", () => {
    const first = analyzePortfolio([root], { minCohortSize: 1 });
    const second = analyzePortfolio([root], { minCohortSize: 1 });

    expect(first.entries).toHaveLength(2);
    for (const entry of first.entries) {
      expect(entry.index).toBeGreaterThanOrEqual(0);
      expect(entry.index).toBeLessThanOrEqual(100);
      expect(entry.benchmark).not.toBeNull();
    }
    expect(first.entries.map((e) => e.repo)).toEqual(second.entries.map((e) => e.repo));
    expect(first.entries.map((e) => e.score)).toEqual(second.entries.map((e) => e.score));
  });

  it("detects the cross-repo edge and duplicate from loaded source files", () => {
    const inputs = ["repo-a", "repo-b"].map((dir) => {
      const loaded = loadRepo(join(root, dir));
      return { name: loaded.name, packageName: loaded.packageName, sourceFiles: loaded.sourceFiles };
    });
    const report = buildCrossRepoReport(inputs, { minSharedShingles: 3, minSimilarity: 0.9 });

    expect(report.edges).toContainEqual(
      expect.objectContaining({ from: "repo-a", to: "shared-lib", specifier: "shared-lib" }),
    );
    expect(report.duplicates).toHaveLength(1);
    expect(report.duplicates[0]).toMatchObject({
      a: { repo: "repo-a", file: "src/dup-copy.ts" },
      b: { repo: "shared-lib", file: "src/dup.ts" },
      similarity: 1,
    });
  });

  it("persists history and reports an incremental cursor on a second scan", () => {
    const first = scanRepoHistory(join(root, "repo-a"), { forceFull: true, git: { commit: "c1", changed: [] } });
    expect(existsSync(first.historyPath)).toBe(true);
    expect(first.incremental.changedFiles).toContain("src/index.ts");
    expect(first.incremental.cursor.lastCommit).toBe("c1");

    const second = scanRepoHistory(join(root, "repo-a"), {
      changedSince: "c1",
      git: { commit: "c2", changed: ["src/index.ts"] },
    });
    expect(second.incremental.changedFiles).toEqual(["src/index.ts"]);
    expect(second.incremental.reusedFiles).toBe(1);
    expect(second.incremental.cacheHitRate).toBe(0.5);
    expect(second.incremental.reusedFindings).toBeGreaterThanOrEqual(0);
    expect(second.incremental.cursor.lastCommit).toBe("c2");
    expect(second.index).toBe(first.index);
    expect(second.alerts).toEqual([]);
  });
});
