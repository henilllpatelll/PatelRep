/**
 * Golden path: Tasks — create, then advance status
 *
 * Verifies that a user can:
 *  1. Create a task (POST /tasks → < 300)
 *  2. Advance it from open → in_progress via the row checkbox (PATCH /tasks/:id → < 300)
 */
import { test, expect } from '@playwright/test'

const UNIQUE_TITLE = `E2E Task ${Date.now()}`

test.describe('Tasks — golden path', () => {
  test('creates a task', async ({ page }) => {
    await page.goto('/tasks')
    await page.waitForLoadState('networkidle')

    // ── 1. Open create modal ──────────────────────────────────────────────────
    const newTaskBtn = page.getByRole('button', { name: /New Task/i })
    await expect(newTaskBtn.first()).toBeVisible({ timeout: 8_000 })
    await newTaskBtn.first().click()

    const modal = page.getByRole('dialog', { name: /New Task/i })
    await expect(modal).toBeVisible()

    // ── 2. Fill in title ──────────────────────────────────────────────────────
    await modal.getByPlaceholder(/Extra towels/i).fill(UNIQUE_TITLE)

    // ── 3. Submit — assert API success ───────────────────────────────────────
    const [response] = await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/tasks') &&
          resp.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      modal.getByRole('button', { name: /Create/i }).click(),
    ])

    expect(response.status()).toBeLessThan(300)

    // Modal closes after successful creation
    await expect(modal).not.toBeVisible({ timeout: 8_000 })

    // Task appears in the list
    await expect(page.locator(`text=${UNIQUE_TITLE}`).first()).toBeVisible({ timeout: 6_000 })
  })

  test('advances task to in_progress via checkbox', async ({ page }) => {
    await page.goto('/tasks')
    await page.waitForLoadState('networkidle')

    // Find the task we just created
    const taskRow = page.locator(`[role="button"]:has-text("${UNIQUE_TITLE}")`).first()
    if (await taskRow.count() === 0) {
      test.skip(true, 'Task not found — create test may not have run first')
      return
    }

    // Click the checkbox (open→in_progress transition)
    const checkbox = taskRow.locator('[role="checkbox"]')
    const [statusResponse] = await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/tasks') &&
          (resp.request().method() === 'PATCH' || resp.request().method() === 'PUT'),
        { timeout: 15_000 },
      ),
      checkbox.click(),
    ])

    expect(statusResponse.status()).toBeLessThan(300)
  })
})
