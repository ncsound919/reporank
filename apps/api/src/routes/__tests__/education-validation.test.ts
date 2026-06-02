import { describe, it, expect } from "vitest";
import { z } from "zod";

// Mirror schemas from education.ts route
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

const submitSchema = z.object({
  assignmentId: z.string().min(1),
  studentEmail: z.string().email().max(200),
  studentName: z.string().max(200).optional(),
  repoUrl: z.string().url().max(500).optional(),
  sourceFiles: z.array(sourceFileSchema).min(1).max(50),
  session: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(10000),
  })).max(500).optional(),
  unlockedLayers: z.array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])).default([1]),
});

describe("education course schema", () => {
  it("accepts a valid course", () => {
    const result = createCourseSchema.safeParse({
      name: "CS 101", slug: "cs-101", description: "Intro to CS",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid slug (uppercase)", () => {
    const result = createCourseSchema.safeParse({ name: "x", slug: "CS-101" });
    expect(result.success).toBe(false);
  });

  it("rejects slug with special chars", () => {
    const result = createCourseSchema.safeParse({ name: "x", slug: "cs_101!" });
    expect(result.success).toBe(false);
  });

  it("rejects name longer than 200 chars", () => {
    const result = createCourseSchema.safeParse({ name: "x".repeat(201), slug: "x" });
    expect(result.success).toBe(false);
  });
});

describe("education assignment schema", () => {
  it("accepts valid assignment", () => {
    const result = createAssignmentSchema.safeParse({
      courseId: "abc", title: "Homework 1", language: "python",
      guidelines: [
        { id: "use-types", description: "Add types", category: "naming", enforced: true },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("limits guidelines to 20", () => {
    const result = createAssignmentSchema.safeParse({
      courseId: "x", title: "t",
      guidelines: Array.from({ length: 21 }, (_, i) => ({
        id: `g${i}`, description: "x", category: "naming" as const, enforced: true,
      })),
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown guideline category", () => {
    const result = createAssignmentSchema.safeParse({
      courseId: "x", title: "t",
      guidelines: [{ id: "g", description: "x", category: "unknown", enforced: true }],
    });
    expect(result.success).toBe(false);
  });
});

describe("education submission schema", () => {
  it("accepts valid submission with session", () => {
    const result = submitSchema.safeParse({
      assignmentId: "a1",
      studentEmail: "s@example.edu",
      sourceFiles: [{ path: "src/x.ts", content: "x" }],
      session: [{ role: "user", content: "help" }],
    });
    expect(result.success).toBe(true);
  });

  it("requires at least one source file", () => {
    const result = submitSchema.safeParse({
      assignmentId: "a1", studentEmail: "s@example.edu", sourceFiles: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = submitSchema.safeParse({
      assignmentId: "a1", studentEmail: "not-an-email",
      sourceFiles: [{ path: "x.ts", content: "x" }],
    });
    expect(result.success).toBe(false);
  });

  it("limits source files to 50", () => {
    const result = submitSchema.safeParse({
      assignmentId: "a1", studentEmail: "s@example.edu",
      sourceFiles: Array.from({ length: 51 }, (_, i) => ({ path: `f${i}.ts`, content: "x" })),
    });
    expect(result.success).toBe(false);
  });

  it("rejects oversized file content (DoS guard)", () => {
    const result = submitSchema.safeParse({
      assignmentId: "a1", studentEmail: "s@example.edu",
      sourceFiles: [{ path: "big.ts", content: "x".repeat(500001) }],
    });
    expect(result.success).toBe(false);
  });

  it("defaults unlockedLayers to [1]", () => {
    const result = submitSchema.safeParse({
      assignmentId: "a1", studentEmail: "s@example.edu",
      sourceFiles: [{ path: "x.ts", content: "x" }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unlockedLayers).toEqual([1]);
  });
});
