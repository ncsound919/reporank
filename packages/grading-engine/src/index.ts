import { callLLM } from "@overlay365/fleet-client";
import type { HealthReport } from "@reporank/shared-types";
import { buildGradingPrompt } from "./promptBuilder";
import { parseHealthReport } from "./responseParser";
import type { ComplexityReport } from "./analyzers/complexity";
import type { DependencyReport } from "./analyzers/dependency-health";
import type { ArchitectureReport } from "./analyzers/architecture";
import type { ProductionReport } from "./analyzers/production";
import type { CodeHygieneReport } from "./analyzers/code-hygiene";
import type { EnterpriseReport } from "./analyzers/enterprise";

export interface GradeInput {
  repoUrl: string; repoName: string; repoOwner: string;
  mainLanguage: string; starsCount: number; forksCount: number;
  openIssuesCount: number; lastPushedAt: string;
  readmeContent: string; packageJson: string;
  fileTree: string[]; sourceFiles: { path: string; content: string }[];
}

export interface ScannerResults {
  complexity?: ComplexityReport;
  dependencies?: DependencyReport;
  architecture?: ArchitectureReport;
  production?: ProductionReport;
  codeHygiene?: CodeHygieneReport;
  enterprise?: EnterpriseReport;
  worstFiles?: { path: string; score: number; reasons: string[] }[];
  topRecommendations?: string[];
  rawPromptBlock?: string;
  perFile?: Record<string, unknown>;
  [key: string]: unknown;
}

export class GradingService {
  constructor() {
    // LLM access routes through the fleet chain (@overlay365/fleet-client:
    // openrouter -> opencode Go -> deepseek -> ollama). No per-agent SDK, no
    // GEMINI_API_KEY; keys resolve from the environment by the chain client.
  }

  async gradeRepo(input: GradeInput, scannerResults?: ScannerResults): Promise<HealthReport> {
    const prompt = buildGradingPrompt(input, scannerResults);
    const MAX_RETRIES = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const text = await callLLM({
          system: "You are a strict repository health grader. Respond with ONLY the JSON object - no prose, no markdown fences.",
          userMessage: prompt,
          maxTokens: 4096,
          temperature: 0.2,
          responseFormat: { type: 'json_object' },
        });
        if (!text) throw new Error("Empty response from LLM chain");

        const report = parseHealthReport(text);
        report.repoOwner = input.repoOwner;
        report.repoName = input.repoName;
        report.mainLanguage = input.mainLanguage;
        report.starsCount = input.starsCount;
        report.forksCount = input.forksCount;
        report.openIssuesCount = input.openIssuesCount;
        report.lastPushedAt = input.lastPushedAt;
        report.scannedAt = new Date().toISOString();
        return report;
      } catch (err: any) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1) + Math.random() * 1000, 8000);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw lastError || new Error("LLM chain request failed after retries");
  }

  async dispose(): Promise<void> {}
}

export { buildGradingPrompt } from "./promptBuilder";
export { parseHealthReport } from "./responseParser";
export { runDeepAnalysis } from "./analyzers/index";
export {
  analyzeStructure,
  parseLayerRules,
  findImportCycles,
  detectLayerViolations,
  computeModuleCoupling,
  DEFAULT_LAYER_RULES,
  buildModuleGraph,
  computeStructuralIndex,
  type StructuralReport,
  type StructuralFinding,
  type StructuralSeverity,
  type ImportCycle,
  type ModuleCoupling,
  type LayerRule,
  type ModuleGraph,
  type GraphSourceFile,
  type StructuralIndex,
  type StructuralIndexOptions,
  type DimensionContribution,
  type IndexFinding,
  type IndexNormalization,
  type IndexSeverity,
} from "./analyzers/index";
export {
  securityFromAuditReport,
  emptySecurityGroup,
  type SecurityGroup,
  type SecurityFinding,
  type SecuritySeverity,
  type AuditReportLike,
} from "./analyzers/security";
export { gradeRepoStatic, type StaticHealthReport } from "./static-grade";
export { calculateVibeCodingIndex } from "./analyzers/contamination";
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
} from "./analyzers/impact";
export {
  auditSubmission,
  analyzeSession,
  type AuditReport,
  type ChatTurn,
  type CourseGuideline,
  type DisclosureLayer,
  type Layer1Report,
  type Layer2Report,
  type Layer3Report,
  type Layer4Report,
  type SessionAnalysis,
  type SessionInput,
  type SubmissionInput,
} from "./analyzers/education";
export {
  calculateTrustScore,
  type TrustScoreInput,
  type TrustScoreResult,
} from "./analyzers/trust";
export {
  BENCHMARK_DATASET,
  getBenchmarksByKind,
  calibrate,
  type BenchmarkEntry,
  type CalibrationResult,
} from "./analyzers/benchmark";
export {
  loadRepoConfig,
  resolveDriftThreshold,
  DEFAULT_DRIFT_THRESHOLD,
  CONFIG_FILENAMES,
  createEmptyHistory,
  loadHistory,
  saveHistory,
  resolveHistoryPath,
  snapshotFromIndex,
  diffSnapshots,
  recordSnapshot,
  HISTORY_VERSION,
  HISTORY_FILENAME,
  planIncrementalScan,
  normalizeFileList,
  hashFileContent,
  resolveFileCachePath,
  createEmptyFileCache,
  loadFileCache,
  saveFileCache,
  FILE_CACHE_VERSION,
  FILE_CACHE_FILENAME,
  replayRepoAnalysis,
  evaluateBudget,
  budgetExitCode,
  unknownBudgetDimensions,
  parseDimensionBudgets,
  computeRiskRoi,
  computeDrivers,
  DIMENSION_EASE,
  DEFAULT_EASE,
  benchmarkIndex,
  percentileOf,
  cohortKey,
  languageCohort,
  DEFAULT_MIN_SAMPLE_SIZE,
  buildCrossRepoReport,
  codeFingerprint,
  normalizeCode,
  tokenizeCode,
  loadRepo,
  discoverRepos,
  isRepoRoot,
  inferLanguage,
  countLoc,
  analyzeLoadedRepo,
  rankPortfolio,
  analyzePortfolio,
  scanRepoHistory,
  SOURCE_EXTENSIONS,
  type RepoRankConfig,
  type HistoryStore,
  type IndexSnapshot,
  type ScanCursor,
  type DriftAlert,
  type DriftSeverity,
  type HistoryLocationOptions,
  type RecordSnapshotResult,
  type IncrementalPlan,
  type IncrementalPlanInput,
  type IncrementalReport,
  type IncrementalScanReport,
  type GitDeltaInput,
  type FileCacheEntry,
  type FileCacheStore,
  type FileCacheLocationOptions,
  type ReplayInput,
  type ReplayResult,
  type DimensionBudget,
  type BudgetOptions,
  type BudgetDriver,
  type BudgetBreach,
  type BudgetReport,
  type ParsedDimensionBudgets,
  type RiskRoi,
  type ScoreDriver,
  type BenchmarkResult,
  type BenchmarkOptions,
  type BenchmarkSample,
  type PercentileResult,
  type CrossRepoInput,
  type CrossRepoEdge,
  type CrossRepoReport,
  type CrossRepoOptions,
  type DuplicateFinding,
  type DuplicateLocation,
  type LoadedRepo,
  type LoadRepoOptions,
  type RepoAnalysis,
  type PortfolioRepoInput,
  type PortfolioEntry,
  type PortfolioReport,
  type PortfolioRankOptions,
  type ScanRepoHistoryOptions,
  type RepoScanResult,
} from "./portfolio/index";
export {
  parseQualityProfile,
  parseIssueReport,
  parseQualityGate,
  mapProfileToRepoRank,
  mapIssuesToRepoRank,
  mapQualityGateToThresholds,
  generateMigrationReport,
  generateRepoRankConfig,
  type SonarQubeSeverity,
  type RepoRankCategory,
  type SonarQubeRule,
  type SonarQubeProfile,
  type SonarQubeIssue,
  type SonarQubeIssueReport,
  type SonarQubeQualityGateCondition,
  type SonarQubeQualityGate,
  type RepoRankRuleMapping,
  type RepoRankIssueMapping,
  type RepoRankThresholdConfig,
  type MigrationReport,
} from "./importers/sonarqube";
