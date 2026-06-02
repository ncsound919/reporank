import { describe, it, expect } from "vitest";
import {
  predictImpact,
  calculateSoftware20Score,
  type FileChange,
} from "../analyzers/impact";

describe("predictImpact", () => {
  it("returns empty impact for no changes", () => {
    const report = predictImpact(80, []);
    expect(report.currentScore).toBe(80);
    expect(report.predictedScore).toBe(80);
    expect(report.totalDelta).toBe(0);
    expect(report.perFile).toHaveLength(0);
  });

  it("gives positive score for file removal", () => {
    const changes: FileChange[] = [{
      path: "src/old.ts", kind: "removed", linesRemoved: 200,
    }];
    const report = predictImpact(75, changes);
    expect(report.predictedScore).toBeGreaterThanOrEqual(75);
    expect(report.perFile[0].scoreDelta).toBeGreaterThan(0);
  });

  it("penalizes added code with AI patterns (deep nesting)", () => {
    const nestedContent = `
function process() {
  if (a) {
    if (b) {
      if (c) {
        if (d) {
          if (e) {
            if (f) {
              if (g) {
                if (h) {
                  doStuff();
                }
              }
            }
          }
        }
      }
    }
  }
}`;
    const changes: FileChange[] = [{
      path: "src/spaghetti.ts", kind: "added", content: nestedContent,
    }];
    const report = predictImpact(80, changes);
    const fileImpact = report.perFile[0];
    expect(fileImpact.scoreDelta).toBeLessThan(0);
    expect(fileImpact.reasons.some(r => r.includes("spaghetti"))).toBe(true);
  });

  it("rewards test file additions", () => {
    const testContent = `describe("foo", () => { it("works", () => { expect(1).toBe(1); }); });`;
    const changes: FileChange[] = [{
      path: "src/foo.test.ts", kind: "added", content: testContent,
    }];
    const report = predictImpact(70, changes);
    const fileImpact = report.perFile[0];
    expect(fileImpact.scoreDelta).toBeGreaterThan(0);
    expect(fileImpact.reasons.some(r => r.toLowerCase().includes("test"))).toBe(true);
  });

  it("penalizes async code without error handling", () => {
    const unsafeAsync = `async function loadData() { const x = await fetch("/api"); return x.json(); }`;
    const changes: FileChange[] = [{
      path: "src/load.ts", kind: "added", content: unsafeAsync,
    }];
    const report = predictImpact(80, changes);
    const fileImpact = report.perFile[0];
    expect(fileImpact.scoreDelta).toBeLessThan(0);
    expect(fileImpact.reasons.some(r => r.toLowerCase().includes("async"))).toBe(true);
  });

  it("clamps predicted score between 0 and 100", () => {
    const nestedContent = "function x() { if (a) { if (b) { if (c) { if (d) { if (e) { if (f) { if (g) { if (h) { doStuff(); } } } } } } } } }";
    const changes: FileChange[] = Array.from({ length: 30 }, (_, i) => ({
      path: `src/file${i}.ts`, kind: "added" as const, content: nestedContent + "\n" + nestedContent,
    }));
    const report = predictImpact(20, changes);
    expect(report.predictedScore).toBeGreaterThanOrEqual(0);
    expect(report.predictedScore).toBeLessThanOrEqual(100);
  });

  it("produces topWins and topRisks correctly", () => {
    const changes: FileChange[] = [
      { path: "src/dead.ts", kind: "removed", linesRemoved: 300 },
      { path: "src/bad.ts", kind: "added", content: "function x() { if (a) { if (b) { if (c) { if (d) { if (e) { if (f) { if (g) { if (h) { if (i) { bad(); } } } } } } } } } }" },
    ];
    const report = predictImpact(70, changes);
    expect(report.topWins.length + report.topRisks.length).toBeGreaterThan(0);
  });

  it("attaches confidence based on change volume", () => {
    const tiny: FileChange[] = [{ path: "a.ts", kind: "modified", content: "x" }];
    expect(predictImpact(80, tiny).confidence).toBe("high");

    const large: FileChange[] = Array.from({ length: 5 }, (_, i) => ({
      path: `f${i}.ts`, kind: "modified" as const, content: "x\n".repeat(100), linesAdded: 100, linesRemoved: 50,
    }));
    expect(predictImpact(80, large).confidence).toBe("medium");

    const huge: FileChange[] = Array.from({ length: 50 }, (_, i) => ({
      path: `f${i}.ts`, kind: "modified" as const, content: "x\n".repeat(500), linesAdded: 500, linesRemoved: 100,
    }));
    expect(predictImpact(80, huge).confidence).toBe("low");
  });

  it("includes vibe trend in the report", () => {
    const report = predictImpact(80, [
      { path: "src/a.ts", kind: "added", content: `function f() { if (a) { if (b) { if (c) { if (d) { if (e) { if (f) { if (g) { if (h) { bad(); } } } } } } } } }` },
    ]);
    expect(report.vibeTrend).toBeDefined();
    expect(report.vibeTrend.newVibe).toBeGreaterThanOrEqual(0);
    expect(report.vibeTrend.direction).toMatch(/rising|falling|stable|insufficient-data/);
    expect(report.vibeTrend.insight).toBeTruthy();
  });

  it("vibeTrend is 'insufficient-data' when only removed files are in the diff", () => {
    const report = predictImpact(80, [
      { path: "src/old.ts", kind: "removed", content: "x", linesAdded: 0, linesRemoved: 100 },
    ]);
    expect(report.vibeTrend.direction).toBe("insufficient-data");
    expect(report.vibeTrend.insight).toMatch(/no added|to measure/i);
  });

  it("vibeTrend insight mentions removed file count when present", () => {
    const report = predictImpact(80, [
      { path: "src/new.ts", kind: "added", content: "function f() { return 1; }" },
      { path: "src/old.ts", kind: "removed", content: "old code" },
    ]);
    expect(report.vibeTrend.insight).toMatch(/1 file.*removed/);
  });
});

describe("calculateSoftware20Score", () => {
  it("returns zeros for empty source", () => {
    const score = calculateSoftware20Score([], []);
    expect(score.overall).toBe(0);
  });

  it("scores high for small well-commented files", () => {
    const sourceFiles = Array.from({ length: 10 }, (_, i) => ({
      path: `src/file${i}.ts`,
      content: `// ${i}: hello\nfunction f${i}() { return ${i}; }`,
    }));
    const testPaths = new Set(["src/file0.test.ts", "src/file1.test.ts", "src/file2.test.ts"]);
    const score = calculateSoftware20Score(sourceFiles, [], testPaths);
    expect(score.overall).toBeGreaterThan(50);
    expect(score.fileSizeScore).toBeGreaterThan(80);
  });

  it("scores low for god-files with no tests", () => {
    const bigFile = "function f() {\n" + "  // hello\n".repeat(800) + "}\n";
    const sourceFiles = [{ path: "src/big.ts", content: bigFile }];
    const score = calculateSoftware20Score(sourceFiles, [], new Set());
    expect(score.overall).toBeLessThan(60);
    expect(score.fileSizeScore).toBeLessThan(50);
    expect(score.testCoverage).toBe(0);
  });

  it("emits structure notes for weak areas", () => {
    const sourceFiles = [{
      path: "src/big.ts",
      content: "function f() { return 1; }".padEnd(500, "\nfunction g() { return 2; }"),
    }];
    const score = calculateSoftware20Score(sourceFiles, [], new Set());
    expect(score.structureNotes.length).toBeGreaterThan(0);
  });
});
