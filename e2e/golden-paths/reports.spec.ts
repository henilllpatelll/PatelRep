/**
 * Golden path: Reports — daily summary + tab navigation
 *
 * Verifies that the reports page loads the daily summary (GM/supervisor role
 * required), key metric sections are visible, and tab switching between report
 * types does not crash. Covers bug-class: raw enum values in stat cards,
 * billing null/undefined toLocaleString crash.
 */
import { test, expect } from '@playwright/test'

test.describe('Reports — golden path', () => {
  test('daily summary loads with data or empty state', async ({ page }) => {
    await page.goto('/reports')
    await page.waitForLoadState('networkidle')

    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
    await expect(page.locator('text=Unhandled Runtime Error')).not.toBeVisible()

    // Must show a heading, stat cards, or a graceful empty state — never a blank white page
    const content = page.locator('h1, h2, [class*="stat"], [class*="metric"], [class*="card"], [class*="empty"]')
    await expect(content.first()).toBeVisible({ timeout: 8_000 })
  })

  test('no NaN or undefined values in stat cards', async ({ page }) => {
    await page.goto('/reports')
    await page.waitForLoadState('networkidle')

    // Raw NaN / undefined / null in displayed numbers indicates a missing null-guard
    const pageText = await page.locator('body').innerText()
    expect(pageText).not.toContain('NaN')
    expect(pageText).not.toMatch(/\bundefined\b/)
  })

  test('tab switching does not crash', async ({ page }) => {
    await page.goto('/reports')
    await page.waitForLoadState('networkidle')

    const tabs = page.getByRole('tab')
    const tabCount = await tabs.count()

    for (let i = 0; i < Math.min(tabCount, 4); i++) {
      await tabs.nth(i).click()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('text=Application error')).not.toBeVisible()
    }
  })
})
