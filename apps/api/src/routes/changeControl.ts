import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { AppError, ErrorCodes } from "../middleware/errorHandler";
import { asyncHandler } from "../middleware/asyncHandler";
import { ErrorCodes as ConstErrorCodes } from "../constants";

const router: Router = Router();

const changeSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  reason: z.string().max(1000).optional(),
  impactTime: z.string().max(200).optional(),
  impactComplexity: z.enum(["low", "medium", "high", "unknown"]).optional(),
  impactCost: z.string().max(200).optional(),
  newScope: z.record(z.unknown()).optional(),
});

// POST /api/v1/projects/:id/changes — raise a scope change request
router.post("/projects/:id/changes", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const brief = await prisma.projectBrief.findUnique({ where: { id: req.params.id } });
  if (!brief) throw new AppError(404, "Project not found", ConstErrorCodes.NOT_FOUND);
  if (brief.userId !== req.userId) throw new AppError(403, "Access denied", ConstErrorCodes.FORBIDDEN);

  const parsed = changeSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.errors[0].message, ConstErrorCodes.VALIDATION_ERROR);

  const changeRequest = await prisma.scopeChangeRequest.create({
    data: {
      projectId: brief.id,
      title: parsed.data.title,
      description: parsed.data.description,
      reason: parsed.data.reason,
      impactTime: parsed.data.impactTime,
      impactComplexity: parsed.data.impactComplexity,
      impactCost: parsed.data.impactCost,
      requestedBy: req.userId!,
      oldScope: {
        name: brief.name,
        objective: brief.objective,
        targetUsers: brief.targetUsers,
        deliverables: brief.deliverables,
        exclusions: brief.exclusions,
        constraints: brief.constraints,
        assumptions: brief.assumptions,
        acceptanceCriteria: brief.acceptanceCriteria,
        deadline: brief.deadline,
        timebox: brief.timebox,
      } as any,
      newScope: parsed.data.newScope as any,
    },
  });

  res.status(201).json({ data: changeRequest });
}));

// GET /api/v1/projects/:id/changes — list change log for a project
router.get("/projects/:id/changes", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const brief = await prisma.projectBrief.findUnique({ where: { id: req.params.id } });
  if (!brief) throw new AppError(404, "Project not found", ConstErrorCodes.NOT_FOUND);
  if (brief.userId !== req.userId) throw new AppError(403, "Access denied", ConstErrorCodes.FORBIDDEN);

  const changes = await prisma.scopeChangeRequest.findMany({
    where: { projectId: brief.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  res.json({ data: changes });
}));

// PATCH /api/v1/changes/:id — approve or reject a change request
router.patch("/changes/:id", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const change = await prisma.scopeChangeRequest.findUnique({
    where: { id: req.params.id },
    include: { brief: { select: { userId: true } } },
  });
  if (!change) throw new AppError(404, "Change request not found", ConstErrorCodes.NOT_FOUND);
  if (change.brief.userId !== req.userId) throw new AppError(403, "Access denied", ConstErrorCodes.FORBIDDEN);

  const statusSchema = z.object({
    status: z.enum(["approved", "rejected"]),
    notes: z.string().max(500).optional(),
  });
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.errors[0].message, ConstErrorCodes.VALIDATION_ERROR);

  const updated = await prisma.scopeChangeRequest.update({
    where: { id: req.params.id },
    data: { status: parsed.data.status, approvedBy: req.userId! },
  });

  // If approved, apply new scope fields to the brief
  if (parsed.data.status === "approved" && change.newScope) {
    const newScope = JSON.parse(change.newScope) as Record<string, unknown>;
    const allowedFields = [
      "name", "objective", "targetUsers", "deliverables", "exclusions",
      "constraints", "assumptions", "acceptanceCriteria", "deadline", "timebox",
    ];
    const safeUpdate = Object.fromEntries(
      Object.entries(newScope).filter(([k]) => allowedFields.includes(k))
    );
    await prisma.projectBrief.update({
      where: { id: change.projectId },
      data: safeUpdate as any,
    });
  }

  res.json({ data: updated });
}));

export default router;
