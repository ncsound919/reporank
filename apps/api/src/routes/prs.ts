import { Router } from "express";
import { z } from "zod";
import { predictImpact, generateRecommendations, type FileChange } from "@reporank/grading-engine";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { asyncHandler } from "../middleware/asyncHandler";
import { formatPrComment, commentSignature } from "../services/prCommenter";

const router: Router = Router();

const impactRequestSchema = z.object({
  currentScore: z.number().min(0).max(100),
  changes: z.array(z.object({
    path: z.string().min(1).max(512),
    kind: z.enum(["added", "modified", "removed"]),
    content: z.string().optional(),
    previousContent: z.string().optional(),
    linesAdded: z.number().int().min(0).max(100000).optional(),
    linesRemoved: z.number().int().min(0).max(100000).optional(),
  })).min(1).max(500),
  sourceFiles: z.array(z.object({
    path: z.string(),
    content: z.string(),
  })).optional(),
  fileTree: z.array(z.string()).optional(),
  testFilePaths: z.array(z.string()).optional(),
});

const commentRequestSchema = z.object({
  repoFullName: z.string().min(1).max(200),
  prNumber: z.number().int().min(1),
  currentScore: z.number().min(0).max(100),
  changes: impactRequestSchema.shape.changes,
  includeDetailedBreakdown: z.boolean().default(true),
});

// POST /api/v1/prs/impact — compute impact only
router.post("/impact", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const parsed = impactRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.errors[0].message, "VALIDATION_ERROR");
  }
  const { currentScore, changes, sourceFiles, fileTree, testFilePaths } = parsed.data;
  const testFilePathsSet = new Set(testFilePaths ?? []);
  const report = predictImpact(currentScore, changes as FileChange[], {
    sourceFiles, fileTree, testFilePaths: Array.from(testFilePathsSet),
  });
  res.json({ data: report });
}));

// POST /api/v1/prs/recommendations — generate fix recommendations
router.post("/recommendations", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const parsed = impactRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.errors[0].message, "VALIDATION_ERROR");
  }
  const { currentScore, changes, sourceFiles, fileTree, testFilePaths } = parsed.data;
  const testFilePathsSet = new Set(testFilePaths ?? []);
  const report = predictImpact(currentScore, changes as FileChange[], {
    sourceFiles, fileTree, testFilePaths: Array.from(testFilePathsSet),
  });
  const recommendations = generateRecommendations(report);
  res.json({ data: recommendations });
}));

// POST /api/v1/prs/comment — generate the markdown comment
router.post("/comment", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const parsed = commentRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.errors[0].message, "VALIDATION_ERROR");
  }
  const { repoFullName, prNumber, currentScore, changes, includeDetailedBreakdown } = parsed.data;
  const report = predictImpact(currentScore, changes as FileChange[]);
  const body = formatPrComment(report, {
    repoFullName, prNumber, includeDetailedBreakdown,
  });
  res.json({
    data: {
      comment: body + commentSignature(),
      impact: report,
    },
  });
}));

// POST /api/v1/prs/webhook — GitHub pull_request webhook handler
const webhookSchema = z.object({
  action: z.string(),
  pull_request: z.object({
    number: z.number().int(),
    title: z.string(),
    base: z.object({ ref: z.string() }),
    head: z.object({ sha: z.string(), ref: z.string() }),
  }),
  repository: z.object({
    full_name: z.string(),
    default_branch: z.string().optional(),
  }),
});

router.post("/webhook", async (req, res) => {
  const parsed = webhookSchema.safeParse(req.body);
  if (!parsed.success) {
    // Silently accept and 200 — GitHub retries on non-2xx
    return res.status(200).json({ data: { ignored: true, reason: "unrecognized payload" } });
  }
  const { action, pull_request, repository } = parsed.data;

  // Only respond to events we care about
  if (!["opened", "synchronize", "reopened"].includes(action)) {
    return res.status(200).json({ data: { ignored: true, reason: `action=${action}` } });
  }

  // Look up the repo's RepoRank config (org binding) — fail-soft if not configured
  const config = await prisma.prWebhookConfig.findFirst({
    where: { repoFullName: repository.full_name, enabled: true },
  });

  if (!config) {
    return res.status(200).json({ data: { ignored: true, reason: "no webhook config" } });
  }

  // We don't have a live diff in this mock handler — store the event for processing
  await prisma.prEvent.create({
    data: {
      configId: config.id,
      prNumber: pull_request.number,
      prTitle: pull_request.title,
      headSha: pull_request.head.sha,
      baseRef: pull_request.base.ref,
      action,
      status: "pending",
    },
  });

  res.json({ data: { queued: true, prNumber: pull_request.number } });
});

// GET /api/v1/prs/events?repoFullName=... — list recent PR events (for the dashboard)
router.get("/events", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const repoFullName = req.query.repoFullName as string | undefined;
  const events = await prisma.prEvent.findMany({
    where: repoFullName
      ? { config: { repoFullName, userId: req.userId! } }
      : { config: { userId: req.userId! } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json({ data: events });
}));

// POST /api/v1/prs/config — register a repo for PR commenting
const configSchema = z.object({
  repoFullName: z.string().min(1).max(200),
  enabled: z.boolean().default(true),
  minScoreThreshold: z.number().min(0).max(100).default(60),
  commentOn: z.array(z.enum(["opened", "synchronize", "reopened"])).default(["opened", "synchronize"]),
});

router.post("/config", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.errors[0].message, "VALIDATION_ERROR");
  }
  const { repoFullName, enabled, minScoreThreshold, commentOn } = parsed.data;

  const existing = await prisma.prWebhookConfig.findFirst({
    where: { repoFullName, userId: req.userId! },
  });

  const config = existing
    ? await prisma.prWebhookConfig.update({
        where: { id: existing.id },
        data: { enabled, minScoreThreshold, commentOn },
      })
    : await prisma.prWebhookConfig.create({
        data: {
          userId: req.userId!,
          repoFullName, enabled, minScoreThreshold, commentOn,
        },
      });

  res.json({ data: config });
}));

export default router;
