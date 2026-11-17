<#
  Deploy Cape May Dispatch on Legion: update the prod checkout to origin/main,
  reinstall dependencies, restart the GodsEyeView service, and verify it.

  Run from an elevated PowerShell on Legion (stopping a service needs admin):
    powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\willm\gods-eye-view-prod\scripts\legion\deploy.ps1

  Roll back to the commit that was live before (printed at the start):
    ... deploy.ps1 -Ref <commit>

  Never run this without William's go-ahead (AGENTS.md).
#>
param(
  [string]$Ref = 'origin/main',
  [string]$Dir = 'C:\Users\willm\gods-eye-view-prod',
  [string]$Service = 'GodsEyeView',
  [int]$Port = 4173
)
$ErrorActionPreference = 'Stop'
Set-Location $Dir

$before = (git rev-parse HEAD).Trim()
Write-Host "Live before deploy: $before  (roll back with -Ref $before)"

git fetch origin --prune
if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }
$target = (git rev-parse $Ref).Trim()
Write-Host "Deploying: $target"

$dirty = git status --porcelain --untracked-files=no
if ($dirty) { throw "Prod checkout has local edits; not touching it:`n$dirty" }

Write-Host "Stopping $Service..."
Stop-Service $Service
try {
  git checkout --detach $target
  if ($LASTEXITCODE -ne 0) { throw 'git checkout failed' }
  # npm ci needs the service stopped: Windows locks files the dev server uses.
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
} catch {
  Write-Warning "Deploy failed: $_  Restoring $before."
  git checkout --detach $before
  npm ci --no-audit --no-fund
  Start-Service $Service
  throw
}
Start-Service $Service
Write-Host "Started $Service. Waiting for it to answer..."

$ok = $false
for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
  Start-Sleep -Seconds 4
  try {
    $page = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 "http://127.0.0.1:$Port/"
    $ok = $page.StatusCode -eq 200 -and $page.Content -match 'Cape May Dispatch'
  } catch {}
}
if (-not $ok) {
  throw "Service did not answer with the Cape May Dispatch page on port $Port. Roll back with -Ref $before"
}
Write-Host "OK: Cape May Dispatch is live from $target (was $before)."
