# RepoRank

RepoRank is an AI-assisted repository analysis platform for scoring codebases, surfacing engineering risks, and generating practical fixes.

It combines code-quality analysis, security checks, benchmarking, and automated remediation into a single monorepo with API, web, worker, and CLI surfaces.

## What RepoRank does

RepoRank helps teams answer questions like:

- How production-ready is this repository?
- Where is quality debt accumulating?
- Are there security, hygiene, or maintainability problems in the changed code?
- How does the project score over time?
- What concrete fixes should be applied next?

RepoRank is designed for both full-repository analysis and PR-level verification.

## Core capabilities

- Repository scoring and quality gates.
- Code hygiene, maintainability, and “vibe” analysis.
- Security-oriented scanning and prompt-injection/secrets protection.
- Benchmarking for deterministic and model-assisted evaluation.
- Patch and roadmap generation for recommended fixes.
- PR diff verification with GitHub-flavored output.
- CI/CD integration for quality, security, benchmark, and release workflows.

## Architecture

RepoRank is organized as a pnpm/Turborepo monorepo.

### Applications

- `apps/api` — Express REST API for auth, scans, billing, and organizations.
- `apps/web` — React dashboard for interacting with RepoRank results and workflows.

### Services

- `services/scanner-worker` — background worker for fetching repositories, running analysis, and generating results.

### Packages

- `packages/shared-types` — shared TypeScript interfaces across the stack.
- `packages/grading-engine` — AI grading and scanner wrappers.
- `packages/vibe-analyzer` — code scoring for naming, modernity, and hygiene.
- `packages/claw-protect-core` — security scanning for prompt injection and secrets risk.
- `packages/fix-pack-generator` — patch and roadmap generation for suggested remediations.

## Workflow model

RepoRank supports multiple layers of analysis:

### 1. Repository analysis

Full scans evaluate a codebase across quality, structure, security, and maintainability concerns.

### 2. Pull request verification

RepoRank can run against changed files in a PR and produce a markdown summary that can be posted back to GitHub.

### 3. Quality gates

Repo-level thresholds can be enforced in CI so changes fail when code quality drops below the configured standard.

### 4. Benchmarking

RepoRank includes deterministic and model-assisted benchmark workflows to track scoring quality and regression over time.

### 5. Fix generation

RepoRank can generate patch-style recommendations and implementation roadmaps to improve weak areas in the repository.

## CI and automation

RepoRank includes workflow automation for:

- Core CI.
- Benchmarks.
- PR review and verification.
- Quality gates.
- Security scanning.
- Release provenance and release validation.
- Scorecard and repository security posture checks.

This makes RepoRank usable both as a developer tool and as an automated governance layer in GitHub-based workflows.

## Local development

### Prerequisites

- Node.js 22+
- pnpm 10+
- PostgreSQL 16+
- Redis 7+

Optional scanners for deeper analysis:

- Semgrep
- Trivy
- TruffleHog
- Hadolint

### Quickstart

```bash
pnpm install
cp .env.example .env
pnpm db:generate
pnpm db:push
pnpm dev:local
```

Start the scanner worker in a separate terminal:

```bash
pnpm --filter @reporank/scanner-worker dev
```

## Common commands

```bash
pnpm dev
pnpm dev:local
pnpm build
pnpm lint
pnpm test
pnpm typecheck
pnpm clean
pnpm db:generate
pnpm db:push
pnpm db:migrate
pnpm db:setup
```

## Environment variables

### Required

- `DATABASE_URL` — PostgreSQL connection string.
- `REDIS_URL` — Redis connection string.
- `JWT_SECRET` — JWT signing key.
- `GEMINI_API_KEY` — Gemini API key.

### Optional

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `APP_URL`

## Benchmarks and evaluation

RepoRank includes benchmark workflows and result artifacts for evaluating scoring behavior and code review accuracy.

Typical benchmark modes include:

- Deterministic benchmark runs.
- Heuristic-only harness evaluation.
- LLM-assisted harness evaluation.

These workflows are intended to make scoring quality measurable rather than purely subjective.

## Security model

RepoRank includes multiple security-focused controls:

- Dependency auditing.
- Code scanning.
- SBOM generation.
- License policy checks.
- RepoRank-specific quality and security analysis.

For vulnerability reporting, use GitHub Security Advisories and the repository security policy.

## Intended use cases

RepoRank is useful for:

- Engineering due diligence on repositories.
- PR-level quality enforcement.
- Internal platform governance.
- AI-assisted code review augmentation.
- Security and maintainability scoring.
- Automated improvement roadmaps for existing codebases.

## Roadmap direction

RepoRank is evolving toward a more complete analysis platform with:

- stronger autonomous pipeline support,
- richer benchmarking and evaluation,
- tighter CI quality gates,
- better release discipline,
- and improved repo-to-remediation workflows.

## Contributing

Contributions should preserve:

- deterministic CI behavior,
- clear benchmark outputs,
- security-first defaults,
- and stable package boundaries across apps, packages, and services.

## Security

Please do not report security vulnerabilities in public issues.

Use the repository’s private vulnerability reporting flow through GitHub Security Advisories.

## License

Add the project license here once the repository license terms are finalized.
