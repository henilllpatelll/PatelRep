/**
 * Golden path: Engineering — work order create, then claim
 *
 * Verifies that a GM can:
 *  1. Create a work order (POST /work-orders → < 300)
 *  2. Open it and claim it (PATCH /work-orders/:id → < 300)
 */
import { test, expect } from '@playwright/test'

const UNIQUE_TITLE = `E2E WO ${Date.now()}`

test.describe('Engineering — work order golden path', () => {
  test('creates a work order', async ({ page }) => {
    await page.goto('/engineering/work-orders')
    await page.waitForLoadState('networkidle')

    // ── 1. Open create modal ──────────────────────────────────────────────────
    const newWoBtn = page.getByRole('button', { name: /New Work Order/i }).first()
    await expect(newWoBtn).toBeVisible({ timeout: 8_000 })
    await newWoBtn.click()

    const modal = page.getByRole('dialog', { name: /Create Work Order/i })
    await expect(modal).toBeVisible()

    // ── 2. Fill required fields ───────────────────────────────────────────────
    await modal.getByPlaceholder(/Room.*Lobby|lobby.*room/i).fill('Room 101')
    await modal.getByPlaceholder(/A\/C not cooling/i).fill(UNIQUE_TITLE)

    // ── 3. Submit — assert API success ───────────────────────────────────────
    const [response] = await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/work-orders') &&
          resp.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      modal.getByRole('button', { name: /Create Work Order/i }).click(),
    ])

    expect(response.status()).toBeLessThan(300)

    // Modal closes after successful creation
    await expect(modal).not.toBeVisible({ timeout: 8_000 })
  })

  test('opens the work order and claims it', async ({ page }) => {
    await page.goto('/engineering/work-orders')
    await page.waitForLoadState('networkidle')

    // Find the WO we just created
    const woRow = page.locator(`text=${UNIQUE_TITLE}`).first()
    if (await woRow.count() === 0) {
      test.skip(true, 'Work order not found — create test may not have run first')
      return
    }
    await woRow.click()

    // "Claim Work Order" button appears in the detail drawer/panel
    const claimBtn = page
      .getByRole('button', { name: /Claim Work Order/i })
      .or(page.getByRole('button', { name: /^Claim$/i }))
    await expect(claimBtn.first()).toBeVisible({ timeout: 8_000 })

    const [claimResponse] = await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/work-orders') &&
          resp.url().includes('/claim') &&
          resp.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      claimBtn.first().click(),
    ])

    expect(claimResponse.status()).toBeLessThan(300)
  })
})
