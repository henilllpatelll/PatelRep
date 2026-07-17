import { expect, test } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

test('public landing page explains PatelRep and preserves staff sign-in', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: /hotel operations, finally in sync/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /sign in/i }).first()).toHaveAttribute('href', '/login')
  await expect(page.getByText(/built for 50–150 room texas hotels/i)).toBeVisible()
})

test('login becomes interactive after hydration', async ({ page }) => {
  await page.route('**/health', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', db: 'ok' }),
    })
  })

  await page.goto('/login')

  await expect(page.locator('#email-pw')).toBeEnabled()
  await expect(page.getByTestId('service-health')).toHaveText(/API & database: connected/i)
})

test('login shows an honest degraded dependency state', async ({ page }) => {
  await page.route('**/health', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'degraded', db: 'unavailable' }),
    })
  })

  await page.goto('/login')

  await expect(page.getByTestId('service-health')).toHaveText(/API or database unavailable/i)
})
