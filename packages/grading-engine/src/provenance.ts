/**
 * Grading provenance & fabrication guards.
 *
 * An LLM repo grader will confidently invent valuation dollars, a market
 * percentile, a competitor list, churn, and a license inventory with no real
 * input. Grader solved this with a per-field provenance map and by neutralizing
 * plausible-looking-but-unmeasurable fields; RepoRank's grading path had none —
 * `gradeRepo` took raw model JSON and stamped repo metadata on it. This applies
 * the same discipline here.
 *
 * Two independent checks:
 *   1. Fabrication guards — fields that are never derivable from the model's
 *      text are reset to neutral values and labelled `measured:false` with a
 *      reason in `fieldProvenance`. Fields that ARE derivable from a
 *      deterministic input (e.g. a LICENSE file in the tree) are marked measured.
 *   2. Stale-citation guard — a model-cited `file`/`file:line` that does not
 *      exist in the scanned tree is reported on `staleCitations`. It is NOT
 *      deleted: the original string stays in `bugsAndLeaks`/`quickWins`, so
 *      nothing is hidden and the caller can see exactly which citation is stale.
 */
import type { HealthReport, FieldProvenance, StaleCitation } from "@reporank/shared-types";

export interface GradingEvidenceInput {
  /** Deterministic analyzer results passed as context to the model. */
  scanners?: Record<string, unknown> | null | undefined;
  /** Scanned file tree (repo-relative paths). */
  fileTree?: string[] | undefined;
  /** Scanned source files (for path verification). */
  sourceFiles?: Array<{ path: string }> | undefined;
}

/** Field keys that are never derivable from model text alone. */
const UNMEASURABLE: Record<string, string> = {
  valuation: "no measured developer-hour, rate, or cost inputs",
  "market.percentileRank": "no benchmark distribution input to compute a percentile",
  "market.competitorCount": "no competitor dataset or search input",
  globalBenchmarkPercent: "no benchmark distribution input; percentile would be an estimate",
};

function hasKey(scanners: Record<string, unknown> | null | undefined, ...keys: string[]): boolean {
  if (!scanners) return false;
  return keys.some((k) => scanners[k] !== undefined && scanners[k] !== null);
}

export function applyGradingProvenance(report: HealthReport, input: GradingEvidenceInput = {}): void {
  applyFabricationGuards(report, input);
  report.fieldProvenance = buildFieldProvenance(report, input);
  const stale = findStaleCitations(report, input);
  if (stale.length) report.staleCitations = stale;
  else delete report.staleCitations;
}

/**
 * Reset never-measurable fields to neutral values and derive the ones a
 * deterministic input CAN support. Runs whether or not analyzers ran.
 */
export function applyFabricationGuards(report: HealthReport, input: GradingEvidenceInput): void {
  // Valuation needs measured hours and a real rate; this pipeline collects neither.
  report.valuation = {
    replacementCostFMV: 0,
    reliefFromRoyaltyValue: 0,
    productivityWasteHeuristic: 0,
  };

  // Market needs a benchmark distribution / competitor dataset. Zero the
  // fabricated numbers; the trend/activity labels are model heuristics and are
  // left as-is but labelled an estimate below.
  report.market = { ...report.market, percentileRank: 0, competitorCount: 0 };
  report.globalBenchmarkPercent = 0;

  // License: a LICENSE* file in the tree is a real measurement; the license
  // *type*, copyleft flag and conflict list are only measured if a dependency /
  // license analyzer actually ran. Otherwise neutralize them.
  const hasLicenseInput = hasKey(input.scanners as Record<string, unknown>, "dependencies", "licenses", "license");
  const hasLicenseFile = detectLicenseFile(input.fileTree);
  report.license = hasLicenseInput
    ? { ...report.license, hasLicenseFile }
    : { licenseType: null, isCopyleft: false, licenseConflicts: [], hasLicenseFile, score: report.license?.score ?? 50 };
}

function detectLicenseFile(fileTree: string[] | undefined): boolean {
  if (!fileTree?.length) return false;
  return fileTree.some((p) => /(^|\/)licen[cs]e(\.|$)/i.test(p.replace(/\\/g, "/")));
}

/**
 * Per-field provenance. Measured only where a real tool/input produced the
 * value; model-authored is `ai-estimate`; no input at all is `unavailable`.
 */
export function buildFieldProvenance(report: HealthReport, input: GradingEvidenceInput): Record<string, FieldProvenance> {
  const scanners = (input.scanners ?? null) as Record<string, unknown> | null;
  const securityInput = hasKey(scanners, "security", "semgrep", "trivy", "trufflehog", "gitleaks", "claw-protect", "claw");
  const licenseInput = hasKey(scanners, "dependencies", "licenses", "license");
  const anyAnalyzer = !!scanners && Object.values(scanners).some((v) => v !== undefined && v !== null);

  const out: Record<string, FieldProvenance> = {
    overallScore: {
      measured: false,
      basis: "ai-estimate",
      reason: "headline score is model-authored; no deterministic scorer overrides it in this path",
    },
    security: securityInput
      ? { measured: true, basis: "measured", source: "analyzers" }
      : { measured: false, basis: "unavailable", reason: "no deterministic security scanner ran" },
    quality: anyAnalyzer
      ? { measured: true, basis: "measured", source: "analyzers" }
      : { measured: false, basis: "ai-estimate", reason: "readme/test/smell heuristics are model estimates" },
    architecture: hasKey(scanners, "architecture")
      ? { measured: true, basis: "measured", source: "analyzers" }
      : { measured: false, basis: "ai-estimate", reason: "no measured coupling/import-graph input" },
    license: licenseInput
      ? { measured: true, basis: "measured", source: "analyzers" }
      : { measured: false, basis: "unavailable", reason: "no license-scanner input; inventory not measured" },
  };

  for (const [key, reason] of Object.entries(UNMEASURABLE)) {
    out[key] = { measured: false, basis: "unavailable", reason };
  }
  return out;
}

// ── stale-citation guard ────────────────────────────────────────────────────

// A file-looking token: contains a dot-extension, optional :line. Deliberately
// conservative so prose ("null reference") is not mistaken for a path.
const CITATION_RE = /([\w][\w./\\-]*\.\w{1,8})(?::(\d+))?/g;

function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").toLowerCase();
}

/** Build the set of known repo-relative paths (and basenames) to verify against. */
function knownPaths(input: GradingEvidenceInput): { exact: Set<string>; basenames: Set<string> } | null {
  const paths: string[] = [];
  if (input.fileTree?.length) paths.push(...input.fileTree);
  if (input.sourceFiles?.length) paths.push(...input.sourceFiles.map((f) => f.path));
  if (!paths.length) return null; // nothing to verify against — do not claim stale
  const exact = new Set<string>();
  const basenames = new Set<string>();
  for (const p of paths) {
    const n = normalize(p);
    exact.add(n);
    basenames.add(n.split("/").pop() ?? n);
  }
  return { exact, basenames };
}

/**
 * Find model citations whose file does not exist in the scanned tree. Only runs
 * when a tree is available; a citation that matches by full path OR basename is
 * considered resolved (the model may cite a basename).
 */
export function findStaleCitations(report: HealthReport, input: GradingEvidenceInput): StaleCitation[] {
  const known = knownPaths(input);
  if (!known) return [];

  const stale: StaleCitation[] = [];
  const check = (text: string, field: string) => {
    for (const m of text.matchAll(CITATION_RE)) {
      const path = normalize(m[1]);
      if (path.length < 3 || !/\.[a-z0-9]{1,8}$/.test(path)) continue;
      const base = path.split("/").pop() ?? path;
      if (known.exact.has(path) || known.basenames.has(base)) continue;
      stale.push({ citation: m[0], field, reason: `cited path not found in scanned tree: ${m[1]}` });
    }
  };

  for (const b of report.bugsAndLeaks ?? []) check(b, "bugsAndLeaks");
  for (const w of report.quickWins ?? []) {
    if (w.filePath) check(w.filePath, "quickWins.filePath");
  }
  // De-duplicate by citation+field.
  const seen = new Set<string>();
  return stale.filter((s) => {
    const k = `${s.field}|${s.citation}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
