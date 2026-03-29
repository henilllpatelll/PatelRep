/**
 * Settings — hotel profile, Opera integration toggle.
 */
import { test, expect } from '@playwright/test'

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
  })

  test('loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('renders settings content', async ({ page }) => {
    const hasContent = await page
      .getByText(/settings|hotel|profile|integration|opera/i)
      .count()
    expect(hasContent).toBeGreaterThan(0)
  })
})
