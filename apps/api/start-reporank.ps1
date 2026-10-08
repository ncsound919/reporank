$ErrorActionPreference = 'Stop'

# RepoRank — GitHub/local repo ranking, one of the audit suite's two LLM
# repo graders.
#
# Repair history (2026-09-29): this checkout still pointed 1191 node_modules
# junctions at the deleted Draymond-Orchestrator monorepo, so prisma could not
# even load the schema. Those were re-aimed at this workspace's own .pnpm store
# (INFRASTRUCTURE\repair-junctions.mjs), after which `prisma db push` reported
# "Your database is now in sync with your Prisma schema."
#
# Database: apps/api/.env wins over the repo-root .env and declares
#   postgresql://postgres@127.0.0.1:5432/reporank
# PostgreSQL runs in WSL2 (the native 18.3 build crashes its own backends on
# this host). Run INFRASTRUCTURE\start-fleet-db.ps1 first — without it this
# service boots and then fails on its first query.
#
# Port 3200 is what openhub's REPORANK_URL already expects.

$root = 'C:\Users\User\Downloads\BUSINESS\INFRASTRUCTURE\reporank\apps\api'
$port = 3200

if (-not (Test-Path -LiteralPath $root)) { throw "reporank api root not found: $root" }

if (-not (Test-NetConnection -ComputerName 127.0.0.1 -Port 5432 -WarningAction SilentlyContinue -InformationLevel Quiet)) {
  Write-Warning 'PostgreSQL is not reachable on 127.0.0.1:5432. Run start-fleet-db.ps1 first.'
}

if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "Already listening on :$port"
  exit 0
}

$env:PORT = "$port"

$proc = Start-Process -FilePath 'npx.cmd' `
  -ArgumentList 'tsx', 'src/index.ts' `
  -WorkingDirectory $root `
  -NoNewWindow -PassThru `
  -RedirectStandardOutput "$root\reporank.log" `
  -RedirectStandardError "$root\reporank.err"

Write-Host "PID:  $($proc.Id)"
$proc.Id | Out-File "$root\reporank.pid"
Write-Host "API:  http://127.0.0.1:$port"
Write-Host "Logs: reporank.log / reporank.err"
Start-Sleep 30
