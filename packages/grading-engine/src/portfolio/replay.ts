/**
 * replay.ts — per-file incremental replay of the structural index.
 *
 * The index is a pure function of analyzer findings. Some analyzers are
 * file-local (a file's result depends only on that file) and some are
 * graph-level (a finding depends on the whole import graph). This module
 * exploits that split:
 *
 *   • File-local work (`analyzeComplexity` hot spots, `scanCodeHygiene`) is
 *     cached per content hash and reused for unchanged files.
 *   • Graph-level work (`analyzeStructure`, `analyzeArchitecture`,
 *     `analyzeDependencies`, `analyzeProductionReadiness`,
 *     `runEnterpriseAnalysis`, `generateDeadCodePlan`) is always recomputed
 *     from the full source set, because a per-file cache cannot honestly claim
 *     those findings are independent of the rest of the tree.
 *
 * Because the merged inputs are byte-identical to a full run, the resulting
 * `StructuralIndex` is identical whether replayed incrementally or fully. The
 * `incremental` report counts only cache work that actually happened.
 */
import { analyzeArchitecture } from "../analyzers/architecture";
import type { AnalysisResult } from "../analyzers/aggregator";
import { scanCodeHygiene, type CodeHygieneFinding, type CodeHygieneReport } from "../analyzers/code-hygiene";
import { analyzeComplexity, type ComplexityReport, type FileHotSpot } from "../analyzers/complexity";
import { generateDeadCodePlan } from "../analyzers/dead-code";
import { analyzeDependencies } from "../analyzers/dependency-health";
import { runEnterpriseAnalysis } from "../analyzers/enterprise";
import type { GraphSourceFile } from "../analyzers/import-graph";
import { analyzeProductionReadiness } from "../analyzers/production";
import { analyzeStructure } from "../analyzers/structural";
import { computeStructuralIndex, type StructuralIndex } from "../analyzers/structural-index";
import {
  FILE_CACHE_VERSION,
  hashFileContent,
  type FileCacheEntry,
  type FileCacheStore,
} from "./file-cache";
import type { ScanCursor } from "./history";
import {
  planIncrementalScan,
  type GitDeltaInput,
  type IncrementalScanReport,
} from "./incremental";
import { countLoc } from "./loader";

export interface ReplayInput {
  root: string;
  mainLanguage: string;
  totalLoc: number;
  fileTree: string[];
  sourceFiles: GraphSourceFile[];
  packageJson: string;
  /** Previously persisted per-file cache (empty when none exists). */
  cache: FileCacheStore;
  /** Cursor persisted by the previous scan. */
  cursor?: ScanCursor | null;
  /** Result of an existing git helper; null/omitted means git unavailable. */
  git?: GitDeltaInput | null;
  changedSince?: string | null;
  forceFull?: boolean;
  /** Deterministic clock injection (defaults to now). */
  now?: string;
}

export interface ReplayResult {
  index: StructuralIndex;
  incremental: IncrementalScanReport;
  /** The cache to persist (only current files remain). */
  cache: FileCacheStore;
  reused: string[];
  changed: string[];
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function buildComplexityReport(sourceFiles: GraphSourceFile[], hotSpots: FileHotSpot[]): ComplexityReport {
  const fileSizeDistribution = { small: 0, medium: 0, large: 0, xlarge: 0 };
  const longestFiles = sourceFiles.map((file) => ({
    path: file.path,
    lines: file.content.split("\n").length,
  }));
  for (const entry of longestFiles) {
    if (entry.lines <= 100) fileSizeDistribution.small++;
    else if (entry.lines <= 300) fileSizeDistribution.medium++;
    else if (entry.lines <= 600) fileSizeDistribution.large++;
    else fileSizeDistribution.xlarge++;
  }
  longestFiles.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
  return {
    hotSpots,
    fileSizeDistribution,
    longestFiles: longestFiles.slice(0, 5),
    worstFiles: [],
    cohesionViolations: [],
    summary: `${sourceFiles.length} files analyzed (replayed from the per-file cache where unchanged).`,
  };
}

function buildCodeHygieneReport(sourceFiles: GraphSourceFile[], findings: CodeHygieneFinding[]): CodeHygieneReport {
  const categoriesFound = [...new Set(findings.map((finding) => finding.category))].sort();
  const totalLines = sourceFiles.reduce((sum, file) => sum + file.content.split("\n").length, 0) || 1;
  const score = Math.round(Math.max(0, Math.min(100, 100 - (findings.length / totalLines) * 100 * 10)));
  return {
    findings,
    totalCount: findings.length,
    categoriesFound,
    score,
    summary: `${findings.length} code hygiene issues (replayed). Score: ${score}/100.`,
  };
}

/**
 * Analyze a loaded repo, reusing cached file-local findings for unchanged
 * files. Graph-level analyzers always run over the full source set.
 */
export function replayRepoAnalysis(input: ReplayInput): ReplayResult {
  const now = input.now ?? new Date().toISOString();
  const sourceFiles = [...input.sourceFiles].sort((a, b) => a.path.localeCompare(b.path));
  const allFiles = sourceFiles.map((file) => file.path);

  const plan = planIncrementalScan({
    cursor: input.cursor,
    git: input.git,
    allFiles,
    changedSince: input.changedSince,
    forceFull: input.forceFull,
  });
  const forcedChanged = new Set(plan.incremental.changedFiles);

  const hotSpots: FileHotSpot[] = [];
  const hygiene: CodeHygieneFinding[] = [];
  const entries: Record<string, FileCacheEntry> = {};
  const changed: string[] = [];
  const reused: string[] = [];
  let reusedFindings = 0;

  for (const file of sourceFiles) {
    const path = file.path;
    const cached = input.cache.entries[path];
    const hash = hashFileContent(file.content);
    const canReuse = !forcedChanged.has(path) && cached !== undefined && cached.hash === hash;

    if (canReuse && cached) {
      hotSpots.push(...cached.hotSpots);
      hygiene.push(...cached.hygiene);
      reusedFindings += cached.hotSpots.length + cached.hygiene.length;
      entries[path] = cached;
      reused.push(path);
      continue;
    }

    const local = analyzeComplexity(input.root, [file]);
    const localHygiene = scanCodeHygiene([file]);
    hotSpots.push(...local.hotSpots);
    hygiene.push(...localHygiene.findings);
    entries[path] = {
      hash,
      loc: countLoc([file]),
      hotSpots: local.hotSpots,
      hygiene: localHygiene.findings,
      updatedAt: now,
    };
    changed.push(path);
  }

  const complexity = buildComplexityReport(sourceFiles, hotSpots);
  const codeHygiene = buildCodeHygieneReport(sourceFiles, hygiene);
  const dependencies = analyzeDependencies(input.packageJson, sourceFiles);
  const architecture = analyzeArchitecture(input.fileTree, sourceFiles);
  const production = analyzeProductionReadiness(sourceFiles, input.fileTree);
  const enterprise = runEnterpriseAnalysis(input.fileTree, sourceFiles);
  const structure = analyzeStructure(sourceFiles);
  const deadCode = generateDeadCodePlan(sourceFiles);

  const result: AnalysisResult = {
    complexity,
    dependencies,
    architecture,
    production,
    codeHygiene,
    enterprise,
    structure,
    deadCode,
  };

  const index = computeStructuralIndex(result, {
    mainLanguage: input.mainLanguage,
    totalLoc: input.totalLoc,
    structure,
    deadCode,
  });

  const total = sourceFiles.length;
  const incremental: IncrementalScanReport = {
    cursor: { lastCommit: plan.incremental.cursor.lastCommit, lastScannedAt: now },
    changedFiles: changed.sort((a, b) => a.localeCompare(b)),
    reusedFiles: reused.length,
    reusedFindings,
    cacheHitRate: total === 0 ? 0 : round3(reused.length / total),
  };

  return {
    index,
    incremental,
    cache: { ...input.cache, version: FILE_CACHE_VERSION, repo: input.root, algo: "sha256", entries },
    reused,
    changed,
  };
}
