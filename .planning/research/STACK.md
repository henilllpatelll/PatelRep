# Stack Research

**Domain:** Batch actions + un-actioned-prediction GM escalation for AI Copilot room-readiness/asset-risk alerts (v1.7 milestone — AI-09, AI-10)
**Researched:** 2026-08-13
**Confidence:** HIGH

## Headline Finding

**No new libraries, services, or infrastructure are required.** Both AI-09 (batch reassign/acknowledge)
and AI-10 (auto-escalate un-actioned HIGH-risk predictions to GM) are direct extensions of patterns
already implemented and proven in this exact codebase — not analogous patterns from another project,
but the literal code this milestone should copy:

- **AI-09's frontend precedent already exists verbatim:** `apps/web/components/engineering/BulkArchiveModal.tsx`
  implements checkbox multi-select via `useState<Set<string>>`, a "select all" affordance, and a
  `useMutation` that POSTs the collected id array to a bulk endpoint. This is the exact shape needed
  for batch-reassign/batch-acknowledge on `PredictionPanel.tsx`.
- **AI-09's backend precedent already exists verbatim:** `POST /work-orders/bulk-archive` in
  `apps/api/routers/work_orders.py:518` accepts a `BulkArchiveWorkOrdersRequest` (Pydantic list of
  UUIDs, `min_length=1, max_length=200`), loops the ids, and reuses the same row-mutation logic as the
  single-item endpoint. AI-09 should add sibling endpoints in `housekeeping.py` that loop the *existing*
  `reassign_at_risk_room`/`acknowledge_at_risk_room` bodies — no new library needed for batching itself.
- **AI-10's data-model precedent already exists verbatim:** `escalation_level SMALLINT NOT NULL DEFAULT 0
  CHECK (escalation_level BETWEEN 0 AND 3)` on `work_orders`/`tasks` (migration `041_escalation_level.sql`),
  driven by the `escalations.check` cron (`apps/api/routers/internal.py:481`) which walks overdue rows in
  tiers and uses the level column purely as an idempotency watermark. `room_readiness_predictions` and
  `failure_predictions` (the "asset_risks" table referenced in the question — its actual name in this
  codebase is `failure_predictions`, see `supabase/migrations/008_assets_pm.sql:101`) both already have
  `is_acknowledged`/`acknowledged_at`/`acknowledged_by` (migration `095` and `008` respectively) but
  **neither has `escalation_level`** — that's the one net-new schema element this milestone needs, and
  it is a column addition, not a new table.

This is the correct outcome given the project's zero-added-dependency convention (see `ARCHITECTURE.md`
"No ORM" and `A1`/`A2`/`A3` decisions in `CLAUDE.md`) — this milestone is wiring against two idioms
that already ship, not adopting anything new.

## Recommended Approach (no new packages)

### AI-09 — Batch reassign / batch acknowledge

| Layer | Approach | Why (reuse, not new) |
|-------|----------|----------------------|
| Frontend selection state | `useState<Set<string>>` for selected prediction ids, toggled per-row checkbox + a header "select all HIGH" control | Identical to `BulkArchiveModal.tsx:22,80-87`. Zero new state library — Zustand/React Query already own all other state in this app; selection is transient UI state, doesn't belong in a store. |
| Frontend mutation | `@tanstack/react-query` `useMutation` → `housekeepingApi.bulkReassignAtRiskRooms(ids)` / `bulkAcknowledgeAtRiskRooms(ids)`, `onSuccess` calls the existing `onActionComplete` prop to refetch predictions | Matches `archiveSelectedMutation` in `BulkArchiveModal.tsx:50-63` and the existing single-action `runAction()` flow in `PredictionPanel.tsx:91-120`. |
| Confirmation UX | Inline confirm bar (reuse the existing `mode: 'confirm-*'` state machine in `PredictionRow`, generalized to a panel-level "N selected → confirm batch action" bar) rather than a modal | `CLAUDE.md` domain map + existing `PredictionPanel.tsx` explicitly favors inline confirm sub-rows over modals for this panel; `BulkArchiveModal` uses a modal only because *its* host (Archived Work Orders) is a full-page picker, not a fitting precedent for the compact `PredictionPanel`. Do not introduce a modal here — stay consistent with the panel's existing interaction model. |
| Backend endpoints | `POST /housekeeping/room-readiness/bulk-reassign`, `POST /housekeeping/room-readiness/bulk-acknowledge` in `apps/api/routers/housekeeping.py`, each taking a new `BulkRoomReadinessActionRequest(SanitizedBaseModel)` with `room_ids: List[UUID4] = Field(min_length=1, max_length=200)` | Mirrors `BulkArchiveWorkOrdersRequest` in `apps/api/models/requests.py:786-787` exactly (same cap of 200, same `SanitizedBaseModel` base, same `min_length=1`). Gate with `require_role("gm", "housekeeping_supervisor")` — identical to the existing single-room endpoints. |
| Backend loop body | Call the *same* per-room logic the single endpoints already use (`count_rooms_ahead`/eligibility check for reassign; `is_acknowledged` update for acknowledge) inside a loop over `body.room_ids`, aggregate a per-room result list (`reassigned`/`escalated_no_capacity`/`already_acknowledged`) | Matches `_bulk_archive()` in `work_orders.py:550+` — one shared helper looped by two thin endpoints, returning aggregate counts. Do not duplicate business logic between single and batch endpoints; factor the row-level body of `reassign_at_risk_room`/`acknowledge_at_risk_room` into a private helper both the single and bulk routes call. |
| Notifications | Existing `notify_supervisors_high_risk()` (`apps/api/services/ai/predictions.py:197`) already batch-inserts one row per supervisor/GM — call it once per escalated room inside the loop, same as today | No new notification path; the function already does bulk `.insert(notifications)` of a *list* of rows in one call (`predictions.py:260`), so no per-row round-trip cost is introduced. |

### AI-10 — Un-actioned HIGH-risk prediction auto-escalates to GM

| Layer | Approach | Why (reuse, not new) |
|-------|----------|----------------------|
| Schema | New migration `096_prediction_escalation_level.sql` (next sequential number after `095`; do not use `0201`-style — that was a one-off historical collision, not a convention) adding `escalation_level SMALLINT NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 3)` to both `room_readiness_predictions` and `failure_predictions`, plus a partial index scoped to un-acknowledged HIGH-risk rows | Byte-for-byte mirrors migration `041_escalation_level.sql`. Reuses the same 0-3 tier semantics already load-bearing in `escalations.check`, so the mental model (and the eventual cron code) is identical to what's already shipped — no bespoke escalation vocabulary invented for predictions. |
| Cron placement | **Fold into the existing `escalations.check` job** (`*/30 * * * *`, `apps/api/routers/internal.py:481`), not `predictions.run` | `predictions.run` (`apps/api/services/ai/predictions.py`) is a *generation* job — it recomputes predictions from current room/reservation state and is not the natural home for *time-since-HIGH-risk* SLA logic. `escalations.check` already *is* the SLA-ladder job (work orders, tasks, DND welfare) running on the same 30-min cadence needed here (a `time_at_risk > threshold` check only needs ≤30-min granularity, matching every other tier in this job). Extending one cron with two more query blocks (predictions + failure_predictions) is strictly simpler than a second job with its own registration in `scheduler.py:26-67` and its own `X-Cron-Secret`-guarded route. |
| Tier logic | Add two more blocks to `check_escalations()` following the exact `tier1_cut`/`tier2_cut`/`tier3_cut` + `.lt("escalation_level", N)` pattern already used for work orders/tasks (`internal.py:500-589`), keyed off `generated_at`/`created_at` (age since prediction went HIGH) instead of `due_at`, and skipping rows where `is_acknowledged = true` | Reuses `_notify_role()` (`internal.py`, already used 6x in this function) for the GM notification — no new notification helper. Skipping acknowledged rows reuses the exact suppression semantics migration `095`'s comment already documents ("suppressing further auto-notification until risk clears and re-escalates"), so AI-10 composes with AI-05's acknowledge feature instead of fighting it. |
| Auto-action at max tier | At tier 3, do **not** invent new terminal behavior — call the existing `notify_supervisors_high_risk()` (already GM-inclusive, since it queries `role IN ('housekeeping_supervisor','gm')`) or, if a harder guarantee of GM-specifically is wanted, add one more `_notify_role(hotel_id, "gm", ...)` call, exactly as `check_escalations()` already does for work orders (`internal.py:517,530`) | Do not build a new "GM escalation" table or governance/approval object — the ladder's job is *notify*, matching the explicit instruction not to add a new governance table. Room reassignment/acknowledgement remains a human action via the existing single or new batch endpoints; the cron's job stops at notifying. |

## What NOT to Add

| Temptation | Why to avoid it |
|------------|------------------|
| A frontend table/data-grid library (e.g. TanStack Table, AG Grid) for batch selection | `PredictionPanel` is a compact expandable card list, not a data grid — plain `Set<string>` state plus existing `Pill`/`Button` primitives fully covers "select some HIGH-risk rows and act." `BulkArchiveModal.tsx` proves this scales to 100+ rows without a grid library. |
| A job queue / message broker for escalation | The existing in-process APScheduler (`apscheduler==3.11.3`) + direct `notifications` table insert already handles every escalation path in this codebase (work orders, tasks, DND, and now predictions). No throughput or delivery-guarantee gap justifies Celery/RQ/SQS here — this is a per-tenant 30-min sweep over a handful of at-risk rows, not high-volume event processing. |
| A new "escalation" or "governance/approval" table | AI-10 is a watermark column + notify, identical to `041_escalation_level.sql`. A separate table would duplicate what `escalation_level` + `notifications` already express and would be the first departure from the flat-architecture convention (`CLAUDE.md` "Services layer depth (A1)") for no added capability. |
| A second cron job for prediction escalation | `escalations.check` already runs on the exact cadence needed and already owns the tiered-notification idiom; a second `*/30` job would mean two `scheduler.py` registrations, two `X-Cron-Secret` routes, and duplicated tier-cutoff math for no isolation benefit — nothing here is resource-heavy enough to warrant separating it from the existing SLA sweep. |
| A UI confirmation modal for batch actions | `PredictionPanel`'s existing single-action confirm pattern is an inline bar, not a modal (`PredictionRow`'s `mode: 'confirm-*'`). Introducing a modal for the batch case only would be an inconsistent interaction model on the same panel. |
| Optimistic-locking / row-version columns for concurrent batch actions | Not present anywhere else in this codebase (work orders' `_bulk_archive` re-checks `status`/`archived_at` at write time instead); batch-reassign/acknowledge should follow the same re-check-before-write approach already used, not introduce a new concurrency-control primitive. |

## Installation

```bash
# Nothing to install. All required packages (fastapi, apscheduler, supabase,
# pydantic, @tanstack/react-query, react, zod, lucide-react) are already in
# apps/api/requirements.txt and apps/web/package.json at their current pinned
# versions (fastapi==0.141.1, apscheduler==3.11.3, supabase==2.31.0,
# @tanstack/react-query ^5.101.4, react ^18.3.1, zod ^4.4.3, lucide-react ^1.30.0).
```

## Sources

- HIGH confidence — direct code inspection of this repository (all claims verified against current
  file contents on 2026-08-13, not training-data recall):
  - `apps/web/components/engineering/BulkArchiveModal.tsx` — batch-selection UI precedent
  - `apps/api/routers/work_orders.py:518-563` — bulk endpoint + shared-helper backend precedent
  - `apps/api/models/requests.py:786-791` — bulk request Pydantic model precedent
  - `apps/api/routers/internal.py:461-589` — `escalations.check` tiered-ladder cron precedent
  - `supabase/migrations/041_escalation_level.sql` — `escalation_level` schema precedent
  - `supabase/migrations/095_room_readiness_acknowledgement.sql`, `008_assets_pm.sql:101-121` —
    current acknowledge-column state on both target tables (confirms `escalation_level` is the only gap)
  - `apps/api/core/scheduler.py:26-67` — cron registration/cadence confirmation (`predictions.run` and
    `escalations.check` both already `*/30 * * * *`)
  - `apps/web/components/housekeeping/PredictionPanel.tsx` — existing inline-confirm interaction model
  - `apps/api/routers/housekeeping.py:1268-1362` — existing single-room reassign/escalate/acknowledge
    endpoints that batch endpoints must reuse, not duplicate
  - `apps/api/services/ai/predictions.py:197-264` — `notify_supervisors_high_risk()` reused for both milestones
- No Context7/WebSearch queries were needed — this milestone's stack question is fully answered by the
  project's own prior art, and the project's explicit convention (`CLAUDE.md`) is to prefer reuse of
  in-repo patterns over adopting anything new.
