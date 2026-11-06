/**
 * Design V2 per-hotel activation, in a real browser against the production build and the hermetic mock backend.
 *
 *   npm run build   (mock origin, NO preview flag: see e2e/hermetic/run.mjs; the tenant flag is the only switch here)
 *   npx playwright test --config=playwright.workflows.config.ts e2e/design-v2-activation-hermetic.spec.ts
 *
 * The mock stands in for Feature Rollout through POST /__hermetic/hotel (it changes the signed-in hotel's id and
 * enabled_features); the app is then driven through the real refresh paths (reload, the 10-minute timer, going
 * offline). Nothing here reaches production or shared staging.
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
const expectV2 = (page: Page, expected: boolean) => expect.poll(() => isV2(page), { timeout: 15000 }).toBe(expected)

async function openDashboard(page: Page, mode: 'light' | 'dark' = 'light') {
  await page.addInitScript((theme) => {
    localStorage.setItem('patelrep-ui-prefs', JSON.stringify({ state: { density: 'balanced', theme, accent: 'terracotta' }, version: 0 }))
  }, mode)
  await page.goto('/dashboard')
  await expect(page.locator('main')).toBeVisible()
}

test.beforeEach(async ({ request }) => {
  await setHotel(request, { id: HOTEL_A, enabled_features: [] })
})
test.afterAll(async ({ request }) => {
  await setHotel(request, {})
})

test('default OFF: a hotel without the flag shows the legacy design', async ({ page }) => {
  await openDashboard(page)
  await expectV2(page, false)
})

for (const mode of ['light', 'dark'] as const) {
  test(`flag ON shows V2 after sign-in context loads (${mode}), and OFF restores legacy after a reload`, async ({ page, request }) => {
    await setHotel(request, { id: HOTEL_A, enabled_features: ['design_v2'] })
    await openDashboard(page, mode)
    await expectV2(page, true)
    await expect(page.locator('body')).toHaveAttribute('data-dv2-mode', mode)

    // Feature Rollout enabled=false, then the person reloads.
    await setHotel(request, { id: HOTEL_A, enabled_features: [] })
    await page.reload()
    await expect(page.locator('main')).toBeVisible()
    await expectV2(page, false)
  })
}

test('an open tab picks up a rollback on its own (10-minute refresh), no reload', async ({ page, request }) => {
  await page.clock.install()
  await setHotel(request, { id: HOTEL_A, enabled_features: ['design_v2'] })
  await openDashboard(page)
  await expectV2(page, true)

  await setHotel(request, { id: HOTEL_A, enabled_features: [] })
  await page.clock.fastForward('10:05')
  await expectV2(page, false)

  // ...and a roll-forward the same way.
  await setHotel(request, { id: HOTEL_A, enabled_features: ['design_v2'] })
  await page.clock.fastForward('10:05')
  await expectV2(page, true)
})

test('two hotels: switching to a hotel without the flag never keeps the first hotel\'s design', async ({ page, request }) => {
  await page.clock.install()
  await setHotel(request, { id: HOTEL_A, enabled_features: ['design_v2'] })
  await openDashboard(page)
  await expectV2(page, true)

  await setHotel(request, { id: HOTEL_B, enabled_features: [] })
  await page.clock.fastForward('10:05')
  await expectV2(page, false)
})

test('offline: an enabled hotel does not keep V2 indefinitely once its last read is 30 minutes old', async ({ page, context, request }) => {
  await page.clock.install()
  await setHotel(request, { id: HOTEL_A, enabled_features: ['design_v2'] })
  await openDashboard(page)
  await expectV2(page, true)

  await context.setOffline(true)
  await page.clock.fastForward('09:00')
  await expectV2(page, true) // inside the window, last good answer still trusted
  await page.clock.fastForward('25:00')
  await expectV2(page, false) // aged out: fails closed to legacy by itself

  await context.setOffline(false)
  await page.clock.fastForward('10:05')
  await expectV2(page, true) // back online: the next refresh restores it
})

test('signed-out sign-in page stays legacy for tenant activation', async ({ browser, request }) => {
  await setHotel(request, { id: HOTEL_A, enabled_features: ['design_v2'] })
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await page.goto('/login')
  await expect(page.getByTestId('login-v2')).toHaveCount(0)
  await context.close()
})
