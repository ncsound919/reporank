import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

// These Prisma fields are stored as JSON strings (SQLite doesn't support Json or String[] natively)
const SERIALIZED_FIELDS_BY_MODEL: Record<string, string[]> = {
  PrWebhookConfig: ["commentOn"],
  Webhook: ["events"],
  Scan: ["report", "complianceReport", "fixPack", "clawFindings", "builderMetadata"],
  ClawAgent: ["config"],
  ClawAlert: ["raw"],
};

/** Serialize any array/object values to JSON strings in the given data object */
function serializeRow(data: Record<string, unknown> | null | undefined): void {
  if (!data) return;
  for (const fields of Object.values(SERIALIZED_FIELDS_BY_MODEL)) {
    for (const field of fields) {
      if (field in data && data[field] !== null && typeof data[field] !== "string") {
        data[field] = JSON.stringify(data[field]);
      }
    }
  }
}

/** Deserialize JSON string fields back to objects/arrays */
function deserializeRow(row: unknown): void {
  if (!row || typeof row !== "object") return;
  const obj = row as Record<string, unknown>;
  for (const fields of Object.values(SERIALIZED_FIELDS_BY_MODEL)) {
    for (const field of fields) {
      if (field in obj && typeof obj[field] === "string") {
        try { obj[field] = JSON.parse(obj[field] as string); } catch { /* keep as-is */ }
      }
    }
  }
}

/** Walk a Prisma write payload and serialize JSON fields */
function processWriteArgs(args: Record<string, unknown> | undefined): void {
  if (!args) return;
  if (args.data && typeof args.data === "object" && !Array.isArray(args.data)) {
    serializeRow(args.data as Record<string, unknown>);
  }
  if (args.create && typeof args.create === "object") {
    serializeRow(args.create as Record<string, unknown>);
  }
  if (Array.isArray(args.data)) {
    for (const item of args.data) {
      if (item && typeof item === "object") serializeRow(item as Record<string, unknown>);
    }
  }
}

/** Walk a read result and deserialize JSON string fields */
function processReadResult(result: unknown): void {
  if (!result) return;
  if (Array.isArray(result)) {
    for (const item of result) deserializeRow(item);
  } else {
    deserializeRow(result);
  }
}

const prismaClient = new PrismaClient().$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        processWriteArgs(args as Record<string, unknown>);
        const result = await query(args);
        processReadResult(result);
        return result;
      },
    },
  },
});

export const prisma = globalForPrisma.prisma ?? prismaClient;
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
