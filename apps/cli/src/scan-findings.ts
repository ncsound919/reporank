// Deterministic structured findings for the remote `scan` path.
//
// The remote scan historically emitted only a scalar score. This module turns
// the reusable grading-engine analyzers (`runDeepAnalysis`) and the local
// secret-regex pass into the same Finding-shaped records used by `verify`, with
// an explicit `located` flag so callers never have to invent a line number.
//
// Every finding carries `source` provenance so a report can tell which
// deterministic analyzer produced it. No LLM is involved here.
import type { runDeepAnalysis } from "@reporank/grading-engine";

/** Return type of grading-engine's deterministic deep analysis. */
export type DeepAnalysisReport = ReturnType<typeof runDeepAnalysis>;

export type ScanSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface ScanFinding {
  category: string;
  severity: ScanSeverity;
  /** Stable machine tag, e.g. "complexity-god-file". */
  type: string;
  description: string;
  recommendation: string;
  /** 1..1 confidence for deterministic analyzers; <1 for regex heuristics. */
  confidence: number;
  /** Real file path when the analyzer supplied one. */
  path?: string;
  /** Real 1-based line when the analyzer supplied one. */
  line?: number;
  /**
   * True when this finding points at a real file (and line where available).
   * False for package-level / repo-level findings that cannot be located.
   */
  located: boolean;
  /** Which deterministic analyzer produced this finding. */
  source: string;
}

export interface SecretHit {
  type: string;
  path: string;
  line: number;
}

/** Synthetic "path" used by some analyzers for repo-wide findings. */
const GLOBAL_PATH = "global";
const DETERMINISTIC_CONFIDENCE = 1;
const SECRET_CONFIDENCE = 0.7;

const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "github-token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g },
  { name: "openai-api-key", pattern: /sk-[A-Za-z0-9]{20,}/g },
  { name: "google-api-key", pattern: /AIza[0-9A-Za-z\-_]{35}/g },
  { name: "private-key", pattern: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH)\s+PRIVATE\s+KEY-----/g },
  { name: "connection-string", pattern: /(postgresql|mysql|mongodb|redis):\/\/[^\s]{10,}/gi },
  { name: "stripe-key", pattern: /(sk_live|pk_live|sk_test|pk_test)_[0-9A-Za-z]{24,}/g },
];

/**
 * Scan already-fetched source files for secret-shaped strings. Iterates file
 * by file so each hit carries a real path and a line number within that file,
 * never an offset into a concatenated blob.
 */
export function scanSecrets(sources: { path: string; content: string }[]): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const file of sources) {
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const p of SECRET_PATTERNS) {
        for (const m of lines[i].matchAll(p.pattern)) {
          if (m[0].includes("test") || m[0].includes("example")) continue;
          hits.push({ type: p.name, path: file.path, line: i + 1 });
        }
      }
    }
  }
  return hits;
}

interface LocatedFields {
  path?: string;
  line?: number;
  located: boolean;
}

/** Build location fields from a real path/line, or an explicit unlocated marker. */
function at(path: string | undefined, line?: number): LocatedFields {
  if (!path || path === GLOBAL_PATH) return { located: false };
  const out: LocatedFields = { path, located: true };
  if (typeof line === "number" && line > 0) out.line = line;
  return out;
}

interface EnterpriseFindingLike {
  type: string;
  filePath: string;
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
  seniorNote: string;
}

/**
 * Convert deterministic deep-analysis output plus secret hits into findings.
 * Analyzer findings without a usable file path are emitted as `located: false`
 * rather than being dropped or given a fabricated line.
 */
export function buildScanFindings(deep: DeepAnalysisReport, secrets: SecretHit[]): ScanFinding[] {
  const findings: ScanFinding[] = [];

  for (const h of deep.complexity.hotSpots) {
    findings.push({
      category: "complexity",
      severity: h.severity,
      type: `complexity-${h.concern}`,
      description: h.detail,
      recommendation: `Reduce ${h.concern} in this file (${h.lines} lines). Consider splitting it into smaller modules.`,
      confidence: DETERMINISTIC_CONFIDENCE,
      ...at(h.filePath),
      source: "grading-engine:analyzeComplexity",
    });
  }

  for (const d of deep.dependencies.findings) {
    findings.push({
      category: "dependency",
      severity: d.severity,
      type: `dependency-${d.type}`,
      description: `${d.packageName}@${d.version}: ${d.detail}`,
      recommendation: `Review, update, or remove ${d.packageName}.`,
      confidence: DETERMINISTIC_CONFIDENCE,
      // Package findings have no source line — report explicitly unlocated.
      located: false,
      source: "grading-engine:analyzeDependencies",
    });
  }

  for (const a of deep.architecture.findings) {
    findings.push({
      category: "architecture",
      severity: a.severity,
      type: `architecture-${a.type}`,
      description: a.detail,
      recommendation: `Resolve the ${a.type} issue in this file.`,
      confidence: DETERMINISTIC_CONFIDENCE,
      ...at(a.filePath),
      source: "grading-engine:analyzeArchitecture",
    });
  }

  for (const s of deep.structure?.findings ?? []) {
    findings.push({
      category: "structure",
      severity: s.severity,
      type: `structure-${s.type}`,
      description: s.detail,
      recommendation: "Resolve this structural issue at the module boundary.",
      confidence: DETERMINISTIC_CONFIDENCE,
      ...at(s.filePath, s.line),
      source: "grading-engine:analyzeStructure",
    });
  }

  for (const p of deep.production.findings) {
    findings.push({
      category: "production",
      severity: p.severity,
      type: `production-${p.type}`,
      description: p.detail,
      recommendation: p.fixSuggestion,
      confidence: DETERMINISTIC_CONFIDENCE,
      ...at(p.filePath),
      source: "grading-engine:analyzeProductionReadiness",
    });
  }

  for (const c of deep.codeHygiene.findings) {
    findings.push({
      category: "hygiene",
      severity: c.severity,
      type: `hygiene-${c.category}`,
      description: c.detail,
      recommendation: c.fixSuggestion,
      confidence: DETERMINISTIC_CONFIDENCE,
      ...at(c.filePath, c.line),
      source: "grading-engine:scanCodeHygiene",
    });
  }

  const enterpriseGroups: [string, { findings: EnterpriseFindingLike[] }][] = [
    ["api-contract", deep.enterprise.apiContract],
    ["observability", deep.enterprise.observability],
    ["build-ci", deep.enterprise.buildCI],
    ["coupling", deep.enterprise.coupling],
    ["license", deep.enterprise.license],
    ["long-term-debt", deep.enterprise.longTermDebt],
  ];
  for (const [group, report] of enterpriseGroups) {
    for (const f of report.findings) {
      findings.push({
        category: `enterprise-${group}`,
        severity: f.severity,
        type: `enterprise-${group}-${f.type}`,
        description: f.detail,
        recommendation: f.seniorNote,
        confidence: DETERMINISTIC_CONFIDENCE,
        ...at(f.filePath),
        source: `grading-engine:enterprise.${group}`,
      });
    }
  }

  for (const s of secrets) {
    findings.push({
      category: "security",
      severity: "critical",
      type: `secret-${s.type}`,
      description: `Potential ${s.type} committed in source`,
      recommendation: "Remove the secret, rotate it, and load it from a secret manager or environment variable at runtime.",
      confidence: SECRET_CONFIDENCE,
      path: s.path,
      line: s.line,
      located: true,
      source: "regex:secret-patterns",
    });
  }

  return findings;
}

export interface DimensionProvenance {
  score: number | null;
  measured: boolean;
  source: string;
}

export interface DimensionReport {
  configCoherence: number;
  dependencyFreshness: number | null;
  provenance: {
    configCoherence: DimensionProvenance;
    dependencyFreshness: DimensionProvenance;
  };
  /** Dimension names whose score could not be measured from real input. */
  unmeasured: string[];
}

/**
 * Derive the config/dependency dimensions from real analyzers instead of the
 * old hardcoded 75/65. Dependency freshness is only measurable when a
 * package.json was actually fetched; otherwise it is reported as null and
 * listed in `unmeasured`.
 */
export function gradeDimensions(deep: DeepAnalysisReport, hasPackageJson: boolean): DimensionReport {
  const configCoherence = clampScore(deep.enterprise.buildCI.ciScore);
  const dependencyFreshness = hasPackageJson ? clampScore(deep.dependencies.depHealthScore) : null;
  const unmeasured = hasPackageJson ? [] : ["dependencyFreshness"];

  return {
    configCoherence,
    dependencyFreshness,
    provenance: {
      configCoherence: {
        score: configCoherence,
        measured: true,
        source: "grading-engine:enterprise.buildCI.ciScore",
      },
      dependencyFreshness: {
        score: dependencyFreshness,
        measured: hasPackageJson,
        source: "grading-engine:analyzeDependencies.depHealthScore",
      },
    },
    unmeasured,
  };
}

export interface OverallScoreParts {
  naming: number;
  modernity: number;
  hygiene: number;
  configCoherence: number;
  dependencyFreshness: number | null;
}

const DIMENSION_WEIGHTS = {
  naming: 0.25,
  modernity: 0.25,
  hygiene: 0.2,
  configCoherence: 0.15,
  dependencyFreshness: 0.15,
};

/**
 * Weighted average over the measured dimensions. Unmeasured dimensions are
 * dropped and the remaining weights are renormalised, so a null dimension can
 * never masquerade as a measured zero.
 */
export function weightedOverall(parts: OverallScoreParts): number {
  let acc = 0;
  let weightSum = 0;
  const add = (score: number, weight: number): void => {
    acc += score * weight;
    weightSum += weight;
  };
  add(parts.naming, DIMENSION_WEIGHTS.naming);
  add(parts.modernity, DIMENSION_WEIGHTS.modernity);
  add(parts.hygiene, DIMENSION_WEIGHTS.hygiene);
  add(parts.configCoherence, DIMENSION_WEIGHTS.configCoherence);
  if (parts.dependencyFreshness !== null) add(parts.dependencyFreshness, DIMENSION_WEIGHTS.dependencyFreshness);
  return weightSum > 0 ? Math.round(acc / weightSum) : 0;
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
