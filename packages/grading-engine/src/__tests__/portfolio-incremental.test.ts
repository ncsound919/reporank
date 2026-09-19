import { describe, it, expect } from "vitest";
import { planIncrementalScan } from "../portfolio/incremental";

const ALL_FILES = ["src/a.ts", "src/b.ts", "src/c.ts"];

describe("planIncrementalScan", () => {
  it("reports a full scan when changedSince is not requested", () => {
    const plan = planIncrementalScan({ allFiles: ALL_FILES });
    expect(plan.mode).toBe("full");
    expect(plan.incremental.changedFiles).toEqual(ALL_FILES);
    expect(plan.incremental.reused).toEqual([]);
  });

  it("re-analyzes only git-changed files and reuses the rest", () => {
    const plan = planIncrementalScan({
      cursor: { lastCommit: "old", lastScannedAt: "t1" },
      git: { commit: "new", changed: ["src/b.ts"] },
      allFiles: ALL_FILES,
      changedSince: "old",
    });

    expect(plan.mode).toBe("changed");
    expect(plan.changedSince).toBe("old");
    expect(plan.incremental.changedFiles).toEqual(["src/b.ts"]);
    expect(plan.incremental.reused).toEqual(["src/a.ts", "src/c.ts"]);
    expect(plan.incremental.cursor).toEqual({ lastCommit: "new", lastScannedAt: "t1" });
  });

  it("ignores git-changed paths that are not source files we track", () => {
    const plan = planIncrementalScan({
      cursor: { lastCommit: "old", lastScannedAt: "t1" },
      git: { commit: "new", changed: ["README.md", "src/a.ts"] },
      allFiles: ALL_FILES,
      changedSince: "old",
    });
    expect(plan.incremental.changedFiles).toEqual(["src/a.ts"]);
    expect(plan.incremental.reused).toEqual(["src/b.ts", "src/c.ts"]);
  });

  it("falls back to a full scan when git data is unavailable", () => {
    const plan = planIncrementalScan({
      cursor: { lastCommit: "old", lastScannedAt: "t1" },
      git: null,
      allFiles: ALL_FILES,
      changedSince: "old",
    });
    expect(plan.mode).toBe("full");
    expect(plan.incremental.changedFiles).toEqual(ALL_FILES);
    expect(plan.incremental.reused).toEqual([]);
    expect(plan.incremental.cursor.lastCommit).toBe("old");
  });

  it("normalizes separators and dedupes file paths", () => {
    const plan = planIncrementalScan({
      allFiles: ["src\\a.ts", "./src/b.ts", "src/a.ts"],
      git: null,
    });
    expect(plan.incremental.changedFiles).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("forceFull overrides a requested changedSince", () => {
    const plan = planIncrementalScan({
      cursor: { lastCommit: "old", lastScannedAt: "t1" },
      git: { commit: "new", changed: ["src/b.ts"] },
      allFiles: ALL_FILES,
      changedSince: "old",
      forceFull: true,
    });
    expect(plan.mode).toBe("full");
    expect(plan.changedSince).toBeNull();
    expect(plan.incremental.cursor.lastCommit).toBe("new");
    expect(plan.incremental.changedFiles).toEqual(ALL_FILES);
  });

  it("reports an empty delta when nothing changed since the cursor", () => {
    const plan = planIncrementalScan({
      cursor: { lastCommit: "same", lastScannedAt: "t1" },
      git: { commit: "same", changed: [] },
      allFiles: ALL_FILES,
      changedSince: "same",
    });
    expect(plan.mode).toBe("changed");
    expect(plan.incremental.changedFiles).toEqual([]);
    expect(plan.incremental.reused).toEqual(ALL_FILES);
  });
});
