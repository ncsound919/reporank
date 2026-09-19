import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DimensionContribution, IndexNormalization } from "@reporank/grading-engine";

vi.mock("../db/client", () => ({
  prisma: {
    portfolioSnapshot: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import {
  createPortfolioSnapshot,
  listPortfolioSnapshots,
  listLatestPortfolioSnapshots,
  deriveDimensions,
} from "./portfolioSnapshots";
import { prisma } from "../db/client";

const decomposition: DimensionContribution[] = [
  {
    dimension: "security",
    score: 82,
    weight: 0.18,
    raw: 3,
    baseline: 45,
    findings: [],
  },
  {
    dimension: "structure",
    score: 64,
    weight: 0.2,
    raw: 18,
    baseline: 50,
    findings: [],
  },
];

const normalization: IndexNormalization = {
  cohort: "typescript:m",
  baseline: 12.5,
  normalizedIndex: 71,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    repoKey: "acme/api",
    name: "api",
    index: 71,
    cohort: "typescript:m",
    dimensions: { security: 82, structure: 64 },
    normalization,
    decomposition,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("deriveDimensions", () => {
  it("projects contribution dimension -> score", () => {
    expect(deriveDimensions(decomposition)).toEqual({ security: 82, structure: 64 });
  });

  it("returns an empty object for null/undefined decomposition", () => {
    expect(deriveDimensions(null)).toEqual({});
    expect(deriveDimensions(undefined)).toEqual({});
  });
});

describe("createPortfolioSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a snapshot and derives dimensions from decomposition when absent", async () => {
    (prisma.portfolioSnapshot.create as any).mockImplementation(async ({ data }: any) =>
      row({ ...data }),
    );

    const result = await createPortfolioSnapshot({
      repoKey: "acme/api",
      name: "api",
      index: 71,
      cohort: "typescript:m",
      normalization,
      decomposition,
    });

    expect(prisma.portfolioSnapshot.create).toHaveBeenCalledOnce();
    const call = (prisma.portfolioSnapshot.create as any).mock.calls[0][0];
    expect(call.data.repoKey).toBe("acme/api");
    expect(call.data.dimensions).toEqual({ security: 82, structure: 64 });
    expect(result.id).toBe("s1");
    expect(result.dimensions).toEqual({ security: 82, structure: 64 });
    expect(result.normalization).toEqual(normalization);
    expect(result.decomposition).toHaveLength(2);
  });

  it("prefers explicit dimensions over decomposition", async () => {
    (prisma.portfolioSnapshot.create as any).mockImplementation(async ({ data }: any) => row({ ...data }));

    await createPortfolioSnapshot({
      repoKey: "acme/api",
      name: "api",
      index: 71,
      dimensions: { security: 100 },
      decomposition,
    });

    const call = (prisma.portfolioSnapshot.create as any).mock.calls[0][0];
    expect(call.data.dimensions).toEqual({ security: 100 });
  });

  it("stores null for omitted optional JSON payloads", async () => {
    (prisma.portfolioSnapshot.create as any).mockImplementation(async ({ data }: any) => row({ ...data }));

    await createPortfolioSnapshot({ repoKey: "acme/api", name: "api", index: 50 });

    const call = (prisma.portfolioSnapshot.create as any).mock.calls[0][0];
    expect(call.data.cohort).toBeNull();
    expect(call.data.normalization).toBeNull();
    expect(call.data.decomposition).toBeNull();
  });
});

describe("listPortfolioSnapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists newest first and caps the limit", async () => {
    (prisma.portfolioSnapshot.findMany as any).mockResolvedValue([
      row({ id: "s2", createdAt: new Date("2025-02-01T00:00:00Z") }),
      row({ id: "s1", createdAt: new Date("2025-01-01T00:00:00Z") }),
    ]);

    const snapshots = await listPortfolioSnapshots({ limit: 999 });

    expect(snapshots.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(prisma.portfolioSnapshot.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  });

  it("scopes the query to a repo when provided", async () => {
    (prisma.portfolioSnapshot.findMany as any).mockResolvedValue([]);
    await listPortfolioSnapshots({ repoKey: "acme/api" });
    expect(prisma.portfolioSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { repoKey: "acme/api" } }),
    );
  });
});

describe("listLatestPortfolioSnapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns one (newest) snapshot per repo, newest first", async () => {
    (prisma.portfolioSnapshot.findMany as any).mockResolvedValue([
      row({ id: "b-new", repoKey: "acme/b", createdAt: new Date("2025-03-01T00:00:00Z") }),
      row({ id: "a-new", repoKey: "acme/a", createdAt: new Date("2025-02-01T00:00:00Z") }),
      row({ id: "a-old", repoKey: "acme/a", createdAt: new Date("2025-01-01T00:00:00Z") }),
    ]);

    const latest = await listLatestPortfolioSnapshots();

    expect(latest).toHaveLength(2);
    expect(latest.map((s) => s.id)).toEqual(["b-new", "a-new"]);
    expect(prisma.portfolioSnapshot.findMany).toHaveBeenCalledWith({
      distinct: ["repoKey"],
      orderBy: { createdAt: "desc" },
    });
  });
});
