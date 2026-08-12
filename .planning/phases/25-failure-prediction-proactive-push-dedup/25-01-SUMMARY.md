---
phase: 25-failure-prediction-proactive-push-dedup
plan: 01
subsystem: api
tags: [notifications, cron, ai, failure-prediction, dedup]

# Dependency graph
requires: []
provides:
  - "notify_engineers_asset_risk_high() in apps/api/services/ai/failure_predictions.py"
  - "Edge-triggered (previous_score < 70 <= risk_score) HIGH-risk-crossing trigger wired into run_asset_failure_predictions' per-asset loop"
  - "notifications_sent key on run_asset_failure_predictions and run_all_hotels_failure_predictions return dicts"
  - "asset_risk_high notification type, data shape {asset_id, risk_level, risk_score} — deep-linking payload Phase 26 will consume"
affects: [26-deep-linked-alert-surfaces]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Snapshot-before-overwrite dedup: read assets.failure_risk_score from the same select('*') fetch used for analysis, before that row is overwritten later in the same loop iteration — no new table needed"
    - "Direct notifications batch-insert helper, internal try/except returning int count, never raises (mirrors notify_supervisors_high_risk in predictions.py)"

key-files:
  created:
    - apps/api/tests/test_failure_prediction_notifications.py
  modified:
    - apps/api/services/ai/failure_predictions.py

key-decisions:
  - "Recipients resolved from user_roles (tenant_id + role in [engineer, chief_engineer, gm] + is_active=True), never user_profiles — matches ROADMAP.md success criterion 3 exactly"
  - "previous_score = asset.get('failure_risk_score') or 0 treats missing key, None, and 0 uniformly as not-HIGH, since the DB column defaults to 0 (not NULL)"
  - "user_roles recipient_ids deduped via a set before building the notifications list so a dual-role user (e.g. gm + engineer) gets exactly one notification, not one per role row"
  - "notify_engineers_asset_risk_high call wrapped in its own try/except inside the per-asset loop, on top of the function's own internal try/except, so a notification failure never aborts the rest of that hotel's assets or other tenants' runs"

patterns-established:
  - "Asset-domain proactive notifications live in failure_predictions.py itself (not a new file, not predictions.py) — keeps domain logic self-contained per CLAUDE.md's services-layer-depth convention"

# Metrics
duration: 4min
completed: 2026-08-12
---

# Phase 25 Plan 01: Asset Failure-Prediction Proactive Push + Dedup Summary

**Added `notify_engineers_asset_risk_high()` to the nightly asset failure-prediction cron, edge-triggered on `previous_score < 70 <= risk_score` so engineers/chief engineers/GMs are notified exactly once per HIGH-risk crossing, not on every re-run while an asset stays HIGH.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-08-12T10:10:18Z
- **Completed:** 2026-08-12T10:14:13Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2 (1 new test file, 1 modified service file)

## Accomplishments
- `notify_engineers_asset_risk_high()` added to `apps/api/services/ai/failure_predictions.py`, mirroring `notify_supervisors_high_risk`'s shape exactly (direct `notifications` batch-insert, internal try/except, returns int count, never raises)
- Edge-triggered dedup wired into `run_asset_failure_predictions`'s existing per-asset loop, anchored on the `assets.failure_risk_score` column (no new migration, no new table)
- `notifications_sent` propagated through both `run_asset_failure_predictions` and `run_all_hotels_failure_predictions` return dicts
- New test file with 9 tests (plan specified 8 truths; truth 5 was split into two clearer sub-tests per the plan's own stated allowance) covering all 4 ROADMAP.md success criteria plus the 2 CONTEXT.md edge-case guards

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Write failing tests for asset risk-high notifications** - `d625b37c` (test)
2. **Task 2 (GREEN): Implement notify_engineers_asset_risk_high and wire dedup trigger** - `0be5dda5` (feat, includes 2 test-harness bug fixes found during GREEN)

_TDD plan: RED then GREEN — no separate REFACTOR commit needed, code was clean on first pass._

## Files Created/Modified
- `apps/api/tests/test_failure_prediction_notifications.py` - New test file, 9 tests covering new-HIGH-crossing notification, idempotent re-runs, already-HIGH no-renotify, never-analyzed (0/omitted) first-HIGH, user_roles-not-user_profiles recipient resolution (split into 2 sub-cases), dual-role dedup, zero-recipient guard, and per-tenant notification-insert failure isolation
- `apps/api/services/ai/failure_predictions.py` - Added `notify_engineers_asset_risk_high()`; wired `previous_score < 70 <= risk_score` trigger into `run_asset_failure_predictions`'s per-asset loop; added `notifications_sent` to both `run_asset_failure_predictions` and `run_all_hotels_failure_predictions` return dicts

## Decisions Made
- Followed CONTEXT.md/RESEARCH.md's locked decisions exactly: `previous_score = asset.get("failure_risk_score") or 0` (Pitfall 1 guard), `user_roles` dedup by `user_id` set (Pitfall 2 guard), per-call recipient fetch (not per-hotel cached) matching `notify_supervisors_high_risk`'s existing style
- Split plan's truth 5 (`test_recipients_use_user_roles_not_user_profiles`) into two separate test functions (`test_recipients_use_user_roles_not_user_profiles` + `test_recipients_notify_when_user_roles_populated`) rather than combining both assertions in one test body — the plan explicitly allowed this ("split into two tests if cleaner"), and it keeps each test's `db` fixture and assertion focused on one condition

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two direct-call tests were missing `monkeypatch.setattr(failure_predictions, "supabase", db)`**
- **Found during:** Task 2 (GREEN) — running the new test file after implementing `notify_engineers_asset_risk_high`
- **Issue:** `test_dual_role_user_dedup` and `test_zero_recipients_returns_zero` call `notify_engineers_asset_risk_high()` directly (not through `run_asset_failure_predictions`, which was already correctly monkeypatched in other tests). As originally written during Task 1 (RED), these two test functions had no `monkeypatch` fixture parameter at all, so the module-level `supabase` singleton was never swapped for `FakeDB` — the real lazy Supabase proxy was hit instead. `test_zero_recipients_returns_zero` happened to pass anyway (real call raised, caught by the function's own try/except, returned 0 — the same value the seeded-empty-FakeDB case would have produced), but `test_dual_role_user_dedup` failed with a real Postgres UUID-syntax error since `"hotel-1"` isn't a valid UUID.
- **Fix:** Added `monkeypatch` as a parameter to both test functions and `monkeypatch.setattr(failure_predictions, "supabase", db)` before calling the function under test.
- **Files modified:** `apps/api/tests/test_failure_prediction_notifications.py`
- **Verification:** Both tests pass against the seeded `FakeDB` state (not a real DB call) after the fix; full new-file suite green.
- **Committed in:** `0be5dda5` (part of Task 2 GREEN commit)

**2. [Rule 1 - Bug] `test_asset_already_high_does_not_renotify` read `db.rows["notifications"]` before that key existed**
- **Found during:** Task 2 (GREEN) — same test run
- **Issue:** `FakeDB.rows` is a plain dict populated lazily by `setdefault` inside `FakeQuery.execute()` — a table key only appears once a query touches that table. Since this test's scenario (asset already HIGH) correctly produces zero notification inserts, the `"notifications"` key was never created, so `db.rows["notifications"]` raised `KeyError` instead of evaluating the intended "no notifications were inserted" assertion.
- **Fix:** Changed the assertion to `db.rows.get("notifications", []) == []`.
- **Files modified:** `apps/api/tests/test_failure_prediction_notifications.py`
- **Verification:** Test passes and correctly asserts zero-notification behavior.
- **Committed in:** `0be5dda5` (part of Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — test-harness bugs found and fixed during GREEN, not production-code bugs)
**Impact on plan:** Both fixes are test-only corrections needed for the new tests to actually exercise the intended `FakeDB` scenarios rather than accidentally passing/failing for the wrong reason. No scope creep — `failure_predictions.py`'s production code matches the plan exactly with no auto-fixes needed there.

## Issues Encountered
None beyond the two test-harness fixes documented above.

## User Setup Required
None - no external service configuration required. This phase is a pure backend logic change using existing tables (`notifications`, `user_roles`, `assets`) and no new environment variables.

## Next Phase Readiness
- `notifications.data` for `asset_risk_high` rows now carries `{"asset_id": ..., "risk_level": "HIGH", "risk_score": ...}` — the exact deep-linking payload shape Phase 26 (Deep-Linked Alert Surfaces) needs to route `AIRiskAlertsPanel` rows to a real asset detail page.
- Full API suite: 570/570 passing except 3 pre-existing unrelated `test_management_roi.py` failures (documented baseline, unchanged by this plan — confirmed both before and after this plan's changes).
- No blockers for Phase 26 or Phase 27.

---
*Phase: 25-failure-prediction-proactive-push-dedup*
*Completed: 2026-08-12*

## Self-Check: PASSED

- FOUND: apps/api/tests/test_failure_prediction_notifications.py
- FOUND: apps/api/services/ai/failure_predictions.py
- FOUND commit: d625b37c
- FOUND commit: 0be5dda5
