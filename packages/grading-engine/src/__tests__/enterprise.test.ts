import { describe, it, expect } from "vitest";
import { analyzeApiContracts, analyzeObservability, analyzeBuildCI, analyzeCoupling, analyzeLicenseCompliance, analyzeLongTermDebt, runEnterpriseAnalysis } from "../analyzers/enterprise";

describe("analyzeApiContracts", () => {
  it("returns empty for empty sources", () => {
    const result = analyzeApiContracts([]);
    expect(result.findings).toEqual([]);
    expect(result.apiSurface).toEqual([]);
  });

  it("discovers route definitions", () => {
    const files = [{ path: "routes/users.ts", content: "router.get('/users', getUsers);\nrouter.post('/users', createUser);" }];
    const result = analyzeApiContracts(files);
    expect(result.apiSurface.length).toBe(2);
    expect(result.apiSurface[0].method).toBe("GET");
    expect(result.apiSurface[1].method).toBe("POST");
  });

  it("detects untyped request bodies", () => {
    const files = [{ path: "routes/test.ts", content: "router.post('/data', (req, res) => { const body = req.body; });" }];
    const result = analyzeApiContracts(files);
    expect(result.findings.some(f => f.type === "untyped-request")).toBe(true);
  });

  it("flags missing API versioning", () => {
    const files = [{ path: "app.ts", content: "app.use('/api/', routes);" }];
    const result = analyzeApiContracts(files);
    expect(result.findings.some(f => f.type === "missing-versioning")).toBe(true);
  });

  it("returns consistency score between 0-100", () => {
    const files = [{ path: "routes/test.ts", content: "router.get('/test', handler);" }];
    const result = analyzeApiContracts(files);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });
});

describe("analyzeObservability", () => {
  it("returns score for clean code with structured logging", () => {
    const files = [{ path: "app.ts", content: "import pino from 'pino'; const logger = pino(); logger.info('started');" }];
    const result = analyzeObservability(files);
    expect(result.observabilityScore).toBeGreaterThanOrEqual(0);
  });

  it("identifies missing structured logger", () => {
    const files = [{ path: "app.ts", content: 'console.log("started");\nconsole.error("error");' }];
    const result = analyzeObservability(files);
    expect(result.findings.some(f => f.type === "no-structured-logging")).toBe(true);
  });

  it("detects console log in production", () => {
    const files = Array(10).fill(null).map((_, i) => ({ path: `file${i}.ts`, content: 'console.error("error");' }));
    const result = analyzeObservability(files);
    expect(result.findings.some(f => f.type === "console-log-in-production")).toBe(true);
  });

  it("returns senior summary", () => {
    const files = [{ path: "app.ts", content: "const x = 1;" }];
    const result = analyzeObservability(files);
    expect(typeof result.seniorSummary).toBe("string");
  });

  it("detects missing correlation IDs", () => {
    const files = [{ path: "app.ts", content: "import express from 'express';" }];
    const result = analyzeObservability(files);
    expect(result.findings.some(f => f.type === "no-correlation-ids")).toBe(true);
  });
});

describe("analyzeBuildCI", () => {
  it("flags missing lockfile", () => {
    const result = analyzeBuildCI([], []);
    expect(result.findings.some(f => f.type === "no-lockfile")).toBe(true);
  });

  it("detects no CI workflow", () => {
    const result = analyzeBuildCI([], []);
    expect(result.findings.some(f => f.type === "no-lint-in-ci")).toBe(true);
  });

  it("returns CI score", () => {
    const result = analyzeBuildCI([], []);
    expect(result.ciScore).toBeGreaterThanOrEqual(0);
    expect(result.ciScore).toBeLessThanOrEqual(100);
  });

  it("detects mixed package managers", () => {
    const tree = ["package-lock.json", "pnpm-workspace.yaml"];
    const result = analyzeBuildCI(tree, []);
    expect(result.findings.some(f => f.type === "mixed-package-managers")).toBe(true);
  });

  it("checks for changelog", () => {
    const tree = ["README.md"];
    const result = analyzeBuildCI(tree, []);
    expect(result.findings.some(f => f.type === "no-changelog")).toBe(true);
  });
});

describe("analyzeCoupling", () => {
  it("reports high fan-in for heavily imported modules", () => {
    const files = [
      { path: "utils.ts", content: "export const add = (a: number, b: number) => a + b;" },
      { path: "a.ts", content: 'import { add } from "./utils";' },
      { path: "b.ts", content: 'import { add } from "./utils";' },
      { path: "c.ts", content: 'import { add } from "./utils";' },
      { path: "d.ts", content: 'import { add } from "./utils";' },
      { path: "e.ts", content: 'import { add } from "./utils";' },
      { path: "f.ts", content: 'import { add } from "./utils";' },
      { path: "g.ts", content: 'import { add } from "./utils";' },
      { path: "h.ts", content: 'import { add } from "./utils";' },
      { path: "i.ts", content: 'import { add } from "./utils";' },
      { path: "j.ts", content: 'import { add } from "./utils";' },
      { path: "k.ts", content: 'import { add } from "./utils";' },
    ];
    const result = analyzeCoupling(files);
    expect(result.findings.some(f => f.type === "high-fan-in")).toBe(true);
  });

  it("returns coupling score for empty files", () => {
    const result = analyzeCoupling([]);
    expect(result.couplingScore).toBeGreaterThanOrEqual(0);
  });

  it("handles external imports", () => {
    const files = [{ path: "app.ts", content: 'import express from "express";\nimport { z } from "zod";' }];
    const result = analyzeCoupling(files);
    expect(result.couplingScore).toBeGreaterThan(0);
  });
});

describe("analyzeLicenseCompliance", () => {
  it("flags missing license file", () => {
    const result = analyzeLicenseCompliance([], []);
    expect(result.findings.some(f => f.type === "no-license")).toBe(true);
  });

  it("detects missing license field in package.json", () => {
    const files = [{ path: "package.json", content: JSON.stringify({ name: "test" }) }];
    const result = analyzeLicenseCompliance([], files);
    expect(result.findings.some(f => f.detail.includes("package.json missing"))).toBe(true);
  });

  it("validates existing license in package.json", () => {
    const files = [{ path: "package.json", content: JSON.stringify({ name: "test", license: "MIT" }) }];
    const result = analyzeLicenseCompliance(["LICENSE"], files);
    const licenseFindings = result.findings.filter(f => f.type === "no-license");
    expect(licenseFindings.length).toBe(0);
  });

  it("returns score for empty project", () => {
    const result = analyzeLicenseCompliance([], []);
    expect(result.licenseScore).toBeGreaterThanOrEqual(0);
  });
});

describe("analyzeLongTermDebt", () => {
  it("detects legacy require() pattern", () => {
    const files = [{ path: "app.ts", content: "const express = require('express');\n".repeat(6) }];
    const result = analyzeLongTermDebt(files);
    expect(result.findings.some(f => f.type === "legacy-pattern")).toBe(true);
  });

  it("detects var declarations", () => {
    const files = [{ path: "app.ts", content: "var x = 1;\n".repeat(6) }];
    const result = analyzeLongTermDebt(files);
    expect(result.findings.some(f => f.type === "legacy-pattern")).toBe(true);
  });

  it("detects hardcoded localhost URLs", () => {
    const files = [{ path: "config.ts", content: 'const url = "http://localhost:3000";\nconst db = "localhost:5432";\nconst api = "http://localhost:8080";' }];
    const result = analyzeLongTermDebt(files);
    expect(result.findings.some(f => f.type === "hardcoded-config")).toBe(true);
  });

  it("returns score", () => {
    const files = [{ path: "test.ts", content: "export const x = 1;" }];
    const result = analyzeLongTermDebt(files);
    expect(result.debtScore).toBeGreaterThan(0);
  });
});

describe("runEnterpriseAnalysis", () => {
  it("orchestrates all sub-analyzers", () => {
    const result = runEnterpriseAnalysis([], []);
    expect(result.apiContract).toBeDefined();
    expect(result.observability).toBeDefined();
    expect(result.buildCI).toBeDefined();
    expect(result.coupling).toBeDefined();
    expect(result.license).toBeDefined();
    expect(result.longTermDebt).toBeDefined();
    expect(typeof result.overallSeniorScore).toBe("number");
    expect(typeof result.seniorSummary).toBe("string");
  });

  it("produces raw prompt block", () => {
    const result = runEnterpriseAnalysis([], []);
    expect(typeof result.rawPromptBlock).toBe("string");
    expect(result.rawPromptBlock.length).toBeGreaterThan(0);
  });

  it("aggregates critical blockers", () => {
    const result = runEnterpriseAnalysis([], []);
    expect(Array.isArray(result.criticalBlockers)).toBe(true);
  });

  it("computes overall senior score between 0-100", () => {
    const result = runEnterpriseAnalysis([], []);
    expect(result.overallSeniorScore).toBeGreaterThanOrEqual(0);
    expect(result.overallSeniorScore).toBeLessThanOrEqual(100);
  });
});
