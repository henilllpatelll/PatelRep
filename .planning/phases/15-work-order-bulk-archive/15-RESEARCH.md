# Phase 15: Work-Order Bulk-Archive - Research

**Researched:** 2026-08-03
**Domain:** FastAPI + Supabase Python SDK (backend), Next.js 14 App Router client component (frontend) — extending an existing Engineering work-order Kanban board with archive/unarchive
**Confidence:** HIGH (this is entirely internal codebase pattern-matching, not an external library — no Context7/WebSearch needed; every recommendation below is traced to an existing file in this repo)

> No CONTEXT.md exists for this phase — user chose to skip `/gsd:discuss-phase`. There are no locked decisions. Everything below is either a hard fact traced to existing code, or an explicitly flagged discretion area with a recommendation.

## Summary

This phase does **not** need any new infrastructure. The codebase already has everything the phase goal requires: an append-only, tenant-scoped audit table (`operational_audit_events`, migration 065) with a proven `_record_audit_event()` insert pattern, a bulk-endpoint precedent (`POST /schedules/assignments/bulk` in `scheduling.py`), a Realtime-subscribed Kanban page that already invalidates on any `work_orders` change, and a tabs-based page-header component already used for a second view mode on this exact page. The only genuinely new pieces are: two nullable columns on `work_orders` (`archived_at`, `archived_by`), two/three new router endpoints, and an "Archived" tab in the existing work-orders page.

**Primary recommendation:** Add `archived_at TIMESTAMPTZ` + `archived_by UUID` to `work_orders` (migration `089_work_order_archive.sql`), scope every existing "active" list query with `.is_("archived_at", "null")`, write one bulk-archive/bulk-unarchive endpoint pair in `apps/api/routers/work_orders.py` reusing the `operational_audit_events` insert pattern from `evidence.py`, and add a third "Archived" tab to `apps/web/app/(dashboard)/engineering/work-orders/page.tsx` using the same `tabs` prop already wired up for the Room Board tab.

## Critical Codebase Facts (verified by reading source, not training data)

These override anything in CLAUDE.md that conflicts — CLAUDE.md is stale in two places relevant to this phase:

1. **`chief_engineer` role no longer exists.** Migration 064 merged it into `engineer` (see `apps/api/services/work_orders/transitions.py:42-44`, comment: *"Migration 064 intentionally merged chief_engineer into engineer. Engineers therefore retain the operational authority previously held by that role."*). CLAUDE.md's role table still lists `chief_engineer` as separate — do not use it in new code. For work orders, the two roles with elevated authority are `gm` and `engineer`, captured as `_MANAGEMENT_ROLES = frozenset({"gm", "engineer"})` in that same file.
2. **Migration numbering is at 088, not 041.** CLAUDE.md's "Key migrations" list stops at 041; the actual latest file is `088_ai_interactions_work_order_triage_type.sql`. The next migration for this phase must be numbered **089**.
3. **DB column is `tenant_id`, not `hotel_id`.** Every query filters `.eq("tenant_id", current_user.hotel_id)` — `hotel_id` only exists as the JWT claim / `CurrentUser` attribute, never as a column name. (CLAUDE.md's own convention note already says this correctly — flagging because it's easy to typo the column name as `hotel_id`.)

## Standard Stack

No new dependencies. Everything is existing repo infrastructure:

| Component | Location | Purpose |
|---|---|---|
| FastAPI + Supabase Python SDK | `apps/api/routers/work_orders.py` | Existing WO CRUD/transition router — extend, don't create a new file |
| `operational_audit_events` table | migration `065_work_order_transition_audit.sql` | Append-only, tenant-scoped, RLS-protected audit log — already used for work-order transitions |
| `require_role()` dependency | `apps/api/middleware/auth.py` (imported in `work_orders.py`) | RBAC gate, e.g. `Depends(require_role("engineer", "gm"))` |
| `SanitizedBaseModel` + Pydantic | `apps/api/models/requests.py` | Request body validation base class used by every existing bulk endpoint |
| Supabase Realtime | migration `030_enable_realtime_work_orders.sql` + `work-orders/page.tsx:254-266` | `work_orders` table is already in the `supabase_realtime` publication; the page already subscribes and invalidates React Query on any change |
| React Query + `PageHeader` tabs | `work-orders/page.tsx:242, 360-363` | Existing `activeTab` state + `tabs` prop pattern (currently "work-orders" / "room-board") |

## Architecture Patterns

### Pattern 1: Schema change — soft-archive via nullable columns (not a status enum value)

**What:** Add `archived_at TIMESTAMPTZ` and `archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL` to `work_orders`. Do **not** add `"archived"` as a new value to the existing `work_orders_status_check` CHECK constraint (`open | escalated | in_progress | on_hold | completed | cancelled`).

**Why:** Archiving is orthogonal to operational status — a WO can be `completed` or `cancelled` and independently archived/unarchived. Folding "archived" into the `status` enum would break every existing status-transition check in `apps/api/services/work_orders/transitions.py` (`_ALLOWED_TRANSITIONS`, `_MANAGEMENT_ROLES` gating on `override`) and every Kanban column keyed on `status`. A nullable timestamp column is the same shape as `completed_at`/`started_at`, which already coexist with `status` on this exact table.

**Example (migration `089_work_order_archive.sql`):**
```sql
ALTER TABLE public.work_orders
  ADD COLUMN archived_at TIMESTAMPTZ,
  ADD COLUMN archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX idx_work_orders_archived_at
  ON public.work_orders (tenant_id, archived_at)
  WHERE archived_at IS NOT NULL;
```
No RLS changes needed — the existing tenant-scoped RLS policy on `work_orders` already covers new columns on the same row.

### Pattern 2: Audit trail — reuse `operational_audit_events`, don't invent a table

**What:** Every archive/unarchive action inserts one row per work order into the existing `operational_audit_events` table, using the exact insert shape already proven in `apps/api/routers/evidence.py:65-82`:

```python
# Source: apps/api/routers/evidence.py:65-82 (existing helper, copy the pattern)
def _record_audit_event(
    *, current_user: CurrentUser, resource_type: str, resource_id: str,
    action: str, old_state: dict | None = None, new_state: dict | None = None,
    reason_code: str | None = None, reason_note: str | None = None,
) -> None:
    supabase.table("operational_audit_events").insert({
        "tenant_id": current_user.hotel_id,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "action": action,
        "actor_id": current_user.user_id,
        "actor_role": current_user.role,
        "old_state": old_state or {},
        "new_state": new_state or {},
        "reason_code": reason_code,
        "reason_note": reason_note,
        "source": "api",
    }).execute()
```

**Action naming:** follow the existing dot-separated `resource.verb` convention seen in `transition_work_order_with_audit()` (`work_order.transitioned`, `work_order.transition_overridden`). Use `work_order.archived` and `work_order.unarchived`. Use `reason_code` to distinguish the two bulk-archive triggers required by ARCHIVE-01 vs ARCHIVE-06 (e.g. `reason_code="bulk_manual_selection"` vs `reason_code="bulk_by_age"`) — no separate "batch" or "job" table is needed; per-row audit rows satisfy "who, when, which work orders" (ARCHIVE-03) on their own, and can be grouped in a UI by matching `created_at` timestamp + `action` if a batch view is ever wanted.

**Where to view history:** `apps/api/routers/evidence.py:264-275` shows the existing pattern for exposing audit history via a `GET .../history` endpoint filtered by `resource_type` + `resource_id`. The same `.eq("resource_type", "work_order").eq("action", "work_order.archived")` filter (without a specific `resource_id`) is how a tenant-wide "who archived what, when" view would be built if the phase needs one beyond what's shown inline in the Archived tab.

### Pattern 3: Bulk endpoint — precedent from `scheduling.py`

**What:** `apps/api/routers/scheduling.py:195-216` (`POST /schedules/assignments/bulk`) is the only existing bulk-mutation endpoint in the codebase. Its shape:

```python
# Source: apps/api/routers/scheduling.py:195-199, apps/api/models/requests.py:776-783
class BulkShiftAssignmentItem(SanitizedBaseModel):
    user_id: UUID4
    shift_id: UUID4
    work_date: date

class BulkShiftAssignmentRequest(SanitizedBaseModel):
    assignments: List[BulkShiftAssignmentItem] = Field(min_length=1, max_length=500)

@router.post("/assignments/bulk")
async def bulk_create_assignments(
    body: BulkShiftAssignmentRequest,
    current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES))
):
```

**Recommended shape for this phase** (add to `apps/api/routers/work_orders.py`, models to `apps/api/models/requests.py`):

```python
class BulkArchiveWorkOrdersRequest(SanitizedBaseModel):
    work_order_ids: List[UUID4] = Field(min_length=1, max_length=200)

class BulkArchiveByAgeRequest(SanitizedBaseModel):
    older_than_days: int = Field(ge=1, le=3650)

class BulkUnarchiveWorkOrdersRequest(SanitizedBaseModel):
    work_order_ids: List[UUID4] = Field(min_length=1, max_length=200)
```

Three endpoints cover all five success criteria:
- `POST /work-orders/bulk-archive` — body `BulkArchiveWorkOrdersRequest` (ARCHIVE-01)
- `POST /work-orders/bulk-archive-by-age` — body `BulkArchiveByAgeRequest`, server-side query for `status = 'completed'` (and per requirement wording, only completed — not cancelled) rows with `completed_at < now() - interval` (ARCHIVE-06)
- `POST /work-orders/bulk-unarchive` — body `BulkUnarchiveWorkOrdersRequest` (part of ARCHIVE-04)

Each should validate every referenced WO belongs to `current_user.hotel_id` before mutating (same tenant-guard pattern as `_ensure_tenant_row` / `_ensure_tenant_staff` already in `work_orders.py`), reject WOs not in an archivable state (only `completed`/`cancelled` per ARCHIVE-01's own wording), then loop the insert-audit-row + update pattern in a single request (Supabase Python SDK has no multi-row transactional RPC needed here — same non-atomic-but-idempotent style already used by `bulk_create_assignments`, which loops per-item without a DB transaction).

### Pattern 4: Filtering archived rows out of active views

**What:** Every existing `list_work_orders` query path (`apps/api/routers/work_orders.py:164-248`, both the engineer OR-filter branch and the standard branch) must add `.is_("archived_at", "null")` by default. Add an explicit `include_archived: bool = Query(False)` (or a dedicated `archived: bool` filter) so the new "Archived" tab can request the opposite (`.not_.is_("archived_at", "null")`).

**Realtime interaction (ARCHIVE-02):** No special Realtime handling is needed. `work-orders/page.tsx:254-266` already subscribes to `postgres_changes` on `work_orders` with `event: '*'` and simply calls `queryClient.invalidateQueries({ queryKey: ['work-orders'] })` — it doesn't inspect the changed row. Once archived, an update event fires, React Query refetches, and because the refetch goes through the now-filtered `list_work_orders` query, the archived row silently drops out of the active columns. This satisfies "no longer appear in the default active work-order view or on the Realtime board" for free — the existing invalidate-and-refetch approach already handles it correctly as long as the backend filter is added.

### Pattern 5: Frontend — third tab, not a new page

**What:** `apps/web/app/(dashboard)/engineering/work-orders/page.tsx:242` already has `activeTab: 'work-orders' | 'room-board'` state driving a `tabs` array passed to `PageHeader` (`page.tsx:360-363`). Extend the union to `'work-orders' | 'room-board' | 'archived'` and add a third tab entry. The "Archived" tab view queries `listWorkOrders({ archived: true })` (or equivalent) instead of the five per-status Kanban queries, and renders a flat list (reusing `WorkOrderCard`/`WorkOrderList` styling) with a per-row or bulk "Restore" action instead of columns.

**Bulk-select UI:** There is no shared `Checkbox` UI primitive in `apps/web/components/ui/`. Every existing multi-checkbox UI in the codebase (`HousekeepingDepthPanels.tsx:139-143`, `SafetyPrograms.tsx`) uses a plain unstyled `<input type="checkbox">` inside a `<label className="flex items-center gap-2 ...">`. Follow that convention rather than introducing a new primitive component — this is a small, low-frequency UI surface (bulk-select on WO cards + an action bar with "Archive Selected" button), not worth a reusable abstraction per the project's flat-architecture convention (CLAUDE.md "Services layer depth").

### Anti-Patterns to Avoid

- **Don't add `"archived"` to the `work_orders_status_check` CHECK constraint** — breaks the transition state machine (see Pattern 1).
- **Don't create a new audit table.** `operational_audit_events` already exists, is RLS-protected, append-only (trigger-enforced), and is exactly the shape ARCHIVE-03 needs. A second table would fragment the audit trail across two systems.
- **Don't hard-delete archived work orders.** The phase goal explicitly states "no data is ever deleted" — this is distinct from the existing `DELETE /work-orders/{wo_id}` (gm-only hard delete at `work_orders.py:478-502`), which stays unchanged and untouched by this phase.
- **Don't gate archive to `gm`-only by copying the hard-delete endpoint's RBAC.** Archiving is reversible and far less destructive than the existing hard delete; gating it that tightly would likely fail the phase's own usability goal (engineers doing daily board cleanup). See Open Questions below — this needs a discretion call, but the codebase's own `_MANAGEMENT_ROLES = {gm, engineer}` convention (used for transition overrides) is the better-fitting precedent than the delete endpoint's `gm`-only gate.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Audit logging | A new `work_order_archive_log` table | `operational_audit_events` (existing) | Already RLS-scoped, append-only via trigger, and the exact "who/when/what changed" shape ARCHIVE-03 asks for |
| Bulk request validation | Manual list-length checks in the route body | `Field(min_length=1, max_length=N)` on a `SanitizedBaseModel` list field | Matches `BulkShiftAssignmentRequest` exactly; Pydantic handles the 422 automatically |
| Realtime "hide archived rows" logic | Client-side filtering of the Realtime payload | Server-side `.is_("archived_at", "null")` filter on the list endpoint the existing invalidate-and-refetch already calls | The frontend never inspects the Realtime payload today — don't start now, just make the refetch return the right rows |

**Key insight:** this phase is 90% "extend three existing patterns" (audit table, bulk endpoint shape, Kanban tabs) and 10% genuinely new (two columns, three endpoints, one tab). Resist the urge to design a generic "archivable resource" abstraction — no other resource in this codebase needs archiving yet, and CLAUDE.md's services-layer-depth convention explicitly says not to extract shared abstractions until 2+ domains need them.

## Common Pitfalls

### Pitfall 1: Forgetting the engineer OR-filter branch in `list_work_orders`
**What goes wrong:** `list_work_orders` (`work_orders.py:164-248`) has two code paths — a special merge-based path for `role == "engineer"` (lines 188-226) and a standard path for everyone else (lines 228-248). Adding the `archived_at IS NULL` filter to only one branch means engineers either see archived WOs that managers don't, or vice versa.
**Why it happens:** The two branches look similar but are separate query builders (`_base()` closure vs. inline `query`).
**How to avoid:** Add the archived filter inside `_base()` (engineer branch) AND the standalone `query` builder (everyone-else branch) — both are visible in the same function, easy to check side by side.
**Warning signs:** Manual QA as an engineer role shows different archived/unarchived behavior than QA as gm.

### Pitfall 2: Cancelled work orders have no existing UI surface
**What goes wrong:** The Kanban board in `work-orders/page.tsx` only renders 5 columns (`getColumns()`: open, escalated, in_progress, on_hold, completed) — `cancelled` is a valid `status` value but is **never shown** anywhere in the current UI. ARCHIVE-01 requires managers to select "completed/cancelled" work orders to archive, but cancelled ones aren't reachable today.
**Why it happens:** Cancelled WOs were presumably always meant to just age out; nothing in the codebase currently displays them.
**How to avoid:** This is a genuine open question for planning — see below. Don't assume the existing Kanban is sufficient; the Archived tab's "source" view (or a dedicated way to select what to archive) needs to expose cancelled WOs somehow, since they're currently invisible.

### Pitfall 3: `work_order_number` is a per-tenant `SERIAL`, not globally unique
**What goes wrong:** If any bulk-archive UI or audit display tries to dedupe or key by `work_order_number` alone (e.g., across a multi-tenant admin view), it will collide. Not a risk for this phase's manager-scoped-to-their-hotel UI, but worth noting if any audit/report surface is added — always key by `id` (UUID), display `work_order_number` only as a label.
**How to avoid:** Non-issue as long as all API calls stay tenant-scoped (which they already are throughout `work_orders.py`).

## Code Examples

### Filtering archived work orders out of the active list (both branches)
```python
# apps/api/routers/work_orders.py — engineer branch, inside _base()
q = (
    supabase.table("work_orders")
    .select("*, rooms(room_number), assets(name)")
    .eq("tenant_id", current_user.hotel_id)
    .is_("archived_at", "null")   # NEW
    .order("created_at", desc=True)
    .range(0, fetch_up_to - 1)
)

# standard branch
query = (
    supabase.table("work_orders")
    .select("*, rooms(room_number), assets(name)")
    .eq("tenant_id", current_user.hotel_id)
    .is_("archived_at", "null")   # NEW
    .order("created_at", desc=True)
    .range((page - 1) * per_page, page * per_page - 1)
)
```

### Bulk-archive endpoint skeleton
```python
# apps/api/routers/work_orders.py — new endpoint
_ARCHIVABLE_STATUSES = {"completed", "cancelled"}

@router.post("/bulk-archive")
async def bulk_archive_work_orders(
    body: BulkArchiveWorkOrdersRequest,
    current_user: CurrentUser = Depends(require_role("engineer", "gm")),
):
    ids = [str(i) for i in body.work_order_ids]
    rows = (
        supabase.table("work_orders")
        .select("id, status, archived_at")
        .eq("tenant_id", current_user.hotel_id)
        .in_("id", ids)
        .execute()
    ).data or []

    found_ids = {r["id"] for r in rows}
    missing = set(ids) - found_ids
    if missing:
        raise HTTPException(status_code=404, detail=f"Work orders not found: {sorted(missing)}")

    not_archivable = [r["id"] for r in rows if r["status"] not in _ARCHIVABLE_STATUSES]
    if not_archivable:
        raise HTTPException(
            status_code=409,
            detail=f"Only completed/cancelled work orders can be archived: {not_archivable}",
        )

    now = datetime.now(timezone.utc).isoformat()
    supabase.table("work_orders").update({
        "archived_at": now, "archived_by": current_user.user_id,
    }).eq("tenant_id", current_user.hotel_id).in_("id", ids).execute()

    supabase.table("operational_audit_events").insert([
        {
            "tenant_id": current_user.hotel_id, "resource_type": "work_order",
            "resource_id": wo_id, "action": "work_order.archived",
            "actor_id": current_user.user_id, "actor_role": current_user.role,
            "old_state": {"archived_at": None}, "new_state": {"archived_at": now},
            "reason_code": "bulk_manual_selection", "source": "api",
        }
        for wo_id in ids
    ]).execute()

    return {"data": {"archived_count": len(ids)}}
```
(Bulk-unarchive and bulk-archive-by-age follow the same shape — set `archived_at`/`archived_by` to `None`/current respectively, insert `work_order.unarchived` audit rows.)

## Open Questions

1. **Which roles can archive/unarchive?**
   - What we know: `_MANAGEMENT_ROLES = {gm, engineer}` is the existing convention for elevated WO actions (transition overrides). The hard-delete endpoint is stricter (`gm`-only).
   - What's unclear: Whether "Manager" in the phase description means gm-only or gm+engineer.
   - Recommendation: Gate to `require_role("engineer", "gm")`, matching the override precedent, since archiving is reversible (unlike delete) and engineers are the ones actually working the board day-to-day. Flag to user/planner as a discretion call if a stricter gate is preferred.

2. **How does a manager reach cancelled work orders to select them for archiving?**
   - What we know: The Kanban board never renders a "Cancelled" column today (Pitfall 2 above).
   - What's unclear: Whether this phase should add a 6th Kanban column, add a status filter to some view, or whether ARCHIVE-06 (bulk-by-age, `completed` only per its wording) is meant to be the primary path and cancelled WOs are expected to be rare/edge-case only reachable via the Archived tab's "browse all archivable" source list.
   - Recommendation: The planner should design the bulk-archive selection UI as its own small view (not squeezed into the existing 5-column Kanban) — e.g., a lightweight list with status/age filters and checkboxes, reachable from an "Archive..." action, separate from the Kanban. This avoids reshaping the existing Kanban layout for a manager-only, occasional-use action.

3. **Does "specified age" in ARCHIVE-06 mean age since completion (`completed_at`) or age since creation (`created_at`)?**
   - What we know: `completed_at` exists and is set by the transition RPC (`transition_work_order_with_audit`, migration 065) when status becomes `completed`.
   - What's unclear: Requirement wording ("completed work orders older than a specified age") is ambiguous between "completed X days ago" and "created X days ago".
   - Recommendation: Use `completed_at`, since ARCHIVE-06 explicitly scopes to `completed` work orders and `completed_at` is the more meaningful and already-indexed-adjacent timestamp for that framing. Flag as a one-line confirmation in the plan rather than a blocking question.

## Sources

### Primary (HIGH confidence — direct file reads from this repo)
- `apps/api/routers/work_orders.py` — full router, all endpoints, list/get/transition/delete/photo/comment handlers
- `apps/api/services/work_orders/transitions.py` — status state machine, `_MANAGEMENT_ROLES`, chief_engineer merge comment
- `apps/api/routers/evidence.py` — `_record_audit_event()` helper, `GET .../history` pattern
- `apps/api/routers/scheduling.py` + `apps/api/models/requests.py` — bulk endpoint precedent
- `supabase/migrations/007_work_orders.sql`, `065_work_order_transition_audit.sql`, `030_enable_realtime_work_orders.sql` — schema, audit table, Realtime enablement
- `apps/web/app/(dashboard)/engineering/work-orders/page.tsx` — Kanban page, tabs pattern, Realtime subscription
- `apps/web/lib/api/engineering.ts` — frontend API client conventions
- `apps/web/components/programs/HousekeepingDepthPanels.tsx` — checkbox styling convention
- `apps/api/tests/test_work_order_transitions.py` — test file conventions for this domain
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` — ARCHIVE-01..06 requirement text, Phase 15 goal/success criteria

No Context7/WebFetch/WebSearch sources were used — this phase is entirely an extension of existing internal patterns, not a new external library or framework integration.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, every pattern cited is a live file in this repo
- Architecture: HIGH — audit table, bulk endpoint, and tabs patterns all have working precedent read directly
- Pitfalls: HIGH for the RBAC/filter-branch pitfalls (directly observed in code); MEDIUM for the "cancelled WO has no UI surface" framing (requires a planning decision, not just a fact)

**Research date:** 2026-08-03
**Valid until:** Stable — this is internal-codebase research, not tracking an external library's release cadence. Re-verify only if `work_orders.py`, `transitions.py`, or the migrations list change materially before this phase is planned/executed.
