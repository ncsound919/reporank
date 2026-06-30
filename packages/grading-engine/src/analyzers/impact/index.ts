/**
 * impact/index.ts — barrel shim for sub-domain testability.
 *
 * Re-exports every named export from the parent impact.ts so that
 * individual scoring functions can be imported in unit tests without
 * pulling in the entire 25kb module as an opaque blob.
 *
 * Usage in tests:
 *   import { predictImpact, breakdownImpact } from '../impact';
 *   import { calculateSoftware20Score } from '../impact';
 */
export {
  predictImpact,
  calculateSoftware20Score,
  breakdownImpact,
  generateRecommendations,
  EFFORT_LABELS,
  type FileChange,
  type FileChangeKind,
  type FileImpact,
  type ImpactReport,
  type Software20Score,
  type ImpactBreakdown,
  type CategoryContribution,
  type ImpactCategory,
  type FixRecommendation,
  type FixEffort,
  type FixType,
  type RecommendationReport,
} from '../impact';
