import { analyzeComplexity, type ComplexityReport } from "./complexity";
import { analyzeDependencies, type DependencyReport } from "./dependency-health";
import { analyzeArchitecture, type ArchitectureReport } from "./architecture";
import { analyzeProductionReadiness, type ProductionReport } from "./production";
import { scanCodeHygiene, type CodeHygieneReport } from "./code-hygiene";
import { runEnterpriseAnalysis, type EnterpriseReport } from "./enterprise";
import {
  aggregateFileScores,
  buildWorstFiles,
  generateTopRecommendations,
} from "./aggregator";

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
  packageJsonContent: string,
): DeepAnalysisReport {
  const complexity = analyzeComplexity(repoPath || "", sourceFiles);
  const dependencies = analyzeDependencies(packageJsonContent, sourceFiles);
  const architecture = analyzeArchitecture(fileTree, sourceFiles);
  const production = analyzeProductionReadiness(sourceFiles, fileTree);
  const codeHygiene = scanCodeHygiene(sourceFiles);
  const enterprise = runEnterpriseAnalysis(fileTree, sourceFiles);

  const analysisResult = {
    complexity,
    dependencies,
    architecture,
    production,
    codeHygiene,
    enterprise,
  };

  const fileScores = aggregateFileScores(analysisResult);
  const worstFiles = buildWorstFiles(fileScores);
  const topRecommendations = generateTopRecommendations(analysisResult);

  const rawPromptBlock = `## Deep Analysis Results (authoritative)
${renderComplexityPrompt(complexity)}
${renderDependencyPrompt(dependencies)}
${renderArchitecturePrompt(architecture)}
${renderProductionPrompt(production)}
${renderCodeHygienePrompt(codeHygiene)}
${renderEnterprisePrompt(enterprise)}`;

  return {
    complexity,
    dependencies,
    architecture,
    production,
    codeHygiene,
    enterprise,
    worstFiles,
    topRecommendations,
    rawPromptBlock,
  };
}

function renderComplexityPrompt(c: ComplexityReport): string {
  return (
    `[File Complexity]\n` +
    c.hotSpots
      .slice(0, 5)
      .map((h) => `  - ${h.severity.toUpperCase()}: ${h.filePath} — ${h.detail}`)
      .join("\n") +
    `\n  Size distribution: ${c.fileSizeDistribution.small} small, ${c.fileSizeDistribution.medium} medium, ${c.fileSizeDistribution.large} large, ${c.fileSizeDistribution.xlarge} xlarge (>600 lines)\n` +
    (c.worstFiles.length > 0
      ? `  Worst files:\n` +
        c.worstFiles
          .map(
            (f) =>
              `    - ${f.path} (score ${f.score}): ${f.reasons.join("; ")}`,
          )
          .join("\n")
      : "")
  );
}

function renderDependencyPrompt(d: DependencyReport): string {
  return (
    `\n[Dependency Health]\n` +
    d.findings
      .filter((f) => f.severity !== "low")
      .slice(0, 10)
      .map(
        (f) =>
          `  - ${f.severity.toUpperCase()}: ${f.packageName}@${f.version} — ${f.detail}`,
      )
      .join("\n") +
    `\n  Total: ${d.totalDeps} prod + ${d.devDeps} dev deps. Health score: ${d.depHealthScore}/100.`
  );
}

function renderArchitecturePrompt(a: ArchitectureReport): string {
  return (
    `\n[Architecture Coherence]\n` +
    a.findings
      .slice(0, 5)
      .map(
        (f) =>
          `  - ${f.severity.toUpperCase()}: ${f.filePath} — ${f.detail}`,
      )
      .join("\n") +
    `\n  Detected archetype: ${a.summary.split(".")[0]}.`
  );
}

function renderProductionPrompt(p: ProductionReport): string {
  return (
    `\n[Production Readiness]\n` +
    `  Overall: ${p.overallReadiness}. ${p.findings.length} issues.\n` +
    p.findings
      .filter((f) => f.severity !== "low")
      .slice(0, 8)
      .map((f) => `  - ${f.severity.toUpperCase()}: ${f.detail}`)
      .join("\n")
  );
}

function renderCodeHygienePrompt(h: CodeHygieneReport): string {
  return (
    `\n[Code Hygiene]\n` +
    `  ${h.totalCount} issues found across ${h.categoriesFound.length} categories. Score: ${h.score}/100.\n` +
    h.findings
      .filter((f) => f.severity === "critical" || f.severity === "high")
      .slice(0, 10)
      .map(
        (f) =>
          `  - ${f.severity.toUpperCase()}: [${f.category}] ${f.filePath}${f.line ? `:${f.line}` : ""} — ${f.detail}`,
      )
      .join("\n")
  );
}

function renderEnterprisePrompt(e: EnterpriseReport): string {
  return (
    `\n[Enterprise Readiness]\n` +
    `  Overall score: ${e.overallSeniorScore}/100. ${e.criticalBlockers.length} critical blockers.\n` +
    e.apiContract.findings
      .slice(0, 3)
      .map(
        (f) =>
          `  - [API] ${f.severity.toUpperCase()}: ${f.detail}`,
      )
      .join("\n") +
    "\n" +
    e.buildCI.findings
      .filter((f) => f.severity !== "low")
      .slice(0, 3)
      .map(
        (f) =>
          `  - [CI] ${f.severity.toUpperCase()}: ${f.detail}`,
      )
      .join("\n") +
    "\n" +
    e.license.findings
      .filter((f) => f.severity !== "low")
      .slice(0, 3)
      .map(
        (f) =>
          `  - [License] ${f.severity.toUpperCase()}: ${f.detail}`,
      )
      .join("\n")
  );
}
