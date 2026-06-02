import { describe, it, expect } from "vitest";
import { generateGuidelines, estimateContextWindowFit } from "../generator";
import { type CodebaseAnalysis } from "../rules";

const analysis: CodebaseAnalysis = {
  vibeCodingScore: 25,
  securityIssues: 2,
  aiGeneratedPatterns: 3,
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

describe("generateGuidelines", () => {
  it("generates minimal mode markdown", () => {
    const result = generateGuidelines("minimal", analysis);
    expect(result).toContain("AGENTS.md");
    expect(result).toContain("(Minimal)");
    expect(result).toContain("- **🔴");
  });

  it("generates standard mode markdown with sections", () => {
    const result = generateGuidelines("standard", analysis);
    expect(result).toContain("Security");
    expect(result).toContain("Code Quality");
  });

  it("generates comprehensive mode with codebase context", () => {
    const result = generateGuidelines("comprehensive", analysis);
    expect(result).toContain("Codebase Context");
    expect(result).toContain("Vibe Coding Index");
  });

  it("includes vibe coding warning when score > 30", () => {
    const highVibe = { ...analysis, vibeCodingScore: 50 };
    const result = generateGuidelines("minimal", highVibe);
    expect(result).toContain("AI-generated code patterns");
  });

  it("omits vibe warning when score is low", () => {
    const result = generateGuidelines("minimal", analysis);
    expect(result).not.toContain("AI-generated code patterns");
  });

  it("generates without errors for education mode", () => {
    const edu = { ...analysis, isEducation: true };
    const result = generateGuidelines("standard", edu);
    expect(result).toContain("Agent Behavior");
    expect(result).toContain("must not write production code");
  });
});

describe("estimateContextWindowFit", () => {
  it("estimates token count", () => {
    const result = estimateContextWindowFit("# Test\n- rule 1\n- rule 2\n");
    expect(result.tokenEstimate).toBeGreaterThan(0);
    expect(typeof result.fits).toBe("boolean");
  });

  it("provides max tokens for claude", () => {
    const result = estimateContextWindowFit("test", "claude");
    expect(result.maxTokens).toBe(200000);
  });

  it("small markdown fits in context window", () => {
    const result = estimateContextWindowFit("small", "claude");
    expect(result.fits).toBe(true);
  });
});
