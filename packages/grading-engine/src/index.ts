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
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: buildGradingPrompt(input, scannerResults),
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
  }

  async dispose(): Promise<void> {
    (this.ai as any) = null;
  }
}

export { buildGradingPrompt } from "./promptBuilder";
export { parseHealthReport } from "./responseParser";
