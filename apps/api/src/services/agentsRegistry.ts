import { createHash } from "node:crypto";
import { prisma } from "../db/client";

const MAX_CONTENT_CHARS = 100_000;

export class AgentsFileContentTooLargeError extends Error {
  constructor(actualLength: number) {
    super(`AGENTS.md content too large: ${actualLength} chars (max ${MAX_CONTENT_CHARS})`);
    this.name = "AgentsFileContentTooLargeError";
  }
}

export interface AgentsFileRecord {
  id: string;
  contentHash: string;
  mode: string;
  estimatedTokens: number;
  ruleCount: number;
  createdAt: Date;
}

export async function recordAgentsFile(input: {
  userId: string;
  repoFullName: string;
  mode: string;
  content: string;
  estimatedTokens: number;
  ruleCount: number;
  generatedBy: "user" | "scan" | "api";
  scanId?: string;
}): Promise<AgentsFileRecord> {
  if (input.content.length > MAX_CONTENT_CHARS) {
    throw new AgentsFileContentTooLargeError(input.content.length);
  }
  const contentHash = createHash("sha256").update(input.content).digest("hex");

  // Upsert: same content hash for the same user+repo = no-op (idempotent)
  const record = await prisma.agentsFileVersion.upsert({
    where: {
      userId_repoFullName_contentHash: {
        userId: input.userId,
        repoFullName: input.repoFullName,
        contentHash,
      },
    },
    create: {
      userId: input.userId,
      repoFullName: input.repoFullName,
      mode: input.mode,
      content: input.content,
      contentHash,
      estimatedTokens: input.estimatedTokens,
      ruleCount: input.ruleCount,
      generatedBy: input.generatedBy,
      scanId: input.scanId,
    },
    update: {}, // no-op if already exists
  });

  return {
    id: record.id,
    contentHash: record.contentHash,
    mode: record.mode,
    estimatedTokens: record.estimatedTokens,
    ruleCount: record.ruleCount,
    createdAt: record.createdAt,
  };
}

export async function listAgentsFileHistory(input: {
  userId: string;
  repoFullName: string;
  limit?: number;
}): Promise<AgentsFileRecord[]> {
  const records = await prisma.agentsFileVersion.findMany({
    where: { userId: input.userId, repoFullName: input.repoFullName },
    orderBy: { createdAt: "desc" },
    take: Math.min(input.limit ?? 10, 50),
  });
  return records.map(r => ({
    id: r.id,
    contentHash: r.contentHash,
    mode: r.mode,
    estimatedTokens: r.estimatedTokens,
    ruleCount: r.ruleCount,
    createdAt: r.createdAt,
  }));
}

export async function getLatestAgentsFile(input: {
  userId: string;
  repoFullName: string;
}): Promise<AgentsFileRecord | null> {
  const record = await prisma.agentsFileVersion.findFirst({
    where: { userId: input.userId, repoFullName: input.repoFullName },
    orderBy: { createdAt: "desc" },
  });
  if (!record) return null;
  return {
    id: record.id,
    contentHash: record.contentHash,
    mode: record.mode,
    estimatedTokens: record.estimatedTokens,
    ruleCount: record.ruleCount,
    createdAt: record.createdAt,
  };
}
