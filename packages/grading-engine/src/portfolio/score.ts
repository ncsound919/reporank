/**
 * score.ts — deterministic risk × ROI ranking inputs.
 *
 * All inputs come from the structural index's decomposition; nothing here
 * calls an LLM. `EASE` is a fixed, documented constant per dimension — a
 * product heuristic for "how cheaply this class of finding is fixed", not a
 * measurement. Because the decomposition recomputes each scan, the score
 * moves only when the evidence moves.
 */
import type { IndexFinding, StructuralIndex } from "../analyzers/structural-index";

/** Fixed ease-of-remediation per dimension, 0..1 (1 = cheapest to fix). */
export const DIMENSION_EASE: Record<string, number> = {
  security: 0.85,
  structure: 0.5,
  complexity: 0.4,
  hygiene: 0.8,
  production: 0.7,
  dependencies: 0.9,
  governance: 0.6,
};

export const DEFAULT_EASE = 0.5;

export interface ScoreDriver {
  dimension: string;
  /** Dimension score 0..100. */
  score: number;
  /** Renormalised dimension weight in the index. */
  weight: number;
  /** Index points currently lost in this dimension: (100 - score) · weight. */
  penalty: number;
  ease: number;
  /** Recoverable index mass: ease · penalty. */
  roi: number;
  /** A bounded sample of the findings behind the penalty. */
  findings: IndexFinding[];
}

const DRIVER_FINDING_LIMIT = 5;

/** Top score drivers, ordered by recoverable index mass (roi). */
export function computeDrivers(index: StructuralIndex, limit = 5): ScoreDriver[] {
  const drivers = index.contributions.map((contribution) => {
    const ease = DIMENSION_EASE[contribution.dimension] ?? DEFAULT_EASE;
    const penalty = round2((100 - contribution.score) * contribution.weight);
    const roi = round2(ease * penalty);
    return {
      dimension: contribution.dimension,
      score: contribution.score,
      weight: contribution.weight,
      penalty,
      ease,
      roi,
      findings: contribution.findings.slice(0, DRIVER_FINDING_LIMIT),
    };
  });

  drivers.sort(
    (a, b) => b.roi - a.roi || b.penalty - a.penalty || a.dimension.localeCompare(b.dimension),
  );
  return drivers.slice(0, Math.max(0, limit));
}

export interface RiskRoi {
  /** 100 − index: how much headroom is at risk. */
  risk: number;
  /** Recoverable index mass, 0..100. */
  roi: number;
  /** Deterministic product `risk × roi / 100`, 0..100. */
  score: number;
  drivers: ScoreDriver[];
}

export function computeRiskRoi(index: StructuralIndex, driverLimit = 5): RiskRoi {
  const risk = clamp(100 - index.index);
  const roiRaw = index.contributions.reduce((sum, contribution) => {
    const ease = DIMENSION_EASE[contribution.dimension] ?? DEFAULT_EASE;
    return sum + ease * (100 - contribution.score) * contribution.weight;
  }, 0);
  const roi = round1(clamp(roiRaw));
  const score = Math.round((risk * roi) / 100);
  return { risk, roi, score, drivers: computeDrivers(index, driverLimit) };
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
