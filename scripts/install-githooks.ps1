#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Installs RepoRank git hooks for quality gating.
.DESCRIPTION
  Copies the pre-commit hook from scripts/ to .git/hooks/.
  Also attempts to set up a global git template for new repos.
.PARAMETER RepoDir
  Path to the repository to install hooks in (default: current directory).
.EXAMPLE
  .\install-githooks.ps1
  .\install-githooks.ps1 -RepoDir C:\Projects\my-app
#>

param(
  [string]$RepoDir = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

# Find RepoRank root (this script lives in reporank/scripts/)
$ScriptDir = Split-Path -Parent $PSCommandPath
$RepoRankDir = Split-Path -Parent $ScriptDir

# Validate
$HookSource = Join-Path $ScriptDir "pre-commit"
if (-not (Test-Path $HookSource)) {
  Write-Error "Pre-commit hook not found at: $HookSource"
  exit 1
}

$GitDir = Join-Path $RepoDir ".git"
$HooksDir = Join-Path $GitDir "hooks"
if (-not (Test-Path $HooksDir)) {
  Write-Error "Not a git repository or no .git/hooks directory: $RepoDir"
  exit 1
}

$HookDest = Join-Path $HooksDir "pre-commit"

# Check if a hook already exists
if (Test-Path $HookDest) {
  $existing = Get-Content $HookDest -TotalCount 3 -ErrorAction SilentlyContinue
  if ($existing -join " " -match "RepoRank") {
    Write-Host "  ✓ RepoRank pre-commit hook already installed in $RepoDir" -ForegroundColor Green
    exit 0
  }
  $backup = "$HookDest.reporank-backup"
  Copy-Item $HookDest $backup -Force
  Write-Host "  → Backed up existing hook to $backup" -ForegroundColor Yellow
}

# Copy the hook
Copy-Item $HookSource $HookDest -Force
Write-Host "  ✓ Installed RepoRank pre-commit hook in $RepoDir" -ForegroundColor Green
Write-Host ""
Write-Host "  The hook will run RepoRank analysis on every commit."
Write-Host "  Configure via environment variables:"
Write-Host "    REPORANK_THRESHOLD  (default: 50)"
Write-Host "    REPORANK_MAX_SECRETS (default: 0)"
Write-Host ""
Write-Host "  Skip the hook: git commit --no-verify"
Write-Host ""
