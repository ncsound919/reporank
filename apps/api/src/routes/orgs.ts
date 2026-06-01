import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import crypto from "node:crypto";

const router: ExpressRouter = Router();

router.post("/", authMiddleware, async (req: AuthRequest, res) => {
  const { name, slug } = req.body;
  const org = await prisma.org.create({
    data: { name, slug, members: { create: { userId: req.userId!, role: "owner" } } },
  });
  res.status(201).json({ data: org });
});

router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  const memberships = await prisma.orgMember.findMany({
    where: { userId: req.userId! },
    include: { org: true },
  });
  res.json({
    data: memberships.map(m => ({
      id: m.org.id, name: m.org.name, slug: m.org.slug, role: m.role, plan: m.org.plan,
    })),
  });
});

router.get("/:id", authMiddleware, async (req: AuthRequest, res) => {
  const org = await prisma.org.findUnique({
    where: { id: req.params.id },
    include: { members: { include: { user: { select: { id: true, email: true, displayName: true, avatarUrl: true } } } } },
  });
  if (!org) return res.status(404).json({ error: "Org not found" });
  res.json({ data: org });
});

router.post("/:id/api-keys", authMiddleware, async (req: AuthRequest, res) => {
  const key = `gr_${crypto.randomBytes(32).toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(key).digest("hex");
  await prisma.apiKey.create({
    data: { keyPrefix: key.slice(0, 8), keyHash, name: req.body.name || "default", tier: "free", userId: req.userId! },
  });
  res.status(201).json({ data: { key, keyPrefix: key.slice(0, 8) } });
});

export default router;
