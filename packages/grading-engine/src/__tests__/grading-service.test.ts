import { describe, it, expect, vi } from "vitest";

// The service moved off the per-agent @google/genai SDK onto the shared
// @overlay365/fleet-client chain. Mock that boundary instead, and construct the
// service with no arguments (keys resolve from the environment by the chain).
const { mockReportJson } = vi.hoisted(() => ({
  mockReportJson: JSON.stringify({
    overallScore: 75,
    gradeCategory: "B",
    maturityLevel: "Beta",
    summary: "Solid codebase with room for improvement.",
    dimensionScores: { security: 70, quality: 75, vibe: 80, architecture: 70, deployment: 65, documentation: 60, license: 100, market: 50 },
    security: { secretsFound: 0, vulnerabilityCount: 1, highestSeverity: "low", vulnerabilities: [], score: 70 },
    quality: { readmeScore: 60, testFramework: null, codeSmells: 5, duplicationPercent: 2, score: 75 },
    vibe: { overall: 80, recommendations: ["Add tests"] },
    architecture: { score: 70, complexityRating: "medium", fileCount: 10 },
    deployment: { hasDockerfile: false, hasCIConfig: false, hasEnvExample: true, score: 65 },
    documentation: { readmeCompleteness: 60, score: 60 },
    license: { licenseType: "MIT", isCopyleft: false, score: 100 },
    market: { trendAlignment: "steady", percentileRank: 50, score: 50 },
    hallucinatedFeatures: [],
    bugsAndLeaks: ["Possible null reference in service.ts:42"],
    structuralSmells: ["Mixed concerns in utils.ts"],
    quickWins: [{ title: "Fix null safety", severity: "high", category: "Reliability", effort: "hours", description: "desc", action: "action" }],
    roadmap: [{ phase: "now", priority: 1, category: "Security", task: "Add tests", effort: "days" }],
    implementationPlan: [],
    globalBenchmarkPercent: 50,
  }),
}));

vi.mock("@overlay365/fleet-client", () => ({
  callLLM: vi.fn().mockResolvedValue(mockReportJson),
}));

import { GradingService } from "../index";
import { callLLM } from "@overlay365/fleet-client";

const baseInput = {
  repoUrl: "https://github.com/test/repo",
  repoName: "repo",
  repoOwner: "test",
  mainLanguage: "TypeScript",
  starsCount: 42,
  forksCount: 7,
  openIssuesCount: 3,
  lastPushedAt: "2026-01-01",
  readmeContent: "# Test",
  packageJson: '{"name":"test"}',
  fileTree: ["src/index.ts"],
  sourceFiles: [{ path: "src/index.ts", content: "const x = 1;" }],
};

describe("GradingService", () => {
  const service = new GradingService();

  it("grades a repo and returns a HealthReport", async () => {
    const report = await service.gradeRepo(baseInput);
    expect(callLLM).toHaveBeenCalled();
    expect(report.overallScore).toBe(75);
    expect(report.gradeCategory).toBe("B");
    expect(report.repoOwner).toBe("test");
    expect(report.repoName).toBe("repo");
    expect(report.scannedAt).toBeTruthy();
  });

  it("includes scanner results when provided", async () => {
    const report = await service.gradeRepo(
      { ...baseInput, starsCount: 0, forksCount: 0, openIssuesCount: 0, readmeContent: "", packageJson: "{}", fileTree: [], sourceFiles: [] },
      { semgrep: [{ checkId: "test" }] },
    );
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
  });

  it("dispose resolves without throwing", async () => {
    await expect(service.dispose()).resolves.toBeUndefined();
  });
});
