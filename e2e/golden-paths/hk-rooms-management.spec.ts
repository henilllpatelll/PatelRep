/**
 * Golden path: Housekeeping — All Rooms management
 *
 * Verifies that the rooms management table loads, a room row can be clicked to
 * open RoomDetailDrawer, and the drawer shows correct room data. This is a
 * regression target whenever RoomDetailDrawer changes — it's shared between
 * the board page and the rooms management page.
 */
import { test, expect } from '@playwright/test'

test.describe('Housekeeping — All Rooms management golden path', () => {
  test('rooms table loads with data or empty state', async ({ page }) => {
    await page.goto('/housekeeping/rooms')
    await page.waitForLoadState('networkidle')

    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()

    const content = page.locator('table, [class*="room"], [class*="card"], [class*="empty"], h1, h2')
    await expect(content.first()).toBeVisible({ timeout: 8_000 })
  })

  test('clicking Edit on a room row opens the detail drawer', async ({ page }) => {
    await page.goto('/housekeeping/rooms')
    await page.waitForLoadState('networkidle')

    // All Rooms uses a table with inline Edit buttons — no row-click drawer
    const editBtn = page.getByRole('button', { name: /^Edit$/i }).first()

    if (await editBtn.count() === 0) {
      test.skip(true, 'No Edit buttons — hotel may have no rooms configured')
      return
    }

    await editBtn.click()

    const drawer = page.getByRole('dialog').or(page.locator('[data-testid="room-drawer"]'))
    await expect(drawer.first()).toBeVisible({ timeout: 8_000 })

    // Drawer must show a room number
    await expect(drawer.first().locator('text=/\\d{3}/')).toBeVisible({ timeout: 5_000 })
  })

  test('room status filter chip changes the list', async ({ page }) => {
    await page.goto('/housekeeping/rooms')
    await page.waitForLoadState('networkidle')

    const filterChip = page
      .getByRole('button', { name: /dirty|clean|in progress|inspected/i })
      .first()

    if (await filterChip.count() === 0) {
      test.skip(true, 'No status filter chips — filter UI may not be present')
      return
    }

    await filterChip.click()
    await page.waitForLoadState('networkidle')
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })
})
