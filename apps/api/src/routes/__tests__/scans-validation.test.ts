import { describe, it, expect, vi } from "vitest";
import { createLocalScanSchema } from "../scans";

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({ $connect: vi.fn(), $disconnect: vi.fn() })),
}));

vi.mock("../db/client", () => ({
  prisma: {
    scan: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

describe("Local scan Zod schema", () => {
  it("accepts valid file paths", () => {
    const result = createLocalScanSchema.safeParse({
      files: [{ path: "src/index.ts", content: "const x = 1;" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts nested paths with subdirectories", () => {
    const result = createLocalScanSchema.safeParse({
      files: [{ path: "src/components/Button.tsx", content: "export const Button = () => null;" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects path traversal with ..", () => {
    const result = createLocalScanSchema.safeParse({
      files: [{ path: "../../etc/passwd", content: "x" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects path traversal with nested ..", () => {
    const result = createLocalScanSchema.safeParse({
      files: [{ path: "src/../../etc/passwd", content: "x" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects absolute Unix paths", () => {
    const result = createLocalScanSchema.safeParse({
      files: [{ path: "/etc/passwd", content: "x" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects absolute Windows paths", () => {
    const result = createLocalScanSchema.safeParse({
      files: [{ path: "C:\\Windows\\system32\\config", content: "x" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects files with control characters in path", () => {
    const result = createLocalScanSchema.safeParse({
      files: [{ path: "src/\x00file.ts", content: "x" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects content exceeding 500KB", () => {
    const result = createLocalScanSchema.safeParse({
      files: [{ path: "src/test.ts", content: "x".repeat(500001) }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 500 files", () => {
    const result = createLocalScanSchema.safeParse({
      files: Array(501).fill({ path: "src/file.ts", content: "x" }),
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty files array", () => {
    const result = createLocalScanSchema.safeParse({ files: [] });
    expect(result.success).toBe(false);
  });

  it("defaults privateMode to false when omitted", () => {
    const result = createLocalScanSchema.safeParse({
      files: [{ path: "file.ts", content: "x" }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.privateMode).toBe(false);
  });

  it("accepts valid aiProviders", () => {
    for (const p of ["gemini", "ollama", "lmstudio"] as const) {
      const result = createLocalScanSchema.safeParse({
        files: [{ path: "file.ts", content: "x" }],
        aiProvider: p,
      });
      expect(result.success).toBe(true);
    }
  });
});
