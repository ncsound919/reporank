# RepoRank 12-Week Acquisition Readiness Roadmap

**Target:** Transform RepoRank from "solid MVP" to "enterprise-grade acquisition candidate"

---

## Phase 1: Frontend Dashboards (Weeks 1–3)

**Goal:** Make RepoRank's data *visible* and *actionable*. Dashboards are the difference between "API that works" and "product that sells."

### 1.1 Organization Dashboard

**New Page:** `apps/web/src/pages/OrgDashboard.tsx`

**Features:**
- List all repos in org with health scores
- Color-coded health status (A+ green → F red)
- Trend arrow (↑ improving, ↓ degrading, → stable)
- Sort by: Score, Trend, Drift Status, Last Scanned
- Filter by: Build source, Maturity level, Drift status

**Data Model:**
```typescript
interface OrgRepoSummary {
  repoId: string;
  repoName: string;
  buildSource: string;
  latestScore: number;
  latestGrade: string;
  scoreChange: number; // vs. prev scan
  trend: "improving" | "degrading" | "stable";
  driftStatus: "on-scope" | "at-risk" | "drifting" | "blocked";
  lastScannedAt: DateTime;
  securityRiskLevel: "critical" | "high" | "medium" | "low";
}
```

**API Endpoint to Create:**
```typescript
// GET /api/v1/orgs/:orgId/repos/summary
// Returns: { repos: OrgRepoSummary[]; trendline: { date, avgScore }[] }
```

**UI Components:**
- RepoCard: Score, grade, trend, actions (scan, view details, configure)
- HealthHeatmap: Grid of repos × time, showing score evolution
- RiskMatrix: X=complexity, Y=security, bubble=repo (bubble size = churn)

---

### 1.2 Repo Health Trendline

**Enhance:** `apps/web/src/pages/ScanDetailPage.tsx`

**New Sections:**
- **Health Over Time:** Line chart (last 10 scans) showing overall score
- **Dimension Breakdown:** 8 lines (security, quality, vibe, etc.)
- **Milestone Markers:** Vertical lines marking milestone approvals
- **Drift Trendline:** Separate chart showing drift status over time

**Data Model:**
```typescript
interface ScanTimeseries {
  scans: Array<{
    scanId: string;
    scannedAt: DateTime;
    overallScore: number;
    dimensionScores: Record<string, number>;
    driftStatus: DriftStatus;
    gradeCategory: string;
  }>;
}
```

**API Endpoint:**
```typescript
// GET /api/v1/scans/:repoId/timeseries?limit=50
// Returns: { scans: ScanTimeseries[] }
```

---

### 1.3 Scope Compliance Tracker

**New Page:** `apps/web/src/pages/ScopeTrackerPage.tsx`

**Features:**
- **Planned vs. Implemented:** Pie chart (% deliverables with code evidence)
- **Missing Planned:** List of deliverables not yet evidenced
- **Unplanned Features:** List of feature areas detected but not in scope
- **Intent Gaps:** Promised features from brief that have no proof
- **Drift Timeline:** How compliance has changed across milestones

**Data Model:**
```typescript
interface ScopeSnapshot {
  briefId: string;
  scanId: string;
  timestamp: DateTime;
  plannedCount: number;
  implementedCount: number;
  unplannedCount: number;
  uncertainCount: number;
  driftCategories: DriftCategory[];
  missingItems: string[];
  outOfScopeItems: string[];
}
```

**API Endpoint:**
```typescript
// GET /api/v1/projects/:projectId/scope-compliance
// Returns: { current: ScopeSnapshot, timeline: ScopeSnapshot[] }
```

---

### 1.4 Risk Hotspots Dashboard

**New Page:** `apps/web/src/pages/RiskHotspotsPage.tsx`

**Features:**
- **Top 10 Risks:** Repos sorted by risk score (combination of security + drift + vibe)
- **Risk Breakdown:** 
  - Security (secrets found, vulns, failed gates)
  - Scope (drifting status, missing planned)
  - Code (complexity, hotspots, low test coverage)
  - AI (high contamination score)
- **Drill-down:** Click repo → see details

---

### 1.5 Database & API Scaffolding

**New Routes in `apps/api/src/routes/`:**

1. **orgDashboard.ts**
   ```typescript
   // GET /api/v1/orgs/:orgId/summary
   // Returns: { repos: OrgRepoSummary[]; org: OrgSnapshot }
   
   // GET /api/v1/orgs/:orgId/repos/stats
   // Returns: { byDrift: { on-scope, at-risk, drifting }; byScore: { a, b, c, d, f } }
   
   // GET /api/v1/orgs/:orgId/health-trendline
   // Returns: { date, avgScore, medianScore, countByGrade }[]
   ```

2. **repoTimeseries.ts**
   ```typescript
   // GET /api/v1/repos/:repoId/timeseries
   // Returns: { scans: ScanTimeseries[] }
   ```

3. **scopeCompliance.ts**
   ```typescript
   // GET /api/v1/projects/:projectId/scope-compliance
   // Returns: { current, timeline, compliance% }
   ```

**Prisma Query Optimizations:**
- Add indexes: `Scan(orgId, createdAt)`, `Scan(projectBriefId, createdAt)`
- Create materialized view for org-level aggregations (optional but recommended)

---

## Phase 2: GitHub Integration (Weeks 4–6)

### 2.1 Webhook Receiver

**New File:** `apps/api/src/services/githubWebhook.ts`

**Events to Handle:**
- `push` → trigger scan for repo
- `pull_request` → compute impact, post comment if score < threshold

**Implementation:**
```typescript
export async function handlePushEvent(payload: PushEvent) {
  const { repository, ref, head_commit } = payload;
  // 1. Find or create repo in DB
  // 2. Queue scan job with branch=ref
  // 3. Return 202 Accepted
}

export async function handlePullRequestEvent(payload: PullRequestEvent) {
  const { action, pull_request, repository } = payload;
  if (action === "opened" || action === "synchronize") {
    // 1. Compute impact (base vs. head)
    // 2. Score head commit
    // 3. If score < threshold, post comment
    // 4. If scope brief exists, check drift in PR
  }
}
```

**Route:** `apps/api/src/routes/webhooks.ts`
```typescript
router.post("/github", async (req, res) => {
  const signature = req.headers["x-hub-signature-256"];
  // Verify signature
  const event = req.headers["x-github-event"];
  if (event === "push") await handlePushEvent(req.body);
  if (event === "pull_request") await handlePullRequestEvent(req.body);
  res.json({ received: true });
});
```

---

### 2.2 PR Comment + Status Check

**Enhance:** `apps/api/src/services/prCommenter.ts`

**New Functionality:**
- ✅ Already posts comments (keep as is)
- ✨ **Add status check:**
  ```typescript
  // POST /repos/{owner}/{repo}/statuses/{sha}
  const status = score >= 80 ? "success" : "failure";
  const context = "reporank/health";
  // Blocks PR merge if score < 80 (configurable)
  ```

- ✨ **Make comments lighter:**
  - Instead of huge comment, post 1-liner + link to full report
  - Format: "📊 RepoRank: **B** (78/100) · [View Report](reporank-url)"

---

### 2.3 GitHub App Registration

**Manual step (docs):**
- Create GitHub App (Permissions: checks, contents, pull_requests)
- Register webhook URL: `https://reporank.app/webhooks/github`
- Users: Install app in their orgs

**Frontend:** Add "Connect GitHub" button that redirects to auth flow

---

### 2.4 Comparison Feature UI

**New Page:** `apps/web/src/pages/CompareScan.tsx`

**Already have API** (`/compare/:id1/:id2`), now expose it:
- Side-by-side score cards
- Dimension delta (what improved/degraded)
- File-level changes (new issues, resolved issues)
- Drift delta (scope compliance change)

---

## Phase 3: Published Benchmarks (Weeks 7–8)

### 3.1 Seeded Bug Suite

**Create:** `scripts/benchmark-suite.ts`

**Approach:**
1. Find 50–100 public GitHub repos with known CVEs, issues, or intentional bugs
2. For each repo:
   - Clone it
   - Run RepoRank scan
   - Record findings (security, quality, invisible bugs)
   - Compare vs. expected issues (from CVE DB, GitHub issues marked "bug")

3. Compute:
   - Detection rate (% of known issues found)
   - False positive rate (findings we report that aren't real)
   - Detection rate by category (security, quality, architecture)

**Output:** HTML report + CSV for publishing

**File Structure:**
```
scripts/
  benchmark-suite.ts (orchestrator)
  seeded-repos.json (list of test repos + known issues)
  benchmark-report.ts (HTML generator)
```

---

### 3.2 Publish Results

**New docs page:** `docs/BENCHMARKS.md`

**Content:**
- RepoRank vs. Sonar (detection rates)
- RepoRank vs. DeepCode (accuracy)
- RepoRank advantage: scope + vibe (unique)
- False positive rates
- Supported languages

**Marketing:** Publish to website, link from README, mention in docs

---

## Phase 4: AI-Builder Specialization (Weeks 9–10)

### 4.1 Builder-Specific Quality Gates

**New File:** `apps/api/src/services/builderGates.ts`

```typescript
export function getQualityGatesByBuilder(buildSource: string): GateDefinition[] {
  if (buildSource === "bolt") {
    return [
      { type: "code-present", criterion: "API endpoints defined" },
      { type: "code-present", criterion: "Database schema or ORM configured" },
      { type: "code-present", criterion: "Authentication" },
      { type: "code-present", criterion: "No hardcoded API endpoints" }, // ← Bolt-specific
      { type: "deployment", criterion: "Docker or hosting config present" },
    ];
  }
  if (buildSource === "lovable") {
    return [
      { type: "code-present", criterion: "React components" },
      { type: "code-present", criterion: "Standard export patterns" }, // ← Lovable-specific
      { type: "portability", criterion: "No vendor lock-in (no Lovable SDK)" },
      { type: "deployment", criterion: "Can run standalone" },
    ];
  }
  // Default GitHub gates
  return defaultGates;
}
```

### 4.2 Builder-Specific Validation

**New File:** `apps/api/src/services/builderValidator.ts`

```typescript
export interface BuilderValidation {
  isValid: boolean;
  warnings: string[];
  recommendations: string[];
}

export function validateBuilderRepo(
  buildSource: string,
  sourceFiles: SourceFile[],
  report: HealthReport
): BuilderValidation {
  if (buildSource === "bolt") {
    return validateBoltRepo(sourceFiles, report);
  }
  if (buildSource === "lovable") {
    return validateLovableRepo(sourceFiles, report);
  }
  return { isValid: true, warnings: [], recommendations: [] };
}

function validateBoltRepo(files: SourceFile[], report: HealthReport): BuilderValidation {
  const warnings: string[] = [];
  
  // Check for hardcoded endpoints
  const endpointMatches = files.filter(f =>
    /https?:\/\/localhost|127\.0\.0\.1|example\.com/.test(f.content)
  );
  if (endpointMatches.length > 0) {
    warnings.push(`Found ${endpointMatches.length} hardcoded URLs (Bolt apps should use env vars)`);
  }
  
  // Check for portability (no proprietary SDKs)
  const proprietary = files.filter(f => /@bolt|@lovable|@v0/.test(f.content));
  if (proprietary.length > 0) {
    warnings.push("Detected proprietary builder imports — app is locked to this platform");
  }
  
  return {
    isValid: warnings.length === 0,
    warnings,
    recommendations: [
      "Externalize all API endpoints to .env.example",
      "Use standard patterns (Express, React, etc.) instead of builder SDKs",
      "Test export → works standalone (not locked to platform)",
    ],
  };
}
```

---

## Phase 5: Enterprise Hardening (Weeks 11–12)

### 5.1 VPC/On-Prem Deployment Guide

**New:** `docs/ENTERPRISE_DEPLOYMENT.md`

**Sections:**
- Docker Compose setup for on-prem
- Environment variables for PostgreSQL, Redis (external hosts)
- Network isolation (no outbound calls to RepoRank SaaS)
- Audit logging (who ran scans, when, on what)
- Data retention policies (how long to keep scans)

---

### 5.2 Organization Role-Based Access Control

**Enhance:** `apps/api/src/middleware/auth.ts`

**New Roles:**
- `org:admin` — manage members, settings, billing
- `org:lead` — approve briefs, gate decisions
- `org:member` — run scans, view reports
- `org:viewer` — read-only access

**Prisma Model Enhancement:**
```prisma
model OrgMember {
  // ... existing ...
  role String @default("member") // admin | lead | member | viewer
}
```

**Middleware:**
```typescript
export async function requireOrgRole(requiredRole: string) {
  return async (req: AuthRequest, res, next) => {
    const member = await prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: req.orgId!, userId: req.userId! } }
    });
    if (!member || !hasRole(member.role, requiredRole)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}
```

---

### 5.3 Audit Logging

**New File:** `apps/api/src/services/auditLog.ts`

```typescript
export async function logAuditEvent(
  orgId: string,
  userId: string,
  action: string,
  resourceId: string,
  details: any
) {
  await prisma.auditLog.create({
    data: { orgId, userId, action, resourceId, details, timestamp: new Date() }
  });
}

// Trigger on:
// - Scan started/completed
// - Brief approved/rejected
// - Scope change requested/approved
// - User added/removed from org
```

**Prisma Model:**
```prisma
model AuditLog {
  id String @id @default(cuid())
  orgId String
  userId String
  action String // "scan_started", "brief_approved", etc.
  resourceId String
  details Json?
  timestamp DateTime @default(now())
  @@index([orgId, timestamp])
}
```

---

## Metrics & Success Criteria

### End of Week 3 (Dashboards)
- ✅ Org dashboard showing 50+ repos with health scores
- ✅ Health trendline with 10-scan history
- ✅ Scope compliance tracker updated per scan
- ✅ No new bugs introduced (tests passing)

### End of Week 6 (GitHub)
- ✅ Webhooks auto-trigger scans
- ✅ PR status checks block low-quality PRs
- ✅ Installed on 5+ test repos
- ✅ Comment format is lightweight (1-liner + link)

### End of Week 8 (Benchmarks)
- ✅ Benchmark suite runs on 50 repos
- ✅ Published detection rates (e.g., "86% of known vulns found")
- ✅ Comparison vs. competitors documented
- ✅ White paper ready for marketing

### End of Week 10 (Builders)
- ✅ Bolt-specific gates enforced for Bolt projects
- ✅ Lovable portability checks in place
- ✅ Builder validator API documented
- ✅ No regressions in existing scans

### End of Week 12 (Enterprise)
- ✅ VPC deployment guide published
- ✅ RBAC roles enforced in API
- ✅ Audit logging captures all actions
- ✅ On-prem database support tested

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Dashboards get complex | Use existing libraries (Recharts for charts, TanStack for tables) |
| GitHub webhooks unreliable | Add retry logic, dead-letter queue for failed events |
| Benchmark suite takes too long | Cache clones, run in parallel, use 20 repos initially |
| Builder rules become too specific | Keep rule list short (5–10 per builder), evolve based on user feedback |
| Enterprise features add scope creep | Prioritize RBAC + VPC docs first; audit logging is optional for MVP |

---

## End State

**After 12 weeks, RepoRank will be:**

✅ **Visibly valuable** (dashboards show the data)  
✅ **Workflow-embedded** (GitHub integration auto-triggers, blocks PRs)  
✅ **Credible** (published benchmarks prove accuracy)  
✅ **Builder-aware** (Bolt/Lovable-specific validation)  
✅ **Enterprise-ready** (RBAC, audit logging, on-prem path)  

**Pitch to acquirers:**
> "RepoRank owns scope-aware repo health—a niche that Sonar, DeepCode, and CodeScene don't cover. We've proven it with dashboards, GitHub integration, published benchmarks, and builder specialization. We're enterprise-ready (RBAC, audit logging, on-prem). We're ready to integrate into your platform or be acquired as a standalone SaaS."
