/**
 * structural-index.ts — the deterministic, evidence-first RepoRank index.
 *
 * Design contract
 * ---------------
 *   • No LLM ever sets this number. It is a pure function of analyzer findings.
 *   • Every dimension score decomposes: each dimension reports the exact
 *     findings (file/line/severity/reason/weight) whose weighted mass produced
 *     its penalty.
 *   • Bounded + count-independent: a dimension penalty is a soft-saturating
 *     function of the finding mass, not a linear sum and not divided by file
 *     count. Adding files can therefore only ever keep or lower the score.
 *
 * Exact formula (per dimension d)
 * -------------------------------
 *   contrib_i  = SEVERITY_WEIGHT[f.severity] · (0.5 + 0.5 · confidence_i)
 *   raw_d      = Σ contrib_i                     (over findings in dimension d)
 *   K_d        = DIMENSION_BASELINE[d] · languageFactor(cohort)
 *   penalty_d  = 100 · raw_d / (raw_d + K_d)     ∈ [0, 100)
 *   score_d    = 100 − penalty_d                 ∈ (0, 100]
 *   index      = round( Σ_d weight_d · score_d ) with weights renormalised
 *                over measured dimensions only.
 *
 * Because ∂penalty_d/∂raw_d > 0, duplicating or adding findings strictly lowers
 * (or leaves unchanged) the index — there is no divisor that can flatter a
 * large repo. K_d saturates the curve so a huge repo is not linearly crushed.
 *
 * Cohort normalization
 * --------------------
 * The *headline* index is intentionally **absolute** and never divided by repo
 * size: a size divisor would make adding files raise the score (the exact
 * bug removed from verify.ts). Size/language comparability is instead exposed
 * as `normalization.normalizedIndex`, a density-vs-cohort-baseline comparison:
 *
 *   kloc   = max(1, totalLoc / 1000)
 *   ρ      = rawTotal / kloc                     (finding mass per KLOC)
 *   β      = BASE_PENALTY_PER_KLOC · languageFactor(cohort)
 *   baseline = β · kloc                          (expected raw mass for cohort)
 *   normalizedIndex = round(100 − 100 · ρ / (ρ + β))
 *
 * so a 5k-LOC and a 500k-LOC repo with the same *density* compare equal,
 * while the absolute index remains monotone in absolute finding mass.
 */
import type { AnalysisResult } from "./aggregator";
import type { DeadCodeReport } from "./dead-code";
import type { StructuralReport } from "./structural";

export type IndexSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface IndexFinding {
  /** Real file path (or package name for dependency findings). */
  file: string;
  /** 1-based line when the analyzer supplied one. */
  line?: number;
  severity: IndexSeverity;
  reason: string;
  /** Fixed severity × confidence mass this finding contributed to raw_d. */
  weight: number;
  /** Which deterministic analyzer produced the finding. */
  source: string;
}

export interface DimensionContribution {
  dimension: string;
  /** 0..100 for this dimension (100 = no penalty). */
  score: number;
  /** Dimension weight in the overall index (renormalised over measured dims). */
  weight: number;
  /** Sum of finding weights in this dimension. */
  raw: number;
  /** Half-saturation constant used for this dimension. */
  baseline: number;
  findings: IndexFinding[];
}

export interface IndexNormalization {
  /** e.g. "typescript:xl" — language + LOC bucket. */
  cohort: string;
  /** Expected raw finding mass for the cohort (β · kloc). */
  baseline: number;
  /** Size/language density comparison. Never used to inflate `index`. */
  normalizedIndex: number;
}

export interface StructuralIndex {
  /** Headline deterministic 0..100 index. */
  index: number;
  /** Dimensions that could not be measured and were excluded (weights renormalised). */
  unmeasured: string[];
  normalization: IndexNormalization;
  contributions: DimensionContribution[];
  /** Human-readable statement of the formula above. */
  formula: string;
}

export interface StructuralIndexOptions {
  mainLanguage?: string;
  /** Total source lines of code, used only for cohort normalization. */
  totalLoc?: number;
  /** Inject an already-computed structural report (avoids recomputation). */
  structure?: StructuralReport;
  /** Inject an already-computed dead-code plan (wire-in, not duplicate). */
  deadCode?: DeadCodeReport;
}

const DIMENSIONS = [
  "security",
  "structure",
  "complexity",
  "hygiene",
  "production",
  "dependencies",
  "governance",
] as const;
type Dimension = (typeof DIMENSIONS)[number];

/** Fixed dimension weights. Sum = 1.00. Renormalised over measured dims. */
const DIMENSION_WEIGHTS: Record<Dimension, number> = {
  security: 0.18,
  structure: 0.2,
  complexity: 0.15,
  hygiene: 0.14,
  production: 0.13,
  dependencies: 0.1,
  governance: 0.1,
};

/** Raw finding mass that yields a 50% dimension penalty. */
const DIMENSION_BASELINE: Record<Dimension, number> = {
  security: 45,
  structure: 50,
  complexity: 40,
  hygiene: 45,
  production: 40,
  dependencies: 35,
  governance: 30,
};

/** Severity mass for the index (distinct from worst-file ranking weights). */
const SEVERITY_MASS: Record<IndexSeverity, number> = {
  critical: 40,
  high: 15,
  medium: 5,
  low: 1,
  info: 0,
};

/**
 * Language cohort calibration. Kept close to 1.0 on purpose: this is a small,
 * documented adjustment, not a hidden fudge factor. Unknown languages are
 * treated as neutral.
 */
const LANGUAGE_FACTOR: Record<string, number> = {
  typescript: 1,
  javascript: 1,
  python: 1,
  go: 1.05,
  rust: 1.05,
  java: 1.15,
  ruby: 1.1,
  php: 1.1,
  csharp: 1.15,
  unknown: 1,
};

const BASE_PENALTY_PER_KLOC = 3.5;

const FORMULA =
  "index = round(Σ_d w_d · (100 − 100·raw_d/(raw_d + K_d))), " +
  "raw_d = Σ_f severityMass(f)·(0.5+0.5·confidence(f)), " +
  "K_d = dimensionBaseline_d · languageFactor(cohort).";

function normalizeLanguage(mainLanguage: string | undefined): { slug: string; factor: number } {
  const slug = (mainLanguage ?? "").trim().toLowerCase().replace(/[^a-z0-9+#]/g, "");
  const aliases: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    golang: "go",
    "c#": "csharp",
    "c++": "unknown",
  };
  const resolved = aliases[slug] ?? slug;
  return { slug: resolved || "unknown", factor: LANGUAGE_FACTOR[resolved] ?? 1 };
}

function sizeBucket(totalLoc: number): string {
  if (totalLoc < 5_000) return "xs";
  if (totalLoc < 25_000) return "s";
  if (totalLoc < 100_000) return "m";
  if (totalLoc < 500_000) return "l";
  return "xl";
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

/** Split "src/foo.ts:12" style locations the production analyzer emits. */
function splitLocated(filePath: string): { file: string; line?: number } {
  const match = filePath.match(/^(.*?):(\d+)$/);
  if (match) return { file: match[1], line: Number.parseInt(match[2], 10) };
  return { file: filePath };
}

function isSecurityMeasured(result: AnalysisResult): boolean {
  const security = result.security;
  if (!security) return false;
  return (
    security.findings.length > 0 ||
    security.summary.tools.length > 0 ||
    Object.keys(security.summary.toolVersions ?? {}).length > 0
  );
}

function isDependenciesMeasured(result: AnalysisResult): boolean {
  return !(result.dependencies.depHealthScore === 0 && result.dependencies.findings.length === 0);
}

function riskToSeverity(risk: string): IndexSeverity {
  if (risk === "risky") return "high";
  if (risk === "moderate") return "medium";
  return "low";
}

/** Gather located, weighted findings for one dimension. */
function gatherFindings(
  result: AnalysisResult,
  dimension: Dimension,
  options: StructuralIndexOptions,
): { findings: IndexFinding[]; measured: boolean } {
  const out: IndexFinding[] = [];

  const push = (
    raw: { severity: string; detail: string; confidence?: number },
    file: string,
    line: number | undefined,
    source: string,
  ): void => {
    const severity = (raw.severity as IndexSeverity) ?? "info";
    const base = SEVERITY_MASS[severity] ?? 0;
    if (base === 0) return;
    const confidence = clampConfidence(raw.confidence);
    const weight = Math.round(base * (0.5 + 0.5 * confidence) * 100) / 100;
    out.push({ file, ...(line !== undefined ? { line } : {}), severity, reason: raw.detail, weight, source });
  };

  switch (dimension) {
    case "security": {
      const measured = isSecurityMeasured(result);
      for (const f of result.security?.findings ?? []) {
        push(f, f.filePath ?? "security", f.line, f.tool);
      }
      return { findings: out, measured };
    }
    case "structure": {
      const structure = options.structure ?? result.structure;
      for (const f of structure?.findings ?? []) {
        push(f, f.filePath, f.line, `structure:${f.type}`);
      }
      // Architecture findings share the structural dimension: both describe
      // module boundaries, just detected by different rules.
      for (const f of result.architecture.findings) {
        push(f, f.filePath, undefined, `architecture:${f.type}`);
      }
      // Honest failure: only claim the dimension is measured when a structural
      // report actually exists (or architecture findings were produced).
      return { findings: out, measured: structure !== undefined || result.architecture.findings.length > 0 };
    }
    case "complexity": {
      for (const f of result.complexity.hotSpots) {
        push(f, f.filePath, undefined, `complexity:${f.concern}`);
      }
      return { findings: out, measured: true };
    }
    case "hygiene": {
      for (const f of result.codeHygiene.findings) {
        push(f, f.filePath, f.line, `hygiene:${f.category}`);
      }
      const deadCode = options.deadCode ?? result.deadCode;
      for (const step of deadCode?.steps ?? []) {
        push(
          { severity: riskToSeverity(step.riskLevel), detail: step.reason },
          step.file,
          undefined,
          "dead-code",
        );
      }
      return { findings: out, measured: true };
    }
    case "production": {
      for (const f of result.production.findings) {
        const { file, line } = splitLocated(f.filePath);
        push(f, file, line, `production:${f.type}`);
      }
      return { findings: out, measured: true };
    }
    case "dependencies": {
      const measured = isDependenciesMeasured(result);
      for (const f of result.dependencies.findings) {
        push(f, f.packageName, undefined, `dependency:${f.type}`);
      }
      return { findings: out, measured };
    }
    case "governance": {
      const groups = [
        result.enterprise.apiContract,
        result.enterprise.observability,
        result.enterprise.buildCI,
        result.enterprise.coupling,
        result.enterprise.license,
        result.enterprise.longTermDebt,
      ];
      for (const group of groups) {
        for (const f of group.findings) {
          push(f, f.filePath, undefined, "enterprise");
        }
      }
      return { findings: out, measured: true };
    }
  }
}

/**
 * Build the deterministic structural index from analyzer results.
 * This is the single source of truth for the repo score.
 */
export function computeStructuralIndex(
  result: AnalysisResult,
  options: StructuralIndexOptions = {},
): StructuralIndex {
  const { slug, factor } = normalizeLanguage(options.mainLanguage);
  const totalLoc = Math.max(0, options.totalLoc ?? 0);
  const cohort = `${slug}:${sizeBucket(totalLoc)}`;

  const contributions: DimensionContribution[] = [];
  const unmeasured: string[] = [];
  const measuredRawByDimension = new Map<Dimension, number>();

  for (const dimension of DIMENSIONS) {
    const { findings, measured } = gatherFindings(result, dimension, options);
    if (!measured) {
      unmeasured.push(dimension);
      continue;
    }
    const raw = Math.round(findings.reduce((s, f) => s + f.weight, 0) * 100) / 100;
    const baseline = DIMENSION_BASELINE[dimension] * factor;
    const penalty = raw <= 0 ? 0 : (100 * raw) / (raw + baseline);
    const score = Math.round((100 - penalty) * 10) / 10;
    measuredRawByDimension.set(dimension, raw);
    contributions.push({
      dimension,
      score,
      weight: DIMENSION_WEIGHTS[dimension],
      raw,
      baseline: Math.round(baseline * 100) / 100,
      findings: [...findings].sort(
        (a, b) => b.weight - a.weight || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0),
      ),
    });
  }

  // Renormalise weights over measured dimensions so an unmeasured dimension
  // never masquerades as a measured zero or a free 100.
  const weightSum = contributions.reduce((s, c) => s + c.weight, 0);
  const normalizedContributions = contributions.map((c) => ({
    ...c,
    weight: weightSum > 0 ? Math.round((c.weight / weightSum) * 1000) / 1000 : 0,
  }));

  const index =
    weightSum > 0
      ? Math.round(normalizedContributions.reduce((s, c) => s + c.weight * c.score, 0))
      : 0;

  const rawTotal = [...measuredRawByDimension.values()].reduce((s, v) => s + v, 0);
  const kloc = Math.max(1, totalLoc / 1000);
  const density = rawTotal / kloc;
  const beta = BASE_PENALTY_PER_KLOC * factor;
  const baseline = Math.round(beta * kloc * 100) / 100;
  const normalizedIndex =
    density <= 0 ? 100 : Math.round(100 - (100 * density) / (density + beta));

  return {
    index: Math.max(0, Math.min(100, index)),
    unmeasured,
    normalization: { cohort, baseline, normalizedIndex: Math.max(0, Math.min(100, normalizedIndex)) },
    contributions: normalizedContributions,
    formula: FORMULA,
  };
}
