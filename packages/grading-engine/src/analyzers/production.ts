import { checkHealthEndpoint, checkStructuredLogging } from "./shared_checks";

export interface ProductionFinding {
  type: "missing-env" | "missing-healthcheck" | "unhandled-rejection" | "missing-timeout" | "sync-blocking" | "no-backpressure" | "config-exposure" | "no-graceful-shutdown" | "insufficient-logging";
  filePath: string;
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
  fixSuggestion: string;
}

export interface ProductionReport {
  findings: ProductionFinding[];
  deployBlockers: ProductionFinding[];
  overallReadiness: "ready" | "needs-work" | "not-ready";
  summary: string;
}

const REQUIRED_ENV_PATTERNS = [
  { key: "DATABASE_URL", purpose: "Database connection" },
  { key: "JWT_SECRET", purpose: "JWT signing" },
  { key: "NODE_ENV", purpose: "Environment detection" },
  { key: "PORT", purpose: "Server port" },
];

export function analyzeProductionReadiness(
  sourceFiles: { path: string; content: string }[],
  fileTree: string[]
): ProductionReport {
  const findings: ProductionFinding[] = [];

  // 1. Check for unhandled promise rejections
  const asyncFnsWithoutCatch: string[] = [];
  for (const file of sourceFiles) {
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Detect .catch() or try/catch around async operations
      if (trimmed.includes("await ") && !file.content.includes("try") && !file.content.includes(".catch(")) {
        const hasTryBlock = file.content.includes("try {") || file.content.includes("try{");
        const hasCatch = file.content.includes(".catch(") || file.content.includes(".catch (");
        if (!hasTryBlock && !hasCatch) {
          asyncFnsWithoutCatch.push(`${file.path}:${i + 1}`);
          break; // Only report once per file
        }
      }
    }
  }

  for (const loc of asyncFnsWithoutCatch.slice(0, 5)) {
    findings.push({
      type: "unhandled-rejection", filePath: loc, severity: "high",
      detail: "Async function without try/catch — unhandled rejections crash the process in Node 16+",
      fixSuggestion: "Wrap in try/catch or add .catch() handler",
    });
  }

  // 2. Check for sync blocking operations
  for (const file of sourceFiles) {
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("execSync") || line.includes("readFileSync") || line.includes("writeFileSync") ||
          line.includes("existsSync") || line.includes("mkdirSync") || line.includes("rmSync")) {
        findings.push({
          type: "sync-blocking", filePath: `${file.path}:${i + 1}`, severity: "medium",
          detail: `Synchronous ${line.trim().split(/[\( ]/)[0]}() blocks the event loop`,
          fixSuggestion: "Use async version (e.g., exec instead of execSync, readFile instead of readFileSync)",
        });
        break;
      }
    }
  }

  // 3. Check for missing timeouts on HTTP/network operations
  for (const file of sourceFiles) {
    if ((file.content.includes("fetch(") || file.content.includes("axios(") || file.content.includes("http.")) &&
        !file.content.includes("timeout") && !file.content.includes("AbortController") && !file.content.includes("signal")) {
      findings.push({
        type: "missing-timeout", filePath: file.path, severity: "high",
        detail: "HTTP calls without timeout or abort signal — can hang indefinitely",
        fixSuggestion: "Add AbortController with timeout, or set timeout option on HTTP client",
      });
      break;
    }
  }

  // 4. Check for config exposure
  for (const file of sourceFiles) {
    const content = file.content;
    if ((content.includes("apiKey") || content.includes("API_KEY")) &&
        (content.includes("process.env") || content.includes("config.") && !content.includes("config.get"))) {
      // This is fine — env vars are expected
    }
    if (content.match(/['"][A-Za-z0-9+/=]{40,}['"]/) && !content.includes("example") && !content.includes("test") && !content.includes(".env")) {
      findings.push({
        type: "config-exposure", filePath: file.path, severity: "critical",
        detail: "Possible hardcoded credential/API key in source code",
        fixSuggestion: "Move to environment variables. Use .env file with .env.example for documentation.",
      });
    }
  }

  // 5. Check for graceful shutdown
  const hasShutdown = sourceFiles.some(f =>
    f.content.includes("SIGTERM") || f.content.includes("SIGINT") || f.content.includes("graceful") || f.content.includes("shutdown")
  );
  if (!hasShutdown) {
    findings.push({
      type: "no-graceful-shutdown", filePath: "entry point", severity: "high",
      detail: "No SIGTERM/SIGINT handler — connections dropped on deploy/restart",
      fixSuggestion: "Add process.on('SIGTERM', ...) and process.on('SIGINT', ...) to close server, DB, and queue connections",
    });
  }

  // 6. Check for health check endpoint
  const hasHealthCheck = checkHealthEndpoint(sourceFiles);
  if (!hasHealthCheck) {
    findings.push({
      type: "missing-healthcheck", filePath: "app.ts / server.ts", severity: "high",
      detail: "No health check endpoint — load balancers and orchestrators can't verify service health",
      fixSuggestion: "Add GET /health endpoint returning { status: 'ok', timestamp }",
    });
  }

  // 7. Check for logging quality
  const { hasStructuredLogger: hasStructuredLogging, consoleLogCount } = checkStructuredLogging(sourceFiles);
  const loggers = sourceFiles.filter(f => f.content.includes("console.log") || f.content.includes("console.error"));
  if (!hasStructuredLogging && loggers.length > 5) {
    findings.push({
      type: "insufficient-logging", filePath: "multiple files", severity: "low",
      detail: `${loggers.length} files use console.log/error — no structured logger (pino/winston)`,
      fixSuggestion: "Add a structured logger like pino for JSON-formatted, level-aware logging",
    });
  }

  // 8. Check for env.example
  const hasEnvExample = fileTree.some(f => f.includes(".env.example") || f.includes("env.example"));
  if (!hasEnvExample) {
    findings.push({
      type: "missing-env", filePath: ".env.example", severity: "medium",
      detail: "No .env.example file — new developers have to guess required environment variables",
      fixSuggestion: "Create .env.example with all required env vars and documentation",
    });
  }

  // Separate deploy blockers
  const deployBlockers = findings.filter(f => f.severity === "critical");

  const criticalCount = findings.filter(f => f.severity === "critical").length;
  const highCount = findings.filter(f => f.severity === "high").length;

  let overallReadiness: "ready" | "needs-work" | "not-ready";
  if (criticalCount > 0) overallReadiness = "not-ready";
  else if (highCount > 3) overallReadiness = "needs-work";
  else overallReadiness = "ready";

  return {
    findings,
    deployBlockers,
    overallReadiness,
    summary: `Production readiness: ${overallReadiness}. ${findings.length} issues (${criticalCount} critical, ${highCount} high). ${deployBlockers.length} deploy blockers.`,
  };
}
