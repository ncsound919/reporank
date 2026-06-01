import { Router } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../db/client";
import { config } from "../config";
import { authMiddleware, AuthRequest } from "../middleware/auth";

const router: Router = Router();

router.post("/github", async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Authorization code required" });

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: config.github.clientId,
      client_secret: config.github.clientSecret,
      code,
    }),
  });
  const tokenData = await tokenRes.json() as any;
  if (!tokenData.access_token) return res.status(401).json({ error: "Failed to exchange GitHub code" });

  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const githubUser = await userRes.json() as any;

  let user = await prisma.user.findUnique({ where: { githubId: String(githubUser.id) } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: githubUser.email || `${githubUser.login}@github.com`,
        displayName: githubUser.name || githubUser.login,
        githubId: String(githubUser.id),
        avatarUrl: githubUser.avatar_url,
      },
    });
  }

  const jwtToken = jwt.sign({ userId: user.id }, config.jwt.secret, { expiresIn: config.jwt.expiresIn as any });
  res.json({ data: { token: jwtToken, user: { id: user.id, email: user.email, displayName: user.displayName } } });
});

router.get("/me", authMiddleware, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({
    data: {
      id: user.id, email: user.email, displayName: user.displayName,
      avatarUrl: user.avatarUrl, tier: user.tier, scansThisMonth: user.scansThisMonth,
    },
  });
});

export default router;
