import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { prisma } from "../db/client";
import { authMiddleware, orgAccessMiddleware, AuthRequest } from "../middleware/auth";
import { AppError, ErrorCodes } from "../middleware/errorHandler";
import { ScanStatus, GradeCategory, DriftStatus } from "../constants";

const router: ExpressRouter = Router();

// GET /api/v1/dashboards/org/:orgId/summary — Org dashboard with repo list + stats
router.get("/org/:orgId/summary", authMiddleware, orgAccessMiddleware, async (req: AuthRequest, res) => {
  const orgId = req.params.orgId;

  // Verify user has access to this org
  const member = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId: req.userId! } },
  });
  if (!member) throw new AppError(403, "Access denied", ErrorCodes.FORBIDDEN);

  // Get latest scan per repo
  const scans = await prisma.scan.findMany({
    where: { orgId, status: ScanStatus.COMPLETE },
    orderBy: [{ repoUrl: "asc" }, { createdAt: "desc" }],
    take: 500, // Enough for org with many repos
    select: {
      id: true,
      repoUrl: true,
      repoName: true,
      repoOwner: true,
      overallScore: true,
      gradeCategory: true,
      vibeScore: true,
      createdAt: true,
      completedAt: true,
      report: true,
      builderMetadata: true,
    },
  });

  // Group by repo and take latest
  const repoMap = new Map<string, (typeof scans)[0]>();
  for (const scan of scans) {
    if (!repoMap.has(scan.repoUrl) || scan.createdAt > repoMap.get(scan.repoUrl)!.createdAt) {
      repoMap.set(scan.repoUrl, scan);
    }
  }

  const repos = Array.from(repoMap.values()).map((scan) => {
    const report = scan.report as any;
    const builderMeta = scan.builderMetadata as any;
    const prevScore = scan.overallScore || 0;
    const scoreChange = 0; // Would compute from prev scan in future

    return {
      repoId: scan.id,
      repoName: scan.repoName,
      repoUrl: scan.repoUrl,
      buildSource: builderMeta?.buildSource || "github",
      latestScore: scan.overallScore || 0,
      latestGrade: scan.gradeCategory || "F",
      scoreChange,
      trend: scoreChange > 2 ? "improving" : scoreChange < -2 ? "degrading" : "stable",
      driftStatus: (report?.drift?.status || "on-scope") as string,
      lastScannedAt: scan.completedAt || scan.createdAt,
      securityRiskLevel: (report?.security?.level || "medium") as string,
      vibeScore: scan.vibeScore || 0,
    };
  });

  // Compute org-level stats
  const stats = {
    totalRepos: repos.length,
    avgScore: repos.length > 0 ? Math.round(repos.reduce((sum, r) => sum + r.latestScore, 0) / repos.length) : 0,
    byGrade: {
      "A+": repos.filter((r) => r.latestGrade === "A+").length,
      A: repos.filter((r) => r.latestGrade === "A").length,
      "B+": repos.filter((r) => r.latestGrade === "B+").length,
      B: repos.filter((r) => r.latestGrade === "B").length,
      C: repos.filter((r) => r.latestGrade === "C").length,
      D: repos.filter((r) => r.latestGrade === "D").length,
      F: repos.filter((r) => r.latestGrade === "F").length,
    },
    byDrift: {
      "on-scope": repos.filter((r) => r.driftStatus === DriftStatus.ON_SCOPE).length,
      "at-risk": repos.filter((r) => r.driftStatus === DriftStatus.AT_RISK).length,
      drifting: repos.filter((r) => r.driftStatus === DriftStatus.DRIFTING).length,
      blocked: repos.filter((r) => r.driftStatus === DriftStatus.BLOCKED).length,
    },
  };

  res.json({ data: { repos, stats } });
});

// GET /api/v1/dashboards/org/:orgId/health-trendline — Org health trendline over time
router.get("/org/:orgId/health-trendline", authMiddleware, orgAccessMiddleware, async (req: AuthRequest, res) => {
  const orgId = req.params.orgId;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 365);

  // Verify access
  const member = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId: req.userId! } },
  });
  if (!member) throw new AppError(403, "Access denied", ErrorCodes.FORBIDDEN);

  // Get daily aggregated scores
  const scans = await prisma.scan.findMany({
    where: { orgId, status: ScanStatus.COMPLETE, overallScore: { not: null } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      createdAt: true,
      overallScore: true,
      gradeCategory: true,
      report: true,
    },
  });

  // Group by date
  const dailyStats = new Map<string, { scores: number[]; grades: Record<string, number> }>();
  for (const scan of scans) {
    const date = scan.createdAt.toISOString().split("T")[0];
    if (!dailyStats.has(date)) {
      dailyStats.set(date, { scores: [], grades: {} });
    }
    const stat = dailyStats.get(date)!;
    stat.scores.push(scan.overallScore || 0);
    stat.grades[scan.gradeCategory || "F"] = (stat.grades[scan.gradeCategory || "F"] || 0) + 1;
  }

  const trendline = Array.from(dailyStats.entries()).map(([date, stat]) => ({
    date,
    avgScore: Math.round(stat.scores.reduce((a, b) => a + b, 0) / stat.scores.length),
    medianScore: stat.scores.sort((a, b) => a - b)[Math.floor(stat.scores.length / 2)] || 0,
    countByGrade: stat.grades,
  }));

  res.json({ data: { trendline } });
});

// GET /api/v1/dashboards/org/:orgId/risk-hotspots — Top repos by risk
router.get("/org/:orgId/risk-hotspots", authMiddleware, orgAccessMiddleware, async (req: AuthRequest, res) => {
  const orgId = req.params.orgId;
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);

  // Verify access
  const member = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId: req.userId! } },
  });
  if (!member) throw new AppError(403, "Access denied", ErrorCodes.FORBIDDEN);

  // Get latest scans
  const scans = await prisma.scan.findMany({
    where: { orgId, status: ScanStatus.COMPLETE },
    orderBy: [{ repoUrl: "asc" }, { createdAt: "desc" }],
    take: 500,
    select: {
      id: true,
      repoUrl: true,
      repoName: true,
      repoOwner: true,
      overallScore: true,
      vibeScore: true,
      report: true,
      builderMetadata: true,
      createdAt: true,
    },
  });

  // Group by repo, take latest per repo, compute risk score
  const repoMap = new Map<string, (typeof scans)[0]>();
  for (const scan of scans) {
    if (!repoMap.has(scan.repoUrl) || scan.createdAt > repoMap.get(scan.repoUrl)!.createdAt) {
      repoMap.set(scan.repoUrl, scan);
    }
  }

  const hotspots = Array.from(repoMap.values())
    .map((scan) => {
      const report = scan.report as any;
      const securityScore = report?.security?.overallScore || 0;
      const qualityScore = scan.overallScore || 0;
      const driftPenalty = report?.drift?.status === DriftStatus.DRIFTING ? 30 : report?.drift?.status === DriftStatus.AT_RISK ? 15 : 0;
      const riskScore = 100 - ((securityScore + qualityScore) / 2) + driftPenalty;

      return {
        repoId: scan.id,
        repoName: scan.repoName,
        repoUrl: scan.repoUrl,
        riskScore: Math.min(100, Math.max(0, riskScore)),
        securityRisk: report?.security?.level || "medium",
        qualityScore,
        driftStatus: report?.drift?.status || "on-scope",
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, limit);

  res.json({ data: { hotspots } });
});

export default router;
