import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/client", () => ({
  prisma: {
    course: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    assignment: { create: vi.fn(), findFirst: vi.fn() },
    studentSubmission: { create: vi.fn(), findFirst: vi.fn() },
  },
}));

import request from "supertest";
import express from "express";
import educationRoutes from "../routes/education";
import { authMiddleware } from "../middleware/auth";
import { errorHandler } from "../middleware/errorHandler";
import { prisma } from "../db/client";

vi.mock("../middleware/auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = "instructor-1";
    next();
  },
  AuthRequest: class {},
}));

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/education", authMiddleware as any, educationRoutes);
  app.use(errorHandler);
  return app;
}

describe("POST /api/v1/education/courses — handler integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a course and returns the record", async () => {
    (prisma.course.create as any).mockResolvedValue({
      id: "c1", name: "Intro to TypeScript", slug: "intro-ts",
      lmsType: "custom", instructorId: "instructor-1",
    });
    const res = await request(makeApp())
      .post("/api/v1/education/courses")
      .send({ name: "Intro to TypeScript", slug: "intro-ts" });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe("c1");
  });

  it("rejects bad slug format", async () => {
    const res = await request(makeApp())
      .post("/api/v1/education/courses")
      .send({ name: "Test", slug: "BAD SLUG WITH SPACES" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/v1/education/assignments — handler integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an assignment when course is owned by the user", async () => {
    (prisma.course.findFirst as any).mockResolvedValue({ id: "c1", instructorId: "instructor-1" });
    (prisma.assignment.create as any).mockResolvedValue({
      id: "a1", courseId: "c1", title: "Week 1", language: "typescript",
    });
    const res = await request(makeApp())
      .post("/api/v1/education/assignments")
      .send({ courseId: "c1", title: "Week 1" });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe("a1");
  });

  it("returns 404 when the course is not owned by the user", async () => {
    (prisma.course.findFirst as any).mockResolvedValue(null);
    const res = await request(makeApp())
      .post("/api/v1/education/assignments")
      .send({ courseId: "c1", title: "Week 1" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/education/submissions — handler integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("audits a submission with Karpathy 4-layer disclosure", async () => {
    (prisma.assignment.findFirst as any).mockResolvedValue({
      id: "a1", courseId: "c1", language: "typescript",
    });
    (prisma.studentSubmission.create as any).mockResolvedValue({
      id: "s1", assignmentId: "a1", studentEmail: "alice@school.edu",
    });

    const res = await request(makeApp())
      .post("/api/v1/education/submissions")
      .send({
        assignmentId: "a1",
        studentEmail: "alice@school.edu",
        sourceFiles: [{ path: "src/a.ts", content: "function f() { return 1; }" }],
        unlockedLayers: [1, 2],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.audit).toBeDefined();
    expect(res.body.data.audit.overallScore).toBeDefined();
    expect(res.body.data.audit.layers).toBeDefined();
    expect(res.body.data.audit.layers.layer1).toBeDefined();
  });

  it("rejects empty sourceFiles", async () => {
    const res = await request(makeApp())
      .post("/api/v1/education/submissions")
      .send({
        assignmentId: "a1",
        studentEmail: "alice@school.edu",
        sourceFiles: [],
      });
    expect(res.status).toBe(400);
  });
});
