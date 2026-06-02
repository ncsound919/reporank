import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { asyncHandler } from "../middleware/asyncHandler";
import { evaluateGate } from "../services/gatesEngine";

const router: Router = Router();

const gateSchema = z.object({
  milestoneId: z.string().min(1),
  projectId: z.string().min(1),
  criterion: z.string().min(1).max(500),
  type: z.enum([
    "code-present", "tests-present", "deploy-preview",
    "health-endpoint", "docs-updated", "manual-qa",
    "performance", "security",
  ]),
});

const patchGateSchema = z.object({
  status: z.enum(["pending", "passed", "failed", "overridden"]).optional(),
  evidence: z.string().max(1000).optional(),
  overrideReason: z.string().max(500).optional(),
});

// POST /api/v1/gates — create a gate on a milestone
router.post("/", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const parsed = gateSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.errors[0].message, "VALIDATION_ERROR");

  const milestone = await prisma.milestone.findUnique({
    where: { id: parsed.data.milestoneId },
    include: { brief: { select: { userId: true } } },
  });
  if (!milestone) throw new AppError(404, "Milestone not found", "NOT_FOUND");
  if (milestone.brief.userId !== req.userId) throw new AppError(403, "Access denied", "FORBIDDEN");

  const gate = await prisma.acceptanceGate.create({ data: { ...parsed.data } });
  res.status(201).json({ data: gate });
}));

// GET /api/v1/gates/milestone/:milestoneId — list gates for a milestone
router.get("/milestone/:milestoneId", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const milestone = await prisma.milestone.findUnique({
    where: { id: req.params.milestoneId },
    include: { brief: { select: { userId: true } } },
  });
  if (!milestone) throw new AppError(404, "Milestone not found", "NOT_FOUND");
  if (milestone.brief.userId !== req.userId) throw new AppError(403, "Access denied", "FORBIDDEN");

  const gates = await prisma.acceptanceGate.findMany({
    where: { milestoneId: req.params.milestoneId },
    orderBy: { createdAt: "asc" },
  });

  const completionScore = gates.length === 0 ? 0 :
    Math.round((gates.filter(g => g.status === "passed" || g.status === "overridden").length / gates.length) * 100);

  res.json({ data: { gates, completionScore } });
}));

// PATCH /api/v1/gates/:id — update gate status / add override
router.patch("/:id", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const gate = await prisma.acceptanceGate.findUnique({
    where: { id: req.params.id },
    include: { milestone: { include: { brief: { select: { userId: true } } } } },
  });
  if (!gate) throw new AppError(404, "Gate not found", "NOT_FOUND");
  if (gate.milestone?.brief.userId !== req.userId) throw new AppError(403, "Access denied", "FORBIDDEN");

  const parsed = patchGateSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.errors[0].message, "VALIDATION_ERROR");

  if (parsed.data.status === "overridden" && !parsed.data.overrideReason) {
    throw new AppError(400, "Override reason is required", "VALIDATION_ERROR");
  }

  const updated = await prisma.acceptanceGate.update({
    where: { id: req.params.id },
    data: {
      ...parsed.data,
      approvedBy: ["passed", "overridden"].includes(parsed.data.status || "") ? req.userId! : undefined,
    },
  });

  res.json({ data: updated });
}));

// POST /api/v1/gates/:id/evaluate — auto-evaluate gate against a scan
router.post("/:id/evaluate", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const gate = await prisma.acceptanceGate.findUnique({
    where: { id: req.params.id },
    include: { milestone: { include: { brief: { select: { userId: true } } } } },
  });
  if (!gate) throw new AppError(404, "Gate not found", "NOT_FOUND");
  if (gate.milestone?.brief.userId !== req.userId) throw new AppError(403, "Access denied", "FORBIDDEN");

  const scanId = req.body.scanId as string;
  if (!scanId) throw new AppError(400, "scanId is required", "VALIDATION_ERROR");

  const scan = await prisma.scan.findFirst({
    where: { id: scanId, userId: req.userId! },
    select: { report: true, clawFindings: true, repoUrl: true },
  });
  if (!scan) throw new AppError(404, "Scan not found", "NOT_FOUND");

  const result = evaluateGate(gate, scan.report as any, scan.clawFindings as any);

  const updated = await prisma.acceptanceGate.update({
    where: { id: req.params.id },
    data: {
      status: result.passed ? "passed" : "failed",
      evidence: result.evidence,
    },
  });

  res.json({ data: { gate: updated, evaluation: result } });
}));

export default router;
