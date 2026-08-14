/**
 * Playwright globalSetup for the FOUND-03 regression harness.
 *
 * Logs in as BOTH fixture roles (GM + housekeeping_supervisor of the
 * regression fixture tenant — see e2e/fixtures/seed-regression-tenant.mjs)
 * and saves a separate storageState per role, so the baseline spec can
 * exercise the excluded boards as two real, distinct roles.
 *
 * The housekeeping_supervisor credential is a hard prerequisite: if it is
 * missing or fails to log in, this throws and aborts the whole run rather
 * than silently falling back to a single-role capture (that would silently
 * fail FOUND-03's "at least 2 roles" requirement).
 */
import { chromium, type FullConfig } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

// This project has no "type": "module" in package.json, so Playwright's TS
// loader transpiles this file to CommonJS — `__dirname` is the Node global,
// not an ESM import.meta reference.
export const AUTH_DIR = join(__dirname, '.auth')

interface FixtureRole {
  key: 'gm' | 'supervisor'
  emailEnv: string
  passwordEnv: string
  storageStatePath: string
}

const ROLES: FixtureRole[] = [
  { key: 'gm', emailEnv: 'REGRESSION_GM_EMAIL', passwordEnv: 'REGRESSION_GM_PASSWORD', storageStatePath: join(AUTH_DIR, 'gm.json') },
  { key: 'supervisor', emailEnv: 'REGRESSION_SUP_EMAIL', passwordEnv: 'REGRESSION_SUP_PASSWORD', storageStatePath: join(AUTH_DIR, 'supervisor.json') },
]

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required env var: ${name}. The regression harness requires both fixture roles ` +
      `(GM and housekeeping_supervisor) to be present — run e2e/fixtures/seed-regression-tenant.mjs first.`,
    )
  }
  return value
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  mkdirSync(AUTH_DIR, { recursive: true })
  const baseURL =
    (config.projects[0]?.use?.baseURL as string | undefined) ??
    process.env.PLAYWRIGHT_BASE_URL ??
    'https://patelrep-production-0ad1.up.railway.app'

  const browser = await chromium.launch()
  try {
    for (const role of ROLES) {
      const email = requireEnv(role.emailEnv)
      const password = requireEnv(role.passwordEnv)

      const context = await browser.newContext({ baseURL })
      const page = await context.newPage()
      try {
        await page.goto('/login')

        const emailField = page.locator('#email-pw').or(page.locator('input[type="email"]')).first()
        await emailField.waitFor({ state: 'visible', timeout: 15000 })
        await emailField.fill(email)

        const passwordField = page.locator('input[type="password"]').first()
        await passwordField.fill(password)

        const submitButton = page
          .getByRole('button', { name: /sign in|log in|login/i })
          .or(page.locator('button[type="submit"]'))
          .first()
        await submitButton.click()

        await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20000 })

        await context.storageState({ path: role.storageStatePath })
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
}
