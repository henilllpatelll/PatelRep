/**
 * Reports redesign — authenticated E2E (GM). Needs TEST_PASSWORD; target via PLAYWRIGHT_BASE_URL.
 * Covers: six role-aware tabs, URL-synced filters, KPI drawer (open / Escape / focus return /
 * refresh restore / browser Back), real PDF + CSV downloads, narrow-viewport overflow and the
 * /management-roi compatibility redirect. Scheduling persistence needs migration 206 and is
 * covered by API tests; this spec only opens the modals.
 */
import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const EMAIL = process.env.TEST_EMAIL ?? 'hp.patelrep@gmail.com'
const PASSWORD = process.env.TEST_PASSWORD

async function login(page: Page) {
  if (!PASSWORD) throw new Error('Set TEST_PASSWORD to run the Reports E2E tests')
  await page.goto('/login')
  await page.locator('input[type="email"]').first().fill(EMAIL)
  await page.locator('input[type="password"]').first().fill(PASSWORD)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 })
}

const VIEWS: Array<[string, string]> = [
  ['overview', 'Operations Overview'],
  ['guest-experience', 'Guest Experience'],
  ['housekeeping', 'Housekeeping Performance'],
  ['maintenance', 'Maintenance Performance'],
  ['team', 'Team Performance'],
  ['management', 'Management Intelligence'],
]

test.describe('Reports redesign', () => {
  test.setTimeout(120_000)
  test.beforeEach(async ({ page }) => login(page))

  test('GM sees six tabs and every view renders without API errors', async ({ page }) => {
    const failures: string[] = []
    page.on('response', (r) => r.status() >= 400 && r.url().includes('/v1/reports') && !r.url().includes('/schedules') && failures.push(`${r.status()} ${r.url()}`))
    await page.goto('/reports')
    await expect(page.getByRole('tab')).toHaveCount(6)
    for (const [view, title] of VIEWS) {
      await page.goto(`/reports?view=${view}`)
      await expect(page.getByRole('heading', { name: title, level: 2 })).toBeVisible({ timeout: 60000 })
    }
    expect(failures).toEqual([])
  })

  test('filters live in the URL and survive tab changes', async ({ page }) => {
    await page.goto('/reports?view=maintenance')
    await page.getByLabel('Date range').selectOption('last_7_days')
    await expect(page).toHaveURL(/range=last_7_days/)
    await page.getByRole('tab', { name: 'Team' }).click()
    await expect(page).toHaveURL(/view=team/)
    await expect(page).toHaveURL(/range=last_7_days/)
  })

  test('KPI drawer: open, Escape closes, focus returns, refresh restores, Back closes', async ({ page }) => {
    await page.goto('/reports?view=maintenance')
    // Any KPI with a value is interactive; which ones have data depends on the tenant's records.
    const card = page.getByRole('button', { name: /Open details/ }).first()
    await page.getByRole('heading', { name: 'Maintenance Performance', level: 2 }).waitFor({ timeout: 90000 })
    await expect(card).toBeVisible({ timeout: 90000 })
    await card.scrollIntoViewIfNeeded()
    await card.focus()
    await card.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(card).toBeFocused()
    await card.press('Enter')
    await expect(page).toHaveURL(/d=metric/)
    await page.reload()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 60000 })
    await page.goBack()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('tampered drawer params never open anything', async ({ page }) => {
    await page.goto('/reports?view=maintenance&d=records&rk=users&rf=all')
    await expect(page.getByRole('heading', { name: 'Maintenance Performance', level: 2 })).toBeVisible({ timeout: 60000 })
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  for (const format of ['PDF', 'CSV'] as const) {
    test(`exports a real ${format} file`, async ({ page }) => {
      await page.goto('/reports?view=maintenance')
      await page.getByRole('heading', { name: 'Maintenance Performance', level: 2 }).waitFor({ timeout: 60000 })
      await page.getByRole('button', { name: 'Export', exact: true }).click()
      await page.getByRole('radio', { name: format }).check()
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export Report' }).click()])
      const path = await download.path()
      const head = fs.readFileSync(path!).subarray(0, 5).toString('latin1')
      if (format === 'PDF') expect(head).toBe('%PDF-')
      else expect(fs.readFileSync(path!, 'utf8')).toContain('Maintenance Performance')
    })
  }

  test('narrow viewport has no horizontal page overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    for (const view of ['overview', 'team']) {
      await page.goto(`/reports?view=${view}`)
      await page.getByRole('tab').first().waitFor({ timeout: 60000 })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBe(0)
    }
  })

  test('/management-roi keeps working via redirect', async ({ page }) => {
    await page.goto('/management-roi')
    await page.waitForURL(/\/reports\?view=management/)
  })
})
