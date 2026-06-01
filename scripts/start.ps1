# RepoRank Start Script
# Starts the API server (includes worker). Frontend runs separately.

$ErrorActionPreference = "Stop"

# Verify required env vars
$required = @("DATABASE_URL", "REDIS_URL", "JWT_SECRET", "GEMINI_API_KEY")
$missing = @()
foreach ($var in $required) {
    $val = [Environment]::GetEnvironmentVariable($var, "Process")
    if (-not $val) {
        $missing += $var
    }
}
if ($missing.Count -gt 0) {
    Write-Error "Missing required environment variables: $($missing -join ', ')"
    Write-Host "Set them in your .env file or environment." -ForegroundColor Yellow
    exit 1
}

Write-Host "Starting RepoRank..." -ForegroundColor Cyan
Write-Host "  API: http://localhost:3001" -ForegroundColor Green
Write-Host "  Health: http://localhost:3001/health" -ForegroundColor Green

$mode = if ($args[0]) { $args[0] } else { "dev" }

if ($mode -eq "prod" -or $mode -eq "production") {
    # Build and run production
    Write-Host "Building..." -ForegroundColor Yellow
    pnpm build
    Write-Host "Starting in production mode..." -ForegroundColor Green
    Set-Location apps/api
    node dist/index.js
} else {
    # Development mode with hot reload
    Write-Host "Starting in development mode (hot reload)..." -ForegroundColor Green
    pnpm --filter @reporank/api dev
}
