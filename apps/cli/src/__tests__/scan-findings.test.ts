import { describe, it, expect } from "vitest";
import {
  buildScanFindings,
  gradeDimensions,
  scanSecrets,
  weightedOverall,
  type DeepAnalysisReport,
} from "../scan-findings";

/** Minimal valid deep-analysis report used to exercise the mapping logic. */
function emptyDeep(): DeepAnalysisReport {
  return {
    complexity: {
      hotSpots: [],
      fileSizeDistribution: { small: 0, medium: 0, large: 0, xlarge: 0 },
      longestFiles: [],
      worstFiles: [],
      cohesionViolations: [],
      summary: "",
    },
    dependencies: {
      findings: [],
      totalDeps: 0,
      devDeps: 0,
      unusedPatterns: [],
      depHealthScore: 82,
      summary: "",
    },
    architecture: { findings: [], directoryBreakdown: [], recommendedStructure: "", summary: "" },
    production: { findings: [], deployBlockers: [], overallReadiness: "ready", summary: "" },
    codeHygiene: { findings: [], totalCount: 0, categoriesFound: [], score: 100, summary: "" },
    enterprise: {
      apiContract: { findings: [], apiSurface: [], consistencyScore: 100, seniorSummary: "" },
      observability: { findings: [], observabilityScore: 100, seniorSummary: "" },
      buildCI: { findings: [], ciScore: 64, seniorSummary: "" },
      coupling: { findings: [], couplingScore: 100, seniorSummary: "" },
      license: { findings: [], licenseScore: 100, seniorSummary: "" },
      longTermDebt: { findings: [], debtScore: 100, seniorSummary: "" },
      overallSeniorScore: 100,
      criticalBlockers: [],
      seniorSummary: "",
      rawPromptBlock: "",
    },
    structure: {
      findings: [],
      cycles: [],
      layerViolations: [],
      coupling: [],
      cycleCount: 0,
      layerViolationCount: 0,
      averageInstability: 0,
      summary: "",
    },
    deadCode: { steps: [], totalRemovable: 0, estimatedSavingsLoc: 0, summary: "" },
    worstFiles: [],
    topRecommendations: [],
    rawPromptBlock: "",
  };
}

describe("scanSecrets", () => {
  it("reports a real file path and line instead of a blob offset", () => {
    const hits = scanSecrets([
      { path: "src/one.ts", content: "const a = 1;\nconst b = 2;\n" },
      { path: "src/config.ts", content: 'const a = 1;\nconst key = "AKIA1234567890ABCDEF";\n' },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ type: "aws-access-key", path: "src/config.ts", line: 2 });
  });
});

describe("buildScanFindings", () => {
  it("keeps file/line for analyzer findings that provide them", () => {
    const deep = emptyDeep();
    deep.codeHygiene.findings.push({
      category: "debugger-left-in",
      filePath: "src/app.ts",
      line: 3,
      severity: "critical",
      detail: "debugger left in",
      fixSuggestion: "remove it",
    });
    const found = buildScanFindings(deep, []).find((f) => f.type === "hygiene-debugger-left-in");
    expect(found).toMatchObject({ path: "src/app.ts", line: 3, located: true });
  });

  it("marks package-level findings as unlocated rather than inventing a line", () => {
    const deep = emptyDeep();
    deep.dependencies.findings.push({
      type: "outdated",
      packageName: "left-pad",
      version: "1.0.0",
      severity: "medium",
      detail: "ancient",
    });
    const found = buildScanFindings(deep, []).find((f) => f.category === "dependency");
    expect(found?.located).toBe(false);
    expect(found?.path).toBeUndefined();
    expect(found?.line).toBeUndefined();
  });

  it("maps structural findings with a real file and line", () => {
    const deep = emptyDeep();
    deep.structure.findings.push({
      type: "layer-violation",
      filePath: "src/api/users.ts",
      line: 4,
      severity: "high",
      detail: "api imports db",
    });
    const found = buildScanFindings(deep, []).find((f) => f.type === "structure-layer-violation");
    expect(found).toMatchObject({ path: "src/api/users.ts", line: 4, located: true, category: "structure" });
  });

  it("treats the synthetic 'global' analyzer path as unlocated", () => {    const deep = emptyDeep();
    deep.enterprise.observability.findings.push({
      type: "no-structured-logging",
      filePath: "global",
      severity: "high",
      detail: "no pino/winston",
      seniorNote: "add a logger",
    });
    const found = buildScanFindings(deep, []).find((f) => f.type === "enterprise-observability-no-structured-logging");
    expect(found?.located).toBe(false);
    expect(found?.path).toBeUndefined();
  });

  it("emits located findings for secrets", () => {
    const deep = emptyDeep();
    const hits = scanSecrets([{ path: "src/key.ts", content: 'const key = "ghp_0123456789012345678901234567890123456";\n' }]);
    const found = buildScanFindings(deep, hits).find((f) => f.category === "security");
    expect(found).toMatchObject({ path: "src/key.ts", line: 1, located: true });
  });
});

describe("gradeDimensions", () => {
  it("derives config + dependency dimensions from analyzers, not hardcoded values", () => {
    const dims = gradeDimensions(emptyDeep(), true);
    expect(dims.configCoherence).toBe(64);
    expect(dims.dependencyFreshness).toBe(82);
    expect(dims.provenance.configCoherence.measured).toBe(true);
    expect(dims.provenance.dependencyFreshness.measured).toBe(true);
    expect(dims.unmeasured).toEqual([]);
  });

  it("reports dependencyFreshness as unmeasured when package.json was not fetched", () => {
    const dims = gradeDimensions(emptyDeep(), false);
    expect(dims.dependencyFreshness).toBeNull();
    expect(dims.unmeasured).toContain("dependencyFreshness");
  });
});

describe("weightedOverall", () => {
  it("renormalises weights when a dimension is unmeasured", () => {
    const noDeps = weightedOverall({
      naming: 100,
      modernity: 100,
      hygiene: 100,
      configCoherence: 100,
      dependencyFreshness: null,
    });
    expect(noDeps).toBe(100);
  });

  it("does not treat an unmeasured dependency score as a measured zero", () => {
    const unmeasured = weightedOverall({
      naming: 100,
      modernity: 0,
      hygiene: 0,
      configCoherence: 0,
      dependencyFreshness: null,
    });
    const measuredZero = weightedOverall({
      naming: 100,
      modernity: 0,
      hygiene: 0,
      configCoherence: 0,
      dependencyFreshness: 0,
    });
    expect(unmeasured).toBeGreaterThan(measuredZero);
  });
});
