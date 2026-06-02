import { analyzeComplexity, type ComplexityReport } from "./complexity";
import { analyzeDependencies, type DependencyReport } from "./dependency-health";
import { analyzeArchitecture, type ArchitectureReport } from "./architecture";
import { analyzeProductionReadiness, type ProductionReport } from "./production";
import { scanCodeHygiene, type CodeHygieneReport } from "./code-hygiene";
import { runEnterpriseAnalysis, type EnterpriseReport } from "./enterprise";

export interface DeepAnalysisReport {
  complexity: ComplexityReport;
  dependencies: DependencyReport;
  architecture: ArchitectureReport;
  production: ProductionReport;
  codeHygiene: CodeHygieneReport;
  enterprise: EnterpriseReport;
  worstFiles: { path: string; score: number; reasons: string[] }[];
  topRecommendations: string[];
  rawPromptBlock: string;
}

export function runDeepAnalysis(
  repoPath: string | null,
  fileTree: string[],
  sourceFiles: { path: string; content: string }[],
  packageJsonContent: string
): DeepAnalysisReport {
  const complexity = analyzeComplexity(repoPath || "", sourceFiles);
  const dependencies = analyzeDependencies(packageJsonContent, sourceFiles);
  const architecture = analyzeArchitecture(fileTree, sourceFiles);
  const production = analyzeProductionReadiness(sourceFiles, fileTree);
  const codeHygiene = scanCodeHygiene(sourceFiles);
  const enterprise = runEnterpriseAnalysis(fileTree, sourceFiles);

  // Aggregate worst files
  const fileScores = new Map<string, { score: number; reasons: string[] }>();

  for (const h of complexity.hotSpots) {
    const existing = fileScores.get(h.filePath) || { score: 0, reasons: [] };
    const severityPoints = { critical: 30, high: 15, medium: 5, low: 1 };
    existing.score += severityPoints[h.severity] || 0;
    existing.reasons.push(h.detail);
    fileScores.set(h.filePath, existing);
  }

  for (const f of architecture.findings) {
    const existing = fileScores.get(f.filePath) || { score: 0, reasons: [] };
    const severityPoints = { critical: 25, high: 10, medium: 5, low: 1 };
    existing.score += severityPoints[f.severity] || 0;
    existing.reasons.push(f.detail);
    fileScores.set(f.filePath, existing);
  }

  const worstFiles = [...fileScores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 10)
    .filter(([_, data]) => data.score > 0)
    .map(([path, data]) => ({ path, score: data.score, reasons: data.reasons }));

  // Generate top recommendations
  const recommendations: string[] = [];
  if (complexity.worstFiles.length > 0) {
    recommendations.push(`🔴 REFACTOR ${complexity.worstFiles[0].path} — ${complexity.worstFiles[0].reasons[0]}`);
  }
  if (dependencies.findings.some(f => f.severity === "critical")) {
    const critDeps = dependencies.findings.filter(f => f.severity === "critical");
    recommendations.push(`🔴 UPDATE ${critDeps.length} critical dependencies — ${critDeps[0].detail}`);
  }
  if (production.deployBlockers.length > 0) {
    recommendations.push(`🔴 FIX ${production.deployBlockers.length} deploy blockers: ${production.deployBlockers[0].detail}`);
  }
  if (architecture.findings.some(f => f.type === "layer-violation")) {
    const violations = architecture.findings.filter(f => f.type === "layer-violation");
    recommendations.push(`🟡 RESTRUCTURE ${violations.length} layer violations — ${violations[0].detail}`);
  }
  if (complexity.fileSizeDistribution.xlarge > 0) {
    recommendations.push(`🟡 SPLIT ${complexity.fileSizeDistribution.xlarge} oversized files (>600 lines each)`);
  }
  if (codeHygiene.findings.some(f => f.severity === "critical")) {
    const critHygiene = codeHygiene.findings.filter(f => f.severity === "critical");
    recommendations.push(`🔴 FIX ${critHygiene.length} critical code hygiene issues — ${critHygiene[0].detail}`);
  }
  if (enterprise.criticalBlockers.length > 0) {
    recommendations.push(`🔴 FIX ${enterprise.criticalBlockers.length} enterprise blockers: ${enterprise.criticalBlockers[0]}`);
  }
  if (production.findings.some(f => f.type === "unhandled-rejection")) {
    const ur = production.findings.filter(f => f.type === "unhandled-rejection");
    recommendations.push(`🟡 CATCH ${ur.length} unhandled promise rejections — will crash process`);
  }
  if (dependencies.depHealthScore < 60) {
    recommendations.push(`🟡 CLEAN ${dependencies.unusedPatterns.length} unused dependencies from package.json`);
  }
  if (complexity.hotSpots.some(h => h.concern === "god-file")) {
    const gods = complexity.hotSpots.filter(h => h.concern === "god-file");
    recommendations.push(`🟢 DECOMPOSE ${gods.length} god-files with many exports/responsibilities`);
  }
  if (architecture.findings.some(f => f.type === "inconsistent-pattern")) {
    recommendations.push(`🟢 STANDARDIZE naming conventions across directories`);
  }
  if (production.overallReadiness !== "ready") {
    recommendations.push(`🔴 DEPLOY-BLOCKING: ${production.deployBlockers.length} issues prevent safe deployment`);
  }

  // Generate raw prompt blocks for AI
  const rawPromptBlock = `## Deep Analysis Results (authoritative)
${renderComplexityPrompt(complexity)}
${renderDependencyPrompt(dependencies)}
${renderArchitecturePrompt(architecture)}
${renderProductionPrompt(production)}
${renderCodeHygienePrompt(codeHygiene)}
${renderEnterprisePrompt(enterprise)}`;

  return {
    complexity, dependencies, architecture, production,
    codeHygiene, enterprise,
    worstFiles, topRecommendations: recommendations.slice(0, 10),
    rawPromptBlock,
  };
}

function renderComplexityPrompt(c: ComplexityReport): string {
  return `[File Complexity]\n` +
    c.hotSpots.slice(0, 5).map(h => `  - ${h.severity.toUpperCase()}: ${h.filePath} — ${h.detail}`).join("\n") +
    `\n  Size distribution: ${c.fileSizeDistribution.small} small, ${c.fileSizeDistribution.medium} medium, ${c.fileSizeDistribution.large} large, ${c.fileSizeDistribution.xlarge} xlarge (>600 lines)\n` +
    (c.worstFiles.length > 0 ? `  Worst files:\n` + c.worstFiles.map(f => `    - ${f.path} (score ${f.score}): ${f.reasons.join("; ")}`).join("\n") : "");
}

function renderDependencyPrompt(d: DependencyReport): string {
  return `\n[Dependency Health]\n` +
    d.findings.filter(f => f.severity !== "low").slice(0, 10).map(f =>
      `  - ${f.severity.toUpperCase()}: ${f.packageName}@${f.version} — ${f.detail}`
    ).join("\n") +
    `\n  Total: ${d.totalDeps} prod + ${d.devDeps} dev deps. Health score: ${d.depHealthScore}/100.`;
}

function renderArchitecturePrompt(a: ArchitectureReport): string {
  return `\n[Architecture Coherence]\n` +
    a.findings.slice(0, 5).map(f => `  - ${f.severity.toUpperCase()}: ${f.filePath} — ${f.detail}`).join("\n") +
    `\n  Detected archetype: ${a.summary.split(".")[0]}.`;
}

function renderProductionPrompt(p: ProductionReport): string {
  return `\n[Production Readiness]\n` +
    `  Overall: ${p.overallReadiness}. ${p.findings.length} issues.\n` +
    p.findings.filter(f => f.severity !== "low").slice(0, 8).map(f =>
      `  - ${f.severity.toUpperCase()}: ${f.detail}`
    ).join("\n");
}

function renderCodeHygienePrompt(h: CodeHygieneReport): string {
  return `\n[Code Hygiene]\n` +
    `  ${h.totalCount} issues found across ${h.categoriesFound.length} categories. Score: ${h.score}/100.\n` +
    h.findings.filter(f => f.severity === "critical" || f.severity === "high").slice(0, 10).map(f =>
      `  - ${f.severity.toUpperCase()}: [${f.category}] ${f.filePath}${f.line ? `:${f.line}` : ""} — ${f.detail}`
    ).join("\n");
}

function renderEnterprisePrompt(e: EnterpriseReport): string {
  return `\n[Enterprise Readiness]\n` +
    `  Overall score: ${e.overallSeniorScore}/100. ${e.criticalBlockers.length} critical blockers.\n` +
    e.apiContract.findings.slice(0, 3).map(f => `  - [API] ${f.severity.toUpperCase()}: ${f.detail}`).join("\n") + "\n" +
    e.buildCI.findings.filter(f => f.severity !== "low").slice(0, 3).map(f => `  - [CI] ${f.severity.toUpperCase()}: ${f.detail}`).join("\n") + "\n" +
    e.license.findings.filter(f => f.severity !== "low").slice(0, 3).map(f => `  - [License] ${f.severity.toUpperCase()}: ${f.detail}`).join("\n");
}

export { analyzeComplexity, type ComplexityReport } from "./complexity";
export { analyzeDependencies, type DependencyReport } from "./dependency-health";
export { analyzeArchitecture, type ArchitectureReport } from "./architecture";
export { analyzeProductionReadiness, type ProductionReport } from "./production";
export { scanCodeHygiene, type CodeHygieneReport } from "./code-hygiene";
export { runEnterpriseAnalysis, type EnterpriseReport } from "./enterprise";
export { calculateVibeCodingIndex, type VibeCodingReport } from "./contamination";
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
} from "./impact";
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
} from "./education";
export {
  calculateTrustScore,
  type TrustScoreInput,
  type TrustScoreResult,
} from "./trust";
