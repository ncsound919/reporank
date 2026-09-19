// OpenHub shared audit-core HTTP client.
//
// RepoRank's deterministic findings are re-validated (reachability/staleness),
// lifecycled, and gated by the same implementation The Deep and OpenHub use.
// This module is dependency-free and never throws: a core outage is a soft
// failure the caller reports truthfully, never a fabricated pass.
import type { ScanFinding } from "./scan-findings";

export type SharedSeverity = "critical" | "high" | "medium" | "low" | "info";
export type SharedDeterminism = "static" | "heuristic" | "llm";

export interface SharedLocation {
  file: string;
  line?: number;
  endLine?: number;
}

/** The exact finding shape the shared audit core accepts. */
export interface SharedFinding {
  source: string;
  dimension: string;
  category: string;
  severity: SharedSeverity;
  confidence?: number;
  determinism?: SharedDeterminism;
  location?: SharedLocation;
  evidence?: string;
  remediation?: string;
  cwe?: string;
  cve?: string;
}

export interface RunAuditCoreOptions {
  baseUrl: string;
  token?: string;
  targetDir: string;
  findings: SharedFinding[];
  changedLines?: number;
  labels?: string[];
  timeoutMs?: number;
}

export type RunAuditCoreResult =
  | { ok: true; core: unknown }
  | { ok: false; error: string };

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * POST findings to the shared audit core. Any non-2xx, network, timeout, or
 * body-parsing failure resolves to `{ ok: false, error }` — this never rejects.
 */
export async function runAuditCore(opts: RunAuditCoreOptions): Promise<RunAuditCoreResult> {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const payload: Record<string, unknown> = {
    targetDir: opts.targetDir,
    findings: opts.findings,
  };
  if (opts.changedLines !== undefined) payload.changedLines = opts.changedLines;
  if (opts.labels !== undefined) payload.labels = opts.labels;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  try {
    const response = await fetch(`${baseUrl}/api/audit-core/run`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60000),
    });
    if (!response.ok) {
      const suffix = response.statusText ? ` ${response.statusText}` : "";
      return { ok: false, error: `HTTP ${response.status}${suffix}` };
    }
    const body = (await response.json()) as { ok?: unknown; core?: unknown } | null;
    if (!body || typeof body !== "object" || body.ok !== true || body.core === undefined) {
      return { ok: false, error: "unexpected core response" };
    }
    return { ok: true, core: body.core };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

const SEVERITY_ALIASES: Record<string, SharedSeverity> = {
  critical: "critical",
  blocker: "critical",
  fatal: "critical",
  severe: "critical",
  high: "high",
  error: "high",
  major: "high",
  medium: "medium",
  moderate: "medium",
  warning: "medium",
  warn: "medium",
  low: "low",
  minor: "low",
  note: "low",
  info: "info",
  informational: "info",
  none: "info",
  trivial: "info",
};

/** Normalize an arbitrary severity label into the shared union. */
export function normalizeSeverity(value: string): SharedSeverity {
  return SEVERITY_ALIASES[value.trim().toLowerCase()] ?? "info";
}

const DIMENSION_BY_CATEGORY: Record<string, string> = {
  security: "security",
  dependency: "supply-chain",
  complexity: "maintainability",
  architecture: "architecture",
  production: "reliability",
  hygiene: "maintainability",
};

/** Default the shared dimension from RepoRank's category when none is given. */
export function defaultDimension(category: string): string {
  const direct = DIMENSION_BY_CATEGORY[category];
  if (direct) return direct;
  if (category.startsWith("enterprise-")) return "governance";
  return "quality";
}

function determinismFor(f: ScanFinding): SharedDeterminism {
  return f.source.startsWith("regex:") ? "heuristic" : "static";
}

/** Convert one RepoRank finding into the shared audit-core finding shape. */
export function toSharedFinding(f: ScanFinding): SharedFinding {
  const shared: SharedFinding = {
    source: f.source || "reporank",
    dimension: defaultDimension(f.category),
    category: f.category,
    severity: normalizeSeverity(f.severity),
    confidence: f.confidence,
    determinism: determinismFor(f),
  };
  if (f.path) {
    shared.location = { file: f.path };
    if (typeof f.line === "number" && f.line > 0) shared.location.line = f.line;
  }
  if (f.description) shared.evidence = f.description;
  if (f.recommendation) shared.remediation = f.recommendation;
  return shared;
}

/** Convert RepoRank findings into the shared audit-core finding shape. */
export function toSharedFindings(findings: ScanFinding[]): SharedFinding[] {
  return findings.map(toSharedFinding);
}
