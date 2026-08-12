# Phase 25: Failure-Prediction Proactive Push + Dedup - Context

**Gathered:** 2026-08-12
**Status:** Ready for planning

**Session note:** User instructed Claude to run discuss-phase and plan-phase autonomously, making all implementation decisions without further check-ins ("do not come back to me until the phase is completed and closed"). This context was authored by Claude alone, grounded in the ROADMAP.md success criteria (already locked) and the existing `run_room_predictions` / `notify_supervisors_high_risk` pattern in `apps/api/services/ai/predictions.py`, which the phase goal explicitly says to mirror. No AskUserQuestion interaction occurred for this phase.

<domain>
## Phase Boundary

Add proactive in-app notifications to the existing nightly asset failure-prediction cron (`services/ai/failure_predictions.py` → `run_asset_failure_predictions`, invoked from `POST /v1/internal/ai/failure-predictions`). When an asset's computed `risk_score` newly crosses from below-70 to >=70 ("HIGH"), notify engineer/chief_engineer/gm users at that hotel once — not on every subsequent nightly run while risk stays HIGH. This is a backend-only, single-file, single-existing-table change (`notifications` table; `assets.failure_risk_score` column as the dedup anchor). No new migration, no frontend change, no new capability beyond notification parity with room-readiness predictions.

</domain>

<decisions>
## Implementation Decisions

### HIGH threshold and dedup anchor
- Reuse the risk threshold already coded in `run_asset_failure_predictions` (`risk_score >= 70` is how `high_risk` is currently counted) — do not invent a new threshold or a config value.
- Dedup is edge-triggered by comparing against the asset's **existing** `failure_risk_score` column value, read from the initial `assets` fetch at the top of `run_asset_failure_predictions` (`select("*")` already includes it) — i.e. the value written by the *previous* run, captured before this run's delete-then-insert/update overwrites it for that asset. This mirrors `run_room_predictions`' `existing_risk_map` snapshot-before-loop technique, just sourced from the assets table's own column instead of a separate lookup table (there's no separate "previous state" table for assets the way there's a `room_readiness_predictions` table with per-room history — the column itself is the prior value until overwritten).
- A `None`/never-analyzed prior score counts as "not HIGH", so an asset's first-ever HIGH prediction correctly fires a notification.
- Trigger condition: `previous_score < 70 and new_score >= 70`. A HIGH asset that stays HIGH run after run (`previous_score >= 70 and new_score >= 70`) must NOT re-notify. An asset that drops out of HIGH and later re-enters HIGH must notify again (matches room-readiness parity and the roadmap's "not spammed every nightly re-run" framing, not a permanent one-shot).

### Recipients
- Query `user_roles` (not `user_profiles` — explicitly called out in ROADMAP.md success criterion 3), filtered `tenant_id = hotel_id`, `role in ("engineer", "chief_engineer", "gm")`, `is_active = True`. Follows the exact query shape already used elsewhere in the codebase (`internal.py::_notify_role`, `services/programs/execution.py`) — `.eq("tenant_id", ...).in_("role", [...]).eq("is_active", True)`.
- No `housekeeping_supervisor` in the recipient set — this is a maintenance/engineering-domain alert, matching the room-readiness precedent of only reaching people who can act on it.

### Notification content and shape
- Mirror `notify_supervisors_high_risk`'s insert exactly: batch-insert directly into `notifications` (type/title/body/data/is_read/push_sent), no `notification_deliveries` row. (The alternative pattern in `internal.py::_notify_role` also writes a `notification_deliveries` row — not used here, because the phase goal explicitly says "mirroring the notification parity room-readiness predictions already have," and that's the `predictions.py` function, not the `internal.py` helper.)
- `type`: `"asset_risk_high"` (parallel to room-readiness's `"room_risk_high"`).
- `title`: references the specific asset by name, e.g. `f"{asset_name} at high failure risk"`.
- `body`: includes the predicted failure window and/or one-line recommendation from the prediction payload already computed that run (`predicted_failure_window`, `recommendation`) — no extra AI/DB call needed, the data is already in hand from `_analyze_asset`'s return value.
- `data`: `{"asset_id": asset_id, "risk_level": "HIGH", "risk_score": risk_score}` — deep-linking payload shape matches room-readiness's `{"room_id": ..., "risk_level": "HIGH"}`, `asset_id` is what Phase 26 (deep-linked alert surfaces) will need.

### Placement and failure isolation
- New function lives in `services/ai/failure_predictions.py` (not a new file, not `predictions.py`) — keeps the "one file + one existing table" self-containment the roadmap calls out, and keeps asset-domain logic out of the room-domain module.
- Call it from inside the per-asset loop in `run_asset_failure_predictions`, after the existing `failure_predictions` upsert and `assets.failure_risk_score` update steps, using the risk_score captured from the asset row at the top of the loop as "previous."
- The notify call is wrapped in its own try/except (mirrors `notify_supervisors_high_risk`'s internal try/except around the recipients fetch and the insert) so a malformed-data or transient-DB failure on the notification step logs and continues to the next asset — does not abort the rest of that hotel's assets, and (via the existing outer per-hotel try/except in `run_all_hotels_failure_predictions`) does not abort other tenants' runs either. This directly satisfies ROADMAP.md success criterion 4.
- `run_asset_failure_predictions`'s return dict gains a `notifications_sent` key (parallels `run_room_predictions`' return shape) so the cron endpoint's response and any test assertions can verify counts without querying the DB directly.

### Claude's Discretion
- Exact wording of title/body copy beyond the structure above.
- Whether to fetch recipients once per hotel (cached across the asset loop) vs. per newly-HIGH asset — prefer per-hotel caching only if it doesn't complicate the per-tenant-isolation try/except boundary; a straightforward per-notify-call fetch (matching `notify_supervisors_high_risk`'s existing per-call fetch style) is acceptable and simpler to reason about for isolation.
- Test file organization (new test file vs. extending an existing `test_failure_prediction*.py` file) — follow whatever pattern already exists for this module's tests.

</decisions>

<specifics>
## Specific Ideas

No specific UI/copy references from the user — this phase has no frontend surface. The implementation should read as a natural extension of the existing `notify_supervisors_high_risk` pattern, reusing its conventions (batch insert shape, silent-fail-and-continue on recipient/insert errors) rather than introducing a new notification idiom.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Phase 26 already covers deep-linking the resulting alert into a real asset detail page; Phase 27 already covers reassign/escalate/acknowledge actions for room-readiness, not asset failure predictions — out of scope here by roadmap design.)

</deferred>

---

*Phase: 25-failure-prediction-proactive-push-dedup*
*Context gathered: 2026-08-12*
