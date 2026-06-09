import { Request, Response, NextFunction } from "express";
import { logger } from "../logger";

export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  LIMIT_EXCEEDED: "LIMIT_EXCEEDED",
  INVALID_URL: "INVALID_URL",
  DUPLICATE_SLUG: "DUPLICATE_SLUG",
  RATE_LIMITED: "RATE_LIMITED",
  STRIPE_NOT_CONFIGURED: "STRIPE_NOT_CONFIGURED",
  STRIPE_WEBHOOK_NOT_CONFIGURED: "STRIPE_WEBHOOK_NOT_CONFIGURED",
  NO_SCAN: "NO_SCAN",
  ORG_REQUIRED: "ORG_REQUIRED",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  UNAUTHORIZED: "UNAUTHORIZED",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  GATES_BLOCKING: "GATES_BLOCKING",
} as const;

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
  }

  logger.error(err, "Unhandled error");
  return res.status(500).json({
    error: "Internal server error",
  });
}
