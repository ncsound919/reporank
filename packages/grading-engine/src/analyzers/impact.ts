/**
 * PR Impact Prediction — forecasts how a set of file changes will affect
 * overall codebase health. Also computes the "Software 2.0 Compatibility Score":
 * how well a codebase accepts AI contributions.
 */
import { analyzeAiCode } from "./ai-code";
import { calculateVibeCodingIndex } from "./contamination";

export type FileChangeKind = "added" | "modified" | "removed";

export interface FileChange {
  path: string;
  kind: FileChangeKind;
  content?: string;
  previousContent?: string;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface FileImpact {
  path: string;
  kind: FileChangeKind;
  scoreDelta: number;
  reasons: string[];
  recommendations: string[];
  vibeContribution: number;
}

export interface Software20Score {
  overall: number;
  fileSizeScore: number;
  commentDensity: number;
  importClarity: number;
  testCoverage: number;
  structureNotes: string[];
}

export interface ImpactReport {
  currentScore: number;
  predictedScore: number;
  totalDelta: number;
  confidence: "high" | "medium" | "low";
  perFile: FileImpact[];
  topWins: string[];
  topRisks: string[];
  software20Score: Software20Score;
  vibeTrend: VibeTrend;
  summary: string;
}

export interface VibeTrend {
  baseVibe: number;
  newVibe: number;
  delta: number;
  direction: "rising" | "falling" | "stable" | "insufficient-data";
  insight: string;
}

const SEVERITY_PENALTY: Record<string, number> = {
  critical: 4,
  high: 2.5,
  medium: 1,
  low: 0.25,
};

export function predictImpact(
  currentScore: number,
  changes: FileChange[],
  options: {
    sourceFiles?: { path: string; content: string }[];
    fileTree?: string[];
    testFilePaths?: string[];
  } = {},
): ImpactReport {
  const sourceFiles = options.sourceFiles ?? [];
  const fileTree = options.fileTree ?? [];
  const testPaths = new Set(options.testFilePaths ?? []);

  if (changes.length === 0) {
    return emptyImpact(currentScore, sourceFiles, fileTree, testPaths);
  }

  const perFile: FileImpact[] = [];
  let totalDelta = 0;

  for (const change of changes) {
    const impact = scoreFileChange(change, sourceFiles, fileTree, testPaths);
    perFile.push(impact);
    totalDelta += impact.scoreDelta;
  }

  // Clamp predicted score to 0-100
  const predictedScore = Math.max(0, Math.min(100, Math.round(currentScore + totalDelta)));
  const clampedDelta = predictedScore - currentScore;

  // Top wins/risks
  const sortedByImpact = [...perFile].sort((a, b) => a.scoreDelta - b.scoreDelta);
  const topWins = sortedByImpact
    .filter(i => i.scoreDelta > 0)
    .slice(0, 3)
    .map(i => `+${i.scoreDelta.toFixed(1)} pts from ${i.kind} ${i.path} — ${i.reasons[0] ?? "improved quality"}`);
  const topRisks = sortedByImpact
    .reverse()
    .filter(i => i.scoreDelta < 0)
    .slice(0, 3)
    .map(i => `${i.scoreDelta.toFixed(1)} pts from ${i.kind} ${i.path} — ${i.reasons[0] ?? "introduced risk"}`);

  const software20Score = calculateSoftware20Score(sourceFiles, fileTree, testPaths);

  // Compute Vibe trend by analyzing the new/modified file contents
  const vibeTrend = computeVibeTrend(changes);

  // Confidence based on change volume
  const totalLines = changes.reduce((sum, c) => {
    const lines = (c.linesAdded ?? 0) + (c.linesRemoved ?? 0);
    if (lines > 0) return sum + lines;
    return sum + Math.ceil((c.content?.length ?? 0) / 50);
  }, 0);
  const confidence: ImpactReport["confidence"] =
    totalLines < 200 ? "high" : totalLines < 1000 ? "medium" : "low";

  const summaryParts: string[] = [];
  if (clampedDelta === 0) {
    summaryParts.push(`No net change predicted (current ${currentScore}).`);
  } else if (clampedDelta > 0) {
    summaryParts.push(`This PR is predicted to improve score by ${clampedDelta} points (${currentScore} → ${predictedScore}).`);
  } else {
    summaryParts.push(`This PR is predicted to drop score by ${Math.abs(clampedDelta)} points (${currentScore} → ${predictedScore}).`);
  }
  summaryParts.push(`Software 2.0 Compatibility: ${software20Score.overall}/100.`);
  if (topWins.length > 0) summaryParts.push(`${topWins.length} wins.`);
  if (topRisks.length > 0) summaryParts.push(`${topRisks.length} risks.`);

  return {
    currentScore,
    predictedScore,
    totalDelta: clampedDelta,
    confidence,
    perFile: perFile.sort((a, b) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta)),
    topWins,
    topRisks,
    software20Score,
    vibeTrend,
    summary: summaryParts.join(" "),
  };
}

function scoreFileChange(
  change: FileChange,
  sourceFiles: { path: string; content: string }[],
  fileTree: string[],
  testPaths: Set<string>,
): FileImpact {
  const reasons: string[] = [];
  const recommendations: string[] = [];
  let scoreDelta = 0;
  let vibeContribution = 0;

  if (change.kind === "removed") {
    // Removal is almost always positive — dead code is gone
    const lines = change.linesRemoved ?? change.previousContent?.split("\n").length ?? 0;
    scoreDelta = Math.min(2, 0.2 * Math.log2(1 + lines));
    reasons.push(`Removed ${lines} lines — dead code elimination`);
    recommendations.push("Verify no imports reference this file before merge.");

    return {
      path: change.path, kind: "removed", scoreDelta, reasons, recommendations, vibeContribution: 0,
    };
  }

  // added or modified — analyze content
  const content = change.content ?? "";
  if (!content) {
    return {
      path: change.path, kind: change.kind, scoreDelta: 0,
      reasons: ["No content provided — cannot assess impact."],
      recommendations: ["Provide file content to enable impact analysis."],
      vibeContribution: 0,
    };
  }

  // Run a one-file ai-code analysis
  const aiResult = analyzeAiCode([{ path: change.path, content }], fileTree);

  for (const finding of aiResult.findings) {
    const penalty = SEVERITY_PENALTY[finding.severity] ?? 0.5;
    scoreDelta -= penalty;
    vibeContribution += penalty;
    reasons.push(`[${finding.severity}] ${finding.pattern} — ${finding.detail}`);
    recommendations.push(finding.fixSuggestion);
  }

  // Test file bonus
  if (testPaths.has(change.path) || /\.(test|spec)\.[jt]sx?$/.test(change.path)) {
    scoreDelta += Math.min(3, 0.05 * content.split("\n").length);
    reasons.push("Test file — coverage contribution.");
  }

  // File size penalty
  const lineCount = content.split("\n").length;
  if (lineCount > 600) {
    const penalty = Math.min(3, (lineCount - 600) / 200);
    scoreDelta -= penalty;
    reasons.push(`Large file (${lineCount} lines) — split for LLM context.`);
    recommendations.push("Extract modules from this file to keep it under 300 lines.");
  }

  // Async-error handling nudge
  if (/async\s+function|async\s*\(/.test(content) && !/try\s*{|\.catch\(/.test(content)) {
    scoreDelta -= 1.5;
    reasons.push("Async code without try/catch — runtime crash risk.");
    recommendations.push("Wrap async calls in try/catch or attach .catch().");
  }

  // If this file is added to a codebase we have full info about, attribute source context
  if (sourceFiles.length > 0) {
    const matching = sourceFiles.find(f => f.path === change.path);
    if (!matching && change.kind === "added") {
      // New file being added — light positive nudge if it's a test
      if (testPaths.has(change.path)) {
        scoreDelta += 1;
        reasons.push("New test file — strengthens the suite.");
      }
    }
  }

  // Clamp per-file impact
  scoreDelta = Math.max(-15, Math.min(10, scoreDelta));

  return {
    path: change.path,
    kind: change.kind,
    scoreDelta: Math.round(scoreDelta * 10) / 10,
    reasons,
    recommendations: dedupe(recommendations).slice(0, 5),
    vibeContribution: Math.round(vibeContribution * 10) / 10,
  };
}

export function calculateSoftware20Score(
  sourceFiles: { path: string; content: string }[],
  fileTree: string[],
  testFilePaths: Set<string> = new Set(),
): Software20Score {
  if (!sourceFiles || sourceFiles.length === 0) {
    return {
      overall: 0, fileSizeScore: 0, commentDensity: 0, importClarity: 0,
      testCoverage: 0, structureNotes: ["No source files to analyze."],
    };
  }

  // 1. File size score — small files are easier for LLMs to edit
  const sizes = sourceFiles.map(f => f.content.split("\n").length);
  const smallRatio = sizes.filter(s => s < 200).length / sizes.length;
  const mediumRatio = sizes.filter(s => s >= 200 && s < 400).length / sizes.length;
  const largeRatio = sizes.filter(s => s >= 400).length / sizes.length;
  const fileSizeScore = Math.round(100 * (smallRatio * 1.0 + mediumRatio * 0.6 + largeRatio * 0.2));

  // 2. Comment density
  const totalLines = sizes.reduce((a, b) => a + b, 0);
  let commentLines = 0;
  for (const f of sourceFiles) {
    const lines = f.content.split("\n");
    commentLines += lines.filter(l => /^\s*(\/\/|#|\/\*|\*)/.test(l)).length;
  }
  const commentRatio = totalLines > 0 ? commentLines / totalLines : 0;
  // Sweet spot: 5-15% comment density
  const commentDensity = commentRatio < 0.02 ? 30 :
    commentRatio < 0.05 ? 60 :
    commentRatio <= 0.15 ? 100 :
    commentRatio <= 0.25 ? 80 : 60;

  // 3. Import clarity — clean dependency declarations
  let importClarity = 100;
  for (const f of sourceFiles) {
    const hallucinated = (f.content.match(/from\s+['"][^'"]+\.css['"]|from\s+['"]!['"]/g) || []).length;
    if (hallucinated > 0) importClarity -= 10;
  }
  importClarity = Math.max(0, importClarity);

  // 4. Test coverage ratio
  const testCoverage = sourceFiles.length > 0
    ? Math.round(100 * Math.min(1, testFilePaths.size / sourceFiles.length))
    : 0;

  const overall = Math.round(
    fileSizeScore * 0.35 + commentDensity * 0.20 + importClarity * 0.20 + testCoverage * 0.25,
  );

  const structureNotes: string[] = [];
  if (fileSizeScore < 60) structureNotes.push("Many files exceed 400 lines — split into smaller modules for LLM-friendly editing.");
  if (commentDensity < 50) structureNotes.push("Add explanatory comments — LLMs reason better with context.");
  if (testCoverage < 40) structureNotes.push("Increase test coverage — tests let LLMs verify their changes.");
  if (importClarity < 80) structureNotes.push("Some imports look suspicious — verify package names exist.");
  if (fileTree.length > 0 && structureNotes.length === 0) structureNotes.push("Codebase structure is well-suited for AI contributions.");

  return { overall, fileSizeScore, commentDensity, importClarity, testCoverage, structureNotes };
}

function emptyImpact(
  currentScore: number,
  sourceFiles: { path: string; content: string }[],
  fileTree: string[],
  testPaths: Set<string>,
): ImpactReport {
  return {
    currentScore,
    predictedScore: currentScore,
    totalDelta: 0,
    confidence: "high",
    perFile: [],
    topWins: [],
    topRisks: [],
    software20Score: calculateSoftware20Score(sourceFiles, fileTree, testPaths),
    vibeTrend: { baseVibe: 0, newVibe: 0, delta: 0, direction: "insufficient-data", insight: "No changes to analyze." },
    summary: `No changes to analyze. Current score: ${currentScore}.`,
  };
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/**
 * Compute the Vibe Coding Index trend for a PR.
 *
 * NOTE: This is a *one-sided* signal — we analyze the new/modified files in
 * the PR but don't have access to the base branch's file contents here.
 * `baseVibe` is left at 0 to reflect that we don't know the starting point;
 * callers who have a prior scan can overlay the real base. `delta` therefore
 * equals `newVibe` (not a true before/after).
 *
 * Removed files are accounted for: if the diff removes high-vibe code, the
 * "new vibe" measurement should be lower (less AI contamination in the
 * surviving surface). We approximate by NOT counting removed files in the
 * measurement — their absence lowers the residual contamination.
 */
function computeVibeTrend(changes: FileChange[]): VibeTrend {
  const newFiles = changes
    .filter(c => c.kind !== "removed" && c.content)
    .map(c => ({ path: c.path, content: c.content! }));

  if (newFiles.length === 0) {
    return { baseVibe: 0, newVibe: 0, delta: 0, direction: "insufficient-data", insight: "No added/modified files to measure." };
  }

  const newVibe = calculateVibeCodingIndex(newFiles, []).overallScore;
  // baseVibe is intentionally 0 — we don't have the base branch files.
  // Callers can replace it with a known value from a prior scan.
  const baseVibe = 0;
  const delta = newVibe - baseVibe;

  // Direction uses the new-vibe score (not the count of files).
  // "rising" = more AI contamination; "falling" = less; "stable" = within normal range.
  const direction: VibeTrend["direction"] =
    newVibe >= 60 ? "rising" :
    newVibe <= 30 ? "falling" :
    "stable";

  // Account for removed files in the insight
  const removedCount = changes.filter(c => c.kind === "removed").length;
  const removedNote = removedCount > 0 ? ` (${removedCount} file(s) removed — not measured for Vibe)` : "";

  let insight: string;
  if (newVibe >= 60) insight = `New code has high AI contamination (Vibe ${newVibe}/100)${removedNote} — senior review recommended.`;
  else if (newVibe <= 30) insight = `New code is human-like (Vibe ${newVibe}/100)${removedNote} — low AI contamination.`;
  else insight = `New code has moderate Vibe patterns (${newVibe}/100)${removedNote} — within normal range.`;

  return { baseVibe, newVibe, delta, direction, insight };
}

// ─── PR 3.3: CATEGORY BREAKDOWN ────────────────────────────────────────

export type ImpactCategory = "security" | "complexity" | "vibe" | "test-coverage" | "file-size" | "error-handling" | "code-removal";

export interface CategoryContribution {
  category: ImpactCategory;
  label: string;
  delta: number;
  fileCount: number;
  description: string;
}

export interface ImpactBreakdown {
  totalDelta: number;
  categories: CategoryContribution[];
  dominantCategory: ImpactCategory | null;
  positiveCategories: CategoryContribution[];
  negativeCategories: CategoryContribution[];
}

const CATEGORY_LABELS: Record<ImpactCategory, string> = {
  security: "Security",
  complexity: "Complexity",
  vibe: "AI Contamination (Vibe Coding)",
  "test-coverage": "Test Coverage",
  "file-size": "File Size",
  "error-handling": "Error Handling",
  "code-removal": "Dead Code Removal",
};

/**
 * Categorize a file impact reason into a category bucket.
 */
function categorizeReason(reason: string): ImpactCategory {
  const r = reason.toLowerCase();
  if (r.includes("security") || r.includes("secrets") || r.includes("hallucinated")) return "security";
  if (r.includes("test") || r.includes("coverage")) return "test-coverage";
  if (r.includes("file") || r.includes("nesting") || r.includes("god")) return "file-size";
  if (r.includes("async") || r.includes("error")) return "error-handling";
  if (r.includes("removed") || r.includes("dead code")) return "code-removal";
  if (r.includes("vibe") || r.includes("spaghetti") || r.includes("ai")) return "vibe";
  return "complexity";
}

/**
 * Decompose the total score delta into per-category contributions.
 * Files with multiple issues may contribute to multiple categories.
 */
export function breakdownImpact(impact: ImpactReport): ImpactBreakdown {
  const bucket = new Map<ImpactCategory, { delta: number; fileCount: Set<string> }>();
  for (const cat of Object.keys(CATEGORY_LABELS) as ImpactCategory[]) {
    bucket.set(cat, { delta: 0, fileCount: new Set() });
  }

  for (const file of impact.perFile) {
    if (file.kind === "removed" && file.reasons.some(r => r.toLowerCase().includes("dead code"))) {
      const b = bucket.get("code-removal")!;
      b.delta += file.scoreDelta;
      b.fileCount.add(file.path);
      continue;
    }
    // Distribute per-file delta across all categories mentioned in reasons
    if (file.reasons.length === 0) continue;
    const perReason = file.scoreDelta / file.reasons.length;
    for (const reason of file.reasons) {
      const cat = categorizeReason(reason);
      const b = bucket.get(cat)!;
      b.delta += perReason;
      b.fileCount.add(file.path);
    }
  }

  const categories: CategoryContribution[] = (Array.from(bucket.entries()) as [ImpactCategory, { delta: number; fileCount: Set<string> }][])
    .map(([cat, data]) => ({
      category: cat,
      label: CATEGORY_LABELS[cat],
      delta: Math.round(data.delta * 10) / 10,
      fileCount: data.fileCount.size,
      description: describeCategory(cat, data.delta, data.fileCount.size),
    }))
    .filter(c => c.fileCount > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const positiveCategories = categories.filter(c => c.delta > 0);
  const negativeCategories = categories.filter(c => c.delta < 0);
  const dominant = categories[0] ?? null;

  return {
    totalDelta: impact.totalDelta,
    categories,
    dominantCategory: dominant?.category ?? null,
    positiveCategories,
    negativeCategories,
  };
}

function describeCategory(cat: ImpactCategory, delta: number, fileCount: number): string {
  const direction = delta > 0 ? "improved" : delta < 0 ? "degraded" : "unchanged";
  if (fileCount === 0) return "No files affected";
  switch (cat) {
    case "security": return `${fileCount} file(s) had security posture ${direction}`;
    case "complexity": return `${fileCount} file(s) had complexity ${direction}`;
    case "vibe": return `${fileCount} file(s) had AI-contamination ${direction}`;
    case "test-coverage": return `${fileCount} test-related file(s) ${direction}`;
    case "file-size": return `${fileCount} file(s) had size ${direction}`;
    case "error-handling": return `${fileCount} file(s) had error-handling ${direction}`;
    case "code-removal": return `${fileCount} file(s) removed`;
  }
}

// ─── PR 3.4: RECOMMENDATION ENGINE ─────────────────────────────────────

export type FixEffort = "trivial" | "small" | "medium" | "large";
export type FixType = "extract-function" | "add-tests" | "add-error-handling" | "split-file" | "remove-dead-code" | "fix-security" | "reduce-abstraction" | "add-types" | "review-suspicious-import";

export interface FixRecommendation {
  id: string;
  type: FixType;
  file: string;
  effort: FixEffort;
  estimatedPointsSaved: number;
  title: string;
  detail: string;
  action: string;
  riskLevel: "low" | "medium" | "high";
}

export interface RecommendationReport {
  currentScore: number;
  projectedScore: number;
  totalPotentialGain: number;
  recommendations: FixRecommendation[];
  quickWins: FixRecommendation[];
  majorRefactors: FixRecommendation[];
  summary: string;
}

const EFFORT_POINTS_MULTIPLIER: Record<FixEffort, number> = {
  trivial: 0.8,
  small: 0.6,
  medium: 0.4,
  large: 0.2,
};

const EFFORT_LABELS: Record<FixEffort, string> = {
  trivial: "trivial (< 15 min)",
  small: "small (15 min - 1 hr)",
  medium: "medium (1-4 hrs)",
  large: "large (half day+)",
};

/**
 * Generate actionable fix recommendations sorted by points-saved-per-effort.
 * Uses the per-file impact data to derive specific, concrete fixes.
 */
export function generateRecommendations(impact: ImpactReport): RecommendationReport {
  const recs: FixRecommendation[] = [];

  for (const file of impact.perFile) {
    if (file.kind === "removed") continue;
    if (file.scoreDelta >= 0) continue; // Only recommend fixes for negative-impact files

    for (const reason of file.reasons) {
      const rec = buildRecommendation(file, reason);
      if (rec) recs.push(rec);
    }
  }

  // Sort by points-saved-per-effort
  recs.sort((a, b) => {
    const aRatio = a.estimatedPointsSaved / (effortRank(a.effort) + 1);
    const bRatio = b.estimatedPointsSaved / (effortRank(b.effort) + 1);
    return bRatio - aRatio;
  });

  const totalPotentialGain = Math.round(
    recs.reduce((s, r) => s + r.estimatedPointsSaved, 0) * 10,
  ) / 10;
  const projectedScore = Math.min(100, impact.currentScore + totalPotentialGain);

  const quickWins = recs.filter(r => r.effort === "trivial" || r.effort === "small").slice(0, 5);
  const majorRefactors = recs.filter(r => r.effort === "medium" || r.effort === "large").slice(0, 5);

  let summary: string;
  if (recs.length === 0) {
    summary = "No actionable fixes needed — the PR is healthy.";
  } else {
    summary = `${recs.length} fix${recs.length === 1 ? "" : "es"} recommended. ` +
      `Quick wins: ${quickWins.length}, major refactors: ${majorRefactors.length}. ` +
      `Potential score recovery: +${totalPotentialGain} points.`;
  }

  return {
    currentScore: impact.currentScore,
    projectedScore,
    totalPotentialGain,
    recommendations: recs,
    quickWins,
    majorRefactors,
    summary,
  };
}

function buildRecommendation(file: FileImpact, reason: string): FixRecommendation | null {
  const r = reason.toLowerCase();
  const fileName = file.path;
  const baseId = `${fileName}:${reason.slice(0, 20)}`.replace(/[^a-z0-9:]/gi, "-").toLowerCase();

  if (r.includes("spaghetti-nesting") || r.includes("nesting depth")) {
    return {
      id: baseId, type: "extract-function", file: fileName, effort: "medium",
      estimatedPointsSaved: estimateGain(file, 0.55),
      title: `Extract nested logic from ${fileName}`,
      detail: "Deeply nested code is hard to read and harder to test. Extract inner branches into named functions.",
      action: "Identify the deepest 3-4 levels of nesting and extract them into private functions with descriptive names. Each function should do one thing.",
      riskLevel: "low",
    };
  }

  if (r.includes("async") || r.includes("try/catch") || r.includes("error")) {
    return {
      id: baseId, type: "add-error-handling", file: fileName, effort: "small",
      estimatedPointsSaved: estimateGain(file, 0.7),
      title: `Add error handling to ${fileName}`,
      detail: "Async code without try/catch can crash the process on rejection.",
      action: "Wrap each async call in try/catch, or attach .catch() handlers. Add a top-level error handler if this is a critical path.",
      riskLevel: "low",
    };
  }

  if (r.includes("test") || r.includes("coverage")) {
    return {
      id: baseId, type: "add-tests", file: fileName, effort: "small",
      estimatedPointsSaved: estimateGain(file, 0.5),
      title: `Strengthen tests in ${fileName}`,
      detail: "Adding tests reduces future regressions and lets AI verify changes.",
      action: "Write 3-5 unit tests covering the new code paths. Focus on edge cases.",
      riskLevel: "low",
    };
  }

  if (r.includes("file") && (r.includes("large") || r.includes("600") || r.includes("300"))) {
    return {
      id: baseId, type: "split-file", file: fileName, effort: "large",
      estimatedPointsSaved: estimateGain(file, 0.3),
      title: `Split ${fileName} into smaller modules`,
      detail: "Files over 300 lines are difficult for both humans and AI to reason about.",
      action: "Identify logical groupings of exports/functions. Move each group to its own file in the same directory. Update imports.",
      riskLevel: "medium",
    };
  }

  if (r.includes("security") || r.includes("secrets") || r.includes("hallucinated")) {
    return {
      id: baseId, type: "fix-security", file: fileName, effort: "small",
      estimatedPointsSaved: estimateGain(file, 0.85),
      title: `Fix security issue in ${fileName}`,
      detail: "Security issues must be remediated before merge.",
      action: "Move secrets to environment variables. Verify imported packages exist. Never use eval() or similar dynamic code execution.",
      riskLevel: "high",
    };
  }

  if (r.includes("over-engineering") || r.includes("abstraction")) {
    return {
      id: baseId, type: "reduce-abstraction", file: fileName, effort: "medium",
      estimatedPointsSaved: estimateGain(file, 0.4),
      title: `Simplify over-engineered code in ${fileName}`,
      detail: "Excessive abstraction makes code harder to follow without proportional benefit.",
      action: "Inline trivial types/interfaces that are used only once. Replace abstract factories with simple functions where only 1-2 implementations exist.",
      riskLevel: "low",
    };
  }

  if (r.includes("any-abuse") || r.includes("any")) {
    return {
      id: baseId, type: "add-types", file: fileName, effort: "small",
      estimatedPointsSaved: estimateGain(file, 0.5),
      title: `Replace 'any' with proper types in ${fileName}`,
      detail: "Type erasure defeats TypeScript's safety guarantees.",
      action: "Replace each 'any' with a specific type or generic. Use 'unknown' for values of uncertain type and narrow with type guards.",
      riskLevel: "low",
    };
  }

  return null;
}

function estimateGain(file: FileImpact, multiplier: number): number {
  const base = Math.abs(file.scoreDelta);
  return Math.round(base * multiplier * 10) / 10;
}

function effortRank(effort: FixEffort): number {
  return { trivial: 0, small: 1, medium: 2, large: 3 }[effort];
}

export { EFFORT_LABELS };
