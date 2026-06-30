import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { AppError, ErrorCodes } from "../middleware/errorHandler";
import { asyncHandler } from "../middleware/asyncHandler";
import { runScopeMatcher } from "../services/scopeMatcher";
import { ScanStatus, ErrorCodes as ConstErrorCodes } from "../constants";

const router: Router = Router();

// POST /api/v1/drift/:projectId — run drift detection against latest scan
router.post("/:projectId", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const brief = await prisma.projectBrief.findUnique({
    where: { id: req.params.projectId },
  });
  if (!brief) throw new AppError(404, "Project not found", ConstErrorCodes.NOT_FOUND);
  if (brief.userId !== req.userId) throw new AppError(403, "Access denied", ConstErrorCodes.FORBIDDEN);

  const latestScan = await prisma.scan.findFirst({
    where: {
      userId: req.userId!,
      status: ScanStatus.COMPLETE,
      projectBriefId: brief.id,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!latestScan) {
    return res.json({
      data: {
        status: "no-scans",
        message: "No completed scans linked to this project yet.",
        inScope: [], outOfScope: [], missingPlanned: [], uncertain: [], driftCategories: [],
      },
    });
  }

  const report = latestScan.report as any;
  const clawFindings = latestScan.clawFindings as any;
  const fileTree = report?.architecture ? [] : (clawFindings?.fileTree || []);

  const briefInput = {
    deliverables: JSON.parse(brief.deliverables) as string[],
    exclusions: JSON.parse(brief.exclusions) as string[],
    constraints: JSON.parse(brief.constraints) as string[],
    assumptions: JSON.parse(brief.assumptions) as string[],
    intentDocument: brief.intentDocument ? JSON.parse(brief.intentDocument) as Record<string, unknown> : null,
  };

  const result = runScopeMatcher({
    brief: briefInput,
    report,
    fileTree,
    builderMetadata: latestScan.builderMetadata as any,
  });

  // Cache drift result in the scan's clawFindings
  await prisma.scan.update({
    where: { id: latestScan.id },
    data: {
      clawFindings: { ...(latestScan.clawFindings as any || {}), drift: result } as any,
    },
  });

  res.json({ data: result });
}));

// GET /api/v1/drift/:projectId — return cached latest drift result
router.get("/:projectId", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const brief = await prisma.projectBrief.findUnique({ where: { id: req.params.projectId } });
  if (!brief) throw new AppError(404, "Project not found", ConstErrorCodes.NOT_FOUND);
  if (brief.userId !== req.userId) throw new AppError(403, "Access denied", ConstErrorCodes.FORBIDDEN);

   const latestScan = await prisma.scan.findFirst({
    where: { userId: req.userId!, status: ScanStatus.COMPLETE, projectBriefId: brief.id },
    orderBy: { createdAt: "desc" },
    select: { clawFindings: true, createdAt: true, id: true },
  });

  if (!latestScan) {
    return res.json({ data: null });
  }

  const drift = (latestScan.clawFindings as any)?.drift || null;
  res.json({ data: { drift, scanId: latestScan.id, scannedAt: latestScan.createdAt } });
}));

export default router;
