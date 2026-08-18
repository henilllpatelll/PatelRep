---
phase: 33-core-operational-sections
plan: 04
subsystem: ui
tags: [i18n, react-i18next, state-block, page-header, frozen-file-discipline]

# Dependency graph
requires:
  - phase: 33-core-operational-sections
    plan: "33-01"
    provides: "guestRequests.* extension (kanban chrome) and new lostFound.* namespace, consumed read-only"
provides:
  - "Guest Requests kanban page (GuestRequestsPage.tsx) gains its first-ever shared PageHeader + StateBlock chrome, flag-gated on 'guestRequests'"
  - "Lost & Found page (lost-found/page.tsx) gains v2 chrome with shared StateBlock loading/empty/error states, flag-gated on 'lostFound', frozen LogFoundItemModal untouched"
affects: ["33-07"]

tech-stack:
  added: []
  patterns:
    - "Frozen-modal discipline: restyle page chrome around a hash-pinned shared component without touching its import/props/render call"
    - "De-shadowed v2 skeleton component (SkeletonCardV2) alongside the legacy skeleton, avoiding a shared-name collision while keeping both branches independently readable"

key-files:
  modified:
    - apps/web/components/guest-requests/GuestRequestsPage.tsx
    - "apps/web/app/(dashboard)/lost-found/page.tsx"

key-decisions:
  - "Recovered a prior session's partial, uncommitted GuestRequestsPage.tsx edit rather than discarding it — verified line-by-line against the plan's must_haves and 33-01's exact locale key names (all matched, e.g. guestRequests.columns.verify for the 'resolved_today' column, guestRequests.timeAgo.* with {{count}} interpolation) before treating it as complete; zero rework needed, only completed Task 2 fresh"
  - "Lost & Found v2 PageHeader subtitle uses the static t('lostFound.pageSubtitle') per the plan's explicit instruction, dropping the legacy dynamic '{n} items' count subtitle for v2 — legacy branch keeps the dynamic count unchanged"
  - "Reused the existing three-way empty-state logic (disposition-due-only / search-no-match / default-empty) and mapped each branch to its own already-provisioned lostFound.* key (dispositionDueEmpty.*, noMatch with {{search}} interpolation, empty.*) rather than collapsing to one generic empty message"
  - "Kept the release/disposition/edit-item modals and the search/filter toggle button unchanged and un-i18n'd in both branches — the plan scoped this task to loading/empty/error/header chrome only, and no lostFound.* key exists for those strings (matches 33-01's documented in-scope-only i18n convention)"

patterns-established:
  - "When a prior interrupted session leaves partial uncommitted work, verify it against the plan's must_haves and the locale-foundation plan's exact key list before deciding to keep vs. redo — cheaper than a blind redo and caught zero defects here"

# Metrics
duration: ~25min
completed: 2026-08-18
---

# Phase 33 Plan 04: Guest Requests + Lost & Found Redesign Summary

**Guest Requests gets its first-ever shared PageHeader/StateBlock chrome (previously zero shared chrome) and Lost & Found gets v2 StateBlock loading/empty/error states around the untouched frozen LogFoundItemModal — both flag-gated, both fully i18n'd via 33-01's guestRequests.*/lostFound.* keys.**

## Performance

- **Duration:** ~25 min (continuation of an interrupted prior session — GuestRequestsPage.tsx was ~90% done on pickup)
- **Tasks:** 2 completed
- **Files modified:** 2 (`GuestRequestsPage.tsx`, `lost-found/page.tsx`)

## Accomplishments

### Task 1 — Guest Requests (recovered + verified, not rewritten)
- Net-new `PageHeader` (title/subtitle/tabs prop for Active/History/New Request action) replaces the raw `<h1>`/tab `<button>`s in the v2 branch only
- `isError`/`refetch` added to the existing kanban `useQuery` (zero data-shape change); wired to a new `StateBlock status="error"` — the page previously had no error state at all
- Column empty state migrated to `StateBlock status="empty"`; loading kept as restyled skeleton pulse blocks (not a StateBlock spinner, per plan)
- All kanban chrome strings i18n'd: column labels (`guestRequests.columns.open/acknowledged/verify`), 6 card action buttons, `urgent`, `slaOverdue`, `timeAgo.minutes/hours/days` (count-interpolated)
- Status-meaning color tokens (`--info`/`--caution`/`--ready`) on column headers preserved verbatim, not re-tinted
- Legacy (`v2=false`) branch fully preserved byte-for-byte below the new early-return

### Task 2 — Lost & Found (implemented fresh)
- Flag read directly in the page component: `isSectionRedesigned('lostFound', hotel)` via `useHotelStore`
- `isError`/`refetch` added to the existing items `useQuery` (zero data-shape change)
- v2 loading: new de-shadowed `SkeletonCardV2()` component (v2 shell styling), legacy `SkeletonCard()` untouched and still used when `v2=false`
- v2 error: new `StateBlock status="error"` wired to `lostFound.loadError` + `refetch` — page previously had no error handling at all (confirmed by 33-01's summary)
- v2 empty: `StateBlock status="empty"` mapped across the existing three-way empty logic — `lostFound.dispositionDueEmpty.*` (disposition-due filter active), `lostFound.noMatch` (search with no results, `{{search}}` interpolated), `lostFound.empty.*` (true empty) — legacy `EmptyState` usage with hardcoded strings kept unchanged for `v2=false`
- v2 `PageHeader` title/subtitle now `t('lostFound.pageTitle')`/`t('lostFound.pageSubtitle')`; legacy keeps its dynamic `"{n} items"` subtitle unchanged
- **`LogFoundItemModal` is byte-unchanged** — import, props, and render call are identical to before this plan; only the page chrome around it was touched

## Task Commits

1. **Task 1: Guest Requests — PageHeader + StateBlock + i18n** - `bf8793e8` (feat)
2. **Task 2: Lost & Found — v2 chrome + StateBlock, frozen modal untouched** - `9485d4f7` (feat)

## Files Created/Modified
- `apps/web/components/guest-requests/GuestRequestsPage.tsx` — +129/-9 lines: v2 branch with PageHeader, StateBlock error/empty, i18n'd kanban strings
- `apps/web/app/(dashboard)/lost-found/page.tsx` — +69/-18 lines: v2 branch with StateBlock error/empty, SkeletonCardV2, i18n'd header

## Frozen-File Confirmation (Success Criterion #4)

Explicitly verified via `git diff --stat`:
- `apps/web/components/shared/LogFoundItemModal.tsx` — **zero changes**
- `apps/web/frozen-files-allowlist.json` — **zero changes** (still `entries: []` equivalent — untouched, not just empty)
- `apps/web/frozen-files.json` — **zero changes**

`npm run check:frozen-files` passed clean: "OK: 7 frozen files unchanged (or allowlisted); all room-status values match the frozen manifest."

## Gate Results

All run from `apps/web`:
- `npm run type-check` — clean (zero errors in either touched file)
- `npm run build` — succeeded, all 43 routes generated including `/guest-requests` and `/lost-found`
- `npm run check:frozen-files` — OK, 7/7 unchanged
- `npm run check:contrast` — OK, 10 enforced pairings pass WCAG AA both modes
- `npm run check:i18n-parity` — OK, 1529 keys in parity (unchanged from 33-01 — confirms neither task touched a locale file)

## Decisions Made

See `key-decisions` in frontmatter. The most consequential: recovering rather than discarding the prior session's partial `GuestRequestsPage.tsx` edit, after confirming it matched the plan's must_haves and every locale key name from `33-01-SUMMARY.md` exactly.

## Deviations from Plan

None against the plan's own text. Two within-plan discretionary choices (both pre-authorized by the plan's explicit wording, not deviations): the static v2 subtitle for Lost & Found (plan said to use `t('lostFound.pageSubtitle')`) and mapping the existing three-way empty-state logic onto the three already-provisioned `lostFound.*` empty keys.

## Issues Encountered

**Session-limit recovery:** A previous execution attempt hit an account session limit mid-Task-1, leaving `GuestRequestsPage.tsx` with uncommitted partial changes and `lost-found/page.tsx` completely untouched. This session ran `git diff` first, verified the partial work was complete and correct against the plan and 33-01's key list, then implemented Task 2 fresh. No code was discarded or redone.

**Transient shared-build failure (not a 33-04 issue):** `npm run build` failed once on a syntax error in `apps/web/components/safety/IncidentReview.tsx` — a file owned by the parallel sibling plan 33-05, mid-edit at the time. Not fixed here (out of 33-04's file scope per the plan's own file list); flagged directly to that plan's executor via message, confirmed fixed on retry, then the full gate suite re-ran clean.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness

Both Guest Requests and Lost & Found are now flag-ready for `web_redesign_sections` inclusion (`'guestRequests'`, `'lostFound'`). Plan 33-07 (close-out verification) should include both in its live flag-on click-through pass and re-confirm the Room-Board regression gate stays green (the frozen `LogFoundItemModal` is also rendered by the out-of-scope `RoomDetailDrawer`, and this plan's `check:frozen-files` pass is the static proof that surface is undisturbed).

---
*Phase: 33-core-operational-sections*
*Completed: 2026-08-18*

## Self-Check: PASSED
- FOUND: apps/web/components/guest-requests/GuestRequestsPage.tsx
- FOUND: apps/web/app/(dashboard)/lost-found/page.tsx
- FOUND commit bf8793e8 (Task 1)
- FOUND commit 9485d4f7 (Task 2)
