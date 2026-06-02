import { describe, it, expect } from "vitest";
import { generateReadme } from "../analyzers/readme-gen";

describe("generateReadme", () => {
  it("generates valid markdown with badges", () => {
    const result = generateReadme("my-repo", "owner", "A test repo", 85, "A", "TypeScript", 42, "TypeScript", "", [], []);
    expect(result.markdown).toContain("# my-repo");
    expect(result.markdown).toContain("RepoRank");
    expect(result.markdown).toContain("brightgreen");
  });

  it("includes quick wins section when provided", () => {
    const result = generateReadme("my-repo", "owner", "A test repo", 60, "C", "TypeScript", 42, "TypeScript", "", [{ title: "Fix null safety", severity: "critical" }], []);
    expect(result.sections).toContain("quick-wins");
    expect(result.markdown).toContain("Fix null safety");
  });

  it("includes architecture diagram when provided", () => {
    const mermaid = "graph LR\n  A-->B";
    const result = generateReadme("repo", "owner", "", 50, "C", "JS", 10, "JS", mermaid, [], []);
    expect(result.sections).toContain("architecture");
    expect(result.markdown).toContain("```mermaid");
  });

  it("includes recommendations section when provided", () => {
    const result = generateReadme("repo", "owner", "", 50, "C", "JS", 10, "JS", "", [], ["Fix the null safety"]);
    expect(result.sections).toContain("recommendations");
    expect(result.markdown).toContain("Fix the null safety");
  });

  it("generates setup instructions", () => {
    const result = generateReadme("repo", "owner", "", 50, "C", "JS", 10, "JS", "", [], []);
    expect(result.markdown).toContain("git clone");
    expect(result.markdown).toContain("npm install");
    expect(result.markdown).toContain("npm run dev");
  });

  it("includes contributing guide", () => {
    const result = generateReadme("repo", "owner", "", 50, "C", "JS", 10, "JS", "", [], []);
    expect(result.markdown).toContain("Fork the repository");
    expect(result.markdown).toContain("Pull Request");
  });

  it("uses appropriate badge color based on score", () => {
    const low = generateReadme("repo", "owner", "", 35, "F", "JS", 10, "JS", "", [], []);
    expect(low.markdown).toContain("red");
    const medium = generateReadme("repo", "owner", "", 65, "B", "JS", 10, "JS", "", [], []);
    expect(medium.markdown).toContain("yellow");
    const high = generateReadme("repo", "owner", "", 95, "A+", "JS", 10, "JS", "", [], []);
    expect(high.markdown).toContain("brightgreen");
  });

  it("returns list of generated sections", () => {
    const result = generateReadme("repo", "owner", "", 50, "C", "JS", 10, "JS", "", [], []);
    expect(result.sections).toContain("badges");
    expect(result.sections).toContain("overview");
    expect(result.sections).toContain("stats");
    expect(result.sections).toContain("setup");
    expect(result.sections).toContain("contributing");
  });

  it("returns summary", () => {
    const result = generateReadme("repo", "owner", "", 50, "C", "JS", 10, "JS", "", [], []);
    expect(typeof result.summary).toBe("string");
  });

  it("handles empty description", () => {
    const result = generateReadme("repo", "owner", "", 50, "C", "JS", 10, "JS", "", [], []);
    expect(result.markdown).toContain("Overview");
  });
});
