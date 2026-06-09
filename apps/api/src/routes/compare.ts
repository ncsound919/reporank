import { Router } from "express";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { AppError, ErrorCodes } from "../middleware/errorHandler";

const router: Router = Router();

// GET /api/v1/compare/:id1/:id2 — Compare two scan results side by side
router.get("/:id1/:id2", authMiddleware, async (req: AuthRequest, res) => {
  const [scan1, scan2] = await Promise.all([
    prisma.scan.findUnique({ where: { id: req.params.id1 } }),
    prisma.scan.findUnique({ where: { id: req.params.id2 } }),
  ]);

  if (!scan1) throw new AppError(404, "First scan not found", ErrorCodes.NOT_FOUND);
  if (!scan2) throw new AppError(404, "Second scan not found", ErrorCodes.NOT_FOUND);

  // Authorization: user must own each scan or belong to the same org
  const canAccess = (scan: any) => scan.userId === req.userId || scan.orgId === req.orgId;
  if (!canAccess(scan1)) throw new AppError(403, "Access denied to first scan", ErrorCodes.FORBIDDEN);
  if (!canAccess(scan2)) throw new AppError(403, "Access denied to second scan", ErrorCodes.FORBIDDEN);

  const report1 = scan1.report as any;
  const report2 = scan2.report as any;

  const delta = {
    overallScore: scan2.overallScore != null && scan1.overallScore != null ? scan2.overallScore - scan1.overallScore : null,
    dimensions: {} as Record<string, number>,
  };

  if (report1?.dimensionScores && report2?.dimensionScores) {
    for (const key of Object.keys(report1.dimensionScores)) {
      delta.dimensions[key] = (report2.dimensionScores[key] || 0) - (report1.dimensionScores[key] || 0);
    }
  }

  res.json({
    data: {
      scan1: {
        id: scan1.id, overallScore: scan1.overallScore, gradeCategory: scan1.gradeCategory,
        maturityLevel: scan1.maturityLevel, vibeScore: scan1.vibeScore,
        repoName: scan1.repoName, repoOwner: scan1.repoOwner,
        createdAt: scan1.createdAt, duration: scan1.duration,
        dimensionScores: report1?.dimensionScores || {},
        quickWins: report1?.quickWins || [],
        vibe: report1?.vibe || {},
        security: report1?.security || {},
      },
      scan2: {
        id: scan2.id, overallScore: scan2.overallScore, gradeCategory: scan2.gradeCategory,
        maturityLevel: scan2.maturityLevel, vibeScore: scan2.vibeScore,
        repoName: scan2.repoName, repoOwner: scan2.repoOwner,
        createdAt: scan2.createdAt, duration: scan2.duration,
        dimensionScores: report2?.dimensionScores || {},
        quickWins: report2?.quickWins || [],
        vibe: report2?.vibe || {},
        security: report2?.security || {},
      },
      delta,
    },
  });
});

// GET /api/v1/compare/milestones/:m1/:m2 — Compare two milestones via their linked scans
router.get("/milestones/:m1/:m2", authMiddleware, async (req: AuthRequest, res) => {
  const [m1, m2] = await Promise.all([
    prisma.milestone.findUnique({ where: { id: req.params.m1 }, include: { brief: { select: { userId: true } } } }),
    prisma.milestone.findUnique({ where: { id: req.params.m2 }, include: { brief: { select: { userId: true } } } }),
  ]);

  if (!m1) throw new AppError(404, "First milestone not found", ErrorCodes.NOT_FOUND);
  if (!m2) throw new AppError(404, "Second milestone not found", ErrorCodes.NOT_FOUND);
  if (m1.brief.userId !== req.userId) throw new AppError(403, "Access denied to first milestone", ErrorCodes.FORBIDDEN);
  if (m2.brief.userId !== req.userId) throw new AppError(403, "Access denied to second milestone", ErrorCodes.FORBIDDEN);
  if (!m1.scanId) throw new AppError(400, "First milestone has no linked scan", ErrorCodes.NO_SCAN);
  if (!m2.scanId) throw new AppError(400, "Second milestone has no linked scan", ErrorCodes.NO_SCAN);

  // Redirect to existing scan compare logic by reusing params
  const [scan1, scan2] = await Promise.all([
    prisma.scan.findUnique({ where: { id: m1.scanId } }),
    prisma.scan.findUnique({ where: { id: m2.scanId } }),
  ]);

  if (!scan1 || !scan2) throw new AppError(404, "Linked scan not found", ErrorCodes.NOT_FOUND);

  const report1 = scan1.report as any;
  const report2 = scan2.report as any;
  const delta = {
    overallScore: scan2.overallScore != null && scan1.overallScore != null ? scan2.overallScore - scan1.overallScore : null,
    dimensions: {} as Record<string, number>,
  };
  if (report1?.dimensionScores && report2?.dimensionScores) {
    for (const key of Object.keys(report1.dimensionScores)) {
      delta.dimensions[key] = (report2.dimensionScores[key] || 0) - (report1.dimensionScores[key] || 0);
    }
  }

  res.json({
    data: {
      milestone1: { id: m1.id, name: m1.name, type: m1.type, status: m1.status },
      milestone2: { id: m2.id, name: m2.name, type: m2.type, status: m2.status },
      scan1: { id: scan1.id, overallScore: scan1.overallScore, gradeCategory: scan1.gradeCategory, createdAt: scan1.createdAt, dimensionScores: report1?.dimensionScores || {}, vibe: report1?.vibe || {}, security: report1?.security || {} },
      scan2: { id: scan2.id, overallScore: scan2.overallScore, gradeCategory: scan2.gradeCategory, createdAt: scan2.createdAt, dimensionScores: report2?.dimensionScores || {}, vibe: report2?.vibe || {}, security: report2?.security || {} },
      delta,
    },
  });
});

export default router;
