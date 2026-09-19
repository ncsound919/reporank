import { Router } from "express";
import { z } from "zod";
import type { DimensionContribution } from "@reporank/grading-engine";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { AppError, ErrorCodes } from "../middleware/errorHandler";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createPortfolioSnapshot,
  listPortfolioSnapshots,
  listLatestPortfolioSnapshots,
} from "../services/portfolioSnapshots";

const router: Router = Router();

// Mirrors the grading-engine structural-index shapes (IndexFinding /
// DimensionContribution / IndexNormalization) so payloads round-trip.
const indexFindingSchema = z.object({
  file: z.string(),
  line: z.number().int().optional(),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  reason: z.string(),
  weight: z.number(),
  source: z.string(),
});

const dimensionContributionSchema = z.object({
  dimension: z.string(),
  score: z.number().min(0).max(100),
  weight: z.number(),
  raw: z.number(),
  baseline: z.number(),
  findings: z.array(indexFindingSchema).default([]),
});

const normalizationSchema = z.object({
  cohort: z.string(),
  baseline: z.number(),
  normalizedIndex: z.number(),
});

const createSnapshotSchema = z
  .object({
    repoKey: z.string().min(1).max(500).optional(),
    path: z.string().min(1).max(1000).optional(),
    repo: z.string().min(1).max(500).optional(),
    name: z.string().min(1).max(500).optional(),
    index: z.number().int().min(0).max(100),
    cohort: z.string().max(200).optional(),
    dimensions: z.record(z.string(), z.number()).optional(),
    normalization: normalizationSchema.optional(),
    decomposition: z.array(dimensionContributionSchema).optional(),
  })
  .refine((data) => Boolean(data.repoKey ?? data.path ?? data.repo), {
    message: "One of repoKey, path, or repo is required",
    path: ["repoKey"],
  });

// POST /api/v1/portfolio/snapshots — persist a snapshot for a repo
router.post("/snapshots", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const parsed = createSnapshotSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message, ErrorCodes.VALIDATION_ERROR);

  const repoKey = parsed.data.repoKey ?? parsed.data.path ?? parsed.data.repo!;
  const name = parsed.data.name ?? parsed.data.repo ?? repoKey;

  const snapshot = await createPortfolioSnapshot({
    repoKey,
    name,
    index: parsed.data.index,
    cohort: parsed.data.cohort ?? null,
    dimensions: parsed.data.dimensions ?? null,
    normalization: parsed.data.normalization ?? null,
    decomposition: parsed.data.decomposition as DimensionContribution[] | undefined,
  });

  res.status(201).json({ data: snapshot });
}));

// GET /api/v1/portfolio/snapshots?repo=&limit= — list newest first
router.get("/snapshots", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const repoKey = typeof req.query.repo === "string" && req.query.repo.length > 0 ? req.query.repo : undefined;
  const parsedLimit = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : NaN;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;

  const snapshots = await listPortfolioSnapshots({ repoKey, limit });
  res.json({ data: { snapshots } });
}));

// GET /api/v1/portfolio/latest — latest snapshot per repo
router.get("/latest", authMiddleware, asyncHandler<AuthRequest>(async (_req, res) => {
  const snapshots = await listLatestPortfolioSnapshots();
  res.json({ data: { snapshots } });
}));

export default router;
