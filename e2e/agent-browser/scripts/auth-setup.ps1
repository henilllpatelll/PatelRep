<#
.SYNOPSIS
  One-time auth setup: saves credentials to the agent-browser vault and
  establishes a persistent named session. Run once before visual or E2E scripts.
.EXAMPLE
  Set TEST_PASSWORD in the current shell, then run .\auth-setup.ps1
.EXAMPLE
  .\auth-setup.ps1 -Url http://localhost:3000
#>

param(
  [string]$Url = "",
  [string]$Email = ""
)

$config    = Get-Content "$PSScriptRoot\..\config.json" | ConvertFrom-Json
$BaseUrl   = if ($Url)   { $Url }   else { $config.baseUrl }
$EmailAddr = if ($Email) { $Email } else { $config.email }
$Session   = $config.sessionName
$Profile   = $config.authProfile

if (-not $env:TEST_PASSWORD) {
  Write-Error "Set TEST_PASSWORD env var before running auth-setup."
  exit 1
}

Write-Host "Saving auth profile '$Profile' ..."
agent-browser auth save $Profile --url "$BaseUrl/login" --username $EmailAddr --password $env:TEST_PASSWORD
if ($LASTEXITCODE -ne 0) { Write-Error "auth save failed"; exit 1 }

$env:AGENT_BROWSER_SESSION_NAME = $Session
Write-Host "Logging in at $BaseUrl/login ..."

agent-browser open "$BaseUrl/login"
if ($LASTEXITCODE -ne 0) { Write-Error "Failed to open login page"; exit 1 }

agent-browser wait 1500
agent-browser auth login $Profile
if ($LASTEXITCODE -ne 0) { Write-Error "auth login failed"; exit 1 }

agent-browser wait 5000

$currentUrl = agent-browser get url 2>&1
Write-Host "Current URL: $currentUrl"

if ($currentUrl -match "/login") {
  Write-Error "Login failed - still on /login. Check credentials and TEST_PASSWORD."
  exit 1
}

Write-Host ""
Write-Host "Auth setup complete. Session '$Session' is ready."
Write-Host "You can now run visual-baseline.ps1 or e2e-flows.ps1."
