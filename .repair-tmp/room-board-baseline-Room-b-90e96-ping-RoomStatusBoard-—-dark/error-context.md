# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: room-board-baseline.spec.ts >> Room board baseline — gm >> housekeeping RoomStatusBoard — dark
- Location: e2e/room-board-baseline.spec.ts:179:11

# Error details

```
TimeoutError: locator.waitFor: Timeout 30000ms exceeded.
Call log:
  - waiting for getByText('101', { exact: true }) to be visible

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - complementary "Main navigation" [ref=e3]:
      - link "Dashboard" [ref=e5] [cursor=pointer]:
        - /url: /dashboard
      - navigation [ref=e10]:
        - generic [ref=e11]:
          - link "Housekeeping" [ref=e15] [cursor=pointer]:
            - /url: /housekeeping
          - link "Engineering" [ref=e20] [cursor=pointer]:
            - /url: /engineering
          - link "Tasks" [ref=e25] [cursor=pointer]:
            - /url: /tasks
          - link "Lost & Found" [ref=e31] [cursor=pointer]:
            - /url: /lost-found
          - link "Reports" [ref=e38] [cursor=pointer]:
            - /url: /reports
          - link "Logbook" [ref=e44] [cursor=pointer]:
            - /url: /logbook
          - link "People" [ref=e49] [cursor=pointer]:
            - /url: /staff
      - link "Settings" [ref=e57] [cursor=pointer]:
        - /url: /settings
      - generic [ref=e61]: RF
    - generic [ref=e64]:
      - banner [ref=e65]:
        - generic [ref=e66]: Mon, Oct 5
        - button "Espanol" [ref=e70] [cursor=pointer]:
          - generic [ref=e75]: ES
        - button "Notifications" [ref=e77] [cursor=pointer]
        - button "User menu for Regression Fixture GM" [ref=e82] [cursor=pointer]:
          - generic [ref=e83]: RF
      - main [ref=e86]:
        - generic [ref=e88]:
          - generic [ref=e89]:
            - generic [ref=e90]:
              - generic [ref=e91]:
                - heading "Housekeeping" [level=1] [ref=e92]
                - paragraph [ref=e93]: Room readiness and team operations
                - generic "Never synced" [ref=e95]: Sync delayed
              - generic [ref=e97]:
                - button "Previous day" [ref=e98] [cursor=pointer]: ←
                - generic [ref=e99]: Mon, Oct 5
                - button "Next day" [ref=e100] [cursor=pointer]: →
                - generic [ref=e101]:
                  - generic [ref=e102]: Search rooms
                  - textbox "Search rooms" [ref=e103]:
                    - /placeholder: Search room...
                - button "Import from Opera" [ref=e105] [cursor=pointer]
                - button "Assign mode" [ref=e106] [cursor=pointer]
            - generic [ref=e107]:
              - button "Room Board" [ref=e108] [cursor=pointer]
              - button "Team Plan" [ref=e110] [cursor=pointer]
          - generic [ref=e112]:
            - paragraph [ref=e113]: Failed to load rooms.
            - button "Retry" [ref=e114] [cursor=pointer]
    - button "Open AI Copilot" [ref=e116] [cursor=pointer]:
      - generic [ref=e119]: Ask copilot
    - button "Open feedback" [ref=e121] [cursor=pointer]:
      - generic [ref=e124]: Feedback
    - button "Display preferences" [ref=e126] [cursor=pointer]
    - region "Notifications (F8)":
      - list
  - alert [ref=e130]
```

# Test source

```ts
  84  |     // Shell landmarks (Sidebar + Header) — explicitly redesignable across
  85  |     // Phases 31-36, never part of the frozen board contract. Masked wholesale
  86  |     // rather than diffed, since their content/styling is expected to evolve.
  87  |     page.locator('aside[aria-label="Main navigation"]'),
  88  |     page.locator('header'),
  89  |     // PHASE 35 FIX: Phase 35 is the first phase (30-36) to intentionally
  90  |     // restyle in-page chrome (PageHeader + tab bar) that shares a full-page
  91  |     // regression screenshot with a frozen board — here, EngineeringRoomBoard
  92  |     // on /engineering/work-orders. Without masking it, the harness would show
  93  |     // a false-positive "regression" on this phase's own correct, in-scope
  94  |     // chrome change. Masked via a stable, purely-additive
  95  |     // data-testid="page-header" added to the shared, non-frozen
  96  |     // PageHeader.tsx, so the diff stays scoped to the frozen board's own
  97  |     // content. This mask is reusable as-is for Phase 36's Housekeeping
  98  |     // chrome close-out too, since /housekeeping renders the same PageHeader
  99  |     // above RoomStatusBoard/RoomDetailDrawer.
  100 |     page.locator('[data-testid="page-header"]'),
  101 |     // The "Assignee" filter <select> lists the hotel's live staff roster
  102 |     // (staffApi.list()), not fixture-seeded data -- a native <select>'s
  103 |     // rendered width can shift with the longest option's text, which pushes
  104 |     // every filter control to its right (including "Clean type") sideways.
  105 |     // Caught live: the GM capture and the Supervisor capture of this same
  106 |     // board landed a few minutes apart and picked up a one-name difference
  107 |     // in the roster, shifting "All clean types" a few pixels and failing the
  108 |     // 0-tolerance diff on content that has nothing to do with the board
  109 |     // itself. Masking alone doesn't fully solve this -- Playwright bakes an
  110 |     // opaque box into each screenshot at that element's *current* bounding
  111 |     // box, so a baseline captured against one roster and a run captured
  112 |     // against a different-length roster produce two differently-sized mask
  113 |     // boxes, which itself reads as a diff. The real fix is mockStaffRoster()
  114 |     // below, which makes the roster (and therefore this geometry) constant;
  115 |     // these two are kept masked as defense-in-depth, not as the fix.
  116 |     page.getByLabel('Assignee'),
  117 |     page.getByLabel('Clean type'),
  118 |   ]
  119 | }
  120 | 
  121 | // Fixed, deterministic staff roster for the Assignee filter (see the mask
  122 | // comment above for why this needs to be constant, not just hidden). The
  123 | // regression fixture tenant's seed (seed-regression-tenant.mjs) only creates
  124 | // the GM/Supervisor auth users -- it does not control which other staff rows
  125 | // exist for that tenant, so the live GET /staff response this filter renders
  126 | // from can drift over time and change the select's intrinsic rendered width.
  127 | // Routing it to a fixed payload removes that variable at its source instead
  128 | // of only covering the symptom with a mask.
  129 | const STAFF_ROSTER_FIXTURE = {
  130 |   data: {
  131 |     staff: [
  132 |       { id: 'regression-fixture-staff-1', user_id: 'regression-fixture-staff-1', hotel_id: 'regression-fixture-tenant', full_name: 'Regression Fixture Housekeeper', email: 'housekeeper@regression.fixture', role: 'housekeeper', status: 'active', created_at: '2026-01-01T00:00:00Z' },
  133 |       { id: 'regression-fixture-staff-2', user_id: 'regression-fixture-staff-2', hotel_id: 'regression-fixture-tenant', full_name: 'Regression Fixture Supervisor', email: 'supervisor-staff@regression.fixture', role: 'housekeeping_supervisor', status: 'active', created_at: '2026-01-01T00:00:00Z' },
  134 |     ],
  135 |     total: 2,
  136 |   },
  137 | }
  138 | 
  139 | async function mockStaffRoster(page: Page): Promise<void> {
  140 |   await page.route('**/staff', (route) => route.fulfill({ json: STAFF_ROSTER_FIXTURE }))
  141 | }
  142 | 
  143 | // `.theme-dark` is applied by DashboardShell.tsx from React state
  144 | // (`useUIPreferencesStore().theme`), re-derived on every render — a runtime
  145 | // DOM class toggle would get clobbered by the next re-render (e.g. the
  146 | // board's 10s poll). Seed the zustand-persist localStorage key *before* the
  147 | // app boots instead, so DashboardShell reads the mode on first render.
  148 | async function gotoWithTheme(page: Page, path: string, mode: 'light' | 'dark'): Promise<void> {
  149 |   await mockStaffRoster(page)
  150 |   await page.addInitScript((theme) => {
  151 |     localStorage.setItem(
  152 |       'patelrep-ui-prefs',
  153 |       JSON.stringify({ state: { density: 'balanced', theme, accent: 'terracotta' }, version: 0 }),
  154 |     )
  155 |   }, mode)
  156 |   await page.goto(path)
  157 |   // Sidebar desktop width follows hover state rather than the persisted UI
  158 |   // preference. Playwright's initial pointer position can land inside it,
  159 |   // leaving it expanded and shifting the whole capture horizontally. Move to
  160 |   // stable content chrome and wait through the width transition so every
  161 |   // baseline begins from the intended collapsed shell.
  162 |   await page.mouse.move(1200, 700)
  163 |   await expect(page.locator('aside[aria-label="Main navigation"]')).toHaveCSS('width', '64px')
  164 |   if (mode === 'dark') {
  165 |     // Housekeeping redesign Phase 10 dark-mode portal fix: DashboardShell.tsx
  166 |     // now mirrors theme/density/accent classes onto document.body (in
  167 |     // addition to its own root div) so portaled content (RoomDetailDrawer via
  168 |     // createPortal) picks up dark mode too. `.theme-dark` therefore matches
  169 |     // both elements once dark mode is active.
  170 |     await expect(page.locator('.theme-dark')).toHaveCount(2)
  171 |   }
  172 | }
  173 | 
  174 | for (const role of ROLES) {
  175 |   test.describe(`Room board baseline — ${role.key}`, () => {
  176 |     test.use({ storageState: role.storageState })
  177 | 
  178 |     for (const mode of ['light', 'dark'] as const) {
  179 |       test(`housekeeping RoomStatusBoard — ${mode}`, async ({ page }) => {
  180 |         await gotoWithTheme(page, '/housekeeping', mode)
  181 |         // The first real fixture-data request can cold-start its backend.
  182 |         // Preserve the exact visible-room assertion while allowing it to
  183 |         // settle inside this file's 45-second Playwright test budget.
> 184 |         await page.getByText(FIXTURE_ROOM_NUMBERS.dirty, { exact: true }).waitFor({ state: 'visible', timeout: 30000 })
      |                                                                           ^ TimeoutError: locator.waitFor: Timeout 30000ms exceeded.
  185 | 
  186 |         await expect(page).toHaveScreenshot(`housekeeping-board-${role.key}-${mode}.png`, {
  187 |           mask: chromeMasks(page),
  188 |         })
  189 |       })
  190 | 
  191 |       test(`RoomDetailDrawer — ${mode}`, async ({ page }) => {
  192 |         await gotoWithTheme(page, '/housekeeping', mode)
  193 |         // RoomCard.tsx renders an absolute, full-card overlay <button
  194 |         // aria-label="Room {number}, ..."> (onClick={activateCard}) on top of
  195 |         // the visible room-number text for accessible single-target clicking.
  196 |         // Target that button directly rather than the text node it covers —
  197 |         // clicking the text's locator gets reported as intercepted by the
  198 |         // overlay, which is correct real-world behavior, not a bug.
  199 |         const card = page.getByRole('button', { name: new RegExp(`^Room ${FIXTURE_ROOM_NUMBERS.inProgress},`) }).first()
  200 |         // Same cold-start allowance as the board test above.
  201 |         await card.waitFor({ state: 'visible', timeout: 30000 })
  202 |         await card.click()
  203 | 
  204 |         const drawer = page.getByRole('dialog')
  205 |         await drawer.waitFor({ state: 'visible', timeout: 8000 })
  206 | 
  207 |         await expect(drawer).toHaveScreenshot(`room-detail-drawer-${role.key}-${mode}.png`, {
  208 |           mask: chromeMasks(page),
  209 |         })
  210 |       })
  211 |     }
  212 |   })
  213 | }
  214 | 
```