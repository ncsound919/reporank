/**
 * static-grade.ts — Deterministic, LLM-free scoring entrypoint.
 *
 * Usage:
 *   import { gradeRepoStatic } from './static-grade';
 *   const report = await gradeRepoStatic(input, scannerResults);
 *
 * CLI flag:
 *   reporank analyze <folder> --no-llm
 *
 * When --no-llm is set, the GradingService (Gemini) is bypassed entirely.
 * The output is a StaticHealthReport that contains all static-analyzer
 * findings and a deterministic composite score derived solely from
 * aggregator.ts weights — identical across every invocation for the same input.
 */
import type { GradeInput, ScannerResults } from './index';
import { aggregateFileScores, buildWorstFiles, generateTopRecommendations } from './analyzers/aggregator';
import type { AnalysisResult } from './analyzers/aggregator';

export interface StaticHealthReport {
  repoOwner: string;
  repoName: string;
  mainLanguage: string;
  starsCount: number;
  forksCount: number;
  openIssuesCount: number;
  lastPushedAt: string;
  scannedAt: string;
  /** Composite score 0-100 derived from static analyzers only — fully deterministic. */
  staticScore: number;
  worstFiles: { path: string; score: number; reasons: string[] }[];
  topRecommendations: string[];
  /** Signals that this report was produced without LLM assistance. */
  mode: 'static';
}

/**
 * Builds a deterministic score from static analyzer results.
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
  };

  const fileScores = aggregateFileScores(analysisResult);
  const worstFiles = buildWorstFiles(fileScores, 10);
  const topRecommendations = generateTopRecommendations(analysisResult);

  // Composite score: start at 100, penalise by severity weights.
  // Critical findings cost 30 pts each (capped at 100 total deduction).
  const allFindings = [
    ...analysisResult.complexity.hotSpots,
    ...analysisResult.dependencies.findings,
    ...analysisResult.architecture.findings,
    ...analysisResult.production.findings,
    ...analysisResult.codeHygiene.findings,
    ...analysisResult.enterprise.apiContract.findings,
    ...analysisResult.enterprise.observability.findings,
    ...analysisResult.enterprise.buildCI.findings,
    ...analysisResult.enterprise.coupling.findings,
    ...analysisResult.enterprise.license.findings,
    ...analysisResult.enterprise.longTermDebt.findings,
  ] as { severity: string }[];

  const PENALTY: Record<string, number> = { critical: 8, high: 4, medium: 2, low: 0.5 };
  const totalPenalty = allFindings.reduce((sum, f) => sum + (PENALTY[f.severity] ?? 0), 0);
  const staticScore = Math.max(0, Math.round(100 - Math.min(totalPenalty, 100)));

  return {
    repoOwner: input.repoOwner,
    repoName: input.repoName,
    mainLanguage: input.mainLanguage,
    starsCount: input.starsCount,
    forksCount: input.forksCount,
    openIssuesCount: input.openIssuesCount,
    lastPushedAt: input.lastPushedAt,
    scannedAt: new Date().toISOString(),
    staticScore,
    worstFiles,
    topRecommendations,
    mode: 'static',
  };
}
