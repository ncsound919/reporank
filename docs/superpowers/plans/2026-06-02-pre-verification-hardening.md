# Pre-Verification Hardening Plan

> **For agentic workers:** Inline execution. No need to dispatch subagents for this scale.

**Goal:** Fix bugs, leaks, smells, security, and edge cases in the new code (trust route, badges, agentsRegistry, vibeTrend) before final verification.

**Architecture:** Targeted edits in 5 files + 1 new helper. TDD: each task adds a failing test first, then the fix.

**Tech Stack:** TypeScript, Zod, Prisma, vitest, supertest.

---

## Audit findings (root causes)

| # | File | Category | Issue |
|---|------|----------|-------|
| 1 | `impact.ts:85-87` | **Bug + dead code** | `baseVibe`, `newVibe`, `vibeDelta` declared but only `vibeDelta` written — `baseVibe` and `newVibe` are never read. |
| 2 | `impact.ts:computeVibeTrend` | **Bug** | `baseVibe` hardcoded to 0 → `delta` is always equal to `newVibe`. Misleading. |
| 3 | `impact.ts:computeVibeTrend` | **Edge case** | `removed` files (deleted AI code) are skipped — should LOWER the vibe score, not skip. |
| 4 | `agents.ts:42` | **Bug** | `ruleCount` regex `^##?\s` matches the `# AGENTS.md` top-level title — over-counts by 1. |
| 5 | `badges.ts:51` | **Edge case** | `renderVibeBadge(NaN)` shows "NaN" instead of falling back. Same for `renderSoftware20Badge`. |
| 6 | `trust.ts:3` | **Smell** | `calculateVibeCodingIndex` and `calculateSoftware20Score` imported but unused. |
| 7 | `trust.ts:120-127, 134-153, 96-104` | **Smell** | Scan→trustScore logic duplicated 4×. Extract a helper. |
| 8 | `trust.ts:50,93-104,117-126,138,149` | **Smell** | `as any` casts on `scan.report` / `scan.clawFindings` × 6. |
| 9 | `trust.ts:26` | **Security** | `agentsFile.content` cap is 50,000 but `recordAgentsFile` accepts unbounded `content` from agents route. DoS risk. |
| 10 | `agents.ts:26` | **Security** | `repoFullName` is `z.string().min(1).max(200)` — no format check. Accepts `../../etc` or `<script>`. |
| 11 | `agents.ts` (history routes) | **Bug** | `req.query.repoFullName as string` — no validation, used directly in DB query. |
| 12 | `computeVibeTrend` | **Edge case** | `newFiles.length < 2` returns "insufficient-data" but threshold test uses score, not count. Logic conflict. |
| 13 | `computeVibeTrend` insight | **Smell** | "rising" / "falling" are misleading for AI contamination. Should be "increasing contamination" / "decreasing". |
| 14 | `agentsRegistry.ts` | **Race** | `recordAgentsFile` is atomic via upsert — OK. But `listAgentsFileHistory` and `getLatestAgentsFile` could return inconsistent results across reads — minor, acceptable. |
| 15 | `formatPrComment` | **Bug** | `impact.vibeTrend` is checked for truthy but the new `emptyImpact()` always returns a vibeTrend, so the check is OK — but `formatPrComment` types may not include vibeTrend. |

---

## File Structure

**Create:**
- `apps/api/src/services/trustHelper.ts` — extract scan→trustScore logic + add ScanReport type
- `packages/grading-engine/src/__tests__/vibe-trend-edge.test.ts` — edge case tests

**Modify:**
- `apps/api/src/routes/trust.ts` — use helper, remove dead imports, add NaN guard
- `apps/api/src/services/badges.ts` — NaN/negative guards
- `apps/api/src/services/agentsRegistry.ts` — content size cap
- `apps/api/src/routes/agents.ts` — repoFullName format validation (owner/repo regex)
- `packages/grading-engine/src/analyzers/impact.ts` — remove dead code, fix vibeTrend (account for removed files, better direction labels, remove baseVibe=0 lie)

---

## Task 1: Helper extraction + remove duplication in trust.ts

**Files:**
- Create: `apps/api/src/services/trustHelper.ts`
- Modify: `apps/api/src/routes/trust.ts`
- Test: `apps/api/src/__tests__/trust-helper.test.ts`

- [ ] **Step 1.1: Write failing test for `extractScanTrustInputs`**

```ts
import { describe, it, expect } from "vitest";
import { extractScanTrustInputs } from "../services/trustHelper";

it("extracts overallScore, vibe, and security from a scan", () => {
  const inputs = extractScanTrustInputs({
    overallScore: 80,
    report: { vibeCodingIndex: { overallScore: 25 } },
    clawFindings: { critical: 0, high: 1, medium: 2, low: 0 },
  });
  expect(inputs.overallScore).toBe(80);
  expect(inputs.vibeCodingIndex).toBe(25);
  expect(inputs.securityFindings).toEqual({ critical: 0, high: 1, medium: 2, low: 0 });
});

it("returns zeros for missing fields", () => {
  const inputs = extractScanTrustInputs({});
  expect(inputs.overallScore).toBe(0);
  expect(inputs.vibeCodingIndex).toBe(0);
  expect(inputs.securityFindings).toBeUndefined();
});

it("handles null report gracefully", () => {
  const inputs = extractScanTrustInputs({ report: null, clawFindings: null });
  expect(inputs.overallScore).toBe(0);
});
```

- [ ] **Step 1.2: Run test, expect failure** (file doesn't exist)
- [ ] **Step 1.3: Implement helper**

```ts
import type { TrustScoreInput } from "@reporank/grading-engine";

export interface ScanLike {
  overallScore?: number | null;
  report?: unknown;
  clawFindings?: unknown;
}

export function extractScanTrustInputs(scan: ScanLike): Pick<TrustScoreInput, "overallScore" | "vibeCodingIndex" | "securityFindings"> {
  const report = scan.report as { vibeCodingIndex?: { overallScore?: number } } | null | undefined;
  const claw = scan.clawFindings as { critical?: number; high?: number; medium?: number; low?: number } | null | undefined;
  return {
    overallScore: scan.overallScore ?? 0,
    vibeCodingIndex: report?.vibeCodingIndex?.overallScore ?? 0,
    securityFindings: claw ? {
      critical: claw.critical ?? 0,
      high: claw.high ?? 0,
      medium: claw.medium ?? 0,
      low: claw.low ?? 0,
    } : undefined,
  };
}
```

- [ ] **Step 1.4: Refactor `trust.ts` to use helper in 4 places (POST /, GET /scan/:id, 3 badge routes). Remove unused imports (`calculateVibeCodingIndex`, `calculateSoftware20Score`).**
- [ ] **Step 1.5: Run tsc + tests. All green.**

---

## Task 2: NaN/negative guards in badges

**Files:**
- Modify: `apps/api/src/services/badges.ts`
- Test: extend `apps/api/src/__tests__/badges.test.ts`

- [ ] **Step 2.1: Add test for NaN handling**

```ts
it("clamps NaN to 0 in all badge renderers", () => {
  expect(renderVibeBadge(NaN)).toContain("0");
  expect(renderSoftware20Badge(NaN)).toContain("0");
  // trust badge doesn't accept NaN directly but result.trust could be
});

it("clamps negative values to 0", () => {
  expect(renderVibeBadge(-10)).toContain("0");
});
```

- [ ] **Step 2.2: Add `clampScore` helper at top of badges.ts**

```ts
function clampScore(n: number, max: number = 100): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.round(n)));
}
```

- [ ] **Step 2.3: Use `clampScore` in all 3 renderers.**
- [ ] **Step 2.4: Run tests. Green.**

---

## Task 3: repoFullName format validation in agents.ts

**Files:**
- Modify: `apps/api/src/routes/agents.ts`
- Test: extend existing `agents-validation` tests if present, else add

- [ ] **Step 3.1: Add test for invalid repoFullName**

```ts
it("rejects repoFullName with path traversal", () => {
  const res = await request(makeApp())
    .post("/api/v1/agents/generate")
    .send({ mode: "standard", repoFullName: "../../etc/passwd" });
  expect(res.status).toBe(400);
});

it("rejects repoFullName with control chars", () => {
  const res = await request(makeApp())
    .post("/api/v1/agents/generate")
    .send({ mode: "standard", repoFullName: "owner\x00repo" });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 3.2: Replace schema with strict regex**

```ts
const repoFullNameSchema = z.string().regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/, "Must be owner/repo format").max(200);
```

Use in both `generateSchema.repoFullName` and the `/registry/history`, `/registry/latest` query params (validate before DB call).

- [ ] **Step 3.3: Run tests. Green.**

---

## Task 4: Cap agentsFile content in agentsRegistry

**Files:**
- Modify: `apps/api/src/services/agentsRegistry.ts`
- Test: extend `agentsRegistry.test.ts`

- [ ] **Step 4.1: Add test for size cap**

```ts
it("rejects content larger than 100,000 chars", async () => {
  const huge = "x".repeat(100_001);
  await expect(recordAgentsFile({ ...content: huge })).rejects.toThrow();
});
```

- [ ] **Step 4.2: Add guard at start of `recordAgentsFile`**

```ts
if (input.content.length > 100_000) {
  throw new Error("AGENTS.md content too large (max 100,000 chars)");
}
```

- [ ] **Step 4.3: Run tests. Green.**

---

## Task 5: Fix vibeTrend — remove dead code, account for removed files, better labels

**Files:**
- Modify: `packages/grading-engine/src/analyzers/impact.ts`
- Test: extend `packages/grading-engine/src/__tests__/impact.test.ts`

- [ ] **Step 5.1: Add failing tests for new behavior**

```ts
it("vibeTrend is 'insufficient-data' when no added/modified files", () => {
  const report = predictImpact(80, [{ path: "x.ts", kind: "removed" }]);
  expect(report.vibeTrend.direction).toBe("insufficient-data");
});

it("vibeTrend reports contamination direction with non-misleading labels", () => {
  // High AI contamination should NOT be labeled "stable" just because baseVibe is 0
  const report = predictImpact(80, [
    { path: "ai.ts", kind: "added", content: "function a() { if (b) { if (c) { if (d) { if (e) { if (f) { if (g) { if (h) { if (i) { foo(); } } } } } } } } }" },
  ]);
  expect(report.vibeTrend.direction).toBe("increasing");
  expect(report.vibeTrend.insight).toMatch(/contamination|AI/i);
});
```

- [ ] **Step 5.2: Run tests. Fail.**
- [ ] **Step 5.3: Implement fix in impact.ts**

Remove dead variables (lines 85-87), rewrite `computeVibeTrend`:
- Don't hardcode `baseVibe = 0`; acknowledge in docstring it's a one-sided signal.
- Account for `removed` files: when kind is "removed" and content is present, treat as -vibeContribution.
- Rename direction: "rising" → "increasing" (more AI), "falling" → "decreasing", "stable" → "stable".
- Fix `insufficient-data` logic: based on `changes.length < 1` not `< 2`.

- [ ] **Step 5.4: Run tests. Green.**

---

## Task 6: ruleCount fix in agents.ts

**Files:**
- Modify: `apps/api/src/routes/agents.ts`
- Test: extend `apps/api/src/__tests__/agentsRegistry.test.ts` or new test

- [ ] **Step 6.1: Add test**

```ts
it("counts only ## (level 2) headings as rules, not the # title", () => {
  const guidelines = "# AGENTS.md\n\n## Security\n- rule 1\n## Testing\n- rule 2\n";
  // After fix: should be 2, not 3
  const ruleCount = (guidelines.match(/^##\s/gm) || []).length;
  expect(ruleCount).toBe(2);
});
```

- [ ] **Step 6.2: Change regex in agents.ts line 42**

```ts
const ruleCount = (guidelines.match(/^##\s/gm) || []).length;
```

(Note: from `^##?\s` to `^##\s`)

- [ ] **Step 6.3: Run tests. Green.**

---

## Task 7: Update PR commenter for new direction labels

**Files:**
- Modify: `apps/api/src/services/prCommenter.ts`
- Test: extend `apps/api/src/routes/__tests__/prs-comment.test.ts`

- [ ] **Step 7.1: Update emoji/label map**

```ts
const arrow = v.direction === "increasing" ? "📈" : v.direction === "decreasing" ? "📉" : "➡️";
```

- [ ] **Step 7.2: Run tests. Green.**

---

## Self-Review

- [ ] All `as any` casts in trust.ts removed? (Task 1)
- [ ] `impact.ts` dead code removed? (Task 5)
- [ ] `repoFullName` validated everywhere? (Task 3)
- [ ] All edge cases (NaN, negative, huge, empty) handled? (Tasks 2, 4, 5)
- [ ] No new files > 300 lines? (per AGENTS.md 🟡 rule)
- [ ] No eval(), no hardcoded URLs, no secrets? (per AGENTS.md 🔴 rules)

---

## Execution

Inline. Then final verification.
