---
phase: 35-engineering-section-chrome
plan: 03
subsystem: ui
tags: [react-query, i18next, statblock, skeleton, engineering, work-orders]

# Dependency graph
requires:
  - phase: 35-engineering-section-chrome
    provides: "35-01 i18n foundation — engineering.failurePrediction.loadError and engineering.workOrderDetail.loadError keys (consumed read-only)"
provides:
  - "FailurePredictionSidebar self-reads isSectionRedesigned('engineering', hotel); v2-gated StateBlock error branch with retry, previously-absent error handling on the failure-predictions query"
  - "WorkOrderDetailDrawer self-reads the flag; v2-gated non-blocking partial-load-error notice on the woDetail enrichment query, fullWo fallback preserved byte-identical"
  - "CreateWorkOrderModal self-reads the flag; v2 Skeleton/StateBlock (built-in default copy) for the previously-unhandled rooms-picker query"
  - "BulkArchiveModal self-reads the flag; v2 Skeleton/StateBlock (built-in default copy) for the previously-unhandled bulk-archive-candidates query"
affects: [35-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Self-gated flag read per component (const hotel = useHotelStore(...); const v2 = isSectionRedesigned('engineering', hotel)) — no prop threaded from the parent page, decoupling this plan from sibling 35-02's work-orders/page.tsx"
    - "StateBlock's built-in default copy (common.error/common.retry) used for minor supporting-list query failures inside modals, avoiding new i18n keys for low-stakes secondary states"

key-files:
  created: []
  modified:
    - apps/web/components/engineering/FailurePredictionSidebar.tsx
    - apps/web/components/engineering/WorkOrderDetailDrawer.tsx
    - apps/web/components/engineering/CreateWorkOrderModal.tsx
    - apps/web/components/engineering/BulkArchiveModal.tsx

key-decisions:
  - "WorkOrderDetailDrawer's new v2 notice is a small inline banner inserted at the top of the scrollable body (not a full-screen StateBlock), preserving the existing fullWo = woDetail?.data ?? wo graceful-degradation behavior exactly"
  - "CreateWorkOrderModal/BulkArchiveModal reuse StateBlock's built-in common.error/common.retry default copy rather than adding new locale keys, since 35-01 deliberately did not provision keys for these two minor supporting-list gaps"

patterns-established: []

# Metrics
duration: 25min
completed: 2026-08-18
---

# Phase 35 Plan 03: Work-Orders Sidebar/Drawer/Modals Loading-Error Gaps Summary

**Closed the one genuine loading/error gap in each of FailurePredictionSidebar (zero error handling), WorkOrderDetailDrawer (zero error handling on its enrichment query), CreateWorkOrderModal, and BulkArchiveModal (both zero loading/error handling on their supporting-list queries) — all 4 components self-read the engineering flag with no prop from work-orders/page.tsx.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-18T23:22:00Z (approx)
- **Completed:** 2026-08-18T23:47:00Z (approx)
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- `FailurePredictionSidebar`: `useQuery` destructuring extended with `isError`/`refetch`; a new v2-gated `StateBlock status="error"` branch (using 35-01's `engineering.failurePrediction.loadError` key, `onRetry: () => refetch()`) now precedes the existing loading/empty/data 3-way conditional; legacy `SkeletonItem` left untouched since it was already token-styled
- `WorkOrderDetailDrawer`: `woDetail` query destructuring extended with `isError: detailError`; a small, non-blocking inline banner (`engineering.workOrderDetail.loadError`, retry via the already-destructured `refetchDetail()`) appears at the top of the scrollable body under `v2` when the enrichment fetch fails — the drawer keeps functioning on the basic `wo` prop exactly as before
- `CreateWorkOrderModal`: `roomsData` query gained `isLoading`/`isError`/`refetch`; under `v2`, a `Skeleton` replaces the room `<select>` while loading and a compact `StateBlock` (built-in default copy, retry wired to `refetchRooms()`) replaces it on error — the separate free-text "other location" field remains usable regardless
- `BulkArchiveModal`: the `bulk-archive-candidates` query gained `isLoading`/`isError`/`refetch`; under `v2`, 3 `Skeleton` rows replace the candidates list while loading and a compact `StateBlock` (built-in default copy, retry wired to `refetchCandidates()`) replaces it on error — the existing `archiveModalNoneAvailable` empty-copy path is unchanged
- All 4 components confirmed to self-read `isSectionRedesigned('engineering', hotel)` via `useHotelStore` — no prop threaded in from `work-orders/page.tsx` (sibling plan 35-02), confirming the cross-plan decoupling contract held
- `type-check`, `check:contrast` (10 pairings both modes), `check:i18n-parity` (1578 keys, confirming neither locale file was touched), `check:frozen-files` (7/7 unchanged), and `build` (all 43 routes) all green

## Task Commits

Each task was committed atomically, pathspec-restricted (`git commit -m "..." -- <path>`, no separate `git add`) per the wave's git-hygiene recommendation from Phase 34's parallel-execution near-misses:

1. **Task 1: FailurePredictionSidebar — flag, v2 skeleton, new StateBlock error** - `21e2498c` (feat)
2. **Task 2: WorkOrderDetailDrawer — flag, isError on woDetail query, non-blocking notice** - `89cb1496` (feat)
3. **Task 3: CreateWorkOrderModal + BulkArchiveModal — flag, minimal Skeleton/StateBlock** - `4b7899d0` (feat)

**Plan metadata:** committed alongside STATE.md update (see below).

## Files Created/Modified
- `apps/web/components/engineering/FailurePredictionSidebar.tsx` - Self-reads engineering flag; `isError`/`refetch` added to the failure-predictions query; new v2-gated `StateBlock` error branch
- `apps/web/components/engineering/WorkOrderDetailDrawer.tsx` - Self-reads engineering flag; `isError: detailError` added to the woDetail query; new v2-gated non-blocking partial-load-error banner; `fullWo` fallback and all 5 existing mutation UIs byte-unchanged
- `apps/web/components/engineering/CreateWorkOrderModal.tsx` - Self-reads engineering flag; rooms-picker query gains `isLoading`/`isError`/`refetch`; v2 Skeleton/StateBlock in place of the room select
- `apps/web/components/engineering/BulkArchiveModal.tsx` - Self-reads engineering flag; bulk-archive-candidates query gains `isLoading`/`isError`/`refetch`; v2 Skeleton rows/StateBlock in place of the candidates list

## Decisions Made
- WorkOrderDetailDrawer's new error state is a compact inline banner (reusing the file's existing `<p className="text-xs text-[var(--alert)]">` alert-token visual language), not a full-screen `StateBlock`, because the drawer's existing `fullWo = woDetail?.data ?? wo` fallback means a fetch failure is not a blocking condition — the drawer stays usable with basic data.
- CreateWorkOrderModal and BulkArchiveModal's new error states rely on `StateBlock`'s own built-in `common.error`/`common.retry` default copy (no `message` prop passed) rather than new locale keys, matching 35-01's explicit decision not to provision new keys for these two minor supporting-list gaps.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The full production `npm run build` hit a transient "Another next build process is already running" collision with a sibling wave-2 plan's own build (both plans validate against the same shared Next.js build lock in this monorepo); resolved by retrying after the sibling's build completed — not a defect in this plan's code, same class of transient collision documented by several Phase 34 wave-2 plans.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 4 non-frozen work-orders sub-components now close their identified genuine loading/error gap, self-gated behind the engineering flag, with zero change to any mutation, form-validation, or graceful-degradation behavior.
- Cross-plan decoupling contract with sibling plan 35-02 confirmed intact: none of these 4 components received or expect a prop from `work-orders/page.tsx`.
- No deferred items to flag for the close-out list (35-07) beyond the already-known, pre-existing systemic `domTranslations.ts` StateBlock-mangling issue (bug-965), which is out of scope for this plan and already tracked from Phase 34's close-out.
- Ready for 35-07 (close-out verification, wave 3) once the remaining wave-2 siblings (35-04, 35-05, 35-06) also close.

---
*Phase: 35-engineering-section-chrome*
*Completed: 2026-08-18*

## Self-Check: PASSED

- FOUND: apps/web/components/engineering/FailurePredictionSidebar.tsx
- FOUND: apps/web/components/engineering/WorkOrderDetailDrawer.tsx
- FOUND: apps/web/components/engineering/CreateWorkOrderModal.tsx
- FOUND: apps/web/components/engineering/BulkArchiveModal.tsx
- FOUND: commit 21e2498c (Task 1)
- FOUND: commit 89cb1496 (Task 2)
- FOUND: commit 4b7899d0 (Task 3)
