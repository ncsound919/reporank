import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { authMiddleware, orgAccessMiddleware, AuthRequest } from "../middleware/auth";
import { AppError, ErrorCodes } from "../middleware/errorHandler";
import { asyncHandler } from "../middleware/asyncHandler";
import { BriefStatus, ErrorCodes as ConstErrorCodes } from "../constants";

const router: Router = Router();

const briefSchema = z.object({
  name: z.string().min(1).max(200),
  repoUrl: z.string().url().optional().or(z.literal("")),
  buildSource: z.enum(["github", "bolt", "lovable", "manual-upload", "other"]).default("github"),
  objective: z.string().min(1).max(2000),
  targetUsers: z.string().max(500).optional(),
  deliverables: z.array(z.string().min(1).max(500)).min(1, "At least one deliverable is required"),
  exclusions: z.array(z.string().min(1).max(500)).min(1, "At least one exclusion is required"),
  constraints: z.array(z.string().min(1).max(500)).default([]),
  assumptions: z.array(z.string().min(1).max(500)).default([]),
  acceptanceCriteria: z.array(z.string().min(1).max(500)).min(1, "At least one acceptance criterion is required"),
  deadline: z.string().datetime().optional(),
  timebox: z.string().max(100).optional(),
});

const patchBriefSchema = briefSchema.partial();

// POST /api/v1/projects — create a new project brief
router.post("/", authMiddleware, orgAccessMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const parsed = briefSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.errors[0].message, ErrorCodes.VALIDATION_ERROR);

  const brief = await prisma.projectBrief.create({
    data: {
      ...parsed.data,
      deliverables: JSON.stringify(parsed.data.deliverables),
      exclusions: JSON.stringify(parsed.data.exclusions),
      constraints: JSON.stringify(parsed.data.constraints),
      assumptions: JSON.stringify(parsed.data.assumptions),
      acceptanceCriteria: JSON.stringify(parsed.data.acceptanceCriteria),
      repoUrl: parsed.data.repoUrl || null,
      deadline: parsed.data.deadline ? new Date(parsed.data.deadline) : null,
      userId: req.userId!,
      orgId: req.orgId || null,
    },
  });

  res.status(201).json({ data: brief });
}));

// GET /api/v1/projects — list projects for user/org
router.get("/", authMiddleware, orgAccessMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const briefs = await prisma.projectBrief.findMany({
    where: req.orgId ? { orgId: req.orgId } : { userId: req.userId! },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      approvals: { orderBy: { approvedAt: "desc" }, take: 1 },
      milestones: { select: { id: true, name: true, status: true, type: true, targetDate: true } },
      _count: { select: { scans: true } },
    },
  });
  const parsedBriefs = briefs.map(parseBriefFields);
  res.json({ data: parsedBriefs });
}));

// GET /api/v1/projects/:id — get full brief
router.get("/:id", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const brief = await prisma.projectBrief.findUnique({
    where: { id: req.params.id },
    include: {
      approvals: { orderBy: { approvedAt: "desc" } },
      milestones: {
        include: { gates: true },
        orderBy: { createdAt: "asc" },
      },
      changeRequests: { orderBy: { createdAt: "desc" }, take: 20 },
      scans: {
        select: { id: true, status: true, overallScore: true, createdAt: true, repoName: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  if (!brief) throw new AppError(404, "Project not found", ErrorCodes.NOT_FOUND);
  if (brief.userId !== req.userId && brief.orgId !== req.orgId) {
    throw new AppError(403, "Access denied", ErrorCodes.FORBIDDEN);
  }

  res.json({ data: parseBriefFields(brief) });
}));

// PATCH /api/v1/projects/:id — update brief (blocked if approved without change request)
router.patch("/:id", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const brief = await prisma.projectBrief.findUnique({ where: { id: req.params.id } });
  if (!brief) throw new AppError(404, "Project not found", ErrorCodes.NOT_FOUND);
  if (brief.userId !== req.userId) throw new AppError(403, "Access denied", ErrorCodes.FORBIDDEN);

  const parsed = patchBriefSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.errors[0].message, ErrorCodes.VALIDATION_ERROR);

  // If brief is approved, create a scope change request instead of silent edit
  if (brief.status === BriefStatus.APPROVED && Object.keys(parsed.data).length > 0) {
    const normalizedOldScope = { ...(brief as any) };
    for (const field of ["deliverables", "exclusions", "constraints", "assumptions", "acceptanceCriteria"]) {
      if (typeof normalizedOldScope[field] === "string") {
        try { normalizedOldScope[field] = JSON.parse(normalizedOldScope[field]); } catch {}
      }
    }
    const changeRequest = await prisma.scopeChangeRequest.create({
      data: {
        projectId: brief.id,
        title: req.body.changeTitle || "Brief update after approval",
        description: req.body.changeDescription || "",
        reason: req.body.changeReason || "",
        requestedBy: req.userId!,
        oldScope: normalizedOldScope,
        newScope: parsed.data as any,
        status: "pending",
      },
    });
    return res.status(202).json({
      data: { changeRequestId: changeRequest.id },
      message: "Brief is approved. A scope change request has been created.",
    });
  }

  const updated = await prisma.projectBrief.update({
    where: { id: req.params.id },
    data: {
      ...parsed.data,
      deliverables: parsed.data.deliverables ? JSON.stringify(parsed.data.deliverables) : undefined,
      exclusions: parsed.data.exclusions ? JSON.stringify(parsed.data.exclusions) : undefined,
      constraints: parsed.data.constraints ? JSON.stringify(parsed.data.constraints) : undefined,
      assumptions: parsed.data.assumptions ? JSON.stringify(parsed.data.assumptions) : undefined,
      acceptanceCriteria: parsed.data.acceptanceCriteria ? JSON.stringify(parsed.data.acceptanceCriteria) : undefined,
      deadline: parsed.data.deadline ? new Date(parsed.data.deadline) : undefined,
    },
  });

  res.json({ data: updated });
}));

// POST /api/v1/projects/:id/approve — approve the brief
router.post("/:id/approve", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const brief = await prisma.projectBrief.findUnique({ where: { id: req.params.id } });
  if (!brief) throw new AppError(404, "Project not found", ErrorCodes.NOT_FOUND);
  if (brief.userId !== req.userId) throw new AppError(403, "Access denied", ErrorCodes.FORBIDDEN);

  // Validate minimum requirements before approval
  // deliverables, exclusions, acceptanceCriteria are stored as JSON.stringify(array)
  let deliverables: unknown[];
  try { deliverables = JSON.parse(brief.deliverables); } catch { throw new AppError(400, "Invalid deliverables format", ConstErrorCodes.VALIDATION_ERROR); }
  if (!Array.isArray(deliverables) || deliverables.length === 0) throw new AppError(400, "At least one deliverable required", ConstErrorCodes.VALIDATION_ERROR);

  let exclusions: unknown[];
  try { exclusions = JSON.parse(brief.exclusions); } catch { throw new AppError(400, "Invalid exclusions format", ConstErrorCodes.VALIDATION_ERROR); }
  if (!Array.isArray(exclusions) || exclusions.length === 0) throw new AppError(400, "At least one exclusion required", ConstErrorCodes.VALIDATION_ERROR);

  let acceptanceCriteria: unknown[];
  try { acceptanceCriteria = JSON.parse(brief.acceptanceCriteria); } catch { throw new AppError(400, "Invalid acceptance criteria format", ConstErrorCodes.VALIDATION_ERROR); }
  if (!Array.isArray(acceptanceCriteria) || acceptanceCriteria.length === 0) throw new AppError(400, "At least one acceptance criterion required", ConstErrorCodes.VALIDATION_ERROR);

  const existingApprovals = await prisma.briefApproval.findMany({ where: { projectBriefId: brief.id } });
  const version = existingApprovals.length + 1;

  const [updated, approval] = await prisma.$transaction([
    prisma.projectBrief.update({ where: { id: brief.id }, data: { status: BriefStatus.APPROVED } }),
    prisma.briefApproval.create({
      data: {
        projectBriefId: brief.id,
        approvedBy: req.userId!,
        version,
        notes: req.body.notes || null,
      },
    }),
  ]);

  res.json({ data: { brief: updated, approval } });
}));

function parseBriefFields(record: any): any {
  const data = { ...record };
  for (const field of ["deliverables", "exclusions", "constraints", "assumptions", "acceptanceCriteria"]) {
    if (typeof data[field] === "string") {
      try { data[field] = JSON.parse(data[field]); } catch {}
    }
  }
  return data;
}

export default router;
