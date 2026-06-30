import type { ComplexityReport } from "./complexity";
import type { DependencyReport } from "./dependency-health";
import type { ArchitectureReport } from "./architecture";
import type { ProductionReport } from "./production";
import type { CodeHygieneReport } from "./code-hygiene";
import type { EnterpriseReport } from "./enterprise";

export interface AnalysisResult {
  complexity: ComplexityReport;
  dependencies: DependencyReport;
  architecture: ArchitectureReport;
  production: ProductionReport;
  codeHygiene: CodeHygieneReport;
  enterprise: EnterpriseReport;
}

interface FileScoreEntry {
  score: number;
  reasons: string[];
}

const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 30,
  high: 15,
  medium: 5,
  low: 1,
};

export function aggregateFileScores(result: AnalysisResult): Map<string, FileScoreEntry> {
  const fileScores = new Map<string, FileScoreEntry>();

  const addFindings = (
    items: Array<{
      filePath?: string;
      severity: string;
      detail: string;
      packageName?: string;
    }>,
    pathKey: (item: typeof items[0]) => string | undefined,
  ) => {
    for (const item of items) {
      const path = pathKey(item);
      if (!path) continue;
      const existing = fileScores.get(path) || { score: 0, reasons: [] };
      existing.score += SEVERITY_WEIGHTS[item.severity] || 0;
      existing.reasons.push(item.detail);
      fileScores.set(path, existing);
    }
  };

  addFindings(
    result.complexity.hotSpots.map(h => ({ ...h, filePath: h.filePath, severity: h.severity, detail: h.detail })),
    f => f.filePath ?? f.filePath,
  );

  addFindings(
    result.architecture.findings.map(f => ({
      filePath: f.filePath,
      severity: f.severity,
      detail: f.detail,
    })),
    f => f.filePath,
  );

  addFindings(
    result.dependencies.findings.map(f => ({
      packageName: f.packageName,
      severity: f.severity,
      detail: f.detail,
    })),
    f => f.packageName ?? "unknown",
  );

  addFindings(
    result.production.findings.map(f => ({
      filePath: f.filePath,
      severity: f.severity,
      detail: f.detail,
    })),
    f => f.filePath,
  );

  addFindings(
    result.codeHygiene.findings.map(f => ({
      filePath: f.filePath,
      severity: f.severity,
      detail: f.detail,
    })),
    f => f.filePath,
  );

  const enterpriseFindings = [
    ...result.enterprise.apiContract.findings,
    ...result.enterprise.observability.findings,
    ...result.enterprise.buildCI.findings,
    ...result.enterprise.coupling.findings,
    ...result.enterprise.license.findings,
    ...result.enterprise.longTermDebt.findings,
  ];
  addFindings(
    enterpriseFindings.map(f => ({
      filePath: f.filePath,
      severity: f.severity,
      detail: "detail" in f ? f.detail : "",
    })),
    f => f.filePath,
  );

  return fileScores;
}

export function buildWorstFiles(
  fileScores: Map<string, FileScoreEntry>,
  limit: number = 10,
): { path: string; score: number; reasons: string[] }[] {
  return [...fileScores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .filter(([_, data]) => data.score > 0)
    .map(([path, data]) => ({ path, score: data.score, reasons: data.reasons }));
}

interface RecommendationRule {
  condition: (result: AnalysisResult) => boolean;
  message: (result: AnalysisResult) => string;
  priority: number;
}

const RECOMMENDATION_RULES: RecommendationRule[] = [
  {
    condition: (r) => r.complexity.worstFiles.length > 0,
    message: (r) => `🔴 REFACTOR ${r.complexity.worstFiles[0].path} — ${r.complexity.worstFiles[0].reasons[0]}`,
    priority: 1,
  },
  {
    condition: (r) => r.dependencies.findings.some((f) => f.severity === "critical"),
    message: (r) => {
      const critDeps = r.dependencies.findings.filter((f) => f.severity === "critical");
      return `🔴 UPDATE ${critDeps.length} critical dependencies — ${critDeps[0].detail}`;
    },
    priority: 2,
  },
  {
    condition: (r) => r.production.deployBlockers.length > 0,
    message: (r) =>
      `🔴 FIX ${r.production.deployBlockers.length} deploy blockers: ${r.production.deployBlockers[0].detail}`,
    priority: 3,
  },
  {
    condition: (r) => r.architecture.findings.some((f) => f.type === "layer-violation"),
    message: (r) => {
      const violations = r.architecture.findings.filter((f) => f.type === "layer-violation");
      return `🟡 RESTRUCTURE ${violations.length} layer violations — ${violations[0].detail}`;
    },
    priority: 4,
  },
  {
    condition: (r) => r.complexity.fileSizeDistribution.xlarge > 0,
    message: (r) =>
      `🟡 SPLIT ${r.complexity.fileSizeDistribution.xlarge} oversized files (>600 lines each)`,
    priority: 5,
  },
  {
    condition: (r) => r.codeHygiene.findings.some((f) => f.severity === "critical"),
    message: (r) => {
      const critHygiene = r.codeHygiene.findings.filter((f) => f.severity === "critical");
      return `🔴 FIX ${critHygiene.length} critical code hygiene issues — ${critHygiene[0].detail}`;
    },
    priority: 6,
  },
  {
    condition: (r) => r.enterprise.criticalBlockers.length > 0,
    message: (r) =>
      `🔴 FIX ${r.enterprise.criticalBlockers.length} enterprise blockers: ${r.enterprise.criticalBlockers[0]}`,
    priority: 7,
  },
  {
    condition: (r) => r.production.findings.some((f) => f.type === "unhandled-rejection"),
    message: (r) => {
      const ur = r.production.findings.filter((f) => f.type === "unhandled-rejection");
      return `🟡 CATCH ${ur.length} unhandled promise rejections — will crash process`;
    },
    priority: 8,
  },
  {
    condition: (r) => r.dependencies.depHealthScore < 60,
    message: (r) =>
      `🟡 CLEAN ${r.dependencies.unusedPatterns.length} unused dependencies from package.json`,
    priority: 9,
  },
  {
    condition: (r) => r.complexity.hotSpots.some((h) => h.concern === "god-file"),
    message: (r) => {
      const gods = r.complexity.hotSpots.filter((h) => h.concern === "god-file");
      return `🟢 DECOMPOSE ${gods.length} god-files with many exports/responsibilities`;
    },
    priority: 10,
  },
  {
    condition: (r) => r.architecture.findings.some((f) => f.type === "inconsistent-pattern"),
    message: () => `🟢 STANDARDIZE naming conventions across directories`,
    priority: 11,
  },
  {
    condition: (r) => r.production.overallReadiness !== "ready",
    message: (r) =>
      `🔴 DEPLOY-BLOCKING: ${r.production.deployBlockers.length} issues prevent safe deployment`,
    priority: 12,
  },
];

export function generateTopRecommendations(result: AnalysisResult): string[] {
  return RECOMMENDATION_RULES
    .sort((a, b) => a.priority - b.priority)
    .filter((rule) => rule.condition(result))
    .map((rule) => rule.message(result))
    .slice(0, 10);
}
