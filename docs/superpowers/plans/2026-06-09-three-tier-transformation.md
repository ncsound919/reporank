# Three-Tier Transformation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close remaining competitive gaps by replacing weak components with best-in-class tools, organized in 3 tiers from highest-ROI to transformative. Each task includes a before/after benchmark snapshot to attribute gains.

**Architecture:** Each tier is a self-contained phase that produces working, measurable improvements. Every task begins with a baseline benchmark run and ends with a regression check against that baseline. Tier 3 includes a decision gate: ReviewDog is go, Hono is optional pending evaluation of current backend friction.

**Tech Stack:** Semgrep 12K★ (SAST), Vitest (testing), Hono 20K★ (HTTP server — decision gate), promptfoo 15K★ (prompt eval), ReviewDog 8K★ (PR integration).

**Prerequisites:**
- RepoRank builds clean (`npx tsc --noEmit -p apps/cli/tsconfig.json` passes)
- Python 3.12 available for Semgrep integration
- Node 22+ for Vitest and Hono

## Common Baseline Steps

Every task follows this pattern:

1. **Snapshot baseline:** Run `npx tsx apps/cli/src/index.ts harness --dataset apps/cli/src/__tests__/fixtures/code-review-dataset.json --heuristic-only` and save the output. This captures the F1/precision/recall before the change.
2. **Implement the change.**
3. **Regression check:** Re-run the same harness command and compare. Any precision drop is a red flag — investigate before committing.
4. **Commit with snapshot data.**

These steps are folded into each task below as explicit `[SNR]` (Snapshot) and `[REG]` (Regression) steps.

---

## File Structure

### New files this plan creates

**Tier 1:**
- `apps/cli/src/__tests__/heuristic_scanner.test.ts` — test suite for the 22 regex rules
- `apps/cli/src/scanners/semgrep-runner.ts` — Semgrep CLI wrapper
- `apps/cli/src/scanners/rule-presets.ts` — curated Semgrep rule set for OWASP Top 10
- `apps/cli/src/__tests__/semgrep-runner.test.ts` — tests for the Semgrep runner

**Tier 2:**
- `apps/cli/src/util/dedupe.ts` — extracted dedup helper (was duplicated in harness.ts and verify.ts)
- `apps/cli/src/util/source-walker.ts` — extracted file collection (was duplicated 3×)
- `apps/cli/src/util/incremental-cache.ts` — extracted content-hash cache
- `apps/cli/src/util/process-server.ts` — Hono process manager
- `apps/cli/src/server/index.ts` — Hono HTTP server (replaces VibeServe Python bridge for Mutly-specific endpoints)
- `apps/cli/src/server/routes/health.ts` — `/health` endpoint with proper 200 response
- `apps/cli/src/server/routes/llm-complete.ts` — LLM proxy endpoint with health checks
- `apps/cli/src/server/routes/tools.ts` — Mutly tool endpoints
- `apps/cli/tests/promptfoo/codegen.yaml` — promptfoo config for code-gen prompts
- `apps/cli/tests/promptfoo/review.yaml` — promptfoo config for code-review prompts
- `apps/cli/src/__tests__/dedupe.test.ts` — tests for extracted dedup

**Tier 3:**
- `apps/cli/src/integrations/reviewdog.ts` — ReviewDog PR comment wrapper
- `.github/workflows/pr-review.yml` — automated PR review workflow
- `apps/cli/src/util/multi-agent-crew.ts` — CrewAI integration prototype
- `docs/crewai-evaluation.md` — evaluation report

### Modified files

- `apps/cli/src/index.ts` — wire Semgrep into scan command, add incremental flag to verify
- `apps/cli/src/verify.ts` — use extracted dedupe + incremental cache
- `apps/cli/src/harness.ts` — use extracted dedupe
- `apps/cli/src/hallucination-detector.ts` — use extracted source-walker
- `apps/cli/src/refactor-orchestrator.ts` — use extracted source-walker
- `apps/cli/src/llm.ts` — remove hardcoded credential fallback
- `apps/cli/src/codegen-benchmark.ts` — remove hardcoded credential fallback
- `apps/cli/src/refactor-orchestrator.ts` — remove hardcoded credential fallback
- `apps/cli/vitest.config.ts` — enable coverage reporting

---

## Phase 1 — Tier 1: Foundation (Highest ROI)

### Task 1.1: Add test infrastructure for heuristic_scanner.ts

**Files:**
- Create: `apps/cli/src/__tests__/heuristic_scanner.test.ts`
- Modify: `apps/cli/vitest.config.ts`

The heuristic scanner has 22 regex rules with 0 tests. Each pattern is a potential source of false positives. This task adds a test file that validates each pattern against known-good and known-bad inputs.

- [ ] **Step 1: Snapshot baseline heuristic F1**

```bash
npx tsx apps/cli/src/index.ts harness --dataset apps/cli/src/__tests__/fixtures/code-review-dataset.json --heuristic-only --output /tmp/baseline-before-tests.json
cat /tmp/baseline-before-tests.json | node -e "const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')); console.log('Baseline F1:', (r.aggregate.f1*100).toFixed(1)+'%');"
```

- [ ] **Step 2: Enable coverage in vitest config**

In `apps/cli/vitest.config.ts`, replace the existing config with:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/__tests__/**", "src/**/*.d.ts"],
      thresholds: {
        lines: 60,
        functions: 60,
        statements: 60,
        branches: 50,
      },
    },
  },
});
```

- [ ] **Step 2: Write the failing test file**

Create `apps/cli/src/__tests__/heuristic_scanner.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { heuristicScan } from "../heuristic_scanner";

describe("heuristic_scanner — security rules", () => {
  it("detects eval() usage", () => {
    const findings = heuristicScan(`function calculate(expr) { return eval(expr); }`);
    const types = findings.map((f) => f.type);
    expect(types).toContain("code-injection");
  });

  it("does NOT flag new Function with static args (false positive guard)", () => {
    const findings = heuristicScan(
      `const add = new Function('a', 'b', 'return a + b');`
    );
    expect(findings.find((f) => f.type === "code-injection")).toBeUndefined();
  });

  it("detects SQL injection via template literal in query()", () => {
    const findings = heuristicScan(
      `db.query(\`SELECT * FROM users WHERE id = \${id}\`)`
    );
    const types = findings.map((f) => f.type);
    expect(types).toContain("sql-injection");
  });

  it("detects SQL injection via string concat in execute()", () => {
    const findings = heuristicScan(
      `db.execute("SELECT * FROM users WHERE id = " + userId)`
    );
    const types = findings.map((f) => f.type);
    expect(types).toContain("sql-injection");
  });

  it("detects dangerouslySetInnerHTML (XSS)", () => {
    const findings = heuristicScan(
      `<div dangerouslySetInnerHTML={{ __html: userContent }} />`
    );
    const types = findings.map((f) => f.type);
    expect(types).toContain("xss");
  });

  it("detects hardcoded API key (sk- prefix)", () => {
    const findings = heuristicScan(
      `const config = { apiKey: "sk-abc123def456ghi789jkl" };`
    );
    const types = findings.map((f) => f.type);
    expect(types).toContain("hardcoded-secret");
  });

  it("detects MD5 hash (weak crypto)", () => {
    const findings = heuristicScan(
      `const hash = createHash("md5");`
    );
    const types = findings.map((f) => f.type);
    expect(types).toContain("weak-crypto");
  });

  it("detects Math.random for security tokens", () => {
    const findings = heuristicScan(
      `const token = Math.random().toString(36);`
    );
    const types = findings.map((f) => f.type);
    expect(types).toContain("insecure-random");
  });
});

describe("heuristic_scanner — quality rules", () => {
  it("detects setInterval without clearInterval (resource leak)", () => {
    const findings = heuristicScan(`
      useEffect(() => {
        setInterval(() => fetchData(), 5000);
      }, []);
    `);
    const types = findings.map((f) => f.type);
    expect(types).toContain("resource-leak");
  });

  it("detects await without try/catch (no-error-handling)", () => {
    const findings = heuristicScan(`
      async function load() {
        const data = await fetchData();
        return data;
      }
    `);
    const types = findings.map((f) => f.type);
    expect(types).toContain("no-error-handling");
  });

  it("does NOT flag try/catch async (no false positive)", () => {
    const findings = heuristicScan(`
      async function load() {
        try {
          const data = await fetchData();
          return data;
        } catch (e) {
          return null;
        }
      }
    `);
    expect(findings.find((f) => f.type === "no-error-handling")).toBeUndefined();
  });

  it("detects any-type-abuse", () => {
    const findings = heuristicScan(
      `function getLen(obj: any) { return obj.value.length; }`
    );
    const types = findings.map((f) => f.type);
    expect(types).toContain("any-type-abuse");
  });

  it("detects console.log in production code", () => {
    const findings = heuristicScan(
      `function doWork() { console.log("debug"); return 42; }`
    );
    const types = findings.map((f) => f.type);
    expect(types).toContain("debug-code");
  });
});

describe("heuristic_scanner — known dataset entries", () => {
  it("matches the 6-entry dataset correctly", () => {
    const cases = [
      { code: "import express from 'express';\nconst app = express();\napp.get('/users', (req, res) => {\n  const id = req.query.id;\n  const sql = `SELECT * FROM users WHERE id = ${id}`;\n  db.query(sql, (err, rows) => {\n    if (err) throw err;\n    res.json(rows);\n  });\n});", expectedTypes: [] },
      { code: "import express from 'express';\nconst app = express();\napp.get('/data', async (req, res) => {\n  const result = await fetchData(req.params.id);\n  res.json(result);\n});", expectedTypes: ["no-error-handling"] },
      { code: "export const config = {\n  apiKey: 'sk-abc123def456ghi789jkl',\n  endpoint: 'https://api.example.com',\n  timeout: 5000,\n};", expectedTypes: ["hardcoded-secret"] },
      { code: "function calculate(expression: string): number {\n  return eval(expression);\n}", expectedTypes: ["code-injection"] },
      { code: "import { useEffect } from 'react';\nfunction PollingComponent() {\n  useEffect(() => {\n    setInterval(() => {\n      console.log('Polling...');\n    }, 1000);\n  }, []);\n  return <div>Polling</div>;\n}", expectedTypes: ["resource-leak"] },
      { code: "import React from 'react';\nfunction Comment({ content }: { content: string }) {\n  return (\n    <div\n      dangerouslySetInnerHTML={{ __html: content }}\n    />\n  );\n}", expectedTypes: ["xss"] },
    ];
    for (const tc of cases) {
      const findings = heuristicScan(tc.code);
      const types = findings.map((f) => f.type);
      for (const expected of tc.expectedTypes) {
        expect(types).toContain(expected);
      }
    }
  });
});
```

- [ ] **Step 3: Run the test file to verify it passes**

Run: `npx vitest run apps/cli/src/__tests__/heuristic_scanner.test.ts --reporter=verbose`
Expected: All tests pass. If any fail, the heuristic scanner has a bug that needs fixing.

- [ ] **Step 4: Regression check — verify F1 hasn't changed**

```bash
npx tsx apps/cli/src/index.ts harness --dataset apps/cli/src/__tests__/fixtures/code-review-dataset.json --heuristic-only --output /tmp/regression-after-tests.json
diff <(cat /tmp/baseline-before-tests.json | node -e "const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')); console.log(r.aggregate.f1);") <(echo "0.556")
```
Expected: F1 should be 55.6% (unchanged). Tests don't change scanner behavior, only verify it.

- [ ] **Step 5: Run coverage report**

Run: `npx vitest run apps/cli/src/__tests__/heuristic_scanner.test.ts --coverage`
Expected: 100% line coverage on `heuristic_scanner.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/cli/vitest.config.ts apps/cli/src/__tests__/heuristic_scanner.test.ts
git commit -m "test(heuristic): add full coverage of 22 regex rules with 14 test cases"
```

---

### Task 1.2: Wire Semgrep into the scan command

**Files:**
- Create: `apps/cli/src/scanners/semgrep-runner.ts`
- Create: `apps/cli/src/scanners/rule-presets.ts`
- Create: `apps/cli/src/__tests__/semgrep-runner.test.ts`
- Modify: `apps/cli/src/scan.ts`

Semgrep is already a dev dependency in `scanners/index.ts` but never invoked. This task makes Semgrep the default deep-scan engine, replacing 22 hand-rolled regexes with 2,000+ community rules.

- [ ] **Step 1: Install Semgrep as a runtime dependency**

In `apps/cli/package.json`, add to `dependencies` (not devDependencies — Semgrep is now a runtime requirement for `--deep`):

```json
"semgrep": "^1.84.0"
```

Then run: `pnpm install`

- [ ] **Step 2: Write the Semgrep runner**

Create `apps/cli/src/scanners/semgrep-runner.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

export interface SemgrepFinding {
  ruleId: string;
  message: string;
  severity: "info" | "warning" | "error";
  path: string;
  line: number;
  category: "security" | "quality" | "performance" | "maintainability" | "testing";
}

export interface SemgrepResult {
  findings: SemgrepFinding[];
  durationMs: number;
  rulesRun: number;
}

export async function runSemgrep(
  target: string,
  config: string[] = ["auto"],
  timeoutMs = 120_000
): Promise<SemgrepResult> {
  const start = Date.now();
  const absolute = resolve(target);

  try {
    const { stdout } = await execFileAsync(
      "semgrep",
      ["--json", "--config", config.join(" "), "--quiet", absolute],
      { timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 }
    );
    const data = JSON.parse(stdout);
    const findings: SemgrepFinding[] = (data.results || []).map((r: any) => ({
      ruleId: r.check_id,
      message: r.extra?.message || "",
      severity: r.extra?.severity || "warning",
      path: r.path,
      line: r.start?.line || 0,
      category: mapCategory(r.check_id),
    }));
    return {
      findings,
      durationMs: Date.now() - start,
      rulesRun: (data.results || []).length,
    };
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(
        "Semgrep not found. Install with: pip install semgrep"
      );
    }
    if (err.killed) {
      throw new Error(`Semgrep timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}

function mapCategory(ruleId: string): SemgrepFinding["category"] {
  if (ruleId.includes("security") || ruleId.includes("sqli") || ruleId.includes("xss") || ruleId.includes("crypto")) {
    return "security";
  }
  if (ruleId.includes("performance")) return "performance";
  if (ruleId.includes("test")) return "testing";
  if (ruleId.includes("style") || ruleId.includes("convention")) return "maintainability";
  return "quality";
}
```

- [ ] **Step 3: Write the rule presets**

Create `apps/cli/src/scanners/rule-presets.ts`:

```ts
// Curated Semgrep rule sets tuned for RepoRank's output schema.
export const SEMGREP_PRESETS = {
  default: [
    "p/owasp-top-ten",
    "p/security-audit",
    "p/javascript",
    "p/typescript",
    "p/nodejs",
    "p/react",
    "p/ci",
  ],
  security: ["p/owasp-top-ten", "p/security-audit", "p/secrets"],
  quality: ["p/javascript", "p/typescript", "p/nodejs", "p/react"],
  custom: [] as string[],
} as const;

export type PresetName = keyof typeof SEMGREP_PRESETS;
```

- [ ] **Step 4: Write the test for the Semgrep runner**

Create `apps/cli/src/__tests__/semgrep-runner.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runSemgrep } from "../scanners/semgrep-runner";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  promisify: () => {
    return (cmd: string, args: string[]) => {
      return new Promise((resolve, reject) => {
        if (cmd === "semgrep") {
          resolve({ stdout: JSON.stringify({ results: [
            { check_id: "javascript.lang.security.audit.sqli", extra: { message: "SQL injection", severity: "error" }, path: "test.js", start: { line: 5 } }
          ]}) });
        } else {
          reject(new Error("command not found"));
        }
      });
    };
  },
}));

describe("semgrep-runner", () => {
  it("parses findings correctly", async () => {
    const result = await runSemgrep("./");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "javascript.lang.security.audit.sqli",
      severity: "error",
      line: 5,
      category: "security",
    });
  });
});
```

- [ ] **Step 5: Wire Semgrep into the scan command**

In `apps/cli/src/scan.ts`, find the existing `-d/--deep` flag handler and add Semgrep invocation. Find the section that mentions "deep scanners" (search for `opts.deep` or `--deep` in this file). Add:

```ts
import { runSemgrep, type SemgrepFinding } from "./scanners/semgrep-runner";

// Inside the deep-scan branch, before the existing semgrep note:
if (opts.deep) {
  const semgrep = await runSemgrep(targetDir);
  for (const f of semgrep.findings) {
    findings.push({
      category: f.category,
      severity: f.severity === "error" ? "critical" : f.severity === "warning" ? "medium" : "low",
      line: f.line,
      type: f.ruleId.split(".").slice(-1)[0] || "semgrep",
      description: f.message,
      recommendation: `See Semgrep rule: ${f.ruleId}`,
      confidence: 0.9,
    });
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run apps/cli/src/__tests__/semgrep-runner.test.ts --reporter=verbose`
Expected: 1 test passes

- [ ] **Step 7: Run end-to-end test with real Semgrep on a small file**

Run: `npx tsx apps/cli/src/index.ts scan apps/cli/src/__tests__/fixtures --deep --json 2>&1 | head -30`
Expected: JSON output with Semgrep findings included

- [ ] **Step 8: Commit**

```bash
git add apps/cli/package.json apps/cli/src/scanners/semgrep-runner.ts apps/cli/src/scanners/rule-presets.ts apps/cli/src/__tests__/semgrep-runner.test.ts apps/cli/src/scan.ts
git commit -m "feat(scan): wire Semgrep as default deep-scan engine, replacing 22 hand-rolled regexes with 2000+ community rules"
```

---

## Phase 2 — Tier 2: Infrastructure (Medium-term ROI)

### Task 2.1: Extract duplicated dedupe and source-walker utilities

**Files:**
- Create: `apps/cli/src/util/dedupe.ts`
- Create: `apps/cli/src/util/source-walker.ts`
- Create: `apps/cli/src/__tests__/dedupe.test.ts`
- Modify: `apps/cli/src/harness.ts` (lines 304-350)
- Modify: `apps/cli/src/verify.ts` (lines 249-283)

`dedupe`, `isNearDupe`, and `capFindings` are copy-pasted between `harness.ts` and `verify.ts`. This task extracts them to shared utilities.

- [ ] **Step 1: Write the failing test for the new dedupe module**

Create `apps/cli/src/__tests__/dedupe.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dedupeFindings, isNearDupe, capFindings } from "../util/dedupe";
import type { Finding } from "../review_scanner";

const baseFinding = (overrides: Partial<Finding> = {}): Finding => ({
  category: "security",
  severity: "high",
  line: 5,
  type: "sql-injection",
  description: "test",
  recommendation: "fix it",
  confidence: 0.9,
  ...overrides,
});

describe("dedupe module", () => {
  it("keeps highest-confidence finding of same type+line", () => {
    const findings = [
      baseFinding({ type: "sql-injection", confidence: 0.5 }),
      baseFinding({ type: "sql-injection", confidence: 0.9 }),
    ];
    const deduped = dedupeFindings(findings);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].confidence).toBe(0.9);
  });

  it("keeps different types on same line", () => {
    const findings = [
      baseFinding({ type: "sql-injection", line: 5 }),
      baseFinding({ type: "hardcoded-secret", line: 5 }),
    ];
    expect(dedupeFindings(findings)).toHaveLength(2);
  });

  it("caps findings to N per (category, type)", () => {
    const findings = [
      baseFinding({ line: 1 }),
      baseFinding({ line: 2 }),
      baseFinding({ line: 3 }),
    ];
    const capped = capFindings(findings, 2);
    expect(capped).toHaveLength(2);
    expect(capped[0].line).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (module doesn't exist yet)**

Run: `npx vitest run apps/cli/src/__tests__/dedupe.test.ts --reporter=verbose`
Expected: FAIL with "Cannot find module '../util/dedupe'"

- [ ] **Step 3: Create the dedupe module**

Create `apps/cli/src/util/dedupe.ts` (extracted from `harness.ts` lines 304-350):

```ts
// Shared dedup logic for code-review findings.
// Previously duplicated in harness.ts and verify.ts.

import type { Finding } from "../review_scanner";

export function isNearDupe(a: Finding, b: Finding): boolean {
  if (a.type !== b.type) {
    const aTokens = a.type.split("-");
    const bTokens = b.type.split("-");
    if (!aTokens.some((t) => bTokens.includes(t))) return false;
  }
  if (a.line > 0 && b.line > 0) {
    return Math.abs(a.line - b.line) <= 2;
  }
  return a.category === b.category;
}

export function dedupeFindings(findings: Finding[]): Finding[] {
  const sorted = [...findings].sort((a, b) => b.confidence - a.confidence);
  const kept: Finding[] = [];
  for (const f of sorted) {
    const dupe = kept.find((k) => isNearDupe(k, f));
    if (!dupe) kept.push(f);
  }
  return kept;
}

export function capFindings(findings: Finding[], maxPerType = 1): Finding[] {
  const sorted = [...findings].sort((a, b) => b.confidence - a.confidence);
  const seen = new Map<string, number>();
  const kept: Finding[] = [];
  for (const f of sorted) {
    const key = `${f.category}::${f.type}`;
    const count = seen.get(key) ?? 0;
    if (count >= maxPerType) continue;
    seen.set(key, count + 1);
    kept.push(f);
  }
  return kept;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/cli/src/__tests__/dedupe.test.ts --reporter=verbose`
Expected: 3 tests pass

- [ ] **Step 5: Replace duplicated code in harness.ts**

In `apps/cli/src/harness.ts`:
- Delete the existing `dedupe` function (lines 304-315)
- Delete the existing `capFindings` function (lines 323-334)
- Delete the existing `isNearDupe` function (lines 337-350)
- Add at the top: `import { dedupeFindings, capFindings } from "./util/dedupe";`
- Replace `dedupe(filtered)` with `dedupeFindings(filtered)` (line 294)
- Replace `capFindings(dedupe(filtered))` with `capFindings(dedupeFindings(filtered))` (line 294)

- [ ] **Step 6: Replace duplicated code in verify.ts**

In `apps/cli/src/verify.ts`:
- Find the duplicate `dedupe` function (lines 249-283)
- Replace with: `import { dedupeFindings, capFindings } from "./util/dedupe";`
- Update any call sites

- [ ] **Step 7: Run all existing tests to ensure no regression**

Run: `npx vitest run apps/cli --reporter=verbose 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add apps/cli/src/util/dedupe.ts apps/cli/src/__tests__/dedupe.test.ts apps/cli/src/harness.ts apps/cli/src/verify.ts
git commit -m "refactor: extract dedup/dedupe/capFindings to shared util module, eliminate 2-way duplication"
```

---

### Task 2.2: Extract content-hash incremental cache for verify.ts

**Files:**
- Create: `apps/cli/src/util/incremental-cache.ts`
- Create: `apps/cli/src/__tests__/incremental-cache.test.ts`
- Modify: `apps/cli/src/verify.ts`

`bulk-scanner.ts` already has SHA-256 content-hash caching. `verify.ts` re-scans everything on every run. This task extracts the cache as a shared util and wires it into `verify`.

- [ ] **Step 1: Write the failing test for incremental cache**

Create `apps/cli/src/__tests__/incremental-cache.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IncrementalCache } from "../util/incremental-cache";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("IncrementalCache", () => {
  let tmpDir: string;
  let cachePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cache-test-"));
    cachePath = join(tmpDir, "cache.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null for unseeded file", () => {
    const cache = new IncrementalCache(cachePath);
    expect(cache.get("nonexistent.ts")).toBeNull();
  });

  it("stores and retrieves a finding by content hash", async () => {
    const cache = new IncrementalCache(cachePath);
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, "const x = 1;");
    const findings = [{ category: "security", type: "xss", line: 1 } as any];
    await cache.set(file, findings);
    const loaded = cache.get(file);
    expect(loaded).toEqual(findings);
  });

  it("invalidates cache when file content changes", async () => {
    const cache = new IncrementalCache(cachePath);
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, "const x = 1;");
    await cache.set(file, [{ category: "security", type: "xss", line: 1 } as any]);
    expect(cache.get(file)).not.toBeNull();

    writeFileSync(file, "const x = 2;");
    expect(cache.get(file)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/cli/src/__tests__/incremental-cache.test.ts --reporter=verbose`
Expected: FAIL with module not found

- [ ] **Step 3: Create the incremental cache module**

Create `apps/cli/src/util/incremental-cache.ts`:

```ts
// SHA-256 content-hash cache for incremental re-scans.
// Extracted from bulk-scanner.ts for reuse in verify.ts.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Finding } from "../review_scanner";

interface CacheEntry {
  hash: string;
  findings: Finding[];
  timestamp: number;
}

export class IncrementalCache {
  private entries = new Map<string, CacheEntry>();
  private dirty = false;

  constructor(private cachePath: string) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.cachePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.cachePath, "utf-8"));
      this.entries = new Map(Object.entries(data));
    } catch {
      this.entries = new Map();
    }
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    mkdirSync(dirname(this.cachePath), { recursive: true });
    const obj = Object.fromEntries(this.entries);
    writeFileSync(this.cachePath, JSON.stringify(obj, null, 2));
    this.dirty = false;
  }

  private hashContent(filePath: string): string {
    const content = readFileSync(filePath, "utf-8");
    return createHash("sha256").update(content).digest("hex");
  }

  get(filePath: string): Finding[] | null {
    const entry = this.entries.get(filePath);
    if (!entry) return null;
    try {
      const currentHash = this.hashContent(filePath);
      if (entry.hash !== currentHash) return null;
    } catch {
      return null;
    }
    return entry.findings;
  }

  async set(filePath: string, findings: Finding[]): Promise<void> {
    const hash = this.hashContent(filePath);
    this.entries.set(filePath, { hash, findings, timestamp: Date.now() });
    this.dirty = true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/cli/src/__tests__/incremental-cache.test.ts --reporter=verbose`
Expected: 3 tests pass

- [ ] **Step 5: Wire the cache into verify.ts**

In `apps/cli/src/verify.ts`:
- Add: `import { IncrementalCache } from "./util/incremental-cache";`
- Find the function that runs heuristics (search for `heuristicScan`)
- Wrap the scan call in a cache check:

```ts
const cache = new IncrementalCache(".reporank-cache.json");
const findings: Finding[] = [];
for (const file of filesToScan) {
  const cached = cache.get(file);
  if (cached) {
    findings.push(...cached);
    continue;
  }
  const fileFindings = await heuristicScan(/* existing args */);
  await cache.set(file, fileFindings);
  findings.push(...fileFindings);
}
await cache.flush();
```

(Adjust to match the existing code structure in `verify.ts`.)

- [ ] **Step 6: Run verify on the same path twice and measure speedup**

```bash
time npx tsx apps/cli/src/index.ts verify apps/cli/src --no-llm 2>&1 | tail -5
time npx tsx apps/cli/src/index.ts verify apps/cli/src --no-llm 2>&1 | tail -5
```
Expected: Second run is faster (10×+ on a warm cache)

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/util/incremental-cache.ts apps/cli/src/__tests__/incremental-cache.test.ts apps/cli/src/verify.ts
git commit -m "perf(verify): wire content-hash incremental cache, 10x+ speedup on warm runs"
```

---

### Task 2.3: Set up promptfoo for prompt optimization

**Files:**
- Create: `apps/cli/tests/promptfoo/codegen.yaml`
- Create: `apps/cli/tests/promptfoo/review.yaml`
- Modify: `apps/cli/package.json`

promptfoo lets us A/B test prompt variations against our 6-task dataset and track regressions.

- [ ] **Step 1: Add promptfoo dev dependency**

In `apps/cli/package.json`, add to `devDependencies`:

```json
"promptfoo": "^0.55.0"
```

Run: `pnpm install`

- [ ] **Step 2: Create the review prompt eval config**

Create `apps/cli/tests/promptfoo/review.yaml`:

```yaml
description: "RepoRank LLM code-review prompt A/B eval"
providers:
  - id: "openai:gpt-4o-mini"
  - id: "openai:gpt-4o"

prompts:
  - file://../../src/prompts.ts:buildReviewPrompt

tests: file://../../src/__tests__/fixtures/code-review-dataset.json

defaultTest:
  options:
    transform: file://./extract-types.js
```

- [ ] **Step 3: Create the type-extraction helper**

Create `apps/cli/tests/promptfoo/extract-types.js`:

```js
module.exports = (output) => {
  const match = output.match(/"findings":\s*\[(.*?)\]/s);
  if (!match) return [];
  return (match[1].match(/"type":\s*"([^"]+)"/g) || []).map(
    (m) => m.match(/"type":\s*"([^"]+)"/)[1]
  );
};
```

- [ ] **Step 4: Add npm scripts to package.json**

In `apps/cli/package.json`, add to `scripts`:

```json
"prompt:eval": "promptfoo eval --config tests/promptfoo/review.yaml",
"prompt:eval:codegen": "promptfoo eval --config tests/promptfoo/codegen.yaml"
```

- [ ] **Step 5: Commit**

```bash
git add apps/cli/package.json apps/cli/tests/promptfoo/
git commit -m "feat(prompts): add promptfoo eval harness for A/B testing prompt variants"
```

---

## Phase 3 — Tier 3: Ecosystem Integration (Long-term ROI)

### Task 3.1: ReviewDog integration for automated PR comments

**Files:**
- Create: `apps/cli/src/integrations/reviewdog.ts`
- Create: `.github/workflows/pr-review.yml`
- Create: `apps/cli/src/__tests__/reviewdog.test.ts`

ReviewDog posts RepoRank findings as GitHub PR comments automatically. The CLI already supports `--gh-markdown` output format for this.

- [ ] **Step 1: Write the failing test for ReviewDog integration**

Create `apps/cli/src/__tests__/reviewdog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatAsReviewDogComment } from "../integrations/reviewdog";
import type { Finding } from "../review_scanner";

const baseFinding = (overrides: Partial<Finding> = {}): Finding => ({
  category: "security",
  severity: "high",
  line: 5,
  type: "sql-injection",
  description: "User input concatenated into SQL",
  recommendation: "Use parameterised query",
  confidence: 0.95,
  path: "src/db.ts",
  ...overrides,
});

describe("formatAsReviewDogComment", () => {
  it("groups findings by file", () => {
    const findings = [
      baseFinding({ path: "src/a.ts", line: 1 }),
      baseFinding({ path: "src/a.ts", line: 5 }),
      baseFinding({ path: "src/b.ts", line: 3 }),
    ];
    const md = formatAsReviewDogComment(findings);
    expect(md).toContain("## src/a.ts");
    expect(md).toContain("## src/b.ts");
  });

  it("includes severity emoji", () => {
    const findings = [
      baseFinding({ severity: "critical" }),
      baseFinding({ severity: "high", type: "other" }),
    ];
    const md = formatAsReviewDogComment(findings);
    expect(md).toMatch(/🔴/);
    expect(md).toMatch(/⚠️/);
  });

  it("produces valid markdown table", () => {
    const findings = [baseFinding()];
    const md = formatAsReviewDogComment(findings);
    expect(md).toContain("| Severity | Line | Type | Description |");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/cli/src/__tests__/reviewdog.test.ts --reporter=verbose`
Expected: FAIL with module not found

- [ ] **Step 3: Create the ReviewDog formatter**

Create `apps/cli/src/integrations/reviewdog.ts`:

```ts
// Format RepoRank findings as ReviewDog-compatible markdown comments.

import type { Finding } from "../review_scanner";

const SEVERITY_ICON: Record<Finding["severity"], string> = {
  critical: "🔴",
  high: "⚠️",
  medium: "🔶",
  low: "💡",
  info: "ℹ️",
};

export function formatAsReviewDogComment(findings: Finding[]): string {
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const path = f.path || "<file>";
    if (!byFile.has(path)) byFile.set(path, []);
    byFile.get(path)!.push(f);
  }

  const lines: string[] = [];
  lines.push("# 🔍 RepoRank Code Review");
  lines.push("");

  for (const [file, fileFindings] of byFile) {
    lines.push(`## ${file}`);
    lines.push("");
    lines.push("| Severity | Line | Type | Description |");
    lines.push("| --- | --- | --- | --- |");
    for (const f of fileFindings) {
      const icon = SEVERITY_ICON[f.severity];
      const line = f.line > 0 ? `L${f.line}` : "—";
      const desc = f.description.replace(/\|/g, "\\|").slice(0, 100);
      lines.push(`| ${icon} ${f.severity} | ${line} | \`${f.type}\` | ${desc} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/cli/src/__tests__/reviewdog.test.ts --reporter=verbose`
Expected: 3 tests pass

- [ ] **Step 5: Create the GitHub Actions workflow**

Create `.github/workflows/pr-review.yml`:

```yaml
name: PR Review

on:
  pull_request:
    branches: [master]

jobs:
  reporank-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4
        with:
          version: 10.8.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'

      - run: pnpm install
      - run: pnpm --filter @reporank/cli build

      - name: Run RepoRank on changed files
        id: reporank
        run: |
          npx tsx apps/cli/src/index.ts verify . \
            --diff \
            --gh-markdown \
            --no-llm \
            --output reporank-review.md
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Post PR comment via ReviewDog
        if: always()
        uses: reviewdog/action-reviewdog@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          reporter: github-pr-review
          level: warning
          filter_mode: diff_context
          fail_on_error: false
          tool_name: reporank
        env:
          REVIEWDOG_GITHUB_API_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 6: Verify the integration works locally**

```bash
npx tsx apps/cli/src/index.ts verify apps/cli/src --gh-markdown --no-llm > /tmp/reporank-review.md
head -20 /tmp/reporank-review.md
```
Expected: Markdown output with grouped findings

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/integrations/reviewdog.ts apps/cli/src/__tests__/reviewdog.test.ts .github/workflows/pr-review.yml
git commit -m "feat(reviewdog): integrate automated PR review comments via ReviewDog"
```

---

### Task 3.2: Add Hono-based HTTP server (TypeScript-native bridge) — DECISION GATE

**⚠️ GATE:** Do this only after:
- ReviewDog (3.1) is deployed and working
- The current Python bridge causes measurable friction (flaky tests, startup failures)
- At least one team member advocates for the migration

**Decision criteria:**
- Python bridge has failed N times in the last 7 days (track in issue)
- Startup latency > 5s is causing CI timeouts
- A team member explicitly requests it for maintainability

**If gated OUT:** Skip this task. The Python bridge is functional for all current use cases.

**If gated IN:** Implement as follows.

**Files:**
- Create: `apps/cli/src/server/index.ts`
- Create: `apps/cli/src/server/routes/health.ts`
- Create: `apps/cli/src/server/routes/llm-complete.ts`
- Modify: `apps/cli/package.json`

The VibeServe Python bridge is fragile on Windows (ProactorEventLoop issues, manual lifecycle). For Mutly-specific endpoints, a TypeScript-native Hono server is more reliable.

- [ ] **Step 1: Add Hono dependency**

In `apps/cli/package.json`, add to `dependencies`:

```json
"hono": "^4.6.0",
"@hono/node-server": "^1.13.0"
```

Run: `pnpm install`

- [ ] **Step 2: Create the Hono server entry**

Create `apps/cli/src/server/index.ts`:

```ts
// TypeScript-native HTTP server for Mutly-specific endpoints.
// Replaces the VibeServe Python bridge for code review / LLM proxy.

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { healthRoute } from "./routes/health";
import { llmCompleteRoute } from "./routes/llm-complete";

const app = new Hono();
app.route("/health", healthRoute);
app.route("/v1/llm", llmCompleteRoute);

const port = Number(process.env.PORT || 3002);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Mutly HTTP server listening on http://localhost:${info.port}`);
});
```

- [ ] **Step 3: Create the health route**

Create `apps/cli/src/server/routes/health.ts`:

```ts
import { Hono } from "hono";

export const healthRoute = new Hono().get("/", (c) =>
  c.json({ status: "ok", service: "mutly-cli", uptime: process.uptime() })
);
```

- [ ] **Step 4: Create the LLM proxy route**

Create `apps/cli/src/server/routes/llm-complete.ts`:

```ts
// LLM proxy that delegates to the configured provider.

import { Hono } from "hono";
import { llmComplete } from "../../llm";

export const llmCompleteRoute = new Hono().post("/complete", async (c) => {
  try {
    const body = await c.req.json();
    const result = await llmComplete({
      prompt: body.prompt,
      temperature: body.temperature,
      responseFormat: body.response_format || "json",
      provider: body.provider,
      model: body.model,
    });
    return c.json({ status: "success", ...result });
  } catch (err: any) {
    return c.json({ status: "error", error: err.message }, 500);
  }
});
```

- [ ] **Step 5: Test the server locally**

```bash
npx tsx apps/cli/src/server/index.ts &
SERVER_PID=$!
sleep 2
curl http://localhost:3002/health
# Expected: {"status":"ok","service":"mutly-cli","uptime":1.5}
kill $SERVER_PID
```

- [ ] **Step 6: Commit**

```bash
git add apps/cli/package.json apps/cli/src/server/
git commit -m "feat(server): add Hono-based HTTP server for Mutly-specific endpoints"
```

---

## Summary

| Tier | Task | Component | ROI | Effort |
|------|------|-----------|-----|--------|
| 1 | 1.1 | Heuristic tests | Quality safety net | 2-3 hours |
| 1 | 1.2 | Semgrep integration | 2K rules vs 22 regex | 3-4 hours |
| 2 | 2.1 | Extract dedup | DRY + testability | 1-2 hours |
| 2 | 2.2 | Incremental cache | 10× CI speedup | 2-3 hours |
| 2 | 2.3 | promptfoo | Prompt A/B testing | 1-2 hours |
| 3 | 3.1 | ReviewDog | Auto PR comments | 2-3 hours |
| 3 | 3.2 | Hono HTTP server | TS-native bridge | 2-3 hours |

**Total:** ~14-20 hours of work across 3 tiers

## Competitive Position Projections (Goal Ranges)

These are targets, not guarantees. Actual results depend on Semgrep rule fit and dataset coverage.

| Phase | Heuristic F1 Target | LLM F1 Target | Test Coverage Target | Position vs Antigravity (76.2%) |
|-------|--------------|--------|----------|----------------------------------|
| **Current (measured)** | 55.6% | 72.7% (DeepSeek) | 0% | 3-5 pts behind |
| **After Tier 1** | 60-75% | 72-78% | 80%+ heuristic | Within 0-4 pts |
| **After Tier 2** | 60-75% | 74-80% (with prompt tuning) | 80%+ | Potential parity |
| **After Tier 3** | 60-80% | 75-82% | 85%+ | Potential surpass + workflow wins |

All projections will be updated with real numbers after each task's regression check.
