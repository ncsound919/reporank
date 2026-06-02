import { GoogleGenAI } from "@google/genai";
import type { HealthReport } from "@reporank/shared-types";
import { buildGradingPrompt } from "./promptBuilder";
import { parseHealthReport } from "./responseParser";

export interface GradeInput {
  repoUrl: string; repoName: string; repoOwner: string;
  mainLanguage: string; starsCount: number; forksCount: number;
  openIssuesCount: number; lastPushedAt: string;
  readmeContent: string; packageJson: string;
  fileTree: string[]; sourceFiles: { path: string; content: string }[];
}

export interface ScannerResults { [key: string]: unknown }

export class GradingService {
  private ai: GoogleGenAI;
  constructor(private apiKey: string, private model: string = "gemini-2.5-flash") {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async gradeRepo(input: GradeInput, scannerResults?: ScannerResults): Promise<HealthReport> {
    const prompt = buildGradingPrompt(input, scannerResults);
    const MAX_RETRIES = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.ai.models.generateContent({
          model: this.model,
          contents: prompt,
          config: { temperature: 0.2, responseMimeType: "application/json" },
        });

        const text = response.text;
        if (!text) throw new Error("Empty response from Gemini");

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
    throw lastError || new Error("Gemini request failed after retries");
  }

  async dispose(): Promise<void> {
    (this.ai as any) = null;
  }
}

export { buildGradingPrompt } from "./promptBuilder";
export { parseHealthReport } from "./responseParser";
export { runDeepAnalysis } from "./analyzers/index";
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
