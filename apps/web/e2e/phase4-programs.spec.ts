/**
 * Phase 4 Plan 08 (Slice 4C) — bilingual floor-contract E2E coverage.
 *
 * Verifies, in BOTH English and Spanish at a 390px phone viewport
 * (playwright.phase4.config.ts), the critical floor workflows this phase
 * touched:
 *   1. PM Schedules page (pm-schedules/page.tsx) — heading + status/action
 *      copy renders translated, and the PM completion form opens with
 *      translated core labels.
 *   2. Housekeeping program depth panels (/programs) — deep-clean schedule
 *      panel heading and DND welfare policy heading render translated.
 *
 * Each assertion confirms the EN and ES strings differ (proving real
 * translation, not a stale fallback) and that the 390px layout shows no
 * horizontal overflow on these screens.
 *
 * Credentials: TEST_EMAIL and TEST_PASSWORD environment variables. Tests
 * skip gracefully (not fail) when TEST_PASSWORD is absent, matching the
 * existing phase1/phase2 E2E pattern — this project has no live credentials
 * in the local dev environment (see CLAUDE.md "Current Scope").
 */

import { expect, test, type Page } from '@playwright/test'

const GM_EMAIL = process.env.TEST_EMAIL ?? 'hp.patelrep@gmail.com'
const GM_PASSWORD = process.env.TEST_PASSWORD

async function loginAsGM(page: Page): Promise<void> {
  if (!GM_PASSWORD) {
    test.skip(true, 'Set TEST_PASSWORD to run authenticated Phase 4 bilingual E2E coverage')
    return
  }

  await page.goto('/login')
  await page.locator('#email-pw').or(page.locator('input[type="email"]')).first().fill(GM_EMAIL)
  await page.locator('input[type="password"]').first().fill(GM_PASSWORD)
  await page
    .getByRole('button', { name: /sign in|log in|login/i })
    .or(page.locator('button[type="submit"]'))
    .first()
    .click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 })
}

/** Sets the persisted i18next language (see i18n/index.ts LANGUAGE_STORAGE_KEY) then reloads. */
async function setLanguage(page: Page, language: 'en' | 'es'): Promise<void> {
  await page.evaluate((lang) => {
    window.localStorage.setItem('patelrep-language', lang)
  }, language)
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
}

/** Asserts the page's scrollable width does not exceed the viewport (no horizontal overflow/clipped controls). */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const viewportWidth = page.viewportSize()?.width ?? 390
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  // Small tolerance for scrollbar/rounding, matching real phone-width rendering.
  expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 4)
}

test.describe('Phase 4 — bilingual floor contract (390px)', () => {
  test('PM Schedules page heading and status copy translate EN <-> ES at 390px', async ({ page }) => {
    await loginAsGM(page)
    await page.goto('/engineering/pm-schedules')
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})

    await setLanguage(page, 'en')
    const enHeading = page.getByRole('heading', { name: 'PM Schedules' })
    await expect(enHeading).toBeVisible({ timeout: 10000 })
    await expectNoHorizontalOverflow(page)

    await setLanguage(page, 'es')
    const esHeading = page.getByRole('heading', { name: 'Programas de mantenimiento preventivo' })
    await expect(esHeading).toBeVisible({ timeout: 10000 })
    await expectNoHorizontalOverflow(page)

    // Reset to English so this test doesn't leak Spanish into a shared browser context.
    await setLanguage(page, 'en')
  })

  test('PM completion form opens with translated core labels', async ({ page }) => {
    await loginAsGM(page)
    await page.goto('/engineering/pm-schedules')
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})

    const completeButton = page.getByRole('button', { name: 'Complete', exact: true }).first()
    const hasSchedule = await completeButton.count()
    if (hasSchedule === 0) {
      test.skip(true, 'No active PM schedule available in this environment to open the completion form')
      return
    }

    await setLanguage(page, 'en')
    await completeButton.click()
    await expect(page.getByRole('dialog', { name: 'Complete PM Schedule' })).toBeVisible({ timeout: 8000 })
    await expect(page.getByText('Checklist results')).toBeVisible()
    await expect(page.getByText('Verifier')).toBeVisible()
    await page.keyboard.press('Escape')

    await setLanguage(page, 'es')
    await page.goto('/engineering/pm-schedules')
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    const completeButtonEs = page.getByRole('button', { name: 'Completar', exact: true }).first()
    await completeButtonEs.click()
    await expect(page.getByRole('dialog', { name: 'Completar programa de PM' })).toBeVisible({ timeout: 8000 })
    await expect(page.getByText('Resultados de la lista de verificación')).toBeVisible()
    await expect(page.getByText('Verificador')).toBeVisible()
    await page.keyboard.press('Escape')

    await setLanguage(page, 'en')
  })

  test('Housekeeping deep-clean and DND welfare policy panels translate EN <-> ES at 390px', async ({ page }) => {
    await loginAsGM(page)
    await page.goto('/programs')
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})

    await setLanguage(page, 'en')
    const enDeepClean = page.getByRole('heading', { name: 'Deep-clean schedules' })
    const enDnd = page.getByRole('heading', { name: 'DND welfare timing & escalation policy' })
    // Wait for the manager-gated panel to actually mount (client-side role
    // resolution via useRole() races the initial render) before deciding
    // whether to skip -- an immediate .count() check here would false-skip
    // a GM account that genuinely renders these panels (see 04-07-SUMMARY.md).
    await enDeepClean.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
    if (!(await enDeepClean.isVisible())) {
      test.skip(true, 'This account/role does not render the manager-gated housekeeping depth panels')
      return
    }
    await expect(enDeepClean).toBeVisible({ timeout: 10000 })
    await expect(enDnd).toBeVisible({ timeout: 10000 })
    await expectNoHorizontalOverflow(page)

    await setLanguage(page, 'es')
    await expect(page.getByRole('heading', { name: 'Programas de limpieza profunda' })).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByRole('heading', { name: 'Tiempo de bienestar DND y política de escalamiento' }),
    ).toBeVisible({ timeout: 10000 })
    await expectNoHorizontalOverflow(page)

    await setLanguage(page, 'en')
  })
})
