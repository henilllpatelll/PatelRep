<#
.SYNOPSIS
  E2E interaction flows for the main PatelRep workflows.
  Complements Playwright specs with lightweight agent-browser spot-checks.
.EXAMPLE
  .\e2e-flows.ps1
  .\e2e-flows.ps1 -Url http://localhost:3000 -Headed
#>

param(
  [string]$Url    = "",
  [switch]$Headed
)

$config  = Get-Content "$PSScriptRoot\..\config.json" | ConvertFrom-Json
$BaseUrl = if ($Url) { $Url } else { $config.baseUrl }

$env:AGENT_BROWSER_SESSION_NAME = $config.sessionName
if ($Headed) { $env:AGENT_BROWSER_HEADED = "true" }

$passed = 0
$failed = 0

function Invoke-Flow {
  param([string]$Name, [scriptblock]$Steps)
  Write-Host "FLOW: $Name"
  try {
    & $Steps
    Write-Host "  PASS"
    $script:passed++
  } catch {
    Write-Host "  FAIL: $_"
    $script:failed++
  }
}

function Assert-NotOnLogin {
  $u = agent-browser get url 2>&1
  if ($u -match "/login") { throw "Redirected to /login - session expired or auth failed" }
}

function Assert-NoReactError {
  $snap = agent-browser snapshot 2>&1
  if ($snap -match "Application error|Unhandled Runtime Error") {
    throw "React error overlay detected on page"
  }
}

function Open-Route ([string]$Path) {
  agent-browser open "$script:BaseUrl$Path"
  if ($LASTEXITCODE -ne 0) { throw "Failed to navigate to $Path" }
  agent-browser wait $config.waitMs
}

# -- Dashboard ------------------------------------------------
Invoke-Flow "Dashboard loads" {
  Open-Route "/dashboard"
  Assert-NotOnLogin
  Assert-NoReactError
  $snap = agent-browser snapshot 2>&1
  if (-not ($snap -match "Housekeeping|Engineering|Staff|Dashboard")) {
    throw "Sidebar nav items not found in accessibility tree"
  }
}

# -- Housekeeping board ---------------------------------------
Invoke-Flow "Housekeeping board renders room content" {
  Open-Route "/housekeeping"
  Assert-NotOnLogin
  Assert-NoReactError
  $snap = agent-browser snapshot 2>&1
  if (-not ($snap -match "room|Room|board|Board|clean|Clean|dirty|Dirty|DIRTY|CLEAN|IN_PROGRESS|status|Status")) {
    throw "No room status content found on housekeeping board"
  }
}

# -- Housekeeping sub-routes ----------------------------------
Invoke-Flow "Housekeeping sub-routes are accessible" {
  Open-Route "/housekeeping/assignments"
  Assert-NotOnLogin
  Assert-NoReactError
  Open-Route "/housekeeping/rooms"
  Assert-NotOnLogin
  Assert-NoReactError
}

# -- Engineering work orders ----------------------------------
Invoke-Flow "Engineering work orders list loads" {
  Open-Route "/engineering"
  Assert-NotOnLogin
  Assert-NoReactError
  $snap = agent-browser snapshot 2>&1
  if (-not ($snap -match "work order|Work Order|maintenance|Maintenance|Unclaimed|Open|In Progress")) {
    throw "No work order content found on engineering page"
  }
}

# -- Engineering sub-routes -----------------------------------
Invoke-Flow "Engineering assets and PM schedules load" {
  Open-Route "/engineering/assets"
  Assert-NotOnLogin
  Assert-NoReactError
  Open-Route "/engineering/pm-schedules"
  Assert-NotOnLogin
  Assert-NoReactError
}

# -- Tasks ----------------------------------------------------
Invoke-Flow "Tasks page renders list or empty state" {
  Open-Route "/tasks"
  Assert-NotOnLogin
  Assert-NoReactError
}

# -- Staff ----------------------------------------------------
Invoke-Flow "Staff page renders table" {
  Open-Route "/staff"
  Assert-NotOnLogin
  Assert-NoReactError
  $snap = agent-browser snapshot 2>&1
  if (-not ($snap -match "staff|Staff|role|Role|housekeeper|Housekeeper|engineer|Engineer")) {
    throw "No staff table content found"
  }
}

# -- Guest Requests -------------------------------------------
Invoke-Flow "Guest Requests page loads" {
  Open-Route "/guest-requests"
  Assert-NotOnLogin
  Assert-NoReactError
}

# -- Lost and Found -------------------------------------------
Invoke-Flow "Lost and Found page loads" {
  Open-Route "/lost-found"
  Assert-NotOnLogin
  Assert-NoReactError
}

# -- Logbook --------------------------------------------------
Invoke-Flow "Logbook page loads" {
  Open-Route "/logbook"
  Assert-NotOnLogin
  Assert-NoReactError
}

# -- Reports --------------------------------------------------
Invoke-Flow "Reports page renders with tabs" {
  Open-Route "/reports"
  Assert-NotOnLogin
  Assert-NoReactError
  $snap = agent-browser snapshot -i 2>&1
  if (-not ($snap -match "tab|Tab|report|Report|summary|Summary|Daily")) {
    throw "No report tabs or content found"
  }
}

# -- Scheduling -----------------------------------------------
Invoke-Flow "Scheduling page loads" {
  Open-Route "/scheduling"
  Assert-NotOnLogin
  Assert-NoReactError
}

# -- SOP Library ----------------------------------------------
Invoke-Flow "SOP Library page loads" {
  Open-Route "/sop"
  Assert-NotOnLogin
  Assert-NoReactError
}

# -- AI Copilot -----------------------------------------------
Invoke-Flow "AI Copilot interface renders" {
  Open-Route "/ai"
  Assert-NotOnLogin
  Assert-NoReactError
  $snap = agent-browser snapshot 2>&1
  if (-not ($snap -match "copilot|Copilot|AI|chat|Chat|message|Message|ask|Ask")) {
    throw "AI Copilot interface not found"
  }
}

# -- Billing --------------------------------------------------
Invoke-Flow "Billing page renders without crash" {
  Open-Route "/billing"
  Assert-NotOnLogin
  Assert-NoReactError
}

# -- Settings -------------------------------------------------
Invoke-Flow "Settings page accessible" {
  Open-Route "/settings"
  Assert-NotOnLogin
  Assert-NoReactError
}

# -- Sidebar nav spot-check -----------------------------------
Invoke-Flow "Sidebar nav links present on dashboard" {
  Open-Route "/dashboard"
  Assert-NotOnLogin
  $snap = agent-browser snapshot -i 2>&1
  foreach ($link in @("Housekeeping", "Maintenance|Engineering", "Staff", "Tasks")) {
    if (-not ($snap -match $link)) { throw "Sidebar link '$link' not found" }
  }
}

# -------------------------------------------------------------
Write-Host ""
Write-Host "=== E2E Flows: PASS $passed | FAIL $failed ==="

if ($Headed) { Remove-Item Env:AGENT_BROWSER_HEADED -ErrorAction SilentlyContinue }
if ($failed -gt 0) { exit 1 }
