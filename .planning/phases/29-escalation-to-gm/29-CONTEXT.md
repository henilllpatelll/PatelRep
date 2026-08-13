# Phase 29: Escalation to GM - Context

**Gathered:** 2026-08-13
**Status:** Ready for planning
**Mode:** Autonomous (user delegated all decisions — "you make all of the decisions, do not come back to me until phase 29 is completed and closed." No interactive discussion was run; decisions below are Claude's, grounded in `.planning/research/{ARCHITECTURE,FEATURES,PITFALLS,SUMMARY}.md` — the Phase 28 research pass already covered both AI-09 (batch, shipped) and AI-10/escalation (this phase) before the roadmap split them — and in `.planning/REQUIREMENTS.md`'s AI-12/13/14 entries and the Out-of-Scope table, which already locked several of the historically-open questions.

<domain>
## Phase Boundary

A HIGH-risk room-readiness or asset-failure prediction that sits un-actioned (not reassigned, escalated, or acknowledged) past a fixed 60-minute threshold automatically and reliably notifies the GM — exactly once per continuous HIGH episode, never silently and never repeatedly. This is a backend/cron/schema phase: detection already exists (Phase 25/27's prediction engines + notify helpers), this phase adds the "un-actioned too long" persistence + notification layer on top, following the existing `escalations.check` (work order/task) ladder precedent almost exactly, but as a single fixed tier, not a 3-tier ladder.

No UI is required by the roadmap's success criteria — GM sees the escalation via the existing notification bell (`Header.tsx`, already renders `title`/`body`/`created_at` for any `notifications` row with zero new frontend code). No new frontend component, no deep-link click-through, no escalation-state badge on `PredictionPanel.tsx`/`PredictionCard` is in scope for this phase.

</domain>

<decisions>
## Implementation Decisions

### Threshold and tiers
- Fixed **60-minute** threshold, exactly as AI-12 states. Not configurable per hotel (AI-18 explicitly deferred).
- **Single tier**, not the work-order/task 3-tier (30/90/150 min) ladder — AI-17 explicitly defers multi-tier to v2. `escalation_level` is effectively boolean (0 = not escalated, 1 = GM notified) but modeled as `SMALLINT NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 1)` to mirror migration `041_escalation_level.sql`'s exact style/precedent and leave room for AI-17 later without a breaking schema change.

### Schema (new migration, next free number `096_*.sql`)
- Add `escalation_level SMALLINT NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 1)` and `high_risk_since TIMESTAMPTZ` to **both** `room_readiness_predictions` and `failure_predictions`.
- `high_risk_since` is the anchor for the 60-minute clock — stamped once when a room/asset newly crosses into HIGH, left untouched on every subsequent HIGH-still-HIGH run, cleared (`NULL`) the instant risk drops below HIGH or the item is actioned.
- **Critical asymmetry to get right (PITFALLS.md #4, ARCHITECTURE.md, SUMMARY.md item 3):** `room_readiness_predictions` is upserted in place (Phase 27's pattern — omit ack columns from the upsert payload while staying HIGH so they're preserved by upsert-merge). `failure_predictions` is **delete-then-insert per cron run** (confirmed in ARCHITECTURE.md) — a naive re-insert with no `high_risk_since` carried forward would reset the escalation clock every 30 minutes and the asset would never escalate. The prediction engine must read the previous row's `high_risk_since`/`escalation_level` before deleting and carry them forward into the new insert when the asset is still HIGH, exactly the same "preserve across the destructive write" concern migration 095 already solved once for `is_acknowledged` on the upsert side — this is the delete/insert-table equivalent of that same problem. Needs its own characterization test pair (still-HIGH → carried forward; drops-below-HIGH → reset to NULL/0), mirroring `test_room_readiness_actions.py`'s existing preserve/reset pair.
- Do **not** reuse `is_acknowledged` as the escalation gate (REQUIREMENTS.md Out-of-Scope table, PITFALLS.md #3) — it is a human-suppression signal with no dedup/tier semantics of its own.

### Cron job (new, separate from detection crons)
- New coroutine in `apps/api/routers/internal.py`, e.g. `check_prediction_escalations`, guarded by `verify_cron(x_cron_secret)` like every other internal job — same auth pattern as `check_escalations`.
- New endpoint, e.g. `POST /v1/internal/predictions/escalations/check`.
- New `CRON_SCHEDULE` entry in `apps/api/core/scheduler.py` at `*/30 * * * *` (same cadence as `predictions.run`/`escalations.check` — no need to poll faster than the detection cron that produces the underlying data), plus a matching `_job_handlers()` entry. `build_scheduler()` raises `RuntimeError` on any `CRON_SCHEDULE`/handler-map mismatch (`scheduler.py:101`) — both must land in the same commit.
- Job id naming: `predictions.escalation-check` (follows the existing `predictions.run` / `ai.failure-predictions` dotted-namespace convention already in `CLAUDE.md`'s Cron Jobs table).
- **Do not fold into `predictions.run` or `ai.failure-predictions`** — those are detection/regeneration engines with a different lifecycle (ARCHITECTURE.md Anti-Patterns section, REQUIREMENTS.md Out-of-Scope table). This mirrors why `escalations.check` is already split out from work-order/task creation.
- Query shape for both tables: `risk_level = 'HIGH' AND is_acknowledged = FALSE AND escalation_level < 1 AND high_risk_since < now() - interval '60 minutes'`, scoped per-tenant like every other cron (loop hotels, or a single cross-tenant query gated by tenant_id in the notify call — follow whichever pattern `check_escalations` already uses for consistency).
- After notifying, set `escalation_level = 1` in the same write (or immediately after) so the next cron run's `< 1` filter excludes it — this is the sole dedup mechanism (AI-14). No separate "already notified" table.

### Reset triggers (AI-13) — where the reset logic lives
- Reset (`escalation_level = 0`, `high_risk_since = NULL`) must fire the instant a HIGH prediction is actioned or drops below HIGH, from **every** path that can cause either:
  - **Room-readiness:** `reassign_at_risk_room`, `escalate_at_risk_room` (the existing single-item "notify supervisors again" action — distinct from this phase's new GM auto-escalation), and `acknowledge_at_risk_room` (all in `housekeeping.py`) — reset on any of the three.
  - **Asset-failure:** `acknowledge_failure_prediction` (`assets.py`) resets it. Additionally, **creating a work order from a prediction** (`create_work_order_from_prediction` or equivalent) counts as "actioned" for assets — there is no "reassign" concept for an asset (ARCHITECTURE.md line 39 confirms this), and leaving work-order-creation out would mean an engineer who responds by creating a work order (arguably the single most common real response) still gets escalated to the GM, which is a false alarm and would erode trust exactly the way FEATURES.md's PagerDuty-acknowledge-stops-escalation precedent warns against. Reset on both `acknowledge` and `create-work-order`.
  - **Risk drop below HIGH on either table:** the existing prediction engines (`run_room_predictions`, `run_asset_failure_predictions`/`run_single_asset_prediction`) already clear ack columns when risk drops below HIGH (Phase 27 precedent) — extend that same code path to also clear `escalation_level`/`high_risk_since`.
- **Put the reset inside the single-item action functions, not duplicated into a new layer.** Phase 28's batch endpoints (`batch-reassign`, `batch-acknowledge` for both domains) already call these same single-item coroutines per-row (ARCHITECTURE.md: "Batch actions reuse the exact single-item endpoints per-row") — so placing the reset inside `reassign_at_risk_room`/`acknowledge_at_risk_room`/`escalate_at_risk_room`/`acknowledge_failure_prediction`/create-work-order means Phase 28's already-shipped batch actions correctly reset escalation state too, with zero changes needed to Phase 28's code. Do not add a second reset call site in the batch loop.

### Notification content and target
- Target: **GM only** (`_notify_role(hotel_id, "gm", ...)`), not chief_engineer, not housekeeping_supervisor/engineer — AI-12 says "notifies the GM" specifically, and this is deliberately a different, narrower audience than the existing `notify_supervisors_high_risk`/`notify_engineers_asset_risk_high` detection-time notifications (those already reach supervisors/engineers; this is the "nobody acted" backstop one level up).
- Use `_notify_role` (`internal.py:433`), the same helper `check_escalations` already uses — inserts into **both** `notifications` and `notification_deliveries` (channel `in_app`, status `delivered`), which is the more complete pattern versus the detection-time helpers that only insert into `notifications`. This is a deliberate one-off, not a refactor of the older helpers.
- `notif_type`: `"escalation_auto"` for room-readiness, distinguish asset if useful (e.g. `"escalation_auto_asset"`) or reuse the same type with `data.domain` — Claude's discretion at plan time, not worth a schema decision now.
- Title/body copy, matching the existing terse, specific style (`f"Auto-escalated: {wo['title']}"` / `"Work order was not resolved and has been automatically escalated."`):
  - Room-readiness: title `f"Room {room_number} needs attention"`, body `"HIGH-risk room readiness prediction has gone unactioned for over an hour."` (exact wording is Claude's discretion at plan/execute time — the point is specific + actionable, not generic).
  - Asset-failure: title `f"{asset_name} needs attention"`, body `"HIGH-risk asset-failure prediction has gone unactioned for over an hour."`.
- `data` payload includes `room_id` (or `asset_id`) for parity with the existing `{"work_order_id": wo_id}` precedent, even though no frontend click-through consumes it yet (see Deferred Ideas) — cheap to add now, expensive to backfill later if a future phase wants deep-linking from the notification bell.

### Claude's Discretion
- Exact `notif_type` string and whether room/asset share one type or two.
- Exact notification copy wording (must remain specific/actionable per the style above, not verbatim-locked).
- Whether the cron loops hotels individually or runs one cross-tenant query — follow whatever `check_escalations` already does for internal consistency.
- Test file naming/organization — follow the project's existing `test_room_readiness_actions.py`/`test_failure_prediction_notifications.py` conventions.

</decisions>

<specifics>
## Specific Ideas

None beyond what's captured above — this phase was fully scoped by the Phase 28 research pass (`.planning/research/`) and `.planning/REQUIREMENTS.md`'s Out-of-Scope table before this session began; there was no additional product vision to extract beyond locking the decisions those documents already surfaced as open.

Migration number to claim: **096** (verify fresh at plan/execute time per this project's own documented numbering-collision history — 095 is the current highest 3-digit file as of this writing; `0201_logbook_expires.sql` remains the known 4-digit outlier, do not follow its pattern).

</specifics>

<deferred>
## Deferred Ideas

- **AI-17 — multi-tier escalation ladder** (mirroring the work-order 30/90/150-minute 3-tier model): explicitly deferred in REQUIREMENTS.md v2 section. Start with this phase's single 60-minute tier; revisit only if a single-notification GM escalation proves insufficient in practice.
- **AI-18 — per-hotel configurable escalation threshold**: explicitly deferred in REQUIREMENTS.md v2 section. Fixed 60 minutes for all tenants until GMs actually ask for configurability.
- **Escalation-state UI surfacing** (e.g. "Escalated to GM 12 min ago" badge on `PredictionPanel.tsx`/`PredictionCard`, or notification-bell click-through to the room/asset via the Phase 26 `?room=`/`?asset=` deep-link convention): mentioned as a possible enhancement in `.planning/research/SUMMARY.md` but not required by any of AI-12/13/14's success criteria. Not built this phase (keeps blast radius to backend/schema/cron, consistent with "Depends on: Nothing... different code paths, no shared schema" from ROADMAP.md). Noted for a future phase if GMs want visible escalation state rather than just the notification.
- **AI-15 / AI-16** (batch create-work-order, floor-scoped select-all quick filter): Phase 28 scope, not this phase — already tracked in REQUIREMENTS.md v2.

</deferred>

---

*Phase: 29-escalation-to-gm*
*Context gathered: 2026-08-13*
