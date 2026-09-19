/**
 * history.ts — deterministic longitudinal index history + drift alerts.
 *
 * Every scan can append a snapshot (headline index + per-dimension scores) to
 * a local JSON store. No database, no network, no LLM. The store is also the
 * home of the incremental scan cursor so a repo has exactly one small state
 * file: `<repo>/.reporank/history.json` (overridable via env or config).
 *
 * Drift is computed only between the previous snapshot and the new one, per
 * dimension, against a configurable drop threshold. A dimension that improves
 * (or holds) never alerts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { StructuralIndex } from "../analyzers/structural-index";
import {
  DEFAULT_DRIFT_THRESHOLD,
  loadRepoConfig,
  resolveDriftThreshold,
  type RepoRankConfig,
} from "./config";

export const HISTORY_VERSION = 1;
export const HISTORY_FILENAME = "history.json";

export interface ScanCursor {
  lastCommit: string | null;
  lastScannedAt: string | null;
}

export interface IndexSnapshot {
  commit: string | null;
  /** ISO-8601 timestamp. */
  scannedAt: string;
  index: number;
  /** dimension -> score (0..100). */
  dimensions: Record<string, number>;
  cohort: string;
  normalizedIndex: number;
  unmeasured: string[];
}

export interface HistoryStore {
  version: number;
  repo: string;
  cursor: ScanCursor;
  snapshots: IndexSnapshot[];
}

export interface HistoryLocationOptions {
  /** Explicit store file. Wins over every other source. */
  storePath?: string;
  /** Directory that contains `history.json`. */
  historyDir?: string;
  /** Environment override (testable without mutating process.env). */
  env?: Record<string, string | undefined>;
  /** Pre-loaded config (avoids re-reading the file). */
  config?: RepoRankConfig;
}

export type DriftSeverity = "critical" | "high" | "medium" | "low";

export interface DriftAlert {
  dimension: string;
  previous: number;
  current: number;
  /** current - previous (negative = regression). */
  delta: number;
  threshold: number;
  severity: DriftSeverity;
}

export interface RecordSnapshotResult {
  store: HistoryStore;
  previous: IndexSnapshot | null;
  snapshot: IndexSnapshot;
  alerts: DriftAlert[];
  historyPath: string;
}

/** Resolve the history file path from explicit options, env, config, or default. */
export function resolveHistoryPath(repoRoot: string, options: HistoryLocationOptions = {}): string {
  if (options.storePath) return resolve(options.storePath);
  if (options.historyDir) return join(options.historyDir, HISTORY_FILENAME);
  const env = options.env ?? process.env;
  if (env.REPORANK_HISTORY_FILE) return resolve(env.REPORANK_HISTORY_FILE);
  if (env.REPORANK_HISTORY_DIR) return join(env.REPORANK_HISTORY_DIR, HISTORY_FILENAME);
  const config = options.config ?? loadRepoConfig(repoRoot);
  if (config.history?.dir) return join(resolve(repoRoot, config.history.dir), HISTORY_FILENAME);
  return join(repoRoot, ".reporank", HISTORY_FILENAME);
}

export function createEmptyHistory(repoRoot: string): HistoryStore {
  return {
    version: HISTORY_VERSION,
    repo: repoRoot,
    cursor: { lastCommit: null, lastScannedAt: null },
    snapshots: [],
  };
}

/** Load the store, degrading to an empty store on a missing/corrupt file. */
export function loadHistory(repoRoot: string, options: HistoryLocationOptions = {}): HistoryStore {
  const path = resolveHistoryPath(repoRoot, options);
  if (!existsSync(path)) return createEmptyHistory(repoRoot);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<HistoryStore>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.snapshots)) {
      return createEmptyHistory(repoRoot);
    }
    return {
      version: HISTORY_VERSION,
      repo: typeof parsed.repo === "string" ? parsed.repo : repoRoot,
      cursor: {
        lastCommit: parsed.cursor?.lastCommit ?? null,
        lastScannedAt: parsed.cursor?.lastScannedAt ?? null,
      },
      snapshots: parsed.snapshots,
    };
  } catch {
    return createEmptyHistory(repoRoot);
  }
}

/** Persist the store. Best-effort creation of the parent directory. */
export function saveHistory(repoRoot: string, store: HistoryStore, options: HistoryLocationOptions = {}): string {
  const path = resolveHistoryPath(repoRoot, options);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  return path;
}

/** Project a computed structural index into a persisted snapshot. */
export function snapshotFromIndex(
  index: StructuralIndex,
  commit: string | null,
  scannedAt: string = new Date().toISOString(),
): IndexSnapshot {
  const dimensions: Record<string, number> = {};
  for (const contribution of index.contributions) {
    dimensions[contribution.dimension] = contribution.score;
  }
  return {
    commit,
    scannedAt,
    index: index.index,
    dimensions,
    cohort: index.normalization.cohort,
    normalizedIndex: index.normalization.normalizedIndex,
    unmeasured: [...index.unmeasured],
  };
}

function severityForDrop(drop: number, threshold: number): DriftSeverity {
  if (threshold <= 0) return "low";
  const ratio = drop / threshold;
  if (ratio >= 3) return "critical";
  if (ratio >= 2) return "high";
  if (ratio >= 1.5) return "medium";
  return "low";
}

/**
 * Compare two snapshots per dimension (plus the headline `index`). Only drops
 * at or beyond the effective threshold produce an alert. Sorted by the largest
 * drop first, then dimension name, for deterministic output.
 */
export function diffSnapshots(
  previous: IndexSnapshot,
  current: IndexSnapshot,
  config?: RepoRankConfig,
): DriftAlert[] {
  const alerts: DriftAlert[] = [];
  const dimensions = new Set<string>(["index", ...Object.keys(previous.dimensions)]);
  for (const key of Object.keys(current.dimensions)) dimensions.add(key);

  for (const dimension of dimensions) {
    const before = dimension === "index" ? previous.index : previous.dimensions[dimension];
    const after = dimension === "index" ? current.index : current.dimensions[dimension];
    if (typeof before !== "number" || typeof after !== "number") continue;
    const delta = after - before;
    if (delta >= 0) continue;
    const threshold = resolveDriftThreshold(config, dimension);
    if (Math.abs(delta) < threshold) continue;
    alerts.push({
      dimension,
      previous: before,
      current: after,
      delta,
      threshold,
      severity: severityForDrop(Math.abs(delta), threshold),
    });
  }

  alerts.sort((a, b) => a.delta - b.delta || a.dimension.localeCompare(b.dimension));
  return alerts;
}

/**
 * Append a snapshot, advance the cursor, and return the drift alerts raised
 * against the previous snapshot (if any).
 */
export function recordSnapshot(
  repoRoot: string,
  snapshot: IndexSnapshot,
  options: HistoryLocationOptions = {},
): RecordSnapshotResult {
  const historyPath = resolveHistoryPath(repoRoot, options);
  const store = loadHistory(repoRoot, { ...options, storePath: historyPath });
  const previous = store.snapshots.length > 0 ? store.snapshots[store.snapshots.length - 1] : null;
  const config = options.config ?? loadRepoConfig(repoRoot);
  const alerts = previous ? diffSnapshots(previous, snapshot, config) : [];

  store.repo = repoRoot;
  store.snapshots.push(snapshot);
  store.cursor = { lastCommit: snapshot.commit, lastScannedAt: snapshot.scannedAt };
  saveHistory(repoRoot, store, { ...options, storePath: historyPath });

  return { store, previous, snapshot, alerts, historyPath };
}

export { DEFAULT_DRIFT_THRESHOLD };
