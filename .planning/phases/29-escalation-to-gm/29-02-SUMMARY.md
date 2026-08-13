---
phase: 29-escalation-to-gm
plan: 02
subsystem: ai-prediction-engines
tags: [escalation, watermark, room-readiness, failure-predictions, tdd]
requires:
  - 29-01 (migration 096: escalation_level/high_risk_since columns)
provides:
  - room_readiness_predictions escalation watermark preserve/reset/stamp
  - failure_predictions escalation watermark carry-forward across delete-then-insert
affects:
  - apps/api/services/ai/predictions.py
  - apps/api/services/ai/failure_predictions.py
tech-stack:
  added: []
  patterns:
    - "upsert-merge column omission (mirrors existing is_acknowledged pattern)"
    - "read-before-delete carry-forward helper for delete-then-insert tables"
key-files:
  created: []
  modified:
    - apps/api/services/ai/predictions.py
    - apps/api/services/ai/failure_predictions.py
    - apps/api/tests/test_room_readiness_actions.py
    - apps/api/tests/test_failure_prediction_notifications.py
decisions:
  - "failure_predictions watermark continuity is derived from previous_score (asset.failure_risk_score before this run's recompute), not from the previous failure_predictions row's own high_risk_since — Plan 04's create_work_order_from_prediction can reset that row's watermark to 0/NULL without the asset's actual risk ever dropping, which would otherwise misread as a fresh HIGH crossing"
metrics:
  duration: "~35 min"
  completed: "2026-08-13"
---

# Phase 29 Plan 02: Prediction-Engine Escalation-Watermark Carry-Forward Summary

One-liner: Extended `predictions.py`'s existing ack-column upsert-merge-omission branch to also carry `escalation_level`/`high_risk_since`, and added a `failure_predictions.py` read-before-delete helper so both prediction engines survive their own regeneration cycles without resetting AI-13's escalation clock.

## What was built

**Sub-feature A — `room_readiness_predictions` (`apps/api/services/ai/predictions.py`):**

Extended the existing `risk_level` vs `previous_risk` branch (the same one that already preserves/resets `is_acknowledged`/`acknowledged_at`/`acknowledged_by`) with two new cases:
- `risk_level != "HIGH"` → payload now also includes `escalation_level: 0, high_risk_since: None` (reset alongside the ack columns).
- `risk_level == "HIGH" and previous_risk != "HIGH"` (fresh crossing, new `elif` branch) → payload includes `high_risk_since: now_utc.isoformat(), escalation_level: 0`.
- `risk_level == "HIGH" and previous_risk == "HIGH"` (continuing HIGH) → both keys omitted entirely from `upsert_payload`, so the `on_conflict="room_id"` upsert-merge preserves whatever value is already in the row, including any `escalation_level` Plan 03's cron may have already set.

The `existing_preds_result` select (`"room_id, risk_level, is_acknowledged"`) was left unchanged — the branching only needs `previous_risk`, never the watermark columns' own current values, by design of the omit-and-merge technique.

**Sub-feature B — `failure_predictions` (`apps/api/services/ai/failure_predictions.py`):**

New private helper `_carry_forward_escalation_watermark(hotel_id, asset_id, risk_score, previous_score)`:
- Reads the previous unacknowledged `failure_predictions` row's `escalation_level`/`high_risk_since` via `.maybe_single()` **before** the delete.
- Branches on `risk_score`/`previous_score` (not on the watermark values themselves): still-HIGH → carry forward unchanged; fresh crossing → stamp `now_utc`/`escalation_level=0`; below 70 → reset to `0`/`None`.
- Returns a 2-key dict merged into the insert payload before delete+insert.

Wired identically into both call sites:
- `run_asset_failure_predictions`: `previous_score` already existed at that call site (`asset.get("failure_risk_score") or 0`, read before this run's own update) for the notification-trigger logic — reused directly, no new fetch.
- `run_single_asset_prediction`: had no `previous_score` concept before this plan — added one line reading it from the already-fetched `asset` dict (`select("*, ...")` already includes `failure_risk_score`). This closes a real bug: the on-demand recompute endpoint previously always took the "fresh crossing" branch, silently restarting an in-progress 60-minute escalation clock every time a user manually recomputed an asset's prediction.

## TDD cycle

RED: Added 3 new tests to `test_room_readiness_actions.py` (preserve-while-HIGH, reset-below-HIGH, fresh-stamp-on-new-crossing) and 5 new tests to `test_failure_prediction_notifications.py` (batch carry-forward, batch reset, single-asset carry-forward, and a regression test pair — one per call site — proving `previous_score` and not the watermark itself drives the branch). Ran against pre-GREEN code: 7 of 8 failed with `KeyError: 'escalation_level'` (the room-readiness "preserve" test happened to pass pre-GREEN too, since the columns were already unconditionally omitted from every payload — a legitimate assertion for both states). Committed as `5035eccd`.

GREEN: Implemented both sub-features exactly as specified. Re-ran both test files: 35/35 passed, including every pre-existing test (no regression to the ack-column preserve/reset behavior). Committed as `37fe8ef9`.

REFACTOR: Not needed — helper signature and both call sites read cleanly as specified in the plan; no changes made.

## Verification

- `pytest apps/api/tests/test_room_readiness_actions.py apps/api/tests/test_failure_prediction_notifications.py -v` — 35/35 passed.
- Full API suite (`pytest tests/ -q`): 632 passed, 3 failed — the 3 failures are `test_management_roi.py`'s pre-existing, unrelated failures documented across multiple prior phase summaries (STATE.md), unchanged by this plan.
- Manual read-through confirmed: `existing_preds_result`'s select string is byte-identical to before (`"room_id, risk_level, is_acknowledged"`) — no unjustified scope creep.
- Manual read-through confirmed: both `run_asset_failure_predictions` and `run_single_asset_prediction` call the same `_carry_forward_escalation_watermark` helper (grepped both call sites, no divergent inline implementation).

## Deviations from Plan

None — plan executed exactly as written. Both sub-features, the helper signature, and all specified test cases match the plan's `<implementation>` section as-is.

## Self-Check

- `apps/api/services/ai/predictions.py` — FOUND (modified)
- `apps/api/services/ai/failure_predictions.py` — FOUND (modified)
- `apps/api/tests/test_room_readiness_actions.py` — FOUND (modified)
- `apps/api/tests/test_failure_prediction_notifications.py` — FOUND (modified)
- Commit `5035eccd` — FOUND
- Commit `37fe8ef9` — FOUND

## Self-Check: PASSED
