import { describe, it, expect } from "vitest";
import { renderCrossRepo, renderHistory, renderPortfolioRanking } from "../portfolio-format";
import type { CrossRepoReport, HistoryStore, PortfolioReport } from "@reporank/grading-engine";

function report(): PortfolioReport {
  return {
    entries: [
      {
        repo: "beta",
        path: "/repos/beta",
        index: 40,
        cohort: "typescript:m",
        risk: 60,
        roi: 85,
        score: 51,
        drivers: [
          {
            dimension: "security",
            score: 0,
            weight: 1,
            penalty: 100,
            ease: 0.85,
            roi: 85,
            findings: [{ file: "src/auth.ts", line: 12, severity: "high", reason: "weak hash", weight: 15, source: "security" }],
          },
        ],
        benchmark: { cohort: "typescript:m", percentile: 10, sampleSize: 5, rank: 5, median: 70 },
      },
      {
        repo: "alpha",
        path: "/repos/alpha",
        index: 90,
        cohort: "typescript:m",
        risk: 10,
        roi: 8.5,
        score: 1,
        drivers: [],
        benchmark: { cohort: "typescript:m", percentile: 90, sampleSize: 5, rank: 1, median: 70 },
      },
    ],
    cohorts: { "typescript:m": 2 },
    generatedAt: "2026-01-01T00:00:00.000Z",
    summary: "2 repo(s) ranked.",
  };
}

describe("renderPortfolioRanking", () => {
  it("prints repos in matrix order with drivers and benchmarks", () => {
    const text = renderPortfolioRanking(report());
    expect(text).toContain("1. beta");
    expect(text).toContain("2. alpha");
    expect(text.indexOf("beta")).toBeLessThan(text.indexOf("alpha"));
    expect(text).toContain("src/auth.ts:12");
    expect(text).toContain("10%");
  });

  it("handles an empty portfolio", () => {
    const empty: PortfolioReport = { entries: [], cohorts: {}, generatedAt: "t", summary: "none" };
    expect(renderPortfolioRanking(empty)).toContain("no repos found");
  });
});

describe("renderCrossRepo", () => {
  it("prints edges and duplicates", () => {
    const cross: CrossRepoReport = {
      repos: ["app", "shared"],
      edges: [{ from: "app", to: "shared", specifier: "shared-lib", count: 2 }],
      duplicates: [
        {
          a: { repo: "app", file: "src/util.ts" },
          b: { repo: "shared", file: "src/util.ts" },
          similarity: 0.95,
          sharedShingles: 40,
          language: "js",
        },
      ],
      graph: { nodes: ["app", "shared"], edges: ["app -> shared (shared-lib)"] },
      summary: "",
    };
    const text = renderCrossRepo(cross);
    expect(text).toContain('app -> shared  via "shared-lib" (2 file(s))');
    expect(text).toContain("app:src/util.ts  <->  shared:src/util.ts");
  });
});

describe("renderHistory", () => {
  it("prints the cursor and snapshots", () => {
    const store: HistoryStore = {
      version: 1,
      repo: "/repos/x",
      cursor: { lastCommit: "abc", lastScannedAt: "2026-01-01T00:00:00.000Z" },
      snapshots: [
        {
          commit: "abc",
          scannedAt: "2026-01-01T00:00:00.000Z",
          index: 77,
          dimensions: { security: 80 },
          cohort: "typescript:m",
          normalizedIndex: 75,
          unmeasured: [],
        },
      ],
    };
    const text = renderHistory(store);
    expect(text).toContain("snapshots: 1");
    expect(text).toContain("commit=abc");
    expect(text).toContain("index=77");
  });
});
