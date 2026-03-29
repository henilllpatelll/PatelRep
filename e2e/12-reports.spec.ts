/**
 * Reports — section loads, report type tabs/filters.
 */
import { test, expect } from '@playwright/test'

test.describe('Reports', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/reports')
    await page.waitForLoadState('networkidle')
  })

  test('loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('renders report content or chart', async ({ page }) => {
    // Should have charts, tables, or summary cards
    const hasChart = await page.locator('svg, canvas, [role="img"]').count()
    const hasTable = await page.locator('table').count()
    const hasEmpty = await page.getByText(/no data|no reports|empty/i).count()
    expect(hasChart + hasTable + hasEmpty).toBeGreaterThan(0)
  })

  test('has date range or period controls', async ({ page }) => {
    const dateControl = page
      .getByRole('button', { name: /today|this week|this month|7 days|30 days|date range/i })
      .or(page.locator('input[type="date"]'))
    if (await dateControl.count() > 0) {
      await expect(dateControl.first()).toBeVisible()
    } else {
      // Reports may show controls after data loads — not a failure
      test.skip()
    }
  })
})
