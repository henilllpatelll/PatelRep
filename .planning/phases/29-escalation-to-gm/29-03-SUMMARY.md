---
phase: 29-escalation-to-gm
plan: 03
subsystem: api
tags: [fastapi, apscheduler, cron, notifications, escalation]

# Dependency graph
requires:
  - phase: 29-01
    provides: escalation_level SMALLINT + high_risk_since TIMESTAMPTZ columns on room_readiness_predictions and failure_predictions (migration 096, live)
provides:
  - "check_prediction_escalations() coroutine + POST /v1/internal/predictions/escalations/check route"
  - "predictions.escalation-check cron job registered in scheduler.py, firing every 30 minutes"
  - "test_prediction_escalations.py: 8 tests proving escalate-once/dedup/threshold/acknowledged-exclusion behavior"
affects: [29-04, milestone-v1.7-audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "single-tier escalation_level watermark (0/1) collapsed from check_escalations' 3-tier pattern, per AI-17's deferral to v2"
    - "fixture-safety None-guard on high_risk_since before FakeDB's string-comparison .lt() filter (false-positive risk against NULL in the test harness only, not in real Postgres)"

key-files:
  created:
    - apps/api/tests/test_prediction_escalations.py
  modified:
    - apps/api/routers/internal.py
    - apps/api/core/scheduler.py
    - apps/api/tests/test_cron_scheduler.py
    - apps/api/RBAC-MATRIX.md

key-decisions:
  - "New cron kept separate from predictions.run/ai.failure-predictions (detection/regeneration engines) rather than folded in — matches escalations.check's own precedent of being split out from work-order/task creation"
  - "failure_predictions filtered on risk_score >= 70, not risk_level = 'HIGH' — that column does not exist on failure_predictions (confirmed in 29-RESEARCH.md)"

patterns-established:
  - "Single-tier escalation cron: query HIGH/>=70 + not-acknowledged + escalation_level<1 + high_risk_since<cutoff, update escalation_level=1, notify gm role, in one _record_cron_run-terminated coroutine"

duration: 35min
completed: 2026-08-13
---

# Phase 29 Plan 03: Single-Tier GM Escalation Cron Summary

**New `predictions.escalation-check` cron (POST /v1/internal/predictions/escalations/check) notifies every active GM exactly once per HIGH-risk episode — room-readiness or asset-failure — left un-actioned past 60 minutes, using the escalation_level watermark from Plan 29-01 to prevent duplicate notifications across the `*/30` cron's repeated runs.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 1 TDD cycle (RED -> GREEN), 2 commits
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- `check_prediction_escalations()` added to `apps/api/routers/internal.py`, mirroring `check_escalations`'s query/update/notify shape but collapsed to a single tier (escalation_level 0 -> 1)
- `predictions.escalation-check` wired into both `CRON_SCHEDULE` (`*/30` minutes) and `_job_handlers()` in `apps/api/core/scheduler.py`, in the same commit as the internal.py change so `build_scheduler()`'s fail-fast mismatch check never breaks
- 8 new tests in `apps/api/tests/test_prediction_escalations.py` prove: room escalation + GM notify, asset escalation + GM notify, 3-consecutive-runs dedup for both domains, not-yet-overdue exclusion, acknowledged exclusion, below-risk-score-threshold exclusion, and invalid-cron-secret 401

## Task Commits

1. **RED: failing tests for prediction escalation cron** - `8be3bcad` (test)
2. **GREEN: implement check_prediction_escalations + scheduler wiring** - `e9625907` (feat)

_No REFACTOR commit — the room/asset halves are structurally parallel but small enough (~25 lines each) that a shared helper would add indirection without reducing real duplication; kept as written per the plan's own "if needed" framing._

## Files Created/Modified
- `apps/api/tests/test_prediction_escalations.py` - 8 tests: escalate-and-notify (room, asset), 3x-run dedup (room, asset), not-yet-overdue, acknowledged-exclusion, below-risk-score-threshold, invalid-cron-secret 401
- `apps/api/routers/internal.py` - new `check_prediction_escalations()` coroutine + `POST /predictions/escalations/check` route, placed after `check_escalations`
- `apps/api/core/scheduler.py` - `predictions.escalation-check` added to `CRON_SCHEDULE` (`*/30`) and `_job_handlers()` (-> `internal.check_prediction_escalations`)
- `apps/api/tests/test_cron_scheduler.py` - `EXPECTED_JOBS` set updated to include `predictions.escalation-check` (Rule 3 fix, see Deviations)
- `apps/api/RBAC-MATRIX.md` - regenerated (30 routers, 293 routes, up from 292) for the new route (Rule 3 fix, see Deviations)

## Decisions Made
- Kept the plan's exact implementation verbatim (query filters, update payload, `_notify_role` calls, `_record_cron_run` job name) — no deviation from the spec.
- No REFACTOR step taken; duplication between the room and asset loops is minor and the plan explicitly made this optional.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `test_cron_scheduler.py`'s hardcoded `EXPECTED_JOBS` set didn't include the new job**
- **Found during:** Full-suite verification after GREEN
- **Issue:** `test_schedule_and_handlers_cover_the_same_jobs` and `test_build_scheduler_registers_every_job` assert `set(sched.CRON_SCHEDULE) == EXPECTED_JOBS` against a hardcoded 13-job set in the test file itself (separate from `build_scheduler()`'s own internal mismatch check) — adding the 14th job without updating this test-local constant broke both tests.
- **Fix:** Added `"predictions.escalation-check"` to `EXPECTED_JOBS` in `apps/api/tests/test_cron_scheduler.py`.
- **Files modified:** `apps/api/tests/test_cron_scheduler.py`
- **Verification:** Both tests pass on re-run.
- **Committed in:** `e9625907` (part of the GREEN commit)

**2. [Rule 3 - Blocking] `RBAC-MATRIX.md` went stale relative to the new route**
- **Found during:** Full-suite verification after GREEN
- **Issue:** Phase 23's CI drift guard (`test_rbac_matrix_contract.py::test_rbac_matrix_matches_generated_output`) fails whenever a new route is added without regenerating the committed matrix file — same class of expected drift every prior phase touching a router has hit (27-02, 28-01, 28-02).
- **Fix:** Ran `python apps/api/scripts/generate_rbac_matrix.py`.
- **Files modified:** `apps/api/RBAC-MATRIX.md` (30 routers, 293 routes, up from 292)
- **Verification:** `test_rbac_matrix_matches_generated_output` passes on re-run.
- **Committed in:** `e9625907` (part of the GREEN commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3, blocking, both directly caused by this plan's own new route/cron job addition)
**Impact on plan:** No scope creep — both fixes are the exact "add together, not just one side" / drift-guard classes the plan's own verification section anticipated.

## Issues Encountered
During the first full-suite run (622 passed / 13 failed), 10 of the 13 failures were in `apps/api/tests/test_failure_prediction_notifications.py` and `apps/api/tests/test_room_readiness_actions.py` — files explicitly owned by the parallel `29-02` executor agent, mid-flight in a separate session at the same time. Per this plan's own environment note, these were not touched. A second full-suite run after 29-02 completed (632 passed / 3 failed) confirmed all 10 cleared on their own, leaving only the 3 pre-existing, unrelated `test_management_roi.py` failures documented as pre-existing in every prior phase's SUMMARY since at least Phase 25.

## Next Phase Readiness
- AI-12 and AI-14 are delivered: a HIGH-risk prediction left un-actioned past 60 minutes generates exactly one GM notification per episode, for both room-readiness and asset-failure domains.
- `build_scheduler()` boots cleanly with the new job registered on both sides — confirmed by `test_build_scheduler_registers_every_job` and `test_schedule_and_handlers_cover_the_same_jobs`.
- Full suite: 632/632 relevant tests passing (3 pre-existing unrelated `test_management_roi.py` failures unchanged, not attributable to this or any Phase 29 plan).
- Plan 29-04 (if any) or phase-gate verification can now rely on the escalation cron being live in `CRON_SCHEDULE`/`_job_handlers()` and correctly gated by `verify_cron`.

---
*Phase: 29-escalation-to-gm*
*Completed: 2026-08-13*

## Self-Check: PASSED
- FOUND: apps/api/tests/test_prediction_escalations.py
- FOUND: .planning/phases/29-escalation-to-gm/29-03-SUMMARY.md
- FOUND: check_prediction_escalations in apps/api/routers/internal.py
- FOUND: predictions.escalation-check in apps/api/core/scheduler.py
- FOUND: commit 8be3bcad (RED)
- FOUND: commit e9625907 (GREEN)
