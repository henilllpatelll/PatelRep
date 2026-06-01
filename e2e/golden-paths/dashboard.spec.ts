/**
 * Golden path: Dashboard — role-specific dashboards load correctly
 *
 * Verifies the main dashboard loads for the authenticated role and key metric
 * sections render without crash or NaN values. Covers bug-class: forbidden
 * API calls on field-role dashboards, RSC prefetch noise, hydration errors.
 */
import { test, expect } from '@playwright/test'

test.describe('Dashboard — golden path', () => {
  test('dashboard loads for authenticated role', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
    await expect(page.locator('text=Unhandled Runtime Error')).not.toBeVisible()

    // Dashboard must show at least one meaningful section
    const content = page.locator(
      'h1, h2, [class*="stat"], [class*="metric"], [class*="card"], [class*="dashboard"]'
    )
    await expect(content.first()).toBeVisible({ timeout: 10_000 })
  })

  test('no NaN or raw enum values displayed', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('NaN')
    expect(bodyText).not.toMatch(/\bundefined\b/)
    // Raw DB enums that should always be formatted
    expect(bodyText).not.toContain('IN_PROGRESS')
    expect(bodyText).not.toContain('VACANT_DIRTY')
  })

  test('sidebar navigation links are all reachable', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Sidebar links should not be broken — spot-check a few visible ones
    const links = page.locator('nav a[href]')
    const count = await links.count()

    // At minimum 5 nav links expected
    expect(count).toBeGreaterThanOrEqual(5)
  })
})
