# RepoRank Setup

RepoRank is a pnpm/Turborepo monorepo with three main runtime surfaces:

- API server.
- Web frontend.
- Scanner worker.

## Prerequisites

Install these before starting:

- Node.js 22 or newer.
- pnpm 10 or newer.
- PostgreSQL 16 or newer.
- Redis 7 or newer.

Optional external scanners for deeper analysis:

- Semgrep — [Getting started](https://semgrep.dev/docs/getting-started/)
- Trivy — [Installation](https://trivy.dev/latest/getting-started/installation/)
- TruffleHog — [GitHub](https://github.com/trufflesecurity/trufflehog)
- Hadolint — [GitHub](https://github.com/hadolint/hadolint)

## Quickstart

```bash
# 1) Install dependencies
pnpm install

# 2) Create local environment file
cp .env.example .env

# 3) Edit .env and set required values
# DATABASE_URL=
# REDIS_URL=
# JWT_SECRET=
# GEMINI_API_KEY=

# 4) Generate Prisma client
pnpm db:generate

# 5) Initialize local database schema
pnpm db:push

# 6) Start core services
pnpm dev:local
```

Then start the scanner worker in a separate terminal:

```bash
pnpm --filter @reporank/scanner-worker dev
```

## Runtime services

### API server

```bash
pnpm --filter @reporank/api dev
pnpm --filter @reporank/api build
pnpm --filter @reporank/api start
```

Default local port:

- API: `3001`

### Frontend

```bash
pnpm --filter @reporank/web dev
pnpm --filter @reporank/web build
```

Default local port:

- Web: `5173`

### Scanner worker

```bash
pnpm --filter @reporank/scanner-worker dev
pnpm --filter @reporank/scanner-worker build
```

## Monorepo layout

```text
apps/
  api/                     Express REST API
  web/                     React dashboard

packages/
  shared-types/            Shared TypeScript interfaces
  grading-engine/          AI grading and scanner wrappers
  vibe-analyzer/           Naming, modernity, and hygiene scoring
  claw-protect-core/       Security scanning and prompt-injection checks
  fix-pack-generator/      Patch and roadmap generation

services/
  scanner-worker/          Background job worker
```

## Environment variables

### Required

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | JWT signing secret |
| `GEMINI_API_KEY` | Gemini API key |

### Optional

| Variable | Purpose |
|---|---|
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret |
| `STRIPE_SECRET_KEY` | Stripe API secret |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret |
| `APP_URL` | Frontend URL, defaults to local web app |

## Database workflow

For local development, this repo uses:

```bash
pnpm db:generate
pnpm db:push
```

Notes:

- `db push` is appropriate for local schema sync and prototyping.
- For production or shared environments, prefer migration-driven workflows rather than relying on `db push`.

## Common commands

```bash
pnpm dev
pnpm dev:local
pnpm build
pnpm lint
pnpm test
pnpm clean
pnpm db:generate
pnpm db:push
pnpm db:migrate
pnpm db:setup
```

## Troubleshooting

### pnpm version mismatch

Make sure your local pnpm version matches the root `packageManager` field:

```bash
corepack enable
corepack prepare pnpm@10.8.0 --activate
```

### Frontend environment variables

If the web app needs browser-exposed environment variables, they usually need a public prefix depending on the frontend framework setup.

### Database connection errors

Check:

- PostgreSQL is running.
- `DATABASE_URL` points to the correct host, port, user, password, and database.
- The schema has been initialized with `pnpm db:push`.

### Redis connection errors

Check:

- Redis is running.
- `REDIS_URL` is valid and reachable from your local environment.
