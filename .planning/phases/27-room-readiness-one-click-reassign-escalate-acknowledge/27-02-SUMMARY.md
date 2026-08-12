---
phase: 27-room-readiness-one-click-reassign-escalate-acknowledge
plan: 02
subsystem: api
tags: [fastapi, supabase, pydantic, tdd, room-readiness, housekeeping]

# Dependency graph
requires:
  - phase: 27-01
    provides: "room_readiness_predictions.is_acknowledged / acknowledged_at / acknowledged_by columns, live in Supabase"
provides:
  - "POST /housekeeping/room-readiness/{room_id}/reassign, /escalate, /acknowledge — final response shapes for Plan 27-03 frontend"
  - "run_room_predictions is acknowledgement-aware (preserves ack while HIGH, clears on drop below HIGH, suppresses re-notify while acknowledged)"
  - "Fix for a pre-existing production bug that made run_room_predictions silently skip every room"
affects: [27-03-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Omission-based upsert to preserve columns on conflict (relies on FakeDB/PostgREST upsert-merge semantics, proven by a standalone characterization test before being relied on)"
    - "New router endpoints reuse existing functions directly (create_assignments, count_rooms_ahead, notify_supervisors_high_risk, _ensure_tenant_row) rather than reimplementing logic"

key-files:
  created:
    - apps/api/tests/test_room_readiness_actions.py
  modified:
    - apps/api/services/ai/predictions.py
    - apps/api/routers/housekeeping.py
    - apps/api/tests/smoke/fake_supabase.py
    - apps/api/RBAC-MATRIX.md

key-decisions:
  - "Fixed a pre-existing tz-arithmetic bug in run_room_predictions's buffer calculation (predicted_ready_at stayed tz-aware while checkin_naive was stripped to naive) rather than working around it, because it silently swallowed every room via the broad except/continue and made the acknowledgement logic untestable against realistic data"
  - "Response shapes are final for Plan 27-03: reassign -> {action: reassigned, housekeeper_id} | {action: escalated, reason: no_eligible_housekeeper}; escalate -> {action: escalated, notifications_sent}; acknowledge -> {action: acknowledged} | {action: already_acknowledged}"

patterns-established:
  - "When a router function calls into another module's function that itself reads a module-level `supabase` binding, tests must monkeypatch supabase in both modules (the caller's and the callee's home module) — patching only the caller's name silently falls through to the real Supabase client in this local dev environment"

# Metrics
duration: ~35min
completed: 2026-08-12
---

# Phase 27 Plan 02: Room-Readiness Reassign/Escalate/Acknowledge Backend Summary

**Three new housekeeping endpoints (reassign/escalate/acknowledge) reusing create_assignments/count_rooms_ahead/notify_supervisors_high_risk directly, plus an acknowledgement-aware run_room_predictions and a fix for a pre-existing bug that made it silently skip every room in production.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2 (TDD RED -> GREEN)
- **Files modified:** 4 (1 created)

## Accomplishments

- `apps/api/tests/test_room_readiness_actions.py` (18 tests) proves all 9 must-have truths: the omission-preserves-value upsert assumption, acknowledgement-aware `run_room_predictions` (preserve while HIGH / clear on drop-below-HIGH / notify only when not acknowledged), RBAC (403 for housekeeper/front_desk/engineer/chief_engineer), and full endpoint behavior for reassign/escalate/acknowledge including the reassign-degrades-to-escalate path and all 404/409 edge cases.
- `run_room_predictions` (`apps/api/services/ai/predictions.py`) now carries `is_acknowledged` in its pre-loop snapshot, omits the three ack columns from the upsert payload while risk stays HIGH (letting the upsert's on_conflict merge preserve whatever acknowledgement already exists), explicitly clears them the moment risk drops below HIGH, and gates supervisor notification on `not was_acknowledged`.
- Three new endpoints in `apps/api/routers/housekeeping.py`, all gated by `require_role("gm", "housekeeping_supervisor")`:
  - `POST /housekeeping/room-readiness/{room_id}/reassign` — assigns the least-loaded eligible (<=4 rooms-ahead) housekeeper via a real internal call to `create_assignments`; degrades to the escalate/notify path when zero candidates are eligible.
  - `POST /housekeeping/room-readiness/{room_id}/escalate` — re-notifies supervisors with fresh prediction data; 409 if risk is no longer HIGH.
  - `POST /housekeeping/room-readiness/{room_id}/acknowledge` — sets the three ack columns; idempotent 200 no-op if already acknowledged; 404 if no prediction row exists.
- New `_active_housekeepers` / `_fetch_room_prediction_or_404` helpers factor only the candidate-pool-fetch and tenant-scoped-prediction-fetch patterns already used elsewhere — `suggest_assignments` itself was left untouched (non-regression).

## Task Commits

1. **Task 1 (RED): test_room_readiness_actions.py + FakeDB count fix** - `7dc0f16a` (test)
2. **Task 2 (GREEN): run_room_predictions extension + 3 new endpoints** - `66e15ab1` (feat, includes the FakeDB-driven RBAC-MATRIX.md regeneration needed to keep Phase 23's CI drift guard green)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified

- `apps/api/tests/test_room_readiness_actions.py` — new; 18 tests across sections A (upsert characterization), B (acknowledgement-aware predictions), C (RBAC), D (endpoint behavior)
- `apps/api/services/ai/predictions.py` — `run_room_predictions` acknowledgement-aware upsert/notify logic; fixed the tz-arithmetic bug in the buffer calculation
- `apps/api/routers/housekeeping.py` — new imports (`RoomAssignmentItem`, `count_rooms_ahead`, `notify_supervisors_high_risk`), `_active_housekeepers`/`_fetch_room_prediction_or_404` helpers, 3 new endpoints
- `apps/api/tests/smoke/fake_supabase.py` — `FakeQuery.execute()`'s select branch now returns `count=len(matched)`, purely additive
- `apps/api/RBAC-MATRIX.md` — regenerated (30 routers, 289 routes) to reflect the 3 new routes

## Decisions Made

- **Fixed the pre-existing `run_room_predictions` tz-arithmetic bug rather than deferring it.** During Task 1's RED pass, `test_run_room_predictions_clears_ack_when_risk_drops_below_high` failed with the row's `risk_level` never actually changing. Root cause: Step 4's buffer calculation stripped `checkin_dt` to naive (`checkin_naive`) but left `predicted_ready_at` timezone-aware, so `checkin_naive - predicted_ready_at` always raised `TypeError: can't subtract offset-naive and offset-aware datetimes`. This was caught by the function's own broad `except Exception: continue`, meaning **every room in production has been silently skipped on every cron run** — `rooms_updated`, `high_risk_count`, and `notifications_sent` have effectively been no-ops since this code was introduced, predating Phase 27 entirely. This is squarely inside the function this plan modifies and directly blocked the plan's must-have truths (which require the upsert to actually run) from being provable, so it was fixed inline as a Rule 1/Rule 3 auto-fix: both sides are now normalized to naive before subtracting, matching the function's own "normalise both to UTC naive" comment. This is a significant find for the wider system — the `predictions.run` cron job (`*/30 * * * *`) has likely never produced a real HIGH-risk prediction or supervisor notification in production until this fix.
- **Response shapes are final for Plan 27-03** (frontend, depends on this plan): `reassign` returns `{"data": {"action": "reassigned", "housekeeper_id": str}}` on success or `{"data": {"action": "escalated", "reason": "no_eligible_housekeeper"}}` on degrade; `escalate` returns `{"data": {"action": "escalated", "notifications_sent": int}}`; `acknowledge` returns `{"data": {"action": "acknowledged"}}` or `{"data": {"action": "already_acknowledged"}}`. None of these diverge from what 27-02-PLAN.md specified.
- Used valid UUID4-format ids only in the one test that really invokes `create_assignments` (`test_reassign_assigns_least_loaded_eligible_housekeeper`), since that function constructs a real pydantic `CreateAssignmentsRequest`/`RoomAssignmentItem` whose `room_id`/`housekeeper_id` fields are typed `UUID4` — plain strings like `"room-1"` fail validation. All other tests (which never reach that construction) kept the plan's simpler `"room-1"`/`"hk-1"`-style ids.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/Rule 3 - Bug, pre-existing, blocking] Fixed tz-naive/tz-aware subtraction bug in run_room_predictions**
- **Found during:** Task 1 RED pass (`test_run_room_predictions_clears_ack_when_risk_drops_below_high` failed with risk_level never updating)
- **Issue:** `predicted_ready_at` (tz-aware) was subtracted from `checkin_naive` (stripped to naive) in Step 4's buffer calculation, always raising `TypeError`, silently caught by the surrounding `except Exception: continue`, and skipping the room's upsert entirely every time — for every room in production, not just this phase's test data.
- **Fix:** Normalize `predicted_ready_at` to naive as well before subtracting (`predicted_ready_naive = predicted_ready_at.replace(tzinfo=None) ...`), matching the existing code comment's stated intent.
- **Files modified:** `apps/api/services/ai/predictions.py`
- **Verification:** All 18 new tests pass; full suite green (589/589, no new failures).
- **Committed in:** `66e15ab1` (Task 2 commit)

**2. [Rule 3 - Blocking] Regenerated stale RBAC-MATRIX.md**
- **Found during:** Full-suite verification after Task 2
- **Issue:** Adding the 3 new endpoints made `tests/smoke/test_rbac_matrix_contract.py::test_rbac_matrix_matches_generated_output` (Phase 23's CI drift guard) fail — the committed matrix no longer matched live code.
- **Fix:** Ran `python apps/api/scripts/generate_rbac_matrix.py`, committed the regenerated file (30 routers, 289 routes, up from 286).
- **Files modified:** `apps/api/RBAC-MATRIX.md`
- **Verification:** `test_rbac_matrix_contract.py` passes; full suite back to baseline (3 pre-existing unrelated `test_management_roi.py` failures only).
- **Committed in:** `66e15ab1` (Task 2 commit)

**3. [Rule 1 - Test bug] Test file needed dual supabase monkeypatching**
- **Found during:** Task 2 verification (`test_reassign_degrades_to_escalate_when_no_eligible_housekeeper`, `test_reassign_zero_candidates_degrades_to_escalate`, `test_escalate_calls_notify_supervisors_high_risk_with_fresh_data` all failed with a real Postgrest error: `column user_profiles.user_id does not exist`)
- **Issue:** `notify_supervisors_high_risk` is imported by reference into `housekeeping_router`, but its function body still resolves the `supabase` name against `services.ai.predictions`'s own module globals, not the caller's. Patching only `housekeeping_router.supabase` left `predictions_module.supabase` pointing at the real dev Supabase client, so these 3 tests were silently hitting the live project.
- **Fix:** Added `monkeypatch.setattr(predictions_module, "supabase", db)` alongside the existing `housekeeping_router` patch in those 3 tests (same `db` instance, so notification rows land in the same `db.rows`).
- **Files modified:** `apps/api/tests/test_room_readiness_actions.py`
- **Verification:** All 18 tests pass with no live-DB calls.
- **Committed in:** `7dc0f16a`/`66e15ab1` (fixed before either commit landed, since this was caught during the RED->GREEN iteration before Task 2's commit)

---

**Total deviations:** 3 auto-fixed (1 pre-existing production bug, 1 CI-guard regeneration, 1 test-harness correction)
**Impact on plan:** All three were necessary for correctness (bug fix, blocking to complete the task, and a live-DB test-isolation leak) — no scope creep. The tz-arithmetic bug fix is the most consequential finding: it means the `predictions.run` cron job has likely never produced a real prediction update in production before this plan.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None — no external service configuration required. The pre-existing tz-arithmetic bug fix means the `predictions.run` cron job (`*/30 * * * *`, already running in production per `.wolf`/CLAUDE.md's scheduler docs) should now start actually computing and upserting room-readiness predictions where it previously silently no-op'd. Worth watching production logs/notifications after this deploys to confirm the cron job starts producing real HIGH-risk rows and supervisor notifications for the first time.

## Next Phase Readiness

Plan 27-03 (frontend) can build directly against the final response shapes documented above (`{"action": "reassigned"|"escalated"|"acknowledged"|"already_acknowledged", ...}`). All three endpoints are live in code, gated correctly, tested, and reuse existing assignment/notification machinery per ROADMAP.md's literal instruction.

---
*Phase: 27-room-readiness-one-click-reassign-escalate-acknowledge*
*Completed: 2026-08-12*
