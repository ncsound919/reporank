# RepoRank Innovation Integration Plan

## Objective
Build RepoRank into the platform that owns AI agent governance, codebase health grading, and the emerging AGENTS.md standard — making it the "acquisition trap" that incumbents must buy.

## Strategic Priority

| # | Initiative | Moat | Market Readiness | Effort | PRs |
|---|-----------|------|-----------------|--------|-----|
| **1** | **AGENTS.md Generator + Compliance Auditor** | 🔒 Uncontested | NOW — Stanford just lit the fuse | 3 PRs | 6 |
| **2** | **AI Contamination Index** | 🔒 Uncontested | NOW — CodeClimate wants this but can't do code-level | 2 PRs | 4 |
| **3** | **PR Impact Prediction** | Medium | Adjacent | 2 PRs | 4 |
| **4** | **Education: AI Usage Audit** | Medium | Near-term | 2 PRs | 3 |

---

## Phase 1: AGENTS.md Generator + Compliance Auditor (6 PRs)

### Why This Wins
- AGENTS.md is becoming a universal standard (Stanford CS336, HN front page 328 pts)
- **NOBODY** has built tooling for this — no generator, no auditor, no compliance checker
- RepoRank already has the codebase analysis engine to power it
- First-mover advantage in a category that literally doesn't exist yet

### Architecture

```
packages/agent-guidelines/          # NEW package
├── src/
│   ├── index.ts                    # Public API exports
│   ├── generator.ts                # Analyzes codebase → generates AGENTS.md rules
│   ├── compliance.ts               # Given AGENTS.md + codebase, check compliance
│   ├── rules.ts                    # Rule catalog (templates for different scenarios)
│   └── __tests__/
│       ├── generator.test.ts
│       ├── compliance.test.ts
│       └── rules.test.ts
├── templates/                      # AGENTS.md templates
│   ├── open-source.md
│   ├── enterprise.md
│   ├── education.md
│   └── default.md
├── package.json
└── tsconfig.json
```

### PR 1.1: Package scaffold + rule catalog
**Files:** `packages/agent-guidelines/` (package.json, tsconfig.json, rules.ts, index.ts)

**Task list:**
- Create monorepo package `@reporank/agent-guidelines`
- Define Rule interface: `{ id: string, category: string, condition: (analysis: CodebaseAnalysis) => boolean, template: string }`
- Build rule catalog covering:
  - AI usage rules (no `any` abuse, no hardcoded secrets, no eval)
  - Code review rules (PR must pass grading, min score threshold)
  - Agent behavior rules (don't run bash, don't write code for student)
  - Security rules (secrets must be env vars, API keys must be rotated)
  - Quality gates (coverage threshold, lint rules)
- Export `getRulesForAnalysis(analysis)` — returns relevant rules based on repo analysis
- **Tests:** 90%+ coverage on rule selection logic

### PR 1.2: Codebase analysis → AGENTS.md generator
**Files:** `generator.ts`, tests

**Task list:**
- Build `generateAgentGuidelines(analysis: DeepAnalysisReport): string`
- Uses RepoRank's existing `runDeepAnalysis` to detect:
  - AI-written code patterns (from ai-code.ts)
  - Code quality issues (from code-hygiene, complexity)
  - Security posture (from production.ts, claw-protect)
  - Team conventions (from architecture, naming analyzers)
- Generates tiered guidelines based on findings:
  - **Strict mode:** High AI contamination, security issues → restrictive rules
  - **Moderate mode:** Clean codebase → balanced rules
  - **Permissive mode:** Well-structured → minimal rules
- Outputs complete AGENTS.md / CLAUDE.md
- **Tests:** Verify output format, rule inclusion, tier selection

### PR 1.3: Compliance auditor
**Files:** `compliance.ts`, `rules.test.ts`

**Task list:**
- Build `checkCompliance(codebase: Analysis, agentsFile: string): ComplianceReport`
- Parse existing AGENTS.md/CLAUDE.md files
- Check if the codebase violates declared rules
- Report: `{ violations: [{ rule, file, severity, detail }], score: number }`
- **Tests:** Parse sample AGENTS.md, verify violation detection

### PR 1.4: CLI integration
**Files:** `apps/cli/src/agents.ts`, `apps/cli/src/index.ts`

**Task list:**
- Add `reporank agents generate [--mode strict|moderate|permissive]` command
- Add `reporank agents audit` command (checks compliance)
- Add `reporank agents check <file>` (validates a given AGENTS.md)
- Output as markdown or JSON

### PR 1.5: API routes + web UI
**Files:** `apps/api/src/routes/agents.ts`, `apps/web/src/pages/AgentsPage.tsx`

**Task list:**
- POST `/api/v1/agents/generate` — returns generated AGENTS.md
- POST `/api/v1/agents/audit` — returns compliance report
- Web UI for previewing and editing generated guidelines
- History of guideline changes

### PR 1.6: GitHub Action for CI enforcement
**Files:** `.github/actions/agents-compliance/action.yml`, `.github/actions/agents-compliance/index.js`

**Task list:**
- GitHub Action that runs on PRs
- Checks if codebase complies with AGENTS.md rules
- Posts check run with violations
- Blocks PR if critical violations found

---

## Phase 2: AI Contamination Index (4 PRs)

### Why This Wins
- CodeClimate is pivoting to "AI transformation metrics" but can't do code-level analysis
- RepoRank's `ai-code.ts` already detects AI-written code patterns — needs to become a quantifiable metric
- Enterprises adopted Copilot but can't measure if it's working

### PR 2.1: Contamination score engine
**Files:** `packages/grading-engine/src/analyzers/contamination.ts`, tests

**Task list:**
- Build `calculateContamination(sourceFiles): { overallScore, perFile, signals, trends }`
- Combine signals from existing ai-code.ts:
  - Spaghetti nesting depth
  - Over-engineering (types/functions ratio)
  - Hallucinated imports
  - Missing error boundaries
  - any-abuse density
  - Inconsistent patterns
- Weighted scoring model (0-100, higher = more AI-like)
- Per-file breakdown for PR-level analysis
- **Tests:** Verify scores on known AI-generated code vs human-written

### PR 2.2: Longitudinal tracking
**Files:** `packages/grading-engine/src/analyzers/contamination.ts` (update), `apps/api/src/routes/scans.ts` (update), Prisma schema (update)

**Task list:**
- Store contamination score per scan
- Track changes over time (same repo, different scans)
- Trend computation: "Your AI contamination went from 30% to 65% in 3 months"
- API endpoint: GET `/api/v1/scans/:id/contamination`
- **Tests:** Verify trend calculations

### PR 2.3: CI check for contamination threshold
**Files:** `.github/actions/contamination-check/action.yml`, `apps/cli/src/scan.ts` (update)

**Task list:**
- GitHub Action that runs `reporank scan` and extracts contamination score
- Compares against threshold from AGENTS.md
- Posts PR check: ✅ Clean / ⚠️ Warning / ❌ Blocked
- **Tests:** Mock scans with different contamination levels

### PR 2.4: Dashboard visualization
**Files:** `apps/web/src/components/ContaminationChart.tsx`, `apps/web/src/pages/DashboardPage.tsx` (update)

**Task list:**
- Trend chart showing contamination over time
- Per-file breakdown (heatmap of AI-written files)
- Compare with codebase grade (does AI contamination correlate with quality?)
- PR-level contamination diff view

---

## Phase 3: PR Impact Prediction (4 PRs)

### Why This Wins
- Every other AI code reviewer (CodeRabbit, Qodo) does line-level comments
- Nobody predicts how a PR affects overall codebase health
- RepoRank can: "This PR will drop your score from 82 to 76. Files X, Y, Z are the problem."

### PR 3.1: Impact prediction engine
**Files:** `packages/grading-engine/src/analyzers/impact.ts`, tests

**Task list:**
- Build `predictImpact(prChanges, currentScore, analysis): ImpactReport`
- For each changed file in PR, analyze:
  - If removed: positive impact (code removal is good)
  - If added/modified: run partial analysis of that file
  - Aggregate: predicted overall score after merge
- **Tests:** Verify predictions on known PRs

### PR 3.2: PR commenter service
**Files:** `apps/api/src/routes/prs.ts`, `apps/api/src/services/githubPr.ts`

**Task list:**
- GitHub App webhook handler for `pull_request` events
- Run impact prediction on PR diff
- Post comment: "RepoRank predicts this PR will change your score from 82 to 78"
- Include per-file breakdown
- Re-run on new commits

### PR 3.3: Score delta break-down
**Files:** `packages/grading-engine/src/analyzers/impact.ts` (update)

**Task list:**
- Per-file contribution to delta
- "This file adds 12 violations → -3 points"
- "This PR removes 200 lines of dead code → +5 points"
- Sort by impact severity

### PR 3.4: Recommendation engine
**Files:** `packages/grading-engine/src/analyzers/impact.ts` (update)

**Task list:**
- "Add a null check on line 42 to prevent -2 point deduction"
- "Extract this god-file to save -5 points"
- Estimated score after recommendations

---

## Phase 4: Education AI Usage Audit (3 PRs)

### Why This Wins
- Stanford CS336 is just the tip of the iceberg
- Every university is scrambling for AI governance in CS courses
- RepoRank can become the standard for "did you actually learn this?"

### PR 4.1: Student submission auditor
**Files:** `packages/grading-engine/src/analyzers/education.ts`, tests

**Task list:**
- Build `auditSubmission(submission, courseGuidelines): AuditReport`
- Compare student code against AGENTS.md rules for the course
- Detect:
  - AI-written code patterns
  - Copy-paste from course materials
  - Outsourced implementation to AI
  - Session consistency (does the code progression look human?)
- **Tests:** Verify against known AI-generated and human-written submissions

### PR 4.2: Session replay analysis
**Files:** `packages/agent-guidelines/src/compliance.ts` (update)

**Task list:**
- If student provides AI chat transcripts, analyze the interaction
- Was the student directing or was the AI leading?
- Did the student understand the changes or just accept?
- Report: Understanding Score, Autonomy Score, Learning Efficiency

### PR 4.3: Course integration
**Files:** `apps/api/src/routes/education.ts`, `.github/actions/education-audit/action.yml`

**Task list:**
- API endpoints for course management
- Integration with LMS (Canvas, Gradescope)
- GitHub Classroom integration
- Auto-generate course-specific AGENTS.md from course materials

---

## Dependency Graph

```
PR 1.1 ──> PR 1.2 ──> PR 1.3 ──> PR 1.4
                                        │
                                        └──> PR 1.5 ──> PR 1.6
                                        
PR 2.1 ──> PR 2.2 ──> PR 2.3
                  │
                  └──> PR 2.4

PR 3.1 ──> PR 3.2 ──> PR 3.3 ──> PR 3.4
         (depends on PR 2.1)

PR 4.1 ──> PR 4.2 ──> PR 4.3
         (depends on PR 1.3)
```

### Parallel execution groups:
- PRs 1.1 + 2.1 + 3.1 (independent foundations)
- PRs 1.2 + 2.2 (sequential within tracks, parallel across tracks)
- PRs 1.4 + 2.3 + 3.2 (CLI + CI tools, can be parallel)
- PRs 1.5 + 2.4 (UI work, parallel)

## Verification Gates

After every PR, verify:
```
pnpm lint                    # TypeScript strict mode
pnpm test                    # All existing tests pass
pnpm build                   # Package compiles
pnpm --filter @reporank/<pkg> test -- --coverage  # Coverage doesn't regress
```

## Rollback Protocol

Each PR creates an atomic commit that can be reverted:
```
git revert <sha>             # Clean revert of the entire PR
pnpm install                 # Restore lockfile
pnpm test                    # Verify clean state
```

## Implementation Sequence

Start with **PR 1.1** and **PR 2.1** in parallel — they have no dependencies and build the foundation for Phases 1 and 2. Then proceed to PR 1.2 (generator) and PR 2.2 (tracking) in parallel. This maximizes velocity by keeping all tracks moving.

---

## Karpathy Methods Applied to RepoRank

Andrej Karpathy's work and philosophy provide direct strategic guidance for RepoRank's innovation. Here's how each Karpathy method maps to specific changes:

### 1. "Vibe Coding" as a Core Metric

Karpathy coined the term "vibe coding" — code that "looks right" but has subtle issues because it was generated by an AI that doesn't understand the full context.

**What to build:** RepoRank already has `ai-code.ts` which detects AI-written code patterns. This needs to become RepoRank's flagship metric.

- Rename the AI Contamination Index to **"Vibe Coding Index™"**
- Add a Vibe Score to every scan report (inline with overallScore, security, etc.)
- Include the Vibe Coding Index in the badge SVG so repos can display it
- **PR 2.1 change:** `calculateVibeScore()` becomes a first-class export from grading-engine, named export `calculateVibeCodingIndex`

**Karpathy's direct relevance:** He coined the term, his authority validates the metric. Every developer knows what "vibe coding" means. This is brand-compatible with RepoRank.

### 2. "Software 2.0" Grade

Karpathy's Software 2.0 thesis: we're moving from hand-coded rules (Software 1.0) to neural networks that learn from data (Software 2.0). RepoRank straddles both worlds.

**What to build:** RepoRank should report on both:
- **Software 1.0 Readiness:** Traditional code quality (lint, types, tests, docs)
- **Software 2.0 Readiness:** How well does this codebase accept AI contributions? Is it structured for LLM editing?

**PR 3.1 addition:** `predictImpact()` should include a "Software 2.0 Compatibility Score" that measures:
- File size distribution (small files = easier for LLMs to edit)
- Comment density (good comments = better LLM context)
- Import structure clarity (clean deps = better LLM reasoning)
- Test coverage (tests = LLM can verify changes)

**PR 1.2 addition:** AGENTS.md generator should have a "Software 2.0" section:
```markdown
## Software 2.0 Guidelines
- Prefer small files (<200 lines) for LLM-editable code
- Add type annotations — LLMs reason better with types
- Keep functions focused (single responsibility) for LLM context windows
```

### 3. Progressive Report Structure (The Onion Method)

Karpathy's `microgpt` progression (`train0.py` → `train5.py`) builds understanding layer by layer. RepoRank's current report dumps everything at once.

**What to build:** Replace the flat report with a progressive, layered structure:

```
Layer 1 (Executive): Overall Score + Vibe Coding Index + 3 critical items
Layer 2 (Team): Category breakdowns + change over time
Layer 3 (Contributor): Per-file scores + quick wins
Layer 4 (Maintainer): Raw findings, invisible bugs, dead code
Layer 5 (Auditor): Full data dump, compliance report, AGENTS.md audit
```

**PR 1.5 addition:** The web UI should use accordion/expandable sections following this onion layering.

**PR 1.6 addition:** The CLI default output should be Layer 1-2. Use `--verbose` for deeper layers. Karpathy-rule: "The default output must fit in a terminal without scrolling."

### 4. Minimal Viable AGENTS.md

Karpathy's `microgpt` is 200 lines of pure Python with zero dependencies. It's the minimal possible implementation. Stanford's CS336 AGENTS.md is 74 lines. A Karpathy AGENTS.md would be 10 lines.

**What to build:** The AGENTS.md generator should offer three modes:
- **Minimal** (Karpathy): 5-10 lines, maximum signal-to-noise. Fits in context window.
- **Standard** (balanced): 20-30 lines with categories
- **Comprehensive** (Stanford): Full rule catalog with examples

**PR 1.2 addition:** The `--mode minimal` flag should generate:
```markdown
# AGENTS.md (Minimal)
- Never write code for me — explain concepts, point to docs
- Review my code; suggest improvements as questions
- No bash, no editing files, no TODO completion
- Maximum 3 suggestions per response
```

**Karpathy rule:** "The best AGENTS.md is the one that actually fits in the LLM's context window after the codebase is loaded." — RepoRank should measure and warn if the generated file is too long for the target model's context.

### 5. Education: Progressive Disclosure for Students

Karpathy's educational philosophy is "build from scratch, understand every layer." Apply this to code review for students:

**PR 4.1 addition:** Instead of dumping all findings, the education auditor should show:
- Layer 1: "Your code compiles and runs. Here's what it does."
- Layer 2: "Here are 3 things you could improve."
- Layer 3: "Here's how an experienced developer would write this."
- Layer 4: "Here are the invisible bugs a senior dev would catch."

Each layer is opt-in. Students control how much help they want.

### 6. "The Unreasonable Effectiveness" of Static Analysis + AI

Karpathy's famous blog series ("The Unreasonable Effectiveness of RNNs", etc.) shows that simple methods can be surprisingly effective. RepoRank's hybrid approach (static analysis + AI grading) is exactly this.

**What to build:** Prove this with a benchmark. Run RepoRank on 100 open-source repos and compare:
- Pure static analysis results vs.
- Pure AI grading results vs.
- Hybrid (RepoRank's current) results

**PR 2.4 addition:** The dashboard should show which findings came from static analysis vs. AI. This builds trust — developers trust deterministic rules more than AI.

### Summary: Karpathy-Applied Changes by PR

| PR | Karpathy Change |
|----|----------------|
| **PR 1.2** | AGENTS.md generator: `--mode minimal` (Karpathy style), Software 2.0 section, context window warning |
| **PR 1.5** | Progressive onion-layer UI (Layer 1-5) |
| **PR 1.6** | CLI: default output = Layer 1-2, `--verbose` for deeper layers |
| **PR 2.1** | Rename to "Vibe Coding Index™", make it a first-class exported metric |
| **PR 2.4** | Dashboard: static vs AI finding labels, benchmark comparison |
| **PR 3.1** | "Software 2.0 Compatibility Score" in impact prediction |
| **PR 4.1** | Progressive disclosure for education audits (Student Layer 1-4) |

---

## Verified Model Assignments

| PR | Recommended Model | Rationale |
|----|------------------|-----------|
| PR 1.1 (scaffold) | Default (fast) | Boilerplate, rule types, interfaces |
| PR 1.2 (generator) | Strongest | AGENTS.md quality is brand-defining; template design needs reasoning |
| PR 1.3 (compliance) | Strongest | Compliance logic is correctness-sensitive |
| PR 1.4 (CLI) | Default | Standard CLI patterns |
| PR 2.1 (contamination) | Strongest | Scoring model design is product-defining |
| PR 2.2 (tracking) | Default | CRUD API, storage patterns |
| PR 4.1 (education) | Strongest | Education UX needs careful design |

## Rollback Protocol

Each PR creates an atomic commit that can be reverted:
```
git revert <sha>             # Clean revert of the entire PR
pnpm install                 # Restore lockfile
pnpm test                    # Verify clean state
```

Ready to begin PR 1.1 when given the go.
