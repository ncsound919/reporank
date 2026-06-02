/**
 * RepoRank Trust Score — a single composite metric that combines signals
 * from all four phases into one headline number (0-100). This is the
 * "acquisition trap" number — easy to brag about, hard to fake, and
 * meaningful across the entire RepoRank product surface.
 *
 * Components:
 *  1. Code Health (40%)  — overall score from the scan engine
 *  2. AI Contamination inverted (20%) — Vibe Coding Index lower is better
 *  3. Software 2.0 Compatibility (15%) — can LLMs work on this codebase?
 *  4. Security posture (15%) — from Claw findings (if available)
 *  5. AGENTS.md compliance (10%) — bonus if a quality AGENTS.md exists
 */
import { calculateSoftware20Score } from "./impact";

export interface TrustScoreInput {
  overallScore: number;          // 0-100 from scan
  vibeCodingIndex: number;       // 0-100, higher = more AI-contaminated
  software20Inputs?: {
    sourceFiles: { path: string; content: string }[];
    fileTree: string[];
    testFilePaths?: Set<string>;
  };
  securityFindings?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  agentsFile?: {
    content: string;
    /** Estimated size in tokens (rough). */
    estimatedTokens?: number;
  };
}

export interface TrustScoreResult {
  /** Composite Trust Score (0-100). */
  trust: number;
  /** Letter grade A-F. */
  grade: "A+" | "A" | "B" | "C" | "D" | "F";
  /** Per-component scores. */
  components: {
    codeHealth: { score: number; weight: number; contribution: number };
    vibe: { score: number; weight: number; contribution: number };
    software20: { score: number; weight: number; contribution: number };
    security: { score: number; weight: number; contribution: number };
    agentsCompliance: { score: number; weight: number; contribution: number };
  };
  /** Per-component feedback lines. */
  feedback: string[];
  /** Top 3 things that would move the score up the most. */
  recommendations: { action: string; potentialGain: number; effort: "trivial" | "small" | "medium" | "large" }[];
}

const WEIGHTS = {
  codeHealth: 0.40,
  vibe: 0.20,
  software20: 0.15,
  security: 0.15,
  agentsCompliance: 0.10,
} as const;

export function calculateTrustScore(input: TrustScoreInput): TrustScoreResult {
  // 1. Code health — direct from scan
  const codeHealth = clamp(input.overallScore, 0, 100);
  const codeHealthContribution = codeHealth * WEIGHTS.codeHealth;

  // 2. Vibe Coding — INVERTED (lower is better)
  const vibe = clamp(100 - input.vibeCodingIndex, 0, 100);
  const vibeContribution = vibe * WEIGHTS.vibe;

  // 3. Software 2.0 — compute if provided
  let software20 = 0;
  if (input.software20Inputs) {
    const s20 = calculateSoftware20Score(
      input.software20Inputs.sourceFiles,
      input.software20Inputs.fileTree,
      input.software20Inputs.testFilePaths ?? new Set(),
    );
    software20 = s20.overall;
  }
  const software20Contribution = software20 * WEIGHTS.software20;

  // 4. Security — penalty for findings
  let security = 100;
  if (input.securityFindings) {
    const f = input.securityFindings;
    security = clamp(
      100 - (f.critical * 20 + f.high * 8 + f.medium * 3 + f.low * 1),
      0, 100,
    );
  }
  const securityContribution = security * WEIGHTS.security;

  // 5. AGENTS.md compliance — bonus if present and reasonable
  let agentsCompliance = 0;
  if (input.agentsFile?.content) {
    const c = input.agentsFile.content;
    let score = 50; // base for having a file
    if (input.agentsFile.estimatedTokens !== undefined && input.agentsFile.estimatedTokens < 800) {
      score += 25; // small enough to fit in LLM context
    } else if (input.agentsFile.estimatedTokens !== undefined && input.agentsFile.estimatedTokens > 2000) {
      score -= 20; // too big to be useful
    }
    if (c.includes("🔴") || c.includes("# Security") || /security/i.test(c)) score += 10;
    if (c.includes("🟡") || c.includes("## ")) score += 5; // has sections
    if (c.split("\n").length < 10) score -= 15; // too short
    agentsCompliance = clamp(score, 0, 100);
  }
  const agentsComplianceContribution = agentsCompliance * WEIGHTS.agentsCompliance;

  const trust = Math.round(
    codeHealthContribution +
    vibeContribution +
    software20Contribution +
    securityContribution +
    agentsComplianceContribution,
  );

  const grade = scoreToGrade(trust);

  // Feedback
  const feedback: string[] = [];
  if (codeHealth < 60) feedback.push(`Code health is low (${codeHealth}/100) — focus on quality, tests, and types.`);
  if (input.vibeCodingIndex >= 50) feedback.push(`High Vibe Coding Index (${input.vibeCodingIndex}) — code shows strong AI patterns; consider senior review.`);
  if (software20 < 50 && input.software20Inputs) feedback.push(`Software 2.0 Compatibility is low (${software20}/100) — files may be too large or comments sparse.`);
  if (input.securityFindings && (input.securityFindings.critical > 0 || input.securityFindings.high > 0)) {
    feedback.push(`${input.securityFindings.critical} critical + ${input.securityFindings.high} high security findings need attention.`);
  }
  if (!input.agentsFile?.content) feedback.push(`No AGENTS.md found — generate one to help AI agents collaborate with your codebase.`);
  if (trust >= 80) feedback.push(`Excellent — this codebase is healthy and AI-friendly.`);
  if (trust < 40) feedback.push(`Significant work needed — start with the top recommendation below.`);

  // Top 3 recommendations
  const recommendations: TrustScoreResult["recommendations"] = [];
  const candidates: { action: string; potentialGain: number; effort: "trivial" | "small" | "medium" | "large" }[] = [];

  if (!input.agentsFile?.content) {
    candidates.push({ action: "Generate an AGENTS.md for this repo", potentialGain: 10, effort: "trivial" });
  } else if (input.agentsFile.estimatedTokens && input.agentsFile.estimatedTokens > 2000) {
    candidates.push({ action: "Trim AGENTS.md to fit LLM context (<800 tokens)", potentialGain: 6, effort: "small" });
  }
  if (input.vibeCodingIndex >= 50) {
    candidates.push({ action: "Reduce AI contamination — extract functions, add types, remove dead abstractions", potentialGain: Math.round(input.vibeCodingIndex * 0.15), effort: "medium" });
  }
  if (input.securityFindings && input.securityFindings.critical > 0) {
    candidates.push({ action: `Fix ${input.securityFindings.critical} critical security findings`, potentialGain: input.securityFindings.critical * 8, effort: "small" });
  }
  if (software20 < 60 && input.software20Inputs) {
    candidates.push({ action: "Split large files, add comments, increase test coverage", potentialGain: 6, effort: "medium" });
  }
  if (codeHealth < 60) {
    candidates.push({ action: "Improve overall code health — types, tests, lint", potentialGain: 12, effort: "large" });
  }

  candidates.sort((a, b) => b.potentialGain - a.potentialGain);
  for (const c of candidates.slice(0, 3)) recommendations.push(c);

  return {
    trust,
    grade,
    components: {
      codeHealth: { score: codeHealth, weight: WEIGHTS.codeHealth, contribution: round1(codeHealthContribution) },
      vibe: { score: vibe, weight: WEIGHTS.vibe, contribution: round1(vibeContribution) },
      software20: { score: software20, weight: WEIGHTS.software20, contribution: round1(software20Contribution) },
      security: { score: security, weight: WEIGHTS.security, contribution: round1(securityContribution) },
      agentsCompliance: { score: agentsCompliance, weight: WEIGHTS.agentsCompliance, contribution: round1(agentsComplianceContribution) },
    },
    feedback,
    recommendations,
  };
}

function scoreToGrade(score: number): TrustScoreResult["grade"] {
  if (score >= 95) return "A+";
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
