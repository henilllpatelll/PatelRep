/**
 * AI Copilot — currently a "coming soon" page.
 */
import { test, expect } from '@playwright/test'

test.describe('AI Copilot', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ai')
    await page.waitForLoadState('networkidle')
  })

  test('loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('shows AI Copilot heading', async ({ page }) => {
    await expect(page.getByRole('main').getByRole('heading', { name: 'AI Copilot' })).toBeVisible()
  })

  test('cancel hides pending creation controls', async ({ page }) => {
    await page.getByLabel('Message the AI Copilot').fill('Room 101 needs towels')
    await page.getByRole('button', { name: 'Send message' }).click()

    await expect(page.getByRole('button', { name: 'Confirm & Create' })).toBeVisible()

    await page.getByRole('button', { name: 'Cancel' }).click()

    await expect(page.getByRole('button', { name: 'Confirm & Create' })).toHaveCount(0)
    await expect(page.getByText(/cancelled/i)).toBeVisible()
  })
})
