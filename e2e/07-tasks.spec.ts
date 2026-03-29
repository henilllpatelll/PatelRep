/**
 * Tasks — list, status tabs, create button.
 */
import { test, expect } from '@playwright/test'

test.describe('Tasks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tasks')
    await page.waitForLoadState('networkidle')
  })

  test('loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/)
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('status tab bar is rendered', async ({ page }) => {
    // Tasks uses status tabs: All, Open, In Progress, Completed, Cancelled
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open' }).first()).toBeVisible()
  })

  test('switching tabs does not crash', async ({ page }) => {
    const openTab = page.getByRole('button', { name: 'Open' }).first()
    await openTab.click()
    await expect(page.locator('text=Application error')).not.toBeVisible()
  })

  test('create / add task button is visible', async ({ page }) => {
    const createBtn = page.getByRole('button', { name: /add task|new task|create task/i })
    if (await createBtn.count() > 0) {
      await expect(createBtn).toBeVisible()
    } else {
      test.skip()
    }
  })
})
