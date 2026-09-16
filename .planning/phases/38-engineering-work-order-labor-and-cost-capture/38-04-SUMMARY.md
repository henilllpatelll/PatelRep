---
phase: 38-engineering-work-order-labor-and-cost-capture
plan: 04
subsystem: ui
tags: [react, nextjs, i18n, engineering, staff, inventory, cost]

# Dependency graph
requires:
  - phase: 38-02
    provides: labor_cost/parts_cost/total_cost returned on completed work orders
  - phase: 38-03
    provides: unit_cost writable on parts; hourly_rate GM-only write on PATCH /v1/staff/{staff_id}
provides:
  - Read-only cost line (Labor · Parts · Total) on the completed work order detail drawer
  - unit_cost input on the parts create form + display on existing part rows
  - hourly_rate input in the GM-only staff edit modal
affects: [engineering, staff, inventory, cost-reporting]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cost surfaced read-only in WO detail drawer only for completed work orders; never a list/board column (locked decision)"
    - "hourly_rate input inherits page-level GM gate — no redundant per-field role check"

key-files:
  created: []
  modified:
    - apps/web/lib/api/engineering.ts
    - apps/web/components/engineering/WorkOrderDetailDrawer.tsx
    - apps/web/lib/api/inventory.ts
    - apps/web/components/engineering/PartsPanel.tsx
    - apps/web/lib/api/staff.ts
    - apps/web/app/(dashboard)/staff/page.tsx
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts

key-decisions:
  - "Cost line rendered only when fullWo.status === 'completed'; shows 'Cost data unavailable' when total_cost is NULL"
  - "No cost column on WO list/board — kept dense and phone-first per locked decision"
  - "hourly_rate input added inside already-GM-gated staff page; no new role gate, not shown in staff list table"

patterns-established:
  - "Optional-number form field pattern ('' as number | '') reused for unit_cost, matching maximum_stock"

# Metrics
duration: 4min
completed: 2026-09-16
---

# Phase 38 Plan 04: Cost Data UI Surfacing Summary

**Surfaced the labor/parts/total cost computed in Plans 02/03 as a read-only cost line on completed work orders, a unit_cost input on the parts panel, and an hourly_rate input on the GM-only staff edit modal — all with matching en/es i18n keys.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-09-16T20:05:05Z
- **Completed:** 2026-09-16T20:08:57Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- Completed work orders now show `Labor: $X · Parts: $Y · Total: $Z` (or "Cost data unavailable" when total_cost is NULL) in the detail drawer Details section
- Parts create form has a currency `unit_cost` input; existing part rows display `${{cost}} per unit` when set
- GM staff edit modal has an `hourly_rate` input (0–500) wired to `staffApi.update`, with a hint explaining it drives labor-cost computation
- All 8 new i18n keys mirrored across en.ts and es.ts at matching nested paths

## Task Commits

Each task was committed atomically:

1. **Task 1: Work order cost display** - `93d53edc` (feat)
2. **Task 2: Parts unit_cost input** - `4116cfa0` (feat)
3. **Task 3: Staff hourly_rate input** - `705b01e6` (feat)

## Files Created/Modified
- `apps/web/lib/api/engineering.ts` - Added labor_cost/parts_cost/total_cost to WorkOrder interface
- `apps/web/components/engineering/WorkOrderDetailDrawer.tsx` - Cost line in Details section, completed-only
- `apps/web/lib/api/inventory.ts` - Added unit_cost to EngineeringPart and CreatePartPayload
- `apps/web/components/engineering/PartsPanel.tsx` - unit_cost form input + per-row display
- `apps/web/lib/api/staff.ts` - Added hourly_rate to StaffMember and UpdateStaffData
- `apps/web/app/(dashboard)/staff/page.tsx` - hourly_rate input in EditStaffModal, wired to update mutation + save-enabled condition
- `apps/web/i18n/locales/en.ts` - 8 new keys (costLabel/costLine/costUnavailable, unitCostLabel/unitCostDisplay, hourlyRateLabel/Placeholder/Hint)
- `apps/web/i18n/locales/es.ts` - Spanish translations for the same 8 keys

## Decisions Made
- Cost line gated to `status === 'completed'` (cost only computed at completion; showing it earlier would always read "unavailable")
- No cost column on the WO list/board — cost stays detail-only, consistent with parts_used/labor_hours
- hourly_rate input inherits the staff page's existing `isGM` render gate; no redundant per-field check, not added to the list table (prevents pay-rate leakage on the list)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. `npx tsc --noEmit` passed clean after each task; i18n key parity verified (6 matching lines in each locale file).

## User Setup Required
None - no external service configuration required. All backend (migration 104, cost computation, RBAC gating) was already live from Plans 02/03; this plan is web UI only.

## Next Phase Readiness
- Cost capture UI is complete end-to-end: rates/unit-costs are enterable and per-WO cost is visible.
- Deferred (out of phase scope per CONTEXT.md): cost roll-up dashboards / aggregate maintenance-spend reporting, MTTR/MTBF analytics, labor timer, vendor cost path, retroactive recalculation.

## Self-Check: PASSED

All 8 modified files + SUMMARY.md exist on disk; all 3 task commits (`93d53edc`, `4116cfa0`, `705b01e6`) present in git history.

---
*Phase: 38-engineering-work-order-labor-and-cost-capture*
*Completed: 2026-09-16*
