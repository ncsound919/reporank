import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { asyncHandler } from "../middleware/asyncHandler";

const router: Router = Router();

const milestoneSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(200),
  type: z.enum(["baseline", "feature-complete", "qa-ready", "launch-candidate", "post-launch"]).default("feature-complete"),
  targetDate: z.string().datetime().optional(),
  goal: z.string().max(1000).optional(),
  acceptanceCriteriaSnapshot: z.array(z.string()).default([]),
  scanId: z.string().optional(),
});

const patchMilestoneSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.enum(["baseline", "feature-complete", "qa-ready", "launch-candidate", "post-launch"]).optional(),
  targetDate: z.string().datetime().optional(),
  goal: z.string().max(1000).optional(),
  status: z.enum(["pending", "achieved", "missed"]).optional(),
  scanId: z.string().optional(),
});

// POST /api/v1/milestones — create milestone
router.post("/", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const parsed = milestoneSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.errors[0].message, "VALIDATION_ERROR");

  // Verify user owns the project
  const brief = await prisma.projectBrief.findUnique({ where: { id: parsed.data.projectId } });
  if (!brief) throw new AppError(404, "Project not found", "NOT_FOUND");
  if (brief.userId !== req.userId) throw new AppError(403, "Access denied", "FORBIDDEN");

  // Snapshot acceptance criteria from brief if not provided
  const snapshot = parsed.data.acceptanceCriteriaSnapshot.length > 0
    ? parsed.data.acceptanceCriteriaSnapshot
    : brief.acceptanceCriteria;

  const milestone = await prisma.milestone.create({
    data: {
      ...parsed.data,
      targetDate: parsed.data.targetDate ? new Date(parsed.data.targetDate) : null,
      acceptanceCriteriaSnapshot: snapshot,
    },
    include: { gates: true },
  });

  res.status(201).json({ data: milestone });
}));

// GET /api/v1/milestones/:id
router.get("/:id", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const milestone = await prisma.milestone.findUnique({
    where: { id: req.params.id },
    include: { gates: true, brief: { select: { userId: true, name: true, status: true } } },
  });
  if (!milestone) throw new AppError(404, "Milestone not found", "NOT_FOUND");
  if (milestone.brief.userId !== req.userId) throw new AppError(403, "Access denied", "FORBIDDEN");

  res.json({ data: milestone });
}));

// PATCH /api/v1/milestones/:id
router.patch("/:id", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const milestone = await prisma.milestone.findUnique({
    where: { id: req.params.id },
    include: { brief: { select: { userId: true } }, gates: true },
  });
  if (!milestone) throw new AppError(404, "Milestone not found", "NOT_FOUND");
  if (milestone.brief.userId !== req.userId) throw new AppError(403, "Access denied", "FORBIDDEN");

  // Block "achieved" if any non-overridden gates are still pending/failed
  const parsed = patchMilestoneSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.errors[0].message, "VALIDATION_ERROR");

  if (parsed.data.status === "achieved") {
    const blockingGates = milestone.gates.filter(
      g => g.status === "pending" || g.status === "failed"
    );
    if (blockingGates.length > 0) {
      throw new AppError(
        409,
        `${blockingGates.length} acceptance gate(s) must pass or be overridden before marking achieved`,
        "GATES_BLOCKING"
      );
    }
  }

  const updated = await prisma.milestone.update({
    where: { id: req.params.id },
    data: {
      ...parsed.data,
      targetDate: parsed.data.targetDate ? new Date(parsed.data.targetDate) : undefined,
    },
    include: { gates: true },
  });

  res.json({ data: updated });
}));

// POST /api/v1/milestones/:id/promote — attach the current user's latest scan to this milestone
router.post("/:id/promote", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const milestone = await prisma.milestone.findUnique({
    where: { id: req.params.id },
    include: { brief: { select: { userId: true, repoUrl: true } } },
  });
  if (!milestone) throw new AppError(404, "Milestone not found", "NOT_FOUND");
  if (milestone.brief.userId !== req.userId) throw new AppError(403, "Access denied", "FORBIDDEN");

  const scanId = req.body.scanId as string | undefined;
  let resolvedScanId = scanId;

  if (!resolvedScanId) {
    // Auto-pick latest completed scan for this project's repo
    const latestScan = await prisma.scan.findFirst({
      where: {
        userId: req.userId!,
        status: "complete",
        ...(milestone.brief.repoUrl ? { repoUrl: milestone.brief.repoUrl } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    if (!latestScan) throw new AppError(404, "No completed scans found to promote", "NOT_FOUND");
    resolvedScanId = latestScan.id;
  }

  const updated = await prisma.milestone.update({
    where: { id: req.params.id },
    data: { scanId: resolvedScanId },
    include: { gates: true },
  });

  res.json({ data: updated });
}));

// GET /api/v1/milestones/project/:projectId — list milestones for a project
router.get("/project/:projectId", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const brief = await prisma.projectBrief.findUnique({ where: { id: req.params.projectId } });
  if (!brief) throw new AppError(404, "Project not found", "NOT_FOUND");
  if (brief.userId !== req.userId) throw new AppError(403, "Access denied", "FORBIDDEN");

  const milestones = await prisma.milestone.findMany({
    where: { projectId: req.params.projectId },
    include: { gates: true },
    orderBy: { createdAt: "asc" },
  });

  res.json({ data: milestones });
}));

export default router;
