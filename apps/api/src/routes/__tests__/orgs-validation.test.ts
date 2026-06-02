import { describe, it, expect, vi } from "vitest";
import { createOrgSchema } from "../orgs";

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $transaction: vi.fn(),
  })),
}));

vi.mock("../db/client", () => ({
  prisma: {
    scan: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
    user: { findUnique: vi.fn() },
    apiKey: { findUnique: vi.fn(), create: vi.fn() },
    org: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    orgMember: { findUnique: vi.fn(), findMany: vi.fn() },
    subscription: { create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

describe("Org creation Zod schema", () => {
  it("accepts valid org data", () => {
    const result = createOrgSchema.safeParse({ name: "My Org", slug: "my-org-123" });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createOrgSchema.safeParse({ name: "", slug: "my-org" });
    expect(result.success).toBe(false);
  });

  it("rejects slug with uppercase letters", () => {
    const result = createOrgSchema.safeParse({ name: "My Org", slug: "My-Org" });
    expect(result.success).toBe(false);
  });

  it("rejects slug with spaces", () => {
    const result = createOrgSchema.safeParse({ name: "My Org", slug: "my org" });
    expect(result.success).toBe(false);
  });

  it("rejects slug shorter than 3 characters", () => {
    const result = createOrgSchema.safeParse({ name: "My Org", slug: "ab" });
    expect(result.success).toBe(false);
  });

  it("rejects slug longer than 50 characters", () => {
    const result = createOrgSchema.safeParse({ name: "My Org", slug: "a".repeat(51) });
    expect(result.success).toBe(false);
  });

  it("rejects name longer than 100 characters", () => {
    const result = createOrgSchema.safeParse({ name: "X".repeat(101), slug: "my-org" });
    expect(result.success).toBe(false);
  });

  it("rejects slug with underscores", () => {
    const result = createOrgSchema.safeParse({ name: "My Org", slug: "my_org" });
    expect(result.success).toBe(false);
  });

  it("rejects slug with special characters", () => {
    const result = createOrgSchema.safeParse({ name: "My Org", slug: "my-org!" });
    expect(result.success).toBe(false);
  });
});
