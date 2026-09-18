import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { analyzeSource, parseNodeAst } from "../ast/node-parser";
import { parsePythonAst } from "../ast/python-parser";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "reporank-ast-"));
  writeFileSync(
    join(dir, "app.ts"),
    `import { x } from "./x";
export class Widget {
  render(a: number, b: number) {
    if (a > 0 && b > 0) return a;
    return b;
  }
}
export function decide(n: number): string {
  if (n > 10) return "big";
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) continue;
  }
  return n > 5 ? "mid" : "small";
}
`,
  );
  mkdirSync(join(dir, "pkg"));
  writeFileSync(join(dir, "pkg", "helper.py"), "def add(a, b):\n    if a > b:\n        return a\n    return b\n");
});

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe("node AST analyzer", () => {
  it("counts functions, classes, imports and real complexity", () => {
    const metric = analyzeSource(
      "app.ts",
      `export function decide(n: number) {
        if (n > 10) return "big";
        for (let i = 0; i < n; i++) { if (i) continue; }
        return n > 5 ? "mid" : "small";
      }`,
    );
    expect(metric.functions).toBe(1);
    expect(metric.exports).toBeGreaterThanOrEqual(1);
    // 1 base + if + for + inner if + ternary = 5
    expect(metric.maxComplexity).toBe(5);
    expect(metric.avgComplexity).toBe(5);
  });

  it("parses a directory with real per-file metrics", async () => {
    const report = await parseNodeAst(dir);
    expect(report.parsed).toBe(true);
    expect(report.files).toBeGreaterThanOrEqual(1);
    expect(report.metrics.functions).toBeGreaterThanOrEqual(2);
    expect(report.metrics.classes).toBeGreaterThanOrEqual(1);
    expect(report.metrics.complexity).toBeGreaterThan(0);
  });
});

describe("python AST analyzer", () => {
  it("parses stdlib ast metrics or degrades honestly when python is absent", async () => {
    const report = await parsePythonAst(dir);
    if (report.parsed) {
      expect(report.metrics.functions).toBeGreaterThanOrEqual(1);
      expect(report.perFile.some((f) => f.file.endsWith("helper.py"))).toBe(true);
    } else {
      // No python interpreter — must be an explicit reason, never fake numbers.
      expect(report.reason).toBeTruthy();
      expect(report.metrics.complexity).toBeNull();
    }
  });
});
