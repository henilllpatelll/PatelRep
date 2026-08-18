---
phase: 35-engineering-section-chrome
plan: 02
subsystem: ui
tags: [react, nextjs, engineering, work-orders, statblock, skeleton, redesign-flag]

# Dependency graph
requires:
  - phase: 35-engineering-section-chrome
    provides: "35-01 i18n foundation — engineering.workOrderList.loadError and other engineering.* keys, en.ts/es.ts frozen for the rest of Phase 35"
provides:
  - "work-orders/page.tsx: isSectionRedesigned('engineering', hotel) read once, PageHeader dataI18nSkip, per-column Skeleton/StateBlock-error wiring on all 5 Kanban queries (own refetch each)"
  - "ArchivedWorkOrdersPanel.tsx: redesigned prop, Skeleton/StateBlock/EmptyState-wired loading/error/empty states with newly-added isError+refetch"
affects: [35-07 (close-out verification, depends on all wave-2 plans)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-column error state: each of N simultaneous same-shape queries gets its OWN StateBlock error wired to that exact query's own .refetch() (columnError/columnRefetch maps), not one aggregate error banner — first use of this pattern in the codebase (prior sections had at most one query per panel)"
    - "Nested v2-then-legacy ternary inside a shared child component (KanbanColumn), matching legacy markup byte-for-byte in the else branch"
    - "ArchivedWorkOrdersPanel: redesigned defaults to false so an omitted prop is safe (matches Reports-tab thread pattern from Phase 34's 34-02)"

key-files:
  created: []
  modified:
    - "apps/web/app/(dashboard)/engineering/work-orders/page.tsx"
    - "apps/web/components/engineering/ArchivedWorkOrdersPanel.tsx"

key-decisions:
  - "EngineeringRoomBoard (frozen) received zero changes — no wrapper, no prop, no touch — confirmed via check:frozen-files (7/7 unchanged, hash unaffected) and via git diff-stat showing the file absent from every commit in this plan"
  - "WorkOrderCard.tsx (shared with AI Copilot's chat cards, Phase 34) was never touched — this plan's scope was chrome only (PageHeader/tabs/columns/states), not card internals"
  - "Reused the existing generic engineering.workOrderList.loadError key for all 6 new error surfaces (5 Kanban columns + ArchivedWorkOrdersPanel) rather than adding new locale keys, per plan instruction and 35-01's frozen-locale constraint"

patterns-established:
  - "Per-column StateBlock error pattern for multi-query Kanban-style boards"

# Metrics
duration: 20min
completed: 2026-08-18
---

# Phase 35 Plan 02: Work Orders Chrome + Archived Panel Summary

**Flag-gated v2 restyle of work-orders/page.tsx's PageHeader/Kanban board and ArchivedWorkOrdersPanel, with per-column StateBlock error states each wired to that column's own query.refetch() — EngineeringRoomBoard and WorkOrderCard.tsx provably untouched.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-18T18:20:00-05:00 (approx, local)
- **Completed:** 2026-08-18T23:34:33Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments
- `WorkOrdersPageContent` reads `isSectionRedesigned('engineering', hotel)` once and threads `dataI18nSkip={v2}` into `PageHeader`
- Each of the 5 Kanban columns (`open`/`escalated`/`in_progress`/`on_hold`/`completed`) independently shows a v2 `Skeleton` while loading and its own `StateBlock status="error"` on failure, with `onRetry` wired to that exact query's own `.refetch()` — not a blanket refetch-all
- `ArchivedWorkOrdersPanel` gained a `redesigned` prop, a previously-missing `isError`/`refetch` capability on its query, and Skeleton/StateBlock/EmptyState-wired loading/error/empty states
- `EngineeringRoomBoard` (frozen) confirmed zero changes across all 3 commits; `WorkOrderCard.tsx` (shared with AI Copilot) confirmed zero changes

## Task Commits

Each task was committed atomically:

1. **Task 1: Flag + PageHeader/tab-bar/urgent-banner v2 restyle** - `daf7ec1b` (feat)
2. **Task 2: Per-column Skeleton + StateBlock error for the 5 Kanban queries** - `1b1ce9c0` (feat)
3. **Task 3: ArchivedWorkOrdersPanel — flag prop, Skeleton/StateBlock/EmptyState conversion, add isError** - `382b92a2` (feat)

**Plan metadata:** (this commit, docs)

## Files Created/Modified
- `apps/web/app/(dashboard)/engineering/work-orders/page.tsx` — flag read, PageHeader dataI18nSkip, KanbanColumn threaded with isError/onRetry/v2, columnError/columnRefetch maps, ArchivedWorkOrdersPanel call site passes `redesigned={v2}`
- `apps/web/components/engineering/ArchivedWorkOrdersPanel.tsx` — accepts `redesigned?: boolean` (default false), query destructuring extended to include `isError`/`refetch`, Skeleton/StateBlock/EmptyState wired under `redesigned`, legacy branch byte-unchanged

## Decisions Made
- Reused the single existing `engineering.workOrderList.loadError` key for all 6 new error surfaces (5 Kanban columns + Archived panel) rather than requesting new locale keys — matches the plan's explicit instruction and respects 35-01's frozen `en.ts`/`es.ts`.
- Structured `KanbanColumn`'s body as `v2 ? (loading/error/empty/list) : (legacy loading/empty/list)` rather than interleaving conditionals, so the legacy branch is provably byte-identical to pre-plan markup (verified by inspection — the `!v2` sub-tree is a verbatim copy of the original JSX).
- `ArchivedWorkOrdersPanel`'s `redesigned` prop defaults to `false` so omitting it (were any other caller to exist) is safe — matches the established Reports-tab pattern from Phase 34's 34-02.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- One transient `npm run build` collision with a sibling wave-2 plan's concurrent build process ("Another next build process is already running") during Task 3's verification — resolved by polling/retrying every 20s until the sibling's build released the lock; not a defect in this plan's code, no file conflict. All git commits confirmed via `git show --stat` to be scoped exactly to this plan's 2 files across all 3 tasks — no cross-plan git-index race occurred this run (unlike Phase 34's wave-2 precedent).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `work-orders/page.tsx` and `ArchivedWorkOrdersPanel.tsx` are flag-gated, Skeleton/StateBlock/EmptyState-wired, and ready for 35-07's close-out verification alongside the other wave-2 plans (35-03..35-06).
- No blockers. `EngineeringRoomBoard.tsx` and `WorkOrderCard.tsx` remain untouched and available for their respective owning contexts (35-07's frozen-file check; AI Copilot's chat cards).

---
*Phase: 35-engineering-section-chrome*
*Completed: 2026-08-18*

## Self-Check: PASSED

- FOUND: apps/web/app/(dashboard)/engineering/work-orders/page.tsx
- FOUND: apps/web/components/engineering/ArchivedWorkOrdersPanel.tsx
- FOUND: .planning/phases/35-engineering-section-chrome/35-02-SUMMARY.md
- FOUND: commit daf7ec1b (Task 1)
- FOUND: commit 1b1ce9c0 (Task 2)
- FOUND: commit 382b92a2 (Task 3)
