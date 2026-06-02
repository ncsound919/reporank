import { type AgentRule, type RuleSeverity } from "./rules";

export interface ComplianceViolation {
  ruleId: string;
  severity: RuleSeverity;
  file?: string;
  detail: string;
  recommendation: string;
}

export interface ComplianceReport {
  violations: ComplianceViolation[];
  score: number;
  criticalCount: number;
  summary: string;
  passed: boolean;
}

export function parseExistingGuidelines(content: string): { rules: string[]; mode: string } {
  const rules: string[] = [];
  let mode = "standard";

  if (content.includes("(Minimal)")) mode = "minimal";
  else if (content.includes("(Comprehensive)")) mode = "comprehensive";

  const ruleLines = content.split("\n").filter(l =>
    l.match(/^-\s+\*\*[🔴🟡🟢]/) || l.match(/^-\s+\*\*/),
  );

  for (const line of ruleLines) {
    const match = line.match(/\*\*(.+?)\*\*/);
    if (match) rules.push(match[1]);
  }

  return { rules, mode };
}

export function checkGuidelinesCompliance(
  agentsContent: string,
  violations: ComplianceViolation[],
): ComplianceReport {
  const { rules } = parseExistingGuidelines(agentsContent);

  const matchedViolations = violations.filter(v =>
    rules.some(r => r.toLowerCase().includes(v.ruleId.replace(/-/g, " ").toLowerCase())),
  );

  const unmatchedViolations = violations.filter(v =>
    !rules.some(r => r.toLowerCase().includes(v.ruleId.replace(/-/g, " ").toLowerCase())),
  );

  const totalViolations = matchedViolations.length + unmatchedViolations.length;
  const criticalCount = matchedViolations.filter(v => v.severity === "must").length +
    unmatchedViolations.filter(v => v.severity === "must").length;
  const score = Math.max(0, 100 - totalViolations * 10);

  return {
    violations: unmatchedViolations,
    score,
    criticalCount,
    summary: `Compliance score: ${score}/100. ${totalViolations} violations found (${criticalCount} critical).`,
    passed: criticalCount === 0,
  };
}
