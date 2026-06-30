/**
 * Enterprise-grade analyzers — things senior devs care about that vibe coders miss.
 * Covers: API contracts, observability, build/CI, coupling, licensing, long-term debt.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { checkStructuredLogging, checkHealthEndpoint, checkHardcodedUrls } from "./shared_checks";
import { countPatterns } from "./pattern-utils";

// ─── 1. API Contract & Consistency ─────────────────────────────────────
export interface ApiContractFinding {
  type: "inconsistent-error-schema" | "missing-versioning" | "no-rate-limit" | "no-auth-on-endpoint" | "synchronous-handler" | "untyped-request" | "missing-validation" | "mixed-response-formats";
  endpoint?: string;
  filePath: string;
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
  seniorNote: string;
}

export function analyzeApiContracts(sourceFiles: { path: string; content: string }[]): {
  findings: ApiContractFinding[];
  apiSurface: { method: string; path: string; file: string }[];
  consistencyScore: number;
  seniorSummary: string;
} {
  const findings: ApiContractFinding[] = [];
  const apiSurface: { method: string; path: string; file: string }[] = [];
  let score = 100;

  for (const file of sourceFiles) {
    if (file.path.includes("routes/") || file.path.includes("router.") || file.path.includes("api/")) {
      const content = file.content;

      // Extract route definitions
      const routeRegex = /router\.(get|post|put|patch|delete|options)\(["']([^"']+)["']/g;
      let match;
      while ((match = routeRegex.exec(content)) !== null) {
        apiSurface.push({ method: match[1].toUpperCase(), path: match[2], file: file.path });
      }

      // Check for inconsistent error responses (mixing res.json and res.status)
      const jsonResponses = (content.match(/\.json\(\{/g) || []).length;
      const statusResponses = (content.match(/\.status\(\d+\)/g) || []).length;
      const errorObjects = (content.match(/\{.*error.*\}/g) || []).length;

      if (jsonResponses > 2 && errorObjects === 0) {
        findings.push({
          type: "inconsistent-error-schema", filePath: file.path, severity: "high",
          detail: `${jsonResponses} JSON responses with no standardized error schema`,
          seniorNote: "Without a consistent error shape (e.g., { error: string, code: string }), API consumers can't write reliable error handling. Define one error interface and use it everywhere.",
        });
        score -= 10;
      }

      // Check for unvalidated request bodies
      if (content.includes("req.body") && !content.includes("zod") && !content.includes("yup") && !content.includes("validate") && !content.includes("Joi") && !content.includes("ajv")) {
        findings.push({
          type: "untyped-request", filePath: file.path, severity: "high",
          detail: "Uses req.body without Zod/Joi/AJV validation",
          seniorNote: "Untrusted input without schema validation is a reliability and security risk. A malicious payload can crash the handler or bypass logic. Add Zod schemas for all mutation endpoints.",
        });
        score -= 15;
      }

      // Check for synchronous handlers (no async)
      if (content.includes("router.") && content.includes("function(") && !content.includes("async")) {
        findings.push({
          type: "synchronous-handler", filePath: file.path, severity: "medium",
          detail: "Route handler defined as synchronous function",
          seniorNote: "Sync route handlers force the event loop to wait. If any I/O is added later, it'll block. Always define handlers as async even if they don't await yet.",
        });
        score -= 5;
      }
    }

    // Check API versioning
    if (file.path === "app.ts" || file.path.endsWith("app.ts") || file.path.endsWith("index.ts")) {
      if (file.content.includes("app.use(") && file.content.includes("/api/") && !file.content.includes("/v1/") && !file.content.includes("/v2/")) {
        findings.push({
          type: "missing-versioning", filePath: file.path, severity: "medium",
          detail: "API routes mounted without version prefix (e.g., /api/v1/)",
          seniorNote: "Without URL versioning (/v1/, /v2/), you can never change an endpoint without breaking existing clients. Add version prefix from day one even if you only have v1.",
        });
        score -= 8;
      }
    }
  }

  return {
    findings,
    apiSurface,
    consistencyScore: Math.max(0, score),
    seniorSummary: `${apiSurface.length} routes detected. ${findings.length} API contract issues. Score: ${Math.max(0, score)}/100.`,
  };
}

// ─── 2. Observability & Operations ─────────────────────────────────────
export interface ObservabilityFinding {
  type: "no-structured-logging" | "no-metrics" | "no-correlation-ids" | "console-log-in-production" | "no-health-check-detail" | "no-error-tracking";
  filePath: string;
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
  seniorNote: string;
}

export function analyzeObservability(sourceFiles: { path: string; content: string }[]): {
  findings: ObservabilityFinding[];
  observabilityScore: number;
  seniorSummary: string;
} {
  const findings: ObservabilityFinding[] = [];
  let score = 100;

  const allContent = sourceFiles.map(f => f.content).join("\n");

  // Structured logging
  const { hasStructuredLogger, consoleLogCount } = checkStructuredLogging(sourceFiles);

  if (!hasStructuredLogger) {
    findings.push({
      type: "no-structured-logging", filePath: "global", severity: "high",
      detail: `${consoleLogCount} console.log/error/warn statements, zero structured logger imports`,
      seniorNote: "Console.log doesn't produce JSON, doesn't have log levels, can't be indexed by Splunk/Datadog, and can't be filtered by service/version/correlationId. Add pino or winston before shipping.",
    });
    score -= 20;
  }

  if (consoleLogCount > 5 && !hasStructuredLogger) {
    findings.push({
      type: "console-log-in-production", filePath: "multiple files", severity: "high",
      detail: `${consoleLogCount} console statements — possible PII/secret leakage`,
      seniorNote: "Every console.log is a potential data leak. In production, these end up in log aggregation systems. If a user's PII or an API key gets logged, that's a compliance incident.",
    });
    score -= 10;
  }

  // Health check detail
  const hasHealthEndpoint = checkHealthEndpoint(sourceFiles);
  const healthCheckFiles = sourceFiles.filter(f =>
    /\/(health|healthz|ready)\b/.test(f.content)
    || f.content.includes("healthcheck")
    || f.content.includes("healthCheck")
  );
  const hasDetailedHealthCheck = healthCheckFiles.some(f => f.content.includes("db") || f.content.includes("database") || f.content.includes("redis") || f.content.includes("status"));

  if (hasHealthEndpoint && healthCheckFiles.length > 0 && !hasDetailedHealthCheck) {
    findings.push({
      type: "no-health-check-detail", filePath: healthCheckFiles[0].path, severity: "medium",
      detail: "Health check exists but returns only status+timestamp — no dependency health",
      seniorNote: "A /health endpoint that doesn't check DB/Redis connectivity is a lie. It'll return 'ok' while your database is down. Add readiness and liveness checks with dependency probing.",
    });
    score -= 10;
  }

  // Correlation IDs
  const hasCorrelationId = allContent.includes("correlationId") || allContent.includes("correlation-id") || allContent.includes("requestId") || allContent.includes("x-request-id");
  if (!hasCorrelationId) {
    findings.push({
      type: "no-correlation-ids", filePath: "middleware/request-context", severity: "high",
      detail: "No correlation ID pattern detected — cannot trace requests across services",
      seniorNote: "Without correlation IDs, debugging a failed request across API → worker → DB → webhook is impossible. Add a UUID on every incoming request and thread it through all logs and downstream calls.",
    });
    score -= 15;
  }

  // Error tracking
  const hasErrorTracking = allContent.includes("Sentry") || allContent.includes("bugsnag") || allContent.includes("datadog") || allContent.includes("airbrake") || allContent.includes("rollbar");
  if (!hasErrorTracking) {
    findings.push({
      type: "no-error-tracking", filePath: "global", severity: "medium",
      detail: "No error tracking service integrated (Sentry, Datadog, etc.)",
      seniorNote: "Errors that happen in production never make it back to the dev team. Users hit 500s silently. Add Sentry or equivalent to capture stack traces with context.",
    });
    score -= 8;
  }

  return {
    findings,
    observabilityScore: Math.max(0, score),
    seniorSummary: `Observability score: ${Math.max(0, score)}/100. ${findings.length} gaps (${findings.filter(f => f.severity === "high").length} high).`,
  };
}

// ─── 3. Build/CI & Reproducibility ─────────────────────────────────────
export interface BuildCIFinding {
  type: "no-lockfile" | "mixed-package-managers" | "no-ci-cache" | "no-lint-in-ci" | "no-test-in-ci" | "no-security-scan-in-ci" | "long-build" | "no-semantic-versioning" | "no-changelog" | "no-contributing";
  filePath: string;
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
  seniorNote: string;
}

export function analyzeBuildCI(fileTree: string[], sourceFiles: { path: string; content: string }[]): {
  findings: BuildCIFinding[];
  ciScore: number;
  seniorSummary: string;
} {
  const findings: BuildCIFinding[] = [];
  let score = 100;

  const allFilePaths = fileTree.join(" ");
  const allContent = sourceFiles.map(f => f.content).join("\n");

  // Lockfile
  const hasPackageLock = allFilePaths.includes("package-lock.json");
  const hasPnpmLock = allFilePaths.includes("pnpm-lock.yaml");
  const hasYarnLock = allFilePaths.includes("yarn.lock");
  const hasLockfile = hasPackageLock || hasPnpmLock || hasYarnLock;

  if (!hasLockfile) {
    findings.push({
      type: "no-lockfile", filePath: "root", severity: "critical",
      detail: "No lockfile (package-lock.json / pnpm-lock.yaml / yarn.lock) tracked in repo",
      seniorNote: "Without a lockfile, CI and local machines install different dependency versions. 'Works on my machine' becomes 'breaks in production'. Commit the lockfile.",
    });
    score -= 30;
  }

  // Package manager consistency
  const hasPnpmWorkspace = allFilePaths.includes("pnpm-workspace.yaml");
  // Check if both npm and pnpm artifacts exist
  if (hasPackageLock && hasPnpmWorkspace) {
    findings.push({
      type: "mixed-package-managers", filePath: "root", severity: "high",
      detail: "Both package-lock.json (npm) and pnpm-workspace.yaml (pnpm) detected — mixed package managers",
      seniorNote: "Using both npm lockfile and pnpm config creates confusion. CI and local dev might use different package managers, leading to irreproducible builds. Standardize on one.",
    });
    score -= 15;
  }

  // CI quality
  const ciFiles = sourceFiles.filter(f => f.path.includes(".github/workflows/") || f.path.includes("gitlab-ci") || f.path.includes(".drone.yml") || f.path.includes("circleci"));
  const ciContent = ciFiles.map(f => f.content).join("\n");

  if (ciFiles.length === 0) {
    findings.push({
      type: "no-lint-in-ci", filePath: ".github/workflows/", severity: "high",
      detail: "No CI workflow files found",
      seniorNote: "Without CI, every merge is a risk. No automated lint, test, or build verification. Set up at minimum GitHub Actions with lint + test + build.",
    });
    score -= 20;
  } else {
    if (!ciContent.includes("lint") && !ciContent.includes("eslint") && !ciContent.includes("tsc")) {
      findings.push({
        type: "no-lint-in-ci", filePath: ciFiles[0].path, severity: "high",
        detail: "CI workflow exists but doesn't run linting",
        seniorNote: "Lint in CI catches stylistic and some logic issues before they reach production. Without it, code quality degrades silently.",
      });
      score -= 10;
    }
    if (!ciContent.includes("test") && !ciContent.includes("jest") && !ciContent.includes("vitest") && !ciContent.includes("pytest")) {
      findings.push({
        type: "no-test-in-ci", filePath: ciFiles[0].path, severity: "critical",
        detail: "CI workflow doesn't run tests",
        seniorNote: "CI without tests means broken code merges regularly. Every team member pays the debugging tax. Add at minimum 'npm test' to CI.",
      });
      score -= 25;
    }
    if (!ciContent.includes("semgrep") && !ciContent.includes("trivy") && !ciContent.includes("codeql") && !ciContent.includes("gitleaks") && !ciContent.includes("snyk") && !ciContent.includes("trufflehog")) {
      findings.push({
        type: "no-security-scan-in-ci", filePath: ciFiles[0].path, severity: "high",
        detail: "CI workflow doesn't run any security scanning",
        seniorNote: "No SAST, dependency scanning, or secret detection in CI means vulnerabilities and secrets accumulate. Add at minimum Trivy for dependency CVEs and Gitleaks for secrets.",
      });
      score -= 15;
    }
  }

  // Versioning & changelog
  const hasChangelog = allFilePaths.includes("CHANGELOG.md") || allFilePaths.includes("changelog") || allFilePaths.includes("CHANGELOG");
  if (!hasChangelog) {
    findings.push({
      type: "no-changelog", filePath: "CHANGELOG.md", severity: "medium",
      detail: "No CHANGELOG.md found",
      seniorNote: "Consumers of your API/library need to know what changed between versions. A changelog following keepachangelog.com format is essential for adoption.",
    });
    score -= 5;
  }

  const hasContributing = allFilePaths.includes("CONTRIBUTING.md") || allFilePaths.includes("contributing");
  if (!hasContributing) {
    findings.push({
      type: "no-contributing", filePath: "CONTRIBUTING.md", severity: "low",
      detail: "No CONTRIBUTING.md found",
      seniorNote: "Open source or internal — without contribution guidelines, every PR is a guessing game about coding style, commit messages, and review process.",
    });
    score -= 3;
  }

  return {
    findings,
    ciScore: Math.max(0, score),
    seniorSummary: `CI/Quality score: ${Math.max(0, score)}/100. ${findings.length} gaps (${findings.filter(f => f.severity === "critical").length} critical).`,
  };
}

// ─── 4. Coupling & Change Impact ──────────────────────────────────────
export interface CouplingFinding {
  type: "high-fan-in" | "high-fan-out" | "circular-import" | "brittle-import-chain" | "deep-module-coupling";
  filePath: string;
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
  seniorNote: string;
}

export function analyzeCoupling(sourceFiles: { path: string; content: string }[]): {
  findings: CouplingFinding[];
  couplingScore: number;
  seniorSummary: string;
} {
  const findings: CouplingFinding[] = [];
  const importMap = new Map<string, string[]>(); // file → its imports
  const importedBy = new Map<string, string[]>(); // file → files that import it
  let score = 100;

  for (const file of sourceFiles) {
    const imports: string[] = [];
    for (const m of file.content.matchAll(/(?:from|require)\s*\(?\s*["']([^"']+)["']/g)) {
      const imp = m[1];
      if (imp.startsWith(".")) imports.push(imp);
      else if (!imp.startsWith("@types/")) imports.push(imp);
    }
    importMap.set(file.path, imports);

    for (const imp of imports) {
      if (!importedBy.has(imp)) importedBy.set(imp, []);
      importedBy.get(imp)!.push(file.path);
    }
  }

  // High fan-in (imported by many files — changes break many consumers)
  for (const [module, consumers] of importedBy) {
    if (consumers.length > 10) {
      findings.push({
        type: "high-fan-in", filePath: module, severity: "high",
        detail: `Imported by ${consumers.length} files — changes here break ${consumers.length} consumers`,
        seniorNote: "When this module changes, 10+ other files potentially break. High fan-in modules need careful API design and thorough testing. Consider an interface abstraction to decouple consumers.",
      });
      score -= 8;
    }
  }

  // High fan-out (imports too many things — hard to reason about)
  for (const [file, imports] of importMap) {
    if (imports.length > 20) {
      findings.push({
        type: "high-fan-out", filePath: file, severity: "medium",
        detail: `Imports from ${imports.length} different modules — knows too much about the system`,
        seniorNote: "Files that import 20+ modules have too many responsibilities. They're hard to test, hard to reason about, and break for unrelated reasons. Split into focused modules.",
      });
      score -= 5;
    }
  }

  return {
    findings,
    couplingScore: Math.max(0, score),
    seniorSummary: `Coupling score: ${Math.max(0, score)}/100. ${findings.length} coupling issues.`,
  };
}

// ─── 5. License & Compliance ──────────────────────────────────────────
export interface LicenseFinding {
  type: "no-license" | "incompatible-dependency-licenses" | "missing-attribution" | "no-dco" | "no-code-of-conduct";
  filePath: string;
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
  seniorNote: string;
}

export function analyzeLicenseCompliance(fileTree: string[], sourceFiles: { path: string; content: string }[]): {
  findings: LicenseFinding[];
  licenseScore: number;
  seniorSummary: string;
} {
  const findings: LicenseFinding[] = [];
  let score = 100;
  const allFilePaths = fileTree.join(" ");

  // License file
  const hasLicense = allFilePaths.includes("LICENSE") || allFilePaths.includes("LICENSE.md") || allFilePaths.includes("LICENSE.txt") || allFilePaths.includes("LICENCE");
  if (!hasLicense) {
    findings.push({
      type: "no-license", filePath: "LICENSE", severity: "critical",
      detail: "No license file — project is unlicensed (all rights reserved by default)",
      seniorNote: "Without a license, nobody can legally use, modify, or distribute this code. Enterprises will block it. Choose an OSI-approved license (MIT, Apache 2.0, GPL) based on your goals.",
    });
    score -= 40;
  }

  // Code of Conduct
  const hasCoC = allFilePaths.includes("CODE_OF_CONDUCT.md");
  if (!hasCoC) {
    findings.push({
      type: "no-code-of-conduct", filePath: "CODE_OF_CONDUCT.md", severity: "low",
      detail: "No CODE_OF_CONDUCT.md",
      seniorNote: "For any open project, a code of conduct signals that harassment isn't tolerated. Enterprise legal teams will check for this.",
    });
    score -= 3;
  }

  // Package license metadata
  const pkgFile = sourceFiles.find(f => f.path === "package.json");
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      if (!pkg.license) {
        findings.push({
          type: "no-license", filePath: "package.json", severity: "high",
          detail: "package.json missing 'license' field",
          seniorNote: "npm/yarn use the 'license' field in package.json to determine compliance. Missing it means tooling can't validate license compatibility with your dependencies.",
        });
        score -= 15;
      }
    } catch {}
  }

  return {
    findings,
    licenseScore: Math.max(0, score),
    seniorSummary: `License score: ${Math.max(0, score)}/100. ${findings.length} issues.`,
  };
}

// ─── 6. Long-term Debt & Migration ─────────────────────────────────────
export interface LongTermDebtFinding {
  type: "deprecated-api-usage" | "legacy-pattern" | "framework-lock" | "missing-abstraction-layer" | "vendor-lock" | "no-strangler-fig" | "hardcoded-config" | "missing-adr" | "no-deprecation-strategy" | "no-feature-flags";
  filePath: string;
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
  seniorNote: string;
}

export function analyzeLongTermDebt(sourceFiles: { path: string; content: string }[]): {
  findings: LongTermDebtFinding[];
  debtScore: number;
  seniorSummary: string;
} {
  const findings: LongTermDebtFinding[] = [];
  let score = 100;
  const allContent = sourceFiles.map(f => f.content).join("\n");

  // Legacy pattern detection
  const legacyPatterns: { pattern: RegExp; name: string; severity: "high" | "medium"; note: string }[] = [
    { pattern: /\brequire\s*\(/g, name: "require() instead of import", severity: "high", note: "mix of require() and import suggests partial migration — one import style" },
    { pattern: /var\s+\w+\s*=/g, name: "var declarations", severity: "medium", note: "var scopes to functions not blocks — can cause subtle bugs" },
    { pattern: /\.then\(\s*function\s*\(/g, name: "Promise .then() with callbacks", severity: "medium", note: "Prefer async/await for readability and stack traces" },
    { pattern: /function\s*\*[\s\S]*?yield/g, name: "Generator functions", severity: "medium", note: "generators add complexity — use async iterators or streams" },
    { pattern: /\.forEach\(/g, name: "forEach instead of for...of", severity: "medium", note: "forEach can't use await, break, or continue" },
  ];

  for (const { pattern, name, severity, note } of legacyPatterns) {
    const matchCount = countPatterns(allContent, pattern);
    if (matchCount > 5) {
      findings.push({
        type: "legacy-pattern", filePath: "multiple files", severity,
        detail: `${matchCount} uses of ${name} detected`,
        seniorNote: `${note}. These accumulate as 'pattern debt' that makes onboarding harder.`,
      });
      const deduction = severity === "high" ? 8 : 4;
      score -= Math.min(deduction, matchCount);
    }
  }

  // Hardcoded configuration
  for (const hit of checkHardcodedUrls(allContent)) {
    findings.push({
      type: "hardcoded-config", filePath: "multiple files", severity: "medium" as const,
      detail: hit,
      seniorNote: "Hardcoded configs prevent different environments (dev/staging/prod). Extract to env vars or config files.",
    });
    score -= 5;
  }

  // Framework lock-in
  const hasDirectDbAccess = allContent.includes("prisma.") || allContent.includes("pg.") || allContent.includes("knex(") || allContent.includes("mongodb.");
  const hasRepositoryPattern = allContent.includes("Repository") || allContent.includes("repository");
  if (hasDirectDbAccess && !hasRepositoryPattern) {
    findings.push({
      type: "no-strangler-fig", filePath: "global", severity: "medium",
      detail: "Direct ORM/DB calls throughout code — no repository abstraction layer",
      seniorNote: "Every file that calls prisma.user.findMany() directly is coupled to Prisma. If you need to migrate to another DB or ORM, every file changes. Add a repository layer.",
    });
    score -= 10;
  }

  return {
    findings,
    debtScore: Math.max(0, score),
    seniorSummary: `Long-term debt score: ${Math.max(0, score)}/100. ${findings.length} debt items.`,
  };
}

// ─── Orchestrator ──────────────────────────────────────────────────────
export interface EnterpriseReport {
  apiContract: ReturnType<typeof analyzeApiContracts>;
  observability: ReturnType<typeof analyzeObservability>;
  buildCI: ReturnType<typeof analyzeBuildCI>;
  coupling: ReturnType<typeof analyzeCoupling>;
  license: ReturnType<typeof analyzeLicenseCompliance>;
  longTermDebt: ReturnType<typeof analyzeLongTermDebt>;
  overallSeniorScore: number;
  criticalBlockers: string[];
  seniorSummary: string;
  rawPromptBlock: string;
}

export function runEnterpriseAnalysis(
  fileTree: string[],
  sourceFiles: { path: string; content: string }[],
): EnterpriseReport {
  const apiContract = analyzeApiContracts(sourceFiles);
  const observability = analyzeObservability(sourceFiles);
  const buildCI = analyzeBuildCI(fileTree, sourceFiles);
  const coupling = analyzeCoupling(sourceFiles);
  const license = analyzeLicenseCompliance(fileTree, sourceFiles);
  const longTermDebt = analyzeLongTermDebt(sourceFiles);

  const allFindings = [
    ...apiContract.findings,
    ...observability.findings,
    ...buildCI.findings,
    ...coupling.findings,
    ...license.findings,
    ...longTermDebt.findings,
  ];

  const criticalBlockers = allFindings
    .filter(f => f.severity === "critical")
    .map(f => `${f.detail} — ${f.filePath}`);

  const overallSeniorScore = Math.round(
    (apiContract.consistencyScore * 0.15 +
     observability.observabilityScore * 0.20 +
     buildCI.ciScore * 0.20 +
     coupling.couplingScore * 0.10 +
     license.licenseScore * 0.20 +
     longTermDebt.debtScore * 0.15)
  );

  const rawPromptBlock = `## Enterprise-Grade Analysis (authoritative)
[API Contracts]
${apiContract.findings.map(f => `  - ${f.severity.toUpperCase()}: ${f.detail} (${f.filePath})`).join("\n")}

[Observability]
${observability.findings.map(f => `  - ${f.severity.toUpperCase()}: ${f.detail}`).join("\n")}

[Build & CI]
${buildCI.findings.map(f => `  - ${f.severity.toUpperCase()}: ${f.detail}`).join("\n")}

[License & Compliance]
${license.findings.map(f => `  - ${f.severity.toUpperCase()}: ${f.detail}`).join("\n")}

[Long-term Debt]
${longTermDebt.findings.map(f => `  - ${f.severity.toUpperCase()}: ${f.detail}`).join("\n")}

[Critical Blockers]
${criticalBlockers.length > 0 ? criticalBlockers.map(b => `  - ${b}`).join("\n") : "  None identified"}`;

  return {
    apiContract, observability, buildCI, coupling, license, longTermDebt,
    overallSeniorScore,
    criticalBlockers,
    seniorSummary: `Enterprise readiness: ${overallSeniorScore}/100. ${criticalBlockers.length} critical blockers. ${allFindings.length} total issues.`,
    rawPromptBlock,
  };
}
