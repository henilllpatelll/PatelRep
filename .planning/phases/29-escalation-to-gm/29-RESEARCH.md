# Phase 29: Escalation to GM - Research

**Researched:** 2026-08-13
**Domain:** Backend/schema/cron — persisted escalation-state watermark + time-threshold cron on top of an existing AI prediction/notification system (Python 3.13 / FastAPI / Supabase / APScheduler)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Threshold and tiers**
- Fixed **60-minute** threshold, exactly as AI-12 states. Not configurable per hotel (AI-18 explicitly deferred).
- **Single tier**, not the work-order/task 3-tier (30/90/150 min) ladder — AI-17 explicitly defers multi-tier to v2. `escalation_level` is effectively boolean (0 = not escalated, 1 = GM notified) but modeled as `SMALLINT NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 1)` to mirror migration `041_escalation_level.sql`'s exact style/precedent and leave room for AI-17 later without a breaking schema change.

**Schema (new migration, next free number `096_*.sql`)**
- Add `escalation_level SMALLINT NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 1)` and `high_risk_since TIMESTAMPTZ` to **both** `room_readiness_predictions` and `failure_predictions`.
- `high_risk_since` is the anchor for the 60-minute clock — stamped once when a room/asset newly crosses into HIGH, left untouched on every subsequent HIGH-still-HIGH run, cleared (`NULL`) the instant risk drops below HIGH or the item is actioned.
- **Critical asymmetry to get right (PITFALLS.md #4, ARCHITECTURE.md, SUMMARY.md item 3):** `room_readiness_predictions` is upserted in place (Phase 27's pattern — omit ack columns from the upsert payload while staying HIGH so they're preserved by upsert-merge). `failure_predictions` is **delete-then-insert per cron run** (confirmed in ARCHITECTURE.md) — a naive re-insert with no `high_risk_since` carried forward would reset the escalation clock every 30 minutes and the asset would never escalate. The prediction engine must read the previous row's `high_risk_since`/`escalation_level` before deleting and carry them forward into the new insert when the asset is still HIGH, exactly the same "preserve across the destructive write" concern migration 095 already solved once for `is_acknowledged` on the upsert side — this is the delete/insert-table equivalent of that same problem. Needs its own characterization test pair (still-HIGH → carried forward; drops-below-HIGH → reset to NULL/0), mirroring `test_room_readiness_actions.py`'s existing preserve/reset pair.
- Do **not** reuse `is_acknowledged` as the escalation gate (REQUIREMENTS.md Out-of-Scope table, PITFALLS.md #3) — it is a human-suppression signal with no dedup/tier semantics of its own.

**Cron job (new, separate from detection crons)**
- New coroutine in `apps/api/routers/internal.py`, e.g. `check_prediction_escalations`, guarded by `verify_cron(x_cron_secret)` like every other internal job — same auth pattern as `check_escalations`.
- New endpoint, e.g. `POST /v1/internal/predictions/escalations/check`.
- New `CRON_SCHEDULE` entry in `apps/api/core/scheduler.py` at `*/30 * * * *` (same cadence as `predictions.run`/`escalations.check` — no need to poll faster than the detection cron that produces the underlying data), plus a matching `_job_handlers()` entry. `build_scheduler()` raises `RuntimeError` on any `CRON_SCHEDULE`/handler-map mismatch (`scheduler.py:101`) — both must land in the same commit.
- Job id naming: `predictions.escalation-check` (follows the existing `predictions.run` / `ai.failure-predictions` dotted-namespace convention already in `CLAUDE.md`'s Cron Jobs table).
- **Do not fold into `predictions.run` or `ai.failure-predictions`** — those are detection/regeneration engines with a different lifecycle (ARCHITECTURE.md Anti-Patterns section, REQUIREMENTS.md Out-of-Scope table). This mirrors why `escalations.check` is already split out from work-order/task creation.
- Query shape for both tables: `risk_level = 'HIGH' AND is_acknowledged = FALSE AND escalation_level < 1 AND high_risk_since < now() - interval '60 minutes'`, scoped per-tenant like every other cron (loop hotels, or a single cross-tenant query gated by tenant_id in the notify call — follow whichever pattern `check_escalations` already uses for consistency).
- After notifying, set `escalation_level = 1` in the same write (or immediately after) so the next cron run's `< 1` filter excludes it — this is the sole dedup mechanism (AI-14). No separate "already notified" table.

**Reset triggers (AI-13) — where the reset logic lives**
- Reset (`escalation_level = 0`, `high_risk_since = NULL`) must fire the instant a HIGH prediction is actioned or drops below HIGH, from **every** path that can cause either:
  - **Room-readiness:** `reassign_at_risk_room`, `escalate_at_risk_room` (the existing single-item "notify supervisors again" action — distinct from this phase's new GM auto-escalation), and `acknowledge_at_risk_room` (all in `housekeeping.py`) — reset on any of the three.
  - **Asset-failure:** `acknowledge_failure_prediction` (`assets.py`) resets it. Additionally, **creating a work order from a prediction** (`create_work_order_from_prediction` or equivalent) counts as "actioned" for assets — there is no "reassign" concept for an asset (ARCHITECTURE.md line 39 confirms this), and leaving work-order-creation out would mean an engineer who responds by creating a work order (arguably the single most common real response) still gets escalated to the GM, which is a false alarm and would erode trust exactly the way FEATURES.md's PagerDuty-acknowledge-stops-escalation precedent warns against. Reset on both `acknowledge` and `create-work-order`.
  - **Risk drop below HIGH on either table:** the existing prediction engines (`run_room_predictions`, `run_asset_failure_predictions`/`run_single_asset_prediction`) already clear ack columns when risk drops below HIGH (Phase 27 precedent) — extend that same code path to also clear `escalation_level`/`high_risk_since`.
- **Put the reset inside the single-item action functions, not duplicated into a new layer.** Phase 28's batch endpoints (`batch-reassign`, `batch-acknowledge` for both domains) already call these same single-item coroutines per-row (ARCHITECTURE.md: "Batch actions reuse the exact single-item endpoints per-row") — so placing the reset inside `reassign_at_risk_room`/`acknowledge_at_risk_room`/`escalate_at_risk_room`/`acknowledge_failure_prediction`/create-work-order means Phase 28's already-shipped batch actions correctly reset escalation state too, with zero changes needed to Phase 28's code. Do not add a second reset call site in the batch loop.

**Notification content and target**
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

### Deferred Ideas (OUT OF SCOPE)
- **AI-17 — multi-tier escalation ladder** (mirroring the work-order 30/90/150-minute 3-tier model): explicitly deferred in REQUIREMENTS.md v2 section. Start with this phase's single 60-minute tier; revisit only if a single-notification GM escalation proves insufficient in practice.
- **AI-18 — per-hotel configurable escalation threshold**: explicitly deferred in REQUIREMENTS.md v2 section. Fixed 60 minutes for all tenants until GMs actually ask for configurability.
- **Escalation-state UI surfacing** (e.g. "Escalated to GM 12 min ago" badge on `PredictionPanel.tsx`/`PredictionCard`, or notification-bell click-through to the room/asset via the Phase 26 `?room=`/`?asset=` deep-link convention): mentioned as a possible enhancement in `.planning/research/SUMMARY.md` but not required by any of AI-12/13/14's success criteria. Not built this phase (keeps blast radius to backend/schema/cron, consistent with "Depends on: Nothing... different code paths, no shared schema" from ROADMAP.md). Noted for a future phase if GMs want visible escalation state rather than just the notification.
- **AI-15 / AI-16** (batch create-work-order, floor-scoped select-all quick filter): Phase 28 scope, not this phase — already tracked in REQUIREMENTS.md v2.
</user_constraints>

## Summary

This phase adds exactly one new capability — a persisted "how long has this sat HIGH-risk and un-actioned" clock, plus a single new cron job that fires a one-time GM notification when that clock passes 60 minutes — on top of code that already exists and was re-verified live for this research pass (2026-08-13, after Phase 28 shipped its batch-action endpoints). All prior research (`ARCHITECTURE.md`, `PITFALLS.md`, `FEATURES.md`, `SUMMARY.md`) remains accurate against the current codebase; nothing Phase 28 added conflicts with or duplicates this phase's work. This research pass re-read every file the prior research cited plus the two new Phase 28 batch-endpoint blocks that now sit directly above/below the phase 29 reset call sites, and found one concrete correction the planner needs: **`failure_predictions` has no `risk_level` column** — CONTEXT.md's stated query shape ("risk_level = 'HIGH'... for both tables") is only literally true for `room_readiness_predictions`; the `failure_predictions` equivalent predicate is `risk_score >= 70` (the same threshold `run_asset_failure_predictions` already uses at `failure_predictions.py:459` and `:491` to decide "high_risk"/notify).

The build is four small, additive changes to four existing files plus one new migration — no new router files, no new services/ modules, no new frontend code, no new dependencies:
1. **Migration `096_prediction_escalation_watermark.sql`** (096 confirmed free — `ls supabase/migrations/` tops out at `095_room_readiness_acknowledgement.sql`, verified fresh this session, not from stale docs) — adds `escalation_level SMALLINT NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 1)` and `high_risk_since TIMESTAMPTZ` to both tables, plus partial indexes mirroring `041_escalation_level.sql`'s `idx_work_orders_escalation`.
2. **`apps/api/services/ai/predictions.py`** — stamp `high_risk_since` at the existing HIGH-crossing branch (line 447), extend the existing "clear ack columns when risk drops below HIGH" branch (line 427-432) to also clear the two new columns, and extend the omit-while-HIGH upsert-preserve pattern to the two new columns.
3. **`apps/api/services/ai/failure_predictions.py`** — before the existing delete (line 464), fetch the current unacknowledged row's `escalation_level`/`high_risk_since`; carry forward if still-HIGH-and-not-a-fresh-crossing, reset if newly crossing or now below the 70 threshold; include both columns in the `insert()` payload (line 470).
4. **`apps/api/routers/internal.py`** — new `_notify_role`-based coroutine `check_prediction_escalations`, mirroring `check_escalations`'s query/update/notify shape exactly but single-tier.
5. **`apps/api/core/scheduler.py`** — one `CRON_SCHEDULE` entry + one `_job_handlers()` entry, both required together or `build_scheduler()` raises at boot (`scheduler.py:101`).
6. **Five reset call sites**, one line each: `reassign_at_risk_room`, `escalate_at_risk_room`, `acknowledge_at_risk_room` (`housekeeping.py`), `acknowledge_failure_prediction`, `create_work_order_from_prediction` (`assets.py`). Phase 28's `batch_reassign_rooms`/`batch_acknowledge_rooms`/`batch_acknowledge_failure_predictions` already `await` these five coroutines per-row, so no batch-endpoint changes are needed — confirmed by reading Phase 28's shipped code this session.

**Primary recommendation:** Implement exactly per CONTEXT.md's locked decisions; the one deviation the planner must make from CONTEXT.md's literal phrasing is using `risk_score >= 70` (not `risk_level = 'HIGH'`) as the HIGH-risk predicate for the `failure_predictions` half of the cron query, since that column doesn't exist on that table.

## Standard Stack

No new dependencies. This is a backend/schema/cron phase using only what's already pinned in `apps/api/requirements.txt` (FastAPI, the Supabase Python SDK, APScheduler — already wired in `core/scheduler.py`) and Postgres/Supabase migrations. No frontend package changes (no UI work in scope).

### Core (existing, reused as-is)
| Component | Location | Purpose | Why Standard (for this phase) |
|---|---|---|---|
| `verify_cron` | `apps/api/routers/internal.py:14` | Header-secret auth gate for internal cron endpoints | Every internal cron coroutine uses it; the new endpoint must too |
| `_notify_role` | `apps/api/routers/internal.py:433` | Insert into both `notifications` and `notification_deliveries` per active user of a role in a hotel | The more complete notify pattern already used by `check_escalations`; CONTEXT.md locks this as the notify path |
| `AsyncIOScheduler` / `CronTrigger` (apscheduler) | `apps/api/core/scheduler.py` | In-process cron registration | Already the sole cron mechanism in production (GitHub Actions cron retired) |
| Supabase Python SDK `.upsert(on_conflict=...)` | `predictions.py` | Preserve-omitted-columns-on-conflict semantics | Load-bearing for `room_readiness_predictions`; already characterization-tested (`test_room_readiness_actions.py:42`) |
| `FakeDB` / `FakeQuery` test harness | `apps/api/tests/smoke/fake_supabase.py` | In-memory Supabase mock supporting `eq`/`lt`/`gte`/`in_`/`upsert`/`delete`/`insert`/`update` | Used by every existing prediction/escalation test; `lt` filter (needed for `escalation_level < 1` and `high_risk_since < cutoff`) is already implemented (`fake_supabase.py:104`) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|---|---|---|
| Dedicated `escalation_level`/`high_risk_since` columns | Reusing `is_acknowledged` + `last_calculated_at` | Explicitly rejected — `is_acknowledged` is a human-suppression boolean with no dedup semantics (PITFALLS.md #3), and `last_calculated_at` is rewritten every 30-min cron run regardless of risk level so it can't anchor an elapsed-time clock (ARCHITECTURE.md) |
| New standalone cron job | Folding into `predictions.run`/`ai.failure-predictions` | Explicitly rejected in REQUIREMENTS.md's Out-of-Scope table — conflates detection lifecycle (recomputed every run) with escalation lifecycle (must persist across runs) |
| `_notify_role` (notifications + notification_deliveries) | `notify_supervisors_high_risk` / `notify_engineers_asset_risk_high` (notifications only) | CONTEXT.md explicitly locks `_notify_role` for this one-off; the two older helpers fire once on initial HIGH-crossing detection and have no dedup logic of their own, wrong shape for a cron-gated escalation |

No installation step — nothing to add to `requirements.txt` or `package.json`.

## Architecture Patterns

### Recommended file-level structure (all existing files, no new files except the migration)
```
supabase/migrations/
└── 096_prediction_escalation_watermark.sql   # NEW — escalation_level + high_risk_since on both tables

apps/api/
├── services/ai/
│   ├── predictions.py            # MODIFIED — stamp/preserve/clear high_risk_since + escalation_level
│   └── failure_predictions.py    # MODIFIED — carry-forward across delete-then-insert
├── routers/
│   ├── internal.py               # MODIFIED — new check_prediction_escalations coroutine + POST route
│   ├── housekeeping.py           # MODIFIED — reset in 3 single-item actions (NOT the 2 batch endpoints)
│   └── assets.py                 # MODIFIED — reset in acknowledge + create-work-order (NOT the batch endpoint)
├── core/
│   └── scheduler.py              # MODIFIED — CRON_SCHEDULE + _job_handlers() entries
└── tests/
    ├── test_room_readiness_actions.py         # MODIFIED — extend with preserve/reset pair for new columns
    ├── test_failure_prediction_notifications.py  # MODIFIED — extend with carry-forward pair for new columns
    └── test_internal_escalations.py (or a new test_prediction_escalations.py)  # NEW tests — 3x-consecutive-run dedup test
```

### Pattern 1: Watermark-gated single-tier cron (mirrors `check_escalations`, collapsed to one tier)
**What:** Query rows past a fixed time threshold and below the watermark ceiling; act + bump the watermark in the same pass so the next run's `.lt()` filter excludes them.
**When to use:** Any "notify once, don't repeat" cron in this codebase — this is the house pattern, not phase-specific.
**Example (adapted from the real `check_escalations` tier-3 branch, `internal.py:515-521`):**
```python
# Source: apps/api/routers/internal.py:481-521 (check_escalations, tier 3 branch)
# This is the existing 3-tier pattern's single-tier equivalent for AI-12.

@router.post("/predictions/escalations/check")
async def check_prediction_escalations(x_cron_secret: str = Header(None)):
    """
    Cron: single-tier GM escalation for HIGH-risk predictions left un-actioned
    past 60 minutes. escalation_level watermark prevents duplicate notifications
    across cron runs (mirrors check_escalations' escalation_level pattern,
    collapsed to one tier per AI-17's deferral).
    """
    verify_cron(x_cron_secret)

    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(minutes=60)).isoformat()
    escalated = 0

    # --- Room-readiness ---
    overdue_rooms = supabase.table("room_readiness_predictions")\
        .select("room_id, tenant_id, high_risk_since, rooms(room_number)")\
        .eq("risk_level", "HIGH")\
        .eq("is_acknowledged", False)\
        .lt("escalation_level", 1)\
        .lt("high_risk_since", cutoff)\
        .execute()

    for row in (overdue_rooms.data or []):
        room_id = row["room_id"]
        hotel_id = row["tenant_id"]
        room_number = (row.get("rooms") or {}).get("room_number", "unknown")
        supabase.table("room_readiness_predictions")\
            .update({"escalation_level": 1})\
            .eq("room_id", room_id).eq("tenant_id", hotel_id).execute()
        _notify_role(hotel_id, "gm", "escalation_auto",
                     f"Room {room_number} needs attention",
                     "HIGH-risk room readiness prediction has gone unactioned for over an hour.",
                     {"room_id": room_id})
        escalated += 1

    # --- Asset-failure: risk_score >= 70, NOT risk_level = 'HIGH' (see Pitfall 1 below) ---
    overdue_assets = supabase.table("failure_predictions")\
        .select("id, asset_id, tenant_id, high_risk_since, assets(name)")\
        .gte("risk_score", 70)\
        .eq("is_acknowledged", False)\
        .lt("escalation_level", 1)\
        .lt("high_risk_since", cutoff)\
        .execute()

    for row in (overdue_assets.data or []):
        pred_id = row["id"]
        hotel_id = row["tenant_id"]
        asset_name = (row.get("assets") or {}).get("name", "Asset")
        supabase.table("failure_predictions")\
            .update({"escalation_level": 1})\
            .eq("id", pred_id).eq("tenant_id", hotel_id).execute()
        _notify_role(hotel_id, "gm", "escalation_auto_asset",
                     f"{asset_name} needs attention",
                     "HIGH-risk asset-failure prediction has gone unactioned for over an hour.",
                     {"asset_id": row["asset_id"]})
        escalated += 1

    _record_cron_run("predictions.escalation-check")
    return {"status": "ok", "escalated": escalated}
```

### Pattern 2: Preserve-while-HIGH / reset-below-HIGH on the upsert side (`room_readiness_predictions`)
**What:** Two independent, both-required behaviors on the same upsert payload — omit new columns entirely while still HIGH (upsert-merge preserves them), explicitly null/zero them the instant risk drops below HIGH.
**When to use:** `room_readiness_predictions`, exactly where `is_acknowledged` already gets this treatment.
**Example (current code, `predictions.py:403-441`, showing exactly where to extend):**
```python
# Source: apps/api/services/ai/predictions.py:404-441 (verified current, post-Phase-28)
prev = existing_risk_map.get(room_id, {"risk_level": "LOW", "is_acknowledged": False})
previous_risk = prev["risk_level"]
was_acknowledged = prev["is_acknowledged"]
# NEW: also fetch prev["escalation_level"], prev["high_risk_since"] in the same
# existing_preds_result select() at line ~296 (add "escalation_level, high_risk_since"
# to the .select() column list) so this branch can read them without a second query.

upsert_payload = {
    "room_id": room_id,
    "tenant_id": hotel_id,
    # ... existing fields unchanged ...
    "last_calculated_at": now_utc.isoformat(),
}
if risk_level != "HIGH":
    upsert_payload.update({
        "is_acknowledged": False,
        "acknowledged_at": None,
        "acknowledged_by": None,
        # NEW — same treatment:
        "escalation_level": 0,
        "high_risk_since": None,
    })
elif previous_risk != "HIGH":
    # NEW — fresh HIGH crossing: stamp the anchor timestamp.
    upsert_payload["high_risk_since"] = now_utc.isoformat()
    upsert_payload["escalation_level"] = 0
# else: risk_level == "HIGH" and previous_risk == "HIGH" -> omit both new columns
# entirely from upsert_payload so the on_conflict merge preserves whatever value
# is already there (exact same discipline as the ack columns above).
```

### Pattern 3: Carry-forward across delete-then-insert (`failure_predictions`)
**What:** Because this table is rewritten via delete-then-insert (not upsert), preservation cannot rely on SQL merge semantics — the previous row must be read in application code before the delete and copied into the new insert payload when appropriate.
**When to use:** `failure_predictions` only — the one table in this feature that does not use upsert.
**Example (current code, `failure_predictions.py:462-470`, showing exactly where to extend):**
```python
# Source: apps/api/services/ai/failure_predictions.py:462-470 (verified current)
# previous_score already comes from `assets.failure_risk_score` (line 421), NOT
# from the failure_predictions row being deleted — that cached column has no
# escalation_level/high_risk_since equivalent, so those two values must be read
# from the failure_predictions row itself, one query, before the delete:

prev_pred = supabase.table("failure_predictions")\
    .select("escalation_level, high_risk_since")\
    .eq("tenant_id", hotel_id).eq("asset_id", asset_id).eq("is_acknowledged", False)\
    .maybe_single().execute()
prev_row = prev_pred.data or {}
prev_escalation_level = prev_row.get("escalation_level", 0)
prev_high_risk_since = prev_row.get("high_risk_since")

now_utc = datetime.now(timezone.utc)
if risk_score >= 70 and previous_score >= 70:
    # still HIGH across this re-run -> carry forward unchanged
    prediction["escalation_level"] = prev_escalation_level
    prediction["high_risk_since"] = prev_high_risk_since
elif risk_score >= 70:
    # fresh crossing (previous_score < 70) -> stamp a new anchor
    prediction["escalation_level"] = 0
    prediction["high_risk_since"] = now_utc.isoformat()
else:
    # below HIGH -> reset
    prediction["escalation_level"] = 0
    prediction["high_risk_since"] = None

supabase.table("failure_predictions").delete()\
    .eq("tenant_id", hotel_id).eq("asset_id", asset_id).eq("is_acknowledged", False)\
    .execute()
supabase.table("failure_predictions").insert(prediction).execute()
```
**Note:** the existing delete only removes rows `WHERE is_acknowledged = False` — an acknowledged historical row for the same asset is never deleted, so the `.maybe_single()` read above is scoped identically (`is_acknowledged=False`) and will return `None`/empty when there's no active unacknowledged row yet (first-ever prediction for the asset), which is fine — `prev_row.get(...)` defaults handle that.

### Pattern 4: Reset-on-action inside the single-item action function (not the batch loop)
**What:** Every action that should stop escalation writes `escalation_level = 0, high_risk_since = NULL` as part of its existing update/side-effect, inside the single-item coroutine.
**When to use:** All five reset call sites listed in CONTEXT.md.
**Example — `acknowledge_at_risk_room`, current code plus the one-line addition (`housekeeping.py:1352-1367`):**
```python
# Source: apps/api/routers/housekeeping.py:1362-1366 (verified current)
supabase.table("room_readiness_predictions").update({
    "is_acknowledged": True,
    "acknowledged_at": datetime.now(timezone.utc).isoformat(),
    "acknowledged_by": current_user.user_id,
    "escalation_level": 0,      # NEW
    "high_risk_since": None,    # NEW
}).eq("room_id", room_id).eq("tenant_id", current_user.hotel_id).execute()
```
Because `batch_acknowledge_rooms` (`housekeeping.py:1390-1407`, shipped in Phase 28) already `await`s `acknowledge_at_risk_room(...)` per row and unpacks its `outcome["data"]`, no change to the batch endpoint is needed — confirmed by reading the current file this session. Same reasoning applies to `reassign_at_risk_room`/`escalate_at_risk_room` (reset added to their respective updates) and `acknowledge_failure_prediction`/`create_work_order_from_prediction` in `assets.py` (the latter currently does **not** touch `failure_predictions` at all — it only inserts a `work_orders` row — so this phase adds a *new* one-line `.update({"escalation_level": 0, "high_risk_since": None})` call to `create_work_order_from_prediction`, not an extension of an existing update).

### Anti-Patterns to Avoid
- **Folding the escalation check into `predictions.run`/`ai.failure-predictions`.** Explicitly out of scope per REQUIREMENTS.md's Out-of-Scope table and CONTEXT.md. Conflates a detection lifecycle (recomputed every run) with a persistence lifecycle (must survive unchanged runs).
- **Gating dedup on `is_acknowledged`.** It is a human-suppression signal that a supervisor/engineer sets manually; using it as the escalation dedup gate would either double-fire (if a separate persisted flag isn't checked) or wrongly suppress escalation for a room a supervisor has not yet acknowledged but that should still escalate.
- **Duplicating the reset logic into the batch endpoint loop.** Phase 28's batch endpoints already call the single-item coroutines per-row; adding a second reset call site there would be redundant and risks drifting out of sync with the single-item logic.
- **Using `risk_level = 'HIGH'` against `failure_predictions`.** That column doesn't exist on that table (see Pitfall 1). Use `risk_score >= 70`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| "Notify once, don't repeat across cron runs" dedup | A new notification-log table, a Redis/cache-based idempotency key, or a boolean "already_escalated" flag with no tier headroom | The `escalation_level SMALLINT` watermark pattern already proven in `041_escalation_level.sql` / `check_escalations` | Exact same problem already solved twice in this codebase (WO/task ladder); a new mechanism is pure duplication and a second thing to keep in sync |
| "How long has this been HIGH" elapsed-time clock | Deriving it from `last_calculated_at` (rewritten every 30-min run regardless of risk) or from `created_at`/`generated_at` (also rewritten on `failure_predictions`' delete-then-insert) | A dedicated `high_risk_since` column, stamped only on a genuine HIGH-transition and otherwise carried forward | Both existing timestamp columns are recomputed every cron cycle and cannot anchor a "time since first became HIGH" measurement — this is the exact gap FEATURES.md and ARCHITECTURE.md both flagged |
| Multi-statement atomicity across the notify + watermark-bump pair | A manual retry/rollback wrapper, or restructuring into one giant upsert | Best-effort per-row try/except (mirrors `check_escalations`'s existing per-row loop, which has no explicit try/except either — errors bubble and the cron's outer `_make_job` wrapper in `scheduler.py:88-95` already logs-and-continues at the job level) | The Supabase Python SDK has no multi-statement transaction primitive in this codebase (confirmed: no `BEGIN`/`COMMIT` anywhere in `routers/`); this is a known, accepted limitation already lived with by every other cron job here |

**Key insight:** every piece of infrastructure this phase needs (watermark column pattern, cron scaffolding, notify helper, FakeDB test harness with `.lt()` support) already exists in this exact codebase for the work-order/task ladder. This phase is a narrow, single-tier port of that pattern onto two new tables — there is no genuinely novel engineering problem here, only careful reuse.

## Common Pitfalls

### Pitfall 1: `failure_predictions` has no `risk_level` column — CONTEXT.md's literal query shape is wrong for this table
**What goes wrong:** CONTEXT.md's locked decisions state "Query shape for both tables: `risk_level = 'HIGH' AND is_acknowledged = FALSE AND escalation_level < 1 AND high_risk_since < now() - interval '60 minutes'`". Read directly from `supabase/migrations/008_assets_pm.sql:101-116` (the table's original definition) and confirmed no later migration (`grep -l failure_predictions supabase/migrations/*.sql` → only 008, 015, 016, 037, 038, 095 touch it, none add `risk_level`) — `failure_predictions` has `risk_score INT NOT NULL CHECK (risk_score BETWEEN 0 AND 100)`, not a `risk_level` text column. A literal `.eq("risk_level", "HIGH")` against this table would either error (unknown column) or, depending on the Supabase client's error handling, silently return zero rows — either way the asset-failure half of AI-12 never fires.
**Why it happens:** CONTEXT.md's phrasing describes the shared shape at a conceptual level ("both tables use the same four predicates") without re-verifying the literal column name differs per table — an easy generalization to make since `room_readiness_predictions` really does have `risk_level`.
**How to avoid:** Use `.gte("risk_score", 70)` for the `failure_predictions` half of the query — this is the exact threshold `run_asset_failure_predictions` already uses at `failure_predictions.py:459` (`if risk_score >= 70: high_risk += 1`) and `:491` (`if previous_score < 70 <= risk_score:` — the existing HIGH-crossing notify trigger). Using the same `70` constant keeps "HIGH" consistently defined across detection and escalation for this table.
**Warning signs:** A test or manual run against `failure_predictions` for the escalation cron returns zero rows even with a fixture asset at `risk_score=95`; a Supabase 400/column-not-found error mentioning `risk_level` on a query scoped to `failure_predictions`.

### Pitfall 2: `existing_preds_result` in `run_room_predictions` doesn't currently select `escalation_level`/`high_risk_since` — must extend the `.select()` call, not just the payload logic
**What goes wrong:** `predictions.py:294-298` builds `existing_risk_map` from a `.select("room_id, risk_level, is_acknowledged")` call. If the implementer adds the preserve/reset branching logic (Pattern 2 above) but forgets to add `escalation_level, high_risk_since` to this `.select()` column list, `prev.get("escalation_level")`/`prev.get("high_risk_since")` will always be `None`/missing regardless of the row's actual persisted value, and the "fresh crossing vs. still-HIGH" branch will misclassify every still-HIGH room as a fresh crossing (since the code can only tell fresh-vs-continuing apart via `previous_risk`, which *is* already selected — so this specific pitfall is more subtle: `previous_risk` alone is enough to gate the *timestamp-stamping* logic correctly, but if a later code path also wants to read the *current* `escalation_level` value for any reason, it must come from this same select).
**Why it happens:** Easy to design the branching logic in isolation and only realize the source data isn't in scope when writing the actual diff against `predictions.py:294-298`.
**How to avoid:** When implementing, explicitly update the `.select(...)` string at `predictions.py:296` to include the two new columns if `existing_risk_map` needs to expose them (it does not strictly need to for the stamping logic alone, since `previous_risk != "HIGH"` is sufficient to detect a fresh crossing — but do this anyway for symmetry/future-proofing and because the plan/execute step should verify this explicitly rather than assume).
**Warning signs:** A characterization test setting a room's fixture row with `escalation_level: 1, high_risk_since: "<8am>"` and re-running `run_room_predictions` with the room still HIGH doesn't preserve those values in the upsert result.

### Pitfall 3: The `create_work_order_from_prediction` reset is new logic, not an extension of an existing write — easy to skip entirely
**What goes wrong:** Unlike `acknowledge_failure_prediction` (which already has an `.update(...)` call that just needs two more keys) and the three `housekeeping.py` actions (ditto), `create_work_order_from_prediction` (`assets.py:162-219`, confirmed current) does **not currently touch the `failure_predictions` table at all** — it only reads it (`pred_result` at line 171) and then inserts into `work_orders`. There is no existing `.update()` call to extend; a brand-new `supabase.table("failure_predictions").update({"escalation_level": 0, "high_risk_since": None}).eq("id", prediction_id)...execute()` call must be added. Because this is additive rather than "add two keys to an existing dict", it's easy for an implementer pattern-matching off the other four reset sites (which are all one-line diffs) to miss this one, since it requires noticing the absence of a write rather than editing an existing one.
**Why it happens:** Four of five reset sites are trivial one-line diffs to an existing update payload; this one requires adding a whole new statement, which is a different shape of change and easy to deprioritize or forget when working through the list quickly.
**How to avoid:** Explicitly verify (grep or read) that `create_work_order_from_prediction` gets a genuinely new `.update()` call, not just check that "the file was touched." Write a dedicated test asserting escalation state resets specifically via this path, separate from the acknowledge-path test.
**Warning signs:** A test that creates a work order from an escalated (`escalation_level=1`) prediction and then re-runs the escalation cron finds the asset gets re-escalated (false alarm) because the reset never happened.

### Pitfall 4: Migration deployment gap (recurring project-level risk, not new to this phase)
**What goes wrong:** This project has twice (v1.2, v1.3, per project memory) shipped a merged, code-complete migration that was never applied to production, caught only by manual schema audits — and `CLAUDE.md`'s "Key migrations" reference table is already stale (documents only through migration 041 while 95 files exist). Migration 096's two new columns on two tables are exactly the small, easy-to-miss `ALTER TABLE ... ADD COLUMN` kind of change that has slipped through before.
**Why it happens:** Migrations are applied by a manual/CI process decoupled from the code deploy; nothing blocks a code deploy that references a column from an unapplied migration.
**How to avoid:** Before marking the phase done, query live schema (Supabase MCP `list_tables` or `information_schema.columns`) to confirm `escalation_level`/`high_risk_since` exist on both tables in the target environment — don't infer it from `git log`. Optionally add the new migration to `CLAUDE.md`'s migration table as part of this phase's changes (closing a sliver of existing doc-drift, not required by the roadmap but cheap).
**Warning signs:** The new cron 500s in production only, with a column-not-found error, while local/tests pass.

### Pitfall 5 (inherited, still relevant): Numbering collisions in `supabase/migrations/`
**What goes wrong:** This project's migration directory already has three separate numbering collisions (`020`/`0201`, dual `039` files, and — newly confirmed this session — **three separate `042_*.sql` files**: `042_guest_requests_priority.sql`, `042_lost_found_photos_bucket.sql`, `042_room_assignment_clean_type.sql`) plus at least one silent gap (no `082_*.sql` file exists between `081` and `083`). If any other in-flight work claims `096` concurrently with this phase, the same collision pattern repeats.
**How to avoid:** Re-verify `096` is still free immediately before creating the file at execute time (`ls supabase/migrations/ | grep '^096'`), not just at plan time — this research confirms it's free as of 2026-08-13, but time may pass between research and execution.
**Warning signs:** `ls supabase/migrations/` shows two `096_*.sql` files after a rebase/merge.

## Code Examples

### Migration 096 (new, mirrors `041_escalation_level.sql`'s exact style)
```sql
-- Source: pattern from supabase/migrations/041_escalation_level.sql (verified current)
-- Migration 096: Escalation watermark for HIGH-risk predictions (Phase 29, AI-12/13/14)
-- Single-tier: 0 = not escalated, 1 = GM notified. high_risk_since anchors the
-- 60-minute un-actioned clock (distinct from last_calculated_at/generated_at,
-- which are rewritten every prediction-engine run regardless of risk level).

ALTER TABLE public.room_readiness_predictions
  ADD COLUMN IF NOT EXISTS escalation_level SMALLINT NOT NULL DEFAULT 0
    CHECK (escalation_level BETWEEN 0 AND 1);
ALTER TABLE public.room_readiness_predictions
  ADD COLUMN IF NOT EXISTS high_risk_since TIMESTAMPTZ;

ALTER TABLE public.failure_predictions
  ADD COLUMN IF NOT EXISTS escalation_level SMALLINT NOT NULL DEFAULT 0
    CHECK (escalation_level BETWEEN 0 AND 1);
ALTER TABLE public.failure_predictions
  ADD COLUMN IF NOT EXISTS high_risk_since TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_room_readiness_escalation
  ON public.room_readiness_predictions (tenant_id, escalation_level, high_risk_since)
  WHERE risk_level = 'HIGH' AND is_acknowledged = FALSE;

CREATE INDEX IF NOT EXISTS idx_failure_predictions_escalation
  ON public.failure_predictions (tenant_id, escalation_level, high_risk_since)
  WHERE risk_score >= 70 AND is_acknowledged = FALSE;

COMMENT ON COLUMN public.room_readiness_predictions.escalation_level IS '0=none, 1=GM auto-escalated (Phase 29, AI-12)';
COMMENT ON COLUMN public.room_readiness_predictions.high_risk_since IS 'Timestamp the room first crossed into HIGH risk (unacknowledged); anchors the 60-min GM-escalation clock. NULL when not currently HIGH.';
COMMENT ON COLUMN public.failure_predictions.escalation_level IS '0=none, 1=GM auto-escalated (Phase 29, AI-12)';
COMMENT ON COLUMN public.failure_predictions.high_risk_since IS 'Timestamp the asset first crossed into HIGH risk (risk_score>=70, unacknowledged); anchors the 60-min GM-escalation clock. Carried forward across the delete-then-insert prediction rewrite while still HIGH. NULL when not currently HIGH.';

-- ROLLBACK:
-- DROP INDEX IF EXISTS idx_failure_predictions_escalation;
-- DROP INDEX IF EXISTS idx_room_readiness_escalation;
-- ALTER TABLE public.failure_predictions DROP COLUMN IF EXISTS high_risk_since;
-- ALTER TABLE public.failure_predictions DROP COLUMN IF EXISTS escalation_level;
-- ALTER TABLE public.room_readiness_predictions DROP COLUMN IF EXISTS high_risk_since;
-- ALTER TABLE public.room_readiness_predictions DROP COLUMN IF EXISTS escalation_level;
```

### scheduler.py registration (both edits required in the same commit)
```python
# Source: apps/api/core/scheduler.py:24-43 and :56-78 (verified current)
CRON_SCHEDULE: dict[str, dict] = {
    "predictions.run": {"minute": "*/30"},
    "opera.sync-reservations": {"minute": "*/30"},
    "escalations.check": {"minute": "*/30"},
    "predictions.escalation-check": {"minute": "*/30"},   # NEW
    # ... rest unchanged ...
}

def _job_handlers() -> dict[str, Callable[..., Awaitable]]:
    from routers import internal
    return {
        "predictions.run": internal.run_predictions,
        "escalations.check": internal.check_escalations,
        "predictions.escalation-check": internal.check_prediction_escalations,  # NEW
        # ... rest unchanged ...
    }
```
`build_scheduler()` (`scheduler.py:98-117`) computes `set(CRON_SCHEDULE) ^ set(handlers)` and raises `RuntimeError` if non-empty (`scheduler.py:101-103`) — omitting either half fails the app at boot, not silently at runtime.

### Characterization test pattern to mirror (existing, `test_room_readiness_actions.py:87-138`)
The existing preserve/reset pair for `is_acknowledged` is the exact template for the new columns:
```python
# Source: apps/api/tests/test_room_readiness_actions.py:87-138 (verified current)
def test_run_room_predictions_preserves_ack_while_still_high(monkeypatch): ...  # -> write escalation_level/high_risk_since equivalent
def test_run_room_predictions_clears_ack_when_risk_drops_below_high(monkeypatch): ...  # -> same
```
For `failure_predictions`, mirror `test_failure_prediction_notifications.py`'s FakeDB + `monkeypatch(failure_predictions, "supabase", db)` harness (verified current, `test_failure_prediction_notifications.py:1-38`) with a new pair: "still-HIGH re-run carries `high_risk_since` forward unchanged" and "risk drops below 70 resets both columns to NULL/0". A third test should run `check_prediction_escalations` three times consecutively against an unchanged HIGH-and-unacknowledged-past-60-min fixture and assert exactly one `notifications`/`notification_deliveries` row pair total, mirroring the "3x consecutive cron run" verification PITFALLS.md's Pitfall 3 mapping specifies for the WO/task ladder.

## State of the Art

Not applicable in the traditional "library/framework moved on" sense — this is a same-codebase pattern port, not an external-ecosystem question. The one relevant "state of the art" fact is internal: Phase 28 (shipped between the prior research pass and this one) added the batch endpoints (`batch_reassign_rooms`, `batch_acknowledge_rooms`, `batch_acknowledge_failure_predictions`) that this phase's reset logic must remain compatible with — verified this session that all three batch endpoints call the single-item coroutines per-row with no independent business logic of their own, so placing resets inside the single-item functions (per CONTEXT.md's locked decision) automatically covers the batch paths with zero batch-endpoint changes.

| Old state (prior research, 2026-08-13 AM) | Current state (this research, 2026-08-13 PM) | What Changed | Impact |
|---|---|---|---|
| Batch endpoints did not yet exist (AI-09/10/11 unimplemented) | Batch endpoints shipped in Phase 28: `housekeeping.py:1370-1407`, `assets.py:132-155` | Phase 28 executed between research passes | Confirms (doesn't change) CONTEXT.md's design: reset lives in single-item functions only |
| `096` migration number recommended, not yet verified against live directory in this session | Re-verified: `ls supabase/migrations/` still tops out at `095_room_readiness_acknowledgement.sql`, no `096` exists | Direct fresh check this session | `096` confirmed still free |
| CONTEXT.md's generic "risk_level = 'HIGH' for both tables" query shape | `failure_predictions` has no `risk_level` column, only `risk_score INT`; must use `risk_score >= 70` | Verified against `008_assets_pm.sql` and all 6 migrations that ever touch `failure_predictions` | Planner must deviate from CONTEXT.md's literal wording for the asset-failure query (Pitfall 1) |

**Deprecated/outdated:** Nothing in this domain is deprecated — the entire feature set (escalation ladders, notification helpers, cron scaffolding) is the current, actively-used pattern in this codebase as of the last commit (`a8ed7734`/`063ab82c`, Phase 28 docs).

## Open Questions

Both items SUMMARY.md previously flagged as "needing deeper research during planning" are now resolved by REQUIREMENTS.md and CONTEXT.md — confirmed this session:

1. **Single-tier vs. 3-tier ladder threshold design** (SUMMARY.md: "the escalation threshold/tier design is explicitly flagged as unresolved... single-tier vs. the WO ladder's 3-tier model... is a product/roadmap decision that research could not settle").
   - **Resolved:** REQUIREMENTS.md's AI-17 explicitly defers the multi-tier ladder to v2; AI-12 locks a single fixed 60-minute threshold. CONTEXT.md's Decisions section locks the exact `SMALLINT BETWEEN 0 AND 1` schema shape. No further research needed — this is now a locked decision, not an open question.

2. **Endpoint naming convention (`bulk-` vs. `batch-`)** (SUMMARY.md: "STACK.md's illustrative examples use bulk-reassign/bulk-acknowledge naming while ARCHITECTURE.md's integration design uses batch-reassign/batch-acknowledge... resolve to one convention during phase planning").
   - **Resolved (by Phase 28, not this phase):** Phase 28 shipped with `batch-reassign`/`batch-acknowledge`/`batch-acknowledge` naming (confirmed live in `housekeeping.py`/`assets.py`). Not relevant to Phase 29 directly (this phase adds no new user-facing endpoints, only one internal cron endpoint), but confirms the `batch-` convention won for any future consistency question.

No genuinely open questions remain for this phase — CONTEXT.md's decisions are complete and this research found only one concrete correction (Pitfall 1: `risk_score` not `risk_level` for `failure_predictions`) rather than any unresolved design gap. The only residual judgment calls are the ones CONTEXT.md explicitly delegates to Claude's Discretion (exact notif_type strings, exact copy wording, hotel-loop-vs-cross-tenant-query style, test file naming) — all low-stakes and addressed by "follow `check_escalations`'s existing pattern" (it uses one cross-tenant query with per-row `tenant_id`, not a hotel loop — see `internal.py:501-507`, confirmed no hotel-loop wrapper around the WO/task queries) and "follow `test_room_readiness_actions.py`/`test_failure_prediction_notifications.py`'s existing file-per-domain convention."

## Sources

### Primary (HIGH confidence — all verified by direct file read this session, 2026-08-13)
- `apps/api/routers/internal.py` (full `check_escalations`, `_notify_role`, `_auto_escalate_work_order`, lines 420-662) — cron/notify precedent
- `apps/api/core/scheduler.py` (full file) — `CRON_SCHEDULE`, `_job_handlers()`, `build_scheduler()` fail-fast at line 101
- `apps/api/services/ai/predictions.py` (lines 180-480) — `run_room_predictions`, upsert-preserve pattern, notify-on-crossing branch
- `apps/api/services/ai/failure_predictions.py` (lines 1-60, 312-567) — `notify_engineers_asset_risk_high`, `run_asset_failure_predictions` delete-then-insert (confirmed), `previous_score` sourced from `assets.failure_risk_score` not the prediction row
- `apps/api/routers/housekeeping.py` (lines 1260-1460) — current `reassign_at_risk_room`/`escalate_at_risk_room`/`acknowledge_at_risk_room`/`batch_reassign_rooms`/`batch_acknowledge_rooms` (post-Phase-28), `_ensure_tenant_row`, `_fetch_room_prediction_or_404`
- `apps/api/routers/assets.py` (lines 1-250) — current `acknowledge_failure_prediction`/`batch_acknowledge_failure_predictions`/`create_work_order_from_prediction` (post-Phase-28) — confirmed `create_work_order_from_prediction` does not currently touch `failure_predictions` at all
- `apps/api/models/requests.py:790-796` — `BatchRoomReadinessRequest`, `BatchAcknowledgePredictionsRequest` (Phase 28 shipped, confirmed for context, not modified this phase)
- `supabase/migrations/041_escalation_level.sql` (full file) — exact schema/index/comment pattern to mirror
- `supabase/migrations/095_room_readiness_acknowledgement.sql` (full file) — most recent precedent for the same table, same `COMMENT ON COLUMN` convention
- `supabase/migrations/008_assets_pm.sql:101-120` — `failure_predictions` full column list, confirming no `risk_level` column exists (Pitfall 1)
- `supabase/migrations/013_ai_systems.sql:47-64` — `room_readiness_predictions` full column list
- `supabase/migrations/067_notification_delivery_history.sql` — `notification_deliveries` schema, confirms `_notify_role`'s insert shape is valid
- `ls supabase/migrations/` (fresh command run this session) — confirmed 95 numbered files, highest is `095_*`, `096` free; also newly confirms three separate `042_*.sql` files (not just the previously-documented `020`/`0201` and dual-`039` collisions) and a gap at `082`
- `apps/api/tests/test_room_readiness_actions.py` (full file, lines 1-145) — exact characterization-test template to extend
- `apps/api/tests/test_failure_prediction_notifications.py` (lines 1-90) — exact FakeDB harness pattern for `failure_predictions` tests
- `apps/api/tests/smoke/fake_supabase.py` (lines 1-120) — confirms `.lt()`, `.gte()`, `.in_()`, `.delete()`, `.upsert()` all implemented, sufficient for the new cron's query shape
- `apps/web/components/shared/Header.tsx:31-247` — confirms the notification bell already renders any `notifications` row generically (`n.title`/`n.body`/`n.created_at`), no frontend change needed this phase

### Secondary (inherited from prior research pass, re-confirmed not stale)
- `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md`, `.planning/research/FEATURES.md`, `.planning/research/SUMMARY.md` — all read in full this session; every code-location claim spot-checked against current files and found accurate except the `risk_level`/`failure_predictions` nuance now captured as Pitfall 1 (ARCHITECTURE.md's own phrasing, "risk_level = 'HIGH' AND is_acknowledged = FALSE AND escalation_level < N AND high_risk_since < now - threshold", carries the same generalization CONTEXT.md repeated — traced to the same origin, now corrected here)

### Tertiary (not independently re-verified this session)
- Project memory re: v1.2/v1.3 unapplied-migration incidents — carried forward from prior research as background context for Pitfall 4; not re-verified against a specific commit this session (same caveat prior research already flagged)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, every component read directly from current source
- Architecture: HIGH — every file/line reference in this document was re-read live this session (2026-08-13, post-Phase-28), not carried forward unverified from prior research
- Pitfalls: HIGH — Pitfall 1 (risk_score vs risk_level) is a new, concrete finding verified against all 6 migrations touching `failure_predictions`; Pitfalls 2-5 are grounded in direct reads of the exact functions being modified

**Research date:** 2026-08-13
**Valid until:** Stable — this is an internal, same-repo pattern-port phase with no external dependency drift risk. Re-verify migration number and current line numbers only if significant time passes before execution or if other phases touch the same files (`housekeeping.py`, `assets.py`, `predictions.py`, `failure_predictions.py`, `internal.py`, `scheduler.py`) first.
