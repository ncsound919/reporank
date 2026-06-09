import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { AppError, ErrorCodes } from "./errorHandler";
import { prisma } from "../db/client";
import crypto from "node:crypto";

export interface AuthRequest extends Request {
  userId?: string;
  orgId?: string;
}

export async function authMiddleware(req: AuthRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) throw new AppError(401, "No authorization header", "UNAUTHORIZED");

  if (authHeader.startsWith("gr_")) {
    const keyHash = crypto.createHash("sha256").update(authHeader).digest("hex");
    const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });
    if (!apiKey) throw new AppError(401, "Invalid API key", "INVALID_API_KEY");
    await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });
    req.userId = apiKey.userId;
    return next();
  }

  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, config.jwt.secret) as { userId: string };
      req.userId = payload.userId;
      return next();
    } catch {
      throw new AppError(401, "Invalid or expired token", "INVALID_TOKEN");
    }
  }

  throw new AppError(401, "Invalid authorization format", "INVALID_AUTH_FORMAT");
}

export async function orgAccessMiddleware(req: AuthRequest, _res: Response, next: NextFunction) {
  const orgId = req.headers["x-org-id"] as string;
  if (!orgId) return next();
  const membership = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId: req.userId! } },
  });
  if (!membership) throw new AppError(403, "Not a member of this organization", "FORBIDDEN");
  req.orgId = orgId;
  next();
}
