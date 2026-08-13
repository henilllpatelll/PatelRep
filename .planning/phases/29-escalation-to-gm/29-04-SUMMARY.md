---
phase: 29-escalation-to-gm
plan: 04
subsystem: ai-prediction-actions
tags: [escalation, watermark, room-readiness, failure-predictions, rbac-matrix]

requires:
  - phase: 29-escalation-to-gm (29-01)
    provides: escalation_level/high_risk_since columns (migration 096)
  - phase: 29-escalation-to-gm (29-02)
    provides: prediction-engine watermark preserve/reset/carry-forward semantics that this plan's reset call sites interact with
provides:
  - reset of escalation_level/high_risk_since on all 5 human-action single-item paths (reassign, escalate, acknowledge for room-readiness; acknowledge, create-work-order for asset-failure)
affects: [29-VERIFICATION, phase-29-close]

tech-stack:
  added: []
  patterns:
    - "side-effect-only .update() call added after existing guards, before branch-specific logic, so all outcome branches share one reset call site"

key-files:
  created:
    - apps/api/tests/test_asset_prediction_actions.py
  modified:
    - apps/api/routers/housekeeping.py
    - apps/api/routers/assets.py
    - apps/api/tests/test_room_readiness_actions.py
    - apps/api/RBAC-MATRIX.md

key-decisions:
  - "reassign_at_risk_room resets the watermark once, right after the DIRTY/IN_PROGRESS/PICKUP status guard and before the eligible/not-eligible branch splits, so both outcome branches (reassigned, escalated-no-capacity) share a single reset call site rather than duplicating it into each branch"
  - "create_work_order_from_prediction's reset is placed after the work_orders insert, before return, as a pure side effect with no change to the function's return shape (still just the created work order)"

metrics:
  duration: ~25min
  completed: 2026-08-13
---

# Phase 29 Plan 04: Reset Call Sites Summary

**Escalation watermark reset landed at all 5 human-action single-item paths (3 room-readiness, 2 asset-failure), closing the last gap in AI-13's "stops the instant a human engages with it" requirement.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 completed
- **Files modified:** 4 (2 routers, 1 extended test file, 1 new test file) + 1 generated artifact (RBAC-MATRIX.md)

## Accomplishments
- `reassign_at_risk_room` and `escalate_at_risk_room` (`housekeeping.py`) each gained a genuinely new `.update()` call resetting `escalation_level=0`/`high_risk_since=None` — neither function touched `room_readiness_predictions` before this plan.
- `acknowledge_at_risk_room` (`housekeeping.py`) and `acknowledge_failure_prediction` (`assets.py`) extended their existing ack-column `.update()` calls with the same two keys.
- `create_work_order_from_prediction` (`assets.py`) — the reset call site this phase's own research flagged as easiest to skip — gained a brand-new `.update()` call on `failure_predictions`, a table it previously never touched at all.
- Response payload shapes for all five functions are byte-identical to before; every reset is a side effect only, verified by re-running every pre-existing test in both affected test files unchanged.
- Phase 28's three batch endpoints (`batch_reassign_rooms`, `batch_acknowledge_rooms`, `batch_acknowledge_failure_predictions`) inherit correct reset behavior with zero code changes, confirmed by re-running their test files unmodified (14 + 15 tests, all passing).

## Task Commits

Each task was committed atomically:

1. **Task 1: Reset escalation watermark in the three room-readiness single-item actions** - `15071628` (feat)
2. **Task 2: Reset escalation watermark in the two asset-failure single-item actions** - `0dd03322` (feat)

**Deviation fix:** `a3469adc` (chore: regenerate RBAC-MATRIX.md for shifted source line numbers)

## Files Created/Modified
- `apps/api/routers/housekeeping.py` - new `.update()` calls in `reassign_at_risk_room`/`escalate_at_risk_room`; extended existing update in `acknowledge_at_risk_room`
- `apps/api/routers/assets.py` - extended existing update in `acknowledge_failure_prediction`; new `.update()` call in `create_work_order_from_prediction`
- `apps/api/tests/test_room_readiness_actions.py` - `_base_rows()` fixture extended with `escalation_level`/`high_risk_since`; 3 new tests (`test_reassign_success_resets_escalation_watermark`, `test_reassign_no_capacity_resets_escalation_watermark`, `test_escalate_resets_escalation_watermark`) plus reset assertions added to `test_acknowledge_sets_ack_columns`
- `apps/api/tests/test_asset_prediction_actions.py` (new) - `test_acknowledge_resets_escalation_watermark`, `test_create_work_order_resets_escalation_watermark` (the explicit anti-false-alarm regression test)
- `apps/api/RBAC-MATRIX.md` - regenerated (route/role content unchanged, only `[Lxxx]` line-number references shifted)

## Decisions Made
- `reassign_at_risk_room`'s reset call is placed once, before the eligible/not-eligible branch split, so both outcomes (reassigned, escalated-no-capacity) share it rather than duplicating the call into each branch.
- `create_work_order_from_prediction`'s reset call is placed after the `work_orders` insert and before the return, as a pure side effect — the function's return shape (created work order only) is unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Regenerated stale RBAC-MATRIX.md**
- **Found during:** Post-Task-2 full suite run
- **Issue:** The new `.update()` statements added lines to `housekeeping.py`/`assets.py`, shifting the source-line references (`[Lxxx]`) the CI drift guard (`test_rbac_matrix_contract.py`) checks against — no route, role, or gate changed, purely a line-number diff. Same expected drift class documented in 27-02, 28-01, 28-02, 29-03.
- **Fix:** Ran `python apps/api/scripts/generate_rbac_matrix.py` and committed the regenerated file (still 30 routers, 293 routes — unchanged counts).
- **Files modified:** `apps/api/RBAC-MATRIX.md`
- **Verification:** `pytest apps/api/tests/smoke/test_rbac_matrix_contract.py -v` — 3/3 passed after regen (was 1 failed before).
- **Committed in:** `a3469adc`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to keep the CI drift guard green; no functional code change, no scope creep.

## Issues Encountered
None beyond the RBAC-matrix drift documented above.

## User Setup Required
None - no external service configuration required.

## Full Test Suite

`pytest apps/api/tests/ -q` (run from `apps/api/`): **637 passed, 3 failed**.

The 3 failures are `test_management_roi.py`'s pre-existing, unrelated failures (`test_roi_downtime_revenue_uses_tenant_adr`, `test_roi_housekeeping_efficiency_pairs_in_progress_to_clean`, `test_roi_pm_compliance_reads_pm_deferrals_table`) — documented as pre-existing and unrelated across STATE.md since Phase 06/15/25-29, unchanged by this plan.

Baseline before this plan (per 29-02-SUMMARY.md): 632 passed, 3 failed. This plan added 5 new tests (3 in `test_room_readiness_actions.py`, 2 in `test_asset_prediction_actions.py`) — 632 + 5 = 637, matching exactly.

## Next Phase Readiness
- This is the last plan in Phase 29. All 4 plans (29-01 migration, 29-02 prediction-engine carry-forward, 29-03 escalation cron, 29-04 reset call sites) are now code-complete.
- AI-13's full requirement — "escalation stops the moment it is reassigned, acknowledged, or its risk drops below HIGH" — is now fully implemented: risk-drop handled by 29-02 (inside the prediction engines), human-action handled by this plan (at the 5 single-item action call sites).
- Phase-gate verification/close remains as a separate step.

---
*Phase: 29-escalation-to-gm*
*Completed: 2026-08-13*

## Self-Check

- `apps/api/routers/housekeeping.py` — FOUND (modified)
- `apps/api/routers/assets.py` — FOUND (modified)
- `apps/api/tests/test_room_readiness_actions.py` — FOUND (modified)
- `apps/api/tests/test_asset_prediction_actions.py` — FOUND (created)
- `apps/api/RBAC-MATRIX.md` — FOUND (regenerated)
- `.planning/phases/29-escalation-to-gm/29-04-SUMMARY.md` — FOUND
- Commit `15071628` — FOUND
- Commit `0dd03322` — FOUND
- Commit `a3469adc` — FOUND

## Self-Check: PASSED
