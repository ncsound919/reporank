/**
 * incremental.ts — per-repo incremental scan cursor.
 *
 * This module owns only the *semantics* of incremental scanning. Disk/git I/O
 * is injected: callers hand in the result of an existing git helper
 * (`{ commit, changed }`) plus the current file list. That keeps the module
 * pure, deterministic, and testable without a real repository, and avoids
 * re-implementing git plumbing.
 *
 * Semantics
 * ---------
 *   • No `changedSince` (or `forceFull`)      -> full scan; every file changed.
 *   • `changedSince` + git delta available    -> only files git reports as
 *                                                changed are re-analyzed; the
 *                                                rest are reported as reused.
 *   • `changedSince` + no git delta available -> falls back to a full scan
 *                                                (never claims a delta it cannot
 *                                                substantiate).
 */
import type { ScanCursor } from "./history";

export interface GitDeltaInput {
  commit: string | null;
  /** Repo-relative changed paths, from the existing git helper. */
  changed: string[];
}

export interface IncrementalPlanInput {
  /** Cursor persisted by the previous scan. */
  cursor?: ScanCursor | null;
  /** Result of an existing git helper; `null` when git is unavailable. */
  git?: GitDeltaInput | null;
  /** Repo-relative source files currently on disk. */
  allFiles: string[];
  /** Re-analyze only files changed since this ref. */
  changedSince?: string | null;
  /** Ignore the delta and report a full scan. */
  forceFull?: boolean;
}

export interface IncrementalReport {
  cursor: ScanCursor;
  /** Files that must be (re-)analyzed. */
  changedFiles: string[];
  /** Files whose prior analysis can be reused unchanged. */
  reused: string[];
}

/**
 * The `incremental` block embedded in a real scan result. Unlike the plan
 * report above, every number here is derived from the on-disk per-file cache —
 * `reusedFindings` counts findings actually loaded from cache and
 * `cacheHitRate` is reused files / total files. No fabricated savings.
 */
export interface IncrementalScanReport {
  cursor: ScanCursor;
  /** Files actually (re-)analyzed this scan (git delta + cache misses). */
  changedFiles: string[];
  /** Number of files served from the per-file cache. */
  reusedFiles: number;
  /** Number of per-file findings loaded from cache. */
  reusedFindings: number;
  /** reusedFiles / totalFiles, 0 when the tree is empty. */
  cacheHitRate: number;
}

export interface IncrementalPlan {
  mode: "full" | "changed";
  changedSince: string | null;
  /** The `incremental` block to embed in scan output. */
  incremental: IncrementalReport;
}

/** Normalize to forward slashes, drop `./`, dedupe, and sort for determinism. */
export function normalizeFileList(files: string[]): string[] {
  const seen = new Set<string>();
  for (const file of files) {
    if (typeof file !== "string") continue;
    const normalized = file.replace(/\\/g, "/").replace(/^\.\//, "").trim();
    if (normalized) seen.add(normalized);
  }
  return [...seen].sort();
}

function buildPlan(
  mode: "full" | "changed",
  changedSince: string | null,
  cursor: ScanCursor,
  changedFiles: string[],
  reused: string[],
): IncrementalPlan {
  return {
    mode,
    changedSince,
    incremental: { cursor, changedFiles, reused },
  };
}

export function planIncrementalScan(input: IncrementalPlanInput): IncrementalPlan {
  const allFiles = normalizeFileList(input.allFiles);
  const cursor: ScanCursor = {
    lastCommit: input.git?.commit ?? input.cursor?.lastCommit ?? null,
    lastScannedAt: input.cursor?.lastScannedAt ?? null,
  };

  const wantsChanged = Boolean(input.changedSince) && !input.forceFull;
  if (!wantsChanged) {
    return buildPlan("full", null, cursor, allFiles, []);
  }

  const gitChanged = input.git ? normalizeFileList(input.git.changed) : null;
  if (!gitChanged) {
    // Git unavailable: we cannot substantiate a delta, so scan everything.
    return buildPlan("full", input.changedSince ?? null, cursor, allFiles, []);
  }

  const allSet = new Set(allFiles);
  const changedFiles = gitChanged.filter((file) => allSet.has(file));
  const changedSet = new Set(changedFiles);
  const reused = allFiles.filter((file) => !changedSet.has(file));
  return buildPlan("changed", input.changedSince ?? null, cursor, changedFiles, reused);
}
