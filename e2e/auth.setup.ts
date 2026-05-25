/**
 * Auth setup — runs once before all tests.
 * Logs in with the GM test account and saves session cookies to disk.
 * All subsequent tests load this state instead of re-logging in.
 */
import { test as setup, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const AUTH_FILE = path.join(__dirname, '.auth/state.json')

const EMAIL = process.env.TEST_EMAIL || 'hp.patelrep@gmail.com'
const PASSWORD = process.env.TEST_PASSWORD

setup('authenticate as GM', async ({ page }) => {
  fs.rmSync(AUTH_FILE, { force: true })
  setup.skip(!PASSWORD, 'Set TEST_PASSWORD to run authenticated Playwright setup')

  await page.goto('/login')
  await expect(page.locator('#email-pw')).toBeVisible()
  await expect(page.locator('#password-pw')).toBeVisible()

  // Fill email + password
  await page.fill('#email-pw', EMAIL)
  await page.fill('#password-pw', PASSWORD!)
  await page.getByRole('button', { name: 'Sign In' }).click()

  // Login uses window.location.href — wait for navigation to dashboard/onboarding
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 20_000 })

  // Save auth state (cookies + localStorage) for reuse
  await page.context().storageState({ path: AUTH_FILE })
})
