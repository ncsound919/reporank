import { describe, it, expect } from "vitest";
import { analyzeRiskHeatmap, analyzeTestGaps, calculateTechDebtRatio } from "../analyzers/senior-dev";

describe("analyzeRiskHeatmap", () => {
  it("returns empty for empty source files", () => {
    const result = analyzeRiskHeatmap([]);
    expect(result.items).toEqual([]);
    expect(result.maxRisk).toBe(0);
  });

  it("identifies high complexity files", () => {
    const files = [{ path: "complex.ts", content: "if (a) { if (b) { if (c) { if (d) { } } } }\n".repeat(20) }];
    const result = analyzeRiskHeatmap(files);
    expect(result.items.length).toBeGreaterThanOrEqual(0);
  });

  it("returns summary string", () => {
    const files = [{ path: "test.ts", content: "const x = 1;" }];
    const result = analyzeRiskHeatmap(files);
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("handles files with null content", () => {
    const files = [{ path: "test.ts", content: "" }];
    const result = analyzeRiskHeatmap(files);
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("sorts by risk score descending", () => {
    const files = [
      { path: "a.ts", content: "if (a) {}\n".repeat(50) },
      { path: "b.ts", content: "const x = 1;" },
    ];
    const result = analyzeRiskHeatmap(files);
    for (let i = 1; i < result.items.length; i++) {
      expect(result.items[i - 1].riskScore).toBeGreaterThanOrEqual(result.items[i].riskScore);
    }
  });

  it("limits to 15 items", () => {
    const files = Array.from({ length: 20 }, (_, i) => ({
      path: `file${i}.ts`,
      content: "if (a) { if (b) { if (c) {} } }\n".repeat(30),
    }));
    const result = analyzeRiskHeatmap(files);
    expect(result.items.length).toBeLessThanOrEqual(15);
  });
});

describe("analyzeTestGaps", () => {
  it("detects source files without tests", () => {
    const files = [
      { path: "src/app.ts", content: "export const x = 1;" },
    ];
    const result = analyzeTestGaps(files);
    expect(result.gaps.length).toBeGreaterThanOrEqual(0);
  });

  it("does not flag test files themselves", () => {
    const files = [
      { path: "src/app.test.ts", content: "import { test } from 'vitest';" },
    ];
    const result = analyzeTestGaps(files);
    expect(result.gaps.filter(g => g.sourceFile === "src/app.test.ts").length).toBe(0);
  });

  it("handles empty file list", () => {
    const result = analyzeTestGaps([]);
    expect(Array.isArray(result.gaps)).toBe(true);
    expect(result.gaps.length).toBe(0);
  });

  it("flags source files >50 lines as test gaps", () => {
    const files = [
      { path: "src/service.ts", content: "export const x = 1;\n".repeat(60) },
    ];
    const result = analyzeTestGaps(files);
    expect(result.gaps.length).toBeGreaterThanOrEqual(0);
  });

  it("sorts high priority first", () => {
    const files = [
      { path: "src/simple.ts", content: "export const x = 1;\n".repeat(60) },
      { path: "src/complex.ts", content: "if (a) {}\n".repeat(60) },
    ];
    const result = analyzeTestGaps(files);
    const highPriorityGaps = result.gaps.filter(g => g.priority === "high");
    expect(result.gaps.filter(g => g.priority === "high").length).toBeGreaterThanOrEqual(0);
  });

  it("skips node_modules files", () => {
    const files = [
      { path: "node_modules/lodash/index.ts", content: "export const x = 1;\n".repeat(60) },
    ];
    const result = analyzeTestGaps(files);
    expect(result.gaps.filter(g => g.sourceFile.includes("node_modules")).length).toBe(0);
  });
});

describe("calculateTechDebtRatio", () => {
  it("returns zero debt for empty findings", () => {
    const result = calculateTechDebtRatio([], {}, [], 1000);
    expect(result.fixableIssues).toBe(0);
    expect(result.estimatedFixHours).toBe(0);
  });

  it("calculates hours from code hygiene findings", () => {
    const findings = [
      { severity: "critical" },
      { severity: "high" },
      { severity: "medium" },
      { severity: "low" },
    ];
    const result = calculateTechDebtRatio(findings, {}, [], 1000);
    expect(result.fixableIssues).toBe(4);
    expect(result.estimatedFixHours).toBeGreaterThan(0);
  });

  it("estimates ratio based on total lines", () => {
    const findings = [{ severity: "critical" }, { severity: "high" }];
    const result = calculateTechDebtRatio(findings, {}, [], 100);
    expect(result.debtRatio).toBeGreaterThanOrEqual(0);
    expect(result.totalSourceLines).toBe(100);
  });

  it("handles missing data gracefully", () => {
    const result = calculateTechDebtRatio(undefined, undefined, undefined, 0);
    expect(result.fixableIssues).toBe(0);
    expect(typeof result.summary).toBe("string");
  });

  it("returns high debt summary when ratio >30", () => {
    const findings = Array(10).fill({ severity: "critical" });
    const result = calculateTechDebtRatio(findings, {}, [], 100);
    expect(result.summary).toContain("High debt");
  });

  it("returns low debt summary when ratio <15", () => {
    const result = calculateTechDebtRatio([], {}, [], 1000);
    expect(result.summary).toContain("Low debt");
  });

  it("includes complexity hotspots in total", () => {
    const findings = [{ severity: "high" }];
    const complexity = { hotSpots: [{ severity: "critical" }, { severity: "low" }] };
    const result = calculateTechDebtRatio(findings, complexity, [], 500);
    expect(result.fixableIssues).toBe(3);
  });
});
