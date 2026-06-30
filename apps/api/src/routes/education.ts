import { Router } from "express";
import { z } from "zod";
import { auditSubmission, analyzeSession, type DisclosureLayer, type CourseGuideline } from "@reporank/grading-engine";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { AppError, ErrorCodes } from "../middleware/errorHandler";
import { asyncHandler } from "../middleware/asyncHandler";

const router: Router = Router();

const guidelineSchema = z.object({
  id: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  category: z.enum(["naming", "structure", "testing", "ai-usage", "documentation", "performance"]),
  enforced: z.boolean().default(true),
});

const createCourseSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, numbers, and dashes"),
  description: z.string().max(1000).optional(),
  lmsType: z.enum(["canvas", "gradescope", "classroom", "custom"]).default("custom"),
  lmsCourseId: z.string().max(200).optional(),
});

const createAssignmentSchema = z.object({
  courseId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  language: z.string().min(1).max(50).default("typescript"),
  guidelines: z.array(guidelineSchema).max(20).default([]),
  rubric: z.any().optional(),
  dueAt: z.string().datetime().optional(),
});

const sourceFileSchema = z.object({
  path: z.string().min(1).max(512),
  content: z.string().max(500000),
});

const chatTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(10000),
  timestamp: z.string().optional(),
  producedCode: z.boolean().optional(),
  acceptedAsIs: z.boolean().optional(),
});

const submitSchema = z.object({
  assignmentId: z.string().min(1),
  studentEmail: z.string().email().max(200),
  studentName: z.string().max(200).optional(),
  repoUrl: z.string().url().max(500).optional(),
  sourceFiles: z.array(sourceFileSchema).min(1).max(50),
  session: z.array(chatTurnSchema).max(500).optional(),
  unlockedLayers: z.array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])).default([1]),
});

// POST /api/v1/education/courses — create a course
router.post("/courses", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const parsed = createCourseSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.errors[0].message, ErrorCodes.VALIDATION_ERROR);
  const { name, slug, description, lmsType, lmsCourseId } = parsed.data;
  const course = await prisma.course.create({
    data: { name, slug, description, lmsType, lmsCourseId, instructorId: req.userId! },
  });
  res.json({ data: course });
}));

// GET /api/v1/education/courses — list instructor's courses
router.get("/courses", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const courses = await prisma.course.findMany({
    where: { instructorId: req.userId! },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { assignments: true } } },
  });
  res.json({ data: courses });
}));

// GET /api/v1/education/courses/:id — get course with assignments
router.get("/courses/:id", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const course = await prisma.course.findFirst({
    where: { id: req.params.id, instructorId: req.userId! },
    include: { assignments: { orderBy: { createdAt: "desc" } } },
  });
  if (!course) throw new AppError(404, "Course not found", ErrorCodes.NOT_FOUND);
  res.json({ data: course });
}));

// POST /api/v1/education/assignments — create assignment
router.post("/assignments", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const parsed = createAssignmentSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.errors[0].message, ErrorCodes.VALIDATION_ERROR);

  // Verify course ownership
  const course = await prisma.course.findFirst({
    where: { id: parsed.data.courseId, instructorId: req.userId! },
  });
  if (!course) throw new AppError(404, "Course not found", ErrorCodes.NOT_FOUND);

  const assignment = await prisma.assignment.create({
    data: {
      courseId: parsed.data.courseId,
      title: parsed.data.title,
      description: parsed.data.description,
      language: parsed.data.language,
      guidelines: parsed.data.guidelines as any,
      rubric: parsed.data.rubric as any,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
    },
  });
  res.json({ data: assignment });
}));

// POST /api/v1/education/submissions — submit work for audit
router.post("/submissions", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.errors[0].message, ErrorCodes.VALIDATION_ERROR);

  const assignment = await prisma.assignment.findFirst({
    where: { id: parsed.data.assignmentId, course: { instructorId: req.userId! } },
  });
  if (!assignment) throw new AppError(404, "Assignment not found", ErrorCodes.NOT_FOUND);

  const guidelines = (assignment.guidelines as unknown) as CourseGuideline[] ?? [];

  // Run audit
  const auditReport = auditSubmission(
    {
      studentId: parsed.data.studentEmail,
      assignmentId: parsed.data.assignmentId,
      language: assignment.language,
      sourceFiles: parsed.data.sourceFiles,
      guidelines,
    },
    parsed.data.unlockedLayers as DisclosureLayer[],
  );

  // Run session analysis if provided
  let sessionAnalysis = null;
  if (parsed.data.session && parsed.data.session.length > 0) {
    sessionAnalysis = analyzeSession({
      studentId: parsed.data.studentEmail,
      assignmentId: parsed.data.assignmentId,
      turns: parsed.data.session as any,
      finalSubmission: parsed.data.sourceFiles,
    });
  }

  const submission = await prisma.studentSubmission.create({
    data: {
      assignmentId: parsed.data.assignmentId,
      studentEmail: parsed.data.studentEmail,
      studentName: parsed.data.studentName,
      repoUrl: parsed.data.repoUrl,
      sourceFiles: parsed.data.sourceFiles as any,
      session: parsed.data.session as any,
      auditReport: auditReport as any,
      sessionAnalysis: sessionAnalysis as any,
      overallScore: auditReport.overallScore,
      overallGrade: auditReport.overallGrade,
      aiContamination: auditReport.integrity.aiContaminationScore,
    },
  });

  res.json({
    data: {
      submission,
      audit: auditReport,
      session: sessionAnalysis,
    },
  });
}));

// GET /api/v1/education/submissions?assignmentId=... — list submissions
router.get("/submissions", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const assignmentId = req.query.assignmentId as string | undefined;
  const submissions = await prisma.studentSubmission.findMany({
    where: {
      ...(assignmentId ? { assignmentId } : {}),
      assignment: { course: { instructorId: req.userId! } },
    },
    orderBy: { submittedAt: "desc" },
    take: 100,
  });
  res.json({ data: submissions });
}));

// GET /api/v1/education/submissions/:id — get one submission with full audit
router.get("/submissions/:id", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const submission = await prisma.studentSubmission.findFirst({
    where: {
      id: req.params.id,
      assignment: { course: { instructorId: req.userId! } },
    },
  });
  if (!submission) throw new AppError(404, "Submission not found", ErrorCodes.NOT_FOUND);
  res.json({ data: submission });
}));

// POST /api/v1/education/generate-agents-md — auto-generate AGENTS.md from assignment
router.post("/generate-agents-md", authMiddleware, asyncHandler<AuthRequest>(async (req, res) => {
  const body = z.object({
    assignmentId: z.string().min(1),
    mode: z.enum(["minimal", "standard", "comprehensive"]).default("standard"),
  }).safeParse(req.body);
  if (!body.success) throw new AppError(400, body.error.errors[0].message, "VALIDATION_ERROR");

  const assignment = await prisma.assignment.findFirst({
    where: { id: body.data.assignmentId, course: { instructorId: req.userId! } },
    include: { course: true },
  });
  if (!assignment) throw new AppError(404, "Assignment not found", ErrorCodes.NOT_FOUND);

  const guidelines = (assignment.guidelines as unknown) as CourseGuideline[] ?? [];
  const enforced = guidelines.filter(g => g.enforced).length;

  // Generate education-specific AGENTS.md
  const lines: string[] = [
    `# AGENTS.md — ${assignment.course.name} / ${assignment.title}`,
    ``,
    `Generated by RepoRank for student AI-agent collaboration.`,
    ``,
    `## Educational Guidelines`,
    ``,
  ];

  if (body.data.mode === "minimal") {
    lines.push(`- Never write complete code — explain concepts and provide pseudocode only.`);
    lines.push(`- Always ask follow-up questions to confirm the student understands.`);
    lines.push(`- Maximum 3 suggestions per response.`);
  } else {
    for (const g of guidelines) {
      const marker = g.enforced ? "🔴" : "🟡";
      lines.push(`- **${marker} ${g.description}**`);
    }
    if (guidelines.length === 0) {
      lines.push(`- Be patient, ask before assuming.`);
      lines.push(`- Explain reasoning, not just answers.`);
    }
  }

  lines.push(``);
  lines.push(`## Course Context`);
  lines.push(``);
  lines.push(`- Course: ${assignment.course.name}`);
  lines.push(`- Assignment: ${assignment.title}`);
  lines.push(`- Language: ${assignment.language}`);
  if (assignment.description) {
    lines.push(``);
    lines.push(`### Assignment Brief`);
    lines.push(assignment.description);
  }
  lines.push(``);
  lines.push(`## Software 2.0 Compatibility`);
  lines.push(``);
  lines.push(`- Use small files (<300 lines) for easier review.`);
  lines.push(`- Include comments explaining the 'why' — students learn from rationale.`);
  lines.push(`- Prefer simple, readable patterns over clever abstractions.`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by RepoRank education auditor. Edit and commit to your repo.*`);

  res.json({
    data: {
      content: lines.join("\n"),
      assignment: { id: assignment.id, title: assignment.title },
      enforcedGuidelineCount: enforced,
    },
  });
}));

export default router;
