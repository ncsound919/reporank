import type { Finding } from "../review_scanner";

const SEVERITY_ICON: Record<string, string> = {
  critical: "🔴",
  high: "⚠️",
  medium: "🔶",
  low: "💡",
  info: "ℹ️",
};

function escapeMarkdownTableCell(value: string): string {
  return value
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSeverity(severity: string | undefined): string {
  return (severity ?? "info").toLowerCase();
}

function getFindingPath(finding: Finding): string {
  return typeof finding.path === "string" && finding.path.trim().length > 0
    ? finding.path
    : "<file>";
}

function getFindingLine(finding: Finding): string {
  return typeof finding.line === "number" && Number.isFinite(finding.line) && finding.line > 0
    ? `L${finding.line}`
    : "—";
}

function getFindingType(finding: Finding): string {
  return typeof finding.type === "string" && finding.type.trim().length > 0
    ? escapeMarkdownTableCell(finding.type.trim())
    : "unknown";
}

function getFindingDescription(finding: Finding): string {
  const raw =
    typeof finding.description === "string" && finding.description.trim().length > 0
      ? finding.description
      : "No description provided.";

  return escapeMarkdownTableCell(raw).slice(0, 100);
}

export function formatAsReviewDogComment(findings: Finding[]): string {
  if (!Array.isArray(findings) || findings.length === 0) {
    return ["# 🔍 RepoRank Code Review", "", "No findings."].join("\n");
  }

  const byFile = new Map<string, Finding[]>();

  for (const finding of findings) {
    const path = getFindingPath(finding);
    const existing = byFile.get(path);

    if (existing) {
      existing.push(finding);
    } else {
      byFile.set(path, [finding]);
    }
  }

  const lines: string[] = ["# 🔍 RepoRank Code Review", ""];

  for (const [file, fileFindings] of byFile) {
    lines.push(`## ${escapeMarkdownTableCell(file)}`, "");
    lines.push("| Severity | Line | Type | Description |");
    lines.push("| --- | --- | --- | --- |");

    for (const finding of fileFindings) {
      const severity = normalizeSeverity(finding.severity);
      const icon = SEVERITY_ICON[severity] ?? "•";
      const line = getFindingLine(finding);
      const type = getFindingType(finding);
      const description = getFindingDescription(finding);

      lines.push(`| ${icon} ${severity} | ${line} | \`${type}\` | ${description} |`);
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
