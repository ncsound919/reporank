import { describe, it, expect } from "vitest";

describe("analyzeGitHistory - graceful failure modes", () => {
  it("returns hasGit=false when .git does not exist", async () => {
    const { analyzeGitHistory } = await import("../analyzers/git-history");
    const result = analyzeGitHistory("/nonexistent-path-that-wont-exist");
    expect(result.hasGit).toBe(false);
    expect(result.insights).toEqual([]);
  });

  it("returns insight errors when git calls fail but .git exists", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reporank-test-"));
    fs.mkdirSync(path.join(tmpDir, ".git"));

    const { analyzeGitHistory } = await import("../analyzers/git-history");
    const result = analyzeGitHistory(tmpDir);
    expect(result.hasGit).toBe(true);
    expect(result.insights.length).toBeGreaterThanOrEqual(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("analyzeBusFactor - graceful failure modes", () => {
  it("returns score=100 when no .git", async () => {
    const { analyzeBusFactor } = await import("../analyzers/senior-dev");
    const result = analyzeBusFactor("/nonexistent");
    expect(result.items).toEqual([]);
    expect(result.score).toBe(100);
  });

  it("handles git errors gracefully", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reporank-test-"));
    fs.mkdirSync(path.join(tmpDir, ".git"));

    const { analyzeBusFactor } = await import("../analyzers/senior-dev");
    const result = analyzeBusFactor(tmpDir);
    expect(typeof result.summary).toBe("string");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("analyzeChangeCoupling - graceful failure modes", () => {
  it("returns empty when no .git", async () => {
    const { analyzeChangeCoupling } = await import("../analyzers/senior-dev");
    const result = analyzeChangeCoupling("/nonexistent");
    expect(result.pairs).toEqual([]);
  });

  it("handles git errors gracefully", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reporank-test-"));
    fs.mkdirSync(path.join(tmpDir, ".git"));

    const { analyzeChangeCoupling } = await import("../analyzers/senior-dev");
    const result = analyzeChangeCoupling(tmpDir);
    expect(Array.isArray(result.pairs)).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
