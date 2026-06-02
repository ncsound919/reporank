/**
 * Vibe Coding Index — measures how much of a codebase exhibits patterns
 * unique to AI-generated code. Higher score = more "vibe-coded".
 * Named after Andrej Karpathy's term for AI-generated code that looks
 * right but has subtle issues.
 */
import { analyzeAiCode, type AiCodeFinding } from "./ai-code";

export interface VibeCodingReport {
  overallScore: number;
  perFile: { path: string; score: number; signals: string[] }[];
  signalBreakdown: {
    spaghettiNesting: number;
    overEngineering: number;
    hallucinatedImports: number;
    missingErrorBoundaries: number;
    securityNaivety: number;
    anyAbuse: number;
    inconsistentPatterns: number;
    infiniteLoops: number;
    promiseGarden: number;
    copyPasteModules: number;
  };
  summary: string;
  knownHumanScore: number;
}

const SIGNAL_WEIGHTS: Record<string, number> = {
  "spaghetti-nesting": 20,
  "over-engineering": 12,
  "dead-abstraction": 8,
  "hallucinated-import": 25,
  "duplicate-impl": 10,
  "circular-dependency": 5,
  "missing-error-boundary": 10,
  "security-naivety": 25,
  "inconsistent-pattern": 6,
  "any-abuse": 8,
  "hardcoded-everything": 5,
  "infinite-loop-risk": 20,
  "promise-garden": 12,
  "copy-paste-module": 15,
};

export function calculateVibeCodingIndex(
  sourceFiles: { path: string; content: string }[],
  fileTree: string[],
): VibeCodingReport {
  if (!sourceFiles || sourceFiles.length === 0) {
    return {
      overallScore: 0,
      perFile: [],
      signalBreakdown: {
        spaghettiNesting: 0, overEngineering: 0, hallucinatedImports: 0,
        missingErrorBoundaries: 0, securityNaivety: 0, anyAbuse: 0,
        inconsistentPatterns: 0, infiniteLoops: 0, promiseGarden: 0, copyPasteModules: 0,
      },
      summary: "No source files to analyze.",
      knownHumanScore: 0,
    };
  }

  const aiResult = analyzeAiCode(sourceFiles, fileTree,
    sourceFiles.find(f => f.path === "package.json")?.content);

  const perFileMap = new Map<string, { score: number; signals: string[] }>();
  const signalCounts = {
    spaghettiNesting: 0, overEngineering: 0, hallucinatedImports: 0,
    missingErrorBoundaries: 0, securityNaivety: 0, anyAbuse: 0,
    inconsistentPatterns: 0, infiniteLoops: 0, promiseGarden: 0, copyPasteModules: 0,
  };

  for (const f of aiResult.findings) {
    const weight = SIGNAL_WEIGHTS[f.pattern] || 5;
    const existing = perFileMap.get(f.file) || { score: 0, signals: [] };
    existing.score += weight;
    existing.signals.push(f.pattern);
    perFileMap.set(f.file, existing);

    const key = camelCasePattern(f.pattern) as keyof typeof signalCounts;
    if (key in signalCounts) signalCounts[key] += 1;
  }

  const perFile = [...perFileMap.entries()]
    .map(([path, data]) => ({ path, score: Math.min(100, data.score), signals: [...new Set(data.signals)] }))
    .sort((a, b) => b.score - a.score);

  const totalWeight = [...aiResult.findings].reduce((s, f) => s + (SIGNAL_WEIGHTS[f.pattern] || 5), 0);
  const fileCount = sourceFiles.length;
  const baseScore = fileCount > 0 ? (totalWeight / fileCount) * 2 : 0;

  const overallScore = Math.min(100, Math.round(baseScore + aiResult.spaghettiScore * 0.3));

  const criticalCount = aiResult.findings.filter(f => f.severity === "critical").length;
  const knownHumanScore = overallScore > 0
    ? Math.max(0, 100 - overallScore)
    : 0;

  return {
    overallScore,
    perFile: perFile.slice(0, 20),
    signalBreakdown: signalCounts,
    summary: `Vibe Coding Index: ${overallScore}/100. ` +
      `${aiResult.findings.length} AI-pattern signals across ${perFile.length} files. ` +
      `${criticalCount} critical signals detected. ` +
      (overallScore > 50
        ? "High vibe-coding signal — suggests significant AI-generated code."
        : overallScore > 20
          ? "Moderate vibe-coding signal — some AI patterns detected."
          : "Low vibe-coding signal — codebase appears primarily human-written."),
    knownHumanScore,
  };
}

function camelCasePattern(pattern: string): string {
  return pattern.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
