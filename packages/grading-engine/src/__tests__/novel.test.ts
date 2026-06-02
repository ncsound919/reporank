import { describe, it, expect } from "vitest";
import { runNovelAnalysis } from "../analyzers/novel";

describe("runNovelAnalysis", () => {
  it("orchestrates all sub-analyzers", () => {
    const result = runNovelAnalysis([], [], [], [], 0, 50, "repo", "owner", "", "C", "TypeScript", "TypeScript", [], []);
    expect(result.architectureDiagram).toBeDefined();
    expect(result.techDebt).toBeDefined();
    expect(result.deadCode).toBeDefined();
    expect(result.readme).toBeDefined();
    expect(result.seniorDev).toBeDefined();
    expect(result.seniorDev.busFactor).toBeDefined();
    expect(result.seniorDev.riskHeatmap).toBeDefined();
    expect(result.seniorDev.testGaps).toBeDefined();
    expect(result.seniorDev.changeCoupling).toBeDefined();
    expect(result.seniorDev.debtRatio).toBeDefined();
    expect(result.aiCode).toBeDefined();
  });

  it("returns summary", () => {
    const result = runNovelAnalysis([], [], [], [], 0, 50, "repo", "owner", "", "C", "TypeScript", "TypeScript", [], []);
    expect(typeof result.summary).toBe("string");
    expect(result.summary).toContain("Novel analysis");
  });

  it("handles findings from code hygiene", () => {
    const hygiene = [{ category: "null-safety", severity: "high", detail: "missing guard" }];
    const production = [{ type: "missing-timeout", severity: "high", detail: "no timeout" }];
    const result = runNovelAnalysis(
      [{ path: "test.ts", content: "const x = 1;" }], ["test.ts"],
      hygiene, production, 0, 60,
      "repo", "owner", "", "B", "TypeScript", "TypeScript",
      [], [], "."
    );
    expect(result.techDebt.items.length).toBeGreaterThan(0);
  });
});
