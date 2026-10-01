/** Lost & Found Phase 1 inventory controls and item-detail drawer. */
import { test, expect } from '@playwright/test'

test.describe('Lost & Found inventory', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/lost-found')
    await page.waitForLoadState('networkidle')
  })

  test('loads dense inventory controls and status filters', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/)
    await expect(page.getByRole('heading', { name: 'Lost & Found' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Held' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Returned' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Search items' })).toBeVisible()
    await page.getByRole('button', { name: 'Returned' }).click()
    await expect(page.getByRole('button', { name: 'Returned' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('search and drawer tabs work when an inventory item exists', async ({ page }) => {
    const rows = page.getByTestId('lost-found-item')
    if (await rows.count() === 0) test.skip(true, 'No Lost & Found inventory is available for drawer coverage')

    const firstRow = rows.first()
    const description = (await firstRow.locator('td').nth(1).innerText()).split('\n')[0]
    await page.getByRole('textbox', { name: 'Search items' }).fill(description)
    await expect(rows.first()).toContainText(description)
    await firstRow.click()

    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true')
    await drawer.getByRole('tab', { name: 'Custody' }).click()
    await expect(drawer.getByRole('tab', { name: 'Custody' })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Escape')
    await expect(drawer).not.toBeVisible()
  })
})
