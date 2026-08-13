---
phase: 28-batch-actions
plan: 01
subsystem: api
tags: [fastapi, pydantic, room-readiness, batch, rbac]

# Dependency graph
requires:
  - phase: 27-room-readiness-actions
    provides: reassign_at_risk_room / acknowledge_at_risk_room single-item coroutines and their response shapes
provides:
  - "POST /v1/housekeeping/room-readiness/batch-reassign — best-effort per-room reassign loop"
  - "POST /v1/housekeeping/room-readiness/batch-acknowledge — best-effort per-room acknowledge loop"
  - "BatchRoomReadinessRequest (models/requests.py) — shared room_ids list model, cap 50"
affects: [28-03 (room-readiness batch frontend), 28-02 (asset batch backend — reuses BatchRoomReadinessRequest's shape convention)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Batch-loop-over-single-item: batch endpoint wraps each id in try/except HTTPException around the existing single-item coroutine call, never reimplements guard/validation/write logic"

key-files:
  created:
    - apps/api/tests/test_room_readiness_batch_actions.py
  modified:
    - apps/api/models/requests.py
    - apps/api/routers/housekeeping.py
    - apps/api/RBAC-MATRIX.md

key-decisions:
  - "Cap set to 50 (not the 200 used by BulkArchiveWorkOrdersRequest) — HIGH-risk room lists at a 50-150 room property are inherently small and this is a synchronous request, not a background sweep, per CONTEXT.md"
  - "Each batch handler awaits the real single-item coroutine per id (reassign_at_risk_room / acknowledge_at_risk_room) rather than a bulk .in_() pre-fetch, so the per-item live re-read and 404/409 guards are inherited by construction, not re-derived"

patterns-established:
  - "Best-effort batch response shape: {\"data\": {\"results\": [...], \"succeeded\": N, \"failed\": N}}, one entry per requested id, order preserved, a failing item becomes {\"room_id\", \"action\": \"error\", \"status\", \"detail\"} instead of aborting the batch"

# Metrics
duration: ~35min
completed: 2026-08-13
---

# Phase 28 Plan 01: Room-Readiness Batch Actions Backend Summary

**Two best-effort batch endpoints (`batch-reassign`, `batch-acknowledge`) that loop Phase 27's existing single-item room-readiness coroutines per room id, returning one result entry per id with succeeded/failed counts instead of an all-or-nothing response.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2 completed
- **Files modified:** 3 (+1 created)

## Accomplishments
- `BatchRoomReadinessRequest` model (`room_ids: List[UUID4]`, min 1, max 50) added to `apps/api/models/requests.py`
- `POST /v1/housekeeping/room-readiness/batch-reassign` and `POST /v1/housekeeping/room-readiness/batch-acknowledge` added to `apps/api/routers/housekeeping.py`, both gated `require_role("gm", "housekeeping_supervisor")`, both looping the existing `reassign_at_risk_room` / `acknowledge_at_risk_room` coroutines with per-item `try/except HTTPException`
- RBAC-MATRIX.md regenerated (30 routers, 291 routes, up from 289) to satisfy the CI drift guard
- 14 new tests in `apps/api/tests/test_room_readiness_batch_actions.py` covering happy path, partial failure, escalate-no-capacity-as-success, acknowledge idempotency, per-item live re-read, concurrent-mutation, cap/empty validation, RBAC, and tenant isolation

## Task Commits

Each task was committed atomically:

1. **Task 1: Add BatchRoomReadinessRequest model + two batch endpoints to housekeeping.py** - `1e7d41b6` (feat) + `3408d757` (chore: RBAC-MATRIX regen, required by the drift guard this task's new routes triggered)
2. **Task 2: Write test_room_readiness_batch_actions.py** - `c1af83d6` (test)

## Final Response Shapes (for Plan 28-03's frontend)

**`POST /v1/housekeeping/room-readiness/batch-reassign`** — body `{"room_ids": ["<uuid>", ...]}` (1-50 ids):

```json
{
  "data": {
    "results": [
      {"room_id": "<uuid>", "action": "reassigned", "housekeeper_id": "<uuid>"},
      {"room_id": "<uuid>", "action": "escalated", "reason": "no_eligible_housekeeper"},
      {"room_id": "<uuid>", "action": "error", "status": 409, "detail": "Room is no longer awaiting cleaning"},
      {"room_id": "<uuid>", "action": "error", "status": 404, "detail": "Room not found"}
    ],
    "succeeded": 2,
    "failed": 2
  }
}
```

**`POST /v1/housekeeping/room-readiness/batch-acknowledge`** — same request shape:

```json
{
  "data": {
    "results": [
      {"room_id": "<uuid>", "action": "acknowledged"},
      {"room_id": "<uuid>", "action": "already_acknowledged"},
      {"room_id": "<uuid>", "action": "error", "status": 404, "detail": "Prediction not found"}
    ],
    "succeeded": 2,
    "failed": 1
  }
}
```

`results` order always matches the request's `room_ids` order. `action == "error"` is the only marker of failure — `succeeded`/`failed` are precomputed counts, but the frontend should filter on `action !== "error"` if it needs the successful subset directly. Both `422` (empty list or >50 ids, before any write) and `403` (non-gm/housekeeping_supervisor role) are whole-request failures, not per-item — the batch never partially executes in those cases.

## Files Created/Modified
- `apps/api/models/requests.py` - `BatchRoomReadinessRequest` added near `BulkArchiveWorkOrdersRequest`
- `apps/api/routers/housekeeping.py` - `batch_reassign_rooms` and `batch_acknowledge_rooms` added after `acknowledge_at_risk_room`; import of `BatchRoomReadinessRequest` added
- `apps/api/RBAC-MATRIX.md` - regenerated (30 routers, 291 routes)
- `apps/api/tests/test_room_readiness_batch_actions.py` - new, 14 tests

## Decisions Made
- Cap of 50 (not 200) per plan/CONTEXT.md rationale — see key-decisions above.
- No bulk `.in_()` pre-fetch anywhere in either handler; each id goes through its own full single-item coroutine call so the live re-read and existing 404/409 guards are inherited, not shortcut.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Regenerated stale RBAC-MATRIX.md**
- **Found during:** Task 1 verification (`pytest tests/smoke/test_rbac_matrix_contract.py`)
- **Issue:** The two new routes made the Phase 23 CI drift guard fail against the previously-committed `RBAC-MATRIX.md` — explicitly anticipated by the plan ("Phase 27-02 hit this same CI drift guard when adding routes").
- **Fix:** Ran `python apps/api/scripts/generate_rbac_matrix.py`; drift guard now passes (30 routers, 291 routes, up from 289).
- **Files modified:** `apps/api/RBAC-MATRIX.md`
- **Verification:** `pytest tests/smoke/test_rbac_matrix_contract.py -q` → 3 passed.
- **Committed in:** `3408d757`

**2. [Rule 1 - Bug, test-only] Fixed a flaky test fixture caused by a set-iteration tie**
- **Found during:** Task 2, initial run of the new test file (intermittent failures on repeat runs, not a code bug)
- **Issue:** The shared `_multi_room_db` test fixture seeded two shift-assigned housekeepers but only one valid `user_roles` entry, with a flat mocked `count_rooms_ahead` returning the same value for both. `_active_housekeepers` (production code, unchanged) builds its candidate id list via a Python `set`, so `min()`'s tie-break between two equally-scored candidates depended on nondeterministic set-iteration order (`PYTHONHASHSEED`-dependent) — roughly half of runs picked the housekeeper without a valid `user_roles` row, which then 404'd inside the real `create_assignments` call.
- **Fix:** Simplified the fixture to a single shift-assigned/active housekeeper (multi-candidate least-loaded selection is already covered by `test_room_readiness_actions.py`), and made the select_calls-count assertion scale with room count (`2 * len(room_ids)`, since each room triggers one status read inside `reassign_at_risk_room` and one inside `create_assignments`) instead of a fixed literal.
- **Files modified:** `apps/api/tests/test_room_readiness_batch_actions.py` (test-only, no production code change)
- **Verification:** Re-ran the full file 5 consecutive times with no failures (previously flaky ~50% of runs).
- **Committed in:** `c1af83d6` (fixture was corrected before this commit; no separate fix-up commit was needed since the bug was caught during the same task before committing)

---

**Total deviations:** 2 auto-fixed (1 blocking/CI-drift, 1 bug/test-only-flaky-fixture)
**Impact on plan:** Both were anticipated risk classes (the plan explicitly flagged the RBAC drift guard); no scope creep, no production code changed by the second fix.

## Issues Encountered
None beyond the two deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 28-03 (room-readiness batch frontend) can type its API client directly against the exact response shapes documented above.
- Plan 28-02 (asset batch backend, wave 2) can reuse `BatchRoomReadinessRequest`'s cap/shape convention for its own asset-id batch model without needing to re-derive it.
- No blockers.

---
*Phase: 28-batch-actions*
*Completed: 2026-08-13*

## Self-Check: PASSED

All created/modified files confirmed present on disk; all 3 task commit hashes (`1e7d41b6`, `3408d757`, `c1af83d6`) confirmed present in git history.
