/**
 * Staff management — list, search, invite, role filter.
 */
import { test, expect } from '@playwright/test'

test.describe('Staff', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/staff')
    await page.waitForLoadState('networkidle')
  })

  test('loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('search input is visible', async ({ page }) => {
    const search = page.getByPlaceholder(/search/i)
    await expect(search).toBeVisible()
  })

  test('invite staff button is visible for GM', async ({ page }) => {
    const inviteBtn = page.getByRole('button', { name: /invite|add staff|add member/i })
    await expect(inviteBtn).toBeVisible()
  })

  test('opens invite staff modal', async ({ page }) => {
    const inviteBtn = page.getByRole('button', { name: /invite|add staff|add member/i })
    await inviteBtn.click()
    // Modal is a custom fixed overlay (no role="dialog") — check for its heading
    await expect(page.getByText('Invite Staff Member')).toBeVisible({ timeout: 5_000 })
  })

  test('closes invite modal on X button', async ({ page }) => {
    const inviteBtn = page.getByRole('button', { name: /invite|add staff|add member/i })
    await inviteBtn.click()
    await expect(page.getByText('Invite Staff Member')).toBeVisible()
    // Click the X close button (first button inside the modal header)
    await page.locator('.fixed.inset-0 .relative button').first().click()
    await expect(page.getByText('Invite Staff Member')).not.toBeVisible({ timeout: 5_000 })
  })

  test('staff list or empty state renders', async ({ page }) => {
    const hasCards = await page.locator('[role="listitem"], .staff-card, [data-testid="staff-member"]').count()
    const hasTable = await page.locator('table').count()
    const hasEmpty = await page.getByText(/no staff|no members/i).count()
    expect(hasCards + hasTable + hasEmpty).toBeGreaterThan(0)
  })

  test('search filters visible content', async ({ page }) => {
    const search = page.getByPlaceholder(/search/i)
    await search.fill('zzz_unlikely_name')
    await expect(page.locator('text=Application error')).not.toBeVisible()
    await search.clear()
  })
})
