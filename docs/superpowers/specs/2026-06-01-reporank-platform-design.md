# RepoRank — Unified SaaS Platform Design

> **Vision:** "Google Analytics for your codebase" — a platform that grades repos, detects security issues, measures code vibe, and generates actionable fix packs.

---

## 1. Architecture Overview

### Monorepo Structure (Turborepo + pnpm)

```
RepoRank/
├── apps/
│   ├── api/                          # Express API gateway (auth, billing, scans, webhooks)
│   │   ├── src/
│   │   │   ├── routes/               # auth, scans, billing, orgs, claw, webhooks
│   │   │   ├── middleware/           # auth, rate-limit, tenant, csrf
│   │   │   ├── services/            # gradingService, compliance, notifications
│   │   │   └── db/                  # Prisma schema + migrations
│   │   └── package.json
│   ├── web/                          # React 19 SPA dashboard (Vite)
│   │   ├── src/
│   │   │   ├── components/          # ScoreGauge, SecuritySection, VibeBreakdown, FixPack, Roadmap
│   │   │   ├── features/           # auth, dashboard, teams, settings
│   │   │   ├── lib/                # firebase, api client
│   │   │   └── contexts/           # AuthContext, ThemeContext
│   │   └── package.json
│   └── agent-sdk/                   # Claw Protect agent SDK (standalone npm package)
│       ├── src/
│       │   ├── modules/            # promptInjection, secretsScanner, dataExfiltration, etc.
│       │   └── index.ts            # ClawProtect class (exported)
│       └── package.json
├── packages/
│   ├── grading-engine/              # Core scoring logic (Node.js CLI + library)
│   │   ├── src/
│   │   │   ├── scanners/           # Wrappers for SonarQube, Semgrep, Trivy, Hadolint, etc.
│   │   │   ├── compliance/         # ISO 5055 deterministic scans (from Grader)
│   │   │   ├── vibe/               # Vibe scoring (naming, modernity, hygiene)
│   │   │   ├── prompt/            # Gemini prompt builder + response parser
│   │   │   └── index.ts           # GradeRepo() entry point
│   │   └── package.json
│   ├── vibe-analyzer/               # Vibe scoring subsystem
│   │   ├── src/
│   │   │   ├── namingAnalyzer.ts   # Naming convention detection
│   │   │   ├── modernityScorer.ts  # Async/await, hooks, ES6+ detection
│   │   │   ├── hygieneChecker.ts   # Dead code, duplication, commented code
│   │   │   ├── configCoherence.ts  # Lint config, dep consistency
│   │   │   └── index.ts
│   │   └── package.json
│   ├── claw-protect-core/           # Security modules (shared between API + SDK)
│   │   ├── src/
│   │   │   ├── promptInjection/
│   │   │   ├── secretsScanner/
│   │   │   ├── supplyChain/
│   │   │   ├── permissionAnalyzer/
│   │   │   ├── dataExfiltration/
│   │   │   ├── zeroTrust/
│   │   │   ├── ransomware/
│   │   │   ├── compliance/
│   │   │   └── index.ts
│   │   └── package.json
│   ├── fix-pack-generator/          # Auto-generated patches from analysis findings
│   │   ├── src/
│   │   │   ├── patchBuilder.ts     # Maps findings → file patches
│   │   │   ├── roadmapBuilder.ts   # Now/Next/Later prioritization
│   │   │   └── index.ts
│   │   └── package.json
│   └── shared-types/                # TypeScript interfaces shared across all packages
│       ├── src/
│       │   ├── health-report.ts     # HealthReport, SecurityScan, VibeScore, etc.
│       │   ├── api.ts              # Request/response types
│       │   └── index.ts
│       └── package.json
├── services/
│   ├── scanner-worker/              # Background repo cloning + analysis workers
│   │   ├── src/
│   │   │   ├── clone.ts            # Git clone + snapshot
│   │   │   ├── runner.ts           # Runs all scanners in parallel
│   │   │   └── index.ts
│   │   └── package.json
│   └── webhook-dispatcher/          # Slack/Discord/PagerDuty dispatch (from Claw)
│       ├── src/
│       │   ├── slack.ts
│       │   ├── discord.ts
│       │   ├── pagerduty.ts
│       │   └── index.ts
│       └── package.json
├── infra/
│   ├── docker-compose.yml           # PostgreSQL, Redis, API, web
│   ├── Dockerfile.api
│   ├── Dockerfile.web
│   └── terraform/                   # Production cloud provisioning
├── package.json                     # Root workspace config (pnpm workspaces)
├── pnpm-workspace.yaml
├── turbo.json                       # Turborepo pipeline
├── tsconfig.json                    # Root TS config (references)
└── .env.example
```

### Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Monorepo** | Turborepo + pnpm | Industry standard for JS monorepos; remote caching |
| **Frontend** | React 19 + TypeScript + Vite + Tailwind 4 + Motion | Proven in all 3 existing projects |
| **Backend** | Express 4 + TypeScript | Proven, matches existing code |
| **ORM** | Prisma | Mature migrations, multi-tenant patterns |
| **Database** | PostgreSQL | From Grader's existing schema |
| **Auth** | Firebase Auth (Google Sign-In) + GitHub OAuth + JWT + API keys | Merged from Vibe Reality + Grader |
| **Billing** | Stripe Checkout + Customer Portal + Webhooks | From Grader |
| **AI** | Gemini 2.5 Flash (`@google/genai`) | Proven across all 3 projects |
| **Cache/Queue** | Redis (Bull for job queue) | Scan job queue + rate limiting |
| **Deployment** | Docker + Railway / Vercel | From existing projects |

---

## 2. Scoring Model

### Dimensions & Weights

| Dimension | Weight | Data Source | Tool Integration |
|---|---|---|---|
| Security Posture | 25% | Semgrep + Trivy + TruffleHog + GitHub API | Run as CLI tools, parse SARIF/JSON output |
| Code Quality | 20% | SonarQube CE (technical debt ratio, bugs, smells) | SonarQube REST API (`/api/measures/component`) |
| Vibe Score | 15% | Vibe Analyzer (naming, modernity, hygiene, config, deps) | Custom regex + AST + LLM analysis |
| Architecture | 15% | SonarQube + Codebase Memory MCP | SonarQube complexity metrics + MCP knowledge graph |
| Deployment Readiness | 10% | Hadolint (Dockerfile) + CI detection + env config check | Hadolint CLI + custom checks |
| Documentation | 5% | README scoring (length, sections, badges, install) | Custom heuristics |
| OSS License / Legal | 5% | License detection + copyleft check | SPDX license detection |
| Market Vitality | 5% | GitHub API (stars, forks, issues, commits) | GitHub REST API |

### Scoring Formula

```
overallScore = weighted average of 8 dimensions
gradeCategory = map(overallScore):
  95+ → A+    90-94 → A    85-89 → B+    80-84 → B
  70-79 → C   60-69 → D    <60 → F
maturityLevel = map(overallScore):
  0-30 → Prototype    31-55 → MVP    56-75 → Beta
  76-90 → Production  91-100 → Enterprise
```

### Vibe Score Sub-Components

| Category | Weight | Method |
|---|---|---|
| Naming & Structure | 25% | Regex scan for naming conventions (snake_case, camelCase, kebab-case); folder depth distribution |
| Modern Practices | 25% | Detect async/await vs callbacks, hooks vs classes, TypeScript usage, modern ES syntax |
| Code Hygiene | 20% | jscpd (duplication), commented-out code detection, dead code (via Codebase Memory MCP), import hygiene |
| Config Coherence | 15% | Single lint config, consistent dep manager, .env.example presence, no conflicting tools |
| Dependency Freshness | 15% | npm outdated / Trivy scan for outdated + deprecated packages |

---

## 3. Grading Pipeline

```
User submits repo URL
        │
        ▼
┌─────────────────────────────┐
│ 1. Ingestion                 │
│    • POST /api/v1/scans      │
│    • Creates scan job (Redis)│
│    • Returns scanId          │
└──────────┬──────────────────┘
           │ (background worker)
           ▼
┌─────────────────────────────┐
│ 2. Repo Cloning + Snapshot   │
│    • git clone --depth 1     │
│    • Extract: README,        │
│      package.json, file tree,│
│      top source files, deps  │
└──────────┬──────────────────┘
           ▼
┌─────────────────────────────┐
│ 3. Parallel Scanner Run      │
│    (runs simultaneously)     │
│                              │
│  ┌───────────────────────┐  │
│  │ • SonarQube scanner   │  │  ← Quality + Architecture metrics
│  │ • Semgrep SAST        │  │  ← Security vulnerabilities
│  │ • Trivy dependency    │  │  ← CVE scan
│  │ • TruffleHog secrets  │  │  ← Secret detection
│  │ • Hadolint (Docker)   │  │  ← Dockerfile validation
│  │ • jscpd duplication   │  │  ← Code duplication %
│  │ • Vibe Analyzer       │  │  ← Naming, modernity, hygiene
│  │ • GitHub metadata     │  │  ← Stars, forks, license, activity
│  └───────────────────────┘  │
└──────────┬──────────────────┘
           ▼
┌─────────────────────────────┐
│ 4. AI Grading (Gemini)       │
│    • Build structured prompt │
│      with all scan results   │
│    • responseSchema for JSON │
│    • Parse + validate via Zod│
│                              │
│    Output: HealthReport {    │
│      overallScore,           │
│      gradeCategory,          │
│      maturityLevel,          │
│      dimensionScores: {...}, │
│      vibescore,              │
│      security: {...},        │
│      quality: {...},         │
│      architecture: {...},    │
│      hallucinatedFeatures,   │
│      bugsAndLeaks,           │
│      structuralSmells,       │
│      quickWins: [...],       │
│      roadmap: [...],         │
│      implementationPlan: ... │
│    }                         │
└──────────┬──────────────────┘
           ▼
┌─────────────────────────────┐
│ 5. Post-Processing           │
│    • ISO 5055 compliance     │
│      (deterministic, no AI)  │
│    • Fix Pack generation     │
│      (map findings → patches)│
│    • Badge URL generation    │
│    • Store in PostgreSQL     │
│    • Trigger webhooks        │
└──────────┬──────────────────┘
           ▼
          Done!
```

---

## 4. Tool Integration Map

Each scanner runs as a separate process (CLI or Docker) and outputs structured data that feeds into the grading pipeline.

| Scanner | How to Run | Parse Output | License |
|---|---|---|---|
| **SonarQube** | `sonar-scanner` CLI or Docker | REST API `/api/measures/component` → JSON | LGPL-3.0 |
| **Semgrep** | `semgrep scan --sarif` | SARIF JSON → finding objects | LGPL-2.1 |
| **Trivy** | `trivy filesystem --format json` | JSON → vulnerability list | Apache-2.0 |
| **TruffleHog** | `trufflehog filesystem --json` | JSON → secret findings | AGPL-3.0 |
| **Hadolint** | `hadolint Dockerfile --format json` | JSON → violation list | GPL-3.0 |
| **jscpd** | `jscpd --output-format json` | JSON → duplication % | MIT |
| **GitHub API** | `GET /repos/{owner}/{repo}` | JSON → metadata | Free API |
| **Vibe Analyzer** | Custom Node.js package | JSON → vibe sub-scores | Custom |

### AI Prompt Construction

The Gemini prompt is built by merging scan results:

```
System: "You are an expert codebase auditor grading a repository."

Context:
- Repo metadata (name, stars, language, last push)
- README summary (truncated to 10K chars)
- package.json (truncated to 5K chars)
- File tree (up to 100 files)
- Security findings: [Semgrep JSON, Trivy JSON, TruffleHog JSON]
- Quality metrics: [SonarQube metrics]
- Duplication: [jscpd %]
- Docker: [Hadolint violations]
- Vibe analysis: [vibe sub-scores]

Task: Return a JSON object matching this schema:
{
  overallScore: number,
  dimensionScores: { security, quality, vibe, architecture, deployment, documentation, license, market },
  security: { vulnerabilityCount, highestSeverity, vulnerabilities: [...] },
  quality: { readmeScore, testFramework, codeSmells, duplicationPercent },
  vibe: { namingScore, modernityScore, hygieneScore, configCoherence, depFreshness, recommendations: [...] },
  architecture: { couplingScore, circularImports, complexity },
  deployment: { dockerScore, hasCI, hasEnvExample, loggingExists },
  documentation: { readmeCompleteness, hasAPIDocs, hasArchDiagram },
  hallucinatedFeatures: [...],
  bugsAndLeaks: [...],
  structuralSmells: [...],
  quickWins: [{ title, severity, category, effort, action }],
  roadmap: [{ phase, priority, task, effort }],
  implementationPlan: [{ title, description, targetFiles, promptInstruction }],
  summary: string
}
```

---

## 5. Database Schema (Prisma)

```prisma
model User {
  id              String   @id @default(cuid())
  email           String   @unique
  displayName     String?
  firebaseUid     String?  @unique
  githubId        String?  @unique
  avatarUrl       String?
  tier            String   @default("free") // free | pro | enterprise
  scansThisMonth  Int      @default(0)
  stripeCustomerId String?
  createdAt       DateTime @default(now())

  orgs            OrgMember[]
  apiKeys         ApiKey[]
  scans           Scan[]
}

model Org {
  id              String   @id @default(cuid())
  name            String
  slug            String   @unique
  plan            String   @default("free") // free | pro | enterprise
  stripeSubscriptionId String?
  stripePriceId   String?
  scanLimit       Int      @default(3)
  scansThisPeriod Int      @default(0)
  periodStart     DateTime?
  periodEnd       DateTime?
  createdAt       DateTime @default(now())

  members         OrgMember[]
  scans           Scan[]
  clawAgents      ClawAgent[]
  clawAlerts      ClawAlert[]
}

model OrgMember {
  id      String @id @default(cuid())
  role    String @default("member") // owner | admin | member | viewer
  joinedAt DateTime @default(now())

  org    Org    @relation(fields: [orgId], references: [id])
  orgId  String
  user   User   @relation(fields: [userId], references: [id])
  userId String

  @@unique([orgId, userId])
}

model Scan {
  id              String   @id @default(cuid())
  repoUrl         String
  repoName        String
  repoOwner       String
  branch          String   @default("main")
  status          String   @default("pending") // pending | cloning | scanning | grading | complete | error
  overallScore    Int?
  gradeCategory   String?
  maturityLevel   String?
  vibeScore       Int?
  report          Json?    // Full HealthReport
  complianceReport Json?   // ISO 5055
  fixPack         Json?    // Fix Pack patches
  errorMessage    String?
  duration        Int?     // seconds
  createdAt       DateTime @default(now())
  completedAt     DateTime?

  user User @relation(fields: [userId], references: [id])
  userId String
  org  Org?  @relation(fields: [orgId], references: [id])
  orgId String?

  @@index([orgId])
  @@index([userId])
  @@index([repoUrl])
}

model ApiKey {
  id        String   @id @default(cuid())
  keyPrefix String   // first 8 chars of key for identification
  keyHash   String   // SHA-256 hash of full key
  name      String
  tier      String   @default("free")
  lastUsedAt DateTime?
  createdAt DateTime @default(now())

  user   User   @relation(fields: [userId], references: [id])
  userId String

  @@unique([keyHash])
}

model ClawAgent {
  id        String   @id @default(cuid())
  name      String
  type      String   // openclaw | hermes | custom
  config    Json?
  trustScore Int     @default(100)
  status    String   @default("active")
  createdAt DateTime @default(now())

  org    Org    @relation(fields: [orgId], references: [id])
  orgId  String
  alerts ClawAlert[]
}

model ClawAlert {
  id          String   @id @default(cuid())
  module      String   // prompt-injection | secrets | supply-chain | etc.
  severity    String   // critical | high | medium | low
  title       String
  description String
  raw         Json?
  acknowledged Boolean @default(false)
  createdAt   DateTime @default(now())

  org     Org       @relation(fields: [orgId], references: [id])
  orgId   String
  agent   ClawAgent? @relation(fields: [agentId], references: [id])
  agentId String?

  @@index([orgId])
  @@index([severity])
}

model Subscription {
  id                   String   @id @default(cuid())
  stripeSubscriptionId String   @unique
  plan                 String
  status               String   // active | past_due | canceled | incomplete
  currentPeriodStart   DateTime?
  currentPeriodEnd     DateTime?
  createdAt            DateTime @default(now())

  org   Org    @relation(fields: [orgId], references: [id])
  orgId String
}

model Webhook {
  id        String   @id @default(cuid())
  url       String
  events    String[] // scan.completed, claw.alert, etc.
  secret    String   // HMAC signing secret
  active    Boolean  @default(true)
  createdAt DateTime @default(now())

  org   Org    @relation(fields: [orgId], references: [id])
  orgId String
}
```

---

## 6. Dashboard Component Map

| Component | Source Project | Modifications Needed |
|---|---|---|
| ScoreGauge | Grader → `src/components/ScoreGauge.tsx` | None — reusable as-is |
| ScoreBreakdown | Grader → `src/components/ScoreBreakdown.tsx` | Add Vibe dimension bar |
| SecuritySection | Grader + Claw → merge | Show Claw findings alongside Semgrep/Trivy |
| QualitySection | Grader → `src/components/QualitySection.tsx` | Integrate SonarQube metrics |
| VibeBreakdown | **New** (from Vibe Reality concepts) | Naming/modernity/hygiene bars with recommendations |
| MarketSection | Grader → `src/components/MarketSection.tsx` | None |
| ValuationCalculator | Grader → `src/components/ValuationCalculator.tsx` | None |
| BehavioralHotspots | Grader → `src/components/BehavioralHotspots.tsx` | None |
| ArchitecturalObservation | Grader → `src/components/ArchitecturalObservation.tsx` | Add Codebase Memory MCP data |
| OssLicenseAudit | Grader → `src/components/OssLicenseAudit.tsx` | None |
| IsoComplianceCert | Grader → `src/components/IsoComplianceCert.tsx` | None |
| GlobalBenchmarking | Grader → `src/components/GlobalBenchmarking.tsx` | None |
| QuickWinsList | Grader → `src/components/QuickWinsList.tsx` | Include Claw + vibe findings |
| RoadmapBoard | Grader → `src/components/RoadmapBoard.tsx` | Merge with Vibe Reality roadmap |
| AiCopilotDeck | Grader → `src/components/AiCopilotDeck.tsx` | Include Fix Pack integration |
| FixPackViewer | **New** | Display auto-generated patches with Apply buttons |
| ScanningProgress | Vibe Reality → `src/components/ScanningProgress.tsx` | None |
| TeamsAndUsage | Vibe Reality → `src/components/TeamsAndUsage.tsx` | Enhanced with org management |
| CoreControlDeck | Grader → `src/components/CoreControlDeck.tsx` | None |
| ClawDashboard | Claw Protect → `src/App.tsx` views | Standalone agent security dashboard |

---

## 7. API Endpoints

### Repo Grading

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/scans` | Submit repo for scanning (returns scanId) |
| `GET` | `/api/v1/scans/:id` | Poll scan status + get results |
| `GET` | `/api/v1/scans` | List scan history for org |
| `DELETE` | `/api/v1/scans/:id` | Delete scan |

### Auth & Users

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/auth/github` | GitHub OAuth callback |
| `POST` | `/api/v1/auth/firebase` | Firebase token exchange |
| `GET` | `/api/v1/auth/me` | Current user profile |
| `POST` | `/api/v1/api-keys` | Generate API key |
| `GET` | `/api/v1/api-keys` | List API keys |

### Organizations

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/orgs` | Create org |
| `GET` | `/api/v1/orgs` | List user's orgs |
| `GET` | `/api/v1/orgs/:id` | Org details |
| `POST` | `/api/v1/orgs/:id/members` | Invite member |
| `DELETE` | `/api/v1/orgs/:id/members/:userId` | Remove member |

### Billing

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/billing/checkout` | Create Stripe Checkout session |
| `POST` | `/api/v1/billing/portal` | Stripe Customer Portal link |
| `POST` | `/api/v1/billing/webhook` | Stripe webhook receiver |

### Claw Protect (Agent Security)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/claw/scan-prompt` | Scan prompt text for injections |
| `POST` | `/api/v1/claw/scan-secrets` | Scan content for secrets |
| `POST` | `/api/v1/claw/monitor-transfer` | Monitor data transfer |
| `GET` | `/api/v1/claw/agents` | List agents for org |
| `POST` | `/api/v1/claw/agents` | Register agent |
| `GET` | `/api/v1/claw/alerts` | Get alerts for org |

### Webhooks

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/webhooks` | Create webhook |
| `GET` | `/api/v1/webhooks` | List webhooks |
| `DELETE` | `/api/v1/webhooks/:id` | Delete webhook |

---

## 8. SaaS Pricing (merged from Grader)

| Feature | Free | Pro ($29/mo) | Enterprise ($299/mo) |
|---|---|---|---|
| Scans per month | 3 | 150 | Unlimited |
| Scoring dimensions | 6 (no market, valuation) | Full 8-dim + vibe | Full + custom |
| Fix Packs | Basic | Full | Full + priority |
| Claw Protect modules | 2 (prompt-injection, secrets) | 13 modules | All 23 |
| ISO 5055 compliance | ❌ | ✅ | ✅ |
| Team members | 1 | 5 | Unlimited |
| API access | ❌ | ✅ (5 req/s) | ✅ (50 req/s) |
| Webhooks | ❌ | ✅ | ✅ |
| SSO | ❌ | ❌ | ✅ |
| Self-hosted option | ❌ | ❌ | ✅ |
| Support | Community | Email | Slack + dedicated |

---

## 9. External Tool Dependencies (Licensing)

| Tool | License | How We Use It |
|---|---|---|
| SonarQube CE | LGPL-3.0 | Run as Docker container; call REST API |
| Semgrep CE | LGPL-2.1 | Run as CLI or Docker; parse SARIF output |
| Trivy | Apache-2.0 | Run as CLI; parse JSON output |
| TruffleHog | AGPL-3.0 | Run as CLI; parse JSON output |
| Hadolint | GPL-3.0 | Run as Docker; parse JSON output |
| jscpd | MIT | Run as CLI; parse JSON output |
| Codebase Memory MCP | MIT | Run as MCP server; query knowledge graph |
| DeepEval | Apache-2.0 | Reference for G-Eval scoring methodology |
| Turborepo | MIT | Monorepo build system |
| Prisma | Apache-2.0 | ORM + migrations |
| Gemini API | Commercial | AI grading via `@google/genai` SDK |

All external CLIs run in isolated Docker containers or subprocesses — no copyleft license contamination of the RepoRank codebase.

---

## 10. Key Architecture Decisions

1. **Scanners as separate processes**: Every analysis tool runs as its own CLI/Docker process. Output is parsed from stdout/files. This avoids dependency hell and license contamination.

2. **AI for synthesis, determinism for compliance**: Gemini produces the nuanced scoring and natural language output. ISO 5055 compliance is purely deterministic (score-based rules) — no AI dependency for certification.

3. **Vibe score is hybrid**: Deterministic checks (naming conventions, file structure, dep freshness) feed into a Gemini sub-prompt for subjective scoring. This keeps the score reproducible while still benefiting from LLM judgment.

4. **Redis-backed job queue**: Each scan is a Bull job. Workers clone the repo, run scanners in parallel, grade, and persist results. This allows horizontal scaling of workers independently.

5. **Grader as architectural base**: Grader's PostgreSQL schema, Stripe integration, JWT auth, API key management, and multi-tenant org model are used as the foundation — the most mature backend of the three existing projects.

6. **Claw Protect as SDK + API**: The core security modules live in `packages/claw-protect-core/` and are imported by both the API (`apps/api`) and the standalone agent SDK (`apps/agent-sdk`). Single implementation, dual distribution.
