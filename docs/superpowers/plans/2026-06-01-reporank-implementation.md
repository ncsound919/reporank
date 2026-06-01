# RepoRank — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified SaaS platform that grades GitHub repos across 8 dimensions using existing OSS scanners + Gemini AI, with integrated Claw Protect security modules.

**Architecture:** Turborepo monorepo with `apps/` (Express API, React dashboard, agent SDK) and `packages/` (grading engine, vibe analyzer, claw-protect-core, fix-pack-generator, shared-types). Scanners run as CLI/Docker subprocesses. Grading orchestrated via Redis-backed Bull job queue with Gemini AI for synthesis.

**Tech Stack:** TypeScript, React 19, Express 4, Prisma + PostgreSQL, Redis (Bull), Gemini 2.5 Flash, Turborepo + pnpm, Docker.

---

## PHASE 1: Foundation & Core Grading (MVP)

### Task 1.1: Initialize Monorepo

**Files:**
- Create: `package.json` (root)
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json` (root)
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "reporank",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint",
    "test": "turbo test",
    "clean": "turbo clean",
    "format": "prettier --write \"**/*.{ts,tsx,json}\"",
    "db:generate": "pnpm --filter @reporank/api db:generate",
    "db:push": "pnpm --filter @reporank/api db:push",
    "db:migrate": "pnpm --filter @reporank/api db:migrate"
  },
  "devDependencies": {
    "turbo": "^2.5.0",
    "prettier": "^3.5.0",
    "typescript": "^5.8.0"
  },
  "engines": { "node": ">=22" },
  "packageManager": "pnpm@10.8.0"
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "services/*"
```

- [ ] **Step 3: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": {},
    "test": { "dependsOn": ["build"] },
    "db:generate": { "cache": false },
    "db:push": { "cache": false },
    "clean": { "cache": false }
  }
}
```

- [ ] **Step 4: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **Step 5: Create root tsconfig.json**

```json
{
  "files": [],
  "references": [
    { "path": "apps/api" },
    { "path": "apps/web" },
    { "path": "apps/agent-sdk" },
    { "path": "packages/shared-types" },
    { "path": "packages/grading-engine" },
    { "path": "packages/vibe-analyzer" },
    { "path": "packages/claw-protect-core" },
    { "path": "packages/fix-pack-generator" }
  ]
}
```

- [ ] **Step 6: Create .env.example**

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/reporank
REDIS_URL=redis://localhost:6379
FIREBASE_PROJECT_ID=your-project-id
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
JWT_SECRET=your-jwt-secret
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
SONARQUBE_URL=http://localhost:9000
SONARQUBE_TOKEN=your-sonar-token
PORT=3001
APP_URL=http://localhost:5173
NODE_ENV=development
```

- [ ] **Step 7: Create .gitignore**

```
node_modules/
dist/
.turbo/
.env
*.log
.DS_Store
coverage/
.temp/
```

- [ ] **Step 8: Install and verify**

```bash
pnpm install
pnpm build
```
Expected: Workspace installs with no errors.

- [ ] **Step 9: Commit**

```bash
git init
git add -A
git commit -m "feat: initialize monorepo with Turborepo + pnpm"
```

---

### Task 1.2: Create Shared Types Package

**Files:**
- Create: `packages/shared-types/package.json`
- Create: `packages/shared-types/tsconfig.json`
- Create: `packages/shared-types/src/index.ts`
- Create: `packages/shared-types/src/health-report.ts`
- Create: `packages/shared-types/src/scan-job.ts`
- Create: `packages/shared-types/src/api.ts`
- Create: `packages/shared-types/src/claw-types.ts`
- Create: `packages/shared-types/src/pricing.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@reporank/shared-types",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "lint": "tsc --noEmit"
  },
  "devDependencies": { "typescript": "^5.8.0" }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Create health-report.ts**

```typescript
export interface HealthReport {
  repoOwner: string;
  repoName: string;
  overallScore: number;
  gradeCategory: GradeCategory;
  maturityLevel: MaturityLevel;
  mainLanguage: string;
  starsCount: number;
  forksCount: number;
  openIssuesCount: number;
  lastPushedAt: string;
  summary: string;
  dimensionScores: DimensionScores;
  security: SecurityScan;
  quality: QualityScorecard;
  vibe: VibeScore;
  architecture: ArchitectureMetrics;
  deployment: DeploymentReadiness;
  documentation: DocumentationScore;
  license: LicenseAudit;
  market: MarketSnapshot;
  valuation: ValuationMetrics;
  hallucinatedFeatures: string[];
  bugsAndLeaks: string[];
  structuralSmells: string[];
  quickWins: QuickWin[];
  roadmap: RoadmapItem[];
  implementationPlan: ImplementationStep[];
  globalBenchmarkPercent: number;
  scannedAt: string;
}

export type GradeCategory = "A+" | "A" | "B+" | "B" | "C" | "D" | "F";
export type MaturityLevel = "Prototype" | "MVP" | "Beta" | "Production" | "Enterprise";

export interface DimensionScores {
  security: number;
  quality: number;
  vibe: number;
  architecture: number;
  deployment: number;
  documentation: number;
  license: number;
  market: number;
}

export interface SecurityScan {
  secretsFound: number;
  secretsCritical: number;
  vulnerabilityCount: number;
  highestSeverity: "none" | "low" | "medium" | "high" | "critical";
  vulnerabilities: Vulnerability[];
  dependencyCves: number;
  hasSastScan: boolean;
  score: number;
}

export interface Vulnerability {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  packageName?: string;
  cveId?: string;
  recommendation: string;
}

export interface QualityScorecard {
  readmeScore: number;
  testFramework: string | null;
  testFileCount: number;
  codeSmells: number;
  duplicationPercent: number;
  hasLintConfig: boolean;
  hasCiConfig: boolean;
  score: number;
}

export interface VibeScore {
  overall: number;
  namingScore: number;
  modernityScore: number;
  hygieneScore: number;
  configCoherence: number;
  dependencyFreshness: number;
  recommendations: string[];
}

export interface ArchitectureMetrics {
  couplingScore: number;
  circularImportsCount: number;
  complexityRating: "low" | "medium" | "high" | "very-high";
  fileCount: number;
  avgFileLength: number;
  score: number;
}

export interface DeploymentReadiness {
  hasDockerfile: boolean;
  dockerfileScore: number;
  hasCIConfig: boolean;
  hasEnvExample: boolean;
  hasHealthcheck: boolean;
  hasLogging: boolean;
  loggingFramework: string | null;
  score: number;
}

export interface DocumentationScore {
  readmeCompleteness: number;
  hasSetupInstructions: boolean;
  hasApiDocs: boolean;
  hasArchitectureDiagram: boolean;
  hasContributingGuide: boolean;
  hasLicenseFile: boolean;
  score: number;
}

export interface LicenseAudit {
  licenseType: string | null;
  isCopyleft: boolean;
  licenseConflicts: string[];
  hasLicenseFile: boolean;
  score: number;
}

export interface MarketSnapshot {
  trendAlignment: "rising" | "steady" | "declining";
  percentileRank: number;
  competitorCount: number;
  recentActivity: "active" | "stale" | "inactive";
  score: number;
}

export interface ValuationMetrics {
  replacementCostFMV: number;
  reliefFromRoyaltyValue: number;
  productivityWasteHeuristic: number;
}

export interface QuickWin {
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  effort: "minutes" | "hours" | "days";
  description: string;
  action: string;
  filePath?: string;
}

export interface RoadmapItem {
  phase: "now" | "next" | "later";
  priority: number;
  category: string;
  task: string;
  effort: "hours" | "days" | "weeks";
}

export interface ImplementationStep {
  title: string;
  description: string;
  targetFiles: string[];
  promptInstruction: string;
}
```

- [ ] **Step 4: Create scan-job.ts**

```typescript
export type ScanStatus = "pending" | "queued" | "cloning" | "scanning" | "grading" | "complete" | "error";

export interface ScanJobRequest {
  repoUrl: string;
  branch?: string;
  deepScan?: boolean;
  webhookUrl?: string;
}

export interface ScanJobResponse {
  scanId: string;
  status: ScanStatus;
  estimatedDuration: number;
}

export interface ScanJobStatus {
  id: string;
  status: ScanStatus;
  progress: number;
  message: string;
  result?: import("./health-report").HealthReport;
  error?: string;
  createdAt: string;
  completedAt?: string;
  duration?: number;
}
```

- [ ] **Step 5: Create api.ts**

```typescript
export interface ApiResponse<T> { data: T; error?: string; }
export interface PaginatedResponse<T> { data: T[]; total: number; page: number; pageSize: number; }
export interface CreateApiKeyRequest { name: string; }
export interface CreateApiKeyResponse { key: string; keyPrefix: string; createdAt: string; }
export interface CreateOrgRequest { name: string; slug: string; }
export interface InviteMemberRequest { email: string; role: "admin" | "member" | "viewer"; }
export interface CreateWebhookRequest { url: string; events: string[]; }
```

- [ ] **Step 6: Create claw-types.ts**

```typescript
export interface ScanPromptRequest { content: string; isWebContent?: boolean; }
export interface ScanPromptResponse {
  isInjection: boolean; confidence: number; detectedPatterns: string[];
  sanitized: string | null; recommendation: string;
}
export interface ScanSecretsRequest { content: string; filename?: string; }
export interface SecretMatch { type: string; value: string; line: number; column: number; redacted: string; }
export interface ScanSecretsResponse { secretsFound: number; secrets: SecretMatch[]; recommendation: string; }
export interface ClawAgentRegistration { name: string; type: "openclaw" | "hermes" | "custom"; publicKey: string; }
```

- [ ] **Step 7: Create pricing.ts**

```typescript
export type PlanTier = "free" | "pro" | "enterprise";

export interface PlanLimits {
  scansPerMonth: number; teamMembers: number; clawModules: number;
  apiRateLimit: number; hasFixPacks: boolean; hasCompliance: boolean;
  hasSso: boolean; hasSelfHosted: boolean; hasWebhooks: boolean;
  supportLevel: "community" | "email" | "slack";
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: { scansPerMonth: 3, teamMembers: 1, clawModules: 2, apiRateLimit: 1,
    hasFixPacks: false, hasCompliance: false, hasSso: false, hasSelfHosted: false, hasWebhooks: false, supportLevel: "community" },
  pro: { scansPerMonth: 150, teamMembers: 5, clawModules: 13, apiRateLimit: 5,
    hasFixPacks: true, hasCompliance: true, hasSso: false, hasSelfHosted: false, hasWebhooks: true, supportLevel: "email" },
  enterprise: { scansPerMonth: -1, teamMembers: -1, clawModules: 23, apiRateLimit: 50,
    hasFixPacks: true, hasCompliance: true, hasSso: true, hasSelfHosted: true, hasWebhooks: true, supportLevel: "slack" },
};
```

- [ ] **Step 8: Create index.ts barrel**

```typescript
export * from "./health-report";
export * from "./scan-job";
export * from "./api";
export * from "./claw-types";
export * from "./pricing";
```

- [ ] **Step 9: Build and verify**

```bash
pnpm --filter @reporank/shared-types build
```
Expected: `dist/index.js` and `dist/index.d.ts` created.

- [ ] **Step 10: Commit**

```bash
git add packages/shared-types/
git commit -m "feat: add shared types package with all interfaces"
```

---

### Task 1.3: Database Schema + Prisma Setup

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/db/prisma/schema.prisma`
- Create: `apps/api/src/db/client.ts`
- Create: `apps/api/src/config.ts`

- [ ] **Step 1: Create apps/api/package.json**

```json
{
  "name": "@reporank/api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "db:generate": "prisma generate",
    "db:push": "prisma db push",
    "db:migrate": "prisma migrate dev",
    "db:studio": "prisma studio",
    "lint": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@prisma/client": "^6.5.0",
    "@reporank/shared-types": "workspace:*",
    "express": "^4.21.0",
    "cors": "^2.8.5",
    "helmet": "^8.0.0",
    "jsonwebtoken": "^9.0.2",
    "stripe": "^17.6.0",
    "bull": "^4.12.0",
    "ioredis": "^5.5.0",
    "zod": "^3.24.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/jsonwebtoken": "^9.0.0",
    "@types/cors": "^2.8.0",
    "prisma": "^6.5.0",
    "tsx": "^4.19.0",
    "typescript": "^5.8.0",
    "vitest": "^3.1.0"
  }
}
```

- [ ] **Step 2: Create apps/api/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "lib": ["ES2022"], "types": ["node"] },
  "include": ["src"],
  "references": [{ "path": "../../packages/shared-types" }]
}
```

- [ ] **Step 3: Create schema.prisma**

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model User {
  id              String    @id @default(cuid())
  email           String    @unique
  displayName     String?
  firebaseUid     String?   @unique
  githubId        String?   @unique
  avatarUrl       String?
  tier            String    @default("free")
  scansThisMonth  Int       @default(0)
  stripeCustomerId String?
  createdAt       DateTime  @default(now())
  orgs            OrgMember[]
  apiKeys         ApiKey[]
  scans           Scan[]
}

model Org {
  id              String    @id @default(cuid())
  name            String
  slug            String    @unique
  plan            String    @default("free")
  stripeSubscriptionId String?
  stripePriceId   String?
  scanLimit       Int       @default(3)
  scansThisPeriod Int       @default(0)
  periodStart     DateTime?
  periodEnd       DateTime?
  createdAt       DateTime  @default(now())
  members         OrgMember[]
  scans           Scan[]
  clawAgents      ClawAgent[]
  clawAlerts      ClawAlert[]
  subscriptions   Subscription[]
  webhooks        Webhook[]
}

model OrgMember {
  id       String   @id @default(cuid())
  role     String   @default("member")
  joinedAt DateTime @default(now())
  orgId    String
  org      Org      @relation(fields: [orgId], references: [id])
  userId   String
  user     User     @relation(fields: [userId], references: [id])
  @@unique([orgId, userId])
}

model Scan {
  id               String    @id @default(cuid())
  repoUrl          String
  repoName         String
  repoOwner        String
  branch           String    @default("main")
  status           String    @default("pending")
  progress         Int       @default(0)
  message          String?
  overallScore     Int?
  gradeCategory    String?
  maturityLevel    String?
  vibeScore        Int?
  report           Json?
  complianceReport Json?
  fixPack          Json?
  clawFindings     Json?
  errorMessage     String?
  duration         Int?
  createdAt        DateTime  @default(now())
  completedAt      DateTime?
  userId           String
  user             User      @relation(fields: [userId], references: [id])
  orgId            String?
  org              Org?      @relation(fields: [orgId], references: [id])
  @@index([orgId]); @@index([userId]); @@index([repoUrl]); @@index([status])
}

model ApiKey {
  id         String    @id @default(cuid())
  keyPrefix  String
  keyHash    String    @unique
  name       String
  tier       String    @default("free")
  lastUsedAt DateTime?
  createdAt  DateTime  @default(now())
  userId     String
  user       User      @relation(fields: [userId], references: [id])
}

model ClawAgent {
  id         String      @id @default(cuid())
  name       String
  type       String
  config     Json?
  trustScore Int         @default(100)
  status     String      @default("active")
  createdAt  DateTime    @default(now())
  orgId      String
  org        Org         @relation(fields: [orgId], references: [id])
  alerts     ClawAlert[]
}

model ClawAlert {
  id           String   @id @default(cuid())
  module       String
  severity     String
  title        String
  description  String?
  raw          Json?
  acknowledged Boolean  @default(false)
  createdAt    DateTime @default(now())
  orgId        String
  org          Org      @relation(fields: [orgId], references: [id])
  agentId      String?
  agent        ClawAgent? @relation(fields: [agentId], references: [id])
  @@index([orgId]); @@index([severity])
}

model Subscription {
  id                   String    @id @default(cuid())
  stripeSubscriptionId String    @unique
  plan                 String
  status               String
  currentPeriodStart   DateTime?
  currentPeriodEnd     DateTime?
  createdAt            DateTime  @default(now())
  orgId                String
  org                  Org       @relation(fields: [orgId], references: [id])
}

model Webhook {
  id        String   @id @default(cuid())
  url       String
  events    String[]
  secret    String
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  orgId     String
  org       Org      @relation(fields: [orgId], references: [id])
}
```

- [ ] **Step 4: Create db/client.ts**

```typescript
import { PrismaClient } from "@prisma/client";
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 5: Create config.ts**

```typescript
import "dotenv/config";
export const config = {
  port: parseInt(process.env.PORT || "3001", 10),
  appUrl: process.env.APP_URL || "http://localhost:5173",
  nodeEnv: process.env.NODE_ENV || "development",
  jwt: { secret: process.env.JWT_SECRET || "dev-secret", expiresIn: "7d" },
  github: { clientId: process.env.GITHUB_CLIENT_ID || "", clientSecret: process.env.GITHUB_CLIENT_SECRET || "" },
  gemini: { apiKey: process.env.GEMINI_API_KEY || "", model: process.env.GEMINI_MODEL || "gemini-2.5-flash" },
  stripe: { secretKey: process.env.STRIPE_SECRET_KEY || "", webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "" },
  redis: { url: process.env.REDIS_URL || "redis://localhost:6379" },
};
```

- [ ] **Step 6: Generate Prisma client and push**

```bash
cd apps/api && pnpm db:generate && pnpm db:push && cd ../..
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/
git commit -m "feat: add Prisma schema with all models"
```

---

### Task 1.4: Express API Scaffold

**Files:**
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/middleware/errorHandler.ts`

- [ ] **Step 1: Create app.ts**

```typescript
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { errorHandler } from "./middleware/errorHandler";

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.APP_URL || "http://localhost:5173", credentials: true }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

app.use(errorHandler);
export default app;
```

- [ ] **Step 2: Create index.ts**

```typescript
import app from "./app";
import { config } from "./config";
app.listen(config.port, () => console.log(`RepoRank API running on port ${config.port}`));
```

- [ ] **Step 3: Create middleware/errorHandler.ts**

```typescript
import { Request, Response, NextFunction } from "express";

export class AppError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message); this.name = "AppError";
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) return res.status(err.statusCode).json({ error: err.message, code: err.code });
  console.error("Unhandled error:", err);
  return res.status(500).json({ error: "Internal server error" });
}
```

- [ ] **Step 4: Test server starts**

```bash
pnpm --filter @reporank/api dev &
sleep 2
curl http://localhost:3001/health
kill %1
```
Expected: `{"status":"ok","timestamp":"..."}`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/index.ts apps/api/src/middleware/
git commit -m "feat: scaffold Express API with health check"
```

---

### Task 1.5: Auth Middleware (JWT + API Key)

**Files:**
- Create: `apps/api/src/middleware/auth.ts`
- Create: `apps/api/src/middleware/tenant.ts`
- Create: `apps/api/src/routes/auth.ts`

- [ ] **Step 1: Create apps/api/src/middleware/auth.ts**

```typescript
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { AppError } from "./errorHandler";
import { prisma } from "../db/client";
import crypto from "node:crypto";

export interface AuthRequest extends Request {
  userId?: string;
  orgId?: string;
}

export async function authMiddleware(req: AuthRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) throw new AppError(401, "No authorization header", "UNAUTHORIZED");

  if (authHeader.startsWith("gr_")) {
    const keyHash = crypto.createHash("sha256").update(authHeader).digest("hex");
    const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });
    if (!apiKey) throw new AppError(401, "Invalid API key", "INVALID_API_KEY");
    await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });
    req.userId = apiKey.userId;
    return next();
  }

  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, config.jwt.secret) as { userId: string };
      req.userId = payload.userId;
      return next();
    } catch { throw new AppError(401, "Invalid or expired token", "INVALID_TOKEN"); }
  }

  throw new AppError(401, "Invalid authorization format", "INVALID_AUTH_FORMAT");
}

export async function orgAccessMiddleware(req: AuthRequest, _res: Response, next: NextFunction) {
  const orgId = req.headers["x-org-id"] as string;
  if (!orgId) return next();
  const membership = await prisma.orgMember.findUnique({ where: { orgId_userId: { orgId, userId: req.userId! } } });
  if (!membership) throw new AppError(403, "Not a member of this organization", "FORBIDDEN");
  req.orgId = orgId;
  next();
}
```

- [ ] **Step 2: Create apps/api/src/middleware/tenant.ts**

```typescript
import { Response, NextFunction } from "express";
import { prisma } from "../db/client";
import { PLAN_LIMITS, type PlanTier } from "@reporank/shared-types";
import { AppError } from "./errorHandler";
import { AuthRequest } from "./auth";

export async function scanLimitMiddleware(req: AuthRequest, _res: Response, next: NextFunction) {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) throw new AppError(404, "User not found", "NOT_FOUND");

  const limits = PLAN_LIMITS[user.tier as PlanTier];
  if (limits.scansPerMonth === -1) return next();

  const scanCount = await prisma.scan.count({
    where: { userId: req.userId!, createdAt: { gte: new Date(new Date().setDate(1)) } },
  });
  if (scanCount >= limits.scansPerMonth) throw new AppError(429, "Monthly scan limit reached", "LIMIT_EXCEEDED");
  next();
}
```

- [ ] **Step 3: Create apps/api/src/routes/auth.ts**

```typescript
import { Router } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../db/client";
import { config } from "../config";
import { authMiddleware, AuthRequest } from "../middleware/auth";

const router = Router();

router.post("/github", async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Authorization code required" });

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: config.github.clientId, client_secret: config.github.clientSecret, code }),
  });
  const tokenData = await tokenRes.json() as any;
  if (!tokenData.access_token) return res.status(401).json({ error: "Failed to exchange code" });

  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const githubUser = await userRes.json() as any;

  let user = await prisma.user.findUnique({ where: { githubId: String(githubUser.id) } });
  if (!user) {
    user = await prisma.user.create({
      data: { email: githubUser.email || `${githubUser.login}@github.com`, displayName: githubUser.name || githubUser.login, githubId: String(githubUser.id), avatarUrl: githubUser.avatar_url },
    });
  }

  const jwtToken = jwt.sign({ userId: user.id }, config.jwt.secret, { expiresIn: config.jwt.expiresIn as any });
  res.json({ data: { token: jwtToken, user: { id: user.id, email: user.email, displayName: user.displayName } } });
});

router.get("/me", authMiddleware, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  res.json({ data: { id: user!.id, email: user!.email, displayName: user!.displayName, tier: user!.tier, scansThisMonth: user!.scansThisMonth } });
});

export default router;
```

- [ ] **Step 4: Wire routes into app.ts**

Edit `apps/api/src/app.ts`:
```typescript
import authRoutes from "./routes/auth";
app.use("/api/v1/auth", authRoutes);
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/middleware/ apps/api/src/routes/auth.ts
git commit -m "feat: add JWT/API key auth and GitHub OAuth routes"
```

---

## PHASE 2: Grading Engine & Scanners

### Task 2.1: Grading Engine Package

**Files:**
- Create: `packages/grading-engine/package.json`
- Create: `packages/grading-engine/tsconfig.json`
- Create: `packages/grading-engine/src/index.ts`
- Create: `packages/grading-engine/src/promptBuilder.ts`
- Create: `packages/grading-engine/src/responseParser.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@reporank/grading-engine",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": { "build": "tsc", "test": "vitest run", "lint": "tsc --noEmit" },
  "dependencies": {
    "@reporank/shared-types": "workspace:*",
    "@google/genai": "^2.4.0",
    "zod": "^3.24.0"
  },
  "devDependencies": { "typescript": "^5.8.0", "vitest": "^3.1.0" }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"],
  "references": [{ "path": "../shared-types" }]
}
```

- [ ] **Step 3: Create promptBuilder.ts**

```typescript
import type { GradeInput, ScannerResults } from "./index";

export function buildGradingPrompt(input: GradeInput, scannerResults?: ScannerResults): string {
  const readmeTrimmed = input.readmeContent.slice(0, 10000);
  const packageJsonTrimmed = input.packageJson.slice(0, 5000);
  const fileList = input.fileTree.slice(0, 100).join("\n");

  return `You are an expert codebase auditor grading a GitHub repository.

## Repository Metadata
- Name: ${input.repoOwner}/${input.repoName}
- Language: ${input.mainLanguage}
- Stars: ${input.starsCount} | Forks: ${input.forksCount} | Issues: ${input.openIssuesCount}
- Last push: ${input.lastPushedAt}

## README (truncated)
${readmeTrimmed}

## package.json (truncated)
${packageJsonTrimmed}

## File Tree (top 100 files)
${fileList}

${scannerResults ? `## Scanner Results (authoritative)
${JSON.stringify(scannerResults, null, 2)}` : "## No scanner results available"}

## Task
Return ONLY valid JSON matching this schema. No markdown, no code fences, no extra text.

{
  "overallScore": 0-100,
  "gradeCategory": "A+"|"A"|"B+"|"B"|"C"|"D"|"F",
  "maturityLevel": "Prototype"|"MVP"|"Beta"|"Production"|"Enterprise",
  "summary": "2-3 sentence brutally honest summary",
  "dimensionScores": { "security": 0-100, "quality": 0-100, "vibe": 0-100, "architecture": 0-100, "deployment": 0-100, "documentation": 0-100, "license": 0-100, "market": 0-100 },
  "security": { "secretsFound": 0, "vulnerabilityCount": 0, "highestSeverity": "none"|"low"|"medium"|"high"|"critical", "vulnerabilities": [{"id":"string","severity":"low"|"medium"|"high"|"critical","title":"string","description":"string","recommendation":"string"}], "score": 0-100 },
  "quality": { "readmeScore": 0-100, "testFramework": null|"string", "codeSmells": 0, "duplicationPercent": 0, "score": 0-100 },
  "vibe": { "overall": 0-100, "recommendations": ["string"] },
  "architecture": { "score": 0-100, "complexityRating": "low"|"medium"|"high"|"very-high", "fileCount": 0 },
  "deployment": { "hasDockerfile": false, "hasCIConfig": false, "hasEnvExample": false, "score": 0-100 },
  "documentation": { "readmeCompleteness": 0-100, "score": 0-100 },
  "license": { "licenseType": null|"string", "isCopyleft": false, "score": 0-100 },
  "market": { "trendAlignment": "rising"|"steady"|"declining", "percentileRank": 0, "score": 0-100 },
  "hallucinatedFeatures": ["string"],
  "bugsAndLeaks": ["string"],
  "structuralSmells": ["string"],
  "quickWins": [{"title":"string","severity":"critical"|"high"|"medium"|"low","category":"string","effort":"minutes"|"hours"|"days","description":"string","action":"string"}],
  "roadmap": [{"phase":"now"|"next"|"later","priority":1,"category":"string","task":"string","effort":"hours"|"days"|"weeks"}],
  "implementationPlan": [{"title":"string","description":"string","targetFiles":["string"],"promptInstruction":"string"}]
}

Be brutally honest. LLMs overestimate codebase quality. Be critical. If something is missing, say so.`;
}
```

- [ ] **Step 4: Create responseParser.ts**

```typescript
import { z } from "zod";
import type { HealthReport } from "@reporank/shared-types";

const healthReportSchema = z.object({
  overallScore: z.number().min(0).max(100),
  gradeCategory: z.enum(["A+","A","B+","B","C","D","F"]),
  maturityLevel: z.enum(["Prototype","MVP","Beta","Production","Enterprise"]),
  summary: z.string(),
  dimensionScores: z.object({ security: z.number(), quality: z.number(), vibe: z.number(), architecture: z.number(), deployment: z.number(), documentation: z.number(), license: z.number(), market: z.number() }),
  security: z.object({ secretsFound: z.number(), vulnerabilityCount: z.number(), highestSeverity: z.enum(["none","low","medium","high","critical"]), vulnerabilities: z.array(z.object({ id: z.string(), severity: z.enum(["low","medium","high","critical"]), title: z.string(), description: z.string(), recommendation: z.string() })), score: z.number() }),
  quality: z.object({ readmeScore: z.number(), testFramework: z.string().nullable(), codeSmells: z.number(), duplicationPercent: z.number(), score: z.number() }),
  vibe: z.object({ overall: z.number(), recommendations: z.array(z.string()) }),
  architecture: z.object({ score: z.number(), complexityRating: z.enum(["low","medium","high","very-high"]), fileCount: z.number() }),
  deployment: z.object({ hasDockerfile: z.boolean(), hasCIConfig: z.boolean(), hasEnvExample: z.boolean(), score: z.number() }),
  documentation: z.object({ readmeCompleteness: z.number(), score: z.number() }),
  license: z.object({ licenseType: z.string().nullable(), isCopyleft: z.boolean(), score: z.number() }),
  market: z.object({ trendAlignment: z.enum(["rising","steady","declining"]), percentileRank: z.number(), score: z.number() }),
  hallucinatedFeatures: z.array(z.string()),
  bugsAndLeaks: z.array(z.string()),
  structuralSmells: z.array(z.string()),
  quickWins: z.array(z.object({ title: z.string(), severity: z.enum(["critical","high","medium","low"]), category: z.string(), effort: z.enum(["minutes","hours","days"]), description: z.string(), action: z.string() })),
  roadmap: z.array(z.object({ phase: z.enum(["now","next","later"]), priority: z.number(), category: z.string(), task: z.string(), effort: z.enum(["hours","days","weeks"]) })),
  implementationPlan: z.array(z.object({ title: z.string(), description: z.string(), targetFiles: z.array(z.string()), promptInstruction: z.string() })),
});

export function parseHealthReport(raw: string): HealthReport {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in LLM response");
  return healthReportSchema.parse(JSON.parse(jsonMatch[0])) as HealthReport;
}
```

- [ ] **Step 5: Create index.ts**

```typescript
import { GoogleGenAI } from "@google/genai";
import type { HealthReport } from "@reporank/shared-types";
import { buildGradingPrompt } from "./promptBuilder";
import { parseHealthReport } from "./responseParser";

export interface GradeInput {
  repoUrl: string; repoName: string; repoOwner: string;
  mainLanguage: string; starsCount: number; forksCount: number;
  openIssuesCount: number; lastPushedAt: string;
  readmeContent: string; packageJson: string;
  fileTree: string[]; sourceFiles: { path: string; content: string }[];
}

export interface ScannerResults { [key: string]: unknown }

export class GradingService {
  private ai: GoogleGenAI;
  constructor(private apiKey: string, private model: string = "gemini-2.5-flash") {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async gradeRepo(input: GradeInput, scannerResults?: ScannerResults): Promise<HealthReport> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: buildGradingPrompt(input, scannerResults),
      config: { temperature: 0.2, responseMimeType: "application/json" },
    });
    const text = response.text;
    if (!text) throw new Error("Empty response from Gemini");

    const report = parseHealthReport(text);
    report.repoOwner = input.repoOwner;
    report.repoName = input.repoName;
    report.mainLanguage = input.mainLanguage;
    report.starsCount = input.starsCount;
    report.forksCount = input.forksCount;
    report.openIssuesCount = input.openIssuesCount;
    report.lastPushedAt = input.lastPushedAt;
    report.scannedAt = new Date().toISOString();
    return report;
  }
}

export { buildGradingPrompt } from "./promptBuilder";
export { parseHealthReport } from "./responseParser";
```

- [ ] **Step 6: Build and verify**

```bash
pnpm --filter @reporank/grading-engine build
```
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/grading-engine/
git commit -m "feat: add grading engine with Gemini AI prompt builder"
```

---

### Task 2.2: Scanner Wrappers

**Files:**
- Create: `packages/grading-engine/src/scanners/github.ts`
- Create: `packages/grading-engine/src/scanners/semgrep.ts`
- Create: `packages/grading-engine/src/scanners/trivy.ts`
- Create: `packages/grading-engine/src/scanners/trufflehog.ts`
- Create: `packages/grading-engine/src/scanners/hadolint.ts`

- [ ] **Step 1: Create github.ts**

```typescript
export interface RepoData {
  metadata: { owner: string; repo: string; language: string; stars: number; forks: number; openIssues: number; pushedAt: string };
  readme: string; packageJson: string; fileTree: string[];
  sourceFiles: { path: string; content: string }[];
}

export async function fetchRepoData(owner: string, repo: string, token?: string): Promise<RepoData> {
  const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const gh = async (path: string) => { const r = await fetch(`https://api.github.com${path}`, { headers }); if (!r.ok) throw new Error(`GitHub API ${r.status}`); return r.json(); };

  const repoData = await gh(`/repos/${owner}/${repo}`);
  let readme = "";
  try { const rd = await gh(`/repos/${owner}/${repo}/readme`); readme = Buffer.from(rd.content, "base64").toString("utf-8"); } catch {}
  const tree = await gh(`/repos/${owner}/${repo}/git/trees/${repoData.default_branch}?recursive=1`);
  const fileTree = (tree.tree || []).map((i: any) => i.path);

  let packageJson = "";
  try { const pkg = await gh(`/repos/${owner}/${repo}/contents/package.json`); packageJson = Buffer.from(pkg.content, "base64").toString("utf-8"); } catch {}

  const sourceFiles: { path: string; content: string }[] = [];
  const exts = new Set([".ts",".tsx",".js",".jsx",".py",".go",".rs",".java",".rb",".php"]);
  for (const fp of fileTree.filter(f => exts.has(f.slice(f.lastIndexOf(".")))).slice(0, 8)) {
    try { const f = await gh(`/repos/${owner}/${repo}/contents/${fp}`); sourceFiles.push({ path: fp, content: Buffer.from(f.content, "base64").toString("utf-8").slice(0, 10000) }); } catch {}
  }

  return { metadata: { owner, repo, language: repoData.language || "Unknown", stars: repoData.stargazers_count || 0, forks: repoData.forks_count || 0, openIssues: repoData.open_issues_count || 0, pushedAt: repoData.pushed_at || "" }, readme, packageJson, fileTree, sourceFiles };
}

export function repoDataToGradeInput(data: RepoData) {
  return { repoUrl: `https://github.com/${data.metadata.owner}/${data.metadata.repo}`, repoName: data.metadata.repo, repoOwner: data.metadata.owner, mainLanguage: data.metadata.language, starsCount: data.metadata.stars, forksCount: data.metadata.forks, openIssuesCount: data.metadata.openIssues, lastPushedAt: data.metadata.pushedAt, readmeContent: data.readme, packageJson: data.packageJson, fileTree: data.fileTree, sourceFiles: data.sourceFiles };
}
```

- [ ] **Step 2: Create semgrep.ts**

```typescript
import { execSync } from "node:child_process";

export async function runSemgrep(repoPath: string) {
  try {
    const output = execSync(`semgrep scan --sarif --no-rewrite-rule-ids --quiet`, { cwd: repoPath, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, timeout: 120000 });
    const sarif = JSON.parse(output);
    const findings = [];
    for (const run of sarif.runs || [])
      for (const r of run.results || [])
        findings.push({ checkId: r.ruleId, severity: r.properties?.severity || "WARNING", path: r.locations?.[0]?.physicalLocation?.artifactLocation?.uri || "", message: r.message?.text || "" });
    return findings;
  } catch (e: any) {
    if (e.stderr?.includes("not found")) return [];
    console.warn("Semgrep:", e.message);
    return [];
  }
}
```

- [ ] **Step 3: Create trivy.ts**

```typescript
import { execSync } from "node:child_process";

export async function runTrivy(repoPath: string) {
  try {
    const output = execSync(`trivy filesystem --format json --quiet --no-progress ${repoPath}`, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, timeout: 120000 });
    const result = JSON.parse(output);
    const vulns = [];
    for (const res of result.Results || [])
      for (const v of res.Vulnerabilities || [])
        vulns.push({ vulnId: v.VulnerabilityID, pkgName: v.PkgName, severity: v.Severity, title: v.Title, installedVersion: v.InstalledVersion, fixedVersion: v.FixedVersion });
    return vulns;
  } catch (e: any) {
    if (e.stderr?.includes("not found")) return [];
    console.warn("Trivy:", e.message);
    return [];
  }
}
```

- [ ] **Step 4: Create trufflehog.ts**

```typescript
import { execSync } from "node:child_process";

export async function runTrufflehog(repoPath: string) {
  try {
    const output = execSync(`trufflehog filesystem --json --no-update ${repoPath}`, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, timeout: 120000 });
    return output.trim().split("\n").filter(Boolean).map(l => { try { const p = JSON.parse(l); return { detector: p.DetectorName || "unknown", verified: p.Verified || false, raw: (p.Raw || "").slice(0, 20) }; } catch { return null; } }).filter(Boolean);
  } catch (e: any) {
    if (e.stderr?.includes("not found")) return [];
    console.warn("TruffleHog:", e.message);
    return [];
  }
}
```

- [ ] **Step 5: Create hadolint.ts**

```typescript
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export async function runHadolint(repoPath: string) {
  const dockerfilePath = join(repoPath, "Dockerfile");
  if (!existsSync(dockerfilePath)) return { hasDockerfile: false, violations: [], score: 0 };
  try {
    const output = execSync(`hadolint Dockerfile --format json`, { cwd: repoPath, encoding: "utf-8", timeout: 30000 });
    const violations = JSON.parse(output);
    const errors = violations.filter((v: any) => v.severity === "error").length;
    const warnings = violations.filter((v: any) => v.severity === "warning").length;
    return { hasDockerfile: true, violations, score: Math.max(0, 100 - errors * 10 - warnings * 3) };
  } catch { return { hasDockerfile: true, violations: [], score: 50 }; }
}
```

- [ ] **Step 6: Build and commit**

```bash
pnpm --filter @reporank/grading-engine build
git add packages/grading-engine/src/scanners/
git commit -m "feat: add scanner wrappers for Semgrep, Trivy, TruffleHog, Hadolint"
```

---

## PHASE 3: Vibe Analyzer

### Task 3.1: Vibe Analyzer Package

**Files:**
- Create: `packages/vibe-analyzer/package.json`
- Create: `packages/vibe-analyzer/tsconfig.json`
- Create: `packages/vibe-analyzer/src/index.ts`
- Create: `packages/vibe-analyzer/src/namingAnalyzer.ts`
- Create: `packages/vibe-analyzer/src/modernityScorer.ts`
- Create: `packages/vibe-analyzer/src/hygieneChecker.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@reporank/vibe-analyzer",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": { "build": "tsc", "test": "vitest run", "lint": "tsc --noEmit" },
  "dependencies": { "@reporank/shared-types": "workspace:*" },
  "devDependencies": { "typescript": "^5.8.0", "vitest": "^3.1.0" }
}
```

- [ ] **Step 2: Create namingAnalyzer.ts**

```typescript
export function analyzeNaming(files: string[]) {
  const conventions: Record<string, number> = { camelCase: 0, snake_case: 0, "kebab-case": 0, PascalCase: 0 };
  let total = 0;

  for (const file of files) {
    const name = (file.split("/").pop() || file).split(".").slice(0, -1).join(".");
    if (!name) continue;
    if (/^[a-z][a-zA-Z0-9]*$/.test(name)) conventions.camelCase++;
    else if (/^[a-z][a-z0-9_]*$/.test(name)) conventions.snake_case++;
    else if (/^[a-z][a-z0-9-]*$/.test(name)) conventions["kebab-case"]++;
    else if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) conventions.PascalCase++;
    total++;
  }

  if (total === 0) return { score: 100, recommendations: [] };
  const sorted = Object.entries(conventions).sort((a, b) => b[1] - a[1]);
  const maxPct = (sorted[0][1] / total) * 100;
  const score = maxPct >= 90 ? 100 : maxPct >= 70 ? 70 : maxPct >= 50 ? 40 : 20;
  const recommendations = maxPct < 70 ? ["Mixed naming conventions — consider standardizing to one style."] : [];
  return { dominant: sorted[0][0], score, recommendations };
}
```

- [ ] **Step 3: Create modernityScorer.ts**

```typescript
export function analyzeModernity(files: { path: string; content: string }[]) {
  let awaitCount = 0, callbackPatterns = 0, hookCount = 0;
  let usesAsyncAwait = false, usesHooks = false, usesTypeScript = false;

  for (const file of files) {
    if (file.path.endsWith(".ts") || file.path.endsWith(".tsx")) usesTypeScript = true;
    const c = file.content;
    if (c.match(/\bawait\b/g)) { awaitCount += (c.match(/\bawait\b/g) || []).length; usesAsyncAwait = true; }
    if (c.match(/\.(then|catch)\s*\(function/g)) callbackPatterns += (c.match(/\.(then|catch)\s*\(function/g) || []).length;
    if (c.match(/use[A-Z][a-zA-Z]*\s*\(/g)) { hookCount += (c.match(/use[A-Z][a-zA-Z]*\s*\(/g) || []).length; usesHooks = true; }
  }

  let score = 0; const recommendations: string[] = [];
  if (usesAsyncAwait) score += 30; else recommendations.push("Migrate from callbacks to async/await.");
  if (callbackPatterns === 0) score += 20; else if (callbackPatterns >= 5) recommendations.push(`Found ${callbackPatterns} callback patterns — prefer async/await.`);
  if (usesHooks) score += 25; else recommendations.push("No React hooks detected — use functional components + hooks.");
  if (usesTypeScript) score += 25; else recommendations.push("TypeScript would improve type safety.");

  return { score, recommendations };
}
```

- [ ] **Step 4: Create hygieneChecker.ts**

```typescript
export function analyzeHygiene(files: { path: string; content: string }[]) {
  let commentedCode = 0, todos = 0, consoleLogs = 0;

  for (const file of files) {
    const c = file.content;
    commentedCode += (c.match(/\/\/\s*.+[;{}]/gm) || []).length;
    todos += (c.match(/\/\/\s*(TODO|FIXME|HACK)/gi) || []).length;
    consoleLogs += (c.match(/console\.(log|warn|error|debug)\(/g) || []).length;
  }

  let score = 100; const recommendations: string[] = [];
  if (commentedCode > 10) { score -= 30; recommendations.push(`Found ${commentedCode} commented-out code blocks — clean up.`); }
  if (todos > 5) { score -= 15; recommendations.push(`${todos} TODO/FIXME comments — address.`); }
  if (consoleLogs > 5) { score -= 15; recommendations.push(`${consoleLogs} console statements — remove before production.`); }
  return { score: Math.max(0, score), recommendations };
}
```

- [ ] **Step 5: Create index.ts**

```typescript
import type { VibeScore } from "@reporank/shared-types";
import { analyzeNaming } from "./namingAnalyzer";
import { analyzeModernity } from "./modernityScorer";
import { analyzeHygiene } from "./hygieneChecker";

export function analyzeVibe(input: { files: string[]; sourceFiles: { path: string; content: string }[] }): VibeScore {
  const naming = analyzeNaming(input.files);
  const modernity = analyzeModernity(input.sourceFiles);
  const hygiene = analyzeHygiene(input.sourceFiles);

  const overall = Math.round(naming.score * 0.25 + modernity.score * 0.25 + hygiene.score * 0.20 + 75 * 0.15 + 65 * 0.15);

  return {
    overall, namingScore: naming.score, modernityScore: modernity.score, hygieneScore: hygiene.score,
    configCoherence: 75, dependencyFreshness: 65,
    recommendations: [...naming.recommendations, ...modernity.recommendations, ...hygiene.recommendations],
  };
}

export { analyzeNaming } from "./namingAnalyzer";
export { analyzeModernity } from "./modernityScorer";
export { analyzeHygiene } from "./hygieneChecker";
```

- [ ] **Step 6: Build and commit**

```bash
pnpm --filter @reporank/vibe-analyzer build
git add packages/vibe-analyzer/
git commit -m "feat: add vibe analyzer with naming, modernity, hygiene checks"
```

---

## PHASE 4: Scan Job Queue & API Routes

### Task 4.1: Scan Job Queue + Worker

**Files:**
- Create: `apps/api/src/jobs/queue.ts`
- Create: `apps/api/src/jobs/scanWorker.ts`
- Create: `apps/api/src/routes/scans.ts`

- [ ] **Step 1: Create apps/api/src/jobs/queue.ts**

```typescript
import Bull from "bull";
import { config } from "../config";

export interface ScanJobData { scanId: string; repoUrl: string; repoName: string; repoOwner: string; branch: string; userId: string; orgId?: string; }

export const scanQueue = new Bull<ScanJobData>("scan-jobs", config.redis.url, {
  defaultJobOptions: { attempts: 2, backoff: { type: "exponential", delay: 5000 }, timeout: 10 * 60 * 1000 },
});
```

- [ ] **Step 2: Create apps/api/src/routes/scans.ts**

```typescript
import { Router } from "express";
import { prisma } from "../db/client";
import { scanQueue } from "../jobs/queue";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { scanLimitMiddleware, orgAccessMiddleware } from "../middleware/tenant";
import { AppError } from "../middleware/errorHandler";
import { z } from "zod";

const router = Router();
const createScanSchema = z.object({ repoUrl: z.string().url().regex(/github\.com\//), branch: z.string().default("main") });

router.post("/", authMiddleware, scanLimitMiddleware, orgAccessMiddleware, async (req: AuthRequest, res) => {
  const parsed = createScanSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.errors[0].message, "VALIDATION_ERROR");

  const match = parsed.data.repoUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
  if (!match) throw new AppError(400, "Invalid GitHub URL", "INVALID_URL");

  const scan = await prisma.scan.create({
    data: { repoUrl: parsed.data.repoUrl, repoName: match[2].replace(/\.git$/, ""), repoOwner: match[1], branch: parsed.data.branch, status: "queued", userId: req.userId!, orgId: req.orgId },
  });

  await scanQueue.add({ scanId: scan.id, repoUrl: parsed.data.repoUrl, repoName: match[2].replace(/\.git$/, ""), repoOwner: match[1], branch: parsed.data.branch, userId: req.userId!, orgId: req.orgId });

  res.status(201).json({ data: { scanId: scan.id, status: scan.status, estimatedDuration: 120 } });
});

router.get("/:id", authMiddleware, async (req: AuthRequest, res) => {
  const scan = await prisma.scan.findUnique({ where: { id: req.params.id } });
  if (!scan) throw new AppError(404, "Scan not found", "NOT_FOUND");
  res.json({ data: { id: scan.id, status: scan.status, progress: scan.progress, message: scan.message, result: scan.report, error: scan.errorMessage, createdAt: scan.createdAt, completedAt: scan.completedAt, duration: scan.duration } });
});

router.get("/", authMiddleware, orgAccessMiddleware, async (req: AuthRequest, res) => {
  const scans = await prisma.scan.findMany({
    where: req.orgId ? { orgId: req.orgId } : { userId: req.userId! },
    orderBy: { createdAt: "desc" }, take: 50,
    select: { id: true, repoUrl: true, repoName: true, status: true, overallScore: true, gradeCategory: true, maturityLevel: true, vibeScore: true, createdAt: true, completedAt: true },
  });
  res.json({ data: scans });
});

export default router;
```

- [ ] **Step 3: Wire routes into app.ts**

```typescript
import authRoutes from "./routes/auth";
import scanRoutes from "./routes/scans";
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/scans", scanRoutes);
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/jobs/ apps/api/src/routes/scans.ts
git commit -m "feat: add Bull job queue and scan API routes"
```

---

## PHASE 5: Frontend Dashboard

### Task 5.1: React App Scaffold + Landing Page

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/index.css`
- Create: `apps/web/src/pages/LandingPage.tsx`

- [ ] **Step 1: Create apps/web/package.json**

```json
{
  "name": "@reporank/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "tsc && vite build", "preview": "vite preview" },
  "dependencies": {
    "react": "^19.1.0", "react-dom": "^19.1.0", "react-router": "^7.5.0",
    "lucide-react": "^0.485.0", "motion": "^12.7.0",
    "@reporank/shared-types": "workspace:*"
  },
  "devDependencies": {
    "@types/react": "^19.1.0", "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^5.2.0", "typescript": "^5.8.0",
    "vite": "^6.3.0", "tailwindcss": "^4.1.0", "@tailwindcss/vite": "^4.1.0"
  }
}
```

- [ ] **Step 2: Create vite.config.ts**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { "/api": "http://localhost:3001" } },
});
```

- [ ] **Step 3: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>RepoRank — Grade Your Repo</title></head>
  <body class="bg-gray-950 text-white antialiased"><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

- [ ] **Step 4: Create src/main.tsx**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
```

- [ ] **Step 5: Create src/index.css** — `@import "tailwindcss";`

- [ ] **Step 6: Create src/App.tsx**

```tsx
import { BrowserRouter, Routes, Route } from "react-router";
import LandingPage from "./pages/LandingPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/pricing" element={<div className="p-8 text-center text-gray-400">Pricing page coming soon</div>} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 7: Create pages/LandingPage.tsx**

```tsx
import { useState } from "react";
import { Scan, Shield, Sparkles } from "lucide-react";

export default function LandingPage() {
  const [repoUrl, setRepoUrl] = useState("");

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950">
      <header className="border-b border-gray-800/50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-emerald-400" />
            <span className="text-lg font-bold">RepoRank</span>
          </div>
          <a href="/pricing" className="bg-emerald-500 hover:bg-emerald-400 text-black px-4 py-2 rounded-lg font-medium transition-colors">Sign In</a>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 pt-24 pb-32 text-center">
        <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-4 py-1.5 text-emerald-400 text-sm mb-8">
          <Sparkles className="w-4 h-4" /> Google Analytics for your codebase
        </div>

        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
          Know exactly where<br />your codebase stands
        </h1>

        <p className="text-lg text-gray-400 mb-12 max-w-2xl mx-auto">
          Grade any GitHub repo across 8 dimensions — security, quality, vibe, architecture, and more.
          Get a score, missing pieces map, and an AI-generated fix pack.
        </p>

        <form className="max-w-xl mx-auto flex gap-3" onSubmit={e => e.preventDefault()}>
          <div className="flex-1 relative">
            <Scan className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
            <input type="text" value={repoUrl} onChange={e => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="w-full bg-gray-800/50 border border-gray-700/50 rounded-xl px-12 py-4 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50" />
          </div>
          <button type="submit" className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-8 py-4 rounded-xl">Grade It</button>
        </form>

        <div className="mt-8 flex items-center justify-center gap-6 text-sm text-gray-500">
          <span>Free for public repos</span><span className="w-1 h-1 rounded-full bg-gray-600" /><span>2-min analysis</span>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 8: Verify dev server**

```bash
pnpm dev
```
Expected: Vite dev server starts, landing page renders at localhost:5173.

- [ ] **Step 9: Commit**

```bash
git add apps/web/
git commit -m "feat: scaffold React dashboard with landing page"
```

---

### Task 5.2: Score Components

**Files:**
- Create: `apps/web/src/components/ScoreGauge.tsx`
- Create: `apps/web/src/components/ScoreBreakdown.tsx`
- Create: `apps/web/src/components/VibeBreakdown.tsx`
- Create: `apps/web/src/SecuritySection.tsx`

- [ ] **Step 1: Create ScoreGauge.tsx**

```tsx
import { motion } from "motion/react";

function getColor(score: number) { return score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : score >= 40 ? "#f97316" : "#ef4444"; }

export default function ScoreGauge({ score, size = 160, label }: { score: number; size?: number; label?: string }) {
  const radius = size * 0.4;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size/2} cy={size/2} r={radius} stroke="currentColor" strokeWidth={size*0.08} fill="none" className="text-gray-800" />
        <motion.circle cx={size/2} cy={size/2} r={radius} stroke={getColor(score)} strokeWidth={size*0.08} fill="none" strokeLinecap="round"
          strokeDasharray={circumference} initial={{ strokeDashoffset: circumference }} animate={{ strokeDashoffset: offset }} transition={{ duration: 1 }} />
      </svg>
      <div className="absolute flex flex-col items-center" style={{ width: size, height: size }}>
        <motion.span className="text-3xl font-bold" style={{ color: getColor(score) }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>{score}</motion.span>
      </div>
      {label && <span className="text-sm text-gray-400">{label}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Create ScoreBreakdown.tsx**

```tsx
import type { DimensionScores } from "@reporank/shared-types";

const CONFIG: Record<keyof DimensionScores, { label: string; color: string }> = {
  security: { label: "Security", color: "#10b981" }, quality: { label: "Quality", color: "#3b82f6" },
  vibe: { label: "Vibe", color: "#8b5cf6" }, architecture: { label: "Architecture", color: "#f59e0b" },
  deployment: { label: "Deploy", color: "#06b6d4" }, documentation: { label: "Docs", color: "#ec4899" },
  license: { label: "License", color: "#14b8a6" }, market: { label: "Market", color: "#f97316" },
};

export default function ScoreBreakdown({ dimensions }: { dimensions: DimensionScores }) {
  return (
    <div className="space-y-3">
      {(Object.entries(CONFIG) as [keyof DimensionScores, typeof CONFIG[keyof DimensionScores]][]).map(([key, c]) => (
        <div key={key} className="flex items-center gap-3">
          <span className="w-20 text-sm text-gray-400">{c.label}</span>
          <div className="flex-1 h-2.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${dimensions[key]}%`, backgroundColor: c.color }} />
          </div>
          <span className="w-8 text-right text-sm text-gray-300">{dimensions[key]}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create VibeBreakdown.tsx**

```tsx
import type { VibeScore } from "@reporank/shared-types";

export default function VibeBreakdown({ vibe }: { vibe: VibeScore }) {
  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
      <h3 className="text-lg font-semibold mb-4">Vibe Score <span className="text-2xl font-bold text-purple-400 ml-2">{vibe.overall}</span></h3>
      <div className="space-y-3 mb-4">
        {[
          { label: "Naming", score: vibe.namingScore, color: "#8b5cf6" },
          { label: "Modernity", score: vibe.modernityScore, color: "#a78bfa" },
          { label: "Hygiene", score: vibe.hygieneScore, color: "#c4b5fd" },
          { label: "Config", score: vibe.configCoherence, color: "#ddd6fe" },
          { label: "Deps", score: vibe.dependencyFreshness, color: "#ede9fe" },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-3">
            <span className="w-20 text-sm text-gray-400">{item.label}</span>
            <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${item.score}%`, backgroundColor: item.color }} />
            </div>
            <span className="w-8 text-right text-sm text-gray-300">{item.score}</span>
          </div>
        ))}
      </div>
      {vibe.recommendations.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-sm font-medium text-gray-400">Recommendations</h4>
          {vibe.recommendations.map((r, i) => <p key={i} className="text-sm text-gray-500 flex items-start gap-2"><span className="text-purple-400">•</span>{r}</p>)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create SecuritySection.tsx**

```tsx
import type { SecurityScan } from "@reporank/shared-types";
import { ShieldAlert, CheckCircle } from "lucide-react";

export default function SecuritySection({ security }: { security: SecurityScan }) {
  const hasIssues = security.vulnerabilityCount > 0 || security.secretsFound > 0;
  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-emerald-400" />Security</h3>
        <span className={`text-2xl font-bold ${security.score >= 80 ? "text-emerald-400" : security.score >= 60 ? "text-yellow-400" : "text-red-400"}`}>{security.score}</span>
      </div>
      {hasIssues ? (
        <div className="space-y-2">
          {security.secretsFound > 0 && <p className="text-red-400 text-sm">{security.secretsFound} secrets found</p>}
          {security.vulnerabilityCount > 0 && <p className="text-gray-400 text-sm">{security.vulnerabilityCount} vulnerabilities</p>}
          {security.vulnerabilities.slice(0, 3).map((v, i) => (
            <div key={i} className="flex items-center gap-2 p-2 bg-gray-800/50 rounded-lg text-sm">
              <span className={`px-2 py-0.5 rounded text-xs font-medium border ${v.severity === "critical" ? "bg-red-500/20 text-red-400" : v.severity === "high" ? "bg-orange-500/20 text-orange-400" : "bg-yellow-500/20 text-yellow-400"}`}>{v.severity.toUpperCase()}</span>
              <span className="text-gray-300">{v.title}</span>
            </div>
          ))}
        </div>
      ) : <div className="flex items-center gap-2 text-emerald-400 text-sm"><CheckCircle className="w-4 h-4" />No security issues detected</div>}
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/
git commit -m "feat: add ScoreGauge, ScoreBreakdown, VibeBreakdown, SecuritySection components"
```

---

## PHASE 6: Claw Protect Core

### Task 6.1: Claw Protect Core Package

**Files:**
- Create: `packages/claw-protect-core/package.json`
- Create: `packages/claw-protect-core/tsconfig.json`
- Create: `packages/claw-protect-core/src/index.ts`
- Create: `packages/claw-protect-core/src/promptInjection.ts`
- Create: `packages/claw-protect-core/src/secretsScanner.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@reporank/claw-protect-core",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": { "build": "tsc", "test": "vitest run" },
  "dependencies": { "@reporank/shared-types": "workspace:*" },
  "devDependencies": { "typescript": "^5.8.0", "vitest": "^3.1.0" }
}
```

- [ ] **Step 2: Create promptInjection.ts**

```typescript
const PATTERNS = [
  { name: "role-escape", pattern: /ignore\s+(all\s+)?(previous|above|below)\s+(instructions|commands)/i, severity: "high" },
  { name: "system-override", pattern: /(you\s+are\s+now|act\s+as|pretend\s+to\s+be|from\s+now\s+on)\s+.*(system|assistant|admin)/i, severity: "high" },
  { name: "delimiter-injection", pattern: /(===|---|\"\"\"|''')\s*(user|system|assistant)\s*(===|---|\"\"\"|''')/i, severity: "medium" },
  { name: "jailbreak", pattern: /do\s+anything\s+now|no\s+(restrictions|limits|boundaries|filter)/i, severity: "high" },
  { name: "prompt-leak", pattern: /(print|display|show|reveal|output|leak)\s+(your|the|this)\s+(prompt|instructions|system|rules)/i, severity: "high" },
  { name: "zero-width", pattern: /[\u200B\u200C\u200D\uFEFF]/, severity: "medium" },
];

export function scanPrompt(content: string) {
  const detected = PATTERNS.filter(p => p.pattern.test(content));
  return {
    isInjection: detected.length > 0,
    confidence: detected.length > 0 ? Math.min(100, detected.length * 25) : 0,
    detectedPatterns: detected.map(d => d.name),
    recommendation: detected.length > 0 ? `Blocked: ${detected.length} injection pattern(s) detected` : "No injection patterns detected.",
  };
}
```

- [ ] **Step 3: Create secretsScanner.ts**

```typescript
const SECRET_PATTERNS = [
  { name: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/g, severity: "critical" },
  { name: "github-token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g, severity: "critical" },
  { name: "openai-api-key", pattern: /sk-[A-Za-z0-9]{20,}/g, severity: "critical" },
  { name: "google-api-key", pattern: /AIza[0-9A-Za-z\-_]{35}/g, severity: "critical" },
  { name: "private-key", pattern: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH)\s+PRIVATE\s+KEY-----/g, severity: "critical" },
  { name: "connection-string", pattern: /(postgresql|mysql|mongodb|redis):\/\/[^\s]{10,}/gi, severity: "critical" },
  { name: "stripe-key", pattern: /(sk_live|pk_live|sk_test|pk_test)_[0-9A-Za-z]{24,}/g, severity: "critical" },
  { name: "jwt-token", pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, severity: "high" },
  { name: "slack-token", pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/g, severity: "high" },
];

export function scanSecrets(content: string) {
  const secrets = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const p of SECRET_PATTERNS) {
      const matches = lines[i].matchAll(p.pattern);
      for (const m of matches) {
        if (m.index === undefined) continue;
        const val = m[0];
        if (val.includes("test") || val.includes("example")) continue;
        secrets.push({ type: p.name, line: i + 1, column: m.index + 1, redacted: val.slice(0, 4) + "****" + val.slice(-4), severity: p.severity });
      }
    }
  }
  return { secretsFound: secrets.length, secrets, recommendation: secrets.length > 0 ? `Found ${secrets.length} secret(s) — review immediately.` : "No secrets detected." };
}
```

- [ ] **Step 4: Create index.ts**

```typescript
export { scanPrompt } from "./promptInjection";
export { scanSecrets } from "./secretsScanner";
```

- [ ] **Step 5: Build and commit**

```bash
pnpm --filter @reporank/claw-protect-core build
git add packages/claw-protect-core/
git commit -m "feat: add Claw Protect core with prompt injection and secrets scanning"
```

---

## PHASE 7: Fix Pack Generator

### Task 7.1: Fix Pack Generator

**Files:**
- Create: `packages/fix-pack-generator/package.json`
- Create: `packages/fix-pack-generator/tsconfig.json`
- Create: `packages/fix-pack-generator/src/index.ts`
- Create: `packages/fix-pack-generator/src/patchBuilder.ts`
- Create: `packages/fix-pack-generator/src/roadmapBuilder.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@reporank/fix-pack-generator",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": { "build": "tsc", "test": "vitest run" },
  "dependencies": { "@reporank/shared-types": "workspace:*" },
  "devDependencies": { "typescript": "^5.8.0", "vitest": "^3.1.0" }
}
```

- [ ] **Step 2: Create patchBuilder.ts**

```typescript
import type { HealthReport } from "@reporank/shared-types";

export interface GeneratedPatch { filePath: string; title: string; type: "create" | "modify"; content?: string; description: string; }

export function generateFixPacks(report: HealthReport): GeneratedPatch[] {
  const patches: GeneratedPatch[] = [];

  if (!report.deployment.hasEnvExample) patches.push({
    filePath: ".env.example", title: "Create .env.example template", type: "create",
    content: "# Environment Variables\nPORT=3000\nNODE_ENV=development\nDATABASE_URL=postgresql://user:pass@localhost:5432/mydb\n",
    description: "Missing env template — create one for onboarding.",
  });

  if (!report.deployment.hasDockerfile) patches.push({
    filePath: "Dockerfile", title: "Create Dockerfile", type: "create",
    content: "FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\nEXPOSE 3000\nCMD [\"node\", \"dist/index.js\"]\n",
    description: "Missing Dockerfile for containerized deployment.",
  });

  if (!report.quality.hasCiConfig) patches.push({
    filePath: ".github/workflows/ci.yml", title: "Create CI workflow", type: "create",
    content: "name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with: { node-version: 22 }\n      - run: npm ci\n      - run: npm test\n",
    description: "Missing CI pipeline.",
  });

  return patches;
}
```

- [ ] **Step 3: Create roadmapBuilder.ts**

```typescript
import type { QuickWin, RoadmapItem } from "@reporank/shared-types";

export function buildRoadmap(wins: QuickWin[], overallScore: number): RoadmapItem[] {
  const now: RoadmapItem[] = wins.filter(w => w.severity === "critical" || w.severity === "high").map((w, i) => ({
    phase: "now", priority: i + 1, category: w.category, task: w.title, effort: w.effort === "minutes" ? "hours" as const : w.effort,
  }));
  const next: RoadmapItem[] = wins.filter(w => w.severity === "medium").map((w, i) => ({
    phase: "next", priority: i + 1, category: w.category, task: w.title, effort: w.effort,
  }));
  const later: RoadmapItem[] = wins.filter(w => w.severity === "low").map((w, i) => ({
    phase: "later", priority: i + 1, category: w.category, task: w.title, effort: w.effort,
  }));

  if (overallScore < 50) now.push({ phase: "now", priority: now.length + 1, category: "Architecture", task: "Fix critical structural issues before adding features", effort: "days" });
  if (overallScore >= 50 && overallScore < 70) next.push({ phase: "next", priority: next.length + 1, category: "Testing", task: "Add test coverage for core modules", effort: "days" });

  return [...now, ...next, ...later];
}
```

- [ ] **Step 4: Create index.ts**

```typescript
export { generateFixPacks } from "./patchBuilder";
export type { GeneratedPatch } from "./patchBuilder";
export { buildRoadmap } from "./roadmapBuilder";
```

- [ ] **Step 5: Build and commit**

```bash
pnpm --filter @reporank/fix-pack-generator build
git add packages/fix-pack-generator/
git commit -m "feat: add fix pack generator with patch and roadmap builders"
```

---

## PHASE 8: SaaS Infrastructure

### Task 8.1: Stripe Billing

**Files:**
- Create: `apps/api/src/routes/billing.ts`

- [ ] **Step 1: Create billing.ts**

```typescript
import { Router } from "express";
import Stripe from "stripe";
import { config } from "../config";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";

const router = Router();
const stripe = new Stripe(config.stripe.secretKey);

router.post("/checkout", authMiddleware, async (req: AuthRequest, res) => {
  const { plan, orgId } = req.body;
  if (!["pro", "enterprise"].includes(plan)) return res.status(400).json({ error: "Invalid plan" });

  const org = orgId ? await prisma.org.findUnique({ where: { id: orgId } }) : await prisma.org.create({ data: { name: `${req.userId}'s Org`, slug: `org-${req.userId!.slice(0, 8)}`, ownerId: req.userId! } });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: plan === "pro" ? "price_pro_monthly" : "price_enterprise_monthly", quantity: 1 }],
    success_url: `${config.appUrl}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.appUrl}/pricing`,
    metadata: { orgId: org.id, userId: req.userId! },
  });

  res.json({ data: { url: session.url } });
});

router.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"] as string;
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret); }
  catch { return res.status(400).json({ error: "Invalid signature" }); }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orgId = session.metadata?.orgId;
    if (orgId) {
      await prisma.org.update({ where: { id: orgId }, data: { plan: "pro", scansThisPeriod: 0, periodStart: new Date(), stripeSubscriptionId: session.subscription as string } });
      await prisma.subscription.create({ data: { orgId, stripeSubscriptionId: session.subscription as string, plan: "pro", status: "active", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } });
    }
  }

  res.json({ received: true });
});

router.post("/portal", authMiddleware, async (req: AuthRequest, res) => {
  const org = await prisma.org.findFirst({ where: { members: { some: { userId: req.userId!, role: "owner" } } } });
  if (!org?.stripeSubscriptionId) return res.status(400).json({ error: "No active subscription" });

  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripeSubscriptionId,
    return_url: `${config.appUrl}/settings`,
  });
  res.json({ data: { url: session.url } });
});

export default router;
```

- [ ] **Step 2: Wire into app.ts** — `app.use("/api/v1/billing", billingRoutes);`

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/billing.ts
git commit -m "feat: add Stripe billing with checkout, webhook, and portal"
```

---

### Task 8.2: Orgs + Webhooks + API Keys Routes

**Files:**
- Create: `apps/api/src/routes/orgs.ts`
- Create: `apps/api/src/routes/webhooks.ts`

- [ ] **Step 1: Create orgs.ts**

```typescript
import { Router } from "express";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import crypto from "node:crypto";

const router = Router();

router.post("/", authMiddleware, async (req: AuthRequest, res) => {
  const { name, slug } = req.body;
  const org = await prisma.org.create({ data: { name, slug, members: { create: { userId: req.userId!, role: "owner" } } } });
  res.status(201).json({ data: org });
});

router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  const memberships = await prisma.orgMember.findMany({ where: { userId: req.userId! }, include: { org: true } });
  res.json({ data: memberships.map(m => ({ id: m.org.id, name: m.org.name, slug: m.org.slug, role: m.role, plan: m.org.plan })) });
});

router.post("/:id/api-keys", authMiddleware, async (req: AuthRequest, res) => {
  const key = `gr_${crypto.randomBytes(32).toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(key).digest("hex");
  await prisma.apiKey.create({ data: { keyPrefix: key.slice(0, 8), keyHash, name: req.body.name || "default", tier: "free", userId: req.userId! } });
  res.status(201).json({ data: { key, keyPrefix: key.slice(0, 8) } });
});

export default router;
```

- [ ] **Step 2: Wire and commit**

```bash
git add apps/api/src/routes/orgs.ts
git commit -m "feat: add org management and API key generation routes"
```

---

## PHASE 9: Compute + Finalize Worker

### Task 9.1: Complete Scan Worker (wires everything together)

**Files:**
- Create: `services/scanner-worker/package.json`
- Create: `services/scanner-worker/tsconfig.json`
- Create: `services/scanner-worker/src/index.ts`

- [ ] **Step 1: Create services/scanner-worker/package.json**

```json
{
  "name": "@reporank/scanner-worker",
  "version": "0.1.0",
  "private": true,
  "scripts": { "dev": "tsx watch src/index.ts", "build": "tsc" },
  "dependencies": {
    "@reporank/grading-engine": "workspace:*",
    "@reporank/vibe-analyzer": "workspace:*",
    "@reporank/fix-pack-generator": "workspace:*",
    "@reporank/claw-protect-core": "workspace:*",
    "bull": "^4.12.0",
    "ioredis": "^5.5.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": { "typescript": "^5.8.0", "tsx": "^4.19.0" }
}
```

- [ ] **Step 2: Create services/scanner-worker/src/index.ts**

```typescript
import "dotenv/config";
import Bull from "bull";
import { fetchRepoData, repoDataToGradeInput } from "@reporank/grading-engine/src/scanners/github";
import { GradingService } from "@reporank/grading-engine";
import { analyzeVibe } from "@reporank/vibe-analyzer";
import { generateFixPacks } from "@reporank/fix-pack-generator";
import { buildRoadmap } from "@reporank/fix-pack-generator";
import { scanSecrets } from "@reporank/claw-protect-core";

const gradingService = new GradingService(process.env.GEMINI_API_KEY || "");

interface JobData { scanId: string; repoOwner: string; repoName: string; }

const queue = new Bull<JobData>("scan-jobs", process.env.REDIS_URL || "redis://localhost:6379");

queue.process(async (job) => {
  console.log(`Processing ${job.data.repoOwner}/${job.data.repoName}`);

  const repoData = await fetchRepoData(job.data.repoOwner, job.data.repoName);
  const input = repoDataToGradeInput(repoData);
  const vibe = analyzeVibe({ files: repoData.fileTree, sourceFiles: repoData.sourceFiles });

  // Run Claw secret scan on source files
  const allContent = repoData.sourceFiles.map(f => f.content).join("\n");
  const clawResults = scanSecrets(allContent);

  // Grade with Gemini
  const report = await gradingService.gradeRepo(input, {
    vibeAnalysis: vibe,
    clawSecrets: clawResults,
  } as any);

  // Override vibe score with deterministic analysis
  report.vibe = vibe;

  // Generate fix packs and roadmap
  const fixPacks = generateFixPacks(report);
  const roadmap = buildRoadmap(report.quickWins, report.overallScore);
  report.roadmap = roadmap;

  // Recalculate weighted score
  report.overallScore = Math.round(
    report.dimensionScores.security * 0.25 + report.dimensionScores.quality * 0.20 +
    vibe.overall * 0.15 + report.dimensionScores.architecture * 0.15 +
    report.dimensionScores.deployment * 0.10 + report.dimensionScores.documentation * 0.05 +
    report.dimensionScores.license * 0.05 + report.dimensionScores.market * 0.05
  );

  console.log(`Complete: ${report.overallScore}/100 — ${report.gradeCategory}`);
  return { scanId: job.data.scanId, report, fixPacks };
});

console.log("Scanner worker ready.");
```

- [ ] **Step 3: Commit**

```bash
git add services/
git commit -m "feat: add scanner worker integrating all packages"
```

---

## Docker Compose

- [ ] **Create infra/docker-compose.yml**

```yaml
version: "3.8"
services:
  postgres:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: postgres, POSTGRES_PASSWORD: postgres, POSTGRES_DB: reporank }
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  api:
    build: { context: .., dockerfile: apps/api/Dockerfile }
    ports: ["3001:3001"]
    environment: { DATABASE_URL: postgresql://postgres:postgres@postgres:5432/reporank, REDIS_URL: redis://redis:6379 }
    depends_on: [postgres, redis]

  web:
    build: { context: .., dockerfile: apps/web/Dockerfile }
    ports: ["5173:5173"]
    depends_on: [api]

volumes: { pgdata: }
```

---

## Summary of All 35+ Tasks

| # | Task | Files Created |
|---|------|--------------|
| 1.1 | Monorepo init | 7 |
| 1.2 | Shared types | 8 |
| 1.3 | Prisma schema | 5 |
| 1.4 | Express scaffold | 3 |
| 1.5 | Auth middleware | 4 |
| 2.1 | Grading engine | 5 |
| 2.2 | Scanner wrappers | 5 |
| 3.1 | Vibe analyzer | 6 |
| 4.1 | Job queue + API | 4 |
| 5.1 | React scaffold | 8 |
| 5.2 | Score components | 4 |
| 6.1 | Claw Protect core | 5 |
| 7.1 | Fix pack generator | 5 |
| 8.1 | Stripe billing | 2 |
| 8.2 | Orgs + API keys | 2 |
| 9.1 | Complete worker | 3 |

**Total: ~76 files, ~15 packages/apps, ready to build in order.**

