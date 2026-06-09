/**
 * Internal route for Mutly → RepoRank integration.
 *
 * Authenticated via a shared `X-Mutly-Key` header (validated against the
 * MUTLY_API_KEY environment variable).  This bypasses user JWT auth so Mutly
 * can submit workspace scans without a user account.
 *
 * Rate-limited to 10 requests / minute per key to prevent abuse.
 */
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../db/client";
import { scanQueue } from "../jobs/queue";
import type { ScanJobData } from "../jobs/queue";
import { AppError, ErrorCodes } from "../middleware/errorHandler";
import { asyncHandler } from "../middleware/asyncHandler";
import { logger } from "../logger";
import { ScanStatus, ErrorCodes as ConstErrorCodes } from "../constants";

const router: Router = Router();

// ─── Rate limiter ─────────────────────────────────────────────────────────────

const internalRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many internal scan requests — slow down" },
});

// ─── Key auth middleware ───────────────────────────────────────────────────────

function requireMutlyKey(req: any, _res: any, next: any) {
  const expectedKey = process.env.MUTLY_API_KEY;
  if (!expectedKey) {
    // If MUTLY_API_KEY is not set, the internal endpoint is disabled
    throw new AppError(503, "Internal endpoint not configured (MUTLY_API_KEY unset)", "NOT_CONFIGURED");
  }
  const providedKey = req.headers["x-mutly-key"] as string | undefined;
  if (!providedKey || providedKey !== expectedKey) {
    throw new AppError(401, "Invalid or missing X-Mutly-Key header", ConstErrorCodes.UNAUTHORIZED);
  }
  // Attach a synthetic userId so downstream code that reads req.userId works
  req.userId = `mutly-internal`;
  next();
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const mutlyScanSchema = z.object({
  files: z
    .array(
      z.object({
        path: z
          .string()
          .max(500)
          .refine(
            (p) =>
              !p.includes("..") &&
              !p.startsWith("/") &&
              !p.startsWith("\\") &&
              !/^[A-Za-z]:[\\/]/.test(p),
            "Path traversal not allowed"
          )
          .refine(
            (p) => !/[\x00-\x1F\x7F-\x9F]/.test(p),
            "Control characters in path not allowed"
          ),
        content: z.string().max(500_000),
      })
    )
    .min(1)
    .max(500),
  privateMode: z.boolean().default(true),
  repoName: z.string().default("mutly-workspace"),
});

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/internal/mutly/scan
 *
 * Accepts a local workspace file set from the Mutly daemon, queues it as a
 * Bull scan job, and returns the scanId for polling.
 */
router.post(
  "/mutly/scan",
  internalRateLimit,
  requireMutlyKey,
  asyncHandler(async (req, res) => {
    const parsed = mutlyScanSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0].message, ConstErrorCodes.VALIDATION_ERROR);
    }

    const { files, privateMode, repoName } = parsed.data;

    logger.info(
      { repoName, fileCount: files.length },
      "[internal] Mutly scan submitted"
    );

    // Ensure the internal user exists (for SQLite FK constraint)
    await prisma.user.upsert({
      where: { email: "mutly-internal@local" },
      create: { id: "mutly-internal", email: "mutly-internal@local", displayName: "Mutly Internal" },
      update: {},
    });

    const scan = await prisma.scan.create({
      data: {
        repoUrl: "local",
        repoName,
        repoOwner: "mutly-internal",
        branch: "local",
        status: ScanStatus.QUEUED,
        userId: "mutly-internal",
        builderMetadata: { buildSource: "manual-upload", source: "mutly" } as any,
      },
    });

    await scanQueue.add({
      scanId: scan.id,
      repoUrl: "local",
      repoName,
      repoOwner: "mutly-internal",
      branch: "local",
      userId: "mutly-internal",
      localFiles: files,
      privateMode,
    } as ScanJobData);

    res.status(201).json({
      data: {
        scanId: scan.id,
        status: scan.status,
        estimatedDuration: 60,
      },
    });
  })
);

/**
 * GET /api/v1/internal/mutly/scan/:id
 *
 * Poll for scan result status.  Authenticated via the same X-Mutly-Key header
 * used by the POST endpoint so Mutly does not need a user JWT.
 *
 * Response shape matches Mutly's ReporankScanResponse interface:
 *   { data: { id, status, result?, error? } }
 */
router.get(
  "/mutly/scan/:id",
  requireMutlyKey,
  asyncHandler(async (req, res) => {
    const scan = await prisma.scan.findUnique({ where: { id: req.params.id } });
    if (!scan) {
      throw new AppError(404, "Scan not found", ConstErrorCodes.NOT_FOUND);
    }

    res.json({
      data: {
        id: scan.id,
        status: scan.status,
        result: scan.status === ScanStatus.COMPLETE ? scan.report : undefined,
        error: scan.errorMessage ?? undefined,
        // Extra fields Mutly ignores but useful for debugging
        progress: scan.progress,
        message: scan.message,
        createdAt: scan.createdAt,
        completedAt: scan.completedAt,
        duration: scan.duration,
      },
    });
  })
);

export default router;
