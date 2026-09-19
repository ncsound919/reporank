import { describe, it, expect } from "vitest";
import {
  benchmarkIndex,
  languageCohort,
  percentileOf,
  type BenchmarkSample,
} from "../portfolio/benchmark";
import type { StructuralIndex } from "../analyzers/structural-index";

function makeIndex(index: number, cohort: string): StructuralIndex {
  return {
    index,
    unmeasured: [],
    normalization: { cohort, baseline: 1, normalizedIndex: index },
    contributions: [],
    formula: "test",
  };
}

describe("percentileOf", () => {
  it("computes percentile, rank, and sample size", () => {
    const result = percentileOf(30, [10, 20, 30, 40]);
    expect(result).toEqual({ percentile: 75, rank: 2, sampleSize: 4 });
  });

  it("returns nulls for an empty sample", () => {
    expect(percentileOf(50, [])).toEqual({ percentile: null, rank: null, sampleSize: 0 });
  });

  it("gives the top repo the best rank", () => {
    expect(percentileOf(100, [10, 20, 30])).toEqual({ percentile: 100, rank: 1, sampleSize: 3 });
  });
});

describe("languageCohort", () => {
  it("widens a size bucket to the language", () => {
    expect(languageCohort("typescript:m")).toBe("typescript:*");
    expect(languageCohort("unknown")).toBe("unknown:*");
  });
});

describe("benchmarkIndex", () => {
  const peers: BenchmarkSample[] = [
    { repo: "a", index: 90, cohort: "typescript:m" },
    { repo: "b", index: 70, cohort: "typescript:m" },
    { repo: "c", index: 50, cohort: "typescript:m" },
    { repo: "d", index: 30, cohort: "typescript:s" },
  ];

  it("uses the exact cohort when it is large enough", () => {
    const result = benchmarkIndex(makeIndex(60, "typescript:m"), peers, {
      minSampleSize: 3,
      subject: "target",
    });
    expect(result.cohort).toBe("typescript:m");
    expect(result.sampleSize).toBe(3);
    expect(result.percentile).toBe(33);
    expect(result.rank).toBe(3);
    expect(result.median).toBe(70);
  });

  it("widens to the same language when the exact cohort is too small", () => {
    const result = benchmarkIndex(makeIndex(60, "typescript:xl"), peers, {
      minSampleSize: 3,
      subject: "target",
    });
    expect(result.cohort).toBe("typescript:*");
    expect(result.sampleSize).toBe(4);
    expect(result.percentile).toBe(50);
  });

  it("falls back to the full sample when no language peer exists", () => {
    const result = benchmarkIndex(makeIndex(60, "python:m"), peers, {
      minSampleSize: 3,
      subject: "target",
    });
    expect(result.cohort).toBe("all");
    expect(result.sampleSize).toBe(4);
  });

  it("excludes the subject from its own cohort", () => {
    const result = benchmarkIndex(makeIndex(60, "typescript:m"), peers, {
      minSampleSize: 3,
      subject: "b",
    });
    expect(result.sampleSize).toBe(3);
  });

  it("returns an empty result when there are no peers", () => {
    const result = benchmarkIndex(makeIndex(60, "python:m"), [], { subject: "target" });
    expect(result).toMatchObject({ sampleSize: 0, percentile: null, rank: null, median: null });
  });
});
