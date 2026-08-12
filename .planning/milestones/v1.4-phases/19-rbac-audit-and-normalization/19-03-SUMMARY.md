---
phase: 19-rbac-audit-and-normalization
plan: 03
subsystem: api
tags: [rbac, fastapi, lost-found, custody]

# Dependency graph
requires:
  - phase: 19-rbac-audit-and-normalization
    provides: RBAC audit findings (19-01) identifying lost_found.py PATCH/DELETE as ungated
provides:
  - Role-gated PATCH /v1/lost-found/{item_id} (front_desk, housekeeping_supervisor, gm only)
  - Role-gated DELETE /v1/lost-found/{item_id} (front_desk, housekeeping_supervisor, gm only)
  - Regression coverage proving the custody-state gate can no longer be bypassed via PATCH
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: ["Inline role-set gate `if current_user.role not in {\"front_desk\", \"housekeeping_supervisor\", \"gm\"}: raise HTTPException(403)` as first statement in handler body, matching the file's existing custody-events idiom"]

key-files:
  created: []
  modified:
    - apps/api/routers/lost_found.py
    - apps/api/tests/test_lost_found_delete.py

key-decisions:
  - "Reused the literal inline role set {\"front_desk\", \"housekeeping_supervisor\", \"gm\"} rather than introducing a new named constant or importing from core/roles.py, per RESEARCH Decision 4 — this set is unique to lost-found's custody-disposition concept."

patterns-established: []

# Metrics
duration: 12min
completed: 2026-08-04
---

# Phase 19 Plan 03: Lost & Found PATCH/DELETE RBAC Gate Summary

**Closed the RBAC-03 custody-state bypass: PATCH `/v1/lost-found/{item_id}` and DELETE `/v1/lost-found/{item_id}` now require the same role set as the existing custody-events endpoint.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-08-04
- **Completed:** 2026-08-04
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- PATCH `/{item_id}` (`update_lost_found_item`) now 403s for any role outside `{front_desk, housekeeping_supervisor, gm}` — closes the bypass where any authenticated user could set `status` to claimed/donated/discarded without going through the role-gated custody-events endpoint
- DELETE `/{item_id}` (`delete_lost_found_item`) now carries the same gate, preventing non-management/non-front-desk roles from permanently destroying item records
- Extended `test_lost_found_delete.py` with `test_delete_item_forbidden_for_housekeeper`, `test_patch_item_forbidden_for_housekeeper`, and `test_patch_item_allowed_for_gm`, run through the TDD RED→GREEN cycle, alongside the 3 pre-existing gm/404 delete tests (6/6 passing)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend test_lost_found_delete.py with housekeeper-403 cases (RED)** - `03775fbb` (test)
2. **Task 2: Gate PATCH and DELETE lost-found endpoints (GREEN)** - `710896df` (feat)

_Note: this is a TDD plan (RED task 1 → GREEN task 2); no refactor commit was needed._

## Files Created/Modified
- `apps/api/routers/lost_found.py` - Added the inline `{"front_desk", "housekeeping_supervisor", "gm"}` role gate as the first statement in `update_lost_found_item` and `delete_lost_found_item`, matching the pre-existing gate in `record_lost_found_custody_event`
- `apps/api/tests/test_lost_found_delete.py` - Added 3 new tests (2 housekeeper-403 cases, 1 gm-success case for PATCH), alongside the existing 3 delete tests

## Decisions Made
- Reused the literal role set inline (no new constant, no `core/roles.py` import) per RESEARCH Decision 4 — this custody-disposition role set is unique to `lost_found.py` and not one of the RBAC-04 named-constant collisions handled elsewhere in Phase 19.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- A transient collection error (`NameError: name 'MANAGER_ROLES' is not defined` in `routers/programs.py`) appeared on the first test run — caused by a concurrent sibling plan (19-04) mid-edit on a shared file outside this plan's scope. Resolved itself once the sibling's edit completed; re-running the test suite succeeded. No fix was needed or made to `programs.py` by this plan.
- Due to concurrent agents sharing one git index, the Task 2 commit (`710896df`) inadvertently swept in already-staged-but-uncommitted changes to `apps/api/routers/hotels.py`, `programs.py`, and `safety.py` from a sibling plan's in-flight work (this executor's `git add` targeted only `lost_found.py`, but another agent's changes were already in the shared index by commit time). No data was lost — all changes are committed — but they're attributed to this plan's commit message rather than the sibling's. Flagged to the team lead.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
RBAC-03's two confirmed `lost_found.py` gaps are closed. No blockers for sibling plans 19-01/19-02/19-04 or for phase closure.

---
*Phase: 19-rbac-audit-and-normalization*
*Completed: 2026-08-04*

## Self-Check: PASSED

- FOUND: apps/api/routers/lost_found.py
- FOUND: apps/api/tests/test_lost_found_delete.py
- FOUND: .planning/phases/19-rbac-audit-and-normalization/19-03-SUMMARY.md
- FOUND: commit 03775fbb
- FOUND: commit 710896df
