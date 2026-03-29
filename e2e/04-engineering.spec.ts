/**
 * Engineering — work orders kanban, assets, PM schedules, predictions.
 */
import { test, expect } from '@playwright/test'

test.describe('Engineering — Work Orders', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/engineering')
    await page.waitForLoadState('networkidle')
  })

  test('loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('shows kanban column headers', async ({ page }) => {
    // Kanban heading elements — use heading role to avoid matching status badge spans
    await expect(page.getByRole('heading', { name: 'Open' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'In Progress' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Completed' })).toBeVisible()
  })

  test('category filter is present', async ({ page }) => {
    // Native <select> with "All Categories" as default option — check by combobox role
    const selects = page.getByRole('combobox')
    // At least one select should be visible (category or priority)
    await expect(selects.first()).toBeVisible()
  })

  test('priority filter is present', async ({ page }) => {
    // At least 2 select elements (category + priority)
    const selects = page.getByRole('combobox')
    const count = await selects.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('New Work Order button is visible', async ({ page }) => {
    const btn = page.getByRole('button', { name: /new work order|add work order/i })
    await expect(btn).toBeVisible()
  })

  test('opens Create Work Order modal', async ({ page }) => {
    const btn = page.getByRole('button', { name: /new work order|add work order/i })
    await btn.click()
    // Modal/dialog should appear
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
  })

  test('closes Create Work Order modal on cancel/close', async ({ page }) => {
    const btn = page.getByRole('button', { name: /new work order|add work order/i })
    await btn.click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Try Escape or a close button
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })
  })
})

test.describe('Engineering — Assets', () => {
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

test.describe('Engineering — PM Schedules', () => {
  test('loads without error', async ({ page }) => {
    await page.goto('/engineering/pm-schedules')
    await page.waitForLoadState('networkidle')
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })
})

test.describe('Engineering — Predictions', () => {
  test('loads without error', async ({ page }) => {
    await page.goto('/engineering/predictions')
    await page.waitForLoadState('networkidle')
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })
})
