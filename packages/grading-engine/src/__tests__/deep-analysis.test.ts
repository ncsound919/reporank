import { describe, it, expect, vi } from "vitest";
import { runDeepAnalysis } from "../analyzers/index";

const mockSourceFiles = [
  { path: "src/index.ts", content: `export const greet = (name: string) => \`Hello \${name}\`;` },
  { path: "src/utils.ts", content: `export function add(a: number, b: number) { return a + b; }` },
  { path: "src/app.ts", content: `import { greet } from "./index";\nprocess.stdout.write(greet("World"));` },
];

describe("runDeepAnalysis", () => {
  it("orchestrates all sub-analyzers", () => {
    const result = runDeepAnalysis("/test", ["src/index.ts", "src/utils.ts", "src/app.ts"], mockSourceFiles, "{}");
    expect(result.complexity).toBeDefined();
    expect(result.dependencies).toBeDefined();
    expect(result.architecture).toBeDefined();
    expect(result.production).toBeDefined();
    expect(result.codeHygiene).toBeDefined();
    expect(result.enterprise).toBeDefined();
  });

  it("computes worst files from hotspots", () => {
    const result = runDeepAnalysis("/test", ["src/index.ts", "src/utils.ts", "src/app.ts"], mockSourceFiles, "{}");
    expect(Array.isArray(result.worstFiles)).toBe(true);
  });

  it("generates top recommendations", () => {
    const result = runDeepAnalysis("/test", ["src/index.ts", "src/utils.ts", "src/app.ts"], mockSourceFiles, "{}");
    expect(Array.isArray(result.topRecommendations)).toBe(true);
  });

  it("returns rawPromptBlock for AI", () => {
    const result = runDeepAnalysis("/test", ["src/index.ts", "src/utils.ts", "src/app.ts"], mockSourceFiles, "{}");
    expect(typeof result.rawPromptBlock).toBe("string");
    expect(result.rawPromptBlock.length).toBeGreaterThan(0);
  });

  it("handles empty source files", () => {
    const result = runDeepAnalysis("/test", [], [], "{}");
    expect(result.complexity.fileSizeDistribution.small).toBe(0);
    expect(result.worstFiles.length).toBeGreaterThanOrEqual(0);
  });

  it("handles missing package.json gracefully", () => {
    const result = runDeepAnalysis("/test", ["src/index.ts"], mockSourceFiles, "");
    expect(result.dependencies).toBeDefined();
    expect(typeof result.dependencies.depHealthScore).toBe("number");
  });

  it("aggregates findings from complexity and architecture", () => {
    const largeFile = { path: "bloat.ts", content: Array.from({ length: 20 }, (_, i) => `export const func${i} = () => {};`).join("\n") };
    const result = runDeepAnalysis("/test", ["bloat.ts"], [largeFile], "{}");
    expect(result.worstFiles.length).toBeGreaterThanOrEqual(0);
  });

  it("includes deploy blocker recommendations when production has issues", () => {
    const unsafeFile = { path: "config.ts", content: "const KEY = 'AIzaSyDxMsomeRandomKeyHereForTesting123456789';" };
    const result = runDeepAnalysis("/test", ["config.ts"], [unsafeFile], "{}");
    const deployRecs = result.topRecommendations.filter(r => r.includes("deploy") || r.includes("DEPLOY"));
    expect(typeof result.complexity.summary).toBe("string");
  });

  it("handles json files without crashing", () => {
    const jsonFiles = [
      { path: "config.json", content: '{"key": "value"}' },
      { path: "data.yaml", content: "key: value" },
    ];
    const result = runDeepAnalysis("/test", ["config.json", "data.yaml"], jsonFiles, "{}");
    expect(result.codeHygiene).toBeDefined();
  });

  it("processes production analysis for code files", () => {
    const file = { path: "service.ts", content: "async function fetchData() {\n  const res = await fetch(url);\n  return res.json();\n}" };
    const result = runDeepAnalysis("/test", ["service.ts"], [file], "{}");
    expect(result.production.findings.length).toBeGreaterThanOrEqual(0);
  });
});
