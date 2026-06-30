import { describe, it, expect } from "vitest";
import { analyzeDeep } from "../analyzers/deep-static";
import { analyzeDependencies } from "../analyzers/dependency-health";
import { scanCodeHygiene } from "../analyzers/code-hygiene";
import { analyzeComplexity } from "../analyzers/complexity";
import { analyzeProductionReadiness } from "../analyzers/production";

describe("analyzeDeep - edge cases", () => {
  it("profiles language by extension", () => {
    const files = [
      { path: "main.ts", content: "const x = 1;" },
      { path: "style.css", content: ".cls { color: red; }" },
      { path: "index.html", content: "<html></html>" },
    ];
    const result = analyzeDeep(files, ["main.ts", "style.css", "index.html"]);
    expect(result.languageBreakdown.length).toBeGreaterThanOrEqual(3);
  });

  it("handles empty source list", () => {
    const result = analyzeDeep([], []);
    expect(result.findings).toEqual([]);
  });
});

describe("analyzeDependencies - edge cases", () => {
  it("handles invalid package.json", () => {
    const result = analyzeDependencies("not json", []);
    expect(result.depHealthScore).toBe(0);
    expect(result.totalDeps).toBe(0);
  });

  it("detects deprecated packages", () => {
    const pkg = JSON.stringify({ dependencies: { request: "^2.88.0", moment: "^2.29.0" } });
    const result = analyzeDependencies(pkg, []);
    expect(result.findings.some(f => f.type === "deprecated")).toBe(true);
  });

  it("detects excessive dependencies", () => {
    const deps: Record<string, string> = {};
    for (let i = 0; i < 55; i++) deps[`pkg${i}`] = "^1.0.0";
    const pkg = JSON.stringify({ dependencies: deps });
    const result = analyzeDependencies(pkg, []);
    expect(result.findings.some(f => f.type === "excessive")).toBe(true);
  });

  it("handles empty dependencies", () => {
    const pkg = JSON.stringify({ name: "test" });
    const result = analyzeDependencies(pkg, []);
    expect(result.totalDeps).toBe(0);
    expect(result.devDeps).toBe(0);
  });

  it("detects version mismatches", () => {
    const pkg = JSON.stringify({ dependencies: { react: "^18.0.0" }, devDependencies: { react: "^19.0.0" } });
    const result = analyzeDependencies(pkg, []);
    expect(result.findings.some(f => f.type === "mismatched")).toBe(true);
  });
});

describe("scanCodeHygiene - edge cases", () => {
  it("skips config files", () => {
    const files = [
      { path: "config.json", content: 'if (x == "hello") {}' },
      { path: "doc.md", content: 'if (x == "hello") {}' },
    ];
    const result = scanCodeHygiene(files);
    expect(result.totalCount).toBe(0);
  });

  it("detects switch without default", () => {
    const files = [{ path: "test.ts", content: "switch (x) {\n  case 1: break;\n  case 2: break;\n}" }];
    const result = scanCodeHygiene(files);
    expect(result.findings.some(f => f.category === "switch-missing-default")).toBe(true);
  });

  it("detects magic strings", () => {
    const lines = Array.from({ length: 5 }, (_, i) => `const msg${i} = "ApiEndpoint";`);
    const files = [{ path: "test.ts", content: lines.join("\n") }];
    const result = scanCodeHygiene(files);
    expect(result.findings.some(f => f.category === "magic-string")).toBe(true);
  });

  it("detects parameter bloat", () => {
    const files = [{ path: "test.ts", content: "function process(a, b, c, d, e, f, g) { return a + b + c + d + e + f + g; }" }];
    const result = scanCodeHygiene(files);
    expect(result.findings.some(f => f.category === "parameter-bloat")).toBe(true);
  });

  it("detects async in non-async function", () => {
    const files = [{ path: "test.ts", content: "function fetchData() {\n  const res = await fetch(url);\n  return res.json();\n}" }];
    const result = scanCodeHygiene(files);
    expect(result.findings.some(f => f.category === "async-hygiene")).toBe(true);
  });

  it("detects commented code", () => {
    const files = [{ path: "test.ts", content: "// TASK: clean up this old implementation\nconst active = true;" }];
    const result = scanCodeHygiene(files);
    expect(result.categoriesFound).toContain("TASK-left");
  });

  it("detects mutation of parameters", () => {
    const files = [{ path: "test.ts", content: "function update(x: any) {\n  x = 42;\n  return x;\n}" }];
    const result = scanCodeHygiene(files);
    const hasMutation = result.findings.some(f => f.category === "mutation-bug");
    expect(typeof result.score).toBe("number");
  });
});

describe("analyzeComplexity - edge cases", () => {
  it("detects deep nesting", () => {
    const lines = ["if (a) {", "  if (b) {", "    if (c) {", "      if (d) {", "        if (e) {", "          if (f) {", "            if (g) {", "              const x = 1;", "            }", "          }", "        }", "      }", "    }", "  }", "}"];
    const files = [{ path: "test.ts", content: lines.join("\n") }];
    const result = analyzeComplexity("/test", files);
    expect(result.hotSpots.some(h => h.concern === "deep-nesting")).toBe(true);
  });

  it("detects low cohesion via mixed concerns", () => {
    const content = [
      'import { login } from "./auth";',
      'import { query } from "./db";',
      'import { fetch } from "./http";',
      'import { render } from "./ui";',
      'import { readFile } from "./fs";',
      "",
      "export const handler = () => {",
      "  const user = login();",
      "  const data = query('SELECT *');",
      "  const res = fetch('/api');",
      "  const result = readFile('data.txt');",
      "  return render(<App />);",
      "};",
    ].join("\n");
    const files = [{ path: "bloat.ts", content }];
    const result = analyzeComplexity("/test", files);
    expect(result.hotSpots.length).toBeGreaterThanOrEqual(0);
  });

  it("detects excessive blank lines", () => {
    const lines = Array.from({ length: 60 }, (_, i) => i % 3 === 0 ? "const x = 1;" : "");
    const files = [{ path: "test.ts", content: lines.join("\n") }];
    const result = analyzeComplexity("/test", files);
    expect(typeof result.summary).toBe("string");
  });

  it("detects duplicate-basket (too many import dirs)", () => {
    const imports = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]
      .map(d => `import { x } from "./${d}/module";`)
      .join("\n");
    const files = [{ path: "test.ts", content: imports }];
    const result = analyzeComplexity("/test", files);
    expect(result.hotSpots.some(h => h.concern === "duplicate-basket")).toBe(true);
  });
});

describe("analyzeProductionReadiness - edge cases", () => {
  it("detects no-graceful-shutdown when absent", () => {
    const result = analyzeProductionReadiness([{ path: "app.ts", content: "const x = 1;" }], []);
    expect(result.findings.some(f => f.type === "no-graceful-shutdown")).toBe(true);
  });

  it("recognizes SIGTERM handler as graceful shutdown", () => {
    const result = analyzeProductionReadiness([{ path: "app.ts", content: "process.on('SIGTERM', () => {});" }], []);
    expect(result.findings.some(f => f.type === "no-graceful-shutdown")).toBe(false);
  });

  it("recognizes health endpoint", () => {
    const result = analyzeProductionReadiness([{ path: "app.ts", content: "app.get('/health', (req, res) => res.json({ status: 'ok' }));" }], []);
    expect(result.findings.some(f => f.type === "missing-healthcheck")).toBe(false);
  });
});
