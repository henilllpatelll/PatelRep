import { chromium } from '@playwright/test'

// Checks the real, unmocked /login health-check fetch — HTML returning 200 doesn't prove NEXT_PUBLIC_API_URL is live (see buglog bug-1071).
const targets = (process.env.DEPLOYMENT_TARGETS ?? '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean)

if (targets.length === 0) {
  throw new Error('DEPLOYMENT_TARGETS is required (comma-separated list of frontend base URLs).')
}

const browser = await chromium.launch()
const failures = []

for (const baseUrl of targets) {
  const page = await browser.newPage()
  const cspViolations = []

  page.on('console', (msg) => {
    if (msg.type() === 'error' && /content security policy/i.test(msg.text())) {
      cspViolations.push(msg.text())
    }
  })

  try {
    await page.goto(new URL('/login', baseUrl).toString(), { waitUntil: 'networkidle', timeout: 30_000 })

    const healthLocator = page.getByTestId('service-health')
    await healthLocator.waitFor({ state: 'visible', timeout: 10_000 })
    // The health effect starts in a 'checking' state; give it a moment to settle.
    await page.waitForFunction(
      () => document.querySelector('[data-testid="service-health"]')?.textContent?.trim() !== '',
      { timeout: 10_000 },
    )
    const healthText = (await healthLocator.textContent())?.trim() ?? ''

    if (cspViolations.length > 0) {
      failures.push(`${baseUrl}: CSP violation(s) blocked a request:\n  ${cspViolations.join('\n  ')}`)
    } else if (!/connected/i.test(healthText)) {
      failures.push(`${baseUrl}: service-health reports "${healthText}" (expected "connected")`)
    } else {
      console.log(`OK  ${baseUrl} — service-health: "${healthText}"`)
    }
  } catch (error) {
    failures.push(`${baseUrl}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await page.close()
  }
}

await browser.close()

if (failures.length > 0) {
  console.error('\nDeployment drift check FAILED:\n')
  for (const failure of failures) {
    console.error(`- ${failure}\n`)
  }
  process.exit(1)
}

console.log('\nAll deployment targets have a live, working connection to the API.')
