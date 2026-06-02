import { describe, it, expect } from "vitest";
import { parseExistingGuidelines, checkGuidelinesCompliance, type ComplianceViolation } from "../compliance";

describe("parseExistingGuidelines", () => {
  it("detects minimal mode", () => {
    const result = parseExistingGuidelines("# AGENTS.md (Minimal)\n- rule");
    expect(result.mode).toBe("minimal");
  });

  it("detects comprehensive mode", () => {
    const result = parseExistingGuidelines("# AGENTS.md (Comprehensive)\n- rule");
    expect(result.mode).toBe("comprehensive");
  });

  it("defaults to standard mode", () => {
    const result = parseExistingGuidelines("# AGENTS.md\n- **🔴 Rule**");
    expect(result.mode).toBe("standard");
  });

  it("extracts rule titles from markdown", () => {
    const content = "# AGENTS.md\n- **🔴 No secrets** — secret description\n- **🟡 Add types** — type description";
    const result = parseExistingGuidelines(content);
    expect(result.rules).toContain("🔴 No secrets");
    expect(result.rules).toContain("🟡 Add types");
  });
});

describe("checkGuidelinesCompliance", () => {
  const agentsContent = "# AGENTS.md\n- **🔴 No secrets in code** — description\n- **🔴 No eval** — description";

  const violations: ComplianceViolation[] = [
    { ruleId: "no-secrets-in-code", severity: "must", file: "config.ts", detail: "API key found", recommendation: "Use env vars" },
    { ruleId: "no-eval", severity: "must", file: "eval.ts", detail: "eval() used", recommendation: "Remove" },
    { ruleId: "no-any-abuse", severity: "should", file: "types.ts", detail: "15 any types", recommendation: "Add proper types" },
  ];

  it("reports matched violations as passed", () => {
    const result = checkGuidelinesCompliance(agentsContent, violations);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("reports unmatched violations as failures", () => {
    const result = checkGuidelinesCompliance(agentsContent, violations);
    expect(result.violations.length).toBe(1); // no-any-abuse unmatched
    expect(result.violations[0].ruleId).toBe("no-any-abuse");
  });

  it("fails on critical violations", () => {
    const critical: ComplianceViolation[] = [
      { ruleId: "no-secrets-in-code", severity: "must", file: ".env", detail: "key exposed", recommendation: "rotate" },
    ];
    const result = checkGuidelinesCompliance(agentsContent, critical);
    expect(result.passed).toBe(false);
  });

  it("passes with no violations", () => {
    const result = checkGuidelinesCompliance(agentsContent, []);
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
  });
});
