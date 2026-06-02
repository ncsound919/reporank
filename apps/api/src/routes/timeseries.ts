import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

const router: ExpressRouter = Router();

// GET /api/v1/scans/:repoId/timeseries — Get scan history for repo (last N scans)
router.get("/:repoId/timeseries", authMiddleware, async (req: AuthRequest, res) => {
  const { repoId } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 365);

  const scans = await prisma.scan.findMany({
    where: { id: repoId },
    select: { id: true, orgId: true, userId: true },
    take: 1,
  });

  if (scans.length === 0) throw new AppError(404, "Scan not found", "NOT_FOUND");

  const scan = scans[0];

  // Verify access
  const canAccess = scan.userId === req.userId || (scan.orgId && await hasOrgAccess(scan.orgId, req.userId!));
  if (!canAccess) throw new AppError(403, "Access denied", "FORBIDDEN");

  // Get all scans for this repo
  const scansForRepo = await prisma.scan.findMany({
    where: {
      repoUrl: (
        await prisma.scan.findUnique({
          where: { id: repoId },
          select: { repoUrl: true },
        })
      )?.repoUrl,
      status: "complete",
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      completedAt: true,
      overallScore: true,
      gradeCategory: true,
      vibeScore: true,
      report: true,
      projectBriefId: true,
    },
  });

  const timeseries = scansForRepo.map((s) => {
    const report = s.report as any;
    return {
      scanId: s.id,
      scannedAt: s.completedAt || s.createdAt,
      overallScore: s.overallScore || 0,
      gradeCategory: s.gradeCategory || "F",
      vibeScore: s.vibeScore || 0,
      dimensionScores: report?.dimensionScores || {},
      driftStatus: report?.drift?.status || "on-scope",
      missingPlanned: report?.drift?.missingPlanned || [],
      unplanned: report?.drift?.unplanned || [],
    };
  });

  res.json({ data: { timeseries } });
});

// Helper to check org access
async function hasOrgAccess(orgId: string, userId: string): Promise<boolean> {
  const member = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });
  return !!member;
}

export default router;
