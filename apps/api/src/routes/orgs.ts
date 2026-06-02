import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { prisma } from "../db/client";
import { authMiddleware, orgAccessMiddleware, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import crypto from "node:crypto";
import { z } from "zod";

export const createOrgSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/, "Slug must contain only lowercase letters, numbers, and hyphens").min(3).max(50),
});

const router: ExpressRouter = Router();

router.post("/", authMiddleware, async (req: AuthRequest, res) => {
  const parsed = createOrgSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.errors[0].message, "VALIDATION_ERROR");

  const { name, slug } = parsed.data;
  try {
    const org = await prisma.org.create({
      data: { name, slug, members: { create: { userId: req.userId!, role: "owner" } } },
    });
    res.status(201).json({ data: org });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Organization slug already exists", code: "DUPLICATE_SLUG" });
    }
    throw err;
  }
});

router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  const memberships = await prisma.orgMember.findMany({
    where: { userId: req.userId! },
    include: { org: true },
  });
  res.json({
    data: memberships.map((m: any) => ({
      id: m.org.id, name: m.org.name, slug: m.org.slug, role: m.role, plan: m.org.plan,
    })),
  });
});

router.get("/:id", authMiddleware, orgAccessMiddleware, async (req: AuthRequest, res) => {
  const org = await prisma.org.findUnique({
    where: { id: req.params.id },
    include: { members: { include: { user: { select: { id: true, email: true, displayName: true, avatarUrl: true } } } } },
  });
  if (!org) return res.status(404).json({ error: "Org not found" });
  res.json({ data: org });
});

router.post("/:id/api-keys", authMiddleware, async (req: AuthRequest, res) => {
  const membership = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId: req.params.id, userId: req.userId! } },
  });
  if (!membership) throw new AppError(403, "Not a member of this organization", "FORBIDDEN");

  const key = `gr_${crypto.randomBytes(32).toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(key).digest("hex");
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  const tier = user?.tier || "free";
  await prisma.apiKey.create({
    data: { keyPrefix: key.slice(0, 8), keyHash, name: req.body.name || "default", tier, userId: req.userId! },
  });
  res.status(201).json({ data: { key, keyPrefix: key.slice(0, 8) } });
});

export default router;
