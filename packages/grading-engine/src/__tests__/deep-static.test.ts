import { describe, it, expect } from "vitest";
import { analyzeDeep } from "../analyzers/deep-static";

describe("analyzeDeep", () => {
  it("returns language breakdown", () => {
    const files = [{ path: "test.ts", content: "const x = 1;\nconst y = 2;" }];
    const result = analyzeDeep(files, ["test.ts"]);
    expect(result.languageBreakdown.length).toBeGreaterThan(0);
    expect(result.languageBreakdown[0].lang).toBe("TypeScript");
  });

  it("calculates comment ratios", () => {
    const files = [{ path: "test.ts", content: "// comment\n// comment\nconst x = 1;\n// comment\n/* block */" }];
    const result = analyzeDeep(files, ["test.ts"]);
    expect(result.commentRatios.length).toBeGreaterThan(0);
  });

  it("detects TODO density", () => {
    const files = [{ path: "test.ts", content: "// TODO: fix this\nconst x = 1;\n// FIXME: broken" }];
    const result = analyzeDeep(files, ["test.ts"]);
    expect(result.todoDensity.length).toBeGreaterThan(0);
  });

  it("detects mixed import styles", () => {
    const files = [{ path: "test.ts", content: "import { x } from './a';\nconst y = require('./b');" }];
    const result = analyzeDeep(files, ["test.ts"]);
    expect(result.findings.some(f => f.type === "mixed-import-styles")).toBe(true);
  });

  it("detects large functions", () => {
    const files = [{ path: "test.ts", content: "export function veryLongFunction() {\n" + Array(55).fill("  const x = 1;").join("\n") + "\n}" }];
    const result = analyzeDeep(files, ["test.ts"]);
    expect(result.findings.some(f => f.type === "large-function")).toBe(true);
  });

  it("detects duplicate imports", () => {
    const files = [{ path: "test.ts", content: "import { x } from './a';\nimport { x } from './a';" }];
    const result = analyzeDeep(files, ["test.ts"]);
    expect(result.findings.some(f => f.type === "duplicate-import")).toBe(true);
  });

  it("handles empty source files", () => {
    const result = analyzeDeep([], []);
    expect(result.languageBreakdown).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("returns summary", () => {
    const result = analyzeDeep([{ path: "test.ts", content: "const x = 1;" }], ["test.ts"]);
    expect(typeof result.summary).toBe("string");
  });
});
