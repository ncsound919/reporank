import { describe, it, expect, vi } from "vitest";
import { formatPrComment, commentSignature } from "../../services/prCommenter";
import type { ImpactReport } from "@reporank/grading-engine";

const sampleImpact: ImpactReport = {
  currentScore: 80,
  predictedScore: 76,
  totalDelta: -4,
  confidence: "high",
  perFile: [
    {
      path: "src/bad.ts", kind: "added", scoreDelta: -4,
      reasons: ["[critical] spaghetti-nesting — depth of 9"],
      recommendations: ["Extract into named functions"],
      vibeContribution: 4,
    },
    {
      path: "src/old.ts", kind: "removed", scoreDelta: 0.5,
      reasons: ["Removed 200 lines — dead code elimination"],
      recommendations: ["Verify no imports reference this file."],
      vibeContribution: 0,
    },
  ],
  topWins: ["+0.5 pts from removed src/old.ts — dead code elimination"],
  topRisks: ["-4.0 pts from added src/bad.ts — [critical] spaghetti-nesting"],
  software20Score: {
    overall: 70, fileSizeScore: 80, commentDensity: 60, importClarity: 90, testCoverage: 50,
    structureNotes: ["Increase test coverage — tests let LLMs verify their changes."],
  },
  vibeTrend: { baseVibe: 0, newVibe: 35, delta: 35, direction: "stable", insight: "New code has moderate Vibe patterns (35/100) — within normal range." },
  summary: "This PR is predicted to drop score by 4 points (80 → 76).",
};

describe("formatPrComment", () => {
  it("includes the score headline and delta", () => {
    const md = formatPrComment(sampleImpact, { repoFullName: "org/repo", prNumber: 42 });
    expect(md).toContain("RepoRank PR Impact Prediction");
    expect(md).toContain("org/repo #42");
    expect(md).toContain("drops your score by");
    expect(md).toMatch(/76\/100/);
    expect(md).toContain("(was 80)");
  });

  it("highlights positive deltas with a green check", () => {
    const winImpact = { ...sampleImpact, totalDelta: 5, predictedScore: 85 };
    const md = formatPrComment(winImpact, { repoFullName: "a/b", prNumber: 1 });
    expect(md).toContain("✅");
    expect(md).toContain("+5 points");
  });

  it("handles zero delta", () => {
    const flat = { ...sampleImpact, totalDelta: 0, predictedScore: 80 };
    const md = formatPrComment(flat, { repoFullName: "a/b", prNumber: 2 });
    expect(md).toContain("No net impact");
  });

  it("includes the Software 2.0 breakdown table", () => {
    const md = formatPrComment(sampleImpact, { repoFullName: "a/b", prNumber: 3 });
    expect(md).toContain("Software 2.0 Compatibility");
    expect(md).toContain("File size distribution");
    expect(md).toContain("70/100");
  });

  it("emits per-file breakdown when enabled", () => {
    const md = formatPrComment(sampleImpact, { repoFullName: "a/b", prNumber: 4, includeDetailedBreakdown: true });
    expect(md).toContain("Per-file impact");
    expect(md).toContain("src/bad.ts");
    expect(md).toContain("spaghetti-nesting");
  });

  it("omits per-file breakdown when disabled", () => {
    const md = formatPrComment(sampleImpact, { repoFullName: "a/b", prNumber: 5, includeDetailedBreakdown: false });
    expect(md).not.toContain("Per-file impact");
  });

  it("includes top wins and risks", () => {
    const md = formatPrComment(sampleImpact, { repoFullName: "a/b", prNumber: 6 });
    expect(md).toContain("Top wins");
    expect(md).toContain("Top risks");
    expect(md).toContain("src/old.ts");
    expect(md).toContain("src/bad.ts");
  });

  it("ends with the RepoRank signature and a comment marker", () => {
    const md = formatPrComment(sampleImpact, { repoFullName: "a/b", prNumber: 7 });
    const final = md + commentSignature();
    expect(final).toContain("<!-- reporank-bot -->");
    expect(final).toContain("Powered by [RepoRank]");
  });
});
