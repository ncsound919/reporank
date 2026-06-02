/**
 * gatesEngine — auto-evaluates acceptance gates against scan data.
 * Pure function, no I/O.
 */

export interface GateEvaluation {
  passed: boolean;
  evidence: string;
  detail: string;
}

interface GateInput {
  type: string;
  criterion: string;
  milestoneId: string | null;
}

export function evaluateGate(
  gate: GateInput,
  report: Record<string, unknown> | null,
  clawFindings: Record<string, unknown> | null,
): GateEvaluation {
  const r = report || {};
  const claw = clawFindings || {};

  switch (gate.type) {
    case "code-present":
      return evaluateCodePresent(gate.criterion, r, claw);
    case "tests-present":
      return evaluateTestsPresent(r, claw);
    case "deploy-preview":
      return evaluateDeployPreview(r, claw);
    case "health-endpoint":
      return evaluateHealthEndpoint(r, claw);
    case "docs-updated":
      return evaluateDocsUpdated(r, claw);
    case "security":
      return evaluateSecurityGate(r, claw);
    case "performance":
      return evaluatePerformanceGate(r, claw);
    case "manual-qa":
      return {
        passed: false,
        evidence: "Manual QA cannot be auto-evaluated",
        detail: "This gate requires a human to mark as passed after verifying the acceptance criterion.",
      };
    default:
      return {
        passed: false,
        evidence: "Unknown gate type",
        detail: `Gate type "${gate.type}" is not recognized by the auto-evaluator.`,
      };
  }
}

function evaluateCodePresent(criterion: string, report: any, claw: any): GateEvaluation {
  const lowerCriterion = criterion.toLowerCase();
  const reportStr = JSON.stringify(report).toLowerCase();
  const builderStr = JSON.stringify(claw.builder || {}).toLowerCase();
  const stack: string[] = claw.builder?.detectedStack || [];

  const keywords = lowerCriterion.split(/[\s,;]+/).filter(w => w.length > 3);
  const found = keywords.some(k =>
    reportStr.includes(k) || builderStr.includes(k) || stack.some(s => s.toLowerCase().includes(k))
  );

  return {
    passed: found,
    evidence: found
      ? `Code evidence matching "${criterion}" found in scan report or detected stack`
      : `No code evidence for "${criterion}"`,
    detail: found
      ? "Keyword matching found relevant code markers in the scan output."
      : "The criterion keywords were not matched in the scan report, file tree, or stack detection.",
  };
}

function evaluateTestsPresent(report: any, claw: any): GateEvaluation {
  const quality = report.quality || {};
  const testCount = quality.testFileCount || 0;
  const hasTests = testCount > 0;
  const testGaps = claw.novel?.seniorDev?.testGaps?.gaps || [];

  return {
    passed: hasTests,
    evidence: hasTests
      ? `${testCount} test file(s) detected`
      : "No test files detected",
    detail: hasTests
      ? `Test framework: ${quality.testFramework || "unknown"}. ${testGaps.length > 0 ? `${testGaps.length} coverage gap(s) identified.` : "No major gaps found."}`
      : "The scan found no test files. Add tests matching the acceptance criterion.",
  };
}

function evaluateDeployPreview(report: any, _claw: any): GateEvaluation {
  const deployment = report.deployment || {};
  const hasDocker = deployment.hasDockerfile || false;
  const hasCI = deployment.hasCIConfig || false;
  const score = deployment.score || 0;
  const passed = hasDocker || hasCI || score >= 60;

  return {
    passed,
    evidence: passed
      ? `Deployment signals: Docker=${hasDocker}, CI=${hasCI}, score=${score}`
      : "No deploy configuration found",
    detail: passed
      ? "Dockerfile and/or CI configuration found — deploy preview is feasible."
      : "No Dockerfile or CI config detected. Add deployment configuration before marking this gate.",
  };
}

function evaluateHealthEndpoint(report: any, claw: any): GateEvaluation {
  const stack: string[] = claw.builder?.detectedStack || [];
  const hasBackend = stack.some(s => ["Express", "Fastify", "Next.js", "tRPC"].includes(s));
  const routeEvidence = JSON.stringify(report).toLowerCase().includes("/health");

  return {
    passed: routeEvidence || hasBackend,
    evidence: routeEvidence ? "/health endpoint string found in scan" : (hasBackend ? "Backend framework detected" : "No backend detected"),
    detail: routeEvidence
      ? "A /health route string was found in the scan report."
      : hasBackend
        ? "Backend framework detected but no /health endpoint string found — verify manually."
        : "No backend framework or /health endpoint detected.",
  };
}

function evaluateDocsUpdated(report: any, _claw: any): GateEvaluation {
  const docs = report.documentation || {};
  const score = docs.score || 0;
  const hasReadme = docs.readmeCompleteness >= 60;
  const passed = hasReadme || score >= 60;

  return {
    passed,
    evidence: `Documentation score: ${score}. README completeness: ${docs.readmeCompleteness || 0}`,
    detail: passed
      ? "Documentation score meets the threshold."
      : "Documentation score is below 60 and README completeness is low. Update docs before marking this gate.",
  };
}

function evaluateSecurityGate(report: any, claw: any): GateEvaluation {
  const secrets = claw.secrets || {};
  const security = report.security || {};
  const noCriticalSecrets = (secrets.secretsFound || 0) === 0;
  const noHighVulns = (security.highestSeverity !== "critical") && (security.highestSeverity !== "high");
  const passed = noCriticalSecrets && noHighVulns;

  return {
    passed,
    evidence: `Secrets found: ${secrets.secretsFound || 0}. Highest severity: ${security.highestSeverity || "none"}`,
    detail: passed
      ? "No critical secrets or high-severity vulnerabilities detected."
      : `Security issues blocking this gate: secrets=${secrets.secretsFound || 0}, highest severity=${security.highestSeverity || "unknown"}.`,
  };
}

function evaluatePerformanceGate(report: any, _claw: any): GateEvaluation {
  // Performance is hard to auto-evaluate without runtime data — use deployment score as proxy
  const deployment = report.deployment || {};
  const quality = report.quality || {};
  const hasLogging = deployment.hasLogging || false;
  const score = quality.score || 0;
  const passed = score >= 70 && hasLogging;

  return {
    passed,
    evidence: `Quality score: ${score}. Logging: ${hasLogging}`,
    detail: passed
      ? "Quality score ≥70 and logging detected — basic performance posture is adequate."
      : "Quality score is below 70 or logging is missing. Performance cannot be validated without runtime data.",
  };
}
