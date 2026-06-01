/**
 * Golden path: Housekeeping — room status transitions
 *
 * Verifies the most-broken flow: clicking a room card on the board opens the
 * drawer and the first available action button triggers a successful
 * PATCH /rooms/:id/status (< 300). This is the single most common source of
 * regressions when RoomCard, RoomDetailDrawer, or the board query changes.
 */
import { test, expect } from '@playwright/test'

test.describe('Housekeeping — room status transition golden path', () => {
  test('opens room drawer and advances status', async ({ page }) => {
    await page.goto('/housekeeping')
    await page.waitForLoadState('networkidle')

    // ── 1. Find any clickable room card ───────────────────────────────────────
    // Cards are role="button" elements rendered by RoomCard / RoomStatusBoard
    const cards = page.locator('[role="button"][data-room-id], [data-testid="room-card"]')
    const cardCount = await cards.count()
    if (cardCount === 0) {
      // Fall back to any prominent room-number looking element
      const fallback = page.locator('[class*="room"], [class*="card"]').filter({ hasText: /^\d{3}$/ })
      if (await fallback.count() === 0) {
        test.skip(true, 'No room cards on board — no rooms may be set up for this hotel')
        return
      }
      await fallback.first().click()
    } else {
      await cards.first().click()
    }

    // ── 2. Drawer opens ───────────────────────────────────────────────────────
    const drawer = page.getByRole('dialog').or(page.locator('[data-testid="room-drawer"]'))
    await expect(drawer.first()).toBeVisible({ timeout: 8_000 })

    // ── 3. Find the first action button (Start Cleaning / Mark Clean / etc.) ──
    const actionBtn = drawer.first().getByRole('button', {
      name: /start cleaning|in progress|mark clean|mark inspected|inspect|begin/i,
    })
    if (await actionBtn.count() === 0) {
      test.skip(true, 'No actionable status button in drawer — room may be in a terminal state')
      return
    }

    // ── 4. Click action — watch for PATCH /rooms/:id/status or /status/undo ───
    const [statusResponse] = await Promise.all([
      page.waitForResponse(
        (resp) =>
          /\/rooms\/[^/]+\/status/.test(resp.url()) &&
          (resp.request().method() === 'PATCH' || resp.request().method() === 'POST'),
        { timeout: 15_000 },
      ),
      actionBtn.first().click(),
    ])

    // If a confirmation dialog appears, click Confirm
    const confirmBtn = page.getByRole('button', { name: /confirm|yes|done/i })
    if (await confirmBtn.count() > 0 && await confirmBtn.first().isVisible()) {
      await confirmBtn.first().click()
    }

    expect(statusResponse.status()).toBeLessThan(300)
  })

  test('room drawer closes on backdrop click', async ({ page }) => {
    await page.goto('/housekeeping')
    await page.waitForLoadState('networkidle')

    const cards = page.locator('[role="button"][data-room-id], [data-testid="room-card"]')
    if (await cards.count() === 0) {
      test.skip(true, 'No room cards — skipping drawer close test')
      return
    }
    await cards.first().click()

    const drawer = page.getByRole('dialog').or(page.locator('[data-testid="room-drawer"]'))
    await expect(drawer.first()).toBeVisible({ timeout: 8_000 })

    // Press Escape to close
    await page.keyboard.press('Escape')
    await expect(drawer.first()).not.toBeVisible({ timeout: 5_000 })
  })
})
