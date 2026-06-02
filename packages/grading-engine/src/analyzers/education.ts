/**
 * Education Submission Auditor — analyzes student code submissions
 * against course guidelines. Uses Karpathy's progressive disclosure model:
 * Layer 1 (does it run?) → Layer 2 (small fixes) → Layer 3 (better patterns)
 * → Layer 4 (invisible bugs / senior-dev perspective).
 */
import { analyzeAiCode, type AiCodeFinding } from "./ai-code";
import { calculateVibeCodingIndex, type VibeCodingReport } from "./contamination";

export type DisclosureLayer = 1 | 2 | 3 | 4;

export interface CourseGuideline {
  id: string;
  description: string;
  category: "naming" | "structure" | "testing" | "ai-usage" | "documentation" | "performance";
  enforced: boolean;
}

export interface SubmissionInput {
  studentId: string;
  assignmentId: string;
  sourceFiles: { path: string; content: string }[];
  guidelines: CourseGuideline[];
  language: string;
  expectedComplexity?: "intro" | "intermediate" | "advanced";
}

export interface Layer1Report {
  runs: boolean;
  totalFiles: number;
  totalLines: number;
  primaryLanguage: string;
  hasComments: boolean;
  whatItDoes: string;
  quickStats: { files: number; functions: number; classes: number; comments: number };
}

export interface Layer2Report {
  improvements: string[];
  estimatedScoreBoost: number;
}

export interface Layer3Report {
  patternsToAdopt: { name: string; example: string; reason: string }[];
  seniorityLevel: "novice" | "developing" | "intermediate" | "advanced";
}

export interface Layer4Report {
  invisibleBugs: string[];
  aiContaminationScore: number;
  topTakeoverPoints: string[];
  seniorDevConcerns: string[];
}

export interface AuditReport {
  studentId: string;
  assignmentId: string;
  generatedAt: string;
  overallGrade: "A" | "B" | "C" | "D" | "F";
  overallScore: number;
  integrity: {
    aiContaminationScore: number;
    sessionConsistency: "human-like" | "mixed" | "ai-likely" | "pure-ai";
    plagiarismRisk: "low" | "medium" | "high";
    guidelineViolations: { guideline: CourseGuideline; matched: boolean }[];
  };
  layers: {
    layer1: Layer1Report;
    layer2: Layer2Report;
    layer3: Layer3Report;
    layer4: Layer4Report;
  };
  // Map of which layers are unlocked — students control disclosure
  unlockedLayers: DisclosureLayer[];
}

export function auditSubmission(input: SubmissionInput, unlockedLayers: DisclosureLayer[] = [1]): AuditReport {
  const { sourceFiles, guidelines, language, studentId, assignmentId } = input;

  const layer1 = buildLayer1(sourceFiles, language);
  const layer2 = buildLayer2(sourceFiles, guidelines);
  const vibeReport = calculateVibeCodingIndex(sourceFiles, []);
  const layer4 = buildLayer4(sourceFiles, vibeReport);

  // Layer 3 only computed if requested (it's more expensive)
  const layer3: Layer3Report = unlockedLayers.includes(3)
    ? buildLayer3(sourceFiles, language)
    : { patternsToAdopt: [], seniorityLevel: "novice" };

  // Overall grade
  const overallScore = computeOverallScore(layer1, layer2, vibeReport, guidelines);
  const grade = scoreToGrade(overallScore);

  // Integrity checks
  const guidelineViolations = guidelines.map(g => ({
    guideline: g,
    matched: g.enforced ? matchesGuideline(g, sourceFiles) : true,
  }));
  const sessionConsistency = inferSessionConsistency(vibeReport, sourceFiles);
  const plagiarismRisk = inferPlagiarismRisk(sourceFiles);

  return {
    studentId,
    assignmentId,
    generatedAt: new Date().toISOString(),
    overallGrade: grade,
    overallScore,
    integrity: {
      aiContaminationScore: vibeReport.overallScore,
      sessionConsistency,
      plagiarismRisk,
      guidelineViolations,
    },
    layers: { layer1, layer2, layer3, layer4 },
    unlockedLayers,
  };
}

// ─── LAYER BUILDERS ────────────────────────────────────────────────────

function buildLayer1(sourceFiles: { path: string; content: string }[], language: string): Layer1Report {
  const totalFiles = sourceFiles.length;
  const totalLines = sourceFiles.reduce((s, f) => s + f.content.split("\n").length, 0);
  const allContent = sourceFiles.map(f => f.content).join("\n");

  const functionCount = (allContent.match(/(function|def|fn|func|public|private|static)\s+\w+/g) || []).length;
  const classCount = (allContent.match(/\bclass\s+\w+/g) || []).length;
  const commentCount = sourceFiles.reduce((s, f) => {
    const lines = f.content.split("\n");
    return s + lines.filter(l => /^\s*(\/\/|#|\/\*|\*|"""|''')/.test(l)).length;
  }, 0);

  const whatItDoes = describeWhatItDoes(sourceFiles, language);

  return {
    runs: totalFiles > 0 && totalLines > 0,
    totalFiles, totalLines, primaryLanguage: language,
    hasComments: commentCount > 0,
    whatItDoes,
    quickStats: { files: totalFiles, functions: functionCount, classes: classCount, comments: commentCount },
  };
}

function buildLayer2(sourceFiles: { path: string; content: string }[], guidelines: CourseGuideline[]): Layer2Report {
  const improvements: string[] = [];
  let estimatedScoreBoost = 0;

  if (sourceFiles.length === 0) {
    return { improvements: ["No files submitted."], estimatedScoreBoost: 0 };
  }

  const allContent = sourceFiles.map(f => f.content).join("\n");

  // Naming consistency
  const snakeCase = (allContent.match(/\b[a-z]+_[a-z]+\(/g) || []).length;
  const camelCase = (allContent.match(/\b[a-z][a-zA-Z]*[A-Z][a-zA-Z]*\(/g) || []).length;
  if (snakeCase > 0 && camelCase > 0) {
    improvements.push("Use consistent naming — either snake_case OR camelCase, not both.");
    estimatedScoreBoost += 3;
  }

  // Magic numbers
  const magicNumbers = (allContent.match(/\b\d{2,}\b/g) || []).filter(n => parseInt(n) > 9 && parseInt(n) < 1000).length;
  if (magicNumbers > 3) {
    improvements.push(`Extract ${magicNumbers} magic numbers into named constants.`);
    estimatedScoreBoost += 2;
  }

  // Long functions
  for (const file of sourceFiles) {
    const lines = file.content.split("\n");
    let inFunction = 0;
    let funcStart = -1;
    let funcName = "";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (inFunction === 0 && /\b(function|def|fn|func)\s+(\w+)/.test(line)) {
        const match = line.match(/\b(?:function|def|fn|func)\s+(\w+)/);
        if (match) { funcName = match[1]; funcStart = i; inFunction = 1; }
      }
      inFunction += (line.match(/{/g) || []).length;
      inFunction -= (line.match(/}/g) || []).length;
      if (inFunction === 0 && funcStart >= 0 && i - funcStart > 50) {
        improvements.push(`Function '${funcName}' in ${file.path} is ${i - funcStart} lines — split it up.`);
        estimatedScoreBoost += 2;
        funcStart = -1;
      }
    }
  }

  // Guideline enforcement
  for (const g of guidelines.filter(g => g.enforced)) {
    if (!matchesGuideline(g, sourceFiles)) {
      improvements.push(`Address course guideline: ${g.description}`);
      estimatedScoreBoost += 4;
    }
  }

  if (improvements.length === 0) {
    improvements.push("Looks clean — no obvious improvements at this layer.");
  }

  return { improvements: improvements.slice(0, 10), estimatedScoreBoost: Math.min(20, estimatedScoreBoost) };
}

function buildLayer3(sourceFiles: { path: string; content: string }[], language: string): Layer3Report {
  const patternsToAdopt: Layer3Report["patternsToAdopt"] = [];
  const allContent = sourceFiles.map(f => f.content).join("\n");

  if (!/\b(try|catch|except)\b/.test(allContent) && /\bawait|fetch\(|\.then\(/.test(allContent)) {
    patternsToAdopt.push({
      name: "Error handling",
      example: "try { ... } catch (e) { ... }",
      reason: "Async operations can fail — your code should handle it gracefully.",
    });
  }
  if (!/\b(type|interface)\b/.test(allContent) && /\b(let|const)\s+\w+\s*=/.test(allContent)) {
    patternsToAdopt.push({
      name: "Type annotations",
      example: "const x: number = 5;",
      reason: "Types make your code self-documenting and catch bugs at compile time.",
    });
  }
  if (!/\b(import|from|require)\b/.test(allContent) && sourceFiles.length > 3) {
    patternsToAdopt.push({
      name: "Modularization",
      example: "import { helper } from './utils';",
      reason: "Splitting code into modules makes it easier to test and reuse.",
    });
  }

  // Seniority level
  const hasTypes = /\b(type|interface)\b/.test(allContent);
  const hasTests = sourceFiles.some(f => /\.(test|spec)/.test(f.path));
  const hasErrorHandling = /\b(try|catch|except)\b/.test(allContent);
  const hasComments = allContent.split("\n").filter(l => /^\s*(\/\/|#|\*)/.test(l)).length > 5;
  const score = [hasTypes, hasTests, hasErrorHandling, hasComments].filter(Boolean).length;
  const seniorityLevel: Layer3Report["seniorityLevel"] =
    score >= 4 ? "advanced" : score === 3 ? "intermediate" : score === 2 ? "developing" : "novice";

  return { patternsToAdopt, seniorityLevel };
}

function buildLayer4(sourceFiles: { path: string; content: string }[], vibeReport: VibeCodingReport): Layer4Report {
  const aiResult = analyzeAiCode(sourceFiles, []);
  const invisibleBugs = aiResult.findings
    .filter(f => f.severity === "critical" || f.severity === "high")
    .map(f => `${f.pattern}: ${f.detail} (in ${f.file})`)
    .slice(0, 5);

  const topTakeoverPoints = aiResult.takeOverPoints.slice(0, 3);
  const seniorDevConcerns = aiResult.findings
    .filter(f => f.severity === "high" || f.severity === "medium")
    .map(f => f.seniorNote)
    .slice(0, 3);

  return {
    invisibleBugs,
    aiContaminationScore: vibeReport.overallScore,
    topTakeoverPoints,
    seniorDevConcerns,
  };
}

// ─── PR 4.2: SESSION REPLAY ANALYSIS ───────────────────────────────────

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  /** For assistant turns: did the assistant produce code? */
  producedCode?: boolean;
  /** For assistant turns: was the code accepted without modification? */
  acceptedAsIs?: boolean;
}

export interface SessionInput {
  studentId: string;
  assignmentId: string;
  turns: ChatTurn[];
  finalSubmission: { path: string; content: string }[];
}

export interface SessionAnalysis {
  studentId: string;
  assignmentId: string;
  understandingScore: number; // 0-100, higher = student understood
  autonomyScore: number; // 0-100, higher = student directed vs was directed
  learningEfficiency: number; // 0-100, higher = student extracted concepts
  redFlags: string[];
  positiveIndicators: string[];
  summary: string;
}

export function analyzeSession(input: SessionInput): SessionAnalysis {
  const { turns, finalSubmission } = input;

  if (turns.length === 0) {
    return {
      studentId: input.studentId,
      assignmentId: input.assignmentId,
      understandingScore: 0, autonomyScore: 0, learningEfficiency: 0,
      redFlags: ["No chat session recorded."],
      positiveIndicators: [],
      summary: "No session data — cannot evaluate understanding.",
    };
  }

  const userTurns = turns.filter(t => t.role === "user");
  const assistantTurns = turns.filter(t => t.role === "assistant");
  const assistantProducedCode = assistantTurns.filter(t => t.producedCode).length;
  const userAskedFollowups = userTurns.filter(t => /\?$|\bwhy\b|\bhow\b|\bexplain\b/i.test(t.content)).length;

  // ─── Understanding Score ────────────────────────────────────────
  // Higher if user asked meaningful follow-ups, modified AI output, asked why
  const modifiedCodeSignals = userTurns.filter(t =>
    /\b(modify|change|fix|adjust|adapt|update|refactor|simplify)\b/i.test(t.content) ||
    /\?/.test(t.content)
  ).length;
  const understandingScore = Math.min(100,
    30 +
    Math.min(40, userAskedFollowups * 8) +
    Math.min(30, modifiedCodeSignals * 6)
  );

  // ─── Autonomy Score ─────────────────────────────────────────────
  // Higher if user issued specific instructions, not just "make X"
  const specificInstructions = userTurns.filter(t =>
    /(\bI want\b|\bI need\b|\bshould\b|\bmust\b|\binstead\b|\brather\b|\bprefer\b)/i.test(t.content)
  ).length;
  const genericRequests = userTurns.filter(t =>
    /^(make|build|create|write|do|solve|implement)\s+(it|this|the|that|a|an)\b/i.test(t.content.trim())
  ).length;
  const autonomyScore = Math.max(0, Math.min(100,
    50 +
    specificInstructions * 8 -
    genericRequests * 5
  ));

  // ─── Learning Efficiency ────────────────────────────────────────
  // Higher if user asked conceptual questions and final submission has own voice
  const conceptualQuestions = userTurns.filter(t =>
    /\b(why|how does|what is|explain|concept|principle|pattern|best practice)\b/i.test(t.content)
  ).length;
  const finalContent = finalSubmission.map(f => f.content).join("\n");
  const hasOriginalComments = (finalContent.match(/(\/\/|\#)/g) || []).length > 3;
  const learningEfficiency = Math.min(100,
    20 +
    conceptualQuestions * 10 +
    (hasOriginalComments ? 20 : 0) +
    Math.min(40, assistantTurns.length * 2) // Some back-and-forth is good
  );

  // ─── Red Flags & Positive Indicators ────────────────────────────
  const redFlags: string[] = [];
  const positiveIndicators: string[] = [];

  if (assistantProducedCode >= assistantTurns.length * 0.8 && assistantTurns.length > 3) {
    redFlags.push("AI produced code in >80% of turns — likely 'vibe coding' pattern");
  }
  if (genericRequests > userTurns.length * 0.5 && userTurns.length > 2) {
    redFlags.push("Most requests were generic (e.g. 'make this') — student may not be directing");
  }
  if (userAskedFollowups === 0 && userTurns.length > 2) {
    redFlags.push("Student never asked a follow-up question — likely accepting without understanding");
  }
  if (understandingScore < 30) {
    redFlags.push("Understanding score is low — student shows no evidence of engaging with the work");
  }

  if (userAskedFollowups >= 2) {
    positiveIndicators.push(`Student asked ${userAskedFollowups} follow-up questions — engaging actively`);
  }
  if (specificInstructions >= 2) {
    positiveIndicators.push("Student issued specific, directed instructions");
  }
  if (conceptualQuestions >= 2) {
    positiveIndicators.push("Student asked conceptual questions — learning the 'why'");
  }
  if (hasOriginalComments) {
    positiveIndicators.push("Final submission has original comments — student added their own voice");
  }
  if (autonomyScore >= 70) {
    positiveIndicators.push("High autonomy — student was clearly directing the work");
  }

  let summary: string;
  if (redFlags.length >= 3) {
    summary = `Strong 'vibe coding' signal — ${redFlags.length} red flags detected. Student likely outsourced implementation.`;
  } else if (redFlags.length >= 1 && understandingScore < 50) {
    summary = `Mixed signals — student engaged partially but understanding is incomplete.`;
  } else if (positiveIndicators.length >= 2) {
    summary = `Healthy collaboration — student demonstrated active learning.`;
  } else {
    summary = `Average session — neither strong engagement nor clear red flags.`;
  }

  return {
    studentId: input.studentId,
    assignmentId: input.assignmentId,
    understandingScore,
    autonomyScore,
    learningEfficiency,
    redFlags,
    positiveIndicators,
    summary,
  };
}

// ─── INTEGRITY CHECKS ──────────────────────────────────────────────────

function inferSessionConsistency(vibe: VibeCodingReport, sourceFiles: { path: string; content: string }[]): AuditReport["integrity"]["sessionConsistency"] {
  if (sourceFiles.length === 0) return "human-like";
  if (vibe.overallScore >= 75) return "pure-ai";
  if (vibe.overallScore >= 50) return "ai-likely";
  if (vibe.overallScore >= 25) return "mixed";
  return "human-like";
}

function inferPlagiarismRisk(sourceFiles: { path: string; content: string }[]): AuditReport["integrity"]["plagiarismRisk"] {
  if (sourceFiles.length === 0) return "low";
  const allContent = sourceFiles.map(f => f.content).join("\n");
  // Look for telltale signs of copy-paste
  const identicalLines = new Map<string, number>();
  for (const line of allContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length < 20) continue;
    identicalLines.set(trimmed, (identicalLines.get(trimmed) || 0) + 1);
  }
  const maxRepeated = Math.max(0, ...identicalLines.values());
  if (maxRepeated >= 5) return "high";
  if (maxRepeated >= 3) return "medium";
  return "low";
}

function matchesGuideline(guideline: CourseGuideline, sourceFiles: { path: string; content: string }[]): boolean {
  const content = sourceFiles.map(f => f.content).join("\n").toLowerCase();
  switch (guideline.category) {
    case "naming": return !/(let|const|var)\s+\w+_\w+/.test(content) || /(\bfunction\s+[a-z][a-zA-Z]*\b)/.test(content);
    case "structure": return content.length < 5000;
    case "testing": return sourceFiles.some(f => /\.(test|spec)/.test(f.path));
    case "ai-usage": return true;
    case "documentation": return /(\/\/|\#|\/\*\*)/.test(content);
    case "performance": return !/setInterval|while\s*\(\s*true\s*\)/.test(content);
  }
}

function describeWhatItDoes(sourceFiles: { path: string; content: string }[], language: string): string {
  if (sourceFiles.length === 0) return "No files submitted.";
  const firstFile = sourceFiles[0];
  const lines = firstFile.content.split("\n");
  const importLines = lines.filter(l => /^\s*(import|from|using|require)/.test(l)).slice(0, 3);
  const functionLines = lines.filter(l => /\b(function|def|class|fn|func)\s+\w+/.test(l)).slice(0, 3);
  const parts: string[] = [`${sourceFiles.length} file(s) in ${language}.`];
  if (importLines.length > 0) parts.push(`Imports ${importLines.length} module(s).`);
  if (functionLines.length > 0) {
    const fns = functionLines.map(l => l.match(/\b(?:function|def|class|fn|func)\s+(\w+)/)?.[1]).filter(Boolean);
    if (fns.length > 0) parts.push(`Defines: ${fns.slice(0, 5).join(", ")}.`);
  }
  return parts.join(" ");
}

function computeOverallScore(
  layer1: Layer1Report,
  layer2: Layer2Report,
  vibe: VibeCodingReport,
  guidelines: CourseGuideline[],
): number {
  let score = 70; // baseline
  if (layer1.runs) score += 5;
  if (layer1.hasComments) score += 5;
  score -= Math.min(30, Math.round(vibe.overallScore * 0.3));
  const enforcedCount = guidelines.filter(g => g.enforced).length;
  if (enforcedCount > 0) {
    score += Math.round((layer2.estimatedScoreBoost / Math.max(1, enforcedCount)) * 0.5);
  }
  return Math.max(0, Math.min(100, score));
}

function scoreToGrade(score: number): AuditReport["overallGrade"] {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}
