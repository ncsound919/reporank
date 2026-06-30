import { describe, it, expect } from "vitest";
import { mapSemgrepSeverityToWeight, buildConfigFlags } from "../scanners/semgrep";

describe("security score calculation with weighted findings", () => {
  /** Compute a security score from weighted semgrep findings (0-100). */
  function computeSecurityScore(
    findings: { severity: string; weight: number }[],
    repoSize: number = 1000
  ): number {
    if (findings.length === 0) return 100;

    const totalWeight = findings.reduce((s, f) => s + f.weight, 0);
    const density = totalWeight / Math.max(repoSize, 1);

    const score = Math.round(Math.max(0, 100 - density * 100));
    return score;
  }

  it("returns 100 when no findings", () => {
    expect(computeSecurityScore([])).toBe(100);
  });

  it("reduces score for ERROR findings", () => {
    const findings = [{ severity: "ERROR", weight: 0.9 }];
    expect(computeSecurityScore(findings, 10)).toBeLessThan(100);
  });

  it("WARNING findings penalize less than ERROR", () => {
    const errorScore = computeSecurityScore(
      [{ severity: "ERROR", weight: 0.9 }],
      10
    );
    const warnScore = computeSecurityScore(
      [{ severity: "WARNING", weight: 0.6 }],
      10
    );
    expect(warnScore).toBeGreaterThan(errorScore);
  });

  it("INFO findings penalize least", () => {
    const errorScore = computeSecurityScore(
      [{ severity: "ERROR", weight: 0.9 }],
      10
    );
    const infoScore = computeSecurityScore(
      [{ severity: "INFO", weight: 0.3 }],
      10
    );
    expect(infoScore).toBeGreaterThan(errorScore);
  });

  it("handles mixed severities appropriately", () => {
    const findings = [
      { severity: "ERROR", weight: 0.9 },
      { severity: "WARNING", weight: 0.6 },
      { severity: "INFO", weight: 0.3 },
    ];
    const score = computeSecurityScore(findings, 30);
    expect(score).toBeGreaterThan(80);
    expect(score).toBeLessThan(100);
  });

  it("scales score with repo size (same findings, larger codebase → higher score)", () => {
    const findings = [
      { severity: "ERROR", weight: 0.9 },
    ];
    const smallScore = computeSecurityScore(findings, 10);
    const largeScore = computeSecurityScore(findings, 10000);
    expect(largeScore).toBeGreaterThan(smallScore);
  });

  it("mapSemgrepSeverityToWeight returns correct values", () => {
    expect(mapSemgrepSeverityToWeight("ERROR")).toBe(0.9);
    expect(mapSemgrepSeverityToWeight("WARNING")).toBe(0.6);
    expect(mapSemgrepSeverityToWeight("INFO")).toBe(0.3);
  });

  it("buildConfigFlags works for typescript projects", () => {
    const flags = buildConfigFlags(["typescript"]);
    expect(flags).toContain("p/typescript");
    expect(flags).toContain("p/secrets");
    expect(flags).toContain("p/owasp-top-ten");
  });
});
