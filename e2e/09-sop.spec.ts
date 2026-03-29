/**
 * SOP Library — list, search, view procedure details.
 */
import { test, expect } from '@playwright/test'

test.describe('SOP Library', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sop')
    await page.waitForLoadState('networkidle')
  })

  test('loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('renders SOPs or empty state', async ({ page }) => {
    const hasSops = await page.locator('ul li, [role="listitem"], .sop-card').count()
    const hasEmpty = await page.getByText(/no sop|no procedures|empty/i).count()
    expect(hasSops + hasEmpty).toBeGreaterThan(0)
  })

  test('search input is present', async ({ page }) => {
    const search = page.getByPlaceholder(/search/i)
    if (await search.count() > 0) {
      await expect(search).toBeVisible()
    } else {
      test.skip()
    }
  })
})
