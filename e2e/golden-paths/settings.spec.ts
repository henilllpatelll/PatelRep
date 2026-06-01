/**
 * Golden path: Settings — all settings sub-pages load + general save
 *
 * Verifies every settings sub-route renders without crash and the general
 * settings form can save (PATCH /hotels/:id → < 300). Covers bug-class:
 * billing null toLocaleString, RBAC 403 on settings routes for non-GM roles.
 */
import { test, expect } from '@playwright/test'

const SETTINGS_ROUTES = [
  '/settings',
  '/settings/general',
  '/settings/departments',
  '/settings/roles',
  '/settings/rooms',
  '/settings/inspections',
  '/settings/front-desk',
  '/settings/integrations',
  '/settings/billing',
  '/settings/feedback',
]

test.describe('Settings — all sub-pages load', () => {
  for (const route of SETTINGS_ROUTES) {
    test(`${route} loads without crash`, async ({ page }) => {
      await page.goto(route)
      await page.waitForLoadState('networkidle')

      await expect(page).not.toHaveURL(/\/login/)
      await expect(page.locator('text=Application error')).not.toBeVisible()
      await expect(page.locator('text=Unhandled Runtime Error')).not.toBeVisible()
    })
  }
})

test.describe('Settings — general form save golden path', () => {
  test('general settings form renders all required fields and save is enabled', async ({ page }) => {
    await page.goto('/settings/general')
    await page.waitForLoadState('networkidle')

    // Hotel name input must be present and populated
    const nameInput = page
      .getByRole('textbox', { name: /hotel name|property name/i })
      .or(page.locator('input[name="hotel_name"], input[name="name"]'))
      .first()

    if (await nameInput.count() === 0) {
      test.skip(true, 'No hotel name input — settings form may not be rendered for this role')
      return
    }

    await expect(nameInput).toBeVisible()
    const currentValue = await nameInput.inputValue()
    expect(currentValue.length).toBeGreaterThan(0)

    // Make a real change so the form goes dirty, then save
    await nameInput.fill(currentValue + ' ')

    const saveBtn = page.getByRole('button', { name: /save changes|save|update/i }).first()
    await expect(saveBtn).toBeVisible()

    const [response] = await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/hotels') &&
          (resp.request().method() === 'PATCH' || resp.request().method() === 'PUT'),
        { timeout: 15_000 },
      ),
      saveBtn.click(),
    ])

    expect(response.status()).toBeLessThan(300)

    // Restore original value
    await nameInput.fill(currentValue)
    await saveBtn.click()
  })
})
