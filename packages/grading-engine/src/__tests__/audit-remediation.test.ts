import { describe, it, expect } from "vitest";

// ── Test 1: Stratified file sampler ──────────────────────────────────────────
function stratifiedSample(paths: string[], maxTotal = 50, maxPerDir = 5): string[] {
  const byDir = new Map<string, string[]>();
  for (const p of paths) {
    const topDir = p.includes("/") ? p.split("/")[0] : "__root__";
    if (!byDir.has(topDir)) byDir.set(topDir, []);
    byDir.get(topDir)!.push(p);
  }
  const selected: string[] = [];
  const dirs = [...byDir.values()].map(files => files.slice(0, maxPerDir));
  let added = true;
  while (selected.length < maxTotal && added) {
    added = false;
    for (const dirFiles of dirs) {
      if (selected.length >= maxTotal) break;
      const next = dirFiles.shift();
      if (next !== undefined) { selected.push(next); added = true; }
    }
  }
  return selected;
}

describe("stratifiedSample", () => {
  it("samples at most maxTotal files", () => {
    const paths = Array.from({ length: 300 }, (_, i) => `dir${i % 20}/file${i}.ts`);
    const result = stratifiedSample(paths, 50, 5);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it("covers at least 5 distinct directories from a 200-file tree", () => {
    const paths = Array.from({ length: 200 }, (_, i) => `dir${i % 20}/file${i}.ts`);
    const result = stratifiedSample(paths, 50, 5);
    const dirs = new Set(result.map(p => p.split("/")[0]));
    expect(dirs.size).toBeGreaterThanOrEqual(5);
  });

  it("handles a flat repo with no subdirectories", () => {
    const paths = ["index.ts", "utils.ts", "main.ts"];
    const result = stratifiedSample(paths, 50, 5);
    expect(result).toHaveLength(3);
  });
});

// ── Test 2: React neutrality ──────────────────────────────────────────────────
const REACT_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function isReactEcosystem(sourceFiles: { path: string; content: string }[], packageJson?: string): boolean {
  if (packageJson && /["']react["']/.test(packageJson)) return true;
  return sourceFiles.some(f => /\bimport\b[^;]+\bfrom\s+['"]react['"]/m.test(f.content));
}

describe("framework neutrality — isReactEcosystem", () => {
  it("returns false for a pure Python project", () => {
    const files = [
      { path: "use_cases.py", content: "def use_cases(): pass" },
      { path: "usecases/handler.py", content: "class Handler: pass" },
    ];
    expect(isReactEcosystem(files)).toBe(false);
  });

  it("returns false for a Go project with use_* filenames", () => {
    const files = [
      { path: "usecase/service.go", content: "package usecase" },
    ];
    expect(isReactEcosystem(files)).toBe(false);
  });

  it("returns true for a React project via import", () => {
    const files = [
      { path: "src/App.tsx", content: "import React from 'react';" },
    ];
    expect(isReactEcosystem(files)).toBe(true);
  });

  it("returns true for a React project via package.json", () => {
    expect(isReactEcosystem([], `{"dependencies":{"react":"^18.0.0"}}`)).toBe(true);
  });
});

// ── Test 3: Secret finding anchoring ─────────────────────────────────────────
import { checkStructuredLogging, checkHardcodedUrls } from "../../src/analyzers/shared_checks.js";

describe("checkStructuredLogging — anchored findings", () => {
  it("returns per-file anchored findings with correct line numbers", () => {
    const files = [
      { path: "src/a.ts", content: "const x = 1;\nconsole.log('hello');\nconst y = 2;" },
      { path: "src/b.ts", content: "console.warn('test');" },
    ];
    const { findings, consoleLogCount } = checkStructuredLogging(files);
    expect(consoleLogCount).toBe(2);
    expect(findings[0]).toMatchObject({ file: "src/a.ts", line: 2 });
    expect(findings[1]).toMatchObject({ file: "src/b.ts", line: 1 });
  });

  it("detects structured logger presence", () => {
    const files = [{ path: "src/logger.ts", content: "import pino from 'pino';" }];
    const { hasStructuredLogger } = checkStructuredLogging(files);
    expect(hasStructuredLogger).toBe(true);
  });
});

describe("checkHardcodedUrls — anchored findings", () => {
  it("returns correct file and line for each match", () => {
    const files = [
      { path: "config.ts", content: "const API = 'http://localhost:3000';\nconst X = 1;" },
    ];
    const { findings } = checkHardcodedUrls(files);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]).toMatchObject({ file: "config.ts", line: 1 });
  });
});
