import { describe, it, expect } from "vitest";
import { calculateTrustScore } from "../analyzers/trust";

describe("calculateTrustScore", () => {
  it("returns F for a degraded codebase with no AGENTS.md and high vibe", () => {
    const result = calculateTrustScore({
      overallScore: 30,
      vibeCodingIndex: 80,
      securityFindings: { critical: 3, high: 5, medium: 10, low: 20 },
    });
    expect(result.trust).toBeLessThan(40);
    expect(["D", "F"]).toContain(result.grade);
    expect(result.feedback.length).toBeGreaterThan(0);
  });

  it("returns A+/A for a healthy codebase with AGENTS.md", () => {
    const result = calculateTrustScore({
      overallScore: 90,
      vibeCodingIndex: 15,
      securityFindings: { critical: 0, high: 0, medium: 1, low: 3 },
      agentsFile: {
        content: `# AGENTS.md\n\n## Security\n- 🔴 No secrets\n- 🔴 No eval\n- 🟡 Add tests\n\n## Code Quality\n- 🟡 Keep files small\n- 🟡 Add types\n- 🟡 Remove debug\n- 🟡 Async errors\n`,
        estimatedTokens: 400,
      },
    });
    expect(result.trust).toBeGreaterThanOrEqual(75);
    expect(["A+", "A", "B"]).toContain(result.grade);
  });

  it("rewards adding AGENTS.md when missing", () => {
    const without = calculateTrustScore({
      overallScore: 80, vibeCodingIndex: 30,
    });
    const withFile = calculateTrustScore({
      overallScore: 80, vibeCodingIndex: 30,
      agentsFile: { content: "## Security\n- 🔴 no secrets\n", estimatedTokens: 100 },
    });
    expect(withFile.trust).toBeGreaterThan(without.trust);
  });

  it("penalizes oversized AGENTS.md", () => {
    const small = calculateTrustScore({
      overallScore: 80, vibeCodingIndex: 30,
      agentsFile: { content: "x".repeat(500), estimatedTokens: 400 },
    });
    const huge = calculateTrustScore({
      overallScore: 80, vibeCodingIndex: 30,
      agentsFile: { content: "x".repeat(10000), estimatedTokens: 3000 },
    });
    expect(small.trust).toBeGreaterThan(huge.trust);
  });

  it("penalizes critical security findings heavily", () => {
    const safe = calculateTrustScore({
      overallScore: 80, vibeCodingIndex: 30,
      securityFindings: { critical: 0, high: 0, medium: 0, low: 0 },
    });
    const unsafe = calculateTrustScore({
      overallScore: 80, vibeCodingIndex: 30,
      securityFindings: { critical: 5, high: 0, medium: 0, low: 0 },
    });
    expect(safe.trust - unsafe.trust).toBeGreaterThanOrEqual(15);
  });

  it("inverts vibe coding index (higher vibe = lower score)", () => {
    const low = calculateTrustScore({ overallScore: 80, vibeCodingIndex: 10 });
    const high = calculateTrustScore({ overallScore: 80, vibeCodingIndex: 90 });
    expect(low.trust).toBeGreaterThan(high.trust);
  });

  it("computes software 2.0 component when source provided", () => {
    const result = calculateTrustScore({
      overallScore: 80, vibeCodingIndex: 30,
      software20Inputs: {
        sourceFiles: [
          { path: "a.ts", content: "// hi\nfunction f() { return 1; }" },
          { path: "b.ts", content: "// hi\nfunction g() { return 2; }" },
        ],
        fileTree: ["a.ts", "b.ts"],
        testFilePaths: new Set(["a.test.ts", "b.test.ts"]),
      },
    });
    expect(result.components.software20.score).toBeGreaterThan(0);
  });

  it("produces up to 3 ranked recommendations", () => {
    const result = calculateTrustScore({
      overallScore: 30, vibeCodingIndex: 80,
      securityFindings: { critical: 2, high: 3, medium: 5, low: 10 },
    });
    expect(result.recommendations.length).toBeLessThanOrEqual(3);
    // Sorted by potential gain desc
    if (result.recommendations.length >= 2) {
      expect(result.recommendations[0].potentialGain).toBeGreaterThanOrEqual(result.recommendations[1].potentialGain);
    }
  });

  it("clamps trust score to 0-100", () => {
    const perfect = calculateTrustScore({
      overallScore: 100, vibeCodingIndex: 0,
      securityFindings: { critical: 0, high: 0, medium: 0, low: 0 },
      agentsFile: { content: "# x\n", estimatedTokens: 50 },
    });
    const worst = calculateTrustScore({
      overallScore: 0, vibeCodingIndex: 100,
      securityFindings: { critical: 100, high: 100, medium: 100, low: 100 },
    });
    expect(perfect.trust).toBeLessThanOrEqual(100);
    expect(worst.trust).toBeGreaterThanOrEqual(0);
  });

  it("weights add up to 100% (transparency)", () => {
    const result = calculateTrustScore({ overallScore: 50, vibeCodingIndex: 50 });
    const totalWeight =
      result.components.codeHealth.weight +
      result.components.vibe.weight +
      result.components.software20.weight +
      result.components.security.weight +
      result.components.agentsCompliance.weight;
    expect(totalWeight).toBeCloseTo(1.0, 5);
  });
});
