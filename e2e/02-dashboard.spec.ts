/**
 * Dashboard home — navigation, sidebar, and top-level metrics.
 */
import { test, expect } from '@playwright/test'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
  })

  test('loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/)
    // No uncaught React errors
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('sidebar navigation is visible', async ({ page }) => {
    // Sidebar should contain major nav links
    const nav = page.locator('nav, [role="navigation"], aside').first()
    await expect(nav).toBeVisible()
  })

  test('has link to housekeeping', async ({ page }) => {
    await expect(page.getByRole('link', { name: /housekeeping/i })).toBeVisible()
  })

  test('has link to engineering', async ({ page }) => {
    await expect(page.getByRole('link', { name: /engineering/i })).toBeVisible()
  })

  test('has link to staff', async ({ page }) => {
    await expect(page.getByRole('link', { name: /staff/i })).toBeVisible()
  })

  test('navigates to housekeeping via sidebar', async ({ page }) => {
    await page.getByRole('link', { name: /housekeeping/i }).first().click()
    await page.waitForURL('**/housekeeping**')
    await expect(page).toHaveURL(/housekeeping/)
  })
})
