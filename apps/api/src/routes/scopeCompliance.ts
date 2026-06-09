import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { AppError, ErrorCodes } from "../middleware/errorHandler";
import { ScanStatus, ErrorCodes as ConstErrorCodes, DriftStatus } from "../constants";

const router: ExpressRouter = Router();

// GET /api/v1/scope-compliance/:projectId — Get scope compliance for a project
router.get("/:projectId", authMiddleware, async (req: AuthRequest, res) => {
  const { projectId } = req.params;

  const project = await prisma.projectBrief.findUnique({
    where: { id: projectId },
    select: { userId: true, orgId: true, deliverables: true, exclusions: true, status: true },
  });

  if (!project) throw new AppError(404, "Project not found", ConstErrorCodes.NOT_FOUND);

  // Verify access
  const canAccess = project.userId === req.userId || (project.orgId && await hasOrgAccess(project.orgId, req.userId!));
  if (!canAccess) throw new AppError(403, "Access denied", ConstErrorCodes.FORBIDDEN);

  // Get latest scan for this project
  const latestScan = await prisma.scan.findFirst({
    where: { projectBriefId: projectId, status: ScanStatus.COMPLETE },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      report: true,
      projectBriefId: true,
    },
  });

  // Compute compliance
  const report = latestScan?.report as any;
  const drift = report?.drift || {};

  const plannedCount = project.deliverables.length;
  const implementedCount = drift.implementedDeliverables?.length || 0;
  const missingCount = drift.missingPlanned?.length || 0;
  const unplannedCount = drift.unplanned?.length || 0;

  const compliancePercent = plannedCount > 0 ? Math.round((implementedCount / plannedCount) * 100) : 0;

  // Get historical snapshots (previous scans for this project)
  const previousScans = await prisma.scan.findMany({
    where: { projectBriefId: projectId, status: ScanStatus.COMPLETE },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: {
      id: true,
      createdAt: true,
      report: true,
    },
  });

  const timeline = previousScans.map((s: any) => {
    const r = s.report as any;
    const d = r?.drift || {};
    const pc = project.deliverables.length > 0 ? Math.round((d.implementedDeliverables?.length || 0 / project.deliverables.length) * 100) : 0;
    return {
      scanId: s.id,
      timestamp: s.createdAt,
      plannedCount: project.deliverables.length,
      implementedCount: d.implementedDeliverables?.length || 0,
      compliancePercent: pc,
      driftStatus: d.status || DriftStatus.ON_SCOPE,
    };
  });

  res.json({
    data: {
      current: {
        briefId: projectId,
        scanId: latestScan?.id || null,
        timestamp: latestScan?.createdAt || new Date(),
        plannedCount,
        implementedCount,
        unplannedCount,
        uncertainCount: 0,
        driftCategories: drift.driftCategories || [],
        missingItems: drift.missingPlanned || [],
        outOfScopeItems: drift.unplanned || [],
        compliancePercent,
      },
      timeline,
    },
  });
});

// Helper to check org access
async function hasOrgAccess(orgId: string, userId: string): Promise<boolean> {
  const member = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });
  return !!member;
}

export default router;
