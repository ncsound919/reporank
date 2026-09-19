import { describe, it, expect } from "vitest";
import { computeStructuralIndex } from "../analyzers/structural-index";
import { runDeepAnalysis } from "../analyzers/run-deep-analysis";
import { gradeRepoStatic } from "../static-grade";
import type { AnalysisResult } from "../analyzers/aggregator";
import type { GradeInput } from "../index";

function emptyResult(): AnalysisResult {
  return {
    complexity: {
      hotSpots: [],
      fileSizeDistribution: { small: 0, medium: 0, large: 0, xlarge: 0 },
      longestFiles: [],
      worstFiles: [],
      cohesionViolations: [],
      summary: "clean",
    },
    dependencies: { findings: [], totalDeps: 0, devDeps: 0, depHealthScore: 100, unusedPatterns: [], summary: "clean" },
    architecture: { findings: [], directoryBreakdown: [], recommendedStructure: "", summary: "clean" },
    production: { findings: [], deployBlockers: [], overallReadiness: "ready", summary: "clean" },
    codeHygiene: { findings: [], totalCount: 0, categoriesFound: [], score: 100, summary: "clean" },
    enterprise: {
      apiContract: { findings: [], apiSurface: [], consistencyScore: 100, seniorSummary: "" },
      observability: { findings: [], observabilityScore: 100, seniorSummary: "" },
      buildCI: { findings: [], ciScore: 100, seniorSummary: "" },
      coupling: { findings: [], couplingScore: 100, seniorSummary: "" },
      license: { findings: [], licenseScore: 100, seniorSummary: "" },
      longTermDebt: { findings: [], debtScore: 100, seniorSummary: "" },
      overallSeniorScore: 100,
      criticalBlockers: [],
      seniorSummary: "",
      rawPromptBlock: "",
    },
  };
}

function withHotspot(filePath: string, severity: "critical" | "high" | "medium" | "low"): AnalysisResult {
  const base = emptyResult();
  return {
    ...base,
    complexity: {
      ...base.complexity,
      hotSpots: [{ filePath, size: 5000, lines: 700, concern: "god-file", severity, detail: `${filePath} too large` }],
    },
  };
}

function gradeInput(fileCount: number): GradeInput {
  const sourceFiles = Array.from({ length: fileCount }, (_, i) => ({
    path: `src/file-${i}.ts`,
    content: "export const x = 1;\n",
  }));
  return {
    repoUrl: "local",
    repoName: "r",
    repoOwner: "o",
    mainLanguage: "TypeScript",
    starsCount: 0,
    forksCount: 0,
    openIssuesCount: 0,
    lastPushedAt: new Date().toISOString(),
    readmeContent: "",
    packageJson: "{}",
    fileTree: sourceFiles.map((f) => f.path),
    sourceFiles,
  };
}

describe("computeStructuralIndex — no-inflation regression", () => {
  it("does not improve when only the file count grows (same findings)", () => {
    const one = withHotspot("src/a.ts", "high");
    const oneIndex = computeStructuralIndex(one, { mainLanguage: "TypeScript", totalLoc: 10 });

    // Same finding, but the repo now has many more (clean) files/LOC.
    const manyIndex = computeStructuralIndex(one, { mainLanguage: "TypeScript", totalLoc: 500_000 });
    expect(manyIndex.index).toBe(oneIndex.index);
  });

  it("gradeRepoStatic does not raise the index when only clean files are added", () => {
    const one = gradeInput(1);
    const many = gradeInput(40);
    const deepOne = runDeepAnalysis(null, one.fileTree, one.sourceFiles, one.packageJson);
    // Identical analyzer findings, only the repo's file count / LOC differs.
    const oneIndex = gradeRepoStatic(one, { ...deepOne }).index;
    const manyIndex = gradeRepoStatic(many, { ...deepOne }).index;
    expect(manyIndex).toBeLessThanOrEqual(oneIndex);
    expect(manyIndex).toBe(oneIndex);
  });

  it("duplicating the same finding across more files can only lower the index", () => {
    const base = emptyResult();
    const oneFile = { ...base };
    oneFile.complexity = {
      ...base.complexity,
      hotSpots: [
        { filePath: "src/a.ts", size: 5000, lines: 700, concern: "god-file", severity: "high", detail: "too large" },
      ],
    };
    const duplicated: AnalysisResult = {
      ...base,
      complexity: {
        ...base.complexity,
        hotSpots: Array.from({ length: 10 }, (_, i) => ({
          filePath: `src/file-${i}.ts`,
          size: 5000,
          lines: 700,
          concern: "god-file" as const,
          severity: "high" as const,
          detail: "too large",
        })),
      },
    };
    expect(computeStructuralIndex(duplicated, {}).index).toBeLessThanOrEqual(
      computeStructuralIndex(oneFile, {}).index,
    );
  });

  it("is deterministic across identical gradeRepoStatic invocations", () => {
    const input = gradeInput(3);
    const deep = runDeepAnalysis(null, input.fileTree, input.sourceFiles, input.packageJson);
    const a = gradeRepoStatic(input, { ...deep });
    const b = gradeRepoStatic(input, { ...deep });
    expect(a.index).toBe(b.index);
    expect(a.decomposition).toEqual(b.decomposition);
  });
});

describe("computeStructuralIndex — decomposition", () => {
  it("emits per-dimension contributions with the findings behind each score", () => {
    const result = withHotspot("src/a.ts", "high");
    const index = computeStructuralIndex(result, { mainLanguage: "TypeScript" });

    const complexity = index.contributions.find((c) => c.dimension === "complexity");
    expect(complexity).toBeDefined();
    expect(typeof complexity!.score).toBe("number");
    expect(typeof complexity!.weight).toBe("number");
    expect(complexity!.findings).toHaveLength(1);
    expect(complexity!.findings[0]).toMatchObject({
      file: "src/a.ts",
      severity: "high",
      reason: "src/a.ts too large",
    });
    expect(complexity!.findings[0].weight).toBeGreaterThan(0);

    for (const contribution of index.contributions) {
      expect(contribution).toEqual(
        expect.objectContaining({
          dimension: expect.any(String),
          score: expect.any(Number),
          weight: expect.any(Number),
          raw: expect.any(Number),
          baseline: expect.any(Number),
          findings: expect.any(Array),
        }),
      );
    }

    const weightSum = index.contributions.reduce((s, c) => s + c.weight, 0);
    expect(weightSum).toBeCloseTo(1, 2);
  });

  it("penalises proportionally to severity mass", () => {
    const low = computeStructuralIndex(withHotspot("src/a.ts", "low"), {}).index;
    const high = computeStructuralIndex(withHotspot("src/a.ts", "high"), {}).index;
    expect(high).toBeLessThan(low);
  });

  it("excludes unmeasured dimensions and renormalises weights", () => {
    const index = computeStructuralIndex(emptyResult(), {});
    expect(index.unmeasured).toContain("security");
    expect(index.unmeasured).toContain("structure");
    expect(index.contributions.some((c) => c.dimension === "security")).toBe(false);
    expect(index.contributions.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 2);
  });
});

describe("computeStructuralIndex — cohort normalization", () => {
  it("labels a size/language cohort and scales its baseline", () => {
    const small = computeStructuralIndex(emptyResult(), { mainLanguage: "TypeScript", totalLoc: 1_000 });
    const large = computeStructuralIndex(emptyResult(), { mainLanguage: "TypeScript", totalLoc: 1_000_000 });
    expect(small.normalization.cohort).toBe("typescript:xs");
    expect(large.normalization.cohort).toBe("typescript:xl");
    expect(large.normalization.baseline).toBeGreaterThan(small.normalization.baseline);
    for (const n of [small.normalization, large.normalization]) {
      expect(n.normalizedIndex).toBeGreaterThanOrEqual(0);
      expect(n.normalizedIndex).toBeLessThanOrEqual(100);
    }
  });
});
