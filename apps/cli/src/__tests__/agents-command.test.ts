import { describe, it, expect } from "vitest";
import { generateGuidelines, estimateContextWindowFit, parseExistingGuidelines, checkGuidelinesCompliance, getRulesForMode, type CodebaseAnalysis } from "@reporank/agent-guidelines";

const analysis: CodebaseAnalysis = {
  vibeCodingScore: 15, securityIssues: 1, aiGeneratedPatterns: 2,
  hasTests: true, hasLicense: true, hasCI: true, hasDockerfile: false,
  fileCount: 50, languages: ["TypeScript"], teamSize: 3,
  isEducation: false, framework: "express",
};

describe("agents generate command logic", () => {
  it("generates minimal guidelines", () => {
    const result = generateGuidelines("minimal", analysis);
    expect(result).toContain("AGENTS.md (Minimal)");
    expect(result).toContain("🔴");
  });

  it("generates with vibe warning when score > 30", () => {
    const highVibe = { ...analysis, vibeCodingScore: 45 };
    const result = generateGuidelines("minimal", highVibe);
    expect(result).toContain("AI-generated code patterns");
  });

  it("standard mode sections are correct", () => {
    const result = generateGuidelines("standard", analysis);
    expect(result).toContain("Security");
    expect(result).toContain("Code Quality");
    expect(result).toContain("Code Review");
  });

  it("generates comprehensive mode with analysis context", () => {
    const result = generateGuidelines("comprehensive", analysis);
    expect(result).toContain("Codebase Context");
    expect(result).toContain("Vibe Coding Index");
  });

  it("behaves correctly for education mode", () => {
    const edu = { ...analysis, isEducation: true };
    const minimal = generateGuidelines("minimal", edu);
    expect(minimal).toContain("must not write production code");
  });

  it("estimateContextWindowFit gives useful output", () => {
    const result = estimateContextWindowFit("# Test\nrule 1\nrule 2\n", "claude");
    expect(result.tokenEstimate).toBeGreaterThan(0);
    expect(typeof result.fits).toBe("boolean");
  });
});

describe("agents audit command logic", () => {
  const agentsContent = "# AGENTS.md\n- **🔴 No secrets in code** — desc\n- **🔴 No eval** — desc";

  it("audits against violations", () => {
    const violations = [{ ruleId: "no-secrets-in-code", severity: "must" as const, detail: "found", recommendation: "fix" }];
    const result = checkGuidelinesCompliance(agentsContent, violations);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(typeof result.passed).toBe("boolean");
  });

  it("flags unmatched violations", () => {
    const violations = [{ ruleId: "no-any-abuse", severity: "should" as const, detail: "many anys", recommendation: "add types" }];
    const result = checkGuidelinesCompliance(agentsContent, violations);
    expect(result.violations.length).toBe(1);
  });
});

describe("parseExistingGuidelines", () => {
  it("detects mode from content", () => {
    expect(parseExistingGuidelines("# AGENTS.md (Minimal)").mode).toBe("minimal");
    expect(parseExistingGuidelines("# AGENTS.md (Comprehensive)").mode).toBe("comprehensive");
    expect(parseExistingGuidelines("# AGENTS.md").mode).toBe("standard");
  });

  it("extracts rule titles", () => {
    const content = "# AGENTS.md\n- **🔴 No secrets** — desc\n- **🟡 Add types** — desc";
    const result = parseExistingGuidelines(content);
    expect(result.rules).toContain("🔴 No secrets");
    expect(result.rules).toContain("🟡 Add types");
  });
});

describe("getRulesForMode", () => {
  it("minimal mode returns concise rules", () => {
    const rules = getRulesForMode("minimal", analysis);
    expect(rules.length).toBeGreaterThan(0);
    rules.forEach(r => expect(r.modes).toContain("minimal"));
  });
});
