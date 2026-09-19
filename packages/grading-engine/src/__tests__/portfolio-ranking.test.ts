import { describe, it, expect } from "vitest";
import { rankPortfolio } from "../portfolio/portfolio";
import type { StructuralIndex } from "../analyzers/structural-index";

function makeIndex(
  index: number,
  dimensions: Record<string, number>,
  cohort = "typescript:m",
): StructuralIndex {
  const names = Object.keys(dimensions);
  return {
    index,
    unmeasured: [],
    normalization: { cohort, baseline: 1, normalizedIndex: index },
    contributions: names.map((dimension) => ({
      dimension,
      score: dimensions[dimension],
      weight: 1 / names.length,
      raw: 0,
      baseline: 1,
      findings: [
        { file: `src/${dimension}.ts`, severity: "high", reason: `${dimension} issue`, weight: 10, source: dimension },
      ],
    })),
    formula: "test",
  };
}

describe("rankPortfolio", () => {
  it("ranks a high-risk/high-ROI repo above a nearly-clean one", () => {
    const report = rankPortfolio([
      { path: "/repos/alpha", name: "alpha", index: makeIndex(90, { security: 90 }) },
      { path: "/repos/beta", name: "beta", index: makeIndex(40, { security: 0 }) },
    ]);

    expect(report.entries.map((e) => e.repo)).toEqual(["beta", "alpha"]);
    expect(report.entries[0].risk).toBe(60);
    expect(report.entries[0].score).toBeGreaterThan(report.entries[1].score);
    expect(report.summary).toContain("beta");
  });

  it("exposes the top score drivers with evidence", () => {
    const report = rankPortfolio([
      { path: "/repos/beta", name: "beta", index: makeIndex(40, { security: 0, hygiene: 90 }) },
    ]);
    const [entry] = report.entries;
    expect(entry.drivers[0].dimension).toBe("security");
    expect(entry.drivers[0].findings[0]).toMatchObject({ file: "src/security.ts", weight: 10 });
  });

  it("is deterministic and tie-breaks by repo name", () => {
    const inputs = [
      { path: "/repos/b", name: "b", index: makeIndex(50, { security: 50 }) },
      { path: "/repos/a", name: "a", index: makeIndex(50, { security: 50 }) },
    ];
    const first = rankPortfolio(inputs).entries.map((e) => e.repo);
    const second = rankPortfolio(inputs).entries.map((e) => e.repo);
    expect(first).toEqual(["a", "b"]);
    expect(first).toEqual(second);
  });

  it("attaches a peer benchmark to each entry", () => {
    const report = rankPortfolio(
      [
        { path: "/repos/a", name: "a", index: makeIndex(80, { security: 80 }) },
        { path: "/repos/b", name: "b", index: makeIndex(60, { security: 60 }) },
        { path: "/repos/c", name: "c", index: makeIndex(40, { security: 40 }) },
      ],
      { minCohortSize: 2 },
    );
    const best = report.entries.find((e) => e.repo === "a")!;
    expect(best.benchmark).not.toBeNull();
    expect(best.benchmark!.cohort).toBe("typescript:m");
    expect(best.benchmark!.sampleSize).toBe(2);
    expect(best.benchmark!.percentile).toBe(100);
    expect(best.benchmark!.rank).toBe(1);
  });

  it("uses a supplied baseline cohort for benchmarking", () => {
    const report = rankPortfolio(
      [{ path: "/repos/only", name: "only", index: makeIndex(50, { security: 50 }) }],
      {
        baseline: [
          { repo: "x", index: 90, cohort: "typescript:m" },
          { repo: "y", index: 70, cohort: "typescript:m" },
          { repo: "z", index: 30, cohort: "typescript:m" },
        ],
      },
    );
    const [entry] = report.entries;
    expect(entry.benchmark!.sampleSize).toBe(3);
    expect(entry.benchmark!.percentile).toBe(33);
  });
});
