/**
 * gatesEngine — auto-evaluates acceptance gates against scan data.
 * Pure function, no I/O.
 */

export interface GateEvaluation {
  passed: boolean;
  evidence: string;
  detail: string;
}

export interface GateInput {
  type: string;
  criterion: string;
  milestoneId: string | null;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  try {
    return JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === "object" && currentValue !== null) {
        if (seen.has(currentValue)) {
          return "[Circular]";
        }
        seen.add(currentValue);
      }
      return currentValue;
    });
  } catch {
    return "";
  }
}

export function evaluateGate(
  gate: GateInput,
  report: Record<string, unknown> | null,
  clawFindings: Record<string, unknown> | null,
): GateEvaluation {
  const normalizedReport = asRecord(report);
  const normalizedClaw = asRecord(clawFindings);

  switch (gate.type) {
    case "code-present":
      return evaluateCodePresent(gate.criterion, normalizedReport, normalizedClaw);
    case "tests-present":
      return evaluateTestsPresent(normalizedReport, normalizedClaw);
    case "deploy-preview":
      return evaluateDeployPreview(normalizedReport);
    case "health-endpoint":
      return evaluateHealthEndpoint(normalizedReport, normalizedClaw);
    case "docs-updated":
      return evaluateDocsUpdated(normalizedReport);
    case "security":
      return evaluateSecurityGate(normalizedReport, normalizedClaw);
    case "performance":
      return evaluatePerformanceGate(normalizedReport);
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

function evaluateCodePresent(
  criterion: string,
  report: UnknownRecord,
  claw: UnknownRecord,
): GateEvaluation {
  const lowerCriterion = criterion.toLowerCase().trim();
  const reportStr = safeStringify(report).toLowerCase();

  const builder = asRecord(claw.builder);
  const builderStr = safeStringify(builder).toLowerCase();
  const stack = asStringArray(builder.detectedStack);

  const keywords = lowerCriterion.split(/[\s,;]+/).filter((word) => word.length > 3);

  const found =
    keywords.length > 0 &&
    keywords.some(
      (keyword) =>
        reportStr.includes(keyword) ||
        builderStr.includes(keyword) ||
        stack.some((item) => item.toLowerCase().includes(keyword)),
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

function evaluateTestsPresent(report: UnknownRecord, claw: UnknownRecord): GateEvaluation {
  const quality = asRecord(report.quality);
  const testCount = asNumber(quality.testFileCount);
  const hasTests = testCount > 0;

  const novel = asRecord(claw.novel);
  const seniorDev = asRecord(novel.seniorDev);
  const testGapsRecord = asRecord(seniorDev.testGaps);
  const testGaps = Array.isArray(testGapsRecord.gaps) ? testGapsRecord.gaps : [];

  return {
    passed: hasTests,
    evidence: hasTests ? `${testCount} test file(s) detected` : "No test files detected",
    detail: hasTests
      ? `Test framework: ${asString(quality.testFramework, "unknown")}. ${
          testGaps.length > 0 ? `${testGaps.length} coverage gap(s) identified.` : "No major gaps found."
        }`
      : "The scan found no test files. Add tests matching the acceptance criterion.",
  };
}

function evaluateDeployPreview(report: UnknownRecord): GateEvaluation {
  const deployment = asRecord(report.deployment);
  const hasDocker = Boolean(deployment.hasDockerfile);
  const hasCI = Boolean(deployment.hasCIConfig);
  const score = asNumber(deployment.score);
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

function evaluateHealthEndpoint(report: UnknownRecord, claw: UnknownRecord): GateEvaluation {
  const builder = asRecord(claw.builder);
  const stack = asStringArray(builder.detectedStack);
  const backendFrameworks = new Set(["Express", "Fastify", "Next.js", "tRPC"]);
  const hasBackend = stack.some((item) => backendFrameworks.has(item));
  const routeEvidence = safeStringify(report).toLowerCase().includes("/health");
  const passed = routeEvidence || hasBackend;

  return {
    passed,
    evidence: routeEvidence
      ? "/health endpoint string found in scan"
      : hasBackend
        ? "Backend framework detected"
        : "No backend detected",
    detail: routeEvidence
      ? "A /health route string was found in the scan report."
      : hasBackend
        ? "Backend framework detected but no /health endpoint string found — verify manually."
        : "No backend framework or /health endpoint detected.",
  };
}

function evaluateDocsUpdated(report: UnknownRecord): GateEvaluation {
  const docs = asRecord(report.documentation);
  const score = asNumber(docs.score);
  const readmeCompleteness = asNumber(docs.readmeCompleteness);
  const hasReadme = readmeCompleteness >= 60;
  const passed = hasReadme || score >= 60;

  return {
    passed,
    evidence: `Documentation score: ${score}. README completeness: ${readmeCompleteness}`,
    detail: passed
      ? "Documentation score meets the threshold."
      : "Documentation score is below 60 and README completeness is low. Update docs before marking this gate.",
  };
}

function evaluateSecurityGate(report: UnknownRecord, claw: UnknownRecord): GateEvaluation {
  const secrets = asRecord(claw.secrets);
  const security = asRecord(report.security);
  const secretsFound = asNumber(secrets.secretsFound);
  const highestSeverity = asString(security.highestSeverity, "none").toLowerCase();

  const noCriticalSecrets = secretsFound === 0;
  const noHighVulns = highestSeverity !== "critical" && highestSeverity !== "high";
  const passed = noCriticalSecrets && noHighVulns;

  return {
    passed,
    evidence: `Secrets found: ${secretsFound}. Highest severity: ${highestSeverity || "none"}`,
    detail: passed
      ? "No critical secrets or high-severity vulnerabilities detected."
      : `Security issues blocking this gate: secrets=${secretsFound}, highest severity=${highestSeverity || "unknown"}.`,
  };
}

function evaluatePerformanceGate(report: UnknownRecord): GateEvaluation {
  const deployment = asRecord(report.deployment);
  const quality = asRecord(report.quality);
  const hasLogging = Boolean(deployment.hasLogging);
  const score = asNumber(quality.score);
  const passed = score >= 70 && hasLogging;

  return {
    passed,
    evidence: `Quality score: ${score}. Logging: ${hasLogging}`,
    detail: passed
      ? "Quality score ≥70 and logging detected — basic performance posture is adequate."
      : "Quality score is below 70 or logging is missing. Performance cannot be validated without runtime data.",
  };
}
