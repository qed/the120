<#
.SYNOPSIS
  Create a new parallel work lane as a git worktree of this repo.

.DESCRIPTION
  Worktrees isolate files. This script also handles the three things git does not:
  the gitignored .env.local, a per-lane dev port, and a dependency install.

  See docs/LANES.md for the shared-state rules that worktrees do NOT solve
  (migrations, the Stripe listener, the vitest allowlist, rebase discipline).

.EXAMPLE
  .\scripts\new-lane.ps1 -Name funnel -Branch feat/funnel-unit-1 -Port 3001
#>
[CmdletBinding()]
param(
  # Lane name. The worktree is created as a sibling directory named 120-<Name>.
  [Parameter(Mandatory = $true)][string]$Name,

  # Branch to create in the new worktree. Cannot be a branch checked out elsewhere.
  [Parameter(Mandatory = $true)][string]$Branch,

  # Dev server port for this lane. Lane A holds 3000.
  [Parameter(Mandatory = $true)][int]$Port,

  # Skip npm ci (you will need to run it yourself before the lane can build or test).
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

$repoRoot = (& git rev-parse --show-toplevel)
if (-not $?) { throw "Not inside a git repository." }
$repoRoot = $repoRoot -replace '/', '\'

$target = Join-Path (Split-Path $repoRoot -Parent) "120-$Name"

if (Test-Path $target) {
  throw "$target already exists. Remove it, or pick another -Name."
}

# .env.local is gitignored and holds live Stripe + service-role keys. A worktree
# gets none of it, and without it the lane cannot build, test, or run.
$envSource = Join-Path $repoRoot '.env.local'
if (-not (Test-Path $envSource)) {
  throw ".env.local not found at $envSource. A lane without it cannot run; create it first."
}

Write-Host "Creating worktree $target on branch $Branch ..." -ForegroundColor Cyan
& git worktree add $target -b $Branch
if ($LASTEXITCODE -ne 0) { throw "git worktree add failed." }

# Copied, not symlinked: each lane may need to diverge (different NEXT_PUBLIC_SITE_URL,
# a different Stripe webhook secret while the other lane holds the listener).
Write-Host "Copying .env.local ..." -ForegroundColor Cyan
Copy-Item $envSource (Join-Path $target '.env.local')

if ($SkipInstall) {
  Write-Host "Skipping npm ci (-SkipInstall)." -ForegroundColor Yellow
} else {
  Write-Host "Running npm ci (this takes a few minutes) ..." -ForegroundColor Cyan
  Push-Location $target
  try {
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed in $target." }
  } finally {
    Pop-Location
  }
}

Write-Host ""
Write-Host "Lane '$Name' ready." -ForegroundColor Green
Write-Host ""
Write-Host "  cd $target"
Write-Host "  npm run dev -- -p $Port"
Write-Host "  npm test"
Write-Host ""
Write-Host "Port goes on the command line, never in package.json - a tracked-file edit that"
Write-Host "serves one worktree becomes a phantom diff in every PR that lane opens."
Write-Host ""
Write-Host "Read docs/LANES.md before the first commit. Migrations are locked to one lane"
Write-Host "at a time (supabase/MIGRATION-LOCK.md); both worktrees share one live database."
