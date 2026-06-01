import { Response, NextFunction } from "express";
import { prisma } from "../db/client";
import { PLAN_LIMITS, type PlanTier } from "@reporank/shared-types";
import { AppError } from "./errorHandler";
import { AuthRequest } from "./auth";
import rateLimit from "express-rate-limit";

export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later", code: "RATE_LIMITED" },
});

export async function scanLimitMiddleware(req: AuthRequest, _res: Response, next: NextFunction) {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) throw new AppError(404, "User not found", "NOT_FOUND");

  const limits = PLAN_LIMITS[user.tier as PlanTier];
  if (limits.scansPerMonth === -1) return next();

  // Atomic increment-and-check using Prisma transactions to prevent TOCTOU
  const result = await prisma.$transaction(async (tx) => {
    const count = await tx.scan.count({
      where: {
        userId: req.userId!,
        createdAt: { gte: new Date(new Date().setDate(1)) },
      },
    });

    if (count >= limits.scansPerMonth) {
      throw new AppError(429, "Monthly scan limit reached", "LIMIT_EXCEEDED");
    }

    return true;
  });

  next();
}
