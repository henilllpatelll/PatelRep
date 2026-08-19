---
phase: 36-housekeeping-section-chrome
plan: 01
subsystem: i18n
tags: [i18next, locales, en.ts, es.ts, housekeeping]

# Dependency graph
requires: []
provides:
  - "housekeeping.page.assignBar.loadError (en + es) — HousekeeperBar staff-list fetch error copy"
  - "housekeeping.page.myRooms.loadError (en + es) — HousekeeperMyRoomsView board-query fetch error copy"
  - "en.ts/es.ts frozen for the rest of Phase 36 — wave-2 plans (36-02, 36-03) consume these keys read-only"
affects: [36-02, 36-03, 36-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave-1-locale-owner pattern (established in Phases 33/34/35): one plan is sole editor of en.ts/es.ts for the whole phase, adding only genuinely-missing leaf keys additively inside pre-existing sub-namespaces, then freezing both files for all subsequent wave-2/3 plans."

key-files:
  created: []
  modified:
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts

key-decisions:
  - "Confirmed by direct code read (Grep) that AssignmentSidebar.tsx has zero useQuery calls of its own (reads already-loaded Zustand state) and PredictionPanel.tsx's isLoading is a passed-in prop, not its own query — neither needs any new locale key, matching the plan's up-front analysis exactly."
  - "Used double quotes only for the 2 new English values (Couldn't load...) to avoid escaping the apostrophe, matching the file's existing style rule of single-quote-by-default / double-quote-when-the-string-contains-an-apostrophe."
  - "Spanish translations use formal usted register ('No se pudo cargar...', 'Intente de nuevo.'), matching the established register of housekeeping.roomStatus.error.failedToLoad and housekeeping.page.myRooms.emptySubtitle."

patterns-established:
  - "No new pattern — reused Phase 33/34/35's wave-1-locale-owner-then-freeze pattern verbatim."

# Metrics
duration: 1min
completed: 2026-08-19
---

# Phase 36 Plan 01: i18n Foundation Summary

**Added the only 2 genuinely-missing error-copy keys Phase 36 needs (HousekeeperMyRoomsView's board-query load error, HousekeeperBar's staff-list load error) additively inside their existing `housekeeping.page.myRooms`/`housekeeping.page.assignBar` sub-namespaces in both en.ts and es.ts, then froze both locale files for the rest of the phase.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-08-19T01:46:44Z
- **Completed:** 2026-08-19T01:47:39Z
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- `housekeeping.page.assignBar.loadError` added to en.ts ("Couldn't load staff. Try again.") and es.ts ("No se pudo cargar el personal. Intente de nuevo.")
- `housekeeping.page.myRooms.loadError` added to en.ts ("Couldn't load your rooms. Try again.") and es.ts ("No se pudieron cargar sus cuartos. Intente de nuevo.")
- Confirmed via direct grep that `AssignmentSidebar.tsx` and `PredictionPanel.tsx` need NO new copy at all — `AssignmentSidebar.tsx` has zero `useQuery` calls (reads Zustand state only) and `PredictionPanel.tsx`'s `isLoading` is a prop passed from its parent, not its own query. **Wave-2 plan 36-03's executor does not need to hunt for a locale gap in either component — there isn't one.**
- `npm run check:i18n-parity` (1580 keys, up from 1578 after Phase 35), `npm run verify:i18n-gate`, and `npm run type-check` all green after both tasks
- `git diff --stat` confirmed exactly 2 insertions / 0 deletions per file, zero pre-existing keys touched in either locale

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the 2 new English keys to en.ts** - `0b13a975` (feat)
2. **Task 2: Mirror the 2 keys into es.ts with real Spanish + prove parity** - `bb3ef1bb` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `apps/web/i18n/locales/en.ts` - Added `housekeeping.page.assignBar.loadError` and `housekeeping.page.myRooms.loadError`
- `apps/web/i18n/locales/es.ts` - Mirrored both keys with real Spanish (formal usted register)

## Decisions Made
- No new namespace or top-level key created — both keys are additive leaves inside pre-existing sub-namespaces, matching the plan's explicit constraint.
- Double quotes used for the 2 English string literals only, matching file convention for strings containing an apostrophe (`Couldn't`).
- **en.ts/es.ts are now frozen for the rest of Phase 36.** Wave-2 plans 36-02 and 36-03 must consume `housekeeping.page.assignBar.loadError` and `housekeeping.page.myRooms.loadError` read-only and must not otherwise edit either locale file.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 36-02 and 36-03 (wave 2, parallel content plans) are unblocked and can now consume both new keys read-only without ever touching en.ts/es.ts, matching this plan's stated purpose.
- The EN/ES half of ROADMAP's HSK-01 Success Criterion #4 is satisfied up front for the 2 keys this phase actually needs.
- No blockers or concerns carried forward.

---
*Phase: 36-housekeeping-section-chrome*
*Completed: 2026-08-19*

## Self-Check: PASSED

- FOUND: apps/web/i18n/locales/en.ts
- FOUND: apps/web/i18n/locales/es.ts
- FOUND: .planning/phases/36-housekeeping-section-chrome/36-01-SUMMARY.md
- FOUND: 0b13a975 (Task 1 commit)
- FOUND: bb3ef1bb (Task 2 commit)
