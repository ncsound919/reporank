/**
 * Novel Analyzers Bundle — features no other code review tool offers.
 * Architecture diagrams, tech debt interest, dead code plans, README generation.
 */
import { generateArchitectureDiagram, type ArchitectureDiagram } from "./arch-visualizer";
import { calculateTechDebt, type TechDebtReport } from "./tech-debt";
import { generateDeadCodePlan, type DeadCodeReport } from "./dead-code";
import { generateReadme, type GeneratedReadme } from "./readme-gen";

export interface NovelAnalysisReport {
  architectureDiagram: ArchitectureDiagram;
  techDebt: TechDebtReport;
  deadCode: DeadCodeReport;
  readme: GeneratedReadme;
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
): NovelAnalysisReport {
  const architectureDiagram = generateArchitectureDiagram(sourceFiles);
  const techDebt = calculateTechDebt(codeHygieneFindings, productionFindings, secretsCount, overallScore);
  const deadCode = generateDeadCodePlan(sourceFiles);
  const readme = generateReadme(repoName, repoOwner, description, overallScore, grade, language, fileTree.length, mainLang, architectureDiagram.mermaidCode, quickWins, recommendations);

  return {
    architectureDiagram,
    techDebt,
    deadCode,
    readme,
    summary: `Novel analysis: ${architectureDiagram.moduleCount} modules mapped, ${techDebt.items.length} debt items ($${techDebt.totalYearlyCost.toLocaleString()}/yr), ${deadCode.totalRemovable} dead exports found, README generated.`,
  };
}

export { generateArchitectureDiagram } from "./arch-visualizer";
export { calculateTechDebt } from "./tech-debt";
export { generateDeadCodePlan } from "./dead-code";
export { generateReadme } from "./readme-gen";
export type { ArchitectureDiagram } from "./arch-visualizer";
export type { TechDebtReport } from "./tech-debt";
export type { DeadCodeReport } from "./dead-code";
export type { GeneratedReadme } from "./readme-gen";
