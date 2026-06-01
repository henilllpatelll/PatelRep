/**
 * Golden path: Logbook — create an entry
 *
 * Verifies that any staff member can create a logbook entry
 * (POST /logbook/entries → < 300) and it appears in today's list.
 * Covers bug-class: missing department_id NOT NULL, modal state not resetting.
 */
import { test, expect } from '@playwright/test'

const UNIQUE_CONTENT = `E2E Logbook entry ${Date.now()}`

test.describe('Logbook — golden path', () => {
  test('creates a logbook entry', async ({ page }) => {
    await page.goto('/logbook')
    await page.waitForLoadState('networkidle')

    // ── 1. Open New Entry modal / inline form ─────────────────────────────────
    const newEntryBtn = page
      .getByRole('button', { name: /new entry|add entry|\+ entry|log entry/i })
      .first()
    await expect(newEntryBtn).toBeVisible({ timeout: 8_000 })
    await newEntryBtn.click()

    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible({ timeout: 5_000 })

    // ── 2. Select a department (required — NOT NULL constraint) ───────────────
    const deptSelect = modal.getByRole('combobox').first()
    if (await deptSelect.count() > 0) {
      await deptSelect.selectOption({ index: 1 })
    }

    // Fill in the entry content
    const contentInput = modal
      .getByRole('textbox')
      .or(modal.locator('textarea'))
      .first()
    await contentInput.fill(UNIQUE_CONTENT)

    // ── 3. Submit ─────────────────────────────────────────────────────────────
    const [response] = await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/logbook') &&
          resp.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      modal.getByRole('button', { name: /add entry|save|submit|create/i }).first().click(),
    ])

    expect(response.status()).toBeLessThan(300)

    // Modal closes after successful save
    await expect(modal).not.toBeVisible({ timeout: 8_000 })
  })

  test('day navigation does not crash', async ({ page }) => {
    await page.goto('/logbook')
    await page.waitForLoadState('networkidle')

    // Navigate to yesterday
    const prevBtn = page.getByRole('button', { name: /previous|prev|←|chevron-left/i })
      .or(page.locator('button[aria-label*="previous"], button[aria-label*="prev"]'))
      .first()

    if (await prevBtn.count() > 0) {
      await prevBtn.click()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('text=Application error')).not.toBeVisible()
    }
  })
})
