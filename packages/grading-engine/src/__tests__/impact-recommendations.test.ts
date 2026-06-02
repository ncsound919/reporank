import { describe, it, expect } from "vitest";
import { predictImpact, generateRecommendations, type FileChange } from "../analyzers/impact";

const nested = `function f() {
  if (a) {
    if (b) {
      if (c) {
        if (d) {
          if (e) {
            if (f) {
              if (g) {
                if (h) {
                  bad();
                }
              }
            }
          }
        }
      }
    }
  }
}`;

const unsafeAsync = `async function load() {
  const x = await fetch("/api");
  return x;
}`;

describe("generateRecommendations", () => {
  it("returns no recommendations for a healthy PR", () => {
    const impact = predictImpact(80, [{ path: "src/foo.ts", kind: "added", content: "export const x = 1;" }]);
    const recs = generateRecommendations(impact);
    expect(recs.recommendations).toHaveLength(0);
    expect(recs.summary).toContain("healthy");
  });

  it("recommends extracting nested logic from spaghetti code", () => {
    const impact = predictImpact(80, [{ path: "src/bad.ts", kind: "added", content: nested }]);
    const recs = generateRecommendations(impact);
    const extract = recs.recommendations.find(r => r.type === "extract-function");
    expect(extract).toBeDefined();
    expect(extract!.file).toBe("src/bad.ts");
    expect(extract!.estimatedPointsSaved).toBeGreaterThan(0);
  });

  it("recommends adding error handling for unsafe async", () => {
    const impact = predictImpact(80, [{ path: "src/load.ts", kind: "added", content: unsafeAsync }]);
    const recs = generateRecommendations(impact);
    const errorFix = recs.recommendations.find(r => r.type === "add-error-handling");
    expect(errorFix).toBeDefined();
    expect(errorFix!.effort).toBe("small");
  });

  it("classifies quick wins vs major refactors", () => {
    const impact = predictImpact(80, [
      { path: "src/bad.ts", kind: "added", content: nested },
      { path: "src/load.ts", kind: "added", content: unsafeAsync },
    ]);
    const recs = generateRecommendations(impact);
    expect(recs.quickWins.length).toBeGreaterThan(0);
    // Nested code is "medium" effort — should be a major refactor
    const extract = recs.recommendations.find(r => r.type === "extract-function");
    expect(extract).toBeDefined();
    expect(["medium", "large"]).toContain(extract!.effort);
  });

  it("computes projected score after applying all fixes", () => {
    const impact = predictImpact(70, [{ path: "src/bad.ts", kind: "added", content: nested }]);
    const recs = generateRecommendations(impact);
    expect(recs.projectedScore).toBeGreaterThanOrEqual(recs.currentScore);
    expect(recs.projectedScore).toBeLessThanOrEqual(100);
  });

  it("skips file removals in recommendations", () => {
    const impact = predictImpact(80, [
      { path: "src/old.ts", kind: "removed", linesRemoved: 200 },
    ]);
    const recs = generateRecommendations(impact);
    expect(recs.recommendations).toHaveLength(0);
  });

  it("ranks fixes by points-saved-per-effort", () => {
    const impact = predictImpact(80, [
      { path: "src/load.ts", kind: "added", content: unsafeAsync }, // small effort, ~1.5 pts
      { path: "src/bad.ts", kind: "added", content: nested }, // medium effort, more pts
    ]);
    const recs = generateRecommendations(impact);
    if (recs.recommendations.length >= 2) {
      // First should be the higher-ROI one
      const first = recs.recommendations[0];
      const second = recs.recommendations[1];
      const firstRatio = first.estimatedPointsSaved / ({trivial:1,small:2,medium:3,large:4}[first.effort]);
      const secondRatio = second.estimatedPointsSaved / ({trivial:1,small:2,medium:3,large:4}[second.effort]);
      expect(firstRatio).toBeGreaterThanOrEqual(secondRatio);
    }
  });

  it("produces non-empty summary with action counts", () => {
    const impact = predictImpact(80, [
      { path: "src/bad.ts", kind: "added", content: nested },
      { path: "src/load.ts", kind: "added", content: unsafeAsync },
    ]);
    const recs = generateRecommendations(impact);
    expect(recs.summary).toMatch(/\d+ fix/);
  });

  it("assigns unique IDs to each recommendation", () => {
    const impact = predictImpact(80, [
      { path: "src/bad.ts", kind: "added", content: nested },
    ]);
    const recs = generateRecommendations(impact);
    const ids = new Set(recs.recommendations.map(r => r.id));
    expect(ids.size).toBe(recs.recommendations.length);
  });
});
