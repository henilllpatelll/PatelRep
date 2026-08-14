/**
 * FOUND-03 — Regression pixel-diff baseline for the 3 excluded Room Board
 * surfaces (RoomStatusBoard, RoomDetailDrawer, EngineeringRoomBoard), each
 * captured in light + dark mode, as two REAL roles (GM +
 * housekeeping_supervisor) of the never-operated, cron-inert regression
 * fixture tenant (see e2e/fixtures/seed-regression-tenant.mjs).
 *
 * maxDiffPixelRatio: 0 (set in playwright.regression.config.ts) — an
 * unchanged tree must render byte-identically. Masks below cover ONLY
 * residual live chrome (relative dates, the live-sync badge); the fixture's
 * room content itself is stable via the seed, not hidden by masks — room
 * cards, counts, and status colors must always stay in the diff.
 *
 * Regenerate the baseline (after a deliberate, reviewed change):
 *   npx playwright test --config=playwright.regression.config.ts --update-snapshots
 * Verify zero drift on the current tree:
 *   npx playwright test --config=playwright.regression.config.ts
 */
import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { AUTH_DIR } from './global-setup'

const ROLES = [
  { key: 'gm', storageState: join(AUTH_DIR, 'gm.json') },
  { key: 'supervisor', storageState: join(AUTH_DIR, 'supervisor.json') },
] as const

const FIXTURE_ROOM_NUMBERS = {
  dirty: '101',
  clean: '102',
  inspected: '103',
  inProgress: '104',
  pickup: '105',
  occupied: '106',
  ooo: '107',
} as const

/** Locators for residual live chrome — never room content (cards/counts/status colors). */
function chromeMasks(page: Page) {
  return [
    // Housekeeping board date-nav: the standalone "Aug 14" span between the
    // prev/next buttons, AND the prev/next buttons themselves (their
    // accessible name is static — "Previous day"/"Next day" — but their
    // visible label text embeds the date, e.g. "← Aug 13").
    page.locator('span').filter({ hasText: /^[A-Z][a-z]{2}\s\d{1,2}$/ }),
    page.getByRole('button', { name: 'Previous day' }),
    page.getByRole('button', { name: 'Next day' }),
    // The Realtime sync badge ("Live · synced just now").
    page.getByText(/live/i),
    // Defense-in-depth: AI risk / escalation chips, if any ever render for
    // this fixture (they should not — checkin_time is NULL for every
    // fixture room, so no room_readiness_predictions row is ever created).
    page.locator('[title*="risk" i]'),
  ]
}

// `.theme-dark` is applied by DashboardShell.tsx from React state
// (`useUIPreferencesStore().theme`), re-derived on every render — a runtime
// DOM class toggle would get clobbered by the next re-render (e.g. the
// board's 10s poll). Seed the zustand-persist localStorage key *before* the
// app boots instead, so DashboardShell reads the mode on first render.
async function gotoWithTheme(page: Page, path: string, mode: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((theme) => {
    localStorage.setItem(
      'patelrep-ui-prefs',
      JSON.stringify({ state: { density: 'balanced', theme, accent: 'terracotta' }, version: 0 }),
    )
  }, mode)
  await page.goto(path)
  if (mode === 'dark') {
    await expect(page.locator('.theme-dark')).toHaveCount(1)
  }
}

for (const role of ROLES) {
  test.describe(`Room board baseline — ${role.key}`, () => {
    test.use({ storageState: role.storageState })

    for (const mode of ['light', 'dark'] as const) {
      test(`housekeeping RoomStatusBoard — ${mode}`, async ({ page }) => {
        await gotoWithTheme(page, '/housekeeping', mode)
        await page.getByText(FIXTURE_ROOM_NUMBERS.dirty, { exact: true }).waitFor({ state: 'visible', timeout: 15000 })

        await expect(page).toHaveScreenshot(`housekeeping-board-${role.key}-${mode}.png`, {
          mask: chromeMasks(page),
        })
      })

      test(`RoomDetailDrawer — ${mode}`, async ({ page }) => {
        await gotoWithTheme(page, '/housekeeping', mode)
        const card = page.getByText(FIXTURE_ROOM_NUMBERS.inProgress, { exact: true }).first()
        await card.waitFor({ state: 'visible', timeout: 15000 })
        await card.click()

        const drawer = page.getByRole('dialog')
        await drawer.waitFor({ state: 'visible', timeout: 8000 })

        await expect(drawer).toHaveScreenshot(`room-detail-drawer-${role.key}-${mode}.png`, {
          mask: chromeMasks(page),
        })
      })

      test(`EngineeringRoomBoard — ${mode}`, async ({ page }) => {
        await gotoWithTheme(page, '/engineering/work-orders', mode)
        await page.getByRole('button', { name: 'Room Board' }).click()
        await page.getByText(FIXTURE_ROOM_NUMBERS.ooo, { exact: true }).waitFor({ state: 'visible', timeout: 15000 })

        await expect(page).toHaveScreenshot(`engineering-room-board-${role.key}-${mode}.png`, {
          mask: chromeMasks(page),
        })
      })
    }
  })
}
