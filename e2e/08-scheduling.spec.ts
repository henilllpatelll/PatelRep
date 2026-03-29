/**
 * Scheduling — calendar view, shift assignments.
 */
import { test, expect } from '@playwright/test'

test.describe('Scheduling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/scheduling')
    await page.waitForLoadState('networkidle')
  })

  test('loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('renders schedule content or empty state', async ({ page }) => {
    const hasCalendar = await page.locator('table, [role="grid"], .calendar, .schedule').count()
    const hasEmpty = await page.getByText(/no schedule|no shifts|empty/i).count()
    expect(hasCalendar + hasEmpty).toBeGreaterThan(0)
  })
})
