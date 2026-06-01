import { Response, NextFunction } from "express";
import { prisma } from "../db/client";
import { PLAN_LIMITS, type PlanTier } from "@reporank/shared-types";
import { AppError } from "./errorHandler";
import { AuthRequest } from "./auth";

export async function scanLimitMiddleware(req: AuthRequest, _res: Response, next: NextFunction) {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) throw new AppError(404, "User not found", "NOT_FOUND");

  const limits = PLAN_LIMITS[user.tier as PlanTier];
  if (limits.scansPerMonth === -1) return next();

  const scanCount = await prisma.scan.count({
    where: {
      userId: req.userId!,
      createdAt: { gte: new Date(new Date().setDate(1)) },
    },
  });

  if (scanCount >= limits.scansPerMonth) {
    throw new AppError(429, "Monthly scan limit reached", "LIMIT_EXCEEDED");
  }

  next();
}
