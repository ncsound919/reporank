import { z } from "zod";
import type { HealthReport } from "@reporank/shared-types";

const healthReportSchema = z.object({
  overallScore: z.number().min(0).max(100),
  gradeCategory: z.enum(["A+","A","B+","B","C","D","F"]),
  maturityLevel: z.enum(["Prototype","MVP","Beta","Production","Enterprise"]),
  summary: z.string(),
  dimensionScores: z.object({ security: z.number(), quality: z.number(), vibe: z.number(), architecture: z.number(), deployment: z.number(), documentation: z.number(), license: z.number(), market: z.number() }),
  security: z.object({ secretsFound: z.number(), vulnerabilityCount: z.number(), highestSeverity: z.enum(["none","low","medium","high","critical"]), vulnerabilities: z.array(z.object({ id: z.string(), severity: z.enum(["low","medium","high","critical"]), title: z.string(), description: z.string(), recommendation: z.string() })), score: z.number() }),
  quality: z.object({ readmeScore: z.number(), testFramework: z.string().nullable(), codeSmells: z.number(), duplicationPercent: z.number(), score: z.number() }),
  vibe: z.object({ overall: z.number(), recommendations: z.array(z.string()) }),
  architecture: z.object({ score: z.number(), complexityRating: z.enum(["low","medium","high","very-high"]), fileCount: z.number() }),
  deployment: z.object({ hasDockerfile: z.boolean(), hasCIConfig: z.boolean(), hasEnvExample: z.boolean(), score: z.number() }),
  documentation: z.object({ readmeCompleteness: z.number(), score: z.number() }),
  license: z.object({ licenseType: z.string().nullable(), isCopyleft: z.boolean(), score: z.number() }),
  market: z.object({ trendAlignment: z.enum(["rising","steady","declining"]), percentileRank: z.number(), score: z.number() }),
  hallucinatedFeatures: z.array(z.string()),
  bugsAndLeaks: z.array(z.string()),
  structuralSmells: z.array(z.string()),
  quickWins: z.array(z.object({ title: z.string(), severity: z.enum(["critical","high","medium","low"]), category: z.string(), effort: z.enum(["minutes","hours","days"]), description: z.string(), action: z.string() })),
  roadmap: z.array(z.object({ phase: z.enum(["now","next","later"]), priority: z.number(), category: z.string(), task: z.string(), effort: z.enum(["hours","days","weeks"]) })),
  implementationPlan: z.array(z.object({ title: z.string(), description: z.string(), targetFiles: z.array(z.string()), promptInstruction: z.string() })),
  globalBenchmarkPercent: z.number(),
});

export function parseHealthReport(raw: string): HealthReport {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in LLM response");
  return healthReportSchema.parse(JSON.parse(jsonMatch[0])) as HealthReport;
}
