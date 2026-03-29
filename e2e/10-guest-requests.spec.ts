/**
 * Guest Requests — tabs, list/empty state.
 */
import { test, expect } from '@playwright/test'

test.describe('Guest Requests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/guest-requests')
    await page.waitForLoadState('networkidle')
  })

  test('loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('status tabs are rendered', async ({ page }) => {
    // Tabs: Open, In Progress, Escalated, Resolved
    await expect(page.getByRole('button', { name: 'Open' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Resolved' })).toBeVisible()
  })

  test('switching tabs does not crash', async ({ page }) => {
    await page.getByRole('button', { name: 'Resolved' }).click()
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })
})
