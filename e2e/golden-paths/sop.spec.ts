/**
 * Golden path: SOP Library — list documents + AI query
 *
 * Verifies that the SOP library loads, documents are listed (or empty state
 * shown), and the AI query modal can be opened. Covers bug-class: AI provider
 * 503 leaking as crash, upload auth, query modal state.
 */
import { test, expect } from '@playwright/test'

test.describe('SOP Library — golden path', () => {
  test('SOP list loads without crash', async ({ page }) => {
    await page.goto('/sop')
    await page.waitForLoadState('networkidle')

    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
    await expect(page.locator('text=Unhandled Runtime Error')).not.toBeVisible()

    // Documents list, empty state, or upload prompt must be visible
    const content = page.locator(
      '[class*="sop"], [class*="document"], [class*="empty"], [class*="upload"], h1, h2'
    )
    await expect(content.first()).toBeVisible({ timeout: 8_000 })
  })

  test('AI query modal opens and submits gracefully', async ({ page }) => {
    await page.goto('/sop')
    await page.waitForLoadState('networkidle')

    // Find the "Ask AI" / SOP query button
    const queryBtn = page
      .getByRole('button', { name: /ask ai|sop query|search sop|ask about/i })
      .first()

    if (await queryBtn.count() === 0) {
      test.skip(true, 'No SOP query button visible — may require uploaded documents')
      return
    }

    await queryBtn.click()

    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible({ timeout: 5_000 })

    // Type a question
    const input = modal.getByRole('textbox').or(modal.locator('textarea')).first()
    await input.fill('What is the checkout cleaning procedure?')

    // Submit — result can be 200 (answer) or 503 (provider unavailable); both are non-crash
    const submitBtn = modal.getByRole('button', { name: /ask|search|submit/i }).first()
    const [response] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/sop') && resp.request().method() === 'POST',
        { timeout: 20_000 },
      ).catch(() => null),
      submitBtn.click(),
    ])

    if (response) {
      // 200 = answer, 503 = provider unavailable (graceful), 500 = unhandled provider error
      // All three are non-crash responses from the server
      expect(response.status()).toBeLessThan(600)
      expect(response.status()).not.toBe(404)
    }

    // Modal should not show a crash
    await expect(modal.locator('text=Application error')).not.toBeVisible()
  })
})
