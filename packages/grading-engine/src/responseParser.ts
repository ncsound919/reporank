import { z } from "zod";
import type { HealthReport } from "@reporank/shared-types";

const clamp100 = (v: number) => Math.min(100, Math.max(0, v));

/**
 * A 0-100 score that tolerates provider quirks: numeric strings are coerced,
 * out-of-range values are clamped, and missing/unparseable values fall back to
 * `def`. Never throws, so a single bad score cannot fail an entire grade.
 */
const scoreField = (def: number) => z.coerce.number().transform(clamp100).catch(def).default(def);


const partialSecuritySchema = z.object({
  secretsFound: z.number().default(0),
  secretsCritical: z.number().default(0),
  vulnerabilityCount: z.number().default(0),
  highestSeverity: z.enum(["none", "low", "medium", "high", "critical"]).default("none"),
  vulnerabilities: z.array(z.object({
    id: z.string().default(""),
    severity: z.enum(["low", "medium", "high", "critical"]).default("low"),
    title: z.string().default(""),
    description: z.string().default(""),
    packageName: z.string().optional(),
    cveId: z.string().optional(),
    recommendation: z.string().default(""),
  })).default([]),
  dependencyCves: z.number().default(0),
  hasSastScan: z.boolean().default(false),
  score: scoreField(50),
});

const partialQualitySchema = z.object({
  readmeScore: z.number().default(50),
  testFramework: z.string().nullable().default(null),
  testFileCount: z.number().default(0),
  codeSmells: z.number().default(0),
  duplicationPercent: z.number().default(0),
  hasLintConfig: z.boolean().default(false),
  hasCiConfig: z.boolean().default(false),
  score: scoreField(50),
});

const partialVibeSchema = z.object({
  overall: z.number().default(50),
  namingScore: z.number().default(50),
  modernityScore: z.number().default(50),
  hygieneScore: z.number().default(50),
  configCoherence: z.number().default(50),
  dependencyFreshness: z.number().default(50),
  recommendations: z.array(z.string()).default([]),
});

const partialArchitectureSchema = z.object({
  couplingScore: z.number().default(50),
  circularImportsCount: z.number().default(0),
  complexityRating: z.enum(["low", "medium", "high", "very-high"]).default("medium"),
  fileCount: z.number().default(0),
  avgFileLength: z.number().default(0),
  score: scoreField(50),
});

const partialDeploymentSchema = z.object({
  hasDockerfile: z.boolean().default(false),
  dockerfileScore: z.number().default(0),
  hasCIConfig: z.boolean().default(false),
  hasEnvExample: z.boolean().default(false),
  hasHealthcheck: z.boolean().default(false),
  hasLogging: z.boolean().default(false),
  loggingFramework: z.string().nullable().default(null),
  score: scoreField(0),
});

const partialDocumentationSchema = z.object({
  readmeCompleteness: z.number().default(0),
  hasSetupInstructions: z.boolean().default(false),
  hasApiDocs: z.boolean().default(false),
  hasArchitectureDiagram: z.boolean().default(false),
  hasContributingGuide: z.boolean().default(false),
  hasLicenseFile: z.boolean().default(false),
  score: scoreField(0),
});

const partialLicenseSchema = z.object({
  licenseType: z.string().nullable().default(null),
  isCopyleft: z.boolean().default(false),
  licenseConflicts: z.array(z.string()).default([]),
  hasLicenseFile: z.boolean().default(false),
  score: scoreField(50),
});

const partialMarketSchema = z.object({
  trendAlignment: z.enum(["rising", "steady", "declining"]).default("steady"),
  percentileRank: z.number().default(50),
  competitorCount: z.number().default(0),
  recentActivity: z.enum(["active", "stale", "inactive"]).default("active"),
  score: scoreField(50),
});

const quickWinSchema = z.object({
  title: z.string().default(""),
  severity: z.enum(["critical", "high", "medium", "low"]).default("low"),
  category: z.string().default(""),
  effort: z.enum(["minutes", "hours", "days"]).default("hours"),
  description: z.string().default(""),
  action: z.string().default(""),
  filePath: z.string().optional(),
});

const roadmapItemSchema = z.object({
  phase: z.enum(["now", "next", "later"]).default("later"),
  priority: z.number().default(1),
  category: z.string().default(""),
  task: z.string().default(""),
  effort: z.enum(["hours", "days", "weeks"]).default("days"),
});

const implementationStepSchema = z.object({
  title: z.string().default(""),
  description: z.string().default(""),
  targetFiles: z.array(z.string()).default([]),
  promptInstruction: z.string().default(""),
});

const healthReportSchema = z.object({
  overallScore: scoreField(50),
  gradeCategory: z.enum(["A+", "A", "B+", "B", "C", "D", "F"]).default("C"),
  maturityLevel: z.enum(["Prototype", "MVP", "Beta", "Production", "Enterprise"]).default("Prototype"),
  summary: z.string().default("No summary provided."),
  dimensionScores: z.object({
    security: z.number().default(50),
    quality: z.number().default(50),
    vibe: z.number().default(50),
    architecture: z.number().default(50),
    deployment: z.number().default(50),
    documentation: z.number().default(50),
    license: z.number().default(50),
    market: z.number().default(50),
  }).prefault({}),
  security: partialSecuritySchema.prefault({}),
  quality: partialQualitySchema.prefault({}),
  vibe: partialVibeSchema.prefault({}),
  architecture: partialArchitectureSchema.prefault({}),
  deployment: partialDeploymentSchema.prefault({}),
  documentation: partialDocumentationSchema.prefault({}),
  license: partialLicenseSchema.prefault({}),
  market: partialMarketSchema.prefault({}),
  valuation: z.object({
    replacementCostFMV: z.number().default(0),
    reliefFromRoyaltyValue: z.number().default(0),
    productivityWasteHeuristic: z.number().default(0),
  }).prefault({}),
  hallucinatedFeatures: z.array(z.string()).default([]),
  bugsAndLeaks: z.array(z.string()).default([]),
  structuralSmells: z.array(z.string()).default([]),
  quickWins: z.array(quickWinSchema).default([]),
  roadmap: z.array(roadmapItemSchema).default([]),
  implementationPlan: z.array(implementationStepSchema).default([]),
  globalBenchmarkPercent: z.number().default(0),
});

export function parseHealthReport(raw: string): HealthReport {
  // Reasoning models (e.g. nemotron) often emit a "thinking" preamble before the
  // JSON. Prefer an explicit ```json fence when present, then scan every balanced
  // {...} block and try the LARGEST first (the real HealthReport is the biggest
  // object) instead of blindly taking the first block. Non-regex so no ReDoS.
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try { return healthReportSchema.parse(JSON.parse(fence[1].trim())) as HealthReport; } catch { /* fall through */ }
  }
  const blocks: string[] = [];
  let braceDepth = 0;
  let jsonStart = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "{") {
      if (braceDepth === 0) jsonStart = i;
      braceDepth++;
    } else if (raw[i] === "}") {
      braceDepth--;
      if (braceDepth === 0 && jsonStart >= 0) {
        blocks.push(raw.slice(jsonStart, i + 1));
        jsonStart = -1;
      }
    }
  }
  for (const jsonStr of blocks.sort((a, b) => b.length - a.length)) {
    try { return healthReportSchema.parse(JSON.parse(jsonStr)) as HealthReport; } catch { /* try next block */ }
  }
  throw new Error("No valid JSON found in LLM response");
}
