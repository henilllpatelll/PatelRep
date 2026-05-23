# Frontend Playwright Audit - 2026-05-23

Target: `https://patelrepweb-production.up.railway.app`

## What Ran

- `npm run test:e2e -- --project=chromium`
  - Result: 98 passed, 6 failed, 58 skipped, 5 did not run.
- `npx playwright test -c playwright.mobile.config.ts`
  - Result: 4 passed, 56 skipped.
- `openwolf designqc --url https://patelrepweb-production.up.railway.app --routes /login`
  - Captured login desktop/mobile screenshots.
- Custom authenticated Playwright route crawl
  - Desktop: 21 routes at 1366 x 900.
  - Mobile: 21 routes at 390 x 844.
  - Captured screenshots, console errors, failed network responses, horizontal overflow, and small tap targets.

## Artifacts

- Root Playwright report: `playwright-report/index.html`
- Mobile Playwright report: `mobile-report/index.html`
- Login design screenshots: `.wolf/designqc-captures/`
- Desktop screenshots: `test-results/frontend-visual-audit-2026-05-23T06-20-21-223Z/`
- Desktop metrics: `test-results/frontend-desktop-metrics-2026-05-23T06-25-52-857Z/audit-results.json`
- Mobile screenshots and metrics: `test-results/frontend-mobile-audit-2026-05-23T06-24-28-096Z/`
- Contact sheets:
  - `test-results/frontend-visual-audit-2026-05-23T06-20-21-223Z/CONTACT_DESKTOP_B64.png`
  - `test-results/frontend-mobile-audit-2026-05-23T06-24-28-096Z/CONTACT_MOBILE_B64.png`

## High Priority Issues

### 1. Auth/session calls intermittently fail with CORS instead of a controlled auth state

Several authenticated route loads emitted:

`Access to fetch at 'https://api-production-130b.up.railway.app/v1/auth/me' ... has been blocked by CORS policy`

Observed on mobile: `/logbook`, `/sop`, `/guest-requests`, `/lost-found`, `/reports`, `/ai`, `/billing`, `/settings`, and the authenticated `/login` redirect. Observed on desktop: `/ai` and `/login`.

Why it matters: staff can land on screens that visually render while auth health checks fail in the console. If the token is invalid or expired, the UI should show a session-expired state or redirect cleanly, not leave CORS noise and partial state.

Suggested fix:
- Ensure API error responses from `/v1/auth/me`, including 401/403, include the normal production CORS headers.
- In the web auth hook/store, treat `/auth/me` failure as a controlled auth error and route to `/login` or show a session-expired toast.
- Refresh the Playwright auth setup so tests do not reuse stale `e2e/.auth/state.json`.

### 2. Mobile tables are clipped and hide important columns/actions

The mobile screenshots show desktop-style tables squeezed into 390px:

- `/housekeeping/rooms`: the status/action area is cut off; the header only shows the beginning of `ST...`.
- `/engineering/pm-schedules`: the table reaches the right edge and truncates the estimated-time column.
- `/scheduling`: week grid columns extend off-screen; later days are not discoverable.
- `/housekeeping/inspections`: the table technically fits, but inspector IDs and date columns are cramped enough to hurt scanning.

Why it matters: floor staff should not need to pan a dense data grid on a phone to find status or actions.

Suggested fix:
- Use mobile card rows for operational tables.
- If keeping tables, add an explicit horizontal scroll container with visible affordance, sticky first/action columns, and no clipped headers.
- Prioritize the fields needed on the floor: room/asset, status, assignee, due date, and primary action.

### 3. Inspection History exposes raw UUIDs as inspector names

On `/housekeeping/inspections`, the Inspector column renders values like:

`42d49284-f00b-4553-a556-0a5c1a368e2c`

Why it matters: UUIDs are not meaningful to supervisors reviewing inspections. This turns a people workflow into database output.

Suggested fix:
- Join or map inspector IDs to staff display names.
- Fallback order should be `full_name`, then `email`, then a short ID only if no staff record exists.

### 4. Floating AI button overlaps mobile content and primary actions

The bottom-right AI button overlays content/actions on mobile:

- `/settings`: it sits on top of the sticky Save Changes area.
- `/engineering/pm-schedules`: it overlaps the empty-state CTA area near the bottom.
- `/housekeeping/rooms`, `/scheduling`, `/tasks`, and other scroll-heavy screens: it covers table/card content near the lower-right.

Why it matters: the copilot should help staff, not cover the action they are trying to tap.

Suggested fix:
- Add route-aware bottom padding equal to the floating button height plus safe area.
- Hide or move the floating button while sticky form actions or modals/drawers are present.
- Consider docking the AI affordance into the mobile header or bottom nav rather than a universal floating button.

### 5. Many mobile tap targets are below 44px

The Playwright crawl found repeated small controls:

- Mobile hamburger: `34x34` on every authenticated route.
- Date controls: `34x34` on `/logbook`.
- Filter/status chips: typically `32-34px` high on `/housekeeping`, `/engineering`, `/tasks`, `/lost-found`, `/guest-requests`, `/reports`, and `/scheduling`.
- Table action buttons: `28-32px` high on `/staff` and row menus.
- AI quick actions: around `30px` high on `/ai`.

Why it matters: housekeepers and engineers are likely using thumbs, gloves, or one-handed phones. These controls will feel fussy.

Suggested fix:
- Set shared mobile control minimums to `min-height: 44px`.
- Keep compact desktop/table density, but use responsive `sm:` variants so phone controls get larger hit areas.

## Medium Priority Issues

### 6. SOP route can show an invalid-token error instead of a usable state

The full Playwright suite failed `SOP Library > renders SOPs or empty state`. The failure screenshot showed:

`Failed to load SOP library` / `Invalid token`

Later authenticated crawls rendered the proper empty state, which points to session-state instability rather than a pure SOP page crash.

Suggested fix:
- If SOP API returns invalid token, redirect to login/session-expired instead of showing a domain-level SOP error.
- Keep the empty state identifiable for tests and users: "No SOPs uploaded yet" is good; ensure it appears only when the API succeeds with an empty list.

### 7. Login Magic Link Playwright tests are stale

Four login tests failed because they call:

`getByRole('button', { name: 'Magic Link' })`

The UI exposes the control as:

`<button role="tab" ...>Magic Link</button>`

This is correct tab semantics, so the tests should use `getByRole('tab', { name: 'Magic Link' })`.

Suggested fix:
- Update `e2e/01-login.spec.ts` Magic Link locators from `button` to `tab`.
- Keep a quick assertion that the tab panel switches and focus remains sensible.

### 8. Authenticated mobile Playwright coverage is effectively disabled

`playwright.mobile.config.ts` passed only the four unauthenticated login render tests. All 56 authenticated mobile tests were skipped.

Why it matters: the app is explicitly for staff on phones, but the automated mobile suite is not currently exercising logged-in workflows.

Suggested fix:
- Provide `TEST_PASSWORD` through local/CI secrets so auth setup can refresh state.
- Avoid making authenticated mobile tests depend on stale `e2e/.auth/state.json`.
- Consider a dedicated mobile auth setup project that writes a fresh mobile storage state.

### 9. Some desktop empty states leave too much dead space

Empty or low-data desktop pages look clean but sparse:

- `/engineering`, `/engineering/assets`, `/engineering/pm-schedules`, `/engineering/predictions`
- `/sop`
- `/logbook`

The content often sits in a small top band with a large unused canvas below.

Suggested fix:
- Add useful next-step content inside empty states: recently completed work, import/setup checklist, or operational tips.
- Keep it practical, not marketing copy. The goal is to help a manager get the next task done.

### 10. Mobile staff header is crowded

On `/staff`, the title, `Add Manually`, and `Invite by Email` fight for the first viewport. The buttons fit, but the two-column action cluster makes the top feel cramped.

Suggested fix:
- Collapse secondary staff creation actions behind a single `Add Staff` menu on mobile.
- Keep `Invite by Email` as the primary option if that is the expected workflow.

## Lower Priority Polish

### 11. AI Copilot mobile panel has awkward vertical balance

On `/ai`, the message area is mostly blank, while quick actions and the input are pinned near the bottom. This is functional, but the first impression feels underfilled.

Suggested fix:
- Pull suggested actions closer to the greeting on first load.
- After conversation starts, keep the current bottom input behavior.

### 12. Dashboard loading state can linger long enough to screenshot as skeleton

The first mobile crawl captured `/dashboard` as skeleton cards after a short wait. A later 8-second recheck resolved to full content with no console errors.

Suggested fix:
- This may only be network timing, but consider making dashboard skeletons less blank and adding a timeout fallback if core dashboard data is slow.

## Verification Notes

- No horizontal document-level overflow was detected by `documentElement.scrollWidth - clientWidth`; the table problems are component-level clipping/scroll affordance issues.
- The login page itself visually renders well on desktop and mobile.
- Desktop primary navigation and most route shell layouts loaded without crashes.
- The root suite could not fully validate RBAC because `TEST_PASSWORD` was not set. `e2e/16-rbac.spec.ts` failed at helper setup with: `Set TEST_PASSWORD to run RBAC Playwright helpers`.

