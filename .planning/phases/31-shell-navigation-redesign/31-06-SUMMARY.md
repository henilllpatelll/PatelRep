---
phase: 31-shell-navigation-redesign
plan: 06
subsystem: testing
tags: [playwright, next.js, rbac, regression, verification]

requires:
  - phase: 31-01
    provides: shell redesign foundation (sidebar collapse, redesigned prop threading)
  - phase: 31-02
    provides: notification Unread/All toggle + Header v2 restyle
  - phase: 31-03
    provides: work-order/guest-request search backend + ?focus= deep links
  - phase: 31-04
    provides: command palette grouped record search + v2 restyle
  - phase: 31-05
    provides: automated 6-role RBAC nav matrix (test:unit)
provides:
  - Green re-confirmation of every standing web gate against the completed shell redesign
  - Zero-drift re-proof of the Phase-30 Room-Board regression harness (flag-off state)
  - Live, real-browser-driven verification of NAV-01/02/03/04 golden paths (not just code inspection)
  - Documented, precise list of what remains for the orchestrator (flag-on regression re-run, 4 role logins without seeded credentials, notification mark-read click-through)
affects: [31-CLOSE, phase-32-role-dashboard-homes]

tech-stack:
  added: []
  patterns:
    - "Ad-hoc Playwright verification scripts (using the project's own installed @playwright/test) as a live-browser fallback when no browser-automation MCP tool is available in the executor session — run from apps/web/ so module resolution finds the local devDependency, then deleted (not committed) after use"

key-files:
  created:
    - .planning/phases/31-shell-navigation-redesign/31-06-SUMMARY.md
  modified: []

key-decisions:
  - "Ran test:e2e:regression once (flag-off, the regression fixture tenant's permanent state by design — web_redesign_sections: [] is seeded intentionally in seed-regression-tenant.mjs) — 12/12 zero pixel drift. The flag-ON re-run requires live Supabase MCP write access to toggle web_redesign_sections for a tenant, which this executor session does not have (no Supabase MCP tools registered) — deferred to the orchestrator per the assigning message's explicit instruction."
  - "Used the regression fixture tenant's own GM/supervisor credentials (apps/web/.env.regression) for live functional verification on localhost, since NAV-02/03/04's actual functionality (sidebar collapse, notification tab toggle, palette record search) is gated only by role/data, never by the `redesigned` flag — confirmed by grep across Sidebar.tsx/Header.tsx/CommandPalette.tsx that `redesigned` only ever touches styling classes (colors, z-index aliases, transitions, focus rings), never conditional rendering or behavior. This let genuine functional golden-path verification happen even without flag-on access; only the v2 visual polish itself (already gated by check:contrast's enforced token pairings) remains unconfirmed by eye."
  - "Two apparent live-verification failures (palette room-result navigation, palette work-order search) were investigated with an isolated debug script rather than accepted at face value — both were test-script artifacts (a `[role=\"dialog\"]` locator matching both the palette and a still-open RoomDetailDrawer after the first click), not product bugs. Re-verified clean in isolation: room search navigates to the correct `/housekeeping?room=<id>` deep link, work-order search finds the seeded fixture WO by title."

patterns-established: []

duration: ~55min
completed: 2026-08-14
---

# Phase 31 Plan 06: Shell Close-Out Verification Summary

**Full standing gate suite (type-check/lint/build/frozen-files/i18n-parity/contrast/i18n-gate/floor-copy/test:unit) green, Room-Board regression re-passes 12/12 at zero pixel drift (flag-off), and NAV-01/02/03/04 golden paths confirmed live in a real Playwright-driven browser against localhost — no regressions found, no source changes needed.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2/2 completed (Task 1 fully; Task 2 completed as far as possible without live DB write access, with the exact remainder enumerated below)
- **Files modified:** 0 (verification-only plan, `files_modified: []` in frontmatter, confirmed by `git status --short apps/web` showing no tracked-file changes after this session — only an auto-regenerated `next-env.d.ts` artifact from switching between dev/build modes, correctly left uncommitted)

## Accomplishments

- Every standing web gate re-confirmed green on the fully-landed shell redesign (all of 31-01 through 31-05's changes together)
- `check:frozen-files` confirms zero frozen-file hash drift and zero room-status value drift — the additive-only contract held across all 5 prior plans combined, not just individually
- `test:e2e:regression` re-passed 12/12 at `maxDiffPixelRatio: 0` against the live production deployment, both roles (GM + supervisor), both color schemes (light + dark) — the wrapped Room Boards are still byte-identical
- `test:unit` (31-05's matrix) confirms the 6-role RBAC nav allow-set is unchanged and every allowed href still falls inside a sidebar group
- Live-verified (real browser, not just code reading) on `localhost:3001`: sidebar collapse-to-64px-rail + persistence across reload + expand-back + mobile-viewport-stays-full-width; notification panel opens with Unread/All tabs; command palette opens on Ctrl+K, room search returns a grouped "Rooms" result that navigates to the correct `?room=<id>` deep link, work-order search returns a grouped "Work Orders" result matching the seeded fixture title; three adjacent dashboard routes (`/dashboard`, `/tasks`, `/sop`) load with zero console errors for both GM and supervisor roles

## Task Results

### Task 1: Standing gate suite + Room-Board regression re-pass — COMPLETE

All run from `apps/web/`:

| Gate | Result |
|---|---|
| `npm run type-check` | PASS — clean, zero errors |
| `npm run lint` | PASS — clean |
| `npm run build` | PASS — 43 routes generated, no errors |
| `npm run check:frozen-files` | PASS — `OK: 7 frozen files unchanged (or allowlisted); all room-status values match the frozen manifest` |
| `npm run check:i18n-parity` | PASS — `en.ts and es.ts are in parity (1432 keys)` |
| `npm run check:contrast` | PASS — `10 enforced new-token pairings checked (both modes)... all meet WCAG AA` |
| `npm run verify:i18n-gate` | PASS — scoped no-literal-string gate wired correctly |
| `npm run check:floor-copy` | PASS — 12 bilingual operational-program keys verified |
| `npm run test:unit` | PASS — 18/18 (includes both 31-05 matrix tests: baseline snapshot match + group-coverage invariant) |
| `npm run test:e2e:regression` | PASS — 12/12, zero pixel drift, flag-off state (see below) |

**Regression harness detail:** sourced `apps/web/.env.regression` (gitignored, pre-existing locally) for `REGRESSION_GM_EMAIL/PASSWORD` and `REGRESSION_SUP_EMAIL/PASSWORD`, then ran `npx playwright test --config=playwright.regression.config.ts` directly (the harness targets the live production Railway deployment by default via `playwright.regression.config.ts`'s `baseURL` fallback, matching the pattern already established in 30-04's zero-drift proof). All 12 tests passed (`RoomStatusBoard`/`RoomDetailDrawer`/`EngineeringRoomBoard` × light/dark × GM/supervisor) with `maxDiffPixelRatio: 0`.

**Flag-on re-run — NOT completed, needs orchestrator.** The regression fixture tenant is seeded with `web_redesign_sections: []` by design (`seed-regression-tenant.mjs:175`) — this is a permanent, intentional property of the fixture (the "never-operated, cron-inert" baseline tenant), not a toggle exposed anywhere in the app UI (confirmed via `grep -r web_redesign_sections` across both `apps/web` and `apps/api` — it's read-only application logic, no settings-page write path exists). Flipping it requires a direct database write. This executor session has no Supabase MCP tools registered (confirmed — my tool list has no `mcp__*supabase*` tools), matching the long-standing pattern documented in prior SUMMARYs (06-02, 21-01, 27-01, 29-01, 30-01/30-02). **Per the assigning message's explicit instruction, this sub-step is deferred to the orchestrator**, who has live Supabase MCP access this session: toggle `web_redesign_sections` to include `'shell'` for the regression fixture tenant (`a0000000-0000-4000-a000-000000000001`), re-run `npm run test:e2e:regression` from `apps/web/` (with `.env.regression` sourced), confirm 12/12 zero-drift again, then revert the tenant's `web_redesign_sections` back to `[]` afterward so the fixture's permanent "never-operated" invariant holds for future regression runs.

### Task 2: Live browser self-verification — COMPLETE (functional paths); flag-on visual confirmation remains for orchestrator

**No Playwright MCP / browser-automation tool was registered in this session** (same limitation flagged by 31-03/31-04's executors). Rather than fall back only to code inspection, this executor wrote ad-hoc Node scripts using the project's own installed `@playwright/test` devDependency (run from `apps/web/` so module resolution works) to drive a real headless Chromium browser against the already-running local dev servers (`localhost:3001` web / `localhost:8003` api, both left running from a prior session, `NEXT_PUBLIC_API_URL` confirmed pointing web→api correctly). Scripts were deleted after use, not committed (git status confirms no stray files).

**Key finding that shaped the approach:** grepping `Sidebar.tsx`, `Header.tsx`, and `CommandPalette.tsx` confirmed the `redesigned` prop *never* gates functionality — only styling (colors, z-index Tailwind aliases, transition/focus-ring classes). The sidebar-collapse mechanism (`sidebarCollapsed` from `useUIPreferencesStore`, `md:w-16`/`md:w-[232px]`), the notification tab state, and the command-palette record-search groups all render and behave identically regardless of flag state. This meant genuine golden-path *functional* verification was possible on the regression fixture tenant (flag off) — only the v2 *visual* polish itself (already separately proven WCAG-AA via `check:contrast`'s 10 enforced token pairings, and previously screenshot-verified live in 31-01/31-02's own SUMMARYs) remains unconfirmed by eye in this session.

**Verified live, with real browser interaction, GM account (`REGRESSION_GM_EMAIL`):**
- Login succeeds, redirects off `/login`, zero console errors
- NAV-02: clicking the collapse toggle changes the sidebar's class from `md:w-[232px]` to `md:w-16`; reloading the page preserves the collapsed state (`localStorage`-backed, confirmed persisted); clicking expand restores `md:w-[232px]`; at a 390×844 mobile viewport the sidebar stays `w-[240px]` (full-width drawer, no 64px rail forced) — matches NAV-02's mobile requirement
- NAV-03: notification bell opens the panel showing "Notifications" header with Unread/All tabs; both tabs are clickable and switch state; **panel shows "No notifications" for this fixture tenant/account** — the seed script does not create any `notifications` rows, so the mark-read/badge-decrement behavior specifically could not be click-through verified for lack of data (code-level: `handleMarkAllRead`/`handleMarkRead` invalidate the `['notifications']` query prefix per 31-02's SUMMARY, which is a static/structural claim, not this session's live observation)
- NAV-04: Ctrl+K opens the palette; searching `"101"` returns a grouped "Rooms" result (`Room 101 / DIRTY`) that, on click, navigates to `http://localhost:3001/housekeeping?room=<real-room-uuid>` — the correct deep link; searching the seeded fixture work-order's exact title returns a grouped "Work Orders" result (`WO #85 / Regression fixture work order — DO NOT ACTION`). Both searches were confirmed via network-response logging to hit the real `/v1/work-orders?q=...` and `/v1/rooms` endpoints with 200s.
  - Guest-request and SOP result groups were **not** click-through verified — the regression fixture tenant seeds only rooms + one work order (`seed-regression-tenant.mjs`), no guest requests or SOP documents exist to search for. These two groups share byte-identical implementation with the verified rooms/work-orders groups (`CommandPalette.tsx`'s `groups.map(...)` renders all four uniformly per 31-04's SUMMARY) — treated as verified-by-analogy, not independently click-through confirmed.
- NAV-01: `/dashboard`, `/tasks`, `/sop` each loaded with zero console errors after GM login (a couple of adjacent dashboard routes, per the plan's non-regression check)

**Verified live, real browser, supervisor account (`REGRESSION_SUP_EMAIL`):**
- Login succeeds, zero console errors, sidebar renders 12 role-scoped nav links (Dashboard, Housekeeping, Engineering, Programs, Lost & Found, Guest Requests, Tasks, AI Copilot, SOP Library, Reports, Logbook, Schedule) — visibly narrower than GM's set, no obvious missing/extra items by inspection

**NAV-05/06 per-role — only 2 of 6 roles have live credentials.** The regression fixture tenant seeds exactly two users: `gm` and `housekeeping_supervisor` (`seed-regression-tenant.mjs:222,228`). Both were live-verified above. The remaining 4 roles (`housekeeper`, `engineer`, `chief_engineer`, `front_desk`) have no seeded credential in this fixture and were **not** live-logged-in this session — per the plan's own instruction ("For any role lacking a seeded credential, record that the matrix test covers it"), this is acceptable: `test:unit`'s 31-05 matrix is the authoritative machine proof for all 6 roles and passed (2/2 relevant tests, 18/18 overall). If the orchestrator wants a full 6-role live pass, it would need either the memory-documented production GM test account's hotel (which likely has users seeded across more roles) or new role-specific seed data — not something this executor should create per the plan's explicit "Do NOT... create privileged users just to log in" instruction.

## Files Created/Modified
- `.planning/phases/31-shell-navigation-redesign/31-06-SUMMARY.md` - this file
- `.planning/STATE.md` - position/decision update (see below)

No `apps/` source files were modified — this was a pure verification plan (`files_modified: []`).

## Decisions Made
See `key-decisions` in frontmatter above.

## Deviations from Plan

None requiring a fix — no genuine regression was found. Two sub-steps could not be completed by this executor due to a documented access limitation (no Supabase MCP, no browser-automation MCP tool) rather than any plan or code defect; both are enumerated precisely below for the orchestrator rather than silently skipped.

## Issues Encountered

- Two live-verification checks initially appeared to fail (palette room-result click not navigating; palette work-order search returning no results). Investigated with an isolated debug script instead of accepting or silently retrying — root cause was a Playwright locator scoped to `[role="dialog"]` matching both the command palette and a still-open `RoomDetailDrawer` (also `role="dialog"`) left open from the prior check, causing `.first()`/strict-mode ambiguity. Not a product bug: re-run in isolation (closing the drawer, scoping to `[role="dialog"]:last`) both passed cleanly, with the room search actually navigating to the correct `?room=<uuid>` URL and the work-order search correctly returning the seeded fixture WO.

## Remaining Work — Explicit Checklist for the Orchestrator

1. ~~**Flag-on regression re-run**~~ — **RESOLVED, and it surfaced a real, significant gap.** See "Orchestrator Follow-Up" below.
2. ~~**Visual confirmation of the v2-styled shell**~~ — **RESOLVED**, live-screenshotted (Sidebar collapsed rail, Header, CommandPalette with real grouped results) against the actual deployed redesign.
3. ~~**Notification mark-read/badge click-through**~~ — **RESOLVED**, seeded a real notification row for the fixture GM and click-through verified.
4. **Remaining 4 role logins (housekeeper, engineer, chief_engineer, front_desk):** still not live-logged-in — no seeded credentials exist for these in the regression fixture, and creating privileged users solely to log in was correctly avoided per this plan's own instruction. Accepted as covered by 31-05's automated matrix (all 6 roles, passing), consistent with this plan's own stated acceptance criterion.
5. **Guest-request/SOP palette result groups:** still not click-through verified (no seeded fixture data for either entity). Accepted as covered by code-identical-implementation reasoning (same `groups.map(...)` render path already verified for rooms/work-orders) — same judgment call this plan itself made, not revisited.

## Orchestrator Follow-Up (2026-08-14, same session)

**Critical discovery: none of Phase 30 or Phase 31's 61 commits had ever been pushed to `origin/main`.** Production (Railway) was still running the pre-v2.0 build this entire time. This means every prior "zero drift" regression-harness pass in this milestone (30-04's re-proof, and this plan's own Task 1 flag-off run) was comparing stale production against itself — trivially true, but not actually testing any local code. Flagged clearly to the user before taking the unilateral, hard-to-reverse step of deploying; user confirmed "push to GitHub now."

Pushed all 61 commits (`7e121373`). Railway's GitHub webhook took ~13 minutes to register and build (not instant — worth knowing for future phases). Confirmed via `railway-agent` that auto-deploy was genuinely enabled and the build was in progress, not stalled.

**Re-ran `test:e2e:regression` against the real deployment — all 12 tests failed.** Investigated via the actual diff images rather than assuming a real regression: the excluded board content itself (room cards, counts, statuses, drawer) was byte-identical in every diff. The only difference was the Sidebar's new collapse-toggle icon and the Header's v2 restyle — both legitimate, in-scope Phase 31 changes to *non-frozen* files that happened to share the same full-viewport screenshot as the board. Phase 30 built the mask list before Phase 31's shell existed, so it only covered board-internal chrome (date-nav, sync badge) — not the shell landmarks around it.

**Fixed the harness** (`apps/web/e2e/room-board-baseline.spec.ts`, commit `39708cb9`): added `aside[aria-label="Main navigation"]` and `header` to the mask list — both pre-existing, stable, semantic selectors (no edit to Sidebar.tsx/Header.tsx needed, and no edit to any frozen file). Re-baselined (`--update-snapshots`) and re-verified:
- 12/12 zero drift on a clean re-run (flag off)
- 12/12 zero drift with `web_redesign_sections=['shell']` set live on the fixture tenant (flag on) — genuinely proving the redesigned shell doesn't leak into the wrapped boards, against real deployed code this time
- Reverted the fixture tenant back to `web_redesign_sections=[]` afterward
- Pushed the fix (`39708cb9`) so CI's `room-board-regression` job uses the corrected baseline, not the stale one

**This fix is load-bearing for the rest of the milestone**, not just Phase 31: every remaining phase (32-36) will touch shell-adjacent or per-section chrome that shares a viewport with a board-adjacent page, and without this mask expansion every one of them would have produced the same false failure — exactly the "perpetually red → team disables it" failure mode `PITFALLS.md` warned about, arrived at from a different angle (mask scope, not data determinism) than the one Phase 30 originally guarded against.

**Also completed live, against the real deployment, with the fixture GM account:**
- Sidebar collapse-to-rail: screenshotted, confirmed 64px width persists across a real page reload
- Command palette room search: screenshotted, `"101"` returns a grouped "Rooms" result (`Room 101 · DIRTY`) with correct v2 styling (focus ring, terracotta accent)
- Notifications: seeded one real notification row for the fixture GM via direct SQL, confirmed live — badge shows unread count, panel lists it under "Unread," clicking it marks it read (disappears from Unread, remains visible under "All" in muted styling) — exactly the NAV-03 gap-closure this phase was supposed to deliver. Deleted the test row afterward.

**Cost/process note:** all ad-hoc verification scripts and screenshots were written to `apps/web/e2e/.tmp-*` and deleted before each commit — none were accidentally committed. `git status` confirmed clean before every commit in this follow-up.

## Next Phase Readiness

Phase 31 (NAV-01 through NAV-06) is code-complete, deployed, and genuinely gate-verified against the real production build — including a real regression-harness bug found and fixed in the process, which is now closed out for every remaining phase in the milestone. Items 4-5 above are accepted deferrals per this plan's own stated criteria and do not block Phase 32.

---
*Phase: 31-shell-navigation-redesign*
*Completed: 2026-08-14*
