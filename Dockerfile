# =============================================================================
# RepoRank API — Multi-stage Docker build
# Base: node:22-alpine (matches engines.node in package.json)
# Strategy: copy entire monorepo for reliable pnpm symlink preservation (v1).
# =============================================================================

# ---------- Stage 1: Install pnpm ----------
FROM node:22-alpine@sha256:c13b26e7e854e56478592d14e2835b1e5526444aa56ef2a62a8298270536d057 AS base

RUN corepack enable && corepack prepare pnpm@10.8.0 --activate
WORKDIR /app

# ---------- Stage 2: Install dependencies ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY apps/ apps/

# --ignore-scripts prevents postinstall hooks from running during install
# (prisma generate is run explicitly after build)
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---------- Stage 3: Build all workspace packages ----------
FROM deps AS builder

# Generate Prisma client first (needed by build)
RUN pnpm --filter @reporank/api db:generate

# Build all workspace packages via turbo
RUN pnpm build

# ---------- Stage 4: Production runtime ----------
FROM base AS runtime

# Install tools needed for healthcheck
RUN apk add --no-cache wget

# Create non-root user
RUN addgroup -S reporank && adduser -S reporank -G reporank

# Copy entire monorepo — preserves pnpm workspace symlinks
COPY --from=builder /app /app

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

USER reporank

EXPOSE 3001

ENTRYPOINT ["/docker-entrypoint.sh"]
