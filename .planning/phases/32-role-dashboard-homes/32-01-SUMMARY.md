---
phase: 32-role-dashboard-homes
plan: 01
subsystem: i18n
tags: [i18n, locales, dashboard, en, es]

# Dependency graph
requires: []
provides:
  - "Full dashboard.* i18n key set (empty.*, gm.*, section.*) in both en.ts and es.ts, additive to the pre-existing dashboard.greeting.* block"
  - "en.ts/es.ts frozen for the remainder of Phase 32 — wave-2 plans (32-02..32-05) must consume these keys, not add new ones"
affects: [32-02, 32-03, 32-04, 32-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "dashboard.empty.* / dashboard.gm.* / dashboard.section.* namespace convention for role-dashboard-home copy"

key-files:
  created: []
  modified:
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts

key-decisions:
  - "en.ts/es.ts are the SOLE responsibility of this plan for Phase 32 — all four wave-2 home plans consume these keys read-only, preventing merge collisions on shared locale files during parallel execution"
  - "Key set added exactly as specified in the plan with no additions or omissions"

patterns-established:
  - "dashboard.empty.*: role-specific empty-state copy for StateBlock status='empty' across all 6 dashboard homes"
  - "dashboard.gm.*: GM portfolio-snapshot labels, card titles, drill-down link labels"
  - "dashboard.section.*: shared section/heading labels reused across homes"

# Metrics
duration: 15min
completed: 2026-08-16
---

# Phase 32 Plan 01: i18n Foundation for Dashboard Homes Summary

**Added 36 new `dashboard.*` i18n keys (empty/gm/section sub-blocks) to en.ts and es.ts with real Spanish translations, unblocking parallel execution of the four wave-2 dashboard-home plans**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-08-16T19:56:42Z
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- `dashboard.empty.*` (12 keys): role-specific empty-state copy for housekeeper, engineer, supervisor, chief_engineer, front_desk, and gm dashboard homes
- `dashboard.gm.*` (19 keys): GM portfolio-snapshot labels, card titles, and drill-down link labels
- `dashboard.section.*` (5 keys): shared section/heading labels reused across dashboard homes
- `dashboard.greeting.*` left byte-unchanged (additive only, confirmed via diff review)
- `check:i18n-parity` (1468 keys), `verify:i18n-gate`, and `type-check` all green

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the full dashboard.* key set to en.ts** - `d5e89cd7` (feat)
2. **Task 2: Mirror every new key into es.ts with real Spanish + prove parity** - `79624846` (feat)

_No separate plan-metadata commit issued yet — this SUMMARY.md + STATE.md update will be committed together per the docs commit step._

## Files Created/Modified
- `apps/web/i18n/locales/en.ts` - Added `dashboard.empty.*`, `dashboard.gm.*`, `dashboard.section.*` sub-blocks (36 keys) under the existing `dashboard` block
- `apps/web/i18n/locales/es.ts` - Mirrored the exact same 36 keys with real, natural Spanish translations

## Complete Key List (for wave-2 executors to reference)

**`dashboard.empty.*`** (used by 32-02..32-05 for `StateBlock status='empty'`):
`housekeeperNoRooms`, `housekeeperNoTasks`, `engineerNoWorkOrders`, `supervisorNoAlerts`, `supervisorNoRequests`, `chiefNoWorkOrders`, `chiefNoAssets`, `frontDeskNoRequests`, `frontDeskNoLateCheckouts`, `frontDeskNoArrivals`, `gmNoAlerts`, `gmNoData`

**`dashboard.gm.*`** (used by 32-02, the GM dashboard home):
`snapshotTitle`, `roomsReady`, `roomsDirty`, `roomsPickup`, `roomsInspected`, `openWorkOrders`, `urgentWorkOrders`, `activeGuestRequests`, `staffOnShift`, `openTasks`, `alertsTitle`, `opsSummaryTitle`, `creditUsageTitle`, `creditsUsed`, `interactions`, `viewManagementRoi`, `viewBilling`, `viewAllWorkOrders`, `viewGuestRequests`

**`dashboard.section.*`** (used by 32-02..32-05, shared headings):
`myQueue`, `myTasks`, `headsUp`, `atRiskRooms`, `teamOverview`

**`dashboard.greeting.*`** (pre-existing, unchanged): `morning`, `afternoon`, `evening`

## Decisions Made
- Key set matches the plan exactly — no additions, no omissions, no naming deviations. All key names above are final and safe for wave-2 plans to reference directly.
- **Section-flag key confirmed:** `'dashboard'` is the section-key convention downstream plans should use for `isSectionRedesigned('dashboard', hotel)` flag toggling.
- **`en.ts` / `es.ts` are now frozen for the rest of Phase 32.** Wave-2 plans (32-02, 32-03, 32-04, 32-05) MUST NOT edit either locale file. If a wave-2 plan discovers a genuinely missing string, it must reuse an existing generic `common.*` (or the `dashboard.*` keys above) key rather than adding a new one, per this plan's file-ownership note.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `dashboard.empty.*` / `dashboard.gm.*` / `dashboard.section.*` are fully available in both locales, unblocking parallel execution of 32-02 (GM dashboard home), 32-03, 32-04, and 32-05 (the other role dashboard homes) without any risk of locale-file merge collisions.
- No blockers or concerns for wave 2.

---
*Phase: 32-role-dashboard-homes*
*Completed: 2026-08-16*

## Self-Check: PASSED

- FOUND: apps/web/i18n/locales/en.ts
- FOUND: apps/web/i18n/locales/es.ts
- FOUND: .planning/phases/32-role-dashboard-homes/32-01-SUMMARY.md
- FOUND: commit d5e89cd7
- FOUND: commit 79624846
