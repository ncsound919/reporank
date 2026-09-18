/**
 * security.ts — maps a measured audit-core report into RepoRank's analyzer
 * finding model.
 *
 * This is the bridge that makes the "security" dimension a function of real
 * tool output (Semgrep, CodeQL, OSV, Trivy, Gitleaks, Checkov, Syft) instead of
 * an LLM opinion. Provenance is preserved on every finding so downstream
 * reports can always distinguish measured from inferred.
 *
 * Structural typing is used deliberately: grading-engine does not need to
 * compile against audit-core; any report shaped like this is accepted.
 */

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SecurityFinding {
  severity: SecuritySeverity;
  category: string;
  tool: string;
  ruleId: string;
  detail: string;
  filePath?: string;
  line?: number;
  cwe?: string[];
  cvss?: number;
  provenance: 'measured' | 'deterministic';
  fingerprint: string;
  remediation?: string;
}

export interface SecurityGroup {
  findings: SecurityFinding[];
  summary: {
    total: number;
    bySeverity: Record<SecuritySeverity, number>;
    byCategory: Record<string, number>;
    tools: string[];
    excluded: { tool: string; reason: string }[];
    toolVersions: Record<string, string | null>;
    /** Deterministic 0-100 from audit-core's scoring. */
    score: number;
    basis: 'measured+deterministic';
    /** Optional stable hash of the underlying report. */
    fingerprint?: string;
  };
}

interface AuditFindingLike {
  severity: SecuritySeverity;
  category: string;
  tool: string;
  ruleId: string;
  message: string;
  file?: string;
  line?: number;
  cwe?: string[];
  cvss?: number;
  provenance: 'measured' | 'deterministic' | 'ai';
  fingerprint: string;
  remediation?: string;
}

export interface AuditReportLike {
  findings: AuditFindingLike[];
  score: {
    value: number;
    basis: string;
    bySeverity: Record<string, number>;
    byCategory: Record<string, number>;
  };
  excluded: { tool: string; reason: string }[];
  toolVersions: Record<string, string | null>;
}

const EMPTY_BY_SEVERITY = (): Record<SecuritySeverity, number> => ({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
});

/** Convert a measured audit-core report into a RepoRank security group. */
export function securityFromAuditReport(
  report: AuditReportLike,
  fingerprint?: string,
): SecurityGroup {
  const bySeverity = EMPTY_BY_SEVERITY();
  const byCategory: Record<string, number> = {};
  const tools = new Set<string>();

  const findings: SecurityFinding[] = report.findings
    // Contract: AI narratives never appear in report.findings. Defensive skip.
    .filter((f) => f.provenance !== 'ai')
    .map((f) => {
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
      byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
      tools.add(f.tool);
      const finding: SecurityFinding = {
        severity: f.severity,
        category: f.category,
        tool: f.tool,
        ruleId: f.ruleId,
        detail: f.message,
        provenance: f.provenance as 'measured' | 'deterministic',
        fingerprint: f.fingerprint,
      };
      if (f.file !== undefined) finding.filePath = f.file;
      if (f.line !== undefined) finding.line = f.line;
      if (f.cwe !== undefined && f.cwe.length) finding.cwe = f.cwe;
      if (f.cvss !== undefined) finding.cvss = f.cvss;
      if (f.remediation !== undefined) finding.remediation = f.remediation;
      return finding;
    });

  return {
    findings,
    summary: {
      total: findings.length,
      bySeverity,
      byCategory,
      tools: [...tools].sort(),
      excluded: report.excluded,
      toolVersions: report.toolVersions,
      score: report.score.value,
      basis: 'measured+deterministic',
      ...(fingerprint ? { fingerprint } : {}),
    },
  };
}

/** An empty group, for when the audit could not run. */
export function emptySecurityGroup(reason: string): SecurityGroup {
  return {
    findings: [],
    summary: {
      total: 0,
      bySeverity: EMPTY_BY_SEVERITY(),
      byCategory: {},
      tools: [],
      excluded: [{ tool: 'audit-core', reason }],
      toolVersions: {},
      score: 100,
      basis: 'measured+deterministic',
    },
  };
}
