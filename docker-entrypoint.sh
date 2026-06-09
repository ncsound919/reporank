#!/bin/sh
set -e

# =============================================================================
# RepoRank API — Docker entrypoint
#
# ⚠️  This uses `prisma db push` for schema management, which is suitable for
#     local development but NOT production. For production, use:
#       prisma migrate deploy
# =============================================================================

echo "[entrypoint] Running Prisma schema push..."
cd /app/apps/api
npx prisma db push --accept-data-loss --schema=src/db/prisma/schema.prisma 2>&1 | grep -v "Already" || true

echo "[entrypoint] Starting RepoRank API..."
exec node dist/index.js
