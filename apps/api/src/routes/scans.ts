import { Router } from "express";
import { prisma } from "../db/client";
import { scanQueue, type ScanJobData } from "../jobs/queue";
import { authMiddleware, orgAccessMiddleware, AuthRequest } from "../middleware/auth";
import { scanLimitMiddleware } from "../middleware/tenant";
import { AppError } from "../middleware/errorHandler";
import { z } from "zod";

const router: Router = Router();

const createScanSchema = z.object({
  repoUrl: z.string().url().regex(/github\.com\//),
  branch: z.string().default("main"),
});

const createLocalScanSchema = z.object({
  files: z.array(z.object({
    path: z.string(),
    content: z.string().max(500000), // 500KB per file max
  })).min(1).max(500),
  privateMode: z.boolean().default(false),
  aiProvider: z.enum(["gemini", "ollama", "lmstudio"]).default("gemini"),
  aiModel: z.string().optional(),
  aiEndpoint: z.string().optional(),
  repoName: z.string().default("local-project"),
});

// Standard GitHub scan
router.post("/", authMiddleware, scanLimitMiddleware, orgAccessMiddleware, async (req: AuthRequest, res) => {
  const parsed = createScanSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.errors[0].message, "VALIDATION_ERROR");

  const match = parsed.data.repoUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
  if (!match) throw new AppError(400, "Invalid GitHub URL", "INVALID_URL");

  const scan = await prisma.scan.create({
    data: {
      repoUrl: parsed.data.repoUrl, repoName: match[2].replace(/\.git$/, ""),
      repoOwner: match[1], branch: parsed.data.branch, status: "queued",
      userId: req.userId!, orgId: req.orgId,
    },
  });

  await scanQueue.add({
    scanId: scan.id, repoUrl: parsed.data.repoUrl,
    repoName: match[2].replace(/\.git$/, ""), repoOwner: match[1],
    branch: parsed.data.branch, userId: req.userId!, orgId: req.orgId,
  });

  res.status(201).json({ data: { scanId: scan.id, status: scan.status, estimatedDuration: 120 } });
});

// Local/private scan with file upload
router.post("/local", authMiddleware, scanLimitMiddleware, orgAccessMiddleware, async (req: AuthRequest, res) => {
  const parsed = createLocalScanSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.errors[0].message, "VALIDATION_ERROR");

  const scan = await prisma.scan.create({
    data: {
      repoUrl: "local", repoName: parsed.data.repoName,
      repoOwner: req.userId!, branch: "local", status: "queued",
      userId: req.userId!, orgId: req.orgId,
    },
  });

  await scanQueue.add({
    scanId: scan.id, repoUrl: "local", repoName: parsed.data.repoName,
    repoOwner: req.userId!, branch: "local", userId: req.userId!, orgId: req.orgId,
    localFiles: parsed.data.files,
    privateMode: parsed.data.privateMode,
    aiProvider: parsed.data.aiProvider,
    aiModel: parsed.data.aiModel,
    aiEndpoint: parsed.data.aiEndpoint,
  } as ScanJobData);

  res.status(201).json({ data: { scanId: scan.id, status: scan.status, estimatedDuration: 60 } });
});

router.get("/:id", authMiddleware, async (req: AuthRequest, res) => {
  const scan = await prisma.scan.findUnique({ where: { id: req.params.id } });
  if (!scan) throw new AppError(404, "Scan not found", "NOT_FOUND");

  // Score trending: find previous scan for the same repo
  let previousScore: number | null = null;
  let trending: "up" | "down" | "same" | null = null;
  if (scan.overallScore != null && scan.repoUrl && scan.repoUrl !== "local") {
    const prevScan = await prisma.scan.findFirst({
      where: { repoUrl: scan.repoUrl, id: { not: scan.id }, status: "complete", overallScore: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    if (prevScan?.overallScore != null) {
      previousScore = prevScan.overallScore;
      trending = scan.overallScore > prevScan.overallScore ? "up" : scan.overallScore < prevScan.overallScore ? "down" : "same";
    }
  }

  res.json({
    data: {
      id: scan.id, status: scan.status, progress: scan.progress, message: scan.message,
      result: scan.report, fixPacks: scan.fixPack, clawFindings: scan.clawFindings, error: scan.errorMessage,
      createdAt: scan.createdAt, completedAt: scan.completedAt, duration: scan.duration,
      trending: trending ? { previousScore, delta: scan.overallScore! - previousScore!, direction: trending } : null,
    },
  });
});

router.get("/", authMiddleware, orgAccessMiddleware, async (req: AuthRequest, res) => {
  const scans = await prisma.scan.findMany({
    where: req.orgId ? { orgId: req.orgId } : { userId: req.userId! },
    orderBy: { createdAt: "desc" }, take: 50,
    select: {
      id: true, repoUrl: true, repoName: true, status: true,
      overallScore: true, gradeCategory: true, maturityLevel: true,
      vibeScore: true, createdAt: true, completedAt: true,
    },
  });
  res.json({ data: scans });
});

export default router;
