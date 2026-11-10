/**
 * Design V2 is the one design for every hotel, in a real browser against the production build and the hermetic mock.
 *
 *   npm run build   (mock origin, NO preview variable: see e2e/hermetic/run.mjs)
 *   npx playwright test --config=playwright.workflows.config.ts e2e/design-v2-permanent-hermetic.spec.ts
 *
 * The mock's POST /__hermetic/hotel changes the signed-in hotel's id and enabled_features. Whatever a hotel's
 * (retired) `design_v2` setting was (true, false or missing) it gets V2, in light and dark, and switching hotels
 * never produces a legacy frame.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { join } from 'node:path'
import { AUTH_DIR } from './global-setup'

test.use({ storageState: join(AUTH_DIR, 'gm.json') })

const MOCK = `http://127.0.0.1:${process.env.HERMETIC_MOCK_PORT ?? 4010}`
const HOTEL_A = 'a0000000-0000-4000-a000-000000000001'
const HOTEL_B = 'a0000000-0000-4000-a000-0000000000b2'

const setHotel = (request: APIRequestContext, hotel: Record<string, unknown>) =>
  request.post(`${MOCK}/__hermetic/hotel`, { data: hotel })

/** V2 content scope is set on <body> by ShellV2 and removed again when it unmounts. */
const isV2 = (page: Page) => page.evaluate(() => document.body.hasAttribute('data-dv2-content'))
const expectV2 = (page: Page) => expect.poll(() => isV2(page), { timeout: 15000 }).toBe(true)

async function openDashboard(page: Page, mode: 'light' | 'dark' = 'light') {
  await page.addInitScript((theme) => {
    localStorage.setItem('patelrep-ui-prefs', JSON.stringify({ state: { density: 'balanced', theme, accent: 'terracotta' }, version: 0 }))
  }, mode)
  await page.goto('/dashboard')
  await expect(page.locator('main')).toBeVisible()
}

test.afterAll(async ({ request }) => {
  await setHotel(request, {})
})

const SETTINGS: Array<[string, Record<string, unknown>]> = [
  ['flag missing', { id: HOTEL_A, enabled_features: [] }],
  ['flag present', { id: HOTEL_A, enabled_features: ['design_v2'] }],
  ['unrelated flags only', { id: HOTEL_A, enabled_features: ['hk_ai_assistant'] }],
]

for (const mode of ['light', 'dark'] as const) {
  for (const [label, hotel] of SETTINGS) {
    test(`V2 for a hotel with ${label} (${mode})`, async ({ page, request }) => {
      await setHotel(request, hotel)
      await openDashboard(page, mode)
      await expectV2(page)
      await expect(page.locator('body')).toHaveAttribute('data-dv2-mode', mode)
    })
  }
}

test('switching to another hotel never shows a legacy frame', async ({ page, request }) => {
  await setHotel(request, { id: HOTEL_A, enabled_features: ['design_v2'] })
  await openDashboard(page)
  await expectV2(page)
  await setHotel(request, { id: HOTEL_B, enabled_features: [] })
  await page.reload()
  await expect(page.locator('main')).toBeVisible()
  await expectV2(page)
})

test('signed-out sign-in page is V2', async ({ browser, baseURL }) => {
  // browser.newContext() does not inherit the config's baseURL or the describe's signed-in storageState.
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await page.goto('/login')
  await expect(page.getByTestId('login-v2')).toBeVisible()
  await context.close()
})

test('the retired preview route no longer exists', async ({ page }) => {
  const res = await page.goto('/design-v2-preview')
  expect(res?.status()).not.toBe(200)
})
