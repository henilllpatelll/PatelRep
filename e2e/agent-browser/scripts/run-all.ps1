<#
.SYNOPSIS
  Master runner: E2E flows + visual regression.
  Assumes auth-setup.ps1 has been run at least once.
.EXAMPLE
  .\run-all.ps1
  .\run-all.ps1 -SkipVisual
  .\run-all.ps1 -SkipE2E
  .\run-all.ps1 -Url http://localhost:3000 -Headed
#>

param(
  [string]$Url = "",
  [switch]$SkipE2E,
  [switch]$SkipVisual,
  [switch]$Headed
)

$ScriptsDir = $PSScriptRoot
$errors     = 0

Write-Host "=== PatelRep agent-browser Test Suite ==="
Write-Host "Target: $(if ($Url) { $Url } else { 'production (see config.json)' })"
Write-Host ""

if (-not $SkipE2E) {
  Write-Host "--- E2E Flows ---"
  $extraArgs = @()
  if ($Headed) { $extraArgs += "-Headed" }
  if ($Url)    { $extraArgs += "-Url"; $extraArgs += $Url }
  & "$ScriptsDir\e2e-flows.ps1" @extraArgs
  if ($LASTEXITCODE -ne 0) { $errors++ }
  Write-Host ""
}

if (-not $SkipVisual) {
  Write-Host "--- Visual Regression ---"
  $extraArgs = @()
  if ($Url) { $extraArgs += "-Url"; $extraArgs += $Url }
  & "$ScriptsDir\visual-compare.ps1" @extraArgs
  if ($LASTEXITCODE -ne 0) { $errors++ }
  Write-Host ""
}

Write-Host "=== Done - total failures: $errors ==="
if ($errors -gt 0) { exit 1 }
