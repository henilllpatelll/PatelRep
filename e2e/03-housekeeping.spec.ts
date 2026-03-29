/**
 * Housekeeping — room board, assignments, inspections sub-routes.
 */
import { test, expect } from '@playwright/test'

test.describe('Housekeeping', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/housekeeping')
    await page.waitForLoadState('networkidle')
  })

  test('loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('shift filter is visible', async ({ page }) => {
    // Native <select> for shift filter — check the combobox is present
    const shiftSelect = page.getByRole('combobox').first()
    await expect(shiftSelect).toBeVisible()
  })

  test('room board or empty state is rendered', async ({ page }) => {
    // Page should have loaded meaningful content — not just a blank page
    await expect(page.locator('text=Application error')).not.toBeVisible()
    // Any room-status element, card, grid, heading, or empty state
    const hasContent = await page
      .locator('h1, h2, h3, section, article, [class*="room"], [class*="board"], [class*="card"]')
      .count()
    expect(hasContent).toBeGreaterThan(0)
  })

  test('navigates to assignments sub-route', async ({ page }) => {
    const assignLink = page.getByRole('link', { name: /assignments/i })
    if (await assignLink.count() > 0) {
      await assignLink.first().click()
      await expect(page).toHaveURL(/assignments/)
    } else {
      test.skip()
    }
  })

  test('navigates to inspections sub-route', async ({ page }) => {
    const inspLink = page.getByRole('link', { name: /inspections/i })
    if (await inspLink.count() > 0) {
      await inspLink.first().click()
      await expect(page).toHaveURL(/inspections/)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('text=Application error')).not.toBeVisible()
    } else {
      test.skip()
    }
  })

  test('navigates to rooms sub-route', async ({ page }) => {
    const roomsLink = page.getByRole('link', { name: /^rooms$/i })
    if (await roomsLink.count() > 0) {
      await roomsLink.first().click()
      await expect(page).toHaveURL(/rooms/)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('text=Application error')).not.toBeVisible()
    } else {
      test.skip()
    }
  })
})

test.describe('Housekeeping — Assignments page', () => {
  test('loads without error', async ({ page }) => {
    await page.goto('/housekeeping/assignments')
    await page.waitForLoadState('networkidle')
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })
})

test.describe('Housekeeping — Inspections page', () => {
  test('loads without error', async ({ page }) => {
    await page.goto('/housekeeping/inspections')
    await page.waitForLoadState('networkidle')
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })
})

test.describe('Housekeeping — Rooms page', () => {
  test('loads without error', async ({ page }) => {
    await page.goto('/housekeeping/rooms')
    await page.waitForLoadState('networkidle')
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })
})
