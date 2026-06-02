import { Router } from "express";
import { z } from "zod";
import { generateGuidelines, estimateContextWindowFit, checkGuidelinesCompliance, getRulesForAnalysis, type CodebaseAnalysis } from "@reporank/agent-guidelines";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { asyncHandler } from "../middleware/asyncHandler";
import { recordAgentsFile, listAgentsFileHistory, getLatestAgentsFile } from "../services/agentsRegistry";

// Strict format: owner/repo. Allows alphanumerics, dots, underscores, dashes.
// No path traversal, no control chars, no slashes inside segments.
const REPO_FULL_NAME_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
const repoFullNameSchema = z.string()
  .min(3)
  .max(200)
  .regex(REPO_FULL_NAME_RE, "repoFullName must be 'owner/repo' format");

const router: Router = Router();

const generateSchema = z.object({
  mode: z.enum(["minimal", "standard", "comprehensive"]).default("standard"),
  isEducation: z.boolean().default(false),
  vibeCodingScore: z.number().min(0).max(100).default(0),
  securityIssues: z.number().min(0).default(0),
  aiGeneratedPatterns: z.number().min(0).default(0),
  hasTests: z.boolean().default(false),
  hasLicense: z.boolean().default(false),
  hasCI: z.boolean().default(false),
  hasDockerfile: z.boolean().default(false),
  fileCount: z.number().min(0).default(0),
  languages: z.array(z.string()).default([]),
  teamSize: z.number().min(1).default(1),
  framework: z.string().default("unknown"),
  repoFullName: repoFullNameSchema.optional(),
});

// Generate AGENTS.md from analysis parameters
router.post("/generate", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.errors[0].message, "VALIDATION_ERROR");

  const analysis: CodebaseAnalysis = parsed.data;
  const mode = analysis.isEducation ? "standard" : parsed.data.mode;
  const guidelines = generateGuidelines(mode, analysis);
  const contextFit = estimateContextWindowFit(guidelines);

  // Optionally record in the registry if repoFullName is provided
  let recordId: string | undefined;
  if (parsed.data.repoFullName) {
    // Count only level-2 headings (## ), not the # AGENTS.md title
    const ruleCount = (guidelines.match(/^##\s/gm) || []).length;
    const record = await recordAgentsFile({
      userId: req.userId!,
      repoFullName: parsed.data.repoFullName,
      mode,
      content: guidelines,
      estimatedTokens: contextFit.tokenEstimate,
      ruleCount,
      generatedBy: "api",
    });
    recordId = record.id;
  }

  res.json({
    data: {
      guidelines,
      analysis,
      contextFit,
      recordId,
    },
  });
}));

// Audit an existing AGENTS.md for compliance
router.post("/audit", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const { content, violations } = req.body;
  if (!content) throw new AppError(400, "AGENTS.md content is required", "VALIDATION_ERROR");

  const result = checkGuidelinesCompliance(content, violations || []);
  res.json({ data: result });
}));

// Get Vibe Coding Index history for a repo
router.get("/vibe-history", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const repoUrl = req.query.repoUrl as string;
  if (!repoUrl) throw new AppError(400, "repoUrl query parameter is required", "VALIDATION_ERROR");

  const scans = await prisma.scan.findMany({
    where: { repoUrl, status: "complete", userId: req.userId! },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: {
      id: true, createdAt: true, overallScore: true,
      report: true, vibeScore: true,
    },
  });

  const history = scans.map((s: { id: string; createdAt: Date; report: unknown; overallScore: number | null; vibeScore: number | null }) => {
    const report = s.report as { vibeCodingIndex?: { overallScore?: number; knownHumanScore?: number } } | null;
    return {
      scanId: s.id,
      scannedAt: s.createdAt,
      vibeCodingIndex: report?.vibeCodingIndex?.overallScore ?? null,
      vibeHumanScore: report?.vibeCodingIndex?.knownHumanScore ?? null,
      overallScore: s.overallScore,
      vibeScore: s.vibeScore,
    };
  }).filter((h: { vibeCodingIndex: number | null }) => h.vibeCodingIndex !== null);

  // Compute trend
  let trend: "rising" | "falling" | "stable" | "insufficient-data" = "insufficient-data";
  if (history.length >= 2) {
    const first = history[0].vibeCodingIndex!;
    const last = history[history.length - 1].vibeCodingIndex!;
    const delta = last - first;
    trend = delta > 5 ? "rising" : delta < -5 ? "falling" : "stable";
  }

  res.json({
    data: {
      repoUrl,
      history,
      trend,
      totalScans: history.length,
      currentVibeScore: history[history.length - 1]?.vibeCodingIndex ?? null,
    },
  });
}));
router.get("/rules", authMiddleware, asyncHandler<AuthRequest>(async (_req, res) => {
  const { getRulesForAnalysis } = await import("@reporank/agent-guidelines");
  const allRules = getRulesForAnalysis({
    vibeCodingScore: 0, securityIssues: 0, aiGeneratedPatterns: 0,
    hasTests: false, hasLicense: false, hasCI: false, hasDockerfile: false,
    fileCount: 0, languages: [], teamSize: 1, isEducation: false, framework: "unknown",
  });
  res.json({ data: allRules });
}));

// AGENTS.md registry: list version history for a repo
router.get("/registry/history", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const repoFullName = repoFullNameSchema.safeParse(req.query.repoFullName);
  if (!repoFullName.success) throw new AppError(400, "repoFullName query parameter must be 'owner/repo' format", "VALIDATION_ERROR");
  const limit = Math.min(parseInt((req.query.limit as string) || "10", 10), 50);
  const history = await listAgentsFileHistory({ userId: req.userId!, repoFullName: repoFullName.data, limit });
  res.json({ data: history });
}));

// AGENTS.md registry: get latest version for a repo
router.get("/registry/latest", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const repoFullName = repoFullNameSchema.safeParse(req.query.repoFullName);
  if (!repoFullName.success) throw new AppError(400, "repoFullName query parameter must be 'owner/repo' format", "VALIDATION_ERROR");
  const latest = await getLatestAgentsFile({ userId: req.userId!, repoFullName: repoFullName.data });
  res.json({ data: latest });
}));

export default router;
