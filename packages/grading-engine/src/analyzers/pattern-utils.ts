export interface PatternFinding {
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  line: number;
  message: string;
}

export interface PatternRule {
  name: string;
  pattern: RegExp;
  severity: "critical" | "high" | "medium" | "low";
  message: (match: string, line: number) => string;
}

export function analyzePatterns(
  content: string,
  rules: PatternRule[],
): PatternFinding[] {
  const lines = content.split("\n");
  const findings: PatternFinding[] = [];

  for (const rule of rules) {
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(rule.pattern);
      if (match) {
        findings.push({
          type: rule.name,
          severity: rule.severity,
          line: i + 1,
          message: rule.message(match[0], i + 1),
        });
      }
    }
  }
  return findings;
}

export function countPatterns(content: string, pattern: RegExp): number {
  if (content.length < 10000) {
    return (content.match(pattern) || []).length;
  }
  let count = 0;
  for (const line of content.split("\n")) {
    if (pattern.test(line)) count++;
  }
  return count;
}
