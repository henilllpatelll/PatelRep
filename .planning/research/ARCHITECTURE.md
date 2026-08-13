# Architecture Research

**Domain:** Integration of batch-action (AI-09) and auto-escalation (AI-10) capabilities into PatelRep's existing AI prediction/alerting system
**Researched:** 2026-08-13
**Confidence:** HIGH — every file/function/table name below was read directly from the current codebase, not inferred from prior phase docs.

## Verified Current State (read from source, not assumed)

### Room-readiness (housekeeping)

| Piece | Real name | Location |
|---|---|---|
| Router | `housekeeping.py` | `apps/api/routers/housekeeping.py` |
| Single-room actions | `reassign_at_risk_room`, `escalate_at_risk_room`, `acknowledge_at_risk_room` | `housekeeping.py:1274-1362`, mounted at `POST /housekeeping/room-readiness/{room_id}/reassign\|escalate\|acknowledge` |
| Role gate | `require_role("gm", "housekeeping_supervisor")` on all three | same file |
| Prediction engine | `run_room_predictions(hotel_id)` | `apps/api/services/ai/predictions.py:271` |
| Cron entry point | `run_all_hotel_predictions()` → called by `routers/internal.py::run_predictions` → cron job id `predictions.run` | `predictions.py:467`, `core/scheduler.py:26` |
| GM/supervisor notify helper | `notify_supervisors_high_risk(hotel_id, room_number, room_id, predicted_ready_at_str)` | `predictions.py:197` — inserts into `notifications` only, **not** `notification_deliveries` |
| Table | `room_readiness_predictions` | columns used: `room_id, tenant_id, housekeeper_id, predicted_ready_at, confidence_score, risk_level, checkin_time, minutes_to_checkin, rooms_remaining_for_hk, avg_speed_rooms_per_hr, risk_factors, last_calculated_at, is_acknowledged, acknowledged_at, acknowledged_by` — ack columns added in migration `095_room_readiness_acknowledgement.sql`. **No `escalation_level` or "first seen HIGH" timestamp column exists today.** |
| Frontend panel | `PredictionPanel.tsx` → `PredictionRow` (per-item, inline confirm) | `apps/web/components/housekeeping/PredictionPanel.tsx` |
| Frontend API client | `housekeepingApi.reassignAtRiskRoom / escalateAtRiskRoom / acknowledgeAtRiskRoom` (all single `roomId` arg) | `apps/web/lib/api/housekeeping.ts:126-141` |

**Important existing precedent for Q1:** `reassign_at_risk_room` does **not** call a shared internal helper — it directly `await`s another route coroutine (`create_assignments`) from within itself (`housekeeping.py:1318`). FastAPI route handlers in this codebase are plain async functions that are already called directly from other route handlers in the same router file. There is no `services/housekeeping_room_readiness.py` extraction layer for this feature.

### Asset failure (engineering)

| Piece | Real name | Location |
|---|---|---|
| Router | `assets.py` | `apps/api/routers/assets.py` |
| Endpoints | `GET /failure-predictions` (active unacked, top 10 by risk), `GET /failure-predictions/history` (all, paginated 50, filterable by `acknowledged`/`risk_min`), `POST /failure-predictions/{prediction_id}/acknowledge`, `POST /failure-predictions/{prediction_id}/create-work-order` | `assets.py:69-160+` |
| Role gate | `require_role("gm", "engineer")` on acknowledge + create-work-order | same file |
| Prediction engine | `run_asset_failure_predictions(hotel_id)` (per-hotel, calls Claude via `_analyze_asset`), `run_single_asset_prediction` (on-demand single-asset) | `apps/api/services/ai/failure_predictions.py:380, 573` |
| Cron entry point | `run_all_hotels_failure_predictions()` → `routers/internal.py::run_failure_predictions` → cron job id `ai.failure-predictions` (nightly, `hour:0`) | `failure_predictions.py:530`, `core/scheduler.py:39` |
| GM/engineer notify helper | `notify_engineers_asset_risk_high(hotel_id, asset_id, asset_name, risk_score, predicted_failure_window, recommendation)` | `failure_predictions.py:312` — notifies `engineer`, `chief_engineer`, `gm` roles, inserts into `notifications` only |
| Table | `failure_predictions` (migration `008_assets_pm.sql:101`) | columns: `id, tenant_id, asset_id, risk_score, predicted_failure_window, failure_indicators, estimated_repair_cost, estimated_replace_cost, recommendation, ai_reasoning, generated_at, is_acknowledged, acknowledged_by, acknowledged_at`. **No `escalation_level` or HIGH-since timestamp.** Row model differs from room-readiness: on every prediction run, the existing unacknowledged row is **deleted and a fresh row inserted** (`failure_predictions.py:464-470`), not upserted-in-place. This matters for AI-10 — a naive "time since row created" check would reset every re-run even if underlying risk is unchanged, unless the delete/insert is made conditional on risk actually changing, or an escalation timestamp is carried forward across the delete/insert. |
| Frontend page | `apps/web/app/(dashboard)/engineering/predictions/page.tsx` → `PredictionCard`, one card per prediction, `useMutation` per action (acknowledge / create-work-order / authorize AI recommendation) | |
| Frontend API client | `engineeringApi.acknowledgeFailurePrediction(predictionId)`, `createWorkOrderFromPrediction(predictionId)`, `getFailurePredictionHistory(params)` | `apps/web/lib/api/engineering.ts:257,304,307` |

**Key difference from room-readiness:** there is no "reassign" concept for an asset — the closest analog action is `create-work-order`. AI-09 batch semantics therefore differ per domain (see below).

### Existing escalation-ladder precedent (closest prior art for AI-10)

`apps/api/routers/internal.py::check_escalations` (`POST /v1/internal/escalations/check`, cron job id `escalations.check`, `*/30 * * * *`):

- Reads `work_orders.escalation_level` and `tasks.escalation_level` (both `INT`, added by migration `041` per project CLAUDE.md gotcha notes — confirmed in use at `internal.py:502-588`).
- 3-tier ladder purely on **time since `due_at`** (30 / 90 / 150 min cutoffs computed fresh every run from `now`), not on a "first crossed HIGH" timestamp — because `due_at` is a fixed target set once at creation, unlike `risk_level`, which is recomputed every 30 min and can flip back down.
- Tier 3 auto-escalates the entity itself (work order → `status="escalated"` via `transition_work_order_with_audit` RPC) and notifies GM.
- Notification helper used here is **`_notify_role(hotel_id, target_role, notif_type, title, body, data)`** (`internal.py:433`) — inserts into **both** `notifications` and `notification_deliveries` (channel `in_app`, status `delivered`). This is a **different, more complete** pattern than `notify_supervisors_high_risk` / `notify_engineers_asset_risk_high`, which only insert into `notifications`.
- Also registered independently in `CRON_SCHEDULE` (`core/scheduler.py:28`) as its own job id, separate from `predictions.run` and `ai.failure-predictions` — escalation-ladder logic is a **separate cron job**, not folded into the detection/prediction jobs.

## Integration Design

### AI-09 — Batch actions

**Endpoint shape:** new routes, following the existing precedent of calling single-item route coroutines directly (no service-layer extraction — this stays single-domain business logic per the project's services-layer convention: *"only extract to services/ when logic is shared across 2+ domains"*):

- `POST /housekeeping/room-readiness/batch-reassign` — body `{"room_ids": [...]}`
- `POST /housekeeping/room-readiness/batch-acknowledge` — body `{"room_ids": [...]}`
- `POST /engineering/failure-predictions/batch-acknowledge` — body `{"prediction_ids": [...]}` (add to `assets.py`, same router that already owns `/failure-predictions/*`)

Each batch handler loops the ids and `await`s the corresponding existing single-item coroutine (`reassign_at_risk_room`, `acknowledge_at_risk_room`, `acknowledge_failure_prediction`) exactly the way `reassign_at_risk_room` already calls `create_assignments` today. Wrap each iteration in `try/except HTTPException` so one room's 404/409 (e.g. room no longer DIRTY, prediction already gone) doesn't abort the rest of the batch — there is no existing batch-endpoint precedent anywhere else in the codebase to follow for partial-failure shape, so return a per-item result list plus aggregate counts, e.g.:

```json
{"data": {"results": [{"room_id": "...", "action": "reassigned", "housekeeper_id": "..."}, {"room_id": "...", "error": "Room is no longer awaiting cleaning"}], "succeeded": 4, "failed": 1}}
```

**Does AI-09 apply to both domains?** Room-readiness has 3 single-item actions (reassign/escalate/acknowledge); asset failure has 2 (acknowledge/create-work-order). Batch **acknowledge** is the one action that is symmetric, low-risk, and clearly valuable in both domains (clearing noisy MEDIUM/LOW-risk backlogs). Batch **reassign** only makes sense for room-readiness (assets have no "reassign"). Batch **create-work-order** for assets is higher-risk (creates N real work orders with parts/cost implications in one click) — recommend scoping AI-09's first phase to `batch-reassign` + `batch-acknowledge` (room-readiness) and `batch-acknowledge` (asset-failure) only; leave batch-create-work-order and batch-escalate out unless the roadmap/requirements phase explicitly calls for them.

**Role gates:** batch endpoints reuse the exact same `require_role(...)` as their single-item counterparts — `("gm", "housekeeping_supervisor")` for room-readiness, `("gm", "engineer")` for asset-failure.

**Frontend:** `PredictionPanel.tsx` and `engineering/predictions/page.tsx` currently render one row/card per item with no selection state or bulk toolbar — this is new UI, not a modification of an existing bulk pattern. Add checkbox selection + a bulk-action bar to both.

### AI-10 — Auto-escalation to GM

**Schema:** add `escalation_level INT NOT NULL DEFAULT 0` to both `room_readiness_predictions` and `failure_predictions`, mirroring `work_orders.escalation_level` / `tasks.escalation_level`. Also add a `high_risk_since TIMESTAMPTZ` (or `risk_score_high_since` for assets) column — **required** because unlike `work_orders.due_at` (a fixed target), `risk_level`/`risk_score` are recomputed every run and the existing upsert (room-readiness) / delete-insert (asset-failure) logic already resets `last_calculated_at` every cycle regardless of whether the room/asset has been HIGH for 5 minutes or 5 hours. Without a dedicated "first seen HIGH and unacknowledged" timestamp, there's no way to measure how long an alert has gone un-actioned.

Both prediction engines already contain the exact code path where this timestamp should be stamped:
- `predictions.py:447` — `if risk_level == "HIGH" and previous_risk != "HIGH" and not was_acknowledged:` (this is where `notify_supervisors_high_risk` currently fires) → also set `high_risk_since = now_utc` here, and add it to `upsert_payload`.
- `failure_predictions.py:491` — `if previous_score < 70 <= risk_score:` (where `notify_engineers_asset_risk_high` currently fires) → same treatment, added to the `prediction` dict before insert. Because this table is delete-then-insert rather than upserted, the new row must carry forward `high_risk_since` from the row being deleted when the asset is *still* HIGH across a re-run (not newly crossing), otherwise every 24h re-run at midnight would reset the clock. Recommend reading the outgoing row's `high_risk_since` before the delete and reusing it unless this is a fresh crossing.

**Cron job:** do **not** fold this into `predictions.run` or `ai.failure-predictions` — those jobs are the *detection* engines (recompute risk from live state) and already correctly clear acknowledgement when risk drops below HIGH. Escalation is a distinct concern with a distinct trigger (elapsed time while un-acknowledged), exactly as `escalations.check` is already split out from work-order/task creation. Add a **new cron job**, following the `escalations.check` pattern exactly:

- New coroutine `check_prediction_escalations` in `routers/internal.py` (guarded by `verify_cron(x_cron_secret)` like every other internal job), reading rows where `risk_level = 'HIGH' AND is_acknowledged = FALSE AND escalation_level < N AND high_risk_since < now - threshold`.
- New job id, e.g. `predictions.escalation-check`, registered in `CRON_SCHEDULE` (`core/scheduler.py:26`) at `*/30` (same cadence as `escalations.check`), and added to the `_job_handlers()` map (`core/scheduler.py:64`). Note `build_scheduler()` raises `RuntimeError` on any mismatch between `CRON_SCHEDULE` keys and handler keys (`scheduler.py:101`) — both must be updated together or the app fails to boot.

**GM notification path:** reuse `internal.py::_notify_role` (the notifications + notification_deliveries pattern), not `notify_supervisors_high_risk` / `notify_engineers_asset_risk_high` — those two already fire once on the *initial* HIGH crossing; escalation needs a **distinct notification type** (e.g. `room_risk_escalated_gm`, `asset_risk_escalated_gm`) so GMs can tell "new alert" apart from "reminder: still un-actioned," and `_notify_role` is the pattern already used for the equivalent WO/task GM-escalation reminders.

## New vs Modified — summary table

| File | New or Modified | What |
|---|---|---|
| `apps/api/routers/housekeeping.py` | Modified | Add `batch-reassign`, `batch-acknowledge` routes |
| `apps/api/routers/assets.py` | Modified | Add `failure-predictions/batch-acknowledge` route |
| `apps/api/services/ai/predictions.py` | Modified | Stamp `high_risk_since` on HIGH crossing in `run_room_predictions` |
| `apps/api/services/ai/failure_predictions.py` | Modified | Stamp/carry-forward `high_risk_since` in `run_asset_failure_predictions` / `run_single_asset_prediction` |
| `apps/api/routers/internal.py` | Modified | New `check_prediction_escalations` coroutine + `POST /internal/predictions/escalations/check` (or similar), using `_notify_role` |
| `apps/api/core/scheduler.py` | Modified | New `CRON_SCHEDULE` entry + `_job_handlers()` entry |
| `supabase/migrations/096_*.sql` (next free number) | New | `escalation_level`, `high_risk_since` on `room_readiness_predictions`; same two columns on `failure_predictions` |
| `apps/web/components/housekeeping/PredictionPanel.tsx` | Modified | Multi-select + bulk action bar |
| `apps/web/app/(dashboard)/engineering/predictions/page.tsx` | Modified | Multi-select + bulk acknowledge bar |
| `apps/web/lib/api/housekeeping.ts` | Modified | Add `batchReassignAtRiskRooms`, `batchAcknowledgeAtRiskRooms` |
| `apps/web/lib/api/engineering.ts` | Modified | Add `batchAcknowledgeFailurePredictions` |

No new router files, no new services/ modules — everything fits inside the existing domain files per the project's flat-architecture convention.

## Build Order

**AI-09 and AI-10 are independent** — same pattern as v1.6's phase structure (25/26/27 ran on largely separate concerns). They touch different code paths:
- AI-09 touches only route handlers + frontend selection UI.
- AI-10 touches the prediction engines (new column stamping), a new cron job, and a new migration.

They can be built as **parallel phases**. The one coordination point: both phases eventually want a migration file — if run in parallel worktrees, assign migration numbers sequentially to avoid the numbering collisions already documented in this project's history (e.g. `020`/`0201`, dual `039` files). Recommend AI-10 claims `096_*` first since its schema change is a hard prerequisite for its own cron logic, while AI-09 needs no migration at all (batch endpoints operate on existing columns only).

## Anti-Patterns To Avoid

### Folding escalation-check into the detection cron
**What people might do:** add the "has this been HIGH too long" check directly inside `run_room_predictions`/`run_asset_failure_predictions`.
**Why it's wrong:** conflates two different lifecycles — risk detection (recomputed fresh every run) and escalation (must persist across runs, survive risk staying flat). The `escalations.check` job is already split out from work-order creation for exactly this reason; follow that precedent.

### Extracting a shared `services/ai/room_actions.py` for batch/single dedup
**What people might do:** refactor `reassign_at_risk_room` etc. into a services-layer helper "to avoid duplication" between single and batch paths.
**Why it's wrong:** contradicts this project's explicit convention (`services/` reserved for logic shared across 2+ *domains*, not for DRYing up single-domain route handlers) and there's no duplication problem to solve — the codebase's own pattern is calling route coroutines directly from other route coroutines within the same file, already proven by `reassign_at_risk_room → create_assignments`.

## Sources

All findings verified by direct file reads on 2026-08-13 (not training-data assumptions):
- `apps/api/routers/housekeeping.py`
- `apps/api/routers/assets.py`
- `apps/api/routers/internal.py`
- `apps/api/services/ai/predictions.py`
- `apps/api/services/ai/failure_predictions.py`
- `apps/api/core/scheduler.py`
- `apps/api/main.py`
- `supabase/migrations/008_assets_pm.sql`
- `supabase/migrations/095_room_readiness_acknowledgement.sql`
- `apps/web/components/housekeeping/PredictionPanel.tsx`
- `apps/web/lib/api/housekeeping.ts`
- `apps/web/app/(dashboard)/engineering/predictions/page.tsx`
- `apps/web/lib/api/engineering.ts`

---
*Architecture research for: PatelRep v1.7 (AI-09 batch actions, AI-10 auto-escalation)*
*Researched: 2026-08-13*
