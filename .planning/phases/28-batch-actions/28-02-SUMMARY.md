---
phase: 28-batch-actions
plan: 02
subsystem: api
tags: [fastapi, pydantic, asset-failure-predictions, batch, rbac]

# Dependency graph
requires:
  - phase: 28-batch-actions
    plan: 01
    provides: BatchRoomReadinessRequest's cap/shape convention (reused, not imported — asset domain gets its own model)
provides:
  - "POST /v1/assets/failure-predictions/batch-acknowledge — best-effort per-prediction acknowledge loop"
  - "BatchAcknowledgePredictionsRequest (models/requests.py) — prediction_ids list model, cap 50"
affects: [28-04 (asset batch frontend)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Batch-loop-over-single-item (reused from 28-01): batch endpoint wraps each id in try/except HTTPException around the existing single-item coroutine call, never reimplements guard/validation/write logic"
    - "data=None-as-not_found: unlike room-readiness's 404-raising single-item routes, acknowledge_failure_prediction returns {\"data\": None} with a 200 for a missing/cross-tenant id (tenant-scoped update with no matching row) — the batch loop inspects the returned data directly rather than relying on a raised HTTPException to detect the not-found case"

key-files:
  created:
    - apps/api/tests/test_asset_failure_batch_actions.py
  modified:
    - apps/api/models/requests.py
    - apps/api/routers/assets.py
    - apps/api/RBAC-MATRIX.md

key-decisions:
  - "Gate is require_role(\"gm\", \"engineer\") only — mirrors the single-item acknowledge_failure_prediction gate exactly. chief_engineer is NOT added (LOCKED in CONTEXT.md/REQUIREMENTS.md, corrected 2026-08-13 from an earlier mistaken 'Engineer/chief_engineer/GM' draft to match the real single-item endpoint's actual gate). Widening chief_engineer access is a separate pre-existing gap explicitly out of this phase's scope."
  - "Cap set to 50, matching 28-01's BatchRoomReadinessRequest for consistency across both batch domains in this phase."

patterns-established:
  - "Best-effort batch response shape (same shape as 28-01, per-domain field name): {\"data\": {\"results\": [...], \"succeeded\": N, \"failed\": N}}, one entry per requested id, order preserved. A missing/cross-tenant id becomes {\"prediction_id\", \"action\": \"not_found\"} (not an error, not a silent success) since the underlying single-item update never raises for that case; a raised HTTPException becomes {\"prediction_id\", \"action\": \"error\", \"status\", \"detail\"}."

# Metrics
duration: ~20min
completed: 2026-08-13
---

# Phase 28 Plan 02: Asset Failure-Prediction Batch Acknowledge Backend Summary

**One best-effort batch endpoint (`batch-acknowledge`) that loops the existing single-item `acknowledge_failure_prediction` coroutine per prediction id, gm/engineer only, correctly distinguishing acknowledged / not_found / error per item instead of an all-or-nothing response.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2 completed
- **Files modified:** 3 (+1 created)

## Accomplishments
- `BatchAcknowledgePredictionsRequest` model (`prediction_ids: List[UUID4]`, min 1, max 50) added to `apps/api/models/requests.py`, next to `BatchRoomReadinessRequest`
- `POST /v1/assets/failure-predictions/batch-acknowledge` added to `apps/api/routers/assets.py`, gated `require_role("gm", "engineer")` only (no `chief_engineer` — LOCKED decision), looping the existing `acknowledge_failure_prediction` coroutine with per-item `try/except HTTPException`
- RBAC-MATRIX.md regenerated (30 routers, 292 routes, up from 291) to satisfy the CI drift guard — same expected drift class as Phase 27-02 and 28-01
- 13 new tests in `apps/api/tests/test_asset_failure_batch_actions.py`: happy path, not_found-vs-acknowledged diff (missing + cross-tenant ids), partial-failure best-effort, idempotency, cap/empty validation, RBAC (gm/engineer allowed; chief_engineer/housekeeper/front_desk/housekeeping_supervisor 403, with an explicit chief_engineer-not-widened assertion)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add BatchAcknowledgePredictionsRequest model + batch-acknowledge endpoint to assets.py** - `0c338893` (feat, includes RBAC-MATRIX.md regen)
2. **Task 2: Write test_asset_failure_batch_actions.py** - `b9690eb6` (test)

## Final Response Shape (for Plan 28-04's frontend)

**`POST /v1/assets/failure-predictions/batch-acknowledge`** — body `{"prediction_ids": ["<uuid>", ...]}` (1-50 ids), gated `gm`/`engineer` only:

```json
{
  "data": {
    "results": [
      {"prediction_id": "<uuid>", "action": "acknowledged"},
      {"prediction_id": "<uuid>", "action": "not_found"},
      {"prediction_id": "<uuid>", "action": "error", "status": 500, "detail": "..."}
    ],
    "succeeded": 1,
    "failed": 2
  }
}
```

`results` order always matches the request's `prediction_ids` order. **Important domain difference from 28-01's room-readiness batch actions:** a missing or cross-tenant `prediction_id` yields `action: "not_found"` (not `"error"`) — the single-item `acknowledge_failure_prediction` never raises 404, it does a tenant-scoped update that silently matches zero rows and returns `{"data": None}` with a 200. `not_found` still counts toward `failed`, same as `error`; the frontend should treat both `not_found` and `error` as "did not succeed" and can distinguish them for messaging if desired. Both `422` (empty list or >50 ids, before any write) and `403` (non-gm/engineer role) are whole-request failures, not per-item.

## Files Created/Modified
- `apps/api/models/requests.py` - `BatchAcknowledgePredictionsRequest` added directly after `BatchRoomReadinessRequest`
- `apps/api/routers/assets.py` - `batch_acknowledge_failure_predictions` added after the single-item `acknowledge_failure_prediction`; import of `BatchAcknowledgePredictionsRequest` added
- `apps/api/RBAC-MATRIX.md` - regenerated (30 routers, 292 routes)
- `apps/api/tests/test_asset_failure_batch_actions.py` - new, 13 tests

## Decisions Made
- Gate mirrors the single-item endpoint exactly (`gm`, `engineer`) — no `chief_engineer`, per the phase-research-corrected scope in CONTEXT.md/REQUIREMENTS.md.
- Cap of 50, matching 28-01's convention for the phase's other batch model.
- No bulk `.in_()` pre-fetch — every id goes through the real single-item coroutine so tenant scoping and the ack-write logic are inherited by construction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Regenerated stale RBAC-MATRIX.md**
- **Found during:** Task 1 verification (`pytest tests/smoke/test_rbac_matrix_contract.py`)
- **Issue:** The new route made the Phase 23 CI drift guard fail against the previously-committed `RBAC-MATRIX.md` — explicitly anticipated by both the plan and 28-01's own summary.
- **Fix:** Ran `python apps/api/scripts/generate_rbac_matrix.py`; drift guard now passes (30 routers, 292 routes, up from 291).
- **Files modified:** `apps/api/RBAC-MATRIX.md`
- **Verification:** `pytest tests/smoke/test_rbac_matrix_contract.py -q` → 3 passed.
- **Committed in:** `0c338893`

---

**Total deviations:** 1 auto-fixed (blocking/CI-drift, fully anticipated by the plan)
**Impact on plan:** No scope creep, no unexpected production code changes.

## Issues Encountered
None beyond the anticipated RBAC drift-guard regen.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 28-04 (asset batch frontend, wave 3) can type its API client directly against the exact response shape documented above, and must handle `not_found` as a distinct-but-failed outcome (unlike 28-01's room-readiness domain, where a not-found room is always `action: "error"`).
- No blockers.

---
*Phase: 28-batch-actions*
*Completed: 2026-08-13*

## Self-Check: PASSED

Verified `apps/api/models/requests.py`, `apps/api/routers/assets.py`, `apps/api/RBAC-MATRIX.md`, and `apps/api/tests/test_asset_failure_batch_actions.py` exist with the expected content. Both task commit hashes (`0c338893`, `b9690eb6`) confirmed present in `git log`.
