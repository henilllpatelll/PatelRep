/**
 * Golden path: Housekeeping — room assignment save
 *
 * Verifies that selecting a housekeeper, tapping unassigned rooms, and hitting
 * Save results in a successful POST /housekeeping/assignments (200 OK).
 * Covers bug-301: clean_type NOT NULL constraint violation.
 */
import { test, expect } from '@playwright/test'

test.describe('Housekeeping — assignment golden path', () => {
  test('assigns rooms and saves successfully', async ({ page }) => {
    await page.goto('/housekeeping')
    await page.waitForLoadState('networkidle')

    // ── 1. Confirm the housekeeper bar is visible ─────────────────────────────
    const hkBar = page.getByTestId('hk-bar')
    if (await hkBar.count() === 0) {
      test.skip(true, 'HousekeeperBar not rendered — role may not have assignment access')
      return
    }
    await expect(hkBar).toBeVisible()

    // ── 2. Click the first housekeeper chip ───────────────────────────────────
    const chipList = page.getByTestId('hk-chip-list')
    const chips = chipList.getByRole('button')
    const chipCount = await chips.count()
    if (chipCount === 0) {
      test.skip(true, 'No housekeeper chips — no housekeeper staff exists')
      return
    }
    await chips.first().click()

    // Assignment mode activated: label changes to "Tap rooms to assign"
    await expect(page.locator('text=Tap rooms to assign')).toBeVisible({ timeout: 5_000 })

    // ── 3. Find unassigned room cards ─────────────────────────────────────────
    const assignableRooms = page.locator('[role="button"]:has(:text("Tap to assign"))')
    const roomCount = await assignableRooms.count()
    if (roomCount === 0) {
      test.skip(true, 'No rooms available for assignment — all rooms may already be assigned')
      return
    }

    await assignableRooms.first().click()
    if (roomCount >= 2) {
      await assignableRooms.nth(1).click()
    }

    // ── 4. Save — verify API responds 200 ────────────────────────────────────
    const saveButton = page.getByTestId('hk-bar').getByRole('button', { name: /Save/ })
    await expect(saveButton).toBeVisible()

    const [response] = await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/housekeeping/assignments') &&
          resp.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      saveButton.click(),
    ])

    expect(response.status()).toBe(200)

    // "Saved" confirmation badge appears
    await expect(page.locator('text=Saved')).toBeVisible({ timeout: 6_000 })
  })
})
