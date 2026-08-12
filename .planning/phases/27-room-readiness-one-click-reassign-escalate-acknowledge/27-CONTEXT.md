# Phase 27: Room-Readiness One-Click Reassign / Escalate / Acknowledge - Context

**Gathered:** 2026-08-12
**Status:** Ready for planning

**Session note:** Continuing the same autonomous session as Phases 25/26 — user instructed Claude to keep going without further check-ins. This context was authored by Claude alone after reading `supabase/migrations/013_ai_systems.sql` (`room_readiness_predictions` schema), `apps/api/services/ai/predictions.py` (`run_room_predictions`, `notify_supervisors_high_risk`, `count_rooms_ahead`), `apps/api/routers/housekeeping.py` (`create_assignments`, `suggest_assignments`, `get_predictions`), `apps/api/models/requests.py` (`CreateAssignmentsRequest`/`RoomAssignmentItem`), `apps/web/components/housekeeping/PredictionPanel.tsx`, `apps/web/lib/api/housekeeping.ts`, and `apps/web/lib/hooks/useRole.ts`. No AskUserQuestion interaction occurred.

<domain>
## Phase Boundary

A housekeeping_supervisor or GM gets three one-tap actions on a HIGH-risk row in the existing `PredictionPanel` (the "panel" ROADMAP.md's phase goal refers to — it already lists exactly the HIGH/MEDIUM-risk rooms this phase acts on, rendered on `SupervisorHousekeepingPage`): **Reassign** (hand the room to the least-loaded eligible housekeeper, executed through the existing `POST /housekeeping/assignments` contract), **Escalate** (manually notify supervisors/GM right now, reusing the existing `notify_supervisors_high_risk` notification shape), and **Acknowledge** (suppress further auto-notifications for this room until its risk genuinely clears and later re-escalates). All three are supervisor/GM-only (403 for housekeepers) and re-validate live state before acting — no action executes against a stale, already-resolved prediction snapshot.

</domain>

<decisions>
## Implementation Decisions

### Schema change (new migration required — this phase is NOT "zero backend/schema" like Phase 25/26's framing)
- `room_readiness_predictions` currently has no acknowledgement column at all (unlike `failure_predictions`, which already has `is_acknowledged`). A new migration adds `is_acknowledged BOOLEAN NOT NULL DEFAULT FALSE`, `acknowledged_at TIMESTAMPTZ`, `acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL` to `room_readiness_predictions`. Follow this repo's existing numbered-migration convention (check the current highest migration number at execution time — CLAUDE.md's gotcha list already documents recent numbering collisions, so verify the next free number carefully rather than assuming).
- Because `GET /housekeeping/predictions` already does `select("*, rooms(...))`, the new columns are automatically returned once added — no query-shape change needed there, only the frontend `RoomPrediction` TS type needs the three new optional fields.

### Three new endpoints, all `require_role("gm", "housekeeping_supervisor")` (matches the existing `POST /housekeeping/assignments` gate exactly — satisfies AI-05/criterion 4's 403-for-housekeeper requirement by construction)
- `POST /housekeeping/room-readiness/{room_id}/reassign`
- `POST /housekeeping/room-readiness/{room_id}/escalate`
- `POST /housekeeping/room-readiness/{room_id}/acknowledge`
- Router placement: `apps/api/routers/housekeeping.py`, near the existing `/predictions` and `/assignments` sections (this file already owns both concepts).

### Reassign (AI-03, AI-04)
- **Live-state guard (criterion 5):** re-read `room_status` for `room_id` at request time. If `status` is no longer in `{"DIRTY", "IN_PROGRESS", "PICKUP"}` (i.e. already cleaned/inspected since the prediction was generated), return `409` — do not silently reassign a resolved room. This is the literal example ROADMAP.md's criterion 5 gives.
- **Least-loaded eligible housekeeper selection:** mirror `count_rooms_ahead` (`services/ai/predictions.py`) and the "overloaded_housekeeper" risk-factor threshold `rooms_ahead > 4` already encoded in `run_room_predictions`. Candidate pool = active housekeepers, sourced exactly like `suggest_assignments`'s existing fallback chain (`shift_assignments` for today; if empty, `user_roles` where `role in ("housekeeper", "housekeeping_supervisor")` and `is_active=True`, cross-tenant-scoped). For each candidate, compute today's DIRTY/IN_PROGRESS room count (excluding this room). "Eligible" = count `<= 4` (matching the existing overload threshold, not a new number). "Least-loaded" = min count among eligible. Do not build a new workload algorithm from scratch — this is a single-room special case of logic that already exists twice in this codebase (`count_rooms_ahead`, `suggest_assignments`'s `assigned_minutes` tracking); reuse the simpler room-count version since a one-room reassignment doesn't need `suggest_assignments`'s full building-affinity/VIP-batching machinery.
- **No eligible housekeeper → degrade, don't force (criterion 2):** if the eligible pool is empty (all candidates over the threshold, or zero active housekeepers), do not assign anyone — instead call the same manual-notify path Escalate uses (see below) so a supervisor is alerted to handle it manually. The endpoint still returns 200 with a response shape indicating "escalated instead of reassigned" (not an error) — this is the documented degrade path, not a failure.
- **Apply the assignment through the existing endpoint, literally:** construct a `CreateAssignmentsRequest(date=today, assignments=[RoomAssignmentItem(room_id=room_id, housekeeper_id=chosen_id)])` and call `create_assignments(...)` (the existing route function, `apps/api/routers/housekeeping.py:786`) directly as an internal function call, passing through the same `current_user`. This satisfies ROADMAP.md's explicit instruction ("the assignment updates immediately via the existing `POST /housekeeping/assignments` endpoint") literally — reuse the function, don't reimplement its `room_assignments` upsert / `room_status` mirroring / push-notification logic.

### Escalate (part of the phase goal's three actions)
- **Live-state guard (criterion 5 — "Reassign/escalate act against freshly re-read live room state"):** re-read `room_readiness_predictions.risk_level` for `room_id` at request time. If it's no longer `'HIGH'`, return `409` (the room has already resolved — escalating a resolved room is noise, not a safety issue, but still guarded per the criterion's literal wording covering both reassign AND escalate).
- **Action:** call `notify_supervisors_high_risk` (`services/ai/predictions.py`) directly with this room's current data — the exact same notification shape the automatic cron-driven edge-trigger already produces. This is a manual trigger of an existing function, not a new notification pathway.

### Acknowledge (AI-05's "suppress further alerts" clause)
- **No live-state guard** — acknowledging a room that has since resolved is harmless (there's nothing to suppress), so this endpoint doesn't 409 on staleness the way reassign/escalate do. Idempotent: acknowledging an already-acknowledged room is a no-op 200, not an error.
- **Action:** set `is_acknowledged = TRUE`, `acknowledged_at = now()`, `acknowledged_by = current_user.user_id` on the `room_readiness_predictions` row for `room_id`.
- **Suppression + re-escalation mechanics, wired into the existing cron (`run_room_predictions` in `services/ai/predictions.py`):**
  - When the cron's per-room upsert computes a NEW `risk_level` that is NOT `'HIGH'` (i.e. risk genuinely cleared, regardless of whether it was previously acknowledged), the upsert payload includes `is_acknowledged: False, acknowledged_at: None, acknowledged_by: None` — clearing the acknowledgement so the *next* HIGH transition is treated as fresh and unacknowledged ("re-escalates" per the criterion's literal wording). When the new `risk_level` IS `'HIGH'`, do not touch these three columns in the upsert payload at all (Supabase's upsert-with-explicit-columns only touches the columns present in the payload dict — omitting them preserves whatever acknowledgement state already exists on that row).
  - The existing edge-trigger notify condition (`if risk_level == "HIGH" and previous_risk != "HIGH":`) gets one more guard: also require `not row_is_currently_acknowledged` (read the pre-upsert row's `is_acknowledged` the same way `previous_risk` is already read from the pre-loop snapshot map — extend that existing map to carry `is_acknowledged` alongside `risk_level`). This is defense-in-depth: the auto-clear-on-non-HIGH behavior above already makes this redundant in the common case (since `previous_risk != 'HIGH'` already implies not-currently-acknowledged-in-a-meaningful-way), but the explicit check protects against a manual acknowledge landing between cron runs while risk stays continuously HIGH in an unexpected order.

### Frontend (all three actions live in `PredictionPanel.tsx` / `PredictionRow`)
- `PredictionPanel.tsx`'s `PredictionRow` gains three action buttons (icon buttons, matching this component's existing minimal row-chrome style — `Pill`/`Mono`/`AILabel` primitives, no new visual language), rendered **only for `risk_level === 'HIGH'` rows** (MEDIUM rows stay read-only, matching the phase's literal "HIGH-risk room-readiness prediction" scope) **and only when the viewer can act** — gate with the existing `useRole()` hook's `canAssignRooms` boolean (`apps/web/lib/hooks/useRole.ts`, already scoped to exactly `['gm', 'housekeeping_supervisor']`, the same role set as the backend's `require_role` gate — frontend hiding is a UX nicety, the backend 403 is the actual enforcement per AI-05/criterion 4).
- One confirming tap per ROADMAP.md's literal wording — a lightweight inline confirm (e.g. a second-tap "confirm?" state on the button, or a small native `window.confirm`-style prompt consistent with how this codebase already handles other one-tap-destructive-ish actions) is Claude's discretion below, not a full modal — keep it lightweight since this panel already lives inside a dense supervisor board.
- `housekeepingApi` (`apps/web/lib/api/housekeeping.ts`) gains three new typed methods (`reassignAtRiskRoom`, `escalateAtRiskRoom`, `acknowledgeAtRiskRoom`), mirroring the existing method style (`apiClient.post(...)`).
- On success, invalidate/refetch the predictions query (`['housekeeping-predictions']` or whatever query key `SupervisorHousekeepingPage` currently uses for `housekeepingApi.getPredictions()` — confirm the exact key at research/plan time) so the row reflects the new state (reassigned room disappears from at-risk list once risk recalculates on next board refresh, or the row shows an "Acknowledged" state immediately via optimistic update).

### Claude's Discretion
- Exact button icons/labels/copy for Reassign/Escalate/Acknowledge.
- Confirm-tap UX mechanics (inline second-tap vs. small popover) — must stay lightweight, not a full-page modal.
- Exact response shape for the reassign-degraded-to-escalate case (e.g. `{"action": "escalated", "reason": "no_eligible_housekeeper"}` vs. `{"action": "reassigned", "housekeeper_id": ...}`) — pick something the frontend can branch on to show the right toast/confirmation copy ("Escalated to supervisors — no housekeeper had capacity" vs. "Reassigned to [name]").
- Whether the acknowledge button, once tapped, immediately hides/dims the row client-side (optimistic) before the next board refetch, vs. waiting for the refetch — optimistic is nicer UX but not required by any success criterion.
- Migration number (verify the actual next free number in `supabase/migrations/` at plan/execute time — do not hardcode a guess into CONTEXT.md given this repo's documented history of migration-numbering collisions).
- Query key name for the predictions fetch used by `SupervisorHousekeepingPage` (confirm exact string at research time rather than guessing).

</decisions>

<specifics>
## Specific Ideas

No specific UI/copy references from the user. Reuse `PredictionPanel.tsx`'s existing dense, minimal row styling rather than introducing new visual chrome — this is an addition to an existing supervisor-facing operational panel, not a new feature surface.

</specifics>

<deferred>
## Deferred Ideas

None beyond what REQUIREMENTS.md's own v2 section already tracks (AI-09 batch-reassign/acknowledge, AI-10 un-actioned-prediction escalation-to-GM) — both explicitly out of scope for this milestone, not something this discussion introduced.

</deferred>

---

*Phase: 27-room-readiness-one-click-reassign-escalate-acknowledge*
*Context gathered: 2026-08-12*
