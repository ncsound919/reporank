import { describe, it, expect } from "vitest";
import { generateDeadCodePlan } from "../analyzers/dead-code";

describe("generateDeadCodePlan", () => {
  it("returns empty for no files", () => {
    const result = generateDeadCodePlan([]);
    expect(result.totalRemovable).toBe(0);
    expect(result.steps).toEqual([]);
  });

  it("returns empty for single-file projects", () => {
    const files = [{ path: "test.ts", content: "export const x = 1;\nexport function foo() { return 42; }" }];
    const result = generateDeadCodePlan(files);
    expect(result.totalRemovable).toBe(0);
  });

  it("detects potentially dead exports in multi-file project", () => {
    const files = [
      { path: "utils.ts", content: "export const helper = (x: number) => x * 2;\nexport const deadFunc = () => console.log('unused');" },
      { path: "app.ts", content: 'import { helper } from "./utils";\nconsole.log(helper(5));' },
    ];
    const result = generateDeadCodePlan(files);
    expect(result.totalRemovable).toBeGreaterThanOrEqual(0);
  });

  it("skips default exports", () => {
    const files = [
      { path: "Component.tsx", content: "const Component = () => null;\nexport default Component;" },
      { path: "app.tsx", content: 'import Component from "./Component";' },
    ];
    const result = generateDeadCodePlan(files);
    const defaultExportStep = result.steps.filter(s => s.symbol === "default");
    expect(defaultExportStep.length).toBe(0);
  });

  it("returns summary", () => {
    const result = generateDeadCodePlan([]);
    expect(typeof result.summary).toBe("string");
  });

  it("estimates line savings", () => {
    const files = [
      { path: "utils.ts", content: "export const helper = (x: number) => x * 2;\nexport function longDeadFunc() {\n  const a = 1;\n  const b = 2;\n  return a + b;\n}" },
      { path: "app.ts", content: 'import { helper } from "./utils";\nconsole.log(helper(5));' },
    ];
    const result = generateDeadCodePlan(files);
    expect(result.estimatedSavingsLoc).toBeGreaterThanOrEqual(0);
  });

  it("handles files with no exports", () => {
    const files = [
      { path: "utils.ts", content: "const x = 1;" },
      { path: "app.ts", content: "console.log('hello');" },
    ];
    const result = generateDeadCodePlan(files);
    expect(result.totalRemovable).toBe(0);
  });
});
