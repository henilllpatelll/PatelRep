/**
 * Engineering / Maintenance - work orders, assets, PM schedules, predictions.
 */
import { test, expect } from '@playwright/test'

test.describe('Engineering - Work Orders', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/engineering')
    await page.waitForLoadState('networkidle')
  })

  test('loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('shows status filters', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Open', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'In Progress', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Completed', exact: true })).toBeVisible()
  })

  test('search input is present', async ({ page }) => {
    await expect(page.getByPlaceholder(/search by room/i)).toBeVisible()
  })

  test('status filters switch without crashing', async ({ page }) => {
    await page.getByRole('button', { name: 'Completed', exact: true }).click()
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('New Work Order button is visible', async ({ page }) => {
    const btn = page.getByRole('button', { name: /new work order|add work order/i })
    await expect(btn).toBeVisible()
  })

  test('opens Create Work Order modal', async ({ page }) => {
    const btn = page.getByRole('button', { name: /new work order|add work order/i })
    await btn.click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
  })

  test('closes Create Work Order modal on cancel/close', async ({ page }) => {
    const btn = page.getByRole('button', { name: /new work order|add work order/i })
    await btn.click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })
  })
})

test.describe('Engineering - Assets', () => {
  test('loads without error', async ({ page }) => {
    await page.goto('/engineering/assets')
    await page.waitForLoadState('networkidle')
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('renders content or empty state', async ({ page }) => {
    await page.goto('/engineering/assets')
    await page.waitForLoadState('networkidle')
    const hasContent = await page.locator('table, [role="table"], .asset-card').count()
    const hasEmpty = await page.getByText(/no assets|empty/i).count()
    expect(hasContent + hasEmpty).toBeGreaterThan(0)
  })
})

test.describe('Engineering - PM Schedules', () => {
  test('loads without error', async ({ page }) => {
    await page.goto('/engineering/pm-schedules')
    await page.waitForLoadState('networkidle')
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })
})

test.describe('Engineering - Predictions', () => {
  test('loads without error', async ({ page }) => {
    await page.goto('/engineering/predictions')
    await page.waitForLoadState('networkidle')
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })
})
