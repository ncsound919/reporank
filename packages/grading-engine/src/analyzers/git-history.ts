/**
 * Git history analyzer — extracts insights from local .git directory.
 * Only runs when analyzing local directories with a .git folder.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface GitInsight {
  type: "commit-frequency" | "author-count" | "churn-hotspots" | "stale-files" | "branch-count";
  detail: string;
  value: string | number;
  severity: "high" | "medium" | "low";
}

export function analyzeGitHistory(repoPath: string): { insights: GitInsight[]; hasGit: boolean; summary: string } {
  const gitDir = join(repoPath, ".git");
  if (!existsSync(gitDir)) {
    return { insights: [], hasGit: false, summary: "No .git directory found — not a git repository or .git not included" };
  }

  const insights: GitInsight[] = [];

  try {
    // Commit count
    const commitCount = execSync(`git rev-list --count HEAD 2>nul`, { cwd: repoPath, encoding: "utf-8", timeout: 5000 }).trim();
    const commits = parseInt(commitCount, 10);
    insights.push({
      type: "commit-frequency", severity: commits > 100 ? "low" : "medium",
      detail: `${commits} total commits in this branch`,
      value: commits,
    });

    // Author count
    const authors = execSync(`git shortlog -s -n HEAD 2>nul`, { cwd: repoPath, encoding: "utf-8", timeout: 5000 }).trim().split("\n").length;
    insights.push({
      type: "author-count", severity: authors > 1 ? "low" : "high" as any,
      detail: `${authors} contributor(s) — bus factor is ${authors}`,
      value: authors,
    });

    // Stale files (not modified in 90+ commits)
    const staleCount = execSync(`git log --diff-filter=M --name-only --pretty=format: HEAD~100..HEAD 2>nul | sort | uniq -c | sort -rn | wc -l`, { cwd: repoPath, encoding: "utf-8", timeout: 5000 }).trim();
    const recentlyModified = parseInt(staleCount, 10) || 0;
    const allFiles = execSync(`git ls-files 2>nul | wc -l`, { cwd: repoPath, encoding: "utf-8", timeout: 5000 }).trim();
    const totalFiles = parseInt(allFiles, 10) || 0;
    if (totalFiles > 0 && recentlyModified < totalFiles * 0.3) {
      insights.push({
        type: "stale-files", severity: "medium",
        detail: `Only ${recentlyModified} of ${totalFiles} files modified in recent history — ${totalFiles - recentlyModified} files potentially stale`,
        value: totalFiles - recentlyModified,
      });
    }

  } catch (e: any) {
    // Git commands can fail for various reasons
    insights.push({ type: "commit-frequency", severity: "low", detail: `Git analysis limited: ${e.message}`, value: "N/A" });
  }

  return {
    insights, hasGit: true,
    summary: `Git history analyzed: ${insights.length} insights. ${insights.filter(i => i.severity === "high").length} concerns.`,
  };
}
