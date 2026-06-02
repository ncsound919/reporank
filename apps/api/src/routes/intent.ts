import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { asyncHandler } from "../middleware/asyncHandler";
import { parseIntent } from "../services/intentParser";

const router: Router = Router();

const intentSchema = z.object({
  text: z.string().min(10).max(50000),
  source: z.enum(["prompt", "prd", "readme", "knowledge-file", "other"]).default("other"),
});

// POST /api/v1/projects/:id/intent — parse and store intent document
router.post("/projects/:id/intent", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const brief = await prisma.projectBrief.findUnique({ where: { id: req.params.id } });
  if (!brief) throw new AppError(404, "Project not found", "NOT_FOUND");
  if (brief.userId !== req.userId) throw new AppError(403, "Access denied", "FORBIDDEN");

  const parsed = intentSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.errors[0].message, "VALIDATION_ERROR");

  const intentDocument = parseIntent(parsed.data.text, parsed.data.source);

  const updated = await prisma.projectBrief.update({
    where: { id: brief.id },
    data: { intentDocument: intentDocument as any },
  });

  res.json({ data: { intentDocument, briefId: updated.id } });
}));

// GET /api/v1/projects/:id/intent — retrieve parsed intent
router.get("/projects/:id/intent", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const brief = await prisma.projectBrief.findUnique({
    where: { id: req.params.id },
    select: { intentDocument: true, userId: true },
  });
  if (!brief) throw new AppError(404, "Project not found", "NOT_FOUND");
  if (brief.userId !== req.userId) throw new AppError(403, "Access denied", "FORBIDDEN");

  res.json({ data: brief.intentDocument });
}));

// POST /api/v1/integrations/bolt — placeholder (GitHub handoff covers this workflow)
router.post("/integrations/bolt", (_req, res) => {
  res.status(501).json({
    error: "Direct Bolt integration is not yet available. Use the GitHub handoff: Bolt supports importing repos from GitHub, so push your project to GitHub then scan via RepoRank's GitHub URL input.",
    code: "NOT_IMPLEMENTED",
  });
});

// POST /api/v1/integrations/lovable — placeholder
router.post("/integrations/lovable", (_req, res) => {
  res.status(501).json({
    error: "Direct Lovable integration is not yet available. Use the GitHub handoff: Lovable exports to GitHub. Push your project, then scan via RepoRank's GitHub URL input.",
    code: "NOT_IMPLEMENTED",
  });
});

export default router;
