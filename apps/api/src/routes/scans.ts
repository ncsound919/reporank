import { Router } from "express";
import { prisma } from "../db/client";
import { scanQueue } from "../jobs/queue";
import { authMiddleware, orgAccessMiddleware, AuthRequest } from "../middleware/auth";
import { scanLimitMiddleware } from "../middleware/tenant";
import { AppError } from "../middleware/errorHandler";
import { z } from "zod";

const router: Router = Router();
const createScanSchema = z.object({
  repoUrl: z.string().url().regex(/github\.com\//),
  branch: z.string().default("main"),
});

router.post("/", authMiddleware, scanLimitMiddleware, orgAccessMiddleware, async (req: AuthRequest, res) => {
  const parsed = createScanSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.errors[0].message, "VALIDATION_ERROR");

  const match = parsed.data.repoUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
  if (!match) throw new AppError(400, "Invalid GitHub URL", "INVALID_URL");

  const scan = await prisma.scan.create({
    data: {
      repoUrl: parsed.data.repoUrl,
      repoName: match[2].replace(/\.git$/, ""),
      repoOwner: match[1],
      branch: parsed.data.branch,
      status: "queued",
      userId: req.userId!,
      orgId: req.orgId,
    },
  });

  await scanQueue.add({
    scanId: scan.id,
    repoUrl: parsed.data.repoUrl,
    repoName: match[2].replace(/\.git$/, ""),
    repoOwner: match[1],
    branch: parsed.data.branch,
    userId: req.userId!,
    orgId: req.orgId,
  });

  res.status(201).json({ data: { scanId: scan.id, status: scan.status, estimatedDuration: 120 } });
});

router.get("/:id", authMiddleware, async (req: AuthRequest, res) => {
  const scan = await prisma.scan.findUnique({ where: { id: req.params.id } });
  if (!scan) throw new AppError(404, "Scan not found", "NOT_FOUND");
  res.json({
    data: {
      id: scan.id, status: scan.status, progress: scan.progress, message: scan.message,
      result: scan.report, error: scan.errorMessage,
      createdAt: scan.createdAt, completedAt: scan.completedAt, duration: scan.duration,
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
