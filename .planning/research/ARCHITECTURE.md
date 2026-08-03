# Architecture Research

**Domain:** Integration architecture — self-serve billing management + bulk-archive for Engineering work orders (subsequent milestone on existing PatelRep production app)
**Researched:** 2026-08-03
**Confidence:** HIGH (all findings verified against current source: `routers/billing.py`, `routers/webhooks.py`, `routers/work_orders.py`, `services/work_orders/transitions.py`, `app/(dashboard)/engineering/work-orders/page.tsx`, `app/(dashboard)/settings/billing/page.tsx`, migrations 007/030/065)

## Executive Summary

Both capabilities are **additive integrations onto code that already exists** — neither is greenfield.

- **Self-serve billing** already has a working spine: `routers/billing.py` (subscription, credits, Stripe **Customer Portal**, checkout, invoices), the `stripe_webhook` handler in `routers/webhooks.py`, the `settings/billing/page.tsx` UI, and the `/v1/internal/billing/monthly-trueup` cron. The Stripe Customer Portal already covers payment-method updates, plan cancellation, and plan changes. The incremental work is a small set of **additive endpoints** for controls the portal does not expose (self-serve spending-cap adjustment; optional pause/resume) plus UI. **Likely no new migration** (`subscriptions.cap_cents` already exists) unless a cap-change audit trail is wanted.
- **Bulk-archive** is the more architecturally interesting one because it touches the **Realtime-subscribed** Engineering Work Orders board. It needs **one new migration (089)** adding an `archived_at` flag + partial index + a new audited RPC, one new bulk endpoint on `work_orders.py`, and — critically — **one line added to the board's list query** so archived rows drop off. The Realtime subscription itself must **not** be changed (see the gotcha below).

The two features share **no router, table, or migration** and are safe to build as **independent parallel phases**.

## Standard Architecture

### System Overview — where the new pieces attach

```
┌──────────────────────────────────────────────────────────────────────┐
│                         WEB (Next.js 14/16)                            │
│  settings/billing/page.tsx          engineering/work-orders/page.tsx   │
│  (+ cap editor UI)                  (+ multiselect + Archive action)   │
│        │                                    │        ▲                 │
│  lib/api/billing.ts                   lib/api/engineering.ts           │
│  (+ updateCap / pause)                (+ bulkArchiveWorkOrders)        │
│        │                                    │        │                 │
│        │                     Realtime sub (wo_realtime) — UNCHANGED    │
│        │                     event:* filter:tenant_id → invalidate RQ  │
└────────┼────────────────────────────────────┼────────┼────────────────┘
         │ HTTPS /v1                           │ HTTPS  │ WebSocket (SB Realtime)
┌────────┼────────────────────────────────────┼────────┼────────────────┐
│                              API (FastAPI)   │        │                 │
│  routers/billing.py                    routers/work_orders.py          │
│  (+ PATCH /billing/cap,                (+ POST /work-orders/bulk-       │
│   + POST /billing/pause?)               archive; list query gains       │
│        │                                .is_("archived_at","null"))     │
│  routers/webhooks.py (stripe_webhook)  services/work_orders/            │
│  (maybe + paused/resumed events)        transitions.py — UNCHANGED      │
└────────┼────────────────────────────────────┼─────────────────────────┘
         │                                     │
┌────────┼─────────────────────────────────────┼────────────────────────┐
│                            Supabase (Postgres + RLS + Realtime)         │
│  subscriptions, credit_ledger          work_orders (+ archived_at,      │
│  (cap_cents already exists)             archived_by) ← MIGRATION 089     │
│                                         operational_audit_events        │
│                                         RPC bulk_archive_work_orders()   │
│                                         work_orders already in           │
│                                         supabase_realtime publication    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities (new vs modified)

| Component | New / Modified | Responsibility |
|-----------|----------------|----------------|
| `supabase/migrations/089_work_order_archive.sql` | **NEW** | Add `archived_at TIMESTAMPTZ`, `archived_by UUID`, partial index, and audited `bulk_archive_work_orders()` RPC |
| `apps/api/routers/work_orders.py` | **MODIFIED** | Add `POST /work-orders/bulk-archive` (+ optional `/bulk-unarchive`); add `.is_("archived_at","null")` default filter + `?archived=true` opt-in to `list_work_orders` |
| `apps/web/app/(dashboard)/engineering/work-orders/page.tsx` | **MODIFIED** | Multiselect + bulk "Archive" action; Realtime subscription block stays **as-is** |
| `apps/web/lib/api/engineering.ts` | **MODIFIED** | Add `bulkArchiveWorkOrders(ids)` client method |
| `apps/api/routers/billing.py` | **MODIFIED** | Add `PATCH /billing/cap` (self-serve `cap_cents`); optional `POST /billing/pause` + `/resume` |
| `apps/api/routers/webhooks.py` | **MODIFIED (maybe)** | Only if pause/resume needs a distinct handler — existing `subscription.updated` already maps `sub.status` (incl. `paused`) into `plan_status` |
| `apps/web/lib/api/billing.ts` | **MODIFIED** | Add `updateCap` / `pauseSubscription` client methods |
| `apps/web/app/(dashboard)/settings/billing/page.tsx` | **MODIFIED** | Cap editor + (optional) pause control; keep React Query pull model (no Realtime) |
| `supabase/migrations/090_billing_cap_audit.sql` | **NEW (optional)** | Only if a cap-change history/audit trail is required |

## Architectural Patterns

### Pattern 1: Archive as an orthogonal flag, NOT a new status

**What:** Add `archived_at TIMESTAMPTZ` (nullable) rather than adding `'archived'` to the `work_orders.status` CHECK constraint / state machine.

**Why:** `status` is governed by a CHECK constraint (migration 065: `open|escalated|in_progress|on_hold|completed|cancelled`), the `_ALLOWED_TRANSITIONS` graph in `services/work_orders/transitions.py`, the `Literal[...]` in `list_work_orders`, and the 5 Kanban columns. Archive is **orthogonal** to workflow state — you archive a WO that is *still* `completed` or `cancelled` to declutter the board. A flag keeps the entire state machine untouched (zero regression surface), whereas a new status value would ripple into transitions, columns, the drawer, and the escalation cron.

**Trade-off:** Every board query must remember to filter `archived_at IS NULL`. Mitigate with a partial index and by making the filter the default in one place (`list_work_orders`).

```sql
-- migration 089 (next free number; 088 is current max, no collision)
ALTER TABLE public.work_orders
  ADD COLUMN archived_at TIMESTAMPTZ,
  ADD COLUMN archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- keep the board's 5 status queries fast once archived rows accumulate
CREATE INDEX idx_work_orders_active_board
  ON public.work_orders (tenant_id, status)
  WHERE archived_at IS NULL;
```

### Pattern 2: Bulk-archive through an audited SECURITY DEFINER RPC

**What:** Mirror `transition_work_order_with_audit` — do the bulk UPDATE and the append-only `operational_audit_events` insert atomically inside one Postgres function, rather than issuing a bulk UPDATE + separate insert from Python.

**When:** Any controlled state change that must leave an audit trail. Archive qualifies (it hides operational records).

**Trade-off:** One more RPC to maintain, but it guarantees atomicity and consistency with the existing audit convention (append-only, `resource_type='work_order'`, `action='work_order.archived'`). Enforce in the RPC (or the router) that only **terminal** WOs (`completed`/`cancelled`) can be archived, so archiving can't hide live work.

```python
# work_orders.py — new endpoint, gated like the existing mutations
@router.post("/bulk-archive")
async def bulk_archive_work_orders(
    request: BulkArchiveRequest,  # { work_order_ids: list[str] }
    current_user: CurrentUser = Depends(require_role("engineer", "gm")),
):
    return {"data": supabase.rpc("bulk_archive_work_orders", {
        "p_tenant_id": current_user.hotel_id,
        "p_ids": request.work_order_ids,
        "p_actor_id": current_user.user_id,
        "p_actor_role": current_user.role,
    }).execute().data}
```

### Pattern 3: Self-serve billing = additive endpoints over the Stripe Customer Portal

**What:** The Customer Portal (`POST /billing/portal`, already live) is the escape hatch for payment method, cancellation, and Stripe-native plan changes. Only build first-party endpoints for controls the portal cannot express — chiefly the PatelRep **spending cap** (`subscriptions.cap_cents`, already a column, surfaced by `GET /billing/credits`).

**When:** Prefer portal for anything Stripe owns; build an endpoint only for PatelRep-domain billing state.

**Trade-off:** Keeps Stripe as source of truth and minimizes webhook surface. A `PATCH /billing/cap` writing `subscriptions.cap_cents` needs **no new migration** and no Stripe call.

```python
# billing.py — additive, same require_role("gm") gate as the rest of the router
@router.patch("/cap")
async def update_spend_cap(
    request: UpdateCapRequest,  # { cap_cents: int | null }
    current_user: CurrentUser = Depends(require_role("gm")),
):
    supabase.table("subscriptions").update({"cap_cents": request.cap_cents})\
        .eq("tenant_id", current_user.hotel_id).execute()
    return {"data": {"cap_cents": request.cap_cents}}
```

## Data Flow

### Bulk-archive flow (and why the Realtime board keeps working)

```
GM/engineer selects N completed/cancelled cards → "Archive"
   ↓
POST /v1/work-orders/bulk-archive { ids }  (require_role gate)
   ↓
RPC bulk_archive_work_orders: UPDATE work_orders SET archived_at=now()
   + INSERT operational_audit_events (action='work_order.archived')   [atomic]
   ↓
Postgres emits UPDATE events on work_orders (row now has archived_at != null)
   ↓
Board's wo_realtime channel (event:'*', filter:tenant_id=eq.<id>) fires
   → queryClient.invalidateQueries(['work-orders'])
   ↓
Board refetches all 5 columns via GET /work-orders?status=...
   → list_work_orders now returns .is_("archived_at","null") rows only
   ↓
Archived cards disappear from the board. Subscription never breaks.
```

### State management

- **Work Orders board:** React Query columns (`per_page:50`, `refetchInterval:60_000`) + a single Supabase Realtime channel (`wo_realtime`) that only **invalidates** — it does not render from the payload. This indirection is why archive "just works" once the API list query excludes archived rows.
- **Billing:** pure React Query pull (`staleTime: 5 * 60_000`, `refetchInterval: false`). No Realtime — correct; billing must stay off the 3 named Realtime surfaces.

## Integration Points

### Internal boundaries

| Boundary | Change | Notes |
|----------|--------|-------|
| `list_work_orders` (engineer path `_base()` **and** default query) | add `.is_("archived_at","null")` | **Both** code paths (engineer merge path ~lines 193–212 and default query ~228–247) must get the filter, plus an `?archived=true` opt-in for an "Archived" view/tab |
| `wo_realtime` subscription (page.tsx ~254–266) | **NO CHANGE** | Leave `event:'*'`, `filter:tenant_id=eq.<id>`. See anti-pattern below |
| `operational_audit_events` | new `action='work_order.archived'` rows | Append-only trigger already enforced (migration 065); write via the new RPC |
| `work_orders` publication | **NO CHANGE** | Already added to `supabase_realtime` (migration 030); adding a column does not require re-publishing |
| RLS on `work_orders` | **NO CHANGE** | Row-level tenant policy already covers the new columns |
| `subscriptions.cap_cents` | write path via new `PATCH /billing/cap` | Column already exists; read path already in `GET /billing/credits` |
| `stripe_webhook` | optional | `subscription.updated` already writes `sub.status` → `plan_status` (type already includes `paused`); only add a branch if pause/resume needs bespoke handling |

### External services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Stripe | Customer Portal + webhooks (existing) | Prefer portal for payment/cancel/plan; new first-party endpoints only for `cap_cents`. **Cannot be E2E-tested locally** — no Stripe keys in the local env (per CLAUDE.md). Flag billing paths as verification-limited |
| Supabase Realtime | existing `supabase_realtime` publication | No new surface added; reuses the one Engineering board channel |

## Anti-Patterns

### Anti-Pattern 1: Adding `archived_at` to the Realtime subscription filter

**What people do:** "Archived rows shouldn't be on the board, so filter them out of the subscription too" → change the `postgres_changes` filter to `tenant_id=eq.<id>&archived_at=is.null`.

**Why it's wrong:** The archive UPDATE sets `archived_at` to a **non-null** value. A Realtime filter of `archived_at=is.null` matches on the row's *new* values, so the very UPDATE that should tell the board to drop the card gets **suppressed**. The card would linger until the 60s `refetchInterval` backstop fires. The subscription is a dumb invalidator; keep it broad (`tenant_id` only) and do the filtering in the REST list query.

**Do this instead:** Leave the subscription untouched; add `.is_("archived_at","null")` to `list_work_orders`.

### Anti-Pattern 2: Making `archived` a work-order status

**What people do:** Add `'archived'` to the status CHECK / state machine.

**Why it's wrong:** Couples an orthogonal display concern to the workflow engine — forces edits to `transitions.py`, the Kanban columns, the drawer, and the escalation cron, and loses the "it's still completed/cancelled" semantics. Large regression surface on a Realtime-critical screen.

**Do this instead:** Orthogonal `archived_at` flag (Pattern 1).

### Anti-Pattern 3: Re-implementing payment/cancel flows first-party

**What people do:** Build custom endpoints for card updates or cancellation.

**Why it's wrong:** Duplicates the Stripe Customer Portal that already ships, and pulls PCI-adjacent surface into the app. Build first-party endpoints only for PatelRep-owned state (the spend cap).

## Build Order

**Billing and bulk-archive are independent** — different routers (`billing.py` vs `work_orders.py`), different tables (`subscriptions`/`credit_ledger` vs `work_orders`), no shared migration, no shared component. They can be **two parallel phases** with no ordering dependency.

If serialized, recommended order and reasoning:

1. **Bulk-archive first.** Self-contained (one migration + one RPC + one endpoint + one list-filter line + board UI), no external-service dependency, and **fully verifiable on localhost** against the dev servers + Supabase. It also touches the Realtime-subscribed board, so front-loading it gives the most time for non-regression testing of the Engineering board's golden path.
2. **Self-serve billing second.** Mostly additive over the existing Stripe spine; the cap endpoint needs no migration. **Caveat:** the local env has **no Stripe keys**, so checkout/portal/webhook paths **cannot be exercised end-to-end locally** — verification is limited to the `cap_cents` DB path and UI rendering. This makes billing the weaker candidate to "prove working on localhost," which is another reason to sequence it after the fully-testable archive work.

Either phase can also proceed in parallel with the other since they never touch the same files.

## Sources

- `apps/api/routers/billing.py`, `apps/api/routers/webhooks.py`, `apps/api/routers/work_orders.py`, `apps/api/routers/internal.py` (verified 2026-08-03)
- `apps/api/services/work_orders/transitions.py`
- `apps/web/app/(dashboard)/engineering/work-orders/page.tsx` (Realtime subscription lines ~254–266)
- `apps/web/app/(dashboard)/settings/billing/page.tsx`, `apps/web/lib/api/billing.ts`
- `supabase/migrations/007_work_orders.sql`, `030_enable_realtime_work_orders.sql`, `065_work_order_transition_audit.sql`; migration ceiling confirmed at 088
- Project conventions: root `CLAUDE.md` (Realtime restricted to 3 surfaces; no ORM; flat routers; append-only audit; sequential migrations; no local Stripe/AI credentials)

---
*Architecture research for: PatelRep billing-management + work-order bulk-archive integration*
*Researched: 2026-08-03*
