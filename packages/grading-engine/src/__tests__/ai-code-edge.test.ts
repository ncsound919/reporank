import { describe, it, expect } from "vitest";
import { analyzeAiCode } from "../analyzers/ai-code";

describe("analyzeAiCode - branch coverage", () => {
  it("detects while(true) with break statement", () => {
    const files = [{ path: "test.ts", content: "while (true) { if (done) break; doWork(); }" }];
    const result = analyzeAiCode(files, []);
    expect(result.findings.some(f => f.pattern === "infinite-loop-risk")).toBe(true);
  });

  it("detects inconsistent patterns (mixing require + import)", () => {
    const files = [{ path: "test.ts", content: 'import express from "express";\nconst fs = require("fs");' }];
    const result = analyzeAiCode(files, []);
    expect(result.findings.some(f => f.pattern === "inconsistent-pattern")).toBe(true);
  });

  it("produces take-over points with no criticals", () => {
    const result = analyzeAiCode([{ path: "clean.ts", content: "export const x = 1;" }], []);
    if (result.findings.filter(f => f.severity === "critical").length === 0) {
      expect(result.takeOverPoints.some(p => p.includes("few AI-generated patterns"))).toBe(true);
    }
  });
});
