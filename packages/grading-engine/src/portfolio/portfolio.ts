/**
 * portfolio.ts — rank many repos by deterministic risk × ROI.
 *
 * A portfolio entry wraps the structural index with:
 *   • `risk`  = 100 − index
 *   • `roi`   = recoverable index mass (decomposition × fixed ease constants)
 *   • `score` = risk × roi / 100
 *   • the top score drivers (which dimensions to fix, with evidence)
 *   • a peer `benchmark` within the portfolio or a supplied baseline.
 *
 * `analyzePortfolio` also handles repo discovery and local loading; callers
 * that already hold indices can call `rankPortfolio` directly (used by tests).
 */
import { resolve } from "node:path";
import type { GraphSourceFile } from "../analyzers/import-graph";
import type { StructuralIndex } from "../analyzers/structural-index";
import {
  benchmarkIndex,
  type BenchmarkResult,
  type BenchmarkSample,
} from "./benchmark";
import { loadRepoConfig, type RepoRankConfig } from "./config";
import {
  loadFileCache,
  saveFileCache,
  type FileCacheLocationOptions,
} from "./file-cache";
import {
  loadHistory,
  recordSnapshot,
  snapshotFromIndex,
  type DriftAlert,
  type HistoryLocationOptions,
  type IndexSnapshot,
} from "./history";
import {
  type GitDeltaInput,
  type IncrementalScanReport,
} from "./incremental";
import { replayRepoAnalysis } from "./replay";
import {
  analyzeLoadedRepo,
  countLoc,
  discoverRepos,
  inferLanguage,
  loadRepo,
  type LoadedRepo,
} from "./loader";
import { computeRiskRoi, type ScoreDriver } from "./score";

export interface PortfolioRepoInput {
  path: string;
  name?: string;
  mainLanguage?: string;
  totalLoc?: number;
  /** Precomputed index — skips analysis (used by tests and API callers). */
  index?: StructuralIndex;
  /** Or provide source files to analyze deterministically. */
  sourceFiles?: GraphSourceFile[];
  fileTree?: string[];
  packageJson?: string;
}

export interface PortfolioEntry {
  repo: string;
  path: string;
  index: number;
  cohort: string;
  risk: number;
  roi: number;
  score: number;
  drivers: ScoreDriver[];
  benchmark: BenchmarkResult | null;
}

export interface PortfolioReport {
  entries: PortfolioEntry[];
  cohorts: Record<string, number>;
  generatedAt: string;
  summary: string;
}

export interface PortfolioRankOptions {
  /** Minimum exact-cohort size before widening. Defaults to 3. */
  minCohortSize?: number;
  /** Explicit baseline for benchmarking instead of portfolio peers. */
  baseline?: BenchmarkSample[];
  driverLimit?: number;
}

function toLoadedRepo(repo: PortfolioRepoInput): LoadedRepo {
  const sourceFiles = repo.sourceFiles ?? [];
  const fileTree = repo.fileTree ?? sourceFiles.map((file) => file.path);
  return {
    root: repo.path,
    name: repo.name ?? repo.path,
    mainLanguage: repo.mainLanguage ?? inferLanguage(fileTree),
    fileTree,
    sourceFiles,
    packageJson: repo.packageJson ?? "",
    totalLoc: repo.totalLoc ?? countLoc(sourceFiles),
  };
}

/** Rank repos by risk × ROI. Deterministic: same inputs, same order. */
export function rankPortfolio(
  repos: PortfolioRepoInput[],
  options: PortfolioRankOptions = {},
): PortfolioReport {
  const ranked = repos
    .map((repo) => {
      const index = repo.index ?? analyzeLoadedRepo(toLoadedRepo(repo)).index;
      const scored = computeRiskRoi(index, options.driverLimit ?? 5);
      const entry: PortfolioEntry = {
        repo: repo.name ?? repo.path,
        path: repo.path,
        index: index.index,
        cohort: index.normalization.cohort,
        risk: scored.risk,
        roi: scored.roi,
        score: scored.score,
        drivers: scored.drivers,
        benchmark: null,
      };
      return { entry, index };
    })
    .sort(
      (a, b) =>
        b.entry.score - a.entry.score ||
        a.entry.index - b.entry.index ||
        a.entry.repo.localeCompare(b.entry.repo),
    );

  const entries = ranked.map((item) => item.entry);
  const samples: BenchmarkSample[] = entries.map((entry) => ({
    repo: entry.repo,
    index: entry.index,
    cohort: entry.cohort,
  }));
  const minCohortSize = options.minCohortSize ?? 3;
  for (const { entry, index } of ranked) {
    entry.benchmark = benchmarkIndex(index, samples, {
      minSampleSize: minCohortSize,
      baseline: options.baseline,
      subject: entry.repo,
    });
  }

  const cohorts: Record<string, number> = {};
  for (const entry of entries) cohorts[entry.cohort] = (cohorts[entry.cohort] ?? 0) + 1;

  const top = entries[0];
  return {
    entries,
    cohorts,
    generatedAt: new Date().toISOString(),
    summary:
      entries.length === 0
        ? "No repos in portfolio."
        : `${entries.length} repo(s) ranked. Top: ${top.repo} (score ${top.score}, index ${top.index}).`,
  };
}

/** Discover repos under each path (or treat each path as a repo) and rank them. */
export function analyzePortfolio(
  paths: string[],
  options: PortfolioRankOptions = {},
): PortfolioReport {
  const roots = new Set<string>();
  for (const path of paths.length > 0 ? paths : ["."]) {
    for (const repo of discoverRepos(resolve(path))) roots.add(resolve(repo));
  }

  const inputs: PortfolioRepoInput[] = [...roots]
    .sort()
    .map((root) => {
      const loaded = loadRepo(root);
      return {
        path: root,
        name: loaded.name,
        mainLanguage: loaded.mainLanguage,
        totalLoc: loaded.totalLoc,
        sourceFiles: loaded.sourceFiles,
        fileTree: loaded.fileTree,
        packageJson: loaded.packageJson,
      };
    });

  return rankPortfolio(inputs, options);
}

export interface ScanRepoHistoryOptions {
  changedSince?: string | null;
  /** Result of an existing git helper; null/omitted means git unavailable. */
  git?: GitDeltaInput | null;
  history?: HistoryLocationOptions;
  /** Per-file analysis cache location (dir from config/env, default `<repo>/.reporank`). */
  cache?: FileCacheLocationOptions;
  config?: RepoRankConfig;
  forceFull?: boolean;
  /** Deterministic clock injection (tests). */
  now?: string;
}

export interface RepoScanResult {
  repo: string;
  path: string;
  index: number;
  snapshot: IndexSnapshot;
  alerts: DriftAlert[];
  incremental: IncrementalScanReport;
  historyPath: string;
}

/**
 * Analyze one local repo, persist an index snapshot, and report drift +
 * incremental cache state. This is the end-to-end wiring of the history,
 * per-file cache, and incremental replay modules and is what the CLI
 * `portfolio scan` command calls.
 */
export function scanRepoHistory(
  repoRoot: string,
  options: ScanRepoHistoryOptions = {},
): RepoScanResult {
  const root = resolve(repoRoot);
  const loaded = loadRepo(root);
  const config = options.config ?? loadRepoConfig(root);
  const store = loadHistory(root, options.history);
  const cacheOptions: FileCacheLocationOptions = { ...options.cache, config };
  const cache = loadFileCache(root, cacheOptions);
  const scannedAt = options.now ?? new Date().toISOString();

  const replayed = replayRepoAnalysis({
    root,
    mainLanguage: loaded.mainLanguage,
    totalLoc: loaded.totalLoc,
    fileTree: loaded.fileTree,
    sourceFiles: loaded.sourceFiles,
    packageJson: loaded.packageJson,
    cache,
    cursor: store.cursor,
    git: options.git,
    changedSince: options.changedSince,
    forceFull: options.forceFull,
    now: scannedAt,
  });

  saveFileCache(root, replayed.cache, cacheOptions);

  const snapshot = snapshotFromIndex(replayed.index, replayed.incremental.cursor.lastCommit, scannedAt);
  const recorded = recordSnapshot(root, snapshot, { ...options.history, config });

  return {
    repo: loaded.name,
    path: root,
    index: snapshot.index,
    snapshot,
    alerts: recorded.alerts,
    incremental: replayed.incremental,
    historyPath: recorded.historyPath,
  };
}
