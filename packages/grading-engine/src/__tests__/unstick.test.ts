import { describe, it, expect } from "vitest";
import { generateUnstickPlan } from "../analyzers/unstick";

describe("generateUnstickPlan", () => {
  const baseReport = {
    overallScore: 65,
    dimensionScores: { security: 60, quality: 60, vibe: 60, architecture: 60, deployment: 60, documentation: 60, license: 60, market: 60 },
    quickWins: [],
    bugsAndLeaks: [],
    structuralSmells: [],
    hallucinatedFeatures: [],
    reportVibe: { overall: 60, recommendations: [] },
    deployment: { hasDockerfile: false, hasCIConfig: false, hasEnvExample: false, score: 50 },
    license: { hasLicenseFile: false, score: 50 },
    security: { secretsFound: 0, score: 60 },
  };

  it("prioritizes license as deploy blocker", () => {
    const result = generateUnstickPlan(
      baseReport.overallScore, baseReport.dimensionScores,
      baseReport.quickWins, baseReport.bugsAndLeaks,
      baseReport.structuralSmells, baseReport.hallucinatedFeatures,
      baseReport.reportVibe, baseReport.deployment,
      { hasLicenseFile: false, score: 50 },
      { secretsFound: 0, score: 60 }, false
    );
    expect(result.blockers.some(b => b.title.includes("license"))).toBe(true);
  });

  it("prioritizes exposed secrets as safety risk", () => {
    const result = generateUnstickPlan(
      baseReport.overallScore, baseReport.dimensionScores,
      baseReport.quickWins, baseReport.bugsAndLeaks,
      baseReport.structuralSmells, baseReport.hallucinatedFeatures,
      baseReport.reportVibe, baseReport.deployment,
      { hasLicenseFile: true, score: 100 },
      { secretsFound: 3, score: 40 }, false
    );
    expect(result.blockers.some(b => b.title.includes("secret"))).toBe(true);
  });

  it("flags missing CI as deploy blocker", () => {
    const result = generateUnstickPlan(
      baseReport.overallScore, baseReport.dimensionScores,
      baseReport.quickWins, baseReport.bugsAndLeaks,
      baseReport.structuralSmells, baseReport.hallucinatedFeatures,
      baseReport.reportVibe, { hasDockerfile: false, hasCIConfig: false, hasEnvExample: false, score: 50 },
      { hasLicenseFile: true, score: 100 },
      { secretsFound: 0, score: 60 }, false
    );
    expect(result.blockers.some(b => b.title.includes("CI"))).toBe(true);
  });

  it("generates sequential plan", () => {
    const result = generateUnstickPlan(
      baseReport.overallScore, baseReport.dimensionScores,
      baseReport.quickWins, baseReport.bugsAndLeaks,
      baseReport.structuralSmells, baseReport.hallucinatedFeatures,
      baseReport.reportVibe, baseReport.deployment,
      { hasLicenseFile: false, score: 50 },
      { secretsFound: 3, score: 40 }, false
    );
    expect(result.sequence.length).toBeGreaterThan(0);
  });

  it("identifies top priority", () => {
    const result = generateUnstickPlan(
      baseReport.overallScore, baseReport.dimensionScores,
      baseReport.quickWins, baseReport.bugsAndLeaks,
      baseReport.structuralSmells, baseReport.hallucinatedFeatures,
      baseReport.reportVibe, baseReport.deployment,
      { hasLicenseFile: false, score: 50 },
      { secretsFound: 3, score: 40 }, false
    );
    expect(typeof result.topPriority).toBe("string");
    expect(result.topPriority.length).toBeGreaterThan(0);
  });

  it("returns quickest win", () => {
    const result = generateUnstickPlan(
      65, { security: 60, quality: 60, vibe: 60, architecture: 60, deployment: 60, documentation: 60, license: 60, market: 60 },
      [{ severity: "critical", title: "Fix secrets", category: "Security", effort: "hours", description: "desc", action: "action" }],
      [], [], [], { overall: 60, recommendations: [] },
      { hasDockerfile: false, hasCIConfig: false, hasEnvExample: false, score: 50 },
      { hasLicenseFile: false, score: 50 },
      { secretsFound: 3, score: 40 }, false
    );
    expect(typeof result.quickestWin).toBe("string");
  });

  it("returns summary", () => {
    const result = generateUnstickPlan(
      baseReport.overallScore, baseReport.dimensionScores,
      baseReport.quickWins, baseReport.bugsAndLeaks,
      baseReport.structuralSmells, baseReport.hallucinatedFeatures,
      baseReport.reportVibe, baseReport.deployment,
      { hasLicenseFile: false, score: 50 },
      { secretsFound: 0, score: 60 }, false
    );
    expect(typeof result.summary).toBe("string");
  });
});
