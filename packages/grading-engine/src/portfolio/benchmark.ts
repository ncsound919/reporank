/**
 * benchmark.ts — peer percentile for a repo's index.
 *
 * A repo is compared against a cohort of peers (drawn from the portfolio or a
 * caller-supplied baseline). Cohorts are the same language+size bucket the
 * structural index already exposes (`normalization.cohort`, e.g.
 * "typescript:m"). When the exact cohort is too small it widens to the same
 * language, then to the whole sample, and says which cohort it used. Pure,
 * deterministic, no LLM.
 */
import type { StructuralIndex } from "../analyzers/structural-index";

export interface BenchmarkSample {
  repo: string;
  index: number;
  cohort: string;
}

export interface BenchmarkResult {
  /** The cohort actually used (exact, widened "lang:*", or "all"). */
  cohort: string;
  /** % of the cohort this repo matches or beats; null when the sample is empty. */
  percentile: number | null;
  sampleSize: number;
  /** 1 = best; null when the sample is empty. */
  rank: number | null;
  median: number | null;
}

export interface BenchmarkOptions {
  /** Minimum exact-cohort size before widening. Default 3. */
  minSampleSize?: number;
  /** Explicit baseline instead of portfolio-derived peers. */
  baseline?: BenchmarkSample[];
  /** Exclude this repo (the subject) from its own cohort. */
  subject?: string;
}

export const DEFAULT_MIN_SAMPLE_SIZE = 3;

export function cohortKey(index: StructuralIndex): string {
  return index.normalization.cohort;
}

/** "typescript:m" -> "typescript:*". */
export function languageCohort(cohort: string): string {
  const separator = cohort.indexOf(":");
  return separator === -1 ? `${cohort}:*` : `${cohort.slice(0, separator)}:*`;
}

export interface PercentileResult {
  percentile: number | null;
  rank: number | null;
  sampleSize: number;
}

/** Percentile = share of samples the target matches or beats. */
export function percentileOf(target: number, samples: number[]): PercentileResult {
  const values = samples.filter((value) => typeof value === "number" && Number.isFinite(value));
  const sampleSize = values.length;
  if (sampleSize === 0) return { percentile: null, rank: null, sampleSize: 0 };
  const atOrBelow = values.filter((value) => value <= target).length;
  const greater = values.filter((value) => value > target).length;
  return {
    percentile: Math.round((atOrBelow / sampleSize) * 100),
    rank: greater + 1,
    sampleSize,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Benchmark a repo's index against a peer set. Exact cohort first; if smaller
 * than `minSampleSize`, widen to the same language; if still empty, use the
 * full sample. Always reports the cohort and sample size actually used.
 */
export function benchmarkIndex(
  target: StructuralIndex,
  peers: BenchmarkSample[],
  options: BenchmarkOptions = {},
): BenchmarkResult {
  const minSampleSize = Math.max(1, options.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE);
  const pool = (options.baseline ?? peers).filter(
    (sample) => sample.repo !== options.subject,
  );

  const exactCohort = cohortKey(target);
  const widenedCohort = languageCohort(exactCohort);
  const language = widenedCohort.slice(0, widenedCohort.indexOf(":"));

  const exact = pool.filter((sample) => sample.cohort === exactCohort);
  const widened = pool.filter((sample) => sample.cohort.startsWith(`${language}:`));

  let cohort: string;
  let chosen: BenchmarkSample[];
  if (exact.length >= minSampleSize) {
    cohort = exactCohort;
    chosen = exact;
  } else if (widened.length > 0) {
    cohort = widenedCohort;
    chosen = widened;
  } else {
    cohort = "all";
    chosen = pool;
  }

  const stats = percentileOf(target.index, chosen.map((sample) => sample.index));
  return {
    cohort,
    percentile: stats.percentile,
    sampleSize: stats.sampleSize,
    rank: stats.rank,
    median: median(chosen.map((sample) => sample.index)),
  };
}
