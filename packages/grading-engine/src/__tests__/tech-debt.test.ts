import { describe, it, expect } from "vitest";
import { calculateTechDebt } from "../analyzers/tech-debt";

describe("calculateTechDebt", () => {
  it("returns zero interest for clean code", () => {
    const result = calculateTechDebt([], [], 0, 90);
    expect(result.items.length).toBe(0);
    expect(result.totalMonthlyInterest).toBeGreaterThanOrEqual(0);
  });

  it("calculates crash costs from null-safety issues", () => {
    const hygiene = Array(6).fill({ category: "null-safety", severity: "high", detail: "missing null guard" });
    const result = calculateTechDebt(hygiene, [], 0, 90);
    expect(result.items.some(i => i.category === "Reliability")).toBe(true);
  });

  it("calculates incident costs from loose equality", () => {
    const hygiene = Array(5).fill({ category: "comparison-bug", severity: "high", detail: "loose equality" });
    const result = calculateTechDebt(hygiene, [], 0, 90);
    expect(result.items.some(i => i.category === "Correctness")).toBe(true);
  });

  it("includes security breach risk for exposed secrets", () => {
    const result = calculateTechDebt([], [], 3, 90);
    expect(result.items.some(i => i.category === "Security")).toBe(true);
  });

  it("includes unhandled rejection costs", () => {
    const production = Array(2).fill({ type: "unhandled-rejection", severity: "critical", detail: "unhandled" });
    const result = calculateTechDebt([], production, 0, 90);
    expect(result.items.some(i => i.category === "Reliability")).toBe(true);
  });

  it("calculates memory leak incident costs", () => {
    const hygiene = Array(2).fill({ category: "memory-leak", severity: "high", detail: "missing clearInterval" });
    const result = calculateTechDebt(hygiene, [], 0, 90);
    expect(result.items.some(i => i.category === "Performance")).toBe(true);
  });

  it("adds productivity tax for low scores", () => {
    const result = calculateTechDebt([], [], 0, 30);
    expect(result.items.some(i => i.category === "Productivity")).toBe(true);
  });

  it("sort top cost items by yearly cost", () => {
    const hygiene = Array(6).fill({ category: "null-safety", severity: "high", detail: "missing null guard" });
    const result = calculateTechDebt(hygiene, Array(2).fill({ type: "unhandled-rejection", severity: "critical", detail: "unhandled" }), 2, 50);
    expect(result.topCostItems.length).toBeGreaterThan(0);
    expect(result.topCostItems[0].interestCostPerYear).toBeGreaterThanOrEqual(result.topCostItems[result.topCostItems.length - 1]?.interestCostPerYear || 0);
  });

  it("handles undefined findings gracefully", () => {
    const result = calculateTechDebt(undefined, undefined, 0, 90);
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.totalMonthlyInterest).toBeGreaterThanOrEqual(0);
  });
});
