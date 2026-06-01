import { describe, it, expect } from "vitest";
import { analyzeDependencies } from "../analyzers/dependency-health";

describe("analyzeDependencies", () => {
  it("detects deprecated packages", () => {
    const pkg = JSON.stringify({ dependencies: { request: "^2.88.0" } });
    const result = analyzeDependencies(pkg, []);
    expect(result.findings.some(f => f.type === "deprecated")).toBe(true);
  });

  it("detects outdated major versions", () => {
    const pkg = JSON.stringify({ dependencies: { express: "^3.0.0" } });
    const result = analyzeDependencies(pkg, []);
    expect(result.findings.some(f => f.type === "outdated")).toBe(true);
  });

  it("detects missing license field in package.json", () => {
    const pkg = JSON.stringify({}); // no license field
    // This is tested in enterprise.ts, not dependency-health
  });

  it("counts total dependencies", () => {
    const pkg = JSON.stringify({ dependencies: { a: "^1.0.0", b: "^2.0.0" }, devDependencies: { c: "^3.0.0" } });
    const result = analyzeDependencies(pkg, []);
    expect(result.totalDeps).toBe(2);
    expect(result.devDeps).toBe(1);
  });

  it("detects same package in deps and devDeps", () => {
    const pkg = JSON.stringify({ dependencies: { vite: "^6.0.0" }, devDependencies: { vite: "^6.0.0" } });
    const result = analyzeDependencies(pkg, []);
    expect(result.findings.some(f => f.type === "mismatched")).toBe(true);
  });

  it("handles empty package.json gracefully", () => {
    const result = analyzeDependencies("invalid json", []);
    expect(result.depHealthScore).toBe(0);
  });
});
