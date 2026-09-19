/**
 * static-grade.ts — Deterministic, LLM-free scoring entrypoint.
 *
 * Usage:
 *   import { gradeRepoStatic } from './static-grade';
 *   const report = gradeRepoStatic(input, scannerResults);
 *
 * CLI flag:
 *   reporank analyze <folder> --no-llm
 *
 * When --no-llm is set, the GradingService (Gemini) is bypassed entirely.
 * The output is a StaticHealthReport that contains all static-analyzer
 * findings and a deterministic composite score derived solely from
 * structural-index.ts — identical across every invocation for the same input.
 *
 * The score is an evidence-first index: it decomposes into per-dimension
 * contributions, each listing the exact findings that produced it. An LLM
 * grade, if one exists elsewhere, is narrative only and never sets this number.
 */
import type { GradeInput, ScannerResults } from './index';
import { aggregateFileScores, buildWorstFiles, generateTopRecommendations } from './analyzers/aggregator';
import type { AnalysisResult } from './analyzers/aggregator';
import type { SecurityGroup } from './analyzers/security';
import type { StructuralReport } from './analyzers/structural';
import type { DeadCodeReport } from './analyzers/dead-code';
import {
  computeStructuralIndex,
  type DimensionContribution,
  type IndexNormalization,
} from './analyzers/structural-index';

export interface StaticHealthReport {
  repoOwner: string;
  repoName: string;
  mainLanguage: string;
  starsCount: number;
  forksCount: number;
  openIssuesCount: number;
  lastPushedAt: string;
  scannedAt: string;
  /** Composite index 0-100 derived from static analyzers only — fully deterministic. */
  staticScore: number;
  /** Alias of `staticScore`, named for what it is: the deterministic index. */
  index: number;
  /** Per-dimension decomposition: score, weight, raw mass, and the findings behind it. */
  decomposition: DimensionContribution[];
  /** Size/language cohort and its expected baseline (see structural-index.ts). */
  normalization: IndexNormalization;
  /** Dimensions that could not be measured honestly (excluded from the index). */
  unmeasured: string[];
  /** Human-readable formula, so the number is auditable without reading source. */
  indexFormula: string;
  worstFiles: { path: string; score: number; reasons: string[] }[];
  topRecommendations: string[];
  /** Security posture from measured tools, when provided. */
  security?: SecurityGroup['summary'];
  /** Signals that this report was produced without LLM assistance. */
  mode: 'static';
}

/**
 * Builds a deterministic index from static analyzer results.
 * No LLM calls are made. Every invocation with the same input produces
 * the same output.
 */
export function gradeRepoStatic(
  input: GradeInput,
  scannerResults: ScannerResults,
): StaticHealthReport {
  // Build a minimal AnalysisResult from whatever sub-analyzers ran.
  // Missing analyzers default to empty findings so the aggregator always
  // receives a valid shape.
  const analysisResult: AnalysisResult = {
    complexity: (scannerResults.complexity as any) ?? {
      hotSpots: [], fileSizeDistribution: { small: 0, medium: 0, large: 0, xlarge: 0 },
      longestFiles: [], worstFiles: [], cohesionViolations: [], summary: 'not run',
    },
    dependencies: (scannerResults.dependencies as any) ?? {
      findings: [], depHealthScore: 100, unusedPatterns: [], summary: 'not run',
    },
    architecture: (scannerResults.architecture as any) ?? {
      findings: [], summary: 'not run',
    },
    production: (scannerResults.production as any) ?? {
      findings: [], deployBlockers: [], overallReadiness: 'unknown', summary: 'not run',
    },
    codeHygiene: (scannerResults.codeHygiene as any) ?? {
      findings: [], summary: 'not run',
    },
    enterprise: (scannerResults.enterprise as any) ?? {
      apiContract: { findings: [], apiSurface: [], consistencyScore: 100, seniorSummary: '' },
      observability: { findings: [], observabilityScore: 100, seniorSummary: '' },
      buildCI: { findings: [], ciScore: 100, seniorSummary: '' },
      coupling: { findings: [], couplingScore: 100, seniorSummary: '' },
      license: { findings: [], licenseScore: 100, seniorSummary: '' },
      longTermDebt: { findings: [], debtScore: 100, seniorSummary: '' },
      overallSeniorScore: 100,
      criticalBlockers: [],
      seniorSummary: '',
      rawPromptBlock: '',
    },
    security: (scannerResults.security as SecurityGroup) ?? undefined,
    structure: (scannerResults.structure as StructuralReport) ?? undefined,
    deadCode: (scannerResults.deadCode as DeadCodeReport) ?? undefined,
  };

  const fileScores = aggregateFileScores(analysisResult);
  const worstFiles = buildWorstFiles(fileScores, 10);
  const topRecommendations = generateTopRecommendations(analysisResult);

  // Total LOC is used only for cohort normalization, never as a score divisor.
  const totalLoc = input.sourceFiles.reduce((s, f) => s + f.content.split(/\r?\n/).length, 0);

  const index = computeStructuralIndex(analysisResult, {
    mainLanguage: input.mainLanguage,
    totalLoc,
    structure: analysisResult.structure,
    deadCode: analysisResult.deadCode,
  });

  return {
    repoOwner: input.repoOwner,
    repoName: input.repoName,
    mainLanguage: input.mainLanguage,
    starsCount: input.starsCount,
    forksCount: input.forksCount,
    openIssuesCount: input.openIssuesCount,
    lastPushedAt: input.lastPushedAt,
    scannedAt: new Date().toISOString(),
    staticScore: index.index,
    index: index.index,
    decomposition: index.contributions,
    normalization: index.normalization,
    unmeasured: index.unmeasured,
    indexFormula: index.formula,
    worstFiles,
    topRecommendations,
    security: analysisResult.security?.summary,
    mode: 'static',
  };
}
