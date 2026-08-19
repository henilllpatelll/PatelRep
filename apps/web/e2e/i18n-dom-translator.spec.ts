/**
 * bug-965 regression spec (Phase 37-01).
 *
 * domTranslations.ts's MutationObserver watches the whole document.body
 * subtree continuously, not just at initial mount. Any i18next text node
 * inserted into the DOM after the language is already `es` (true for any
 * StateBlock error message, since those only mount once a useQuery settles
 * into isError — always later than the initial synchronous render) used to
 * get recovered via the full-dictionary REVERSE_TRANSLATIONS lookup and then
 * re-forward-translated through the SMALL curated PHRASE_TRANSLATIONS/
 * GLOSSARY_TRANSLATIONS dict, producing EN/ES hybrids like
 * "Couldn't load Personal. Intentalo de nuevo." instead of the correct
 * es.ts value. 37-01 fixed this by giving the forward direction the same
 * full-dictionary lookup the reverse direction already had.
 *
 * This spec forces HousekeeperBar's staff-list query to fail (mounting a
 * StateBlock error AFTER the DOM translator is already live), then toggles
 * to Spanish live, and asserts the exact correct es.ts string renders with
 * zero glossary-hybrid mangling.
 *
 * The `housekeeping` section redesign (v2 chrome, which gates the
 * StateBlock branch in HousekeeperBar) is off by default for every tenant
 * (`tenants.web_redesign_sections` defaults to `[]` — confirmed against
 * both the regression fixture tenant and the pilot tenant at plan-execution
 * time). Rather than mutating the shared regression fixture tenant's DB row
 * (which 36-04 flagged on/off around its own live checks and had to
 * remember to restore), this spec intercepts `/v1/auth/me` and injects
 * `web_redesign_sections: ['housekeeping']` into the response for its own
 * browser context only — self-contained, leaves zero shared state behind,
 * and stays within this plan's file-touch boundary (no seed-fixture or
 * DB writes).
 */
import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { AUTH_DIR } from './global-setup'

test.use({ storageState: join(AUTH_DIR, 'gm.json') })

const STAFF_LOAD_ERROR_ES = 'No se pudo cargar el personal. Intente de nuevo.'
const ENGLISH_LEAK_WORDS = [/couldn't/i, /\bload\b/i, /\btry\b/i]

test.describe('bug-965: domTranslations.ts forward full-dictionary lookup', () => {
  test('async-mounted StateBlock error renders exact es.ts string on live language toggle', async ({ page }) => {
    // Force this browser context's hotel to have the housekeeping v2 chrome
    // enabled, without touching the shared fixture tenant's DB row.
    await page.route('**/auth/me', async (route) => {
      const response = await route.fetch()
      const json = await response.json()
      if (json?.hotel) {
        json.hotel.web_redesign_sections = [...(json.hotel.web_redesign_sections ?? []), 'housekeeping']
      }
      if (Array.isArray(json?.hotels)) {
        json.hotels = json.hotels.map((hotel: { web_redesign_sections?: string[] }) => ({
          ...hotel,
          web_redesign_sections: [...(hotel.web_redesign_sections ?? []), 'housekeeping'],
        }))
      }
      await route.fulfill({ response, json })
    })

    // Fail the staff-list query so HousekeeperBar mounts a StateBlock error
    // AFTER installDomTranslator's MutationObserver is already live.
    await page.route('**/v1/staff*', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    )

    await page.goto('/housekeeping')

    await page.getByRole('button', { name: 'Assign mode' }).click()

    const hkBar = page.locator('[data-testid="hk-bar"]')
    const errorText = hkBar.getByText("Couldn't load staff. Try again.")
    // React Query's default retry (3 attempts, exponential backoff) means the
    // 500 response doesn't settle into isError immediately — give it room.
    await expect(errorText).toBeVisible({ timeout: 20000 })

    // Live toggle to Spanish — triggers domTranslations.ts's reverse-then-
    // forward round-trip on the already-mounted error text.
    await page.getByRole('button', { name: 'Espanol' }).click()

    const spanishErrorText = hkBar.getByText(STAFF_LOAD_ERROR_ES, { exact: true })
    await expect(spanishErrorText).toBeVisible()
    await expect(spanishErrorText).toHaveText(STAFF_LOAD_ERROR_ES)
  })

  test('the toggled Spanish text contains no leaked English words', async ({ page }) => {
    await page.route('**/auth/me', async (route) => {
      const response = await route.fetch()
      const json = await response.json()
      if (json?.hotel) {
        json.hotel.web_redesign_sections = [...(json.hotel.web_redesign_sections ?? []), 'housekeeping']
      }
      if (Array.isArray(json?.hotels)) {
        json.hotels = json.hotels.map((hotel: { web_redesign_sections?: string[] }) => ({
          ...hotel,
          web_redesign_sections: [...(hotel.web_redesign_sections ?? []), 'housekeeping'],
        }))
      }
      await route.fulfill({ response, json })
    })

    await page.route('**/v1/staff*', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    )

    await page.goto('/housekeeping')
    await page.getByRole('button', { name: 'Assign mode' }).click()

    const hkBar = page.locator('[data-testid="hk-bar"]')
    await expect(hkBar.getByText("Couldn't load staff. Try again.")).toBeVisible({ timeout: 20000 })

    await page.getByRole('button', { name: 'Espanol' }).click()

    const spanishText = await hkBar.locator('p.font-medium').innerText()
    for (const leakPattern of ENGLISH_LEAK_WORDS) {
      expect(spanishText, `Expected no English-word leakage (${leakPattern}) in "${spanishText}"`).not.toMatch(leakPattern)
    }
  })
})
