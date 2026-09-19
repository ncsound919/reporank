/**
 * config.ts — read the optional per-repo `reporank.config.json`.
 *
 * Only the fields this portfolio/longitudinal work owns are read here. The
 * existing structural layer rules are still read from `sourceFiles` by
 * structural.ts, so behaviour there is unchanged. Everything is best-effort:
 * a missing or malformed config yields `{}` and the documented defaults.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface RepoRankConfig {
  drift?: {
    /** Absolute score drop that triggers a regression alert. Default 5. */
    threshold?: number;
    /** Per-dimension overrides for the threshold. */
    dimensions?: Record<string, number>;
  };
  history?: {
    /** Directory for `history.json` (overrides the `<repo>/.reporank` default). */
    dir?: string;
  };
  cache?: {
    /** Directory for the per-file `cache.json` (overrides the `<repo>/.reporank` default). */
    dir?: string;
  };
  benchmark?: {
    /** Minimum same-cohort sample before widening the cohort. Default 3. */
    minSampleSize?: number;
  };
  duplication?: {
    /** Jaccard similarity required for a cross-repo duplicate. Default 0.8. */
    minSimilarity?: number;
    /** Minimum shared shingles required. Default 8. */
    minSharedShingles?: number;
    /** Shingle size in tokens. Default 5. */
    shingleSize?: number;
  };
}

export const CONFIG_FILENAMES = ["reporank.config.json", ".reporank.json"] as const;

export const DEFAULT_DRIFT_THRESHOLD = 5;

/** Load `reporank.config.json` (or `.reporank.json`) from a repo root. */
export function loadRepoConfig(repoRoot: string): RepoRankConfig {
  for (const name of CONFIG_FILENAMES) {
    const path = join(repoRoot, name);
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as RepoRankConfig;
      }
    } catch {
      // Malformed config is ignored rather than crashing a scan.
    }
  }
  return {};
}

/** Resolve the effective drift threshold for a dimension (override > global > default). */
export function resolveDriftThreshold(config: RepoRankConfig | undefined, dimension: string): number {
  const specific = config?.drift?.dimensions?.[dimension];
  if (typeof specific === "number" && Number.isFinite(specific) && specific >= 0) return specific;
  const global = config?.drift?.threshold;
  if (typeof global === "number" && Number.isFinite(global) && global >= 0) return global;
  return DEFAULT_DRIFT_THRESHOLD;
}
