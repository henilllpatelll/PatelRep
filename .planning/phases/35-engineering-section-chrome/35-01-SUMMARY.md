---
phase: 35-engineering-section-chrome
plan: 01
subsystem: i18n
tags: [i18next, locale-parity, engineering]

# Dependency graph
requires: []
provides:
  - "engineering.predictionsPage.loadError (en + es) — Predictions page load-error copy"
  - "engineering.failurePrediction.loadError (en + es) — FailurePredictionSidebar load-error copy"
  - "engineering.workOrderDetail.loadError (en + es) — WorkOrderDetailDrawer partial-load-error banner copy"
affects: [35-02, 35-03, 35-04, 35-05, 35-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive-only locale key insertion inside existing namespaces (no new top-level namespace) when a phase's net-new copy need is small — contrasts with Phase 33/34 which each added multiple brand-new top-level namespaces"

key-files:
  created: []
  modified:
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts

key-decisions:
  - "Only 3 genuinely-missing keys existed for the entire Phase 35 scope; everything else (5 Kanban columns, ArchivedWorkOrdersPanel, Assets, PM Schedules, BulkArchiveModal, CreateWorkOrderModal) reuses pre-existing keys, so no new top-level namespace was created this phase (unlike every Phase 34 section)"
  - "workOrderDetail.loadError is deliberately a non-blocking 'partial info' notice, not a full-screen error, since WorkOrderDetailDrawer's woDetail query already falls back to the basic wo prop on failure (fullWo = woDetail?.data ?? wo)"

patterns-established:
  - "en.ts/es.ts frozen for the rest of Phase 35 — wave-2 plans (35-02..35-06) must consume/reuse existing keys only, never edit these files"

# Metrics
duration: 15min
completed: 2026-08-18
---

# Phase 35 Plan 01: i18n Foundation Summary

**Added exactly 3 net-new leaf keys (predictionsPage.loadError, failurePrediction.loadError, workOrderDetail.loadError) additively inside three pre-existing `engineering.*` sub-namespaces in both en.ts and es.ts — no new top-level namespace, unlike every Phase 34 section.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-08-18T23:04:00Z (approx)
- **Completed:** 2026-08-18T23:19:17Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `engineering.workOrderDetail.loadError` added in both locales — non-blocking "extra details didn't load" banner copy for `WorkOrderDetailDrawer`
- `engineering.failurePrediction.loadError` added in both locales — load-error copy for the `FailurePredictionSidebar` widget
- `engineering.predictionsPage.loadError` added in both locales — page-level load-error copy for the Predictions page (previously had zero error copy)
- `npm run check:i18n-parity` (1578 keys, up from 1575), `npm run verify:i18n-gate`, and `npm run type-check` all green after both tasks
- en.ts/es.ts confirmed frozen for the remainder of Phase 35 — wave-2 plans (35-02..35-06) can now run fully in parallel without ever touching the locale files

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the 3 new English keys to en.ts** - `386291b6` (feat)
2. **Task 2: Mirror the 3 keys into es.ts with real Spanish + prove parity** - `8390b343` (feat)

## Files Created/Modified
- `apps/web/i18n/locales/en.ts` - Added 3 new leaf keys (`workOrderDetail.loadError` at line 1047, `failurePrediction.loadError` at line 1155, `predictionsPage.loadError` at line 1249); every pre-existing key left byte-unchanged (confirmed via `git diff`: exactly 3 insertions, 0 deletions)
- `apps/web/i18n/locales/es.ts` - Mirrored the same 3 keys at the same relative positions with real, natural Spanish in the hotel-operations register; every pre-existing key left byte-unchanged (confirmed via `git diff`: exactly 3 insertions, 0 deletions)

## New Keys Added (exact values)

| Namespace | Key | English | Spanish |
|---|---|---|---|
| `engineering.workOrderDetail` | `loadError` | `Couldn't load full details — showing basic info.` | `No se pudieron cargar todos los detalles. Mostrando información básica.` |
| `engineering.failurePrediction` | `loadError` | `Failed to load failure predictions.` | `No se pudieron cargar las predicciones de fallas.` |
| `engineering.predictionsPage` | `loadError` | `Failed to load predictions.` | `No se pudieron cargar las predicciones.` |

## Existing Keys Confirmed for Wave-2 Reuse (not touched, reference for wave-2 executors)

| Key | Value (en) | Location |
|---|---|---|
| `engineering.workOrderList.loadError` | `Failed to load work orders. Please try again.` | en.ts:1126 |
| `engineering.assetsPage.loadError` | `Failed to load assets` | en.ts:1181 |
| `engineering.assetsPage.retry` | `Retry` | en.ts:1182 |
| `programs.pmSchedules.failedToLoad` | `Failed to load PM schedules` | en.ts:247 |
| `programs.pmSchedules.retry` | `Retry` | en.ts:248 |
| `common.error` | `Something went wrong` | en.ts:11 |
| `common.retry` | `Retry` | en.ts:9 |
| `common.loading` | `Loading...` | en.ts:6 |

All 8 confirmed present, unchanged, and line-aligned with their es.ts Spanish counterparts. Wave-2 plans (Kanban columns, ArchivedWorkOrdersPanel, Assets, PM Schedules, BulkArchiveModal, CreateWorkOrderModal) should consume these directly — no new keys are needed or permitted for the remainder of Phase 35 beyond the 3 added by this plan.

## Decisions Made
- No new top-level namespace was created this phase — confirmed via direct read of both locale files that every other piece of copy Phase 35's wave-2 plans need already exists. This differs from every Phase 33/34 wave-1 plan, which each added 3-8 brand-new top-level namespaces.
- `workOrderDetail.loadError` copy was worded as a partial/non-blocking notice ("showing basic info") rather than a full error, matching the actual fallback behavior in `WorkOrderDetailDrawer` (`fullWo = woDetail?.data ?? wo`).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **en.ts/es.ts are now frozen for the rest of Phase 35.** Plans 35-02 through 35-06 (wave 2, 5 parallel content plans) must not edit either locale file — they should only consume the 3 new keys added here plus the 8 pre-existing keys confirmed above.
- No blockers. Wave 2 can proceed immediately and fully in parallel (no shared-file collision risk on the locale files, since this plan is their sole owner for the phase).

---
*Phase: 35-engineering-section-chrome*
*Completed: 2026-08-18*

## Self-Check: PASSED

- FOUND: apps/web/i18n/locales/en.ts
- FOUND: apps/web/i18n/locales/es.ts
- FOUND: .planning/phases/35-engineering-section-chrome/35-01-SUMMARY.md
- FOUND: commit 386291b6 (Task 1)
- FOUND: commit 8390b343 (Task 2)
