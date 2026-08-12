# Phase 27: Room-Readiness One-Click Reassign / Escalate / Acknowledge - Research

**Researched:** 2026-08-12
**Domain:** FastAPI/Supabase backend endpoints + Next.js/React Query frontend actions, reusing existing housekeeping assignment/notification code
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Schema change (new migration required):**
- `room_readiness_predictions` currently has no acknowledgement column. A new migration adds `is_acknowledged BOOLEAN NOT NULL DEFAULT FALSE`, `acknowledged_at TIMESTAMPTZ`, `acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL`. Follow this repo's numbered-migration convention (verify next free number).
- Because `GET /housekeeping/predictions` already does `select("*, rooms(...))`, new columns are auto-returned — only the frontend `RoomPrediction` TS type needs the three new optional fields.

**Three new endpoints, all `require_role("gm", "housekeeping_supervisor")`:**
- `POST /housekeeping/room-readiness/{room_id}/reassign`
- `POST /housekeeping/room-readiness/{room_id}/escalate`
- `POST /housekeeping/room-readiness/{room_id}/acknowledge`
- Router placement: `apps/api/routers/housekeeping.py`, near existing `/predictions` and `/assignments` sections.

**Reassign (AI-03, AI-04):**
- Live-state guard: re-read `room_status` for `room_id`. If `status` not in `{"DIRTY", "IN_PROGRESS", "PICKUP"}`, return 409.
- Least-loaded eligible housekeeper: mirror `count_rooms_ahead` + the `rooms_ahead > 4` overload threshold from `run_room_predictions`. Candidate pool = same fallback chain as `suggest_assignments` (`shift_assignments` for today; else `user_roles` where role in `("housekeeper","housekeeping_supervisor")` and `is_active=True`, tenant-scoped). Eligible = count `<= 4`. Least-loaded = min count among eligible. Reuse `count_rooms_ahead`, do not build a new workload algorithm.
- No eligible housekeeper → degrade to the same manual-notify path Escalate uses; endpoint still returns 200 with a response indicating "escalated instead of reassigned" (not an error).
- Apply assignment through the existing endpoint literally: construct `CreateAssignmentsRequest(date=today, assignments=[RoomAssignmentItem(room_id=room_id, housekeeper_id=chosen_id)])` and call `create_assignments(...)` (`apps/api/routers/housekeeping.py:786`) directly as an internal function call with the same `current_user`.

**Escalate:**
- Live-state guard: re-read `room_readiness_predictions.risk_level` for `room_id`. If no longer `'HIGH'`, return 409.
- Action: call `notify_supervisors_high_risk` (`services/ai/predictions.py`) directly with this room's current data — same shape as the automatic cron-driven trigger.

**Acknowledge (AI-05):**
- No live-state guard — idempotent no-op 200 if already acknowledged.
- Action: set `is_acknowledged = TRUE`, `acknowledged_at = now()`, `acknowledged_by = current_user.user_id` on the `room_readiness_predictions` row.
- Suppression + re-escalation wired into `run_room_predictions` (`services/ai/predictions.py`):
  - When new `risk_level != 'HIGH'`, upsert payload includes `is_acknowledged: False, acknowledged_at: None, acknowledged_by: None` (clears ack so next HIGH transition is fresh).
  - When new `risk_level == 'HIGH'`, do NOT include those three columns in the upsert payload at all (Supabase upsert-with-explicit-columns only touches present columns).
  - The existing edge-trigger notify condition (`if risk_level == "HIGH" and previous_risk != "HIGH":`) gets an added guard: also require `not row_is_currently_acknowledged` (read pre-upsert row's `is_acknowledged` the same way `previous_risk` is read from the pre-loop snapshot map — extend that map to carry `is_acknowledged` too).

**Frontend (`PredictionPanel.tsx` / `PredictionRow`):**
- Three action buttons rendered only for `risk_level === 'HIGH'` rows AND only when `useRole().canAssignRooms` is true.
- One confirming tap — lightweight inline confirm (Claude's discretion on exact mechanic), not a full modal.
- `housekeepingApi` gains three new typed methods (`reassignAtRiskRoom`, `escalateAtRiskRoom`, `acknowledgeAtRiskRoom`), mirroring existing `apiClient.post(...)` style.
- On success, invalidate/refetch predictions (confirm exact fetch mechanism at research/plan time).

### Claude's Discretion
- Exact button icons/labels/copy for Reassign/Escalate/Acknowledge.
- Confirm-tap UX mechanics (inline second-tap vs. small popover) — must stay lightweight.
- Exact response shape for the reassign-degraded-to-escalate case — pick something the frontend can branch on.
- Whether acknowledge immediately hides/dims the row client-side (optimistic) vs. waiting for refetch.
- Migration number (verify at plan/execute time).
- Query key / refresh mechanism for the predictions fetch (confirm exact mechanism at research time).

### Deferred Ideas (OUT OF SCOPE)
AI-09 (batch-reassign/acknowledge) and AI-10 (un-actioned-prediction escalation-to-GM) — both explicitly v2/out of scope for this milestone.
</user_constraints>

## Summary

All eight of CONTEXT.md's flagged unknowns were resolved against live code. The two most consequential corrections to CONTEXT.md's assumptions: (1) the next free migration number is **095**, not a guess near the documented collision zone — the highest existing migration is `094_tenant_is_test_flag.sql`, and a new gap was found (081→083, no 082) in addition to the already-documented 020/0201 and dual-039/dual-042 collisions, all of which are irrelevant to picking 095 since it's simply `max + 1`; and (2) **no test file exists for `apps/api/routers/housekeeping.py` or `apps/api/services/ai/predictions.py` at all** — CONTEXT.md's guessed filename `test_housekeeping_assignments.py` does not exist in `apps/api/tests/`, so the planner must create new test file(s) from scratch, not extend an existing one.

Every other locked decision checks out as directly implementable: `create_assignments` is a plain async function with no FastAPI-request-object or BackgroundTasks dependency, safely callable directly with a constructed `CreateAssignmentsRequest` and the same `CurrentUser`; `count_rooms_ahead` and `notify_supervisors_high_risk` are pure functions in `services/ai/predictions.py` that only touch `core.database.supabase`, importable into `housekeeping.py` with zero import-cycle risk (that module currently imports nothing from `services.ai`, and `predictions.py` imports nothing from `routers.housekeeping`); `_ensure_tenant_row` is a generic `(table, row_id, hotel_id, label)` 404-guard directly reusable for room-id tenant validation; and the RLS policy on `room_readiness_predictions` (`016_rls_policies.sql`) is a table-level `USING (tenant_id = ...)` clause that automatically covers the three new columns with zero new-policy work required.

The frontend query-key question resolved definitively: `SupervisorHousekeepingPage` (`apps/web/app/(dashboard)/housekeeping/page.tsx`) fetches predictions via a plain `useState` + `useEffect`-wrapped `fetchPredictions` closure (lines 647–664) — there is no React Query key for predictions at all. The refetch mechanism for the three new actions must either (a) extract `fetchPredictions` into a stable callback (e.g. `useCallback`) reusable both on mount/date-change and as a post-action refresh trigger, passed down through `PredictionPanel` → `PredictionRow`, or (b) do local optimistic `setPredictions` state surgery. The codebase also supplied a directly reusable "one confirming tap" precedent: `FrontDeskDashboard.tsx`'s `LateCheckoutRow` uses a local `mode: 'idle' | 'approving' | 'denying'` state that renders an inline confirm sub-row with Confirm/Cancel buttons — this is the pattern to replicate for Reassign/Escalate/Acknowledge, not `window.confirm` (which appears nowhere in the housekeeping/engineering UI) and not a new modal.

**Primary recommendation:** Implement all three actions as new handlers in `apps/api/routers/housekeeping.py` that internally call `create_assignments`, `count_rooms_ahead`, and `notify_supervisors_high_risk` directly (import the latter two from `services.ai.predictions`); add migration `095_room_readiness_acknowledgement.sql`; extend `run_room_predictions`'s existing snapshot map and upsert-payload logic in place (no new function); and on the frontend, lift `fetchPredictions` out of the `useEffect` into a reusable callback, add three `housekeepingApi` methods, and replicate `LateCheckoutRow`'s inline `mode`-based confirm pattern in `PredictionRow`.

## Architecture Patterns

### Migration numbering (resolved)

Highest existing migration: **`094_tenant_is_test_flag.sql`**. Full check performed:
- `ls supabase/migrations | sort -V | tail` confirms 094 is the highest strictly-numeric-prefixed file.
- `0201_logbook_expires.sql` is a pre-existing 4-digit outlier (documented in CLAUDE.md) — irrelevant to `max+1` selection since it doesn't collide with the 090s range.
- Two `039_*` and three `042_*` files exist (documented duplicates) — also irrelevant to picking the next number.
- A previously **undocumented** gap exists: 081 → 083 (no `082_*.sql` file). Not a blocker, just a gap; new migrations always go at the end, not filling gaps.

**Recommendation:** `supabase/migrations/095_room_readiness_acknowledgement.sql`. Re-verify with a fresh `ls` at execute time in case other work has landed a migration in the interim (this is an autonomous multi-phase session).

**Migration content**, following the exact style of `094_tenant_is_test_flag.sql` (the most recent `ALTER TABLE ADD COLUMN` precedent):

```sql
ALTER TABLE public.room_readiness_predictions ADD COLUMN IF NOT EXISTS is_acknowledged BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.room_readiness_predictions ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
ALTER TABLE public.room_readiness_predictions ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.room_readiness_predictions.is_acknowledged IS
  'Set TRUE when a supervisor/GM manually acknowledges a HIGH-risk prediction, suppressing further auto-notification until risk clears and re-escalates (Phase 27, AI-05).';

-- ROLLBACK:
-- ALTER TABLE public.room_readiness_predictions DROP COLUMN acknowledged_by;
-- ALTER TABLE public.room_readiness_predictions DROP COLUMN acknowledged_at;
-- ALTER TABLE public.room_readiness_predictions DROP COLUMN is_acknowledged;
```

### RLS confirmation (resolved — no new policy needed)

`supabase/migrations/016_rls_policies.sql:405-407`:
```sql
CREATE POLICY "tenant_isolation" ON room_readiness_predictions
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);
```
This is a table-level, `FOR ALL`, column-agnostic policy gated only on `tenant_id`. New columns on the same table are automatically covered — confirmed no new policy or column-level grant is needed. (`037_fix_rls_initplan.sql` and `038_add_fk_indexes.sql` also reference this table but only for `USING`-clause performance rewrites and FK indexes, neither relevant to new nullable/defaulted columns.)

### `create_assignments` direct-call safety (resolved — safe)

`apps/api/routers/housekeeping.py:786-897`. Signature:
```python
async def create_assignments(
    request: CreateAssignmentsRequest,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
```
- No `Request`, `BackgroundTasks`, or other FastAPI-injected-only parameter — both params are plain values with `Depends(...)` only as a *default*, which FastAPI evaluates when routed via HTTP but which is irrelevant when called as a plain Python coroutine with both arguments supplied explicitly (e.g. `await create_assignments(request=car, current_user=current_user)`).
- Internally it only touches `supabase` (module-level singleton), builds/upserts `room_assignments`, mirrors `room_status`, and fires `asyncio.create_task(_send_assignment_push(...))` for push notifications (fire-and-forget, safe to call from within another async handler — it doesn't block or depend on request-scoped state).
- **Conclusion:** direct internal call is safe and satisfies ROADMAP.md's literal instruction to reuse `POST /housekeeping/assignments`'s logic rather than reimplementing the upsert/mirroring/push chain. No extraction into a separate shared helper is needed — call the route function directly.

### `count_rooms_ahead` reuse — import-cycle check (resolved — no cycle)

- `apps/api/services/ai/predictions.py` imports only `logging`, `datetime`, and `core.database.supabase` (lines 1-4). It does **not** import anything from `routers.housekeeping`.
- `apps/api/routers/housekeeping.py`'s current imports (lines 1-12) do **not** include anything from `services.ai.*` — confirmed via a repo-wide grep for `services.ai` / `services\.ai` across `apps/api`, which returned 18 files, none of which is `routers/housekeeping.py`.
- **Conclusion:** `from services.ai.predictions import count_rooms_ahead, notify_supervisors_high_risk` is a safe, acyclic import to add to `housekeeping.py`.
- Signature: `count_rooms_ahead(housekeeper_id: str, room_id: str, hotel_id: str, target_date: str) -> int` — pure, tenant-scoped, already excludes the room being evaluated, already floors at 0 minimum. Directly reusable for computing each candidate housekeeper's current DIRTY/IN_PROGRESS load.

### `notify_supervisors_high_risk` reuse — fresh-data requirement (resolved)

Signature: `notify_supervisors_high_risk(hotel_id: str, room_number: str, room_id: str, predicted_ready_at_str: str) -> int`.
- It needs `predicted_ready_at_str` to format the notification body text ("Predicted ready: 2:30 PM"). Per the live-state guard requirement (criterion 5 covers escalate too), the Escalate handler must **re-read** `room_readiness_predictions` (`predicted_ready_at`, `risk_level`) fresh at request time rather than trusting anything from the request body — there is no client-supplied `predicted_ready_at` in scope anyway since the endpoint only takes `room_id` as a path param, so this is naturally satisfied as long as the handler queries the DB before calling `notify_supervisors_high_risk`.
- Room number: `notify_supervisors_high_risk` takes `room_number` as a plain string, not a room_id lookup — the Escalate handler must join/fetch `rooms.room_number` itself (mirrors how `run_room_predictions` derives `room_number` from the nested `rooms(...)` embed before calling this function).

### `_ensure_tenant_row` reuse for room-id validation (resolved — correct tool)

`apps/api/routers/housekeeping.py:82-90`:
```python
def _ensure_tenant_row(table: str, row_id: str, hotel_id: str, label: str) -> None:
    result = supabase.table(table).select("id").eq("id", row_id).eq("tenant_id", hotel_id).maybe_single().execute()
    if not result or not result.data:
        raise HTTPException(status_code=404, detail=f"{label} not found")
```
- Already used in `create_assignments` for both `rooms` and `shifts` tenant-scoping. Directly applicable: `_ensure_tenant_row("rooms", room_id, current_user.hotel_id, "Room")` at the top of all three new handlers before any further query, to 404 on a room_id from another tenant (defense-in-depth alongside RLS).
- Note: this only proves the room *exists* for this tenant — it does not check `room_readiness_predictions` existence. All three handlers additionally need a query against `room_readiness_predictions` (for the live-state guards on reassign/escalate, and to know what row to update on acknowledge) which will itself naturally 404/no-op if no prediction row exists for that room. Recommend an explicit "prediction not found" 404 check for reassign/escalate (there's nothing to reassign/escalate against if no HIGH prediction was ever generated for that room) — acknowledge should probably also 404 on a missing prediction row rather than silently no-op, since "acknowledge" implies there was something to acknowledge (CONTEXT.md's idempotency note is about *already-acknowledged*, not *never-existed*).

## Frontend Integration

### Predictions fetch — no React Query key exists (resolved)

`apps/web/app/(dashboard)/housekeeping/page.tsx`, `SupervisorHousekeepingPage` (lines 627-664):
```tsx
const [predictions, setPredictions] = useState<RoomPrediction[]>([])
const [predictionsLoading, setPredictionsLoading] = useState(false)

useEffect(() => {
  const fetchPredictions = async () => {
    setPredictionsLoading(true)
    try {
      const res = await housekeepingApi.getPredictions()
      setPredictions(res.data?.rooms || [])
      setLastSyncedAt(new Date())
    } catch {
      // silently fail - predictions are optional
    } finally {
      setPredictionsLoading(false)
    }
  }
  fetchPredictions()
}, [selectedDate, setLastSyncedAt])
```
This is **not** a `useQuery` call — CONTEXT.md's suspicion is confirmed exactly. There is no `['housekeeping-predictions']` (or any) query key to invalidate. The rest of this same component (`useQuery` for `['housekeeping-board', today]`, `useQueryClient` import) shows React Query *is* in scope/available, but predictions specifically were never migrated to it.

**Recommendation for the plan:** Extract `fetchPredictions` out of the `useEffect` body into a `useCallback(async () => {...}, [selectedDate, setLastSyncedAt])`, keep the existing `useEffect(() => { fetchPredictions() }, [fetchPredictions])` for the mount/date-change trigger, and pass the same callback down as an `onActionComplete` (or similarly named) prop through `PredictionPanel` → `PredictionRow` so each action's success handler can call it directly. This is simpler and more consistent with the existing non-React-Query pattern than introducing a new `useQuery`/`useMutation` pair solely for this one panel — do not migrate the whole predictions fetch to React Query as part of this phase (out of scope, adds risk to an unrelated fetch path). Optimistic client-side dimming (Claude's discretion item) can be layered on top by also calling a passed-down `onOptimisticUpdate(roomId, patch)` that does a local `setPredictions` splice before the real refetch lands, if desired.

### `PredictionPanel.tsx` / `PredictionRow` current shape

`apps/web/components/housekeeping/PredictionPanel.tsx`:
- `PredictionPanel` is a dumb component: `{ predictions: RoomPrediction[], isLoading: boolean }` props only — it does not currently receive `useRole()` or any callback props. Both will need to be added/threaded through.
- `PredictionRow({ prediction })` currently renders read-only content only (`Mono`, `Pill`, risk-factor chips, confidence badge) — no action affordances exist yet. New buttons need to be added inside this component, gated on `prediction.risk_level === 'HIGH'` and a new `canAssignRooms` prop threaded down from `SupervisorHousekeepingPage` (which already has `const { canAssignRooms } = useRole()` at line 630 — just needs passing through `PredictionPanel` → `PredictionRow`).
- Existing primitives to reuse for buttons: this file imports `AILabel, Mono, Pill` from `@/components/ui/primitives`; check `@/components/ui/Button` (used elsewhere, e.g. `RoomDetailDrawer.tsx`, `FrontDeskDashboard.tsx`) for the standard button component (`<Button variant="primary" size="sm" loading={...} />` pattern) rather than inventing new button markup.

### `RoomPrediction` TS type extension (mechanical)

`apps/web/lib/api/housekeeping.ts:81-95` — add three new optional fields to match the new nullable/defaulted DB columns:
```ts
export interface RoomPrediction {
  // ...existing fields...
  is_acknowledged?: boolean
  acknowledged_at?: string | null
  acknowledged_by?: string | null
}
```

### One-confirming-tap precedent (resolved — reuse this, not `window.confirm`)

`apps/web/components/dashboard/FrontDeskDashboard.tsx`, `LateCheckoutRow` (lines 49-97):
```tsx
const [mode, setMode] = useState<'idle' | 'approving' | 'denying'>('idle')
// ...
{mode === 'approving' && (
  <div className="flex items-center gap-2 ml-10 bg-[var(--ready-soft)] border border-[var(--ready-line)] rounded-lg px-3 py-2">
    <span className="text-[11.5px] text-[var(--ready)] font-medium shrink-0">Confirm time:</span>
    <Button variant="primary" size="sm" loading={resolving} onClick={() => onApprove(...)}>Confirm</Button>
    <IconButton variant="ghost" size="sm" onClick={() => setMode('idle')} aria-label="Cancel"><X size={14} /></IconButton>
  </div>
)}
```
Paired with a `useMutation` (`onMutate` sets a per-row "resolving" id, `onSettled` clears it and invalidates the relevant query key). This is the **only** confirm-tap precedent in the codebase (`window.confirm` appears nowhere in `apps/web`; no generic `ConfirmPopover`/`ConfirmButton` component exists). `RoomDetailDrawer.tsx`'s destructive-ish actions (undo checkout) use *no* confirm step at all — just a loading spinner — so that file is not the right precedent despite CONTEXT.md flagging it as a candidate to check.

**Recommendation:** Replicate `LateCheckoutRow`'s `mode`-based inline-confirm pattern per action button in `PredictionRow` (e.g. local `actionMode: 'idle' | 'confirm-reassign' | 'confirm-escalate' | 'confirm-acknowledge'` state), not a modal, not `window.confirm`.

## Backend Implementation Sketch

Reassign handler outline (illustrative — planner to finalize exact shape):
```python
@router.post("/room-readiness/{room_id}/reassign")
async def reassign_at_risk_room(
    room_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    _ensure_tenant_row("rooms", room_id, current_user.hotel_id, "Room")

    # Fresh room_status read (live-state guard)
    status_row = supabase.table("room_status").select("status").eq("room_id", room_id)\
        .eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    if not status_row or not status_row.data:
        raise HTTPException(status_code=404, detail="Room status not found")
    if status_row.data["status"] not in {"DIRTY", "IN_PROGRESS", "PICKUP"}:
        raise HTTPException(status_code=409, detail="Room is no longer awaiting cleaning")

    # Candidate pool (mirror suggest_assignments's fallback chain)
    candidates = _active_housekeepers(current_user.hotel_id, target_date=date.today())
    today_str = date.today().isoformat()
    loads = [(hk_id, count_rooms_ahead(hk_id, room_id, current_user.hotel_id, today_str)) for hk_id in candidates]
    eligible = [(hk_id, n) for hk_id, n in loads if n <= 4]

    if not eligible:
        pred = _fetch_prediction_or_404(room_id, current_user.hotel_id)
        room_number = ...  # from rooms join
        notify_supervisors_high_risk(current_user.hotel_id, room_number, room_id, pred["predicted_ready_at"])
        return {"data": {"action": "escalated", "reason": "no_eligible_housekeeper"}}

    chosen_id = min(eligible, key=lambda t: t[1])[0]
    car = CreateAssignmentsRequest(
        date=date.today(),
        assignments=[RoomAssignmentItem(room_id=room_id, housekeeper_id=chosen_id)],
    )
    await create_assignments(request=car, current_user=current_user)
    return {"data": {"action": "reassigned", "housekeeper_id": chosen_id}}
```
Note: `_active_housekeepers` is a new small helper to extract (factoring the shared candidate-pool logic already duplicated between `suggest_assignments` and this new handler) — recommend factoring only the *pool-fetch* portion (steps that build the `housekeepers` list of ids) into a shared private function in `housekeeping.py`, not the full `suggest_assignments` machinery (building affinity, VIP batching are explicitly out of scope per CONTEXT.md).

Escalate handler outline:
```python
@router.post("/room-readiness/{room_id}/escalate")
async def escalate_at_risk_room(
    room_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    _ensure_tenant_row("rooms", room_id, current_user.hotel_id, "Room")
    pred_row = supabase.table("room_readiness_predictions")\
        .select("risk_level, predicted_ready_at").eq("room_id", room_id)\
        .eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    if not pred_row or not pred_row.data:
        raise HTTPException(status_code=404, detail="Prediction not found")
    if pred_row.data.get("risk_level") != "HIGH":
        raise HTTPException(status_code=409, detail="Room is no longer HIGH risk")

    room_info = supabase.table("rooms").select("room_number").eq("id", room_id)\
        .eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    room_number = (room_info.data or {}).get("room_number", "")

    sent = notify_supervisors_high_risk(
        current_user.hotel_id, room_number, room_id, pred_row.data["predicted_ready_at"]
    )
    return {"data": {"action": "escalated", "notifications_sent": sent}}
```

Acknowledge handler outline:
```python
@router.post("/room-readiness/{room_id}/acknowledge")
async def acknowledge_at_risk_room(
    room_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    _ensure_tenant_row("rooms", room_id, current_user.hotel_id, "Room")
    pred_row = supabase.table("room_readiness_predictions")\
        .select("is_acknowledged").eq("room_id", room_id)\
        .eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    if not pred_row or not pred_row.data:
        raise HTTPException(status_code=404, detail="Prediction not found")
    if pred_row.data.get("is_acknowledged"):
        return {"data": {"action": "already_acknowledged"}}

    supabase.table("room_readiness_predictions").update({
        "is_acknowledged": True,
        "acknowledged_at": datetime.now(timezone.utc).isoformat(),
        "acknowledged_by": current_user.user_id,
    }).eq("room_id", room_id).eq("tenant_id", current_user.hotel_id).execute()
    return {"data": {"action": "acknowledged"}}
```

### `run_room_predictions` extension (services/ai/predictions.py)

Current snapshot map (lines 293-306):
```python
existing_preds_result = supabase.table("room_readiness_predictions").select("room_id, risk_level")...
existing_risk_map: dict[str, str] = {r["room_id"]: r.get("risk_level", "LOW") for r in (existing_preds_result.data or [])}
```
Extend to also select/carry `is_acknowledged`:
```python
existing_preds_result = supabase.table("room_readiness_predictions").select("room_id, risk_level, is_acknowledged")...
existing_risk_map: dict[str, dict] = {
    r["room_id"]: {"risk_level": r.get("risk_level", "LOW"), "is_acknowledged": bool(r.get("is_acknowledged"))}
    for r in (existing_preds_result.data or [])
}
```
Then at the per-room loop (line ~428):
```python
prev = existing_risk_map.get(room_id, {"risk_level": "LOW", "is_acknowledged": False})
previous_risk = prev["risk_level"]
was_acknowledged = prev["is_acknowledged"]
```
Upsert payload (lines 402-418) branches on `risk_level`:
```python
upsert_payload = {... existing fields ...}
if risk_level != "HIGH":
    upsert_payload.update({"is_acknowledged": False, "acknowledged_at": None, "acknowledged_by": None})
# else: omit these three keys entirely so Supabase upsert leaves them untouched
supabase.table("room_readiness_predictions").upsert(upsert_payload, on_conflict="room_id").execute()
```
Notify condition (line 429) gets the extra guard:
```python
if risk_level == "HIGH" and previous_risk != "HIGH" and not was_acknowledged:
    ...
```
This matches CONTEXT.md's decision exactly: `previous_risk != "HIGH"` already covers the common auto-clear case; `not was_acknowledged` is defense-in-depth for a manual-acknowledge-landing-mid-continuous-HIGH edge case.

**Caution:** Supabase Python SDK upsert semantics — verify at implementation time that `.upsert(payload, on_conflict="room_id")` with a payload dict that *omits* certain keys genuinely leaves those columns untouched on conflict (this is standard Postgres `ON CONFLICT DO UPDATE SET (only listed columns)` behavior, and the supabase-py client is documented to translate omitted keys this way for upsert, but confirm no full-row-replace behavior is happening — the existing code already relies on this exact per-key-presence pattern nowhere else in this file, so there's no existing test proving it; recommend an explicit unit test for this specific behavior since it is new and load-bearing for the acknowledge-persistence guarantee).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Applying a room assignment | New insert/upsert logic for `room_assignments` + `room_status` mirroring + push notification | `create_assignments(...)` called directly | Already handles clean_type resolution, room_status mirroring, push notifications, and 409-on-duplicate — reimplementing risks drift from the canonical assignment path |
| Supervisor notification on HIGH risk | New notification-insert logic | `notify_supervisors_high_risk(...)` called directly | Identical shape must be produced whether triggered by cron or manually — a second implementation risks the two diverging over time |
| Housekeeper workload counting | A new "rooms assigned today, not yet done" query | `count_rooms_ahead(...)` | Already tenant-scoped, already excludes the room in question, already used by the exact risk-factor threshold (`> 4`) this phase's eligibility check mirrors |
| Tenant-scoped existence check | Ad hoc `.eq("id",...).eq("tenant_id",...)` queries per new endpoint | `_ensure_tenant_row(table, row_id, hotel_id, label)` | Already the established 404-guard idiom in this file; consistent error shape |

**Key insight:** This phase is explicitly framed by ROADMAP.md as executing "directly against the existing assignment/notification endpoints rather than a new governance layer" — every locked decision in CONTEXT.md reinforces reuse over reimplementation, and every reuse target was confirmed callable with no adaptation needed beyond passing tenant-scoped arguments.

## Common Pitfalls

### Pitfall 1: Treating `Depends(require_role(...))` as auto-enforcing on a direct function call
**What goes wrong:** Calling `create_assignments(request=car, current_user=current_user)` directly does NOT re-run the `require_role` check — it's a FastAPI dependency, only evaluated by FastAPI's routing layer on an actual HTTP request.
**Why it happens:** `Depends(...)` as a default-parameter value is inert outside of FastAPI's request-handling path; Python just sees it as a mutable default object if bypassed.
**How to avoid:** This is actually fine/expected here — the new wrapping endpoint (`/room-readiness/{room_id}/reassign`) has its own `require_role("gm", "housekeeping_supervisor")` dependency that gates entry, and it constructs `current_user` from *that* already-validated context before passing it into `create_assignments`. Just don't assume calling `create_assignments` a second, unguarded way (e.g. from a script or a differently-gated route) would inherit protection — it wouldn't.
**Warning signs:** Any new call site of `create_assignments` that isn't itself behind an equivalent `require_role` gate.

### Pitfall 2: Upsert payload key omission not behaving as expected
**What goes wrong:** Assuming `.upsert({...}, on_conflict="room_id")` with acknowledgement keys omitted silently preserves existing values could be wrong if the supabase-py client or Postgrest actually does a full-row replace on conflict rather than a column-scoped `SET`.
**Why it happens:** ON CONFLICT DO UPDATE SET behavior is standard Postgres, but the exact translation through PostgREST's upsert (`Prefer: resolution=merge-duplicates`) needs verification for this specific SDK version — this is a **new reliance pattern** not currently exercised anywhere else in this codebase.
**How to avoid:** Add a specific unit test asserting that upserting a HIGH-risk row (payload omitting the three ack columns) leaves a previously-set `is_acknowledged=True` row unchanged. If it does NOT behave this way, the fallback is to explicitly read-then-conditionally-include the ack columns in every upsert call (read `is_acknowledged` from `existing_risk_map` and always include the three keys, computed either as "preserve" or "clear").
**Warning signs:** A HIGH-risk room that was acknowledged loses its acknowledgement on the very next cron cycle even though risk never cleared.

### Pitfall 3: Reassign degrade-path calling `notify_supervisors_high_risk` with stale `predicted_ready_at`
**What goes wrong:** If the reassign handler doesn't re-fetch the prediction row before calling the notify function in its degrade branch, it could use `None`/stale data for `predicted_ready_at_str`, producing a garbled notification body ("Predicted ready: None").
**Why it happens:** The reassign handler's primary live-state guard reads `room_status`, not `room_readiness_predictions` — the prediction row (needed for `predicted_ready_at` and `room_number`) must be fetched separately before the notify call.
**How to avoid:** Explicitly fetch the prediction row (and `rooms.room_number`) inside the degrade branch, mirroring exactly what the Escalate handler does — do not assume the room_status fetch already has this data.

### Pitfall 4: No existing router test file — planner must scaffold from scratch
**What goes wrong:** Assuming an existing `test_housekeeping_assignments.py` or similar can be extended (as CONTEXT.md speculated) leads to a failed file lookup mid-implementation.
**Why it happens:** `apps/api/tests/` has zero files matching `test_housekeeping*` or `test_predictions*` — verified via directory listing.
**How to avoid:** Plan for a **new** test file, e.g. `apps/api/tests/test_room_readiness_actions.py`, following the `FakeDB` + `monkeypatch.setattr(module, "supabase", db)` harness from `tests/smoke/fake_supabase.py` (used in `test_failure_prediction_notifications.py`) for service-level tests, and the `require_role(...)` direct-invocation + `pytest.raises(HTTPException)` pattern from `test_work_order_archive.py` (lines 371-381) for RBAC/403 coverage.

## Testing Approach (confirmed conventions)

Two complementary test patterns exist in this codebase and should both be used:

1. **Service-function tests** (for `count_rooms_ahead`, `notify_supervisors_high_risk`, and the extended `run_room_predictions` acknowledgement-clearing/re-escalation logic) — follow `test_failure_prediction_notifications.py`'s pattern exactly: `FakeDB({...})` seeded with rows, `monkeypatch.setattr(predictions, "supabase", db)`, call the function under test, assert on `db.rows[...]`.

2. **RBAC tests** (403-for-housekeeper on all three new endpoints, satisfying success criterion 4) — follow `test_work_order_archive.py`'s pattern: `check = require_role("gm", "housekeeping_supervisor")`, `with pytest.raises(HTTPException) as exc: await check(current_user=CurrentUser(role="housekeeper", ...))`, `assert exc.value.status_code == 403`. Parametrize over `["housekeeper", "front_desk", "engineer", "chief_engineer"]` (all non-supervisor/GM roles) to be thorough.

3. **Endpoint-behavior tests** (live-state guards, degrade path, idempotent acknowledge) will need either a router-level `FakeDB` extended with `.update()`/`.maybe_single()` support (mirror `test_work_order_archive.py`'s `_ArchiveDatabase`/`_ArchiveQuery` pattern, which already supports `eq`, `in_`, `is_`, filters, update payload, maybe_single) or calling the new handler functions directly with a constructed `CurrentUser` and monkeypatched `supabase` — no existing precedent calls a router function through `TestClient` with `dependency_overrides`, so match the established direct-call-with-explicit-args style rather than introducing `TestClient`.

New test file: `apps/api/tests/test_room_readiness_actions.py` (does not exist yet — created fresh, not extending anything).

## Open Questions

1. **Supabase upsert omitted-column-preservation semantics**
   - What we know: Postgres `ON CONFLICT DO UPDATE SET (col1, col2)` semantics preserve unlisted columns; this is the standard and expected behavior, and CONTEXT.md's decision assumes it.
   - What's unclear: Whether the installed `supabase-py`/PostgREST version in this repo actually translates a Python dict with omitted keys into a column-scoped `SET`, versus some client-side default that includes all schema columns (some ORMs "helpfully" fill in `None` for unspecified fields).
   - Recommendation: Write the acknowledgement-preservation unit test described in Pitfall 2 as the FIRST test for this phase, before building out the full endpoint set — it validates a load-bearing assumption cheaply.

2. **Exact button copy/icons and response-shape field names**
   - What we know: CONTEXT.md explicitly defers this to Claude's discretion at plan time.
   - What's unclear: Nothing blocking — just needs to be decided in PLAN.md, informed by existing i18n key patterns (`t('housekeeping.predictionPanel.*')`) already used throughout `PredictionPanel.tsx`, since this app is localized (i18n via `react-i18next`, see `es.ts` locale file referenced during research).
   - Recommendation: New action button labels should get new i18n keys under `housekeeping.predictionPanel.*` (e.g. `reassign`, `escalate`, `acknowledge`, `confirmReassign`, etc.) rather than hardcoded English strings, matching every other string in this file.

## Sources

### Primary (HIGH confidence — direct code reads, this repo)
- `supabase/migrations/*.sql` (directory listing + content of 013, 016, 037, 038, 094) — schema, RLS, migration numbering
- `apps/api/routers/housekeeping.py` (imports, `_ensure_tenant_row`, `_ensure_housekeeper`, `create_assignments`, `suggest_assignments`, `get_predictions`) — full read of relevant sections
- `apps/api/services/ai/predictions.py` (full file read) — `count_rooms_ahead`, `notify_supervisors_high_risk`, `run_room_predictions`, `get_at_risk_rooms`
- `apps/api/models/requests.py` (`CreateAssignmentsRequest`, `RoomAssignmentItem`)
- `apps/api/middleware/credits.py` (confirmed no path-based AI-credit gating applies to these new non-AI endpoints)
- `apps/web/components/housekeeping/PredictionPanel.tsx` (full file read)
- `apps/web/app/(dashboard)/housekeeping/page.tsx` (predictions fetch, `SupervisorHousekeepingPage`)
- `apps/web/lib/api/housekeeping.ts` (`RoomPrediction` type, `housekeepingApi.getPredictions`)
- `apps/web/lib/hooks/useRole.ts` (`canAssignRooms` scoped to `['gm','housekeeping_supervisor']`)
- `apps/web/components/dashboard/FrontDeskDashboard.tsx` (`LateCheckoutRow` confirm-tap pattern)
- `apps/web/components/housekeeping/RoomDetailDrawer.tsx` (confirmed NO confirm-tap pattern present — undo-checkout is single-tap)
- `apps/api/tests/` directory listing (confirmed no `test_housekeeping*`/`test_predictions*` file exists)
- `apps/api/tests/test_failure_prediction_notifications.py`, `apps/api/tests/smoke/fake_supabase.py`, `apps/api/tests/test_work_order_archive.py` (test harness conventions)

No Context7/external-docs lookups were needed — this phase is entirely internal reuse of existing repo code, not new library integration.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; reuses existing FastAPI/Supabase/React Query patterns already in the repo.
- Architecture: HIGH — every locked decision verified against actual function signatures and imports in this session.
- Pitfalls: MEDIUM — the upsert-omitted-column-preservation behavior (Pitfall 2) is inferred from standard Postgres semantics, not verified by running code against the live Supabase instance in this research pass; flagged as an Open Question requiring a first-class test.

**Research date:** 2026-08-12
**Valid until:** Should remain valid through this milestone (no fast-moving external dependencies); re-verify migration number if other phases land migrations first.
