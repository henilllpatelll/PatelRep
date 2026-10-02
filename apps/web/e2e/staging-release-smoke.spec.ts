import { expect, test, type Page } from '@playwright/test'

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
    const failures = await submitLogin(page, email)
    await page.waitForURL((url) => url.pathname === '/login' && url.searchParams.get('mobileOnly') === '1')
    await expect(page.getByRole('alert')).toContainText(/mobile app/i)

    await page.goto('/dashboard')
    await page.waitForURL((url) => url.pathname === '/login' && url.searchParams.get('mobileOnly') === '1')
    await expect(page.getByRole('alert')).toContainText(/management staff only/i)
    expect(failures, `fatal browser failures for ${role}`).toEqual([])
  })
}

test('core hotel workflows load and safe synthetic mutations succeed', async ({ page }) => {
  test.setTimeout(120_000)
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
  await page.getByRole('button', { name: /add handoff|add entry/i }).first().click()
  const message = `Staging release smoke ${Date.now()}`
  await page.getByRole('dialog').locator('textarea').fill(message)
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().includes('/logbook') && candidate.request().method() === 'POST'),
    page.getByRole('dialog').getByRole('button', { name: /add entry/i }).click(),
  ])
  expect(response.ok(), await response.text()).toBeTruthy()
  await expect(page.getByText(message, { exact: true }).first()).toBeVisible()
  expect(failures, 'fatal browser failures during workflow smoke').toEqual([])
})
