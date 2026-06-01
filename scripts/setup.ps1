# RepoRank Setup Script
# Verifies prerequisites, installs deps, initializes database

$ErrorActionPreference = "Stop"

Write-Host "══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  RepoRank Setup" -ForegroundColor Cyan
Write-Host "══════════════════════════════════════" -ForegroundColor Cyan

# 1. Verify Node.js
Write-Host "Checking Node.js..."
try {
    $nodeVersion = node --version
    Write-Host "  Node.js $nodeVersion found" -ForegroundColor Green
} catch {
    Write-Error "Node.js 22+ is required. Install from https://nodejs.org"
    exit 1
}

# 2. Verify pnpm
Write-Host "Checking pnpm..."
try {
    $pnpmVersion = pnpm --version
    Write-Host "  pnpm $pnpmVersion found" -ForegroundColor Green
} catch {
    Write-Host "  pnpm not found. Installing..."
    npm install -g pnpm@10
}

# 3. Verify git (optional, for DEEP_SCAN)
Write-Host "Checking git..."
try {
    git --version | Out-Null
    Write-Host "  git found (DEEP_SCAN cloning available)" -ForegroundColor Green
} catch {
    Write-Host "  git not found (DEEP_SCAN will be disabled)" -ForegroundColor Yellow
}

# 4. Check .env
if (-not (Test-Path ".env")) {
    Write-Host "  No .env found. Creating from .env.example..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
    Write-Host "  Edit .env with your values before starting" -ForegroundColor Yellow
} else {
    Write-Host "  .env file found" -ForegroundColor Green
}

# 5. Install dependencies
Write-Host "Installing dependencies..."
pnpm install

# 6. Generate Prisma client
Write-Host "Generating Prisma client..."
pnpm --filter @reporank/api db:generate

# 7. Push database schema
Write-Host "Pushing database schema..."
pnpm --filter @reporank/api db:push

Write-Host ""
Write-Host "══════════════════════════════════════" -ForegroundColor Green
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "  Run scripts/start.ps1 to start" -ForegroundColor Green
Write-Host "══════════════════════════════════════" -ForegroundColor Green
