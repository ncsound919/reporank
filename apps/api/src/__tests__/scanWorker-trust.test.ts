import { describe, it, expect } from "vitest";

// Test the trust/software20 wiring logic in scanWorker via a focused re-implementation
// of the small block. The block is pure data flow — we verify it surfaces the right
// fields in the report and computes plausible scores.

import { calculateTrustScore, calculateSoftware20Score } from "@reporank/grading-engine";

function buildScanArtifacts(sourceFiles: { path: string; content: string }[], fileTree: string[], clawResults: { critical: number; high: number; medium: number; low: number }, overallScore: number, vibeCodingOverall: number) {
  const testFilePaths = new Set<string>(
    sourceFiles
      .filter(f => /\.(test|spec)\.[a-z]+$/i.test(f.path) || f.path.includes("/tests/") || f.path.includes("/__tests__/"))
      .map(f => f.path)
  );
  const software20 = calculateSoftware20Score(sourceFiles, fileTree, testFilePaths);
  const trust = calculateTrustScore({
    overallScore,
    vibeCodingIndex: vibeCodingOverall,
    securityFindings: clawResults,
    software20Inputs: { sourceFiles, fileTree, testFilePaths },
  });
  return { software20, trust };
}

describe("scanWorker trust + software20 wiring", () => {
  it("populates software20 and trust in report-shaped object", () => {
    const sourceFiles = [
      { path: "src/app.ts", content: "// main app\nconst a = 1;\nexport { a };\n".repeat(20) },
      { path: "src/util.ts", content: "// util\nfunction add(a: number, b: number) { return a + b; }\n".repeat(10) },
      { path: "tests/app.test.ts", content: "test('adds', () => { expect(1).toBe(1); });\n".repeat(5) },
    ];
    const fileTree = ["src/app.ts", "src/util.ts", "tests/app.test.ts"];
    const claw = { critical: 0, high: 0, medium: 1, low: 0 };
    const { software20, trust } = buildScanArtifacts(sourceFiles, fileTree, claw, 70, 30);
    expect(software20.overall).toBeGreaterThan(0);
    expect(software20.overall).toBeLessThanOrEqual(100);
    expect(software20.testCoverage).toBeGreaterThan(0); // tests/ recognized
    expect(trust.trust).toBeGreaterThan(0);
    expect(trust.grade).toMatch(/^[A-F][+-]?$/);
    expect(trust.components.software20.score).toBe(software20.overall);
    expect(trust.components.vibe.score).toBe(70); // 100 - vibeCodingIndex(30) = cleanliness inverse
  });

  it("identifies test files by extension and /tests/ path", () => {
    const files = [
      { path: "a.test.ts", content: "" },
      { path: "b.spec.tsx", content: "" },
      { path: "src/tests/c.ts", content: "" },
      { path: "src/__tests__/d.ts", content: "" },
      { path: "src/prod.ts", content: "" },
    ];
    const { software20 } = buildScanArtifacts(files, files.map(f => f.path), { critical: 0, high: 0, medium: 0, low: 0 }, 50, 50);
    expect(software20.testCoverage).toBeGreaterThan(0);
  });

  it("handles empty file list without throwing", () => {
    const { software20, trust } = buildScanArtifacts([], [], { critical: 0, high: 0, medium: 0, low: 0 }, 0, 0);
    expect(software20.overall).toBe(0);
    expect(trust.trust).toBeGreaterThanOrEqual(0);
  });

  it("clamps trust score within [0, 100] for high-security repos", () => {
    const files = [{ path: "src/a.ts", content: "x".repeat(500) }];
    const { trust } = buildScanArtifacts(files, ["src/a.ts"], { critical: 100, high: 0, medium: 0, low: 0 }, 30, 50);
    expect(trust.trust).toBeGreaterThanOrEqual(0);
    expect(trust.trust).toBeLessThanOrEqual(100);
  });
});
