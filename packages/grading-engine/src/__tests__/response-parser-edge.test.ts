import { describe, it, expect } from "vitest";
import { parseHealthReport } from "../responseParser";

describe("parseHealthReport", () => {
  it("parses valid JSON from raw text", () => {
    const raw = JSON.stringify({ overallScore: 85, gradeCategory: "B+", maturityLevel: "Production", summary: "Good codebase." });
    const result = parseHealthReport(raw);
    expect(result.overallScore).toBe(85);
    expect(result.gradeCategory).toBe("B+");
  });

  it("extracts JSON from text with surrounding content", () => {
    const raw = "Here is the result:\n```json\n{\"overallScore\": 72, \"gradeCategory\": \"B\", \"maturityLevel\": \"Beta\", \"summary\": \"Decent.\"}\n```\nEnd.";
    const result = parseHealthReport(raw);
    expect(result.overallScore).toBe(72);
  });

  it("fills missing fields with defaults", () => {
    const raw = JSON.stringify({ overallScore: 50 });
    const result = parseHealthReport(raw);
    expect(result.gradeCategory).toBe("C");
    expect(result.maturityLevel).toBe("Prototype");
    expect(result.summary).toBeTruthy();
    expect(result.dimensionScores).toBeDefined();
    expect(result.security).toBeDefined();
    expect(result.quality).toBeDefined();
    expect(result.vibe).toBeDefined();
  });

  it("parses complete health report", () => {
    const report = {
      overallScore: 92, gradeCategory: "A", maturityLevel: "Production",
      summary: "Excellent codebase with minor issues.",
      dimensionScores: { security: 85, quality: 90, vibe: 88, architecture: 85, deployment: 80, documentation: 75, license: 100, market: 70 },
      security: { secretsFound: 0, vulnerabilityCount: 2, highestSeverity: "medium", vulnerabilities: [{ id: "CVE-1", severity: "medium", title: "XSS", description: "XSS vuln", cveId: "CVE-1", recommendation: "Sanitize" }], score: 80 },
      quality: { readmeScore: 80, testFramework: "vitest", codeSmells: 3, duplicationPercent: 5, score: 85 },
      vibe: { overall: 88, recommendations: ["Add more tests"] },
    };
    const raw = JSON.stringify(report);
    const result = parseHealthReport(raw);
    expect(result.overallScore).toBe(92);
    expect(result.dimensionScores.security).toBe(85);
    expect(result.security.vulnerabilities[0].cveId).toBe("CVE-1");
  });

  it("handles malformed JSON gracefully", () => {
    const raw = "not json at all";
    expect(() => parseHealthReport(raw)).toThrow("No valid JSON found");
  });

  it("handles empty string", () => {
    expect(() => parseHealthReport("")).toThrow("No valid JSON found");
  });

  it("defaults array fields when missing", () => {
    const raw = JSON.stringify({ overallScore: 60, gradeCategory: "C", maturityLevel: "MVP", summary: "Ok." });
    const result = parseHealthReport(raw);
    expect(result.hallucinatedFeatures).toEqual([]);
    expect(result.bugsAndLeaks).toEqual([]);
    expect(result.structuralSmells).toEqual([]);
    expect(result.quickWins).toEqual([]);
    expect(result.roadmap).toEqual([]);
    expect(result.implementationPlan).toEqual([]);
  });

  it("handles partial dimension scores", () => {
    const raw = JSON.stringify({ overallScore: 70, gradeCategory: "B", maturityLevel: "Beta", summary: "Good.", dimensionScores: { security: 80 } });
    const result = parseHealthReport(raw);
    expect(result.dimensionScores.security).toBe(80);
    expect(result.dimensionScores.quality).toBe(50); // default
  });

  it("handles numeric edge cases", () => {
    const raw = JSON.stringify({ overallScore: 0, gradeCategory: "F", maturityLevel: "Prototype", summary: "Bad." });
    const result = parseHealthReport(raw);
    expect(result.overallScore).toBe(0);
  });

  it("processes quick wins correctly", () => {
    const raw = JSON.stringify({
      overallScore: 70, gradeCategory: "B", maturityLevel: "Beta", summary: "Good.",
      quickWins: [{ title: "Fix null safety", severity: "high", category: "Security", effort: "hours", description: "desc", action: "action" }],
    });
    const result = parseHealthReport(raw);
    expect(result.quickWins.length).toBe(1);
    expect(result.quickWins[0].title).toBe("Fix null safety");
  });

  it("processes roadmap items correctly", () => {
    const raw = JSON.stringify({
      overallScore: 70, gradeCategory: "B", maturityLevel: "Beta", summary: "Good.",
      roadmap: [{ phase: "now", priority: 1, category: "Security", task: "Fix secrets", effort: "hours" }],
    });
    const result = parseHealthReport(raw);
    expect(result.roadmap.length).toBe(1);
    expect(result.roadmap[0].task).toBe("Fix secrets");
  });

  it("finds the first valid JSON in concatenated text", () => {
    const raw = 'Some text before {"overallScore": 45, "gradeCategory": "D", "maturityLevel": "MVP", "summary": "Needs work."} and text after';
    const result = parseHealthReport(raw);
    expect(result.overallScore).toBe(45);
  });

  it("validates enum fields", () => {
    const raw = JSON.stringify({ overallScore: 80, gradeCategory: "A+", maturityLevel: "Enterprise", summary: "Top tier." });
    const result = parseHealthReport(raw);
    expect(result.gradeCategory).toBe("A+");
    expect(result.maturityLevel).toBe("Enterprise");
  });

  it("extracts deployment fields", () => {
    const raw = JSON.stringify({ overallScore: 60, gradeCategory: "C", maturityLevel: "Beta", summary: "OK.", deployment: { hasDockerfile: true, hasCIConfig: true, score: 70 } });
    const result = parseHealthReport(raw);
    expect(result.deployment.hasDockerfile).toBe(true);
    expect(result.deployment.score).toBe(70);
  });

  it("handles null values gracefully", () => {
    const raw = JSON.stringify({ overallScore: 50, gradeCategory: "C", maturityLevel: "MVP", summary: "OK.", quality: { testFramework: null } });
    const result = parseHealthReport(raw);
    expect(result.quality.testFramework).toBeNull();
  });
});
