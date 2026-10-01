import { expect, test, type Page } from '@playwright/test'

const password = process.env.STAGING_FIXTURE_PASSWORD
const roles = [
  ['GM', 'staging-gm@patelrep.test', '/dashboard'],
  ['front desk', 'staging-front-desk@patelrep.test', '/tasks?type=guest_request'],
  ['housekeeping supervisor', 'staging-housekeeping-supervisor@patelrep.test', '/housekeeping'],
  ['housekeeper', 'staging-housekeeper@patelrep.test', '/housekeeping'],
  ['chief engineer', 'staging-chief-engineer@patelrep.test', '/engineering?tab=work-orders'],
  ['engineer', 'staging-engineer@patelrep.test', '/engineering?tab=work-orders'],
] as const

async function login(page: Page, email: string) {
  if (!password) throw new Error('STAGING_FIXTURE_PASSWORD is required for staging release smoke.')
  const failures: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') failures.push(message.text()) })
  page.on('response', (response) => { if (response.status() >= 500) failures.push(`${response.status()} ${response.url()}`) })
  await page.goto('/login')
  await page.locator('#email-pw').or(page.locator('input[type="email"]')).first().fill(email)
  await page.locator('input[type="password"]').first().fill(password)
  await page.getByRole('button', { name: /sign in|log in|login/i }).or(page.locator('button[type="submit"]')).first().click()
  await page.waitForURL((url) => !url.pathname.includes('/login'))
  return failures
}

for (const [role, email, landing] of roles) {
  test(`${role} can authenticate and reach its operational landing route`, async ({ page }) => {
    const failures = await login(page, email)
    await page.goto(landing)
    await expect(page.locator('main').or(page.locator('body'))).toContainText(/\S/)
    expect(failures, `fatal browser failures for ${role}`).toEqual([])
  })
}

test('core hotel workflows load and safe synthetic mutations succeed', async ({ page }) => {
  const failures = await login(page, 'staging-gm@patelrep.test')
  await page.goto('/housekeeping')
  await expect(page.getByText('101', { exact: true }).first()).toBeVisible()
  await page.goto('/engineering?tab=work-orders')
  await expect(page.getByText('Synthetic staging PTAC check', { exact: true }).first()).toBeVisible()
  await page.goto('/engineering?tab=assets')
  await expect(page.getByText('Synthetic PTAC 101', { exact: true }).first()).toBeVisible()
  await page.goto('/tasks')
  await expect(page.getByText('Synthetic staging towel delivery', { exact: true }).first()).toBeVisible()
  await page.goto('/tasks?type=guest_request')
  await expect(page.getByText('Synthetic extra towels', { exact: true }).first()).toBeVisible()
  await page.goto('/lost-found')
  await expect(page.getByText('Synthetic blue umbrella', { exact: true }).first()).toBeVisible()

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
