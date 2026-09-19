/**
 * CLI budget gate: rendering, parsing, pass/fail, and the CI exit code mapping
 * the `portfolio budget` command uses.
 */
import { describe, it, expect } from "vitest";
import {
  budgetExitCode,
  evaluateBudget,
  parseDimensionBudgets,
  unknownBudgetDimensions,
  type StructuralIndex,
} from "@reporank/grading-engine";
import { renderBudget } from "../portfolio-format";

function index(): StructuralIndex {
  return {
    index: 62,
    unmeasured: [],
    normalization: { cohort: "typescript:s", baseline: 100, normalizedIndex: 60 },
    contributions: [
      {
        dimension: "security",
        score: 30,
        weight: 0.6,
        raw: 50,
        baseline: 45,
        findings: [
          { file: "src/auth.ts", line: 9, severity: "critical", reason: "hardcoded secret", weight: 40, source: "security" },
        ],
      },
      {
        dimension: "hygiene",
        score: 95,
        weight: 0.4,
        raw: 1,
        baseline: 45,
        findings: [],
      },
    ],
    formula: "test",
  };
}

describe("cli budget command helpers", () => {
  it("maps a passing budget to exit 0", () => {
    const report = evaluateBudget(index(), { minIndex: 60, minDimensions: [{ dimension: "hygiene", minScore: 90 }] });
    expect(report.passed).toBe(true);
    expect(budgetExitCode(report)).toBe(0);
    expect(renderBudget(report)).toContain("PASS");
  });

  it("maps a failing budget to exit 1 and prints the driving dimension/finding", () => {
    const report = evaluateBudget(index(), {
      minIndex: 80,
      minDimensions: [{ dimension: "security", minScore: 70 }],
      repo: "demo",
    });
    expect(budgetExitCode(report)).toBe(1);
    const text = renderBudget(report);
    expect(text).toContain("FAIL");
    expect(text).toContain("minIndex>=80");
    expect(text).toContain("security>=70");
    expect(text).toContain("breach [dimension] security: 30 < 70");
    expect(text).toContain("src/auth.ts:9");
  });

  it("parses repeatable --max-dimension flags and validates unknown dimensions", () => {
    const parsed = parseDimensionBudgets(["security=70", "hygiene=80"]);
    expect(parsed.error).toBeNull();
    expect(parsed.budgets).toHaveLength(2);

    expect(parseDimensionBudgets(["bogus=1"]).error).toBeNull();
    expect(unknownBudgetDimensions(index(), [{ dimension: "security", minScore: 1 }, { dimension: "bogus", minScore: 1 }])).toEqual([
      "bogus",
    ]);
    expect(parseDimensionBudgets(["security"]).error).not.toBeNull();
  });
});
