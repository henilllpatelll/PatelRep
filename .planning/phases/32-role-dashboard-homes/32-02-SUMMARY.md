---
phase: 32-role-dashboard-homes
plan: 02
subsystem: ui
tags: [react, nextjs, react-query, i18n, gm-dashboard, redesign-flag]

# Dependency graph
requires:
  - phase: 32-01
    provides: dashboard.gm.*, dashboard.empty.gm*, dashboard.section.* i18n keys (en.ts/es.ts, frozen for the rest of Phase 32)
provides:
  - "components/dashboard/GMDashboard.tsx: dedicated first-class GM home component (HOME-02)"
  - "page.tsx importing GMDashboard, inline function removed"
  - "GM portfolio-snapshot layout pattern (snapshot-first, alerts below, credit-usage drill-down) for later dashboard-home phases to reference"
affects: [33-core-operational-sections, 34-management-admin-sections]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Flag-branched single-component pattern: all hooks (legacy + v2) called unconditionally at top of GMDashboard, JSX branches on `if (v2) return (...)` before the legacy return — matches EngineerDashboard/SupervisorDashboard precedent already landed by sibling 32-03/32-04 plans"
    - "Per-department snapshot cards (Housekeeping/Engineering/Guest Requests/Staffing) composed from Stat primitive, each with its own loading-skeleton/error/empty tri-state, rather than one dense combined grid"

key-files:
  created:
    - apps/web/components/dashboard/GMDashboard.tsx
  modified:
    - apps/web/app/(dashboard)/dashboard/page.tsx

key-decisions:
  - "Room-status snapshot mapping: roomsReady -> CLEAN breakdown key (cleaned, awaiting inspection), roomsInspected -> INSPECTED breakdown key (fully verified guest-ready) -- keeps the two locale keys distinct and matches the existing LiveOpsGrid tile taxonomy (CLEAN tile label 'Clean Inspect' vs INSPECTED tile label 'Inspected')"
  - "Credit-usage card resolves 32-RESEARCH Open Question #2 in the 'real credit usage' direction: reportsApi.getAIUsage() (total_credits_used, total_interactions) with a drill-down link to /settings/billing and /management-roi, NOT a re-themed ROIMetricsStrip -- AIUsageReport has no cap field so no derived cap/percentage is shown, full cap/billing detail lives at the drill-down target"
  - "Departures/ready-room action columns (with their checkout/checkin mutations) dropped from the v2 branch only (resolves Open Question #3) -- they duplicate FrontDesk/Housekeeping detail views; the snapshot's room-status counts convey the same at-a-glance signal at GM's 'light/drill-down' density. Legacy branch keeps them byte-unchanged."
  - "Urgent work-order count computed client-side exactly like EngineerDashboard/ChiefEngineerDashboard: engineeringApi.listWorkOrders({ per_page: 100 }) filtered to status in [open, in_progress] then priority === 'urgent'"
  - "All new v2-only hooks (getStats/getDailySummary/listRequests({status:'open'})/listWorkOrders/getAIUsage) are called unconditionally alongside the pre-existing legacy board query/mutations, per the established sibling-plan pattern, to keep rules-of-hooks compliant while branching only the returned JSX"

patterns-established:
  - "GM snapshot-first / alerts-below / credit-usage-drilldown layout order, to be referenced by any later phase that revisits the GM home"

# Metrics
duration: 30min
completed: 2026-08-16
---

# Phase 32 Plan 02: GM Dashboard Home Summary

**Extracted the inline GM dashboard into `components/dashboard/GMDashboard.tsx` and added a flag-gated portfolio-snapshot redesign (room-status counts, work orders, guest requests, staffing) with an AI risk-alerts feed and a real-credit-usage card linking to Billing.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-08-16 (session start)
- **Completed:** 2026-08-16T20:05:32Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- HOME-02 delivered: GM home is now a dedicated component file, no longer inline in `page.tsx`
- v2 portfolio-snapshot layout composed entirely from existing endpoints — zero new backend
- Skeleton/empty/error states rebuilt per the locked "skeleton not spinner" contract
- Legacy (flag-off) behavior preserved byte-identically via a safe verbatim extraction in Task 1 before any redesign work in Task 2

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract inline GMDashboard into GMDashboard.tsx and wire page.tsx** - `1253ee0c` (feat)
2. **Task 2: Redesign GMDashboard to the portfolio-snapshot layout** - `60351571` (feat)

## Files Created/Modified
- `apps/web/components/dashboard/GMDashboard.tsx` - Dedicated GM home component: flag-branched (`isSectionRedesigned('dashboard', hotel)`) between the legacy departures/ready-rooms + ROIMetricsStrip/AIRiskAlertsPanel/LiveOpsGrid/TrendChartsRow layout and the new v2 portfolio-snapshot layout
- `apps/web/app/(dashboard)/dashboard/page.tsx` - Imports `GMDashboard` from `components/dashboard`; inline function removed; `case 'gm'` renders it unchanged

## Decisions Made
See `key-decisions` in frontmatter: room-status label mapping, credit-usage-card data source, departures-columns drop scope, urgent-WO client-side split, unconditional-hooks pattern.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- One transient `next build` collision ("Another next build process is already running") caused by a sibling wave-2 plan (32-03/32-04/32-05) building concurrently in the same working tree — not a code issue; resolved by waiting ~20s and re-running. No file conflicts (this plan's sole-owned files, `GMDashboard.tsx` and `page.tsx`, were untouched by the other builds).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `dashboard.gm.*`/`dashboard.empty.gm*` i18n keys now have a live consumer; en.ts/es.ts remain untouched by this plan as required
- GM home ready for Phase 37 (Final QA & Rollout) visual/functional verification once the `dashboard` flag is live-tested end to end
- No blockers for 32-03/32-04/32-05 (disjoint files) or for Phase 33+

---
*Phase: 32-role-dashboard-homes*
*Completed: 2026-08-16*
