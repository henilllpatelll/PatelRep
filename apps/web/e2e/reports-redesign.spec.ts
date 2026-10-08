/**
 * Reports redesign — authenticated E2E (GM). Needs TEST_PASSWORD; target via PLAYWRIGHT_BASE_URL.
 * Covers: six role-aware tabs, URL-synced filters, KPI drawer (open / Escape / focus return /
 * refresh restore / browser Back), real PDF + CSV downloads, narrow-viewport overflow and the
 * /management-roi compatibility redirect. Scheduling persistence needs migration 206 and is
 * covered by API tests; this spec only opens the modals.
 *
 * Audit additions: "All authorized reports" ZIP export, print options that really change the
 * printed page, department-filter visibility, accessibility structure (no nested interactive
 * controls, labelled dialogs, focus trap, landmarks) and a responsive matrix. Everything here is
 * read-only (GETs + downloads). Keep reloads modest: the API rate-limits /auth/* at 10/min per IP.
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

const TAB_LABELS: Record<string, string> = {
  overview: 'Overview',
  'guest-experience': 'Guest Experience',
  housekeeping: 'Housekeeping',
  maintenance: 'Maintenance',
  team: 'Team',
  management: 'Management',
}

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

  test('"All authorized reports" downloads one ZIP with a file per report', async ({ page }) => {
    await page.goto('/reports?view=overview')
    await page.getByRole('heading', { name: 'Operations Overview', level: 2 }).waitFor({ timeout: 90000 })
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await page.getByRole('dialog').getByRole('combobox').selectOption('all')
    await page.getByRole('radio', { name: 'CSV' }).check()
    await expect(page.getByRole('dialog')).toContainText('ZIP')
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.getByRole('button', { name: 'Export Report' }).click()])
    expect(download.suggestedFilename()).toMatch(/^patelrep-all-reports-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.zip$/)
    const bytes = fs.readFileSync((await download.path())!)
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK')
    const names = [...bytes.toString('latin1').matchAll(/PK\x01\x02[\s\S]{42}([\w.\-]+\.csv)/g)].map((m) => m[1].split('-20')[0])
    expect(names.sort()).toEqual(['guest-experience', 'housekeeping', 'maintenance', 'management', 'overview', 'team'])
  })

  test('print options change what is printed, and screen state resets afterwards', async ({ page }) => {
    // window.print() is stubbed to snapshot the DOM at the moment the browser would print.
    await page.addInitScript(() => {
      ;(window as any).__prints = []
      window.print = () => {
        ;(window as any).__prints.push({
          charts: document.querySelectorAll('.recharts-wrapper').length,
          definitions: !!document.getElementById('print-definitions'),
          needsAttention: [...document.querySelectorAll('h2')].some((h) => h.textContent?.trim() === 'Needs attention'),
        })
      }
    })
    const print = async (uncheck?: RegExp | string) => {
      await page.goto('/reports?view=overview')
      await page.getByRole('heading', { name: 'Operations Overview', level: 2 }).waitFor({ timeout: 90000 })
      await page.waitForTimeout(1500)
      await page.getByRole('button', { name: 'Export', exact: true }).click()
      await page.getByRole('radio', { name: 'Print-friendly' }).check()
      if (uncheck) await page.getByLabel(uncheck).uncheck()
      await page.getByRole('button', { name: 'Print', exact: true }).click()
      await page.waitForFunction(() => (window as any).__prints.length > 0)
      return page.evaluate(() => (window as any).__prints[0])
    }
    const all = await print()
    expect(all.definitions).toBe(true)
    expect(all.needsAttention).toBe(true)
    expect(all.charts).toBeGreaterThan(0)
    expect((await print(/Include charts/)).charts).toBe(0)
    expect((await print('Include exception summaries')).needsAttention).toBe(false)
    expect((await print('Include metric definitions')).definitions).toBe(false)
    await expect(page.locator('#print-definitions')).toHaveCount(0)
  })

  test('department filter appears only where the endpoint supports it', async ({ page }) => {
    const filters = page.getByRole('search', { name: 'Report filters' })
    for (const [view, expected] of [['overview', true], ['guest-experience', true], ['team', true], ['housekeeping', false], ['maintenance', false], ['management', false]] as const) {
      await page.goto(`/reports?view=${view}`)
      await page.getByRole('tab').first().waitFor({ timeout: 60000 })
      await expect(filters.getByLabel('Department')).toHaveCount(expected ? 1 : 0)
    }
  })

  test('accessibility structure: no nested interactive controls, labelled dialogs, focus trap', async ({ page }) => {
    for (const [view, title] of [['guest-experience', 'Guest Experience'], ['maintenance', 'Maintenance Performance']] as const) {
      await page.goto(`/reports?view=${view}`)
      await page.getByRole('heading', { name: title, level: 2 }).waitFor({ timeout: 90000 })
      await page.waitForTimeout(2500)
      const nested = await page.evaluate(() =>
        [...document.querySelectorAll('[role="button"], button, a[href]')].filter((el) => el.querySelector('button, a[href], [role="button"]')).length,
      )
      expect(nested, `nested interactive controls on ${view}`).toBe(0)
      expect(await page.getByRole('tablist', { name: 'Report views' }).count()).toBe(1)
      expect(await page.getByRole('tabpanel').count()).toBe(1)
      expect(await page.getByRole('heading', { level: 1 }).count()).toBeLessThanOrEqual(1)
    }
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Export Report' })
    await expect(dialog).toBeVisible()
    for (let i = 0; i < 25; i++) await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true) // focus stays trapped
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })

  test('responsive: no horizontal overflow at phone, tablet and desktop widths on every view', async ({ page }, testInfo) => {
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      // One page load per width; views are switched through the tabs (client-side) so the run stays
      // well under the API's /auth/* rate limit.
      await page.goto('/reports?view=overview')
      for (const [view, title] of VIEWS) {
        await page.getByRole('tab', { name: TAB_LABELS[view], exact: true }).click()
        await expect(page).toHaveURL(new RegExp(`view=${view}`))
        await page.getByRole('heading', { name: title, level: 2 }).waitFor({ timeout: 90000 })
        await page.waitForTimeout(800)
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${view} @${width}`).toBe(0)
      }
      // Visual record for reviewers (not a pixel baseline: this tenant's live data is not deterministic).
      await testInfo.attach(`reports-overview-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    }
  })

  test('/management-roi keeps working via redirect', async ({ page }) => {
    await page.goto('/management-roi')
    await page.waitForURL(/\/reports\?view=management/)
  })
})
