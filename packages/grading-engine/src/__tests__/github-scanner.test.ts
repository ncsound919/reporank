import { describe, it, expect, vi } from "vitest";
import { repoDataToGradeInput } from "../scanners/github";

describe("repoDataToGradeInput", () => {
  it("converts RepoData to GradeInput format", () => {
    const repoData = {
      metadata: { owner: "test", repo: "repo", language: "TypeScript", stars: 100, forks: 20, openIssues: 5, pushedAt: "2026-01-01" },
      readme: "# Test",
      packageJson: '{"name": "test"}',
      fileTree: ["src/index.ts", "README.md"],
      sourceFiles: [{ path: "src/index.ts", content: "const x = 1;" }],
    };
    const input = repoDataToGradeInput(repoData);
    expect(input.repoUrl).toBe("https://github.com/test/repo");
    expect(input.repoName).toBe("repo");
    expect(input.repoOwner).toBe("test");
    expect(input.mainLanguage).toBe("TypeScript");
    expect(input.starsCount).toBe(100);
    expect(input.forksCount).toBe(20);
    expect(input.openIssuesCount).toBe(5);
    expect(input.lastPushedAt).toBe("2026-01-01");
    expect(input.readmeContent).toBe("# Test");
    expect(input.packageJson).toBe('{"name": "test"}');
    expect(input.fileTree).toEqual(["src/index.ts", "README.md"]);
    expect(input.sourceFiles).toEqual([{ path: "src/index.ts", content: "const x = 1;" }]);
  });

  it("handles missing language", () => {
    const repoData = {
      metadata: { owner: "x", repo: "y", language: null, stars: 0, forks: 0, openIssues: 0, pushedAt: "" },
      readme: "", packageJson: "{}", fileTree: [], sourceFiles: [],
    };
    const input = repoDataToGradeInput(repoData as any);
    expect(input.mainLanguage).toBeNull();
  });
});

describe("fetchRepoData", () => {
  it("fetches repo data from GitHub API", async () => {
    const mockRepo = { name: "test-repo", language: "TypeScript", stargazers_count: 42, forks_count: 7, open_issues_count: 3, pushed_at: "2026-01-01", default_branch: "main" };
    const mockReadme = { content: Buffer.from("# Test").toString("base64") };
    const mockTree = { tree: [{ path: "src/index.ts" }, { path: "README.md" }] };
    const mockContents = { content: Buffer.from("const x = 1;").toString("base64") };
    const mockPackageJson = { content: Buffer.from('{"name":"test"}').toString("base64") };

    const mockFetch = vi.fn((url: string) => {
      if (url.includes("/readme")) return { ok: true, json: () => mockReadme };
      if (url.includes("/git/trees")) return { ok: true, json: () => mockTree };
      if (url.includes("/contents/package.json")) return { ok: true, json: () => mockPackageJson };
      if (url.includes("/contents/")) return { ok: true, json: () => mockContents };
      return { ok: true, json: () => mockRepo };
    });

    vi.stubGlobal("fetch", mockFetch);

    const { fetchRepoData } = await import("../scanners/github");
    const result = await fetchRepoData("test", "test-repo", "ghp_token");
    expect(result.metadata.owner).toBe("test");
    expect(result.metadata.repo).toBe("test-repo");
    expect(result.readme).toBe("# Test");
    expect(result.fileTree).toContain("src/index.ts");
    expect(result.sourceFiles.length).toBeGreaterThanOrEqual(0);

    vi.unstubAllGlobals();
  });

  it("handles GitHub API errors", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", mockFetch);

    const { fetchRepoData } = await import("../scanners/github");
    await expect(fetchRepoData("test", "nonexistent")).rejects.toThrow("GitHub API 404");

    vi.unstubAllGlobals();
  });
});
