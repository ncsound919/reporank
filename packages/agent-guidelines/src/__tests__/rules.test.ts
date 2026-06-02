import { describe, it, expect } from "vitest";
import { getRulesForAnalysis, getRulesForMode, getRuleById } from "../rules";

describe("getRulesForAnalysis", () => {
  const baseAnalysis = {
    vibeCodingScore: 10,
    securityIssues: 0,
    aiGeneratedPatterns: 0,
    hasTests: true,
    hasLicense: true,
    hasCI: true,
    hasDockerfile: false,
    fileCount: 50,
    languages: ["TypeScript"],
    teamSize: 3,
    isEducation: false,
    framework: "express",
  };

  it("returns rules applicable to the analysis", () => {
    const rules = getRulesForAnalysis(baseAnalysis);
    expect(rules.length).toBeGreaterThan(0);
    rules.forEach(r => {
      expect(r.id).toBeTruthy();
      expect(r.severity).toMatch(/must|should|may/);
    });
  });

  it("includes security rules when issues exist", () => {
    const analysis = { ...baseAnalysis, securityIssues: 5 };
    const rules = getRulesForAnalysis(analysis);
    expect(rules.some(r => r.id === "no-secrets-in-code")).toBe(true);
  });

  it("includes education rules when isEducation is true", () => {
    const analysis = { ...baseAnalysis, isEducation: true };
    const rules = getRulesForAnalysis(analysis);
    expect(rules.some(r => r.id === "agent-never-writes-code")).toBe(true);
  });

  it("excludes conditional rules when conditions aren't met", () => {
    const rules = getRulesForAnalysis(baseAnalysis);
    expect(rules.some(r => r.id === "no-secrets-in-code")).toBe(false);
  });

  it("includes type annotation rules for TypeScript projects", () => {
    const rules = getRulesForAnalysis(baseAnalysis);
    expect(rules.some(r => r.id === "type-annotations")).toBe(true);
  });
});

describe("getRulesForMode", () => {
  const analysis = {
    vibeCodingScore: 50,
    securityIssues: 3,
    aiGeneratedPatterns: 5,
    hasTests: false,
    hasLicense: false,
    hasCI: false,
    hasDockerfile: false,
    fileCount: 100,
    languages: ["TypeScript", "Python"],
    teamSize: 5,
    isEducation: true,
    framework: "react",
  };

  it("minimal mode returns fewer rules", () => {
    const minimal = getRulesForMode("minimal", analysis);
    const standard = getRulesForMode("standard", analysis);
    expect(minimal.length).toBeLessThanOrEqual(standard.length);
  });

  it("comprehensive mode returns rules", () => {
    const comprehensive = getRulesForMode("comprehensive", analysis);
    expect(comprehensive.length).toBeGreaterThanOrEqual(5);
  });

  it("all modes return valid rules", () => {
    for (const mode of ["minimal", "standard", "comprehensive"] as const) {
      const rules = getRulesForMode(mode, analysis);
      rules.forEach(r => {
        expect(r.modes).toContain(mode);
      });
    }
  });
});

describe("getRuleById", () => {
  it("returns rule for valid ID", () => {
    const rule = getRuleById("no-eval");
    expect(rule).toBeDefined();
    expect(rule!.id).toBe("no-eval");
  });

  it("returns undefined for invalid ID", () => {
    const rule = getRuleById("nonexistent-rule");
    expect(rule).toBeUndefined();
  });
});
