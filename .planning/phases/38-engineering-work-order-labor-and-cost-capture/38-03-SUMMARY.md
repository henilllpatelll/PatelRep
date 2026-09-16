---
phase: 38-engineering-work-order-labor-and-cost-capture
plan: 03
subsystem: api
tags: [fastapi, rbac, inventory, staff, pydantic, cost-capture]

requires: ["38-01"]
provides:
  - "unit_cost writable on engineering parts via existing manager-gated parts CRUD"
  - "hourly_rate writable on staff via PATCH /v1/staff/{staff_id} (gm-only, 0-500 validated)"
  - "hourly_rate role-gated out of GET /v1/staff for every non-gm caller"
affects: [38-04]

tech-stack:
  added: []
  patterns:
    - "Data-shaping role check (dict-key inclusion) allowlisted in rbac_bare_comparison_allowlist.json rather than routed through require_role, since it narrows response shape, not access"

key-files:
  created:
    - apps/api/tests/test_staff_hourly_rate.py
  modified:
    - apps/api/models/requests.py
    - apps/api/routers/staff.py
    - apps/api/tests/test_inventory.py
    - apps/api/rbac_bare_comparison_allowlist.json
    - apps/api/RBAC-MATRIX.md

key-decisions:
  - "unit_cost added to the request models only — inventory.py needs no change because create_part/update_part already model_dump() straight to Supabase (verified at inventory.py:115 and :189)."
  - "list_staff RBAC gate left unchanged (still reachable by 5 roles for assignment pickers); hourly_rate leak prevented by omitting the dict key entirely for non-gm callers, not by null-ing it — a stricter, unambiguous absence."
  - "update_staff validates hourly_rate manually (0-500) because that endpoint takes a raw dict, not the Pydantic model — the Field(ge=0, le=500) on UpdateStaffProfileRequest does not reach this route."
  - "UpdateStaffProfileRequest.hourly_rate added per the locked decision even though that model is not wired to any endpoint (dead code today); the reachable write path is update_staff, which was wired separately."
  - "Regenerated RBAC-MATRIX.md — it was stale relative to both my staff.py inline gate and 38-02's already-committed work_orders.py line shifts; regeneration reads all routers at HEAD, so both are captured. Coordinated with exec-38-02 to avoid a double-regenerate conflict."

metrics:
  duration: ~20min
  completed: 2026-09-16
  tasks: 3
  files: 6
---

# Phase 38 Plan 03: unit_cost / hourly_rate Write + RBAC Summary

**Wired the two rate/cost inputs this phase needs: `unit_cost` on engineering parts (via existing manager-gated CRUD) and `hourly_rate` on staff (GM-only write, range-validated, never leaked to non-GM read responses).**

## Performance
- **Duration:** ~20 min
- **Completed:** 2026-09-16
- **Tasks:** 3/3 completed
- **Files:** 6 (1 created, 5 modified)

## Accomplishments
- `unit_cost: Optional[float] (0–1,000,000)` added to `CreateEngineeringPartRequest` and `UpdateEngineeringPartRequest`; flows through to Supabase automatically via the existing `model_dump()` pass-through in `inventory.py` (no router change).
- `hourly_rate: Optional[float] (0–500)` added to `UpdateStaffProfileRequest` (per locked decision) AND wired into the actually-reachable `PATCH /v1/staff/{staff_id}` (`update_staff`): added to `allowed_fields`, with explicit 0-500 range validation since that route takes a raw `dict`.
- `list_staff` now selects `hourly_rate` but includes the key in each staff entry only when `current_user.role == "gm"` — the key is structurally absent (not null) for every other role.
- 7 new tests (2 in test_inventory.py, 5 in new test_staff_hourly_rate.py) — all pass.

## Task Commits
1. **Task 1: Request models** — `ae61107a`
2. **Task 2: staff.py write + read gating** — `30e3529b`
3. **Task 3: Tests + RBAC drift-guard updates** — `c34cb674`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] RBAC drift guards failed after the staff.py change**
- **Found during:** Task 3 (full-suite verification)
- **Issue:** `test_bare_role_comparison_guard.py` flagged the new `current_user.role == "gm"` inline check in `list_staff`, and `test_rbac_matrix_contract.py` failed because `RBAC-MATRIX.md` was stale (my inline gate + the line-number shifts from 38-02's already-committed work_orders.py cost edits).
- **Fix:** Added a reasoned entry for `staff.py` to `rbac_bare_comparison_allowlist.json` (data-shaping check, not a denial gate — same class as the existing guest_requests.py L382 entry), and regenerated `RBAC-MATRIX.md` via `scripts/generate_rbac_matrix.py`.
- **Files modified:** `apps/api/rbac_bare_comparison_allowlist.json`, `apps/api/RBAC-MATRIX.md`
- **Commit:** `c34cb674`

**2. [Environment] test_inventory.py edits reverted mid-execution**
- A linter/external process reverted the first application of the two `test_inventory.py` unit_cost tests. Re-applied them; they are present and passing in the final commit.

## Deferred Issues (out of scope — logged to deferred-items.md)
- `test_management_roi.py` — 3 failing tests (`total_downtime_hours` computes 0 vs expected 48.0); a date-interval bug in `management_roi.py`, unrelated to any 38-03 file. Pre-existing relative to this plan.
- `test_work_order_parts_consumption.py::test_complete_work_order_consumes_parts_and_decrements_stock` — `AttributeError: '_Query' object has no attribute 'in_'` at `work_orders.py:481`. 38-02's territory (their test FakeQuery needs an `in_` method for the new stock pre-fetch). Flagged to exec-38-02.

## Verification
- `pytest tests/test_inventory.py tests/test_staff_hourly_rate.py tests/smoke/test_bare_role_comparison_guard.py tests/smoke/test_rbac_matrix_contract.py` — 24 passed.
- Full suite: 704 passed, 4 failed — all 4 failures are outside this plan's `files_modified` (see Deferred Issues).

## Next Phase Readiness
38-04 (UI) can now surface a `unit_cost` input on the parts form and a GM-only `hourly_rate` input on the staff edit surface against these endpoints. No blockers from this plan.

## Self-Check: PASSED
All created/modified files present on disk; all 3 task commits (ae61107a, 30e3529b, c34cb674) exist in git history.

---
*Phase: 38-engineering-work-order-labor-and-cost-capture*
*Completed: 2026-09-16*
