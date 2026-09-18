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
