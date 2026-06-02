import { describe, it, expect } from "vitest";
import { parseHealthReport } from "../responseParser";

describe("parseHealthReport", () => {
  it("parses valid report from JSON string", () => {
    const raw = JSON.stringify({
      overallScore: 75,
      gradeCategory: "C",
      maturityLevel: "Beta",
      summary: "Good project.",
      dimensionScores: { security: 80, quality: 70, vibe: 65, architecture: 75, deployment: 60, documentation: 50, license: 40, market: 55 },
      security: { secretsFound: 0, vulnerabilityCount: 1, highestSeverity: "medium", vulnerabilities: [{ id: "1", severity: "medium", title: "XSS", description: "desc", recommendation: "fix" }], score: 80 },
      quality: { readmeScore: 60, testFramework: null, codeSmells: 5, duplicationPercent: 2, score: 70 },
      vibe: { overall: 65, recommendations: ["Use TypeScript"] },
      architecture: { score: 75, complexityRating: "medium", fileCount: 50 },
      deployment: { hasDockerfile: true, hasCIConfig: true, hasEnvExample: true, score: 60 },
      documentation: { readmeCompleteness: 50, score: 50 },
      license: { licenseType: "MIT", isCopyleft: false, score: 40 },
      market: { trendAlignment: "steady", percentileRank: 50, score: 55 },
      hallucinatedFeatures: [],
      bugsAndLeaks: [],
      structuralSmells: ["mixed concerns"],
      quickWins: [{ title: "Add license", severity: "high", category: "legal", effort: "minutes", description: "No license", action: "Add MIT" }],
      roadmap: [{ phase: "now", priority: 1, category: "legal", task: "Add license", effort: "hours" }],
      implementationPlan: [{ title: "Add License", description: "desc", targetFiles: ["LICENSE"], promptInstruction: "Create MIT" }],
      globalBenchmarkPercent: 40,
    });

    const result = parseHealthReport(raw);
    expect(result.overallScore).toBe(75);
    expect(result.gradeCategory).toBe("C");
    expect(result.maturityLevel).toBe("Beta");
    expect(result.dimensionScores.security).toBe(80);
    expect(result.quality.codeSmells).toBe(5);
    expect(result.security.vulnerabilities).toHaveLength(1);
    expect(result.quickWins).toHaveLength(1);
  });

  it("fills missing fields with defaults", () => {
    const raw = JSON.stringify({ overallScore: 50, gradeCategory: "C", maturityLevel: "MVP", summary: "test" });
    const result = parseHealthReport(raw);
    expect(result.dimensionScores).toBeDefined();
    expect(result.security.score).toBeDefined();
    expect(result.quality.score).toBeDefined();
    expect(result.vibe.overall).toBeDefined();
    expect(result.architecture.score).toBeDefined();
  });

  it("extracts JSON from markdown-wrapped response", () => {
    const raw = 'Here is your report:\n```json\n{"overallScore": 85, "gradeCategory": "B+", "maturityLevel": "Beta", "summary": "solid"}\n```';
    const result = parseHealthReport(raw);
    expect(result.overallScore).toBe(85);
  });

  it("throws on non-JSON response", () => {
    expect(() => parseHealthReport("No JSON here")).toThrow("No valid JSON found");
  });
});
