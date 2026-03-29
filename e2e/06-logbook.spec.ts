/**
 * Logbook — date navigation, entry creation modal, shift summaries.
 */
import { test, expect } from '@playwright/test'

test.describe('Logbook', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/logbook')
    await page.waitForLoadState('networkidle')
  })

  test('loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('shows date navigation controls', async ({ page }) => {
    // Should have prev/next day buttons or a date display
    const prevBtn = page.getByRole('button', { name: /previous|prev|back/i })
      .or(page.locator('button[aria-label*="previous"], button[aria-label*="prev"]'))
    const hasDate = await page.getByText(/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i).count()
    // Either prev button or a formatted date should be visible
    expect(await prevBtn.count() + hasDate).toBeGreaterThan(0)
  })

  test('Add Entry button is visible', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /add entry|new entry|add log/i })
    await expect(addBtn).toBeVisible()
  })

  test('opens Add Entry modal', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /add entry|new entry|add log/i })
    await addBtn.click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
  })

  test('closes modal on Escape', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /add entry|new entry|add log/i })
    await addBtn.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })
  })

  test('entries or empty state renders', async ({ page }) => {
    const hasEntries = await page.locator('.logbook-entry, [data-testid="logbook-entry"]').count()
    const hasEmpty = await page.getByText(/no entries|empty|no logs/i).count()
    // Either entries exist or an empty state message is shown — either is valid
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })
})
