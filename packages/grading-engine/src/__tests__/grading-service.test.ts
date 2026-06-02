import { describe, it, expect, vi } from "vitest";

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: vi.fn().mockResolvedValue({
        text: JSON.stringify({
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
      }),
    },
  })),
}));

import { GradingService } from "../index";

describe("GradingService", () => {
  const service = new GradingService("fake-api-key", "gemini-2.5-flash");

  it("grades a repo and returns a HealthReport", async () => {
    const input = {
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

    const report = await service.gradeRepo(input);
    expect(report.overallScore).toBe(75);
    expect(report.gradeCategory).toBe("B");
    expect(report.repoOwner).toBe("test");
    expect(report.repoName).toBe("repo");
    expect(report.scannedAt).toBeTruthy();
  });

  it("includes scanner results when provided", async () => {
    const input = {
      repoUrl: "https://github.com/test/repo",
      repoName: "repo",
      repoOwner: "test",
      mainLanguage: "TypeScript",
      starsCount: 0,
      forksCount: 0,
      openIssuesCount: 0,
      lastPushedAt: "2026-01-01",
      readmeContent: "",
      packageJson: "{}",
      fileTree: [],
      sourceFiles: [],
    };

    const report = await service.gradeRepo(input, { semgrep: [{ checkId: "test" }] });
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
  });

  it("dispose clears the ai instance", () => {
    expect(async () => { await service.dispose(); }).not.toThrow();
  });
});
