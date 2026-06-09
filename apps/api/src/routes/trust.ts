import { Router } from "express";
import { z } from "zod";
import { calculateTrustScore } from "@reporank/grading-engine";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { AppError, ErrorCodes } from "../middleware/errorHandler";
import { asyncHandler } from "../middleware/asyncHandler";
import { renderTrustBadge, renderVibeBadge, renderSoftware20Badge } from "../services/badges";
import { extractScanTrustInputs } from "../services/trustHelper";

const router: Router = Router();

const trustRequestSchema = z.object({
  scanId: z.string().min(1).optional(),
  overallScore: z.number().min(0).max(100).optional(),
  vibeCodingIndex: z.number().min(0).max(100).optional(),
  sourceFiles: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
  fileTree: z.array(z.string()).optional(),
  testFilePaths: z.array(z.string()).optional(),
  securityFindings: z.object({
    critical: z.number().int().min(0).max(10000),
    high: z.number().int().min(0).max(10000),
    medium: z.number().int().min(0).max(10000),
    low: z.number().int().min(0).max(10000),
  }).optional(),
  agentsFile: z.object({
    content: z.string().min(1).max(50000),
    estimatedTokens: z.number().int().min(1).max(100000).optional(),
  }).optional(),
});

// POST /api/v1/trust — compute trust score for any repo
router.post("/", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const parsed = trustRequestSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.errors[0].message, ErrorCodes.VALIDATION_ERROR);

  const trustInput: Parameters<typeof calculateTrustScore>[0] = {
    overallScore: parsed.data.overallScore ?? 0,
    vibeCodingIndex: parsed.data.vibeCodingIndex ?? 0,
  };

  // If a scanId is provided, hydrate from the database (user-scoped)
  if (parsed.data.scanId) {
    const scan = await prisma.scan.findFirst({
      where: { id: parsed.data.scanId, userId: req.userId! },
    });
    if (!scan) throw new AppError(404, "Scan not found", ErrorCodes.NOT_FOUND);
    const extracted = extractScanTrustInputs(scan);
    // Only override what the caller didn't supply
    trustInput.overallScore = parsed.data.overallScore ?? extracted.overallScore;
    trustInput.vibeCodingIndex = parsed.data.vibeCodingIndex ?? extracted.vibeCodingIndex;
    if (!parsed.data.securityFindings && extracted.securityFindings) {
      trustInput.securityFindings = extracted.securityFindings;
    }
  }

  if (parsed.data.sourceFiles && parsed.data.fileTree) {
    trustInput.software20Inputs = {
      sourceFiles: parsed.data.sourceFiles,
      fileTree: parsed.data.fileTree,
      testFilePaths: new Set(parsed.data.testFilePaths ?? []),
    };
  }

  if (parsed.data.securityFindings) {
    trustInput.securityFindings = parsed.data.securityFindings;
  }

  if (parsed.data.agentsFile) {
    trustInput.agentsFile = parsed.data.agentsFile;
  }

  res.json({ data: calculateTrustScore(trustInput) });
}));

// GET /api/v1/trust/scan/:id — compute trust from a stored scan
router.get("/scan/:id", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const scan = await prisma.scan.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!scan) throw new AppError(404, "Scan not found", "NOT_FOUND");
  res.json({ data: calculateTrustScore(extractScanTrustInputs(scan)) });
}));

// ─── PUBLIC BADGES (no auth) ───────────────────────────────────────────

// GET /api/v1/badges/trust/:scanId.svg
router.get("/trust/:scanId.svg", asyncHandler(async (req, res) => {
  const scan = await prisma.scan.findUnique({ where: { id: req.params.scanId } });
  if (!scan) throw new AppError(404, "Scan not found", "NOT_FOUND");
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(renderTrustBadge(calculateTrustScore(extractScanTrustInputs(scan))));
}));

// GET /api/v1/badges/vibe/:scanId.svg
router.get("/vibe/:scanId.svg", asyncHandler(async (req, res) => {
  const scan = await prisma.scan.findUnique({ where: { id: req.params.scanId } });
  if (!scan) throw new AppError(404, "Scan not found", "NOT_FOUND");
  const { vibeCodingIndex } = extractScanTrustInputs(scan);
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(renderVibeBadge(vibeCodingIndex));
}));

// GET /api/v1/badges/software20/:scanId.svg
router.get("/software20/:scanId.svg", asyncHandler(async (req, res) => {
  const scan = await prisma.scan.findUnique({ where: { id: req.params.scanId } });
  if (!scan) throw new AppError(404, "Scan not found", "NOT_FOUND");
  const report = scan.report as { software20Score?: { overall?: number } } | null;
  const s20 = report?.software20Score?.overall ?? 0;
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(renderSoftware20Badge(s20));
}));

export default router;
