/**
 * FOUND-03 — Regression pixel-diff baseline for the housekeeping Room Board
 * surfaces (RoomStatusBoard, RoomDetailDrawer), each
 * captured in light + dark mode, as two REAL roles (GM +
 *
 * NOTE: the EngineeringRoomBoard surface was retired when the Engineering
 * work-orders screen became a work-order command center (its inner "Room
 * Board" view was removed), so its baseline cases were dropped here.
 * housekeeping_supervisor) of the never-operated, cron-inert regression
 * fixture tenant (see e2e/fixtures/seed-regression-tenant.mjs).
 *
 * maxDiffPixelRatio: 0 (set in playwright.regression.config.ts) — an
 * unchanged tree must render byte-identically. Masks below cover ONLY
 * residual live chrome (relative dates, the live-sync badge); the fixture's
 * room content itself is stable via the seed, not hidden by masks — room
 * cards, counts, and status colors must always stay in the diff.
 *
 * mockStaffRoster() (used by gotoWithTheme()) routes GET /staff to a fixed
 * two-person roster. The Assignee/Clean-type filter row renders from the
 * hotel's real, uncontrolled staff list, whose length can change the native
 * <select>'s intrinsic width and shift later controls sideways — a harness
 * nondeterminism, not a RoomStatusBoard regression. Fixing the input data
 * instead of only masking its on-screen effect is what makes this
 * deterministic across environments and over time.
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

/**
 * Locators for residual live chrome — never room content (cards/counts/status colors).
 *
 * PHASE 31 FIX: full-page screenshots capture the shell (Sidebar/Header) around
 * the board, not just the board itself — the 7 frozen files have no stable
 * selector we're allowed to add (they're frozen; adding a data-testid would be
 * an edit), so the harness can't crop to just the board's bounding box. Phase 30
 * built this mask list before Phase 31's shell redesign existed, so it only
 * covered board-internal chrome (date-nav, sync badge). Phase 31 legitimately
 * redesigned the Sidebar (collapse toggle, v2 tokens) and Header (v2 tokens,
 * notification tabs) — neither is frozen, so their appearance is SUPPOSED to
 * change, but that change was showing up as a false "regression" because it
 * shared the viewport with the board. Fix: mask the two shell landmarks
 * entirely by their stable ARIA/semantic selectors (present since before this
 * milestone, not added by any phase) — <aside aria-label="Main navigation">
 * and <header> — so only the actual page-content area (where the board lives)
 * is diffed. This must hold for every future phase (32-36) that touches shell
 * or per-section chrome around a board-adjacent page.
 */
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
    // Shell landmarks (Sidebar + Header) — explicitly redesignable across
    // Phases 31-36, never part of the frozen board contract. Masked wholesale
    // rather than diffed, since their content/styling is expected to evolve.
    page.locator('aside[aria-label="Main navigation"]'),
    page.locator('header'),
    // PHASE 35 FIX: Phase 35 is the first phase (30-36) to intentionally
    // restyle in-page chrome (PageHeader + tab bar) that shares a full-page
    // regression screenshot with a frozen board — here, EngineeringRoomBoard
    // on /engineering/work-orders. Without masking it, the harness would show
    // a false-positive "regression" on this phase's own correct, in-scope
    // chrome change. Masked via a stable, purely-additive
    // data-testid="page-header" added to the shared, non-frozen
    // PageHeader.tsx, so the diff stays scoped to the frozen board's own
    // content. This mask is reusable as-is for Phase 36's Housekeeping
    // chrome close-out too, since /housekeeping renders the same PageHeader
    // above RoomStatusBoard/RoomDetailDrawer.
    page.locator('[data-testid="page-header"]'),
    // The "Assignee" filter <select> lists the hotel's live staff roster
    // (staffApi.list()), not fixture-seeded data -- a native <select>'s
    // rendered width can shift with the longest option's text, which pushes
    // every filter control to its right (including "Clean type") sideways.
    // Caught live: the GM capture and the Supervisor capture of this same
    // board landed a few minutes apart and picked up a one-name difference
    // in the roster, shifting "All clean types" a few pixels and failing the
    // 0-tolerance diff on content that has nothing to do with the board
    // itself. Masking alone doesn't fully solve this -- Playwright bakes an
    // opaque box into each screenshot at that element's *current* bounding
    // box, so a baseline captured against one roster and a run captured
    // against a different-length roster produce two differently-sized mask
    // boxes, which itself reads as a diff. The real fix is mockStaffRoster()
    // below, which makes the roster (and therefore this geometry) constant;
    // these two are kept masked as defense-in-depth, not as the fix.
    page.getByLabel('Assignee'),
    page.getByLabel('Clean type'),
  ]
}

// Fixed, deterministic staff roster for the Assignee filter (see the mask
// comment above for why this needs to be constant, not just hidden). The
// regression fixture tenant's seed (seed-regression-tenant.mjs) only creates
// the GM/Supervisor auth users -- it does not control which other staff rows
// exist for that tenant, so the live GET /staff response this filter renders
// from can drift over time and change the select's intrinsic rendered width.
// Routing it to a fixed payload removes that variable at its source instead
// of only covering the symptom with a mask.
const STAFF_ROSTER_FIXTURE = {
  data: {
    staff: [
      { id: 'regression-fixture-staff-1', user_id: 'regression-fixture-staff-1', hotel_id: 'regression-fixture-tenant', full_name: 'Regression Fixture Housekeeper', email: 'housekeeper@regression.fixture', role: 'housekeeper', status: 'active', created_at: '2026-01-01T00:00:00Z' },
      { id: 'regression-fixture-staff-2', user_id: 'regression-fixture-staff-2', hotel_id: 'regression-fixture-tenant', full_name: 'Regression Fixture Supervisor', email: 'supervisor-staff@regression.fixture', role: 'housekeeping_supervisor', status: 'active', created_at: '2026-01-01T00:00:00Z' },
    ],
    total: 2,
  },
}

async function mockStaffRoster(page: Page): Promise<void> {
  await page.route('**/staff', (route) => route.fulfill({ json: STAFF_ROSTER_FIXTURE }))
}

// `.theme-dark` is applied by DashboardShell.tsx from React state
// (`useUIPreferencesStore().theme`), re-derived on every render — a runtime
// DOM class toggle would get clobbered by the next re-render (e.g. the
// board's 10s poll). Seed the zustand-persist localStorage key *before* the
// app boots instead, so DashboardShell reads the mode on first render.
async function gotoWithTheme(page: Page, path: string, mode: 'light' | 'dark'): Promise<void> {
  await mockStaffRoster(page)
  await page.addInitScript((theme) => {
    localStorage.setItem(
      'patelrep-ui-prefs',
      JSON.stringify({ state: { density: 'balanced', theme, accent: 'terracotta' }, version: 0 }),
    )
  }, mode)
  await page.goto(path)
  // Sidebar desktop width follows hover state rather than the persisted UI
  // preference. Playwright's initial pointer position can land inside it,
  // leaving it expanded and shifting the whole capture horizontally. Move to
  // stable content chrome and wait through the width transition so every
  // baseline begins from the intended collapsed shell.
  await page.mouse.move(1200, 700)
  await expect(page.locator('aside[aria-label="Main navigation"]')).toHaveCSS('width', '64px')
  if (mode === 'dark') {
    // Housekeeping redesign Phase 10 dark-mode portal fix: DashboardShell.tsx
    // now mirrors theme/density/accent classes onto document.body (in
    // addition to its own root div) so portaled content (RoomDetailDrawer via
    // createPortal) picks up dark mode too. `.theme-dark` therefore matches
    // both elements once dark mode is active.
    await expect(page.locator('.theme-dark')).toHaveCount(2)
  }
}

for (const role of ROLES) {
  test.describe(`Room board baseline — ${role.key}`, () => {
    test.use({ storageState: role.storageState })

    for (const mode of ['light', 'dark'] as const) {
      test(`housekeeping RoomStatusBoard — ${mode}`, async ({ page }) => {
        await gotoWithTheme(page, '/housekeeping', mode)
        // The first real fixture-data request can cold-start its backend.
        // Preserve the exact visible-room assertion while allowing it to
        // settle inside this file's 45-second Playwright test budget.
        await page.getByText(FIXTURE_ROOM_NUMBERS.dirty, { exact: true }).waitFor({ state: 'visible', timeout: 30000 })

        await expect(page).toHaveScreenshot(`housekeeping-board-${role.key}-${mode}.png`, {
          mask: chromeMasks(page),
        })
      })

      test(`RoomDetailDrawer — ${mode}`, async ({ page }) => {
        await gotoWithTheme(page, '/housekeeping', mode)
        // RoomCard.tsx renders an absolute, full-card overlay <button
        // aria-label="Room {number}, ..."> (onClick={activateCard}) on top of
        // the visible room-number text for accessible single-target clicking.
        // Target that button directly rather than the text node it covers —
        // clicking the text's locator gets reported as intercepted by the
        // overlay, which is correct real-world behavior, not a bug.
        const card = page.getByRole('button', { name: new RegExp(`^Room ${FIXTURE_ROOM_NUMBERS.inProgress},`) }).first()
        // Same cold-start allowance as the board test above.
        await card.waitFor({ state: 'visible', timeout: 30000 })
        await card.click()

        const drawer = page.getByRole('dialog')
        await drawer.waitFor({ state: 'visible', timeout: 8000 })

        await expect(drawer).toHaveScreenshot(`room-detail-drawer-${role.key}-${mode}.png`, {
          mask: chromeMasks(page),
        })
      })
    }
  })
}
