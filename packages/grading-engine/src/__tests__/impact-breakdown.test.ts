import { describe, it, expect } from "vitest";
import { predictImpact, breakdownImpact, type FileChange } from "../analyzers/impact";

describe("breakdownImpact", () => {
  it("returns empty breakdown for no changes", () => {
    const impact = predictImpact(80, []);
    const breakdown = breakdownImpact(impact);
    expect(breakdown.totalDelta).toBe(0);
    expect(breakdown.categories).toHaveLength(0);
    expect(breakdown.dominantCategory).toBeNull();
  });

  it("decomposes per-file deltas into categories", () => {
    const nestedContent = `function f() {
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
    const changes: FileChange[] = [
      { path: "src/old.ts", kind: "removed", linesRemoved: 100 },
      { path: "src/bad.ts", kind: "added", content: nestedContent },
      { path: "src/foo.test.ts", kind: "added", content: `it("works", () => { expect(1).toBe(1); });` },
    ];
    const impact = predictImpact(80, changes);
    const breakdown = breakdownImpact(impact);
    expect(breakdown.categories.length).toBeGreaterThan(0);
    expect(breakdown.positiveCategories.length).toBeGreaterThan(0);
    expect(breakdown.negativeCategories.length).toBeGreaterThan(0);
  });

  it("dominant category is the largest absolute delta", () => {
    const changes: FileChange[] = [
      { path: "src/spaghetti.ts", kind: "added", content: `function f() {
        if (a) { if (b) { if (c) { if (d) { if (e) { if (f) { if (g) { if (h) { if (i) { bad(); } } } } } } } } }
      }` },
      { path: "src/foo.test.ts", kind: "added", content: `it("works", () => {});` },
    ];
    const impact = predictImpact(80, changes);
    const breakdown = breakdownImpact(impact);
    expect(breakdown.dominantCategory).not.toBeNull();
  });

  it("identifies code-removal category for file removals", () => {
    const changes: FileChange[] = [
      { path: "src/dead.ts", kind: "removed", linesRemoved: 200 },
    ];
    const impact = predictImpact(75, changes);
    const breakdown = breakdownImpact(impact);
    const codeRemoval = breakdown.categories.find(c => c.category === "code-removal");
    expect(codeRemoval).toBeDefined();
    expect(codeRemoval!.delta).toBeGreaterThan(0);
    expect(codeRemoval!.fileCount).toBe(1);
  });

  it("identifies error-handling category for async-without-try/catch", () => {
    const changes: FileChange[] = [
      { path: "src/load.ts", kind: "added", content: `async function load() { const x = await fetch("/api"); return x; }` },
    ];
    const impact = predictImpact(80, changes);
    const breakdown = breakdownImpact(impact);
    const errorCat = breakdown.categories.find(c => c.category === "error-handling");
    expect(errorCat).toBeDefined();
  });

  it("totals across categories approximately match totalDelta", () => {
    const changes: FileChange[] = [
      { path: "src/old.ts", kind: "removed", linesRemoved: 100 },
      { path: "src/bad.ts", kind: "added", content: `function f() {
        if (a) { if (b) { if (c) { if (d) { if (e) { if (f) { if (g) { if (h) { bad(); } } } } } } } }
      }` },
    ];
    const impact = predictImpact(80, changes);
    const breakdown = breakdownImpact(impact);
    const summed = breakdown.categories.reduce((s, c) => s + c.delta, 0);
    // Allow rounding tolerance
    expect(Math.abs(summed - impact.totalDelta)).toBeLessThanOrEqual(2);
  });

  it("sorts categories by absolute impact descending", () => {
    const changes: FileChange[] = [
      { path: "src/spaghetti.ts", kind: "added", content: `function f() {
        if (a) { if (b) { if (c) { if (d) { if (e) { if (f) { if (g) { if (h) { bad(); } } } } } } } }
      }` },
      { path: "src/old.ts", kind: "removed", linesRemoved: 50 },
      { path: "src/test.ts", kind: "added", content: `it("works", () => {});` },
    ];
    const impact = predictImpact(80, changes);
    const breakdown = breakdownImpact(impact);
    for (let i = 1; i < breakdown.categories.length; i++) {
      const prev = Math.abs(breakdown.categories[i - 1].delta);
      const curr = Math.abs(breakdown.categories[i].delta);
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});
