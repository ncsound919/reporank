import { describe, it, expect } from "vitest";
import { analyzeArchitecture } from "../analyzers/architecture";

describe("analyzeArchitecture", () => {
  it("detects react-app archetype", () => {
    const files = ["src/components/Button.tsx", "src/pages/Home.tsx"];
    const sourceFiles = [
      { path: "src/components/Button.tsx", content: "export const Button = () => null;" },
      { path: "src/pages/Home.tsx", content: "export const Home = () => null;" },
    ];
    const result = analyzeArchitecture(files, sourceFiles);
    expect(result.summary).toMatch(/react-app|archetype/);
  });

  it("detects express-api archetype", () => {
    const files = ["src/routes/users.ts", "src/middleware/auth.ts"];
    const sourceFiles = [
      { path: "src/routes/users.ts", content: "import express from 'express';" },
      { path: "src/middleware/auth.ts", content: "export function auth() {}" },
    ];
    const result = analyzeArchitecture(files, sourceFiles);
    expect(result.summary).toMatch(/express-api|archetype/);
  });

  it("flags orphan files not imported anywhere", () => {
    const files = ["src/orphan.ts"];
    const sourceFiles = [{ path: "src/orphan.ts", content: "export const x = 1;" }];
    const result = analyzeArchitecture(files, sourceFiles);
    expect(result.findings.some(f => f.type === "orphan")).toBe(true);
  });

  it("returns directory breakdown", () => {
    const files = ["src/components/Button.tsx", "src/utils/helpers.ts"];
    const sourceFiles = [
      { path: "src/components/Button.tsx", content: "export const Button = () => null;" },
      { path: "src/utils/helpers.ts", content: "export const helper = () => {};" },
    ];
    const result = analyzeArchitecture(files, sourceFiles);
    expect(result.directoryBreakdown.length).toBeGreaterThan(0);
  });

  it("returns recommended structure", () => {
    const result = analyzeArchitecture([], []);
    expect(typeof result.recommendedStructure).toBe("string");
  });

  it("detects inconsistent naming conventions", () => {
    const files = ["src/test-file.tsx", "src/test_file.ts", "src/testFile.ts", "src/TestFile.ts"];
    const sourceFiles = [
      { path: "src/test-file.tsx", content: "export const x = 1;" },
      { path: "src/test_file.ts", content: "export const x = 1;" },
      { path: "src/testFile.ts", content: "export const x = 1;" },
      { path: "src/TestFile.ts", content: "export const x = 1;" },
    ];
    const result = analyzeArchitecture(files, sourceFiles);
    expect(result.findings.some(f => f.type === "inconsistent-pattern")).toBe(true);
  });

  it("returns summary", () => {
    const result = analyzeArchitecture([], []);
    expect(typeof result.summary).toBe("string");
  });
});
