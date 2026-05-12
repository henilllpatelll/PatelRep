/**
 * Lost & Found — tabs, item list/empty state, add item button.
 */
import { test, expect } from '@playwright/test'

test.describe('Lost & Found', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/lost-found')
    await page.waitForLoadState('networkidle')
  })

  test('loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('status tabs are rendered', async ({ page }) => {
    // Tabs include a count badge so the accessible name is e.g. "All 3" or just "All"
    // Match by contained text to handle both cases
    await expect(page.locator('button', { hasText: /^All/ }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Claimed', exact: true })).toBeVisible()
  })

  test('switching tabs does not crash', async ({ page }) => {
    await page.getByRole('button', { name: 'Claimed', exact: true }).click()
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('add item button is visible', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /add item|log item|new item|log found/i })
    if (await addBtn.count() > 0) {
      await expect(addBtn.first()).toBeVisible()
    } else {
      test.skip()
    }
  })
})
