/**
 * budget.ts — deterministic structural budget gate.
 *
 * Scores in this engine are health scores: `index` and every dimension score
 * are 0..100 where higher is better. A budget is therefore a *floor* — the
 * command fails when a score falls below the configured value. This mirrors
 * `reporank verify --threshold` and is the natural CI gate (e.g. "index must be
 * at least 70", "security must be at least 80").
 *
 * The report names every breach and the top weighted findings that drove it, so
 * a CI failure is actionable without a second command.
 */
import type {
  DimensionContribution,
  IndexFinding,
  IndexSeverity,
  StructuralIndex,
} from "../analyzers/structural-index";

export interface DimensionBudget {
  dimension: string;
  /** Minimum acceptable score (0..100) for this dimension. */
  minScore: number;
}

export interface BudgetOptions {
  /** Minimum acceptable overall index (0..100). */
  minIndex?: number;
  minDimensions?: DimensionBudget[];
  /** Optional label echoed into the report. */
  repo?: string;
}

export interface BudgetDriver {
  file: string;
  line?: number;
  severity: IndexSeverity;
  reason: string;
  weight: number;
  source: string;
}

export interface BudgetBreach {
  kind: "index" | "dimension";
  /** Set for dimension breaches; null for the overall index. */
  dimension: string | null;
  /** Minimum required score. */
  required: number;
  /** Actual score (index or dimension). */
  actualScore: number;
  /** 100 − actualScore, the debt behind the breach. */
  actualPenalty: number;
  drivers: BudgetDriver[];
}

export interface BudgetReport {
  repo: string | null;
  index: number;
  penalty: number;
  budgets: {
    minIndex: number | null;
    minDimensions: Record<string, number>;
  };
  passed: boolean;
  breaches: BudgetBreach[];
  summary: string;
}

export interface ParsedDimensionBudgets {
  budgets: DimensionBudget[];
  error: string | null;
}

const DRIVER_LIMIT = 5;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function toDriver(finding: IndexFinding): BudgetDriver {
  return {
    file: finding.file,
    ...(finding.line !== undefined ? { line: finding.line } : {}),
    severity: finding.severity,
    reason: finding.reason,
    weight: finding.weight,
    source: finding.source,
  };
}

function topFindings(contributions: DimensionContribution[], limit: number): BudgetDriver[] {
  const all = contributions.flatMap((contribution) => contribution.findings);
  all.sort(
    (a, b) =>
      b.weight - a.weight ||
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.source.localeCompare(b.source),
  );
  return all.slice(0, limit).map(toDriver);
}

/** Evaluate the structural index against floor budgets. Pure and deterministic. */
export function evaluateBudget(index: StructuralIndex, options: BudgetOptions = {}): BudgetReport {
  const penalty = round2(clamp(100 - index.index));
  const minIndex =
    typeof options.minIndex === "number" && Number.isFinite(options.minIndex) ? options.minIndex : null;

  const minDimensions: Record<string, number> = {};
  for (const budget of options.minDimensions ?? []) {
    minDimensions[budget.dimension] = budget.minScore;
  }

  const byDimension = new Map(index.contributions.map((c) => [c.dimension, c]));
  const breaches: BudgetBreach[] = [];

  if (minIndex !== null && index.index < minIndex) {
    breaches.push({
      kind: "index",
      dimension: null,
      required: minIndex,
      actualScore: index.index,
      actualPenalty: penalty,
      drivers: topFindings(index.contributions, DRIVER_LIMIT),
    });
  }

  for (const dimension of Object.keys(minDimensions).sort()) {
    const required = minDimensions[dimension];
    const contribution = byDimension.get(dimension);
    if (!contribution) continue;
    if (contribution.score < required) {
      breaches.push({
        kind: "dimension",
        dimension,
        required,
        actualScore: contribution.score,
        actualPenalty: round2(clamp(100 - contribution.score)),
        drivers: contribution.findings.slice(0, DRIVER_LIMIT).map(toDriver),
      });
    }
  }

  breaches.sort(
    (a, b) =>
      b.actualPenalty - a.actualPenalty ||
      a.kind.localeCompare(b.kind) ||
      (a.dimension ?? "").localeCompare(b.dimension ?? ""),
  );

  const passed = breaches.length === 0;
  const label = options.repo ?? "repo";
  const summary = passed
    ? `${label} passes the structural budget (index ${index.index}${minIndex !== null ? ` >= ${minIndex}` : ""}).`
    : `${label} fails the structural budget: ${breaches
        .map((breach) =>
          breach.kind === "index"
            ? `index ${breach.actualScore} < ${breach.required}`
            : `${breach.dimension} ${breach.actualScore} < ${breach.required}`,
        )
        .join("; ")}.`;

  return {
    repo: options.repo ?? null,
    index: index.index,
    penalty,
    budgets: { minIndex, minDimensions },
    passed,
    breaches,
    summary,
  };
}

/** CI exit code: 0 when every budget holds, 1 when any budget is breached. */
export function budgetExitCode(report: BudgetReport): number {
  return report.passed ? 0 : 1;
}

/** Dimensions named in a budget that the index did not measure. */
export function unknownBudgetDimensions(index: StructuralIndex, budgets: DimensionBudget[]): string[] {
  const known = new Set(index.contributions.map((contribution) => contribution.dimension));
  return budgets.map((budget) => budget.dimension).filter((dimension) => !known.has(dimension));
}

/** Parse repeatable `name=score` flags. Last value wins for duplicate names. */
export function parseDimensionBudgets(values: readonly string[]): ParsedDimensionBudgets {
  const budgets: DimensionBudget[] = [];
  const indexByName = new Map<string, number>();

  for (const raw of values) {
    const value = (raw ?? "").trim();
    const separator = value.indexOf("=");
    if (separator <= 0) {
      return { budgets: [], error: `invalid --max-dimension '${raw}' (expected name=score)` };
    }
    const dimension = value.slice(0, separator).trim();
    const score = Number(value.slice(separator + 1).trim());
    if (!dimension || !/^[a-z0-9-]+$/i.test(dimension) || !Number.isFinite(score) || score < 0 || score > 100) {
      return { budgets: [], error: `invalid --max-dimension '${raw}' (expected name=score with score 0..100)` };
    }
    const existing = indexByName.get(dimension);
    if (existing !== undefined) {
      budgets[existing] = { dimension, minScore: score };
    } else {
      indexByName.set(dimension, budgets.length);
      budgets.push({ dimension, minScore: score });
    }
  }

  return { budgets, error: null };
}
