import { expect, test } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

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
