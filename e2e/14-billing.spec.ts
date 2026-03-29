/**
 * Billing — usage summary, credit balance, plan details.
 */
import { test, expect } from '@playwright/test'

test.describe('Billing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/billing')
    await page.waitForLoadState('networkidle')
  })

  test('loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('renders billing info or plan details', async ({ page }) => {
    // Should show some billing content
    const hasBillingContent = await page
      .getByText(/credit|plan|billing|subscription|usage/i)
      .count()
    expect(hasBillingContent).toBeGreaterThan(0)
  })
})
