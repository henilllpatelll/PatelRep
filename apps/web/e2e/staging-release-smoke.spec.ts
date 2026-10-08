import { expect, test, type Page } from '@playwright/test'
import { filterExpectedUnauthorized, filterTransientRateLimits, type ObservedRateLimit } from '../lib/utils/smokeFailures'

const password = process.env.STAGING_FIXTURE_PASSWORD
const webRoles = [
  ['GM', 'staging-gm@patelrep.test', '/dashboard'],
  ['front desk', 'staging-front-desk@patelrep.test', '/tasks?type=guest_request'],
  ['housekeeping supervisor', 'staging-housekeeping-supervisor@patelrep.test', '/housekeeping'],
  ['chief engineer', 'staging-chief-engineer@patelrep.test', '/engineering?tab=work-orders'],
] as const

const mobileOnlyRoles = [
  ['housekeeper', 'staging-housekeeper@patelrep.test'],
  ['engineer', 'staging-engineer@patelrep.test'],
] as const

async function submitLogin(page: Page, email: string) {
  if (!password) throw new Error('STAGING_FIXTURE_PASSWORD is required for staging release smoke.')
  const failures: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') failures.push(message.text()) })
  page.on('response', (response) => { if (response.status() >= 500) failures.push(`${response.status()} ${response.url()}`) })
  await page.goto('/login')
  await page.locator('#email-pw').or(page.locator('input[type="email"]')).first().fill(email)
  await page.locator('input[type="password"]').first().fill(password)
  await page.getByRole('button', { name: /sign in|log in|login/i }).or(page.locator('button[type="submit"]')).first().click()
  return failures
}

async function loginToWebPortal(page: Page, email: string) {
  const failures = await submitLogin(page, email)
  await page.waitForURL((url) => !url.pathname.includes('/login'))
  return failures
}

for (const [role, email, landing] of webRoles) {
  test(`${role} can authenticate and reach its operational landing route`, async ({ page }) => {
    const failures = await loginToWebPortal(page, email)
    await page.goto(landing)
    await expect(page.locator('main')).toBeVisible()
    expect(failures, `fatal browser failures for ${role}`).toEqual([])
  })
}

for (const [role, email] of mobileOnlyRoles) {
  test(`${role} is authenticated but restricted to the mobile app`, async ({ page }) => {
    // The restricted-role flow signs the session out right after sign-in, so requests the page makes
    // around that moment may answer 401. The browser logs each as a URL-less generic console error and
    // it is not always the Supabase logout endpoint, so tolerate one console 401 per observed 401 response.
    let unauthorizedResponses = 0
    page.on('response', (response) => { if (response.status() === 401) unauthorizedResponses += 1 })
    const allFailures = await submitLogin(page, email)
    // Password sign-in of a floor role is rejected in place on /login (inline alert, session signed out).
    // The ?mobileOnly=1 redirect only comes from the route guard / auth callback, so accept either alert.
    const mobileOnlyAlert = page.getByRole('alert').filter({ hasText: /restricted to Front Desk, GM, and Supervisor staff|Web portal is for management staff only/ })
    await expect(mobileOnlyAlert).toContainText(/mobile app/i, { timeout: 30_000 })
    expect(new URL(page.url()).pathname).toBe('/login')

    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login\?(?:mobileOnly=1|redirectTo=%2Fdashboard)/)
    await expect(page.getByRole('heading', { name: /welcome back to your hotel/i })).toBeVisible()
    const failures = filterExpectedUnauthorized(allFailures, unauthorizedResponses)
    expect(failures, `fatal browser failures for ${role}`).toEqual([])
  })
}

test('core hotel workflows load and safe synthetic mutations succeed', async ({ page }) => {
  test.setTimeout(120_000)
  const rateLimits: ObservedRateLimit[] = []
  page.on('response', (response) => { if (response.status() === 429) rateLimits.push({ method: response.request().method() }) })
  const failures = await loginToWebPortal(page, 'staging-gm@patelrep.test')
  await page.goto('/housekeeping')
  await expect(page.getByText('101', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  await page.goto('/engineering?tab=work-orders')
  await expect(page.getByText('Synthetic staging PTAC check', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  await page.goto('/engineering?tab=assets')
  await expect(page.getByText('Synthetic PTAC 101', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  await page.goto('/tasks')
  await expect(page.getByText('Synthetic staging towel delivery', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  await page.goto('/tasks?type=guest_request')
  await expect(page.getByText('Synthetic extra towels', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  await page.goto('/lost-found')
  await expect(page.getByText('Synthetic blue umbrella', { exact: true }).first()).toBeVisible({ timeout: 30_000 })

  await page.goto('/logbook')
  await page.getByRole('button', { name: 'Add Handoff', exact: true }).click()
  const message = `Staging release smoke ${Date.now()}`
  const handoffDialog = page.getByRole('dialog')
  await handoffDialog.locator('#handoff-content').fill(message)
  const submitHandoff = handoffDialog.getByRole('button', { name: /add handoff|add entry/i })
  await expect(submitHandoff).toBeEnabled({ timeout: 30_000 })
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().includes('/logbook/entries') && candidate.request().method() === 'POST'),
    submitHandoff.click(),
  ])
  expect(response.ok(), await response.text()).toBeTruthy()
  // The POST above already proved the write succeeded. The in-page list refresh
  // after it is asynchronous and raced the default 5s expect timeout on staging,
  // so give it a realistic window, then fall back to a reload to prove persistence.
  const createdEntry = page.getByText(message, { exact: true }).first()
  await expect(async () => {
    if (!(await createdEntry.isVisible())) await page.reload()
    await expect(createdEntry).toBeVisible({ timeout: 10_000 })
  }).toPass({ timeout: 45_000 })
  // Every page above asserted its synthetic data rendered, so a transient read 429 did not hide content.
  expect(filterTransientRateLimits(failures, rateLimits), 'fatal browser failures during workflow smoke').toEqual([])
})
