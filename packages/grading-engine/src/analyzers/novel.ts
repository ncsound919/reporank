/**
 * Novel Analyzers Bundle — features no other code review tool offers.
 * Architecture diagrams, tech debt interest, dead code plans, README generation,
 * bus factor, risk heatmap, test gaps, change coupling, tech debt ratio.
 */
import { generateArchitectureDiagram, type ArchitectureDiagram } from "./arch-visualizer";
import { calculateTechDebt, type TechDebtReport } from "./tech-debt";
import { generateDeadCodePlan, type DeadCodeReport } from "./dead-code";
import { generateReadme, type GeneratedReadme } from "./readme-gen";
import { analyzeAiCode, type AiCodeReport } from "./ai-code";
import {
  analyzeBusFactor, type BusFactorItem,
  analyzeRiskHeatmap, type RiskItem,
  analyzeTestGaps, type TestGap,
  analyzeChangeCoupling, type CoChangePair,
  calculateTechDebtRatio, type TechDebtMetrics,
} from "./senior-dev";

export interface NovelAnalysisReport {
  architectureDiagram: ArchitectureDiagram;
  techDebt: TechDebtReport;
  deadCode: DeadCodeReport;
  readme: GeneratedReadme;
  seniorDev: {
    busFactor: { items: BusFactorItem[]; score: number; summary: string };
    riskHeatmap: { items: RiskItem[]; maxRisk: number; summary: string };
    testGaps: { gaps: TestGap[]; summary: string };
    changeCoupling: { pairs: CoChangePair[]; summary: string };
    debtRatio: TechDebtMetrics;
  };
  aiCode: AiCodeReport;
  summary: string;
}

export function runNovelAnalysis(
  sourceFiles: { path: string; content: string }[],
  fileTree: string[],
  codeHygieneFindings: { category: string; severity: string; detail: string }[],
  productionFindings: { type: string; severity: string; detail: string }[],
  secretsCount: number,
  overallScore: number,
  repoName: string,
  repoOwner: string,
  description: string,
  grade: string,
  language: string,
  mainLang: string,
  quickWins: { title: string; severity: string }[],
  recommendations: string[],
  repoPath?: string,
): NovelAnalysisReport {
  const architectureDiagram = generateArchitectureDiagram(sourceFiles);
  const techDebt = calculateTechDebt(codeHygieneFindings, productionFindings, secretsCount, overallScore);
  const deadCode = generateDeadCodePlan(sourceFiles);
  const readme = generateReadme(repoName, repoOwner, description, overallScore, grade, language, fileTree.length, mainLang, architectureDiagram.mermaidCode, quickWins, recommendations);

  // Senior dev analyses
  const busFactor = analyzeBusFactor(repoPath);
  const riskHeatmap = analyzeRiskHeatmap(sourceFiles);
  const testGaps = analyzeTestGaps(sourceFiles);
  const changeCoupling = analyzeChangeCoupling(repoPath);
  const debtRatio = calculateTechDebtRatio(
    codeHygieneFindings,
    { hotSpots: [] },
    productionFindings,
    sourceFiles.reduce((s, f) => s + (f.content?.split("\n").length || 0), 0),
  );

  const aiCode = analyzeAiCode(sourceFiles, fileTree, sourceFiles.find(f => f.path === "package.json")?.content);

  return {
    architectureDiagram,
    techDebt,
    deadCode,
    readme,
    seniorDev: { busFactor, riskHeatmap, testGaps, changeCoupling, debtRatio },
    aiCode,
    summary: `Novel analysis: ${architectureDiagram.moduleCount} modules mapped, ${techDebt.items.length} debt items, ${deadCode.totalRemovable} dead exports, ${busFactor.items.length} bus factor risks, ${riskHeatmap.items.length} file risks, ${testGaps.gaps.length} test gaps, ${aiCode.findings.length} AI-code patterns.`,
  };
}

export { generateArchitectureDiagram } from "./arch-visualizer";
export { calculateTechDebt } from "./tech-debt";
export { generateDeadCodePlan } from "./dead-code";
export { generateReadme } from "./readme-gen";
export { analyzeBusFactor } from "./senior-dev";
export { analyzeRiskHeatmap } from "./senior-dev";
export { analyzeTestGaps } from "./senior-dev";
export type { ArchitectureDiagram } from "./arch-visualizer";
export type { TechDebtReport } from "./tech-debt";
export type { DeadCodeReport } from "./dead-code";
export type { GeneratedReadme } from "./readme-gen";
