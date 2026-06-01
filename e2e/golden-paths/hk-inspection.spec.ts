/**
 * Golden path: Housekeeping — room inspection
 *
 * Verifies that a supervisor/GM can open a Clean room from the inspection
 * queue, submit an inspection, and get a 200 from POST /housekeeping/inspections.
 * Covers bug-class: template_id null / empty items 23502.
 */
import { test, expect } from '@playwright/test'

test.describe('Housekeeping — inspection golden path', () => {
  test('inspects a room from the queue', async ({ page }) => {
    await page.goto('/housekeeping/inspections')
    await page.waitForLoadState('networkidle')

    // ── 1. Find a room in the Ready for Inspection queue ─────────────────────
    const inspectBtn = page
      .getByRole('button', { name: /^Inspect$/i })
      .or(page.getByRole('button', { name: /start inspection/i }))

    if (await inspectBtn.count() === 0) {
      test.skip(true, 'No rooms in inspection queue — all rooms may already be inspected today')
      return
    }

    await inspectBtn.first().click()

    // ── 2. Inspection modal opens ─────────────────────────────────────────────
    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible({ timeout: 8_000 })

    // ── 3. If there are checklist items, mark first one ───────────────────────
    // Items are typically rendered as buttons with Pass/Fail labels
    const passButtons = modal.getByRole('button', { name: /^Pass$/i })
    if (await passButtons.count() > 0) {
      await passButtons.first().click()
    }

    // ── 4. Set overall result if required ─────────────────────────────────────
    const passedRadio = modal
      .getByRole('radio', { name: /passed/i })
      .or(modal.getByRole('button', { name: /passed/i }))
    if (await passedRadio.count() > 0) {
      await passedRadio.first().click()
    }

    // ── 5. Submit ─────────────────────────────────────────────────────────────
    const submitBtn = modal.getByRole('button', { name: /submit|save inspection/i })
    await expect(submitBtn.first()).toBeVisible({ timeout: 5_000 })

    const [response] = await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/housekeeping/inspections') &&
          resp.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      submitBtn.first().click(),
    ])

    expect(response.status()).toBeLessThan(300)

    // Modal should close after success
    await expect(modal).not.toBeVisible({ timeout: 8_000 })
  })

  test('inspection history loads', async ({ page }) => {
    await page.goto('/housekeeping/inspections')
    await page.waitForLoadState('networkidle')

    // History section or empty state must render — no Application error
    await expect(page.locator('text=Application error')).not.toBeVisible()
    await expect(page.locator('text=Unhandled Runtime Error')).not.toBeVisible()

    // Page should have meaningful content
    const content = page.locator('h1, h2, h3, table, [class*="card"], [class*="history"], [class*="empty"]')
    await expect(content.first()).toBeVisible({ timeout: 8_000 })
  })
})
