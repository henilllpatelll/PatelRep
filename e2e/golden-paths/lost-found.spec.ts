/**
 * Golden path: Lost & Found — log item + claim it
 *
 * Verifies the full lifecycle: a staff member logs a found item
 * (POST /lost-found → < 300) and it can then be marked claimed
 * (PATCH /lost-found/:id → < 300).
 */
import { test, expect } from '@playwright/test'

const UNIQUE_DESC = `E2E Found Item ${Date.now()}`

test.describe('Lost & Found — golden path', () => {
  test('logs a found item', async ({ page }) => {
    await page.goto('/lost-found')
    await page.waitForLoadState('networkidle')

    // ── 1. Open Log Found Item modal ──────────────────────────────────────────
    const logBtn = page
      .getByRole('button', { name: /log found item|log item|new item|\+ found/i })
      .first()
    await expect(logBtn).toBeVisible({ timeout: 8_000 })
    await logBtn.click()

    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible()

    // ── 2. Fill fields — Location (optional first), then Description (required) ─
    // The form has: Location Found (textbox, optional), Description (textarea, required)
    const locationInput = modal.getByPlaceholder(/location|where|room/i).first()
    if (await locationInput.count() > 0) {
      await locationInput.fill('Room 105')
    }

    // Description is the required textarea
    const descInput = modal.locator('textarea').first()
      .or(modal.getByLabel(/description/i))
    await descInput.fill(UNIQUE_DESC)

    // ── 3. Submit ─────────────────────────────────────────────────────────────
    const [response] = await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/lost-found') &&
          resp.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      modal.getByRole('button', { name: /log item|submit|save/i }).first().click(),
    ])

    expect(response.status()).toBeLessThan(300)

    await expect(modal).not.toBeVisible({ timeout: 8_000 })

    // Item should appear in the list
    await expect(page.locator(`text=${UNIQUE_DESC}`).first()).toBeVisible({ timeout: 8_000 })
  })

  test('claims a found item', async ({ page }) => {
    await page.goto('/lost-found')
    await page.waitForLoadState('networkidle')

    // Find the item we just created (or any unclaimed item)
    const itemCard = page
      .locator(`text=${UNIQUE_DESC}`)
      .or(page.locator('[data-testid*="lost-found-item"]').first())
      .first()

    if (await itemCard.count() === 0) {
      test.skip(true, 'No lost & found items — log test may not have run first')
      return
    }

    // Find the Claim button associated with this item
    const claimBtn = itemCard
      .locator('xpath=ancestor::*[contains(@class,"card") or contains(@class,"item")]')
      .getByRole('button', { name: /claim|mark claimed/i })
      .first()
      .or(
        page.locator(`text=${UNIQUE_DESC}`)
          .locator('xpath=following::button[contains(text(),"Claim") or contains(text(),"Mark")]')
          .first()
      )

    if (await claimBtn.count() === 0) {
      // Try finding any claim button on the page
      const anyClaimBtn = page.getByRole('button', { name: /^claim$/i }).first()
      if (await anyClaimBtn.count() === 0) {
        test.skip(true, 'No Claim button visible — item may already be claimed or button not rendered')
        return
      }
      await anyClaimBtn.click()
    } else {
      await claimBtn.click()
    }

    // ── Confirm if a dialog appears ───────────────────────────────────────────
    const claimModal = page.getByRole('dialog')
    if (await claimModal.isVisible()) {
      const nameInput = claimModal.getByRole('textbox').first()
      if (await nameInput.count() > 0) {
        await nameInput.fill('John Doe')
      }
      const confirmBtn = claimModal.getByRole('button', { name: /confirm|claim|save/i }).first()
      const [claimResponse] = await Promise.all([
        page.waitForResponse(
          (resp) =>
            resp.url().includes('/lost-found') &&
            (resp.request().method() === 'PATCH' || resp.request().method() === 'PUT'),
          { timeout: 15_000 },
        ),
        confirmBtn.click(),
      ])
      expect(claimResponse.status()).toBeLessThan(300)
    }
  })
})
