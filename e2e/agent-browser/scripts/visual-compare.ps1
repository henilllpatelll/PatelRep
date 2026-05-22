<#
.SYNOPSIS
  Capture current screenshots for every route and diff against baselines.
  Exits non-zero if any route has a visual regression.
  Run visual-baseline.ps1 first to establish baselines.
.EXAMPLE
  .\visual-compare.ps1
  .\visual-compare.ps1 -Url http://localhost:3000
#>

param(
  [string]$Url = ""
)

$config      = Get-Content "$PSScriptRoot\..\config.json" | ConvertFrom-Json
$BaseUrl     = if ($Url) { $Url } else { $config.baseUrl }
$WaitMs      = $config.waitMs
$baselineDir = "$PSScriptRoot\..\baselines"
$capturesDir = "$PSScriptRoot\..\captures"
$reportsDir  = "$PSScriptRoot\..\reports"

$env:AGENT_BROWSER_SESSION_NAME = $config.sessionName

if (-not (Test-Path $baselineDir)) {
  Write-Error "No baselines found. Run visual-baseline.ps1 first."
  exit 1
}

foreach ($dir in @($capturesDir, $reportsDir)) {
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
}

$passed  = 0
$failed  = 0
$skipped = 0
$results = @()

Write-Host "Visual regression: $BaseUrl"
Write-Host ""

foreach ($route in $config.routes) {
  $name     = $route.name
  $path     = $route.path
  $baseline = "$baselineDir\$name.png"
  $capture  = "$capturesDir\$name.png"

  if (-not (Test-Path $baseline)) {
    Write-Host "  SKIP  $path (no baseline)"
    $skipped++
    $results += @{ route = $path; result = "SKIP"; reason = "no baseline" }
    continue
  }

  agent-browser open "$BaseUrl$path"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  FAIL  $path (navigation error)"
    $failed++
    $results += @{ route = $path; result = "FAIL"; reason = "navigation error" }
    continue
  }

  agent-browser wait $WaitMs
  agent-browser screenshot $capture
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  FAIL  $path (screenshot error)"
    $failed++
    $results += @{ route = $path; result = "FAIL"; reason = "screenshot error" }
    continue
  }

  $diffOut = agent-browser diff screenshot --baseline $baseline 2>&1
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  PASS  $path"
    $passed++
    $results += @{ route = $path; result = "PASS"; reason = "" }
  } else {
    Write-Host "  FAIL  $path (visual diff)"
    if ($diffOut) { Write-Host "        $diffOut" }
    $failed++
    $results += @{ route = $path; result = "FAIL"; reason = "visual diff" }
  }
}

Write-Host ""
Write-Host "=== Visual Regression: PASS $passed | FAIL $failed | SKIP $skipped ==="

$reportPath = "$reportsDir\visual-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
$results | ConvertTo-Json -Depth 3 | Out-File -FilePath $reportPath -Encoding utf8
Write-Host "Report: $reportPath"

if ($failed -gt 0) { exit 1 }
