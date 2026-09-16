---
phase: 38-engineering-work-order-labor-and-cost-capture
plan: 02
subsystem: engineering-work-orders
tags: [fastapi, work-orders, cost-capture, labor, parts, supabase]

requires:
  - "user_roles.hourly_rate (nullable NUMERIC(8,2))"
  - "engineering_parts.unit_cost (nullable NUMERIC(10,2))"
  - "work_orders.labor_cost / parts_cost / total_cost (nullable NUMERIC(10,2))"
provides:
  - "complete_work_order computes + persists labor_cost/parts_cost/total_cost at completion time"
  - "WorkOrderResponse exposes labor_cost/parts_cost/total_cost: Optional[float]"
affects: [38-04, 38-05]

tech-stack:
  added: []
  patterns:
    - "Point-in-time cost computation in the completion handler (not a generated column, not retroactively recalculated), mirroring the existing point-in-time stock decrement"
    - "NULL-means-unknown-never-zero: total_cost NULL only when both labor_cost and parts_cost are NULL"

key-files:
  created:
    - apps/api/tests/test_work_order_cost_capture.py
  modified:
    - apps/api/routers/work_orders.py
    - apps/api/models/responses.py
    - apps/api/tests/test_work_order_parts_consumption.py

key-decisions:
  - "Labor rate lookup order: assigned_to first, fall back to the completing user's user_id — matches 'whoever did the work' intent from 38-CONTEXT.md."
  - "Parts cost uses a new batch .in_() query against engineering_parts for unit_cost (the pre-flight stock check only touches engineering_part_stock, not engineering_parts — corrected 38-CONTEXT.md's 'no extra query' premise per the plan)."
  - "The engineering_parts unit_cost query is placed alongside the ensure_sufficient_stock check, BEFORE the transition RPC, so the handler still reads validate-stock -> compute-costs -> transition -> write -> consume-parts and never leaves a WO completed with partial cost/parts state."

patterns-established:
  - "Fake-Supabase test doubles that need engineering_parts batch lookups must implement .in_() — added to both the new cost-capture test's copied FakeQuery and the pre-existing parts-consumption test's local _Query."

metrics:
  duration: ~11min
  tasks: 3
  files: 4
completed: 2026-09-16
---

# Phase 38 Plan 02: Work Order Cost Capture Summary

**`POST /work-orders/{id}/complete` now computes and persists labor_cost (assignee hourly_rate x labor_hours), parts_cost (sum of quantity x engineering_parts.unit_cost), and total_cost at completion time, with NULL-not-zero handling for unknown costs; values round-trip through the raw update response and are documented on WorkOrderResponse.**

## Performance
- **Duration:** ~11 min
- **Completed:** 2026-09-16
- **Tasks:** 3/3 completed
- **Files modified:** 4 (2 code, 2 test)

## Accomplishments
- **Task 1** — Inserted a cost-computation block in `complete_work_order` between the `ensure_sufficient_stock` pre-flight check and the transition RPC, and extended the existing `.update({...})` payload with `labor_cost`/`parts_cost`/`total_cost`. Labor cost derives from the assignee's active `user_roles.hourly_rate` (fallback: the completing user), staying NULL when no rate is on file. Parts cost sums `quantity x unit_cost` via a new batch `.in_()` query against `engineering_parts`, treating a missing/NULL unit_cost as 0. Total cost is NULL only when both inputs are NULL, otherwise `COALESCE(labor,0)+COALESCE(parts,0)`.
- **Task 2** — Added `labor_cost`/`parts_cost`/`total_cost: Optional[float] = None` to `WorkOrderResponse` (documentation/future-proofing; no `response_model=` wiring changed, so no fields stripped from existing endpoints).
- **Task 3** — New `test_work_order_cost_capture.py` with 7 tests (copied `FakeQuery`/`FakeDB` from `test_inventory.py`, added an `rpc()` method for the transition call). All cost rules covered incl. assignee-rate, no-rate NULL, completing-user fallback, unit_cost pricing, unknown-unit_cost-as-0, both-NULL total, and both-present sum. Each parts test also re-asserts the pre-existing stock decrement is intact.

## Task Commits
1. **Task 1** — `4c706eb9` feat(38-02): compute and persist WO labor/parts/total cost on completion
2. **Task 2** — `db5a3cdf` feat(38-02): add labor_cost/parts_cost/total_cost to WorkOrderResponse
3. **Task 3** — `45050bfc` test(38-02): cover WO labor/parts/total cost computation rules

## Files Created/Modified
- `apps/api/routers/work_orders.py` — cost computation + extended update payload in `complete_work_order`.
- `apps/api/models/responses.py` — three new optional cost fields on `WorkOrderResponse`.
- `apps/api/tests/test_work_order_cost_capture.py` — 7 new tests (created).
- `apps/api/tests/test_work_order_parts_consumption.py` — added `.in_()` to its local `_Query` fake (see Deviations).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `.in_()` to test_work_order_parts_consumption.py's local `_Query` fake**
- **Found during:** Task 3 full-suite verification.
- **Issue:** The new `engineering_parts` batch lookup calls `.in_("id", part_ids)`. The pre-existing `test_work_order_parts_consumption.py` uses a minimal local `_Query` double that shares the `complete_work_order` code path but lacked `.in_()`, so `test_complete_work_order_consumes_parts_and_decrements_stock` broke with `AttributeError`.
- **Fix:** Added `in_filters` state, an `in_()` method, and the matching filter to `_Query._matched` — mirroring the `FakeQuery` in `test_inventory.py`. No production behavior change.
- **Files modified:** `apps/api/tests/test_work_order_parts_consumption.py`
- **Commit:** `45050bfc`

**2. [Task 3 test adjustment] Fallback-to-completing-user test uses a gm completer**
- The plan's test 7 described `assigned_to: None` with a rate for the completing engineer. An unassigned WO cannot be completed by an `engineer` role (`_ensure_engineer_can_complete_work_order` raises 403); only `gm` may. The test therefore uses a `gm` completer whose `user_roles` row carries the rate, which still exercises the exact fallback branch (`assigned_to or current_user.user_id`). No production code change.

## Deferred Issues (out of scope)
Three pre-existing `tests/test_management_roi.py` failures (`test_roi_downtime_revenue_uses_tenant_adr`, `test_roi_housekeeping_efficiency_pairs_in_progress_to_clean`, `test_roi_pm_compliance_reads_pm_deferrals_table`) were observed in the full suite. Confirmed present at the pre-38-02 baseline (fail with this plan's changes stashed) and belong to the Management ROI domain, unrelated to cost capture — logged to `deferred-items.md`, not fixed per the SCOPE BOUNDARY rule.

## Verification
- `python -m pytest tests/test_work_order_cost_capture.py -v` — 7/7 pass.
- `python -m pytest tests/test_work_order_parts_consumption.py tests/test_work_order_cost_capture.py tests/test_inventory.py -v` — 21/21 pass.
- `python -m pytest tests/` — 705 passed, 3 failed (all 3 pre-existing management_roi, documented above).
- `python -m ruff check routers/work_orders.py` — all checks passed.

## Issues Encountered
None beyond the two deviations above.

## Next Phase Readiness
Cost values are now stored on every completion and returned in the WO response envelope. Downstream UI plans (38-04 WO detail cost line, 38-05 if any) can read `labor_cost`/`parts_cost`/`total_cost` straight off `GET /work-orders/{id}`. No blockers.

## Self-Check: PASSED
All modified/created files exist on disk; all three task commits (`4c706eb9`, `db5a3cdf`, `45050bfc`) are present in git history.

---
*Phase: 38-engineering-work-order-labor-and-cost-capture*
*Completed: 2026-09-16*
