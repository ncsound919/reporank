import { describe, it, expect } from "vitest";
import type { HealthReport } from "@reporank/shared-types";
import { applyGradingProvenance, applyFabricationGuards, findStaleCitations } from "../provenance";

function report(over: Partial<HealthReport> = {}): HealthReport {
  return {
    repoOwner: "acme",
    repoName: "widget",
    overallScore: 88,
    gradeCategory: "B",
    maturityLevel: "Beta",
    mainLanguage: "TypeScript",
    starsCount: 10,
    forksCount: 2,
    openIssuesCount: 1,
    lastPushedAt: "2026-01-01",
    summary: "s",
    dimensionScores: { security: 80, quality: 80, vibe: 80, architecture: 80, deployment: 80, documentation: 80, license: 80, market: 80 },
    security: { secretsFound: 0, secretsCritical: 0, vulnerabilityCount: 0, highestSeverity: "none", vulnerabilities: [], dependencyCves: 0, hasSastScan: false, score: 80 },
    quality: { readmeScore: 80, testFramework: null, testFileCount: 0, codeSmells: 0, duplicationPercent: 0, hasLintConfig: false, hasCiConfig: false, score: 80 },
    vibe: { overall: 80, namingScore: 80, modernityScore: 80, hygieneScore: 80, configCoherence: 80, dependencyFreshness: 80, recommendations: [] },
    vibeCodingIndex: { overallScore: 0, knownHumanScore: 0, signalCount: 0, fileCount: 0, summary: "" },
    architecture: { couplingScore: 80, circularImportsCount: 0, complexityRating: "low", fileCount: 10, avgFileLength: 50, score: 80 },
    deployment: { hasDockerfile: false, dockerfileScore: 0, hasCIConfig: false, hasEnvExample: false, hasHealthcheck: false, hasLogging: false, loggingFramework: null, score: 80 },
    documentation: { readmeCompleteness: 80, hasSetupInstructions: false, hasApiDocs: false, hasArchitectureDiagram: false, hasContributingGuide: false, hasLicenseFile: false, score: 80 },
    license: { licenseType: "MIT", isCopyleft: false, licenseConflicts: [], hasLicenseFile: false, score: 80 },
    market: { trendAlignment: "rising", percentileRank: 94, competitorCount: 12, recentActivity: "active", score: 80 },
    valuation: { replacementCostFMV: 1_500_000, reliefFromRoyaltyValue: 400_000, productivityWasteHeuristic: 90_000 },
    hallucinatedFeatures: [],
    bugsAndLeaks: [],
    structuralSmells: [],
    quickWins: [],
    roadmap: [],
    implementationPlan: [],
    globalBenchmarkPercent: 87,
    scannedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("applyFabricationGuards", () => {
  it("neutralizes valuation, percentile, competitor count and global benchmark", () => {
    const r = report();
    applyFabricationGuards(r, {});
    expect(r.valuation).toEqual({ replacementCostFMV: 0, reliefFromRoyaltyValue: 0, productivityWasteHeuristic: 0 });
    expect(r.market.percentileRank).toBe(0);
    expect(r.market.competitorCount).toBe(0);
    expect(r.globalBenchmarkPercent).toBe(0);
  });

  it("measures hasLicenseFile from the tree but neutralizes the license type without a scanner", () => {
    const r = report();
    applyFabricationGuards(r, { fileTree: ["LICENSE", "src/index.ts"] });
    expect(r.license.hasLicenseFile).toBe(true);
    expect(r.license.licenseType).toBeNull();
    expect(r.license.isCopyleft).toBe(false);
  });

  it("keeps a scanner-derived license block when a dependency analyzer ran", () => {
    const r = report();
    applyFabricationGuards(r, { scanners: { dependencies: { total: 3 } }, fileTree: ["LICENSE"] });
    expect(r.license.licenseType).toBe("MIT");
    expect(r.license.hasLicenseFile).toBe(true);
  });
});

describe("buildFieldProvenance (via applyGradingProvenance)", () => {
  it("labels the headline score unmeasured and security unavailable with no scanner", () => {
    const r = report();
    applyGradingProvenance(r, {});
    expect(r.fieldProvenance?.overallScore.measured).toBe(false);
    expect(r.fieldProvenance?.overallScore.reason).toMatch(/model/i);
    expect(r.fieldProvenance?.security).toMatchObject({ measured: false, basis: "unavailable" });
    expect(r.fieldProvenance?.valuation.measured).toBe(false);
    expect(r.fieldProvenance?.valuation.reason).toBeTruthy();
  });

  it("marks security measured when a real scanner ran", () => {
    const r = report();
    applyGradingProvenance(r, { scanners: { semgrep: [{ checkId: "x" }] } });
    expect(r.fieldProvenance?.security).toMatchObject({ measured: true, source: "analyzers" });
  });
});

describe("findStaleCitations", () => {
  it("flags model citations whose file is not in the tree, without deleting them", () => {
    const r = report({ bugsAndLeaks: ["Null deref in src/gone.ts:42", "Off-by-one in src/real.ts:5"] });
    applyGradingProvenance(r, { fileTree: ["src/real.ts"] });
    expect(r.staleCitations?.map((s) => s.citation)).toEqual(["src/gone.ts:42"]);
    // The original string is retained — the guard reports, it does not hide.
    expect(r.bugsAndLeaks).toContain("Null deref in src/gone.ts:42");
  });

  it("matches by basename so a bare filename citation is not a false positive", () => {
    const r = report({ bugsAndLeaks: ["Bug in index.ts:1"] });
    applyGradingProvenance(r, { fileTree: ["src/index.ts"] });
    expect(r.staleCitations).toBeUndefined();
  });

  it("flags a quickWin with an unknown filePath", () => {
    const r = report({ quickWins: [{ title: "t", severity: "low", category: "c", effort: "hours", description: "d", action: "a", filePath: "src/nope.ts" }] });
    applyGradingProvenance(r, { fileTree: ["src/real.ts"] });
    expect(r.staleCitations?.[0]).toMatchObject({ field: "quickWins.filePath", citation: "src/nope.ts" });
  });

  it("makes no stale claim when no tree is available to verify against", () => {
    const r = report({ bugsAndLeaks: ["Bug in src/gone.ts:42"] });
    const stale = findStaleCitations(r, {});
    expect(stale).toEqual([]);
  });
});
