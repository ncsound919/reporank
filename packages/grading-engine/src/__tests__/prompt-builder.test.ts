import { describe, it, expect } from "vitest";
import { buildGradingPrompt } from "../promptBuilder";

describe("buildGradingPrompt", () => {
  const input = {
    repoUrl: "https://github.com/test/repo",
    repoName: "repo",
    repoOwner: "test",
    mainLanguage: "TypeScript",
    starsCount: 100,
    forksCount: 20,
    openIssuesCount: 5,
    lastPushedAt: "2026-01-01",
    readmeContent: "# Test Repo\nThis is a test.",
    packageJson: '{"name": "test", "version": "1.0.0"}',
    fileTree: ["src/index.ts", "README.md"],
    sourceFiles: [{ path: "src/index.ts", content: "const x = 1;" }],
  };

  it("includes repository metadata", () => {
    const prompt = buildGradingPrompt(input);
    expect(prompt).toContain("test/repo");
    expect(prompt).toContain("TypeScript");
    expect(prompt).toContain("100");
  });

  it("includes truncated readme", () => {
    const prompt = buildGradingPrompt(input);
    expect(prompt).toContain("Test Repo");
  });

  it("includes truncated package.json", () => {
    const prompt = buildGradingPrompt(input);
    expect(prompt).toContain("test");
  });

  it("includes file tree", () => {
    const prompt = buildGradingPrompt(input);
    expect(prompt).toContain("src/index.ts");
  });

  it("handles empty scanner results", () => {
    const prompt = buildGradingPrompt(input, undefined);
    expect(prompt).toContain("No scanner results available");
  });

  it("includes scanner results when provided", () => {
    const prompt = buildGradingPrompt(input, { semgrep: ["finding1"] });
    expect(prompt).toContain("finding1");
  });

  it("requests JSON schema output", () => {
    const prompt = buildGradingPrompt(input);
    expect(prompt).toContain("valid JSON");
    expect(prompt).toContain("overallScore");
    expect(prompt).toContain("dimensionScores");
  });

  it("truncates readme to 10000 chars", () => {
    const longReadme = "x".repeat(20000);
    const result = buildGradingPrompt({ ...input, readmeContent: longReadme });
    expect(result.length).toBeLessThan(20000 + input.packageJson.length + 2000);
  });

  it("truncates file tree to 100 files", () => {
    const manyFiles = Array.from({ length: 200 }, (_, i) => `src/file${i}.ts`);
    const result = buildGradingPrompt({ ...input, fileTree: manyFiles });
    expect(result).not.toContain("src/file150.ts");
  });
});
