/**
 * PR commenter — formats impact predictions as a GitHub-flavored
 * markdown comment. Used by the webhook handler and the API.
 */
import type { ImpactReport, FileImpact } from "@reporank/grading-engine";

export interface PrCommentOptions {
  repoFullName: string;
  prNumber: number;
  includeDetailedBreakdown?: boolean;
}

export function formatPrComment(impact: ImpactReport, options: PrCommentOptions): string {
  const { repoFullName, prNumber, includeDetailedBreakdown = true } = options;
  const lines: string[] = [];

  lines.push(`## RepoRank PR Impact Prediction`);
  lines.push(``);
  lines.push(`> **${repoFullName} #${prNumber}** — predicted score change`);
  lines.push(``);

  // Score headline
  if (impact.totalDelta === 0) {
    lines.push(`### ➖ No net impact on overall score`);
  } else if (impact.totalDelta > 0) {
    lines.push(`### ✅ This PR improves your score by **+${impact.totalDelta} points**`);
  } else {
    lines.push(`### ⚠️ This PR drops your score by **${impact.totalDelta} points**`);
  }
  lines.push(``);
  lines.push(`**Predicted score:** ${impact.predictedScore}/100 _(was ${impact.currentScore})_`);
  lines.push(`**Confidence:** ${impact.confidence}`);
  lines.push(`**Software 2.0 Compatibility:** ${impact.software20Score.overall}/100`);
  if (impact.vibeTrend) {
    const v = impact.vibeTrend;
    const arrow = v.direction === "rising" ? "📈" : v.direction === "falling" ? "📉" : "➡️";
    lines.push(`**Vibe Coding Index (new code):** ${v.newVibe}/100 ${arrow} — ${v.insight}`);
  }
  lines.push(``);

  // Software 2.0 breakdown
  const s20 = impact.software20Score;
  lines.push(`<details><summary>🤖 Software 2.0 Compatibility Breakdown</summary>`);
  lines.push(``);
  lines.push(`| Dimension | Score |`);
  lines.push(`| --- | --- |`);
  lines.push(`| File size distribution | ${s20.fileSizeScore}/100 |`);
  lines.push(`| Comment density | ${s20.commentDensity}/100 |`);
  lines.push(`| Import clarity | ${s20.importClarity}/100 |`);
  lines.push(`| Test coverage ratio | ${s20.testCoverage}/100 |`);
  lines.push(``);
  if (s20.structureNotes.length > 0) {
    lines.push(`**Notes:**`);
    for (const note of s20.structureNotes) lines.push(`- ${note}`);
  }
  lines.push(`</details>`);
  lines.push(``);

  // Wins and risks
  if (impact.topWins.length > 0) {
    lines.push(`### 🟢 Top wins`);
    for (const w of impact.topWins) lines.push(`- ${w}`);
    lines.push(``);
  }
  if (impact.topRisks.length > 0) {
    lines.push(`### 🔴 Top risks`);
    for (const r of impact.topRisks) lines.push(`- ${r}`);
    lines.push(``);
  }

  // Per-file breakdown
  if (includeDetailedBreakdown && impact.perFile.length > 0) {
    lines.push(`<details><summary>📂 Per-file impact (${impact.perFile.length} files)</summary>`);
    lines.push(``);
    for (const f of impact.perFile) lines.push(formatFileImpact(f));
    lines.push(`</details>`);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*Powered by [RepoRank](https://reporank.dev) — AI-aware code health*`);

  return lines.join("\n");
}

function formatFileImpact(impact: FileImpact): string {
  const lines: string[] = [];
  const sign = impact.scoreDelta > 0 ? "+" : "";
  const emoji = impact.scoreDelta > 0 ? "🟢" : impact.scoreDelta < 0 ? "🔴" : "⚪";
  lines.push(`#### ${emoji} \`${impact.path}\` (${impact.kind}) — ${sign}${impact.scoreDelta}`);
  if (impact.reasons.length > 0) {
    for (const r of impact.reasons) lines.push(`- ${r}`);
  }
  if (impact.recommendations.length > 0) {
    lines.push(`**Recommended fixes:**`);
    for (const r of impact.recommendations) lines.push(`  - ${r}`);
  }
  lines.push(``);
  return lines.join("\n");
}

export function commentSignature(): string {
  return `\n\n<!-- reporank-bot -->`;
}
