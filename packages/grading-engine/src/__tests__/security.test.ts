import { describe, it, expect } from "vitest";
import {
  securityFromAuditReport,
  emptySecurityGroup,
  type AuditReportLike,
} from "../analyzers/security";
import { runDeepAnalysis } from "../analyzers/run-deep-analysis";
import { gradeRepoStatic } from "../static-grade";
import type { GradeInput } from "../index";

function finding(overrides: Partial<AuditReportLike["findings"][number]> = {}): AuditReportLike["findings"][number] {
  return {
    severity: "high",
    category: "sast",
    tool: "semgrep",
    ruleId: "rules.sql-injection",
    message: "SQL injection",
    file: "src/db.ts",
    line: 10,
    provenance: "measured",
    fingerprint: "abc123",
    ...overrides,
  };
}

function report(findings: AuditReportLike["findings"]): AuditReportLike {
  return {
    findings,
    score: { value: 80, basis: "measured+deterministic", bySeverity: {}, byCategory: {} },
    excluded: [{ tool: "codeql", reason: "not installed" }],
    toolVersions: { semgrep: "1.0.0", codeql: null },
  };
}

describe("securityFromAuditReport", () => {
  it("maps findings and counts severity, category, tools", () => {
    const group = securityFromAuditReport(
      report([
        finding(),
        finding({ severity: "critical", category: "secret", tool: "gitleaks", ruleId: "aws-key" }),
      ]),
      "fp-1",
    );
    expect(group.findings).toHaveLength(2);
    expect(group.summary.bySeverity.critical).toBe(1);
    expect(group.summary.bySeverity.high).toBe(1);
    expect(group.summary.byCategory.sast).toBe(1);
    expect(group.summary.byCategory.secret).toBe(1);
    expect(group.summary.tools).toEqual(["gitleaks", "semgrep"]);
    expect(group.summary.score).toBe(80);
    expect(group.summary.fingerprint).toBe("fp-1");
    expect(group.findings[0]!.detail).toBe("SQL injection");
    expect(group.findings[0]!.provenance).toBe("measured");
  });

  it("drops AI-provenance findings defensively", () => {
    const group = securityFromAuditReport(report([finding({ provenance: "ai" })]));
    expect(group.findings).toHaveLength(0);
    expect(group.summary.total).toBe(0);
  });

  it("emptySecurityGroup is honest about why it is empty", () => {
    const group = emptySecurityGroup("binary not installed");
    expect(group.findings).toHaveLength(0);
    expect(group.summary.excluded[0]!.reason).toBe("binary not installed");
  });
});

describe("gradeRepoStatic includes measured security", () => {
  const input: GradeInput = {
    repoUrl: "local",
    repoName: "r",
    repoOwner: "o",
    mainLanguage: "TypeScript",
    starsCount: 0,
    forksCount: 0,
    openIssuesCount: 0,
    lastPushedAt: new Date().toISOString(),
    readmeContent: "",
    packageJson: "{}",
    fileTree: ["src/a.ts"],
    sourceFiles: [{ path: "src/a.ts", content: "const a = 1;\nexport { a };\n" }],
  };

  it("penalises deterministically and surfaces the security summary", () => {
    const deep = runDeepAnalysis(null, input.fileTree, input.sourceFiles, input.packageJson);
    const security = securityFromAuditReport(report([finding({ severity: "critical" })]));
    const withSecurity = gradeRepoStatic(input, { ...deep, security });
    const without = gradeRepoStatic(input, { ...deep });
    expect(withSecurity.staticScore).toBeLessThan(without.staticScore);
    expect(withSecurity.security?.bySeverity.critical).toBe(1);
    expect(withSecurity.mode).toBe("static");
  });
});
