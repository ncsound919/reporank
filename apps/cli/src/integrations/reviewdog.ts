import type { Finding } from "../review_scanner";

const SEVERITY_ICON: Record<string, string> = {
  critical: "🔴",
  high: "⚠️",
  medium: "🔶",
  low: "💡",
  info: "ℹ️",
};

export function formatAsReviewDogComment(findings: Finding[]): string {
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const path = f.path || "<file>";
    if (!byFile.has(path)) byFile.set(path, []);
    byFile.get(path)!.push(f);
  }

  const lines: string[] = ["# 🔍 RepoRank Code Review", ""];
  for (const [file, fileFindings] of byFile) {
    lines.push(`## ${file}`, "");
    lines.push("| Severity | Line | Type | Description |");
    lines.push("| --- | --- | --- | --- |");
    for (const f of fileFindings) {
      const icon = SEVERITY_ICON[f.severity] || "•";
      const line = f.line > 0 ? `L${f.line}` : "—";
      const desc = f.description.replace(/\|/g, "\\|").slice(0, 100);
      lines.push(`| ${icon} ${f.severity} | ${line} | \`${f.type}\` | ${desc} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
