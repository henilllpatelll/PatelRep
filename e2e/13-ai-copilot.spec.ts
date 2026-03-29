/**
 * AI Copilot — currently a "coming soon" page.
 */
import { test, expect } from '@playwright/test'

test.describe('AI Copilot', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ai')
    await page.waitForLoadState('networkidle')
  })

  test('loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('shows AI Copilot heading', async ({ page }) => {
    // Scope to main content area to avoid sidebar/header duplicates
    await expect(page.getByRole('main').getByText('AI Copilot')).toBeVisible()
  })

  test('shows coming soon message', async ({ page }) => {
    await expect(page.getByText(/coming soon/i)).toBeVisible()
  })
})
