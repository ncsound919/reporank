# RepoRank — Development Setup

## Prerequisites

- **Node.js** >= 22
- **pnpm** >= 10 (`npm install -g pnpm@10`)
- **PostgreSQL** 16+ (local install or remote)
- **Redis** 7+ (local install or remote)
- **External scanners** (optional, for full scans):
  - [Semgrep](https://semgrep.dev/docs/getting-started/) — `pip install semgrep`
  - [Trivy](https://trivy.dev/latest/getting-started/installation/) — `winget install aquasecurity.Trivy`
  - [TruffleHog](https://github.com/trufflesecurity/trufflehog) — `winget install trufflesecurity.trufflehog`
  - [Hadolint](https://github.com/hadolint/hadolint) — `winget install hadolint`

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your DB URL, Redis URL, API keys

# 3. Push database schema
cd apps/api
npx prisma db push
cd ../..

# 4. Start API server (terminal 1)
pnpm --filter @reporank/api dev

# 5. Start frontend (terminal 2)
pnpm --filter @reporank/web dev

# 6. Start scanner worker (terminal 3)
pnpm --filter @reporank/scanner-worker dev
```

## API Server (port 3001)

```bash
pnpm --filter @reporank/api dev      # Dev with hot reload
pnpm --filter @reporank/api build    # Production build
pnpm --filter @reporank/api start    # Run production build
```

## Frontend (port 5173)

```bash
pnpm --filter @reporank/web dev      # Dev with HMR
pnpm --filter @reporank/web build    # Production build
```

## Scanner Worker (background)

```bash
pnpm --filter @reporank/scanner-worker dev   # Dev mode
pnpm --filter @reporank/scanner-worker build # Build
```

## Architecture

```
apps/api/     → Express REST API (auth, scans, billing, orgs)
apps/web/     → React 19 SPA dashboard
packages/
  shared-types/      → Shared TypeScript interfaces
  grading-engine/    → Gemini AI grading + scanner wrappers
  vibe-analyzer/     → Code vibe scoring (naming, modernity, hygiene)
  claw-protect-core/ → Security scanning (prompt injection, secrets)
  fix-pack-generator/→ Auto-generated patches + roadmap
services/
  scanner-worker/    → Bull queue worker (fetches, grades, generates fixes)
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `JWT_SECRET` | Yes | JWT signing key (no fallback) |
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `GITHUB_CLIENT_ID` | For OAuth | GitHub OAuth app ID |
| `GITHUB_CLIENT_SECRET` | For OAuth | GitHub OAuth app secret |
| `STRIPE_SECRET_KEY` | For billing | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | For billing | Stripe webhook signing secret |
| `APP_URL` | No | Frontend URL (default: localhost:5173) |
