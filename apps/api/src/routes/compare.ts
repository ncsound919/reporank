import { Router } from "express";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

const router: Router = Router();

// GET /api/v1/compare/:id1/:id2 — Compare two scan results side by side
router.get("/:id1/:id2", authMiddleware, async (req: AuthRequest, res) => {
  const [scan1, scan2] = await Promise.all([
    prisma.scan.findUnique({ where: { id: req.params.id1 } }),
    prisma.scan.findUnique({ where: { id: req.params.id2 } }),
  ]);

  if (!scan1) throw new AppError(404, "First scan not found", "NOT_FOUND");
  if (!scan2) throw new AppError(404, "Second scan not found", "NOT_FOUND");

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

export default router;
