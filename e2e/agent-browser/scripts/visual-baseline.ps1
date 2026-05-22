<#
.SYNOPSIS
  Capture annotated baseline screenshots for every route.
  Run once to establish baselines; re-run with -Force to overwrite.
.EXAMPLE
  .\visual-baseline.ps1
  .\visual-baseline.ps1 -Url http://localhost:3000
  .\visual-baseline.ps1 -Force
#>

param(
  [string]$Url = "",
  [switch]$Force
)

$config      = Get-Content "$PSScriptRoot\..\config.json" | ConvertFrom-Json
$BaseUrl     = if ($Url) { $Url } else { $config.baseUrl }
$WaitMs      = $config.waitMs
$baselineDir = "$PSScriptRoot\..\baselines"

$env:AGENT_BROWSER_SESSION_NAME = $config.sessionName

if (-not (Test-Path $baselineDir)) {
  New-Item -ItemType Directory -Path $baselineDir | Out-Null
}

$captured = 0
$skipped  = 0
$failed   = 0

Write-Host "Capturing baselines from $BaseUrl ..."
Write-Host ""

foreach ($route in $config.routes) {
  $target = "$baselineDir\$($route.name).png"

  if ((Test-Path $target) -and -not $Force) {
    Write-Host "  SKIP  $($route.path) (already exists - use -Force to overwrite)"
    $skipped++
    continue
  }

  Write-Host "  SNAP  $($route.path)"

  agent-browser open "$BaseUrl$($route.path)"
  if ($LASTEXITCODE -ne 0) { Write-Warning "         open failed"; $failed++; continue }

  agent-browser wait $WaitMs

  agent-browser screenshot $target --annotate
  if ($LASTEXITCODE -eq 0) {
    $captured++
  } else {
    Write-Warning "         screenshot failed"
    $failed++
  }
}

Write-Host ""
Write-Host "Baseline capture complete: $captured captured, $skipped skipped, $failed failed."
Write-Host "Location: $baselineDir"

if ($failed -gt 0) { exit 1 }
