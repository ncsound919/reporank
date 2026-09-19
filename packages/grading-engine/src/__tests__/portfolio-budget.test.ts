/**
 * Structural budget gate: floor pass/fail, drivers, parsing, and exit codes.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  budgetExitCode,
  evaluateBudget,
  parseDimensionBudgets,
  unknownBudgetDimensions,
} from "../portfolio/budget";
import type { IndexFinding, IndexSeverity, StructuralIndex } from "../analyzers/structural-index";
import { analyzeLoadedRepo, loadRepo } from "../portfolio/loader";

function finding(
  file: string,
  line: number | undefined,
  severity: IndexSeverity,
  reason: string,
  weight: number,
  source: string,
): IndexFinding {
  return { file, ...(line !== undefined ? { line } : {}), severity, reason, weight, source };
}

function makeIndex(overrides: Partial<StructuralIndex> = {}): StructuralIndex {
  return {
    index: 85,
    unmeasured: [],
    normalization: { cohort: "typescript:s", baseline: 100, normalizedIndex: 85 },
    contributions: [
      {
        dimension: "security",
        score: 40,
        weight: 0.5,
        raw: 67.5,
        baseline: 45,
        findings: [
          finding("src/auth.ts", 12, "high", "weak hash", 15, "security"),
          finding("src/auth.ts", 20, "medium", "missing csrf", 5, "security"),
        ],
      },
      {
        dimension: "hygiene",
        score: 90,
        weight: 0.5,
        raw: 5,
        baseline: 45,
        findings: [finding("src/util.ts", 3, "low", "TASK left", 1, "hygiene:TASK-left")],
      },
    ],
    formula: "test",
    ...overrides,
  };
}

describe("evaluateBudget", () => {
  it("passes when every score meets its floor", () => {
    const report = evaluateBudget(makeIndex(), {
      minIndex: 80,
      minDimensions: [{ dimension: "hygiene", minScore: 80 }],
      repo: "demo",
    });
    expect(report.passed).toBe(true);
    expect(report.breaches).toEqual([]);
    expect(budgetExitCode(report)).toBe(0);
    expect(report.summary).toContain("passes");
  });

  it("fails the index floor and names the top weighted findings as drivers", () => {
    const report = evaluateBudget(makeIndex(), { minIndex: 90 });
    expect(report.passed).toBe(false);
    expect(report.breaches).toHaveLength(1);
    const breach = report.breaches[0];
    expect(breach.kind).toBe("index");
    expect(breach.required).toBe(90);
    expect(breach.actualScore).toBe(85);
    expect(breach.actualPenalty).toBe(15);
    expect(breach.drivers[0]).toMatchObject({ file: "src/auth.ts", weight: 15 });
    expect(budgetExitCode(report)).toBe(1);
    expect(report.summary).toContain("index 85 < 90");
  });

  it("fails a dimension floor and reports that dimension's findings", () => {
    const report = evaluateBudget(makeIndex(), {
      minDimensions: [{ dimension: "security", minScore: 70 }],
    });
    expect(report.passed).toBe(false);
    expect(report.breaches).toHaveLength(1);
    expect(report.breaches[0]).toMatchObject({
      kind: "dimension",
      dimension: "security",
      required: 70,
      actualScore: 40,
      actualPenalty: 60,
    });
    expect(report.breaches[0].drivers.map((driver) => driver.file)).toEqual(["src/auth.ts", "src/auth.ts"]);
    expect(budgetExitCode(report)).toBe(1);
  });

  it("orders multiple breaches by penalty and is deterministic", () => {
    const report = evaluateBudget(makeIndex(), {
      minIndex: 99,
      minDimensions: [{ dimension: "security", minScore: 70 }],
    });
    expect(report.breaches.map((breach) => breach.kind)).toEqual(["dimension", "index"]);
    expect(evaluateBudget(makeIndex(), { minIndex: 99 }).breaches).toEqual(
      evaluateBudget(makeIndex(), { minIndex: 99 }).breaches,
    );
  });

  it("passes trivially when no budgets are configured", () => {
    const report = evaluateBudget(makeIndex());
    expect(report.passed).toBe(true);
    expect(report.budgets.minIndex).toBeNull();
    expect(report.budgets.minDimensions).toEqual({});
  });
});

describe("parseDimensionBudgets", () => {
  it("parses repeatable name=score flags", () => {
    const parsed = parseDimensionBudgets(["security=70", "hygiene=80"]);
    expect(parsed.error).toBeNull();
    expect(parsed.budgets).toEqual([
      { dimension: "security", minScore: 70 },
      { dimension: "hygiene", minScore: 80 },
    ]);
  });

  it("keeps the last value for a duplicate dimension", () => {
    const parsed = parseDimensionBudgets(["security=70", "security=90"]);
    expect(parsed.budgets).toEqual([{ dimension: "security", minScore: 90 }]);
  });

  it("rejects malformed flags", () => {
    expect(parseDimensionBudgets(["security"]).error).not.toBeNull();
    expect(parseDimensionBudgets(["=70"]).error).not.toBeNull();
    expect(parseDimensionBudgets(["security=abc"]).error).not.toBeNull();
    expect(parseDimensionBudgets(["security=101"]).error).not.toBeNull();
    expect(parseDimensionBudgets(["security=-1"]).error).not.toBeNull();
  });
});

describe("unknownBudgetDimensions", () => {
  it("lists budgets the index did not measure", () => {
    const unknown = unknownBudgetDimensions(makeIndex(), [
      { dimension: "security", minScore: 50 },
      { dimension: "governance", minScore: 50 },
    ]);
    expect(unknown).toEqual(["governance"]);
  });
});

describe("evaluateBudget over a real repo", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "reporank-budget-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "budget-repo", version: "1.0.0" }));
    writeFileSync(join(root, "src", "dirty.ts"), "export function dirty() {\n  debugger;\n  return 1;\n}\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("passes at the computed index and fails one point above it", () => {
    const loaded = loadRepo(root);
    const { index } = analyzeLoadedRepo(loaded);

    expect(index.index).toBeLessThan(100);
    const pass = evaluateBudget(index, { minIndex: index.index, repo: "budget-repo" });
    expect(pass.passed).toBe(true);
    expect(budgetExitCode(pass)).toBe(0);

    const fail = evaluateBudget(index, { minIndex: index.index + 1, repo: "budget-repo" });
    expect(fail.passed).toBe(false);
    expect(fail.breaches[0].actualScore).toBe(index.index);
    expect(budgetExitCode(fail)).toBe(1);
  });
});
