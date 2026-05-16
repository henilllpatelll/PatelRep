/**
 * Auth setup — runs once before all tests.
 * Logs in with the GM test account and saves session cookies to disk.
 * All subsequent tests load this state instead of re-logging in.
 */
import { test as setup, expect } from '@playwright/test'
import path from 'path'

const AUTH_FILE = path.join(__dirname, '.auth/state.json')

const EMAIL = process.env.TEST_EMAIL || 'hp.patelrep@gmail.com'
const PASSWORD = process.env.TEST_PASSWORD

setup('authenticate as GM', async ({ page }) => {
  setup.skip(!PASSWORD, 'Set TEST_PASSWORD to run authenticated Playwright setup')

  await page.goto('/login')
  await expect(page.getByRole('heading', { name: /PatelRep/i })).toBeVisible()

  // Fill email + password
  await page.fill('#email-pw', EMAIL)
  await page.fill('#password-pw', PASSWORD!)
  await page.click('button[type="submit"]')

  // Login uses window.location.href — wait for navigation to dashboard/onboarding
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 20_000 })

  // Save auth state (cookies + localStorage) for reuse
  await page.context().storageState({ path: AUTH_FILE })
})
