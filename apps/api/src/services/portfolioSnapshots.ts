import type { DimensionContribution, IndexNormalization } from "@reporank/grading-engine";
import { prisma } from "../db/client";

export interface PortfolioSnapshotRecord {
  id: string;
  repoKey: string;
  name: string;
  index: number;
  cohort: string | null;
  dimensions: Record<string, number>;
  normalization: IndexNormalization | null;
  decomposition: DimensionContribution[] | null;
  createdAt: Date;
}

export interface CreatePortfolioSnapshotInput {
  repoKey: string;
  name: string;
  index: number;
  cohort?: string | null;
  dimensions?: Record<string, number> | null;
  normalization?: IndexNormalization | null;
  decomposition?: DimensionContribution[] | null;
}

/**
 * Shape of a persisted row. JSON columns are stored as strings by the SQLite
 * datasource and rehydrated to objects by the extended client in db/client.ts,
 * so the persisted values are typed loosely here and narrowed in `toRecord`.
 */
interface PortfolioSnapshotRow {
  id: string;
  repoKey: string;
  name: string;
  index: number;
  cohort: string | null;
  dimensions: unknown;
  normalization: unknown;
  decomposition: unknown;
  createdAt: Date;
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

/** Project dimension scores out of an index decomposition (dimension -> score). */
export function deriveDimensions(
  decomposition: DimensionContribution[] | null | undefined,
): Record<string, number> {
  const dimensions: Record<string, number> = {};
  for (const contribution of decomposition ?? []) {
    dimensions[contribution.dimension] = contribution.score;
  }
  return dimensions;
}

function toRecord(row: PortfolioSnapshotRow): PortfolioSnapshotRecord {
  return {
    id: row.id,
    repoKey: row.repoKey,
    name: row.name,
    index: row.index,
    cohort: row.cohort ?? null,
    dimensions: (row.dimensions as Record<string, number> | null) ?? {},
    normalization: (row.normalization as IndexNormalization | null) ?? null,
    decomposition: (row.decomposition as DimensionContribution[] | null) ?? null,
    createdAt: row.createdAt,
  };
}

/** Insert (or upsert) a portfolio snapshot for a repo. */
export async function createPortfolioSnapshot(
  input: CreatePortfolioSnapshotInput,
): Promise<PortfolioSnapshotRecord> {
  const row = await prisma.portfolioSnapshot.create({
    data: {
      repoKey: input.repoKey,
      name: input.name,
      index: input.index,
      cohort: input.cohort ?? null,
      dimensions: (input.dimensions ?? deriveDimensions(input.decomposition)) as any,
      normalization: (input.normalization ?? null) as any,
      decomposition: (input.decomposition ?? null) as any,
    },
  });
  return toRecord(row as unknown as PortfolioSnapshotRow);
}

/** List snapshots newest first, optionally scoped to one repo. */
export async function listPortfolioSnapshots(
  options: { repoKey?: string; limit?: number } = {},
): Promise<PortfolioSnapshotRecord[]> {
  const rows = await prisma.portfolioSnapshot.findMany({
    where: options.repoKey ? { repoKey: options.repoKey } : undefined,
    orderBy: { createdAt: "desc" },
    take: Math.min(options.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT),
  });
  return (rows as unknown as PortfolioSnapshotRow[]).map(toRecord);
}

/** Latest snapshot per repo — the portfolio view. Newest first. */
export async function listLatestPortfolioSnapshots(): Promise<PortfolioSnapshotRecord[]> {
  const rows = await prisma.portfolioSnapshot.findMany({
    distinct: ["repoKey"],
    orderBy: { createdAt: "desc" },
  });
  const seen = new Set<string>();
  const latest: PortfolioSnapshotRecord[] = [];
  for (const row of rows as unknown as PortfolioSnapshotRow[]) {
    if (seen.has(row.repoKey)) continue;
    seen.add(row.repoKey);
    latest.push(toRecord(row));
  }
  latest.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.repoKey.localeCompare(b.repoKey),
  );
  return latest;
}
