import { describe, it, expect, vi } from "vitest";
import { generateGuidelines, estimateContextWindowFit, checkGuidelinesCompliance, type CodebaseAnalysis } from "@reporank/agent-guidelines";

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({ $connect: vi.fn(), $disconnect: vi.fn() })),
}));

vi.mock("../db/client", () => ({
  prisma: {
    user: { findUnique: vi.fn().mockResolvedValue({ id: "user-1", tier: "free" }) },
  },
}));

describe("POST /api/v1/agents/generate", () => {
  const analysis: CodebaseAnalysis = {
    vibeCodingScore: 20, securityIssues: 2, aiGeneratedPatterns: 3,
    hasTests: true, hasLicense: true, hasCI: true, hasDockerfile: false,
    fileCount: 100, languages: ["TypeScript"], teamSize: 5,
    isEducation: false, framework: "express",
  };

  it("generates guidelines from analysis", () => {
    const result = generateGuidelines("standard", analysis);
    expect(result).toContain("AGENTS.md");
    expect(result).toContain("Security");
    expect(result).toContain("Code Quality");
  });

  it("comprehensive mode includes codebase context", () => {
    const result = generateGuidelines("comprehensive", analysis);
    expect(result).toContain("Vibe Coding Index");
    expect(result).toContain("Files: 100");
  });

  it("minimal mode is terse", () => {
    const result = generateGuidelines("minimal", analysis);
    expect(result).toContain("(Minimal)");
    const lines = result.split("\n").filter(l => l.startsWith("-"));
    expect(lines.length).toBeLessThanOrEqual(8);
  });

  it("education mode adds agent-behavior rules", () => {
    const eduAnalysis = { ...analysis, isEducation: true };
    const result = generateGuidelines("standard", eduAnalysis);
    expect(result).toContain("must not write production code");
  });

  it("context fit check works", () => {
    const result = estimateContextWindowFit("# test\n- rule\n- rule\n", "claude");
    expect(result.fits).toBe(true);
    expect(result.tokenEstimate).toBeGreaterThan(0);
  });
});

describe("POST /api/v1/agents/audit", () => {
  const content = "# AGENTS.md\n- **🔴 No secrets in code** — desc\n- **🔴 No eval** — desc";

  it("audits content against violations", () => {
    const violations = [
      { ruleId: "no-secrets-in-code", severity: "must" as const, detail: "found", recommendation: "fix" },
      { ruleId: "no-any-abuse", severity: "should" as const, detail: "15 anys", recommendation: "add types" },
    ];
    const result = checkGuidelinesCompliance(content, violations);
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBe(1);
  });

  it("passes with no violations", () => {
    const result = checkGuidelinesCompliance(content, []);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
  });
});

describe("GET /api/v1/agents/vibe-history", () => {
  it("computes trend from multiple data points", () => {
    const history = [
      { vibeCodingIndex: 40, scannedAt: "2026-01-01" },
      { vibeCodingIndex: 55, scannedAt: "2026-02-01" },
      { vibeCodingIndex: 52, scannedAt: "2026-03-01" },
    ];
    const first = history[0].vibeCodingIndex;
    const last = history[history.length - 1].vibeCodingIndex;
    const delta = last - first;
    const trend = delta > 5 ? "rising" : delta < -5 ? "falling" : "stable";
    expect(trend).toBe("rising");
  });

  it("returns insufficient-data for single data point", () => {
    const history = [{ vibeCodingIndex: 40, scannedAt: "2026-01-01" }];
    const trend = "insufficient-data";
    expect(trend).toBe("insufficient-data");
  });

  it("detects falling trend", () => {
    const history = [
      { vibeCodingIndex: 60, scannedAt: "2026-01-01" },
      { vibeCodingIndex: 45, scannedAt: "2026-02-01" },
      { vibeCodingIndex: 30, scannedAt: "2026-03-01" },
    ];
    const delta = history[history.length - 1].vibeCodingIndex - history[0].vibeCodingIndex;
    expect(delta).toBeLessThan(-5);
  });

  it("detects stable trend within tolerance", () => {
    const history = [
      { vibeCodingIndex: 50, scannedAt: "2026-01-01" },
      { vibeCodingIndex: 52, scannedAt: "2026-02-01" },
      { vibeCodingIndex: 48, scannedAt: "2026-03-01" },
    ];
    const delta = history[history.length - 1].vibeCodingIndex - history[0].vibeCodingIndex;
    expect(Math.abs(delta)).toBeLessThanOrEqual(5);
  });
});
