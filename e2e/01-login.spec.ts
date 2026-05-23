/**
 * Login page — unauthenticated tests.
 * Validates the login UI, tab switching, error states, and magic link UI.
 * These tests do NOT use the saved auth state.
 */
import { test, expect } from '@playwright/test'

// Override storageState — these tests must run unauthenticated
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
  })

  test('renders branding and form', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /PatelRep/i })).toBeVisible()
    await expect(page.getByText('Hotel Operations AI')).toBeVisible()
    await expect(page.locator('#email-pw')).toBeVisible()
    await expect(page.locator('#password-pw')).toBeVisible()
    // The submit button (type="submit") is distinct from the "Sign In" tab button
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('submit button is disabled when fields are empty', async ({ page }) => {
    await expect(page.locator('button[type="submit"]')).toBeDisabled()
  })

  test('submit button enables after filling email and password', async ({ page }) => {
    await page.fill('#email-pw', 'test@hotel.com')
    await page.fill('#password-pw', 'password123')
    await expect(page.locator('button[type="submit"]')).toBeEnabled()
  })

  test('switches to Magic Link tab', async ({ page }) => {
    await page.getByRole('tab', { name: 'Magic Link' }).click()
    await expect(page.locator('#email-ml')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send Magic Link' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Magic Link' })).toBeFocused()
    // Password field should be gone
    await expect(page.locator('#password-pw')).not.toBeVisible()
  })

  test('magic link send button disabled when email is empty', async ({ page }) => {
    await page.getByRole('tab', { name: 'Magic Link' }).click()
    await expect(page.getByRole('button', { name: 'Send Magic Link' })).toBeDisabled()
  })

  test('magic link send button enables when email is filled', async ({ page }) => {
    await page.getByRole('tab', { name: 'Magic Link' }).click()
    await page.fill('#email-ml', 'test@hotel.com')
    await expect(page.getByRole('button', { name: 'Send Magic Link' })).toBeEnabled()
  })

  test('switches back from magic link to sign-in tab', async ({ page }) => {
    await page.getByRole('tab', { name: 'Magic Link' }).click()
    await page.getByRole('tab', { name: 'Sign In' }).click()
    await expect(page.locator('#password-pw')).toBeVisible()
  })

  test('shows error on invalid credentials', async ({ page }) => {
    await page.fill('#email-pw', 'wrong@hotel.com')
    await page.fill('#password-pw', 'wrongpassword')
    await page.click('button[type="submit"]')
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 15_000 })
  })

  test('forgot password link is present', async ({ page }) => {
    await expect(page.getByRole('link', { name: /forgot password/i })).toBeVisible()
  })

  test('unauthenticated visit to /dashboard redirects to /login', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForURL(/\/login/, { timeout: 10_000 })
    await expect(page.getByRole('heading', { name: /PatelRep/i })).toBeVisible()
  })
})
