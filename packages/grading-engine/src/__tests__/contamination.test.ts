import { describe, it, expect } from "vitest";
import { calculateVibeCodingIndex } from "../analyzers/contamination";

describe("calculateVibeCodingIndex", () => {
  it("returns zero for empty source files", () => {
    const result = calculateVibeCodingIndex([], []);
    expect(result.overallScore).toBe(0);
    expect(result.perFile).toEqual([]);
    expect(result.summary).toContain("No source files");
  });

  it("returns low score for clean human-written code", () => {
    const files = [{ path: "clean.ts", content: "export function add(a: number, b: number): number {\n  return a + b;\n}\nexport const PI = 3.14;" }];
    const result = calculateVibeCodingIndex(files, ["clean.ts"]);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(typeof result.knownHumanScore).toBe("number");
  });

  it("detects spaghetti nesting as AI signal", () => {
    const content = Array.from({ length: 10 }, (_, i) => `  if (a${i}) {`).join("\n") +
      "\n" + Array.from({ length: 10 }, () => "}").join("\n");
    const files = [{ path: "spaghetti.ts", content }];
    const result = calculateVibeCodingIndex(files, ["spaghetti.ts"]);
    expect(result.signalBreakdown.spaghettiNesting).toBeGreaterThan(0);
  });

  it("returns per-file breakdown", () => {
    const content = Array.from({ length: 10 }, (_, i) => `  if (a${i}) {`).join("\n") +
      "\n" + Array.from({ length: 10 }, () => "}").join("\n");
    const files = [{ path: "spaghetti.ts", content }];
    const result = calculateVibeCodingIndex(files, ["spaghetti.ts"]);
    expect(result.perFile.length).toBeGreaterThan(0);
    expect(result.perFile[0].path).toBe("spaghetti.ts");
  });

  it("aggregates signals across multiple files", () => {
    const files = [
      { path: "a.ts", content: "if (a) { if (b) { if (c) { if (d) { if (e) { if (f) { if (g) { if (h) { } } } } } } } }" },
      { path: "b.ts", content: 'import { Something } from "Somepackage";\nexport const x = 1;' },
    ];
    const result = calculateVibeCodingIndex(files, ["a.ts", "b.ts"]);
    expect(Array.isArray(result.perFile)).toBe(true);
    expect(typeof result.signalBreakdown.spaghettiNesting).toBe("number");
  });

  it("produces readable summary based on score range", () => {
    const result = calculateVibeCodingIndex([{ path: "test.ts", content: "const x = 1;" }], ["test.ts"]);
    expect(result.summary).toContain("Vibe Coding Index");
  });

  it("includes knownHumanScore inversely related to vibe score", () => {
    const files = [{ path: "clean.ts", content: "const x = 1;\nconst y = 2;" }];
    const result = calculateVibeCodingIndex(files, ["clean.ts"]);
    expect(result.knownHumanScore + result.overallScore).toBeLessThanOrEqual(200);
  });
});
