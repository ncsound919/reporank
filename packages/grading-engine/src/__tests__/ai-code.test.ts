import { describe, it, expect } from "vitest";
import { analyzeAiCode } from "../analyzers/ai-code";

describe("analyzeAiCode", () => {
  it("returns empty for no source files", () => {
    const result = analyzeAiCode([], []);
    expect(result.findings).toEqual([]);
    expect(result.spaghettiScore).toBe(0);
  });

  it("detects deep nesting (spaghetti)", () => {
    const content = Array.from({ length: 10 }, (_, i) => `  if (a${i}) {`).join("\n") + "\n" + Array.from({ length: 10 }, () => "}").join("\n");
    const files = [{ path: "test.ts", content }];
    const result = analyzeAiCode(files, []);
    expect(result.findings.some(f => f.pattern === "spaghetti-nesting")).toBe(true);
  });

  it("detects over-engineering (more types than functions)", () => {
    const content = "interface A {}\ninterface B {}\ninterface C {}\ninterface D {}\ninterface E {}\ninterface F {}\ntype X = string;\ntype Y = number;\nconst fn = () => {};";
    const files = [{ path: "test.ts", content }];
    const result = analyzeAiCode(files, []);
    expect(result.findings.some(f => f.pattern === "over-engineering")).toBe(true);
  });

  it("detects hallucinated imports", () => {
    const files = [{ path: "test.ts", content: 'import { Something } from "Somepackage";' }];
    const result = analyzeAiCode(files, []);
    expect(result.findings.some(f => f.pattern === "hallucinated-import")).toBe(true);
  });

  it("detects missing error boundaries in async code", () => {
    const files = [{ path: "test.ts", content: "async function fetchData() {\n  const res = await fetch(url);\n  return res.json();\n}" }];
    const result = analyzeAiCode(files, []);
    expect(result.findings.some(f => f.pattern === "missing-error-boundary")).toBe(true);
  });

  it("detects security naivety (innerHTML)", () => {
    const files = [{ path: "component.tsx", content: 'element.innerHTML = userInput;' }];
    const result = analyzeAiCode(files, []);
    expect(result.findings.some(f => f.pattern === "security-naivety")).toBe(true);
  });

  it("detects eval() usage", () => {
    const files = [{ path: "eval.ts", content: 'eval(userInput);' }];
    const result = analyzeAiCode(files, []);
    expect(result.findings.some(f => f.pattern === "security-naivety")).toBe(true);
  });

  it("detects infinite loop risk", () => {
    const files = [{ path: "loop.ts", content: "while (true) { doSomething(); }" }];
    const result = analyzeAiCode(files, []);
    expect(result.findings.some(f => f.pattern === "infinite-loop-risk")).toBe(true);
  });

  it("detects promise-garden (unresolved promises)", () => {
    const files = [{ path: "test.ts", content: "const p = new Promise((resolve, reject) => {\n  setTimeout(() => {}, 1000);\n});" }];
    const result = analyzeAiCode(files, []);
    expect(result.findings.some(f => f.pattern === "promise-garden")).toBe(true);
  });

  it("detects any-abuse", () => {
    const content = Array.from({ length: 15 }, (_, i) => `const x${i}: any = ${i};`).join("\n");
    const files = [{ path: "test.ts", content }];
    const result = analyzeAiCode(files, []);
    expect(result.findings.some(f => f.pattern === "any-abuse")).toBe(true);
  });

  it("generates takeOverPoints for critical findings", () => {
    const files = [{ path: "test.ts", content: "while (true) {}\nconst name: any = user.name!;" }];
    const result = analyzeAiCode(files, []);
    expect(result.takeOverPoints.length).toBeGreaterThan(0);
  });

  it("limits spaghetti score to 100", () => {
    const files = [{ path: "test.ts", content: "if (a) { if (b) { if (c) { if (d) { if (e) { if (f) { if (g) { if (h) { if (i) { if (j) { } } } } } } } } } }" }];
    const result = analyzeAiCode(files, []);
    expect(result.spaghettiScore).toBeLessThanOrEqual(100);
  });

  it("returns summary", () => {
    const files = [{ path: "test.ts", content: "const x = 1;" }];
    const result = analyzeAiCode(files, []);
    expect(typeof result.summary).toBe("string");
  });

  it("handles empty content files", () => {
    const files = [{ path: "test.ts", content: "" }];
    const result = analyzeAiCode(files, []);
    expect(Array.isArray(result.findings)).toBe(true);
  });
});
