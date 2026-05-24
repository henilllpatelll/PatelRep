/**
 * Staff — Add Manually (direct account creation with password).
 * Tests the full happy path: open modal → fill form → submit → see credentials screen.
 */
import { test, expect } from '@playwright/test'

const TEST_NAME = `Test Housekeeper ${Date.now()}`
const TEST_EMAIL = `test.hk.${Date.now()}@patelrep-test.com`
const TEST_PASSWORD = `TestPass${Date.now()}!`

test.describe('Staff — Add Manually', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/staff')
    await page.waitForLoadState('networkidle')
  })

  test('Add Manually button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /add manually/i })).toBeVisible()
  })

  test('opens Add Staff Manually modal', async ({ page }) => {
    await page.getByRole('button', { name: /add manually/i }).click()
    await expect(page.getByText('Add Staff Manually')).toBeVisible({ timeout: 5_000 })
  })

  test('shows validation errors on empty submit', async ({ page }) => {
    await page.getByRole('button', { name: /add manually/i }).click()
    await expect(page.getByText('Add Staff Manually')).toBeVisible()

    // Submit without filling anything
    await page.getByRole('button', { name: /^add staff$/i }).click()

    // Should show field-level errors
    await expect(page.getByText(/full name is required/i)).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText(/enter a valid email/i)).toBeVisible()
  })

  test('successfully adds a staff member and shows credentials', async ({ page }) => {
    await page.getByRole('button', { name: /add manually/i }).click()
    await expect(page.getByText('Add Staff Manually')).toBeVisible()

    // Fill the form
    await page.getByPlaceholder('Maria Garcia').fill(TEST_NAME)
    await page.getByPlaceholder('maria@sunriseinn.com').fill(TEST_EMAIL)
    await page.getByPlaceholder('Min. 8 characters').fill(TEST_PASSWORD)
    await page.locator('select[name="role"]').selectOption('housekeeper')

    // Submit
    await page.getByRole('button', { name: /^add staff$/i }).click()

    // Wait for success screen
    await expect(page.getByText('Staff Member Added')).toBeVisible({ timeout: 15_000 })

    // Credentials should be displayed in the amber credentials box
    await expect(page.locator('span').filter({ hasText: TEST_EMAIL })).toBeVisible()
    await expect(page.locator('span').filter({ hasText: TEST_PASSWORD })).toBeVisible()
  })

  test('staff member appears in list after adding', async ({ page }) => {
    await page.getByRole('button', { name: /add manually/i }).click()
    await expect(page.getByText('Add Staff Manually')).toBeVisible()

    const uniqueName = `AutoTest ${Date.now()}`
    const uniqueEmail = `autotest.${Date.now()}@patelrep-test.com`

    await page.getByPlaceholder('Maria Garcia').fill(uniqueName)
    await page.getByPlaceholder('maria@sunriseinn.com').fill(uniqueEmail)
    await page.getByPlaceholder('Min. 8 characters').fill('AutoTest2026!')
    await page.locator('select[name="role"]').selectOption('engineer')

    await page.getByRole('button', { name: /^add staff$/i }).click()
    await expect(page.getByText('Staff Member Added')).toBeVisible({ timeout: 15_000 })

    // Close modal via Done button
    await page.getByRole('button', { name: /done/i }).click()
    await expect(page.getByText('Add Staff Manually')).not.toBeVisible({ timeout: 5_000 })

    // Staff member should now appear in the list
    await expect(page.getByText(uniqueName)).toBeVisible({ timeout: 10_000 })
  })
})
