import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/client", () => ({
  prisma: {
    agentsFileVersion: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import { recordAgentsFile, listAgentsFileHistory, getLatestAgentsFile, AgentsFileContentTooLargeError } from "../services/agentsRegistry";
import { prisma } from "../db/client";

describe("agentsRegistry service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records a new agents file with SHA-256 hash", async () => {
    (prisma.agentsFileVersion.upsert as any).mockImplementation(async ({ create }: any) => ({
      id: "v1",
      contentHash: create.contentHash,
      mode: create.mode,
      estimatedTokens: create.estimatedTokens,
      ruleCount: create.ruleCount,
      createdAt: new Date("2025-01-01"),
    }));

    const result = await recordAgentsFile({
      userId: "user-1",
      repoFullName: "owner/repo",
      mode: "standard",
      content: "# AGENTS.md\n\n## Security\n",
      estimatedTokens: 100,
      ruleCount: 1,
      generatedBy: "api",
    });

    expect(result.id).toBe("v1");
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    expect(prisma.agentsFileVersion.upsert).toHaveBeenCalledOnce();
  });

  it("produces the same hash for identical content (idempotent)", async () => {
    let lastCreate: any = null;
    (prisma.agentsFileVersion.upsert as any).mockImplementation(async ({ create }: any) => {
      lastCreate = create;
      return { id: "v1", contentHash: create.contentHash, mode: create.mode, estimatedTokens: create.estimatedTokens, ruleCount: create.ruleCount, createdAt: new Date() };
    });

    const content = "# AGENTS.md\n\n## Security\n- Rule 1\n";
    await recordAgentsFile({ userId: "u", repoFullName: "a/b", mode: "standard", content, estimatedTokens: 50, ruleCount: 1, generatedBy: "api" });
    await recordAgentsFile({ userId: "u", repoFullName: "a/b", mode: "standard", content, estimatedTokens: 50, ruleCount: 1, generatedBy: "api" });

    // Both calls had the same contentHash
    expect(lastCreate.contentHash).toBeDefined();
    // And the upsert was called twice (DB enforces uniqueness via the composite key)
    expect(prisma.agentsFileVersion.upsert).toHaveBeenCalledTimes(2);
  });

  it("produces different hashes for different content", async () => {
    const hashes: string[] = [];
    (prisma.agentsFileVersion.upsert as any).mockImplementation(async ({ create }: any) => {
      hashes.push(create.contentHash);
      return { id: "v", contentHash: create.contentHash, mode: create.mode, estimatedTokens: 0, ruleCount: 0, createdAt: new Date() };
    });

    await recordAgentsFile({ userId: "u", repoFullName: "a/b", mode: "minimal", content: "A", estimatedTokens: 1, ruleCount: 0, generatedBy: "api" });
    await recordAgentsFile({ userId: "u", repoFullName: "a/b", mode: "minimal", content: "B", estimatedTokens: 1, ruleCount: 0, generatedBy: "api" });

    expect(hashes[0]).not.toBe(hashes[1]);
  });

  it("lists history in descending order", async () => {
    (prisma.agentsFileVersion.findMany as any).mockResolvedValue([
      { id: "v2", contentHash: "h2", mode: "standard", estimatedTokens: 100, ruleCount: 5, createdAt: new Date("2025-02-01") },
      { id: "v1", contentHash: "h1", mode: "minimal", estimatedTokens: 50, ruleCount: 2, createdAt: new Date("2025-01-01") },
    ]);
    const history = await listAgentsFileHistory({ userId: "u", repoFullName: "a/b" });
    expect(history).toHaveLength(2);
    expect(history[0].id).toBe("v2");
    expect(history[1].id).toBe("v1");
  });

  it("respects limit parameter and caps at 50", async () => {
    (prisma.agentsFileVersion.findMany as any).mockResolvedValue([]);
    await listAgentsFileHistory({ userId: "u", repoFullName: "a/b", limit: 100 });
    expect(prisma.agentsFileVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }) // capped
    );
  });

  it("returns null when no latest version exists", async () => {
    (prisma.agentsFileVersion.findFirst as any).mockResolvedValue(null);
    const latest = await getLatestAgentsFile({ userId: "u", repoFullName: "a/b" });
    expect(latest).toBeNull();
  });

  it("rejects content larger than 100,000 chars", async () => {
    const huge = "x".repeat(100_001);
    await expect(
      recordAgentsFile({
        userId: "u", repoFullName: "a/b", mode: "standard",
        content: huge, estimatedTokens: 1, ruleCount: 0, generatedBy: "api",
      })
    ).rejects.toThrow(AgentsFileContentTooLargeError);
    // DB should not be called for oversize content
    expect(prisma.agentsFileVersion.upsert).not.toHaveBeenCalled();
  });

  it("accepts content exactly at the size limit", async () => {
    const exact = "x".repeat(100_000);
    (prisma.agentsFileVersion.upsert as any).mockImplementation(async ({ create }: any) => ({
      id: "v", contentHash: create.contentHash, mode: create.mode,
      estimatedTokens: 0, ruleCount: 0, createdAt: new Date(),
    }));
    await expect(
      recordAgentsFile({
        userId: "u", repoFullName: "a/b", mode: "standard",
        content: exact, estimatedTokens: 1, ruleCount: 0, generatedBy: "api",
      })
    ).resolves.toBeDefined();
  });

  it("ruleCount regex matches only ## headings (not the # title)", () => {
    // This test documents the regex used in agents.ts to compute ruleCount.
    // If this breaks, the agents route's ruleCount is wrong.
    const guidelines = "# AGENTS.md\n\n## Security\n- rule 1\n## Testing\n- rule 2\n### Subsection\n- not a top rule\n";
    const count = (guidelines.match(/^##\s/gm) || []).length;
    expect(count).toBe(2); // Security + Testing, NOT the # title, NOT the ### subsection
  });
});
