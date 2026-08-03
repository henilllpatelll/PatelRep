# Feature Research

**Domain:** B2B hotel-ops SaaS — self-serve billing management + bulk-archive for Engineering work orders
**Researched:** 2026-08-03
**Confidence:** HIGH (both capabilities grounded in existing PatelRep code; Stripe portal behavior verified against current Stripe docs)

> Scope note: This file covers only the two NEW capabilities. It is deliberately opinionated and tied to PatelRep's actual constraints (Stripe Customer Portal already partially wired, work-order state machine + append-only `operational_audit_events`, tenant isolation via `hotel_id`, `$2.50/room/month` cap, and NO live Stripe credentials for local testing).

---

## Capability A — Self-Serve Billing Management

### What already exists (do not rebuild)

- `POST /billing/portal` already creates a **Stripe Customer Portal** session (`billing.py:64`). The portal is Stripe-hosted and — per current Stripe docs (2026) — handles **plan switch, payment-method update/replace, and invoice history** with zero custom UI when configured. The web page shows "Coming soon"; the backend is effectively done.
- `POST /billing/checkout` handles trial → paid upgrade.
- `GET /billing/invoices` lists last 10 Stripe invoices (with `hosted_invoice_url`).
- `GET /billing/credits` returns current-period AI-credit usage — but reads a single `credit_ledger` row matched by `period_start <= today <= period_end`. When the period rolls over and no new ledger row is inserted, this returns stale/empty data. **This is the real work in this capability, not the plan/payment UI.**
- Stripe webhook (`webhooks.py:129`) already syncs `plan_status`, `current_period_start/end`, and stamps `stripe_invoice_id` on `invoice.paid`.

### Key architectural decision (drives everything below)

**Lean on the Stripe Customer Portal for plan change + payment method. Build custom UI ONLY for the AI-credit usage/cost display** (metered `$0.02/credit`, `$2.50/room/month` cap) — Stripe's portal has no concept of PatelRep's per-room cap or credit ledger. Building a custom plan-picker or card-entry form is an anti-feature here (PCI scope, duplicated proration logic, untestable without live keys).

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Working "Manage subscription" button → Stripe portal | Every B2B SaaS lets the billing owner change plan / card without emailing support | **LOW** | Backend `/billing/portal` exists; wire the web button, replace "Coming soon", set return_url. Configure the portal in Stripe Dashboard (enable plan switching + payment-method update). |
| Update / replace payment method | GM's corporate card expires; must self-serve or churn | **LOW** | Delivered entirely by the Stripe portal. No custom card form. |
| Accurate **current-period** AI-credit usage + cost | The whole meter is `$0.02/credit`; a stale number erodes trust in every invoice | **MEDIUM** | Root cause is ledger rollforward: guarantee a `credit_ledger` row exists for today's period. Drive off `customer.subscription.updated`/`invoice.paid` webhook (already firing) or the existing APScheduler cron. `UNIQUE(tenant_id, period_start)` makes an idempotent upsert safe. |
| Show the `$2.50/room/month` cap and remaining headroom | Cap is the core pricing promise; GM needs to see they won't be surprise-billed | **LOW** | `cap_cents` already on `subscriptions`; already returned by `/billing/credits`. Surface it as a progress/gauge against `overage_cost_cents`. |
| Invoice history with hosted PDF links | Accounting / expense reconciliation is non-negotiable in B2B | **LOW** | `/billing/invoices` already returns `hosted_invoice_url`. Render as a list. |
| Current plan + status badge (trialing / active / past_due) | GM must know if they're in trial, paid, or delinquent | **LOW** | `plan_status` already synced by webhook. |
| Past-due / payment-failed banner | Silent dunning = involuntary churn; user must be told to fix their card | **MEDIUM** | `invoice.payment_failed` already sets `plan_status='past_due'`. Add a dashboard banner deep-linking to the portal. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Live "credits used / included / projected month-end cost" gauge | Most SMB SaaS shows usage only on the invoice after the fact; showing it live against the room-cap is a trust signal unique to metered AI pricing | **MEDIUM** | Reuse `/billing/credits` data; add linear projection `used/day_of_period * days_in_period`. Pure client math, no new backend. |
| Cap-approaching alert (e.g. 80% of `$2.50/room` cap) | Turns a billing surprise into a proactive heads-up; reinforces the "we cap your spend" promise | **MEDIUM** | Threshold check in the existing daily cron; in-app notification (notifications domain already exists). |
| Per-period usage breakdown (credits by AI feature) | Lets GM see WHERE credits go (triage vs SOP RAG vs onboarding) | **HIGH** | Requires attributing `credits_used` by feature at write time in the credits middleware; defer past this milestone. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Custom in-app plan picker + card-entry form | "Looks more integrated / on-brand" | Pulls PCI scope into PatelRep, duplicates Stripe proration/tax/dunning, must be re-tested on every Stripe change — and CANNOT be tested locally (no Stripe keys) | Stripe Customer Portal (already wired). One button. |
| In-app proration preview / "what will I be charged" calculator | GM wants certainty before switching plans | Reimplements Stripe's proration engine; drifts from actual billing; high bug surface | Stripe portal shows proration at switch time natively. |
| Self-serve cancellation with retention offers | "Standard SaaS" | Retention discounts touch pricing integrity; a hotel-ops tool churns via an account manager, not a coupon wizard | Enable/disable cancellation in the portal config; handle saves human-to-human. |
| Storing card/PAN or full billing address in Supabase | "So we can display it" | Massive compliance liability; Stripe already holds it | Display only Stripe's `card.last4`/brand via the portal; never persist PAN. |
| Usage display that reads live Stripe metered-usage records | Seems "most accurate" | PatelRep's credit meter is internal (`credit_ledger`), not Stripe metered billing; adds a round-trip and a second source of truth | Keep `credit_ledger` as the single source; Stripe only invoices the finalized overage. |

### Dependency on existing systems (called out explicitly)

- **Stripe integration:** `/billing/portal`, `/billing/checkout`, `/billing/invoices` exist; requires the Stripe **Dashboard portal configuration** to actually expose plan-switch + payment-method (a config step, not code). Cannot be exercised end-to-end locally — **no live Stripe keys in the local env** (flag for QA: test with a Stripe test-mode key or in staging).
- **Credit ledger rollforward:** the usage-accuracy fix depends on `credit_ledger` (migration 014) + the Stripe webhook (`webhooks.py`) and/or the APScheduler cron. The `overage_*` columns are GENERATED — never write them; only write `credits_used` / period boundaries.
- **Webhook idempotency:** rollforward upsert must be idempotent against `UNIQUE(tenant_id, period_start)` because Stripe retries webhooks.
- **Role gate:** all billing routes already `require_role("gm")` — keep GM as the sole billing owner.

---

## Capability B — Bulk-Archive for Engineering Work Orders

### What already exists (do not rebuild)

- Work-order **state machine** (`transitions.py`): `open → escalated → in_progress → on_hold → completed → cancelled`, with `completed`/`cancelled` as terminal states (each only reopens to `open`).
- **Append-only audit** via `operational_audit_events` (migration 065) + `transition_work_order_with_audit()` RPC. A DB trigger *hard-blocks* UPDATE/DELETE on audit rows.
- `GET /work_orders` list with `status`/`category`/`priority`/`assigned_to`/`room_id` filters + pagination; `PATCH /{wo_id}` explicitly **rejects** status changes (forces the transition endpoint).
- Management roles: `gm` + `engineer` (migration 064 merged `chief_engineer` into `engineer`; `_MANAGEMENT_ROLES` in `transitions.py`).

### Key architectural decision (drives everything below)

**Archive is an ORTHOGONAL flag, not a new status value.** Add `archived_at TIMESTAMPTZ` (nullable) to `work_orders` — do NOT add `'archived'` to the `status` CHECK constraint. Status answers "what operational state is this work?"; archive answers "should this still show in the active list?". A completed WO stays `completed` forever; archiving only hides it. This mirrors the codebase's soft-delete / evidence-preservation philosophy (Lost & Found "permanently deletable only via explicit cascade", audit-first everywhere).

### What users assume "archive" vs "delete" means (verified pattern)

- **Archive** = "get it out of my active view, but I can still find it and its history is intact." Reversible. The default in audit-sensitive B2B tools.
- **Delete** = "gone." In this codebase, delete of an operational record is essentially never offered because it would sever the `operational_audit_events` trail. Bulk-archive must NEVER cascade-delete audit rows.

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Multi-select of work orders (checkboxes + "select all on page") | Bulk anything requires selection; managers won't archive 200 closed WOs one at a time | **LOW** | Web-only UI state; a selected set of `wo_id`s. |
| Archive only **terminal** WOs (completed / cancelled) | Archiving an open/in-progress WO would hide live work — a footgun | **LOW** | Server-side guard: reject archive if `status NOT IN ('completed','cancelled')`. Grey out non-terminal rows in the UI. |
| Default active view **excludes** archived | The entire point is decluttering the active board | **MEDIUM** | Add default `.is_("archived_at","null")` to the list query in BOTH the engineer two-query branch AND the manager branch (`work_orders.py:164`). Non-regression risk — must patch both paths. |
| "Archived" filter / tab to view archived WOs | Archive must be findable or it feels like deletion | **LOW** | New `include_archived` / `archived=true` query param on `GET /work_orders`. |
| Audit trail entry per archive (who / when / how many) | Every controlled operational change is audited in this app | **MEDIUM** | Insert `operational_audit_events` rows with `action='work_order.archived'`, `actor_id/role`, `source='web'` — inside a SECURITY DEFINER RPC like the transition RPC, one row per WO in the bulk call. |
| Unarchive (restore) | Archiving is reversible by definition; managers WILL mis-select | **LOW** | Set `archived_at = NULL`; audit `action='work_order.unarchived'`. |
| Management-only gate | Floor roles shouldn't reshape the board | **LOW** | Gate on `gm`/`engineer`, consistent with `_MANAGEMENT_ROLES` in `transitions.py`. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| One bulk-archive call = one atomic, fully-audited operation | Managers trust "archive 150 closed WOs" won't half-apply | **MEDIUM** | Single RPC looping the id set in a transaction; partial failure rolls back. Return a per-WO result summary. |
| Bulk-select by filter ("archive all completed older than 30 days") | Turns monthly board cleanup into one click | **MEDIUM** | Server-side selector by `status + completed_at < cutoff` instead of a client id list; still audited per WO. |
| Archived WOs still feed Reports / audit exports | Archive ≠ invisible to compliance / ROI reporting | **LOW** | Because it's a flag not a delete, reports simply query without the `archived_at IS NULL` filter. Free by design. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Bulk **delete** work orders | "Just clear the clutter permanently" | Severs `operational_audit_events` (append-only, trigger-protected); destroys the evidence trail the whole app is built on; likely illegal for safety/maintenance records | Bulk-archive (reversible flag). Never expose hard delete. |
| Adding `'archived'` to the `status` enum | "Simpler, one column" | Collapses two independent axes; breaks the state machine (archived AND completed?); every status filter/report must special-case it; corrupts audit `old_state/new_state` semantics | Orthogonal `archived_at` column. |
| Archiving non-terminal (open / in_progress) WOs | "I want to hide this too" | Hides live/assigned work from the floor; the SLA/escalation cron would act on invisible WOs | Restrict to `completed`/`cancelled`; to hide an active WO, `cancel` it first (audited state change). |
| Auto-archive on completion | "Keep the board clean automatically" | Managers lose the post-completion review window; QA/inspection often happens after "completed" | Manual bulk-archive; opt-in age-based auto-archive later. |
| Cascading the archive to child records (photos, audit events) | "Keep it tidy" | Would delete/hide evidence; audit rows are trigger-protected anyway | Archive is a single flag on the parent WO only. |

### Dependency on existing systems (called out explicitly)

- **Work-order state machine (`transitions.py`):** archive is independent of `_ALLOWED_TRANSITIONS`; do NOT route it through `validate_work_order_transition`. It needs its own guard (terminal-status check).
- **Append-only audit (`operational_audit_events`, migration 065):** archive/unarchive MUST write audit rows; the trigger blocks any mutate/delete of them, so no cascade risk — but the RPC must INSERT, never UPDATE audit rows.
- **List endpoint (`work_orders.py:164`):** the default-exclude filter must be added to BOTH the engineer dual-query branch and the manager branch — **primary non-regression hotspot.** Existing status/category filters must keep working alongside the new archived filter.
- **`PATCH /{wo_id}` guard:** it rejects `status` changes; archive should be dedicated endpoints (`POST /work_orders/bulk-archive` + `/bulk-unarchive`), not smuggled through PATCH.
- **Migration:** new `archived_at` column + partial index `WHERE archived_at IS NULL` to keep the active-list query fast (mirrors the `032_work_orders_unclaimed_index` pattern). Tenant isolation (`.eq("hotel_id"...)`) applies to every archive query.
- **Realtime:** Engineering Work Orders is one of the three Realtime surfaces (A2). Archiving flips `archived_at`, firing a Realtime UPDATE — clients must drop archived rows from the live board. Verify subscribers filter on `archived_at IS NULL`.

---

## Feature Dependencies

```
Self-serve billing management
    ├── Wire "Manage subscription" button ──requires──> existing /billing/portal (DONE)
    │                                         └──requires──> Stripe Dashboard portal config (plan switch + card)
    ├── Accurate usage display ──requires──> credit_ledger rollforward fix (webhook/cron upsert)
    │                             └──requires──> existing /billing/credits + cap_cents
    └── Cap-approaching alert ──enhances──> Accurate usage display
                                └──requires──> existing notifications domain + daily cron

Bulk-archive for work orders
    ├── archived_at column + partial index (migration) ──prerequisite-for──> everything below
    ├── Default active view excludes archived ──requires──> list-endpoint patch (BOTH branches)
    ├── Bulk-archive RPC (atomic + audited) ──requires──> operational_audit_events (DONE)
    │                                         └──requires──> terminal-status guard
    ├── Archived filter/tab ──requires──> include_archived query param
    ├── Unarchive ──requires──> Bulk-archive RPC
    └── Realtime board drop ──requires──> archived_at + subscriber filter update

Archive ──conflicts──> adding 'archived' to status enum (mutually exclusive designs)
Bulk-archive ──conflicts──> bulk-delete (never coexist; delete breaks audit)
```

### Dependency Notes

- **Usage-display accuracy requires the rollforward fix, not new UI.** The visible symptom (stale number) is a data-lifecycle bug; the plan/payment "management" pieces are already handled by Stripe's portal.
- **The `archived_at` migration gates the whole archive capability** — column + partial index land first, then endpoint, then UI.
- **The list-endpoint patch is the highest non-regression risk** because it touches the shared work-order query used by every engineering surface (web + mobile) across two code paths.

---

## MVP Definition

### Launch With (v1)

- [ ] Wire web "Manage subscription" button to existing `/billing/portal`; remove "Coming soon" — unblocks plan change + payment method with ~zero backend work
- [ ] Configure the Stripe Customer Portal (Dashboard) to expose plan switch + payment-method update
- [ ] Fix `credit_ledger` rollforward so `/billing/credits` always reflects the current period (idempotent upsert on period boundary)
- [ ] Surface current-period usage + `$2.50/room` cap + remaining headroom in the billing page
- [ ] `archived_at` column + partial index migration for `work_orders`
- [ ] `POST /work_orders/bulk-archive` (terminal-status guarded, audited, atomic) + `bulk-unarchive`
- [ ] Default active list excludes archived (patch BOTH list branches) + "Archived" filter/tab
- [ ] Multi-select UI on the work-orders board (management-gated)
- [ ] Past-due banner deep-linking to the portal

### Add After Validation (v1.x)

- [ ] Live projected month-end cost gauge — once base usage display is trusted
- [ ] Cap-approaching (80%) proactive alert via existing cron + notifications
- [ ] Server-side bulk-select ("archive all completed older than N days")

### Future Consideration (v2+)

- [ ] Per-feature AI-credit breakdown (requires attribution at credit-write time)
- [ ] Opt-in auto-archive after configurable age
- [ ] Add-on credit-pack self-purchase (`credits_purchased` column already exists)

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Wire portal button (plan + payment) | HIGH | LOW | P1 |
| credit_ledger rollforward + accurate usage display | HIGH | MEDIUM | P1 |
| Show cap + headroom | HIGH | LOW | P1 |
| `archived_at` migration + bulk-archive RPC (audited) | HIGH | MEDIUM | P1 |
| Default view excludes archived + Archived tab | HIGH | MEDIUM | P1 |
| Multi-select UI (management-gated) | HIGH | LOW | P1 |
| Unarchive / restore | MEDIUM | LOW | P1 |
| Past-due banner | MEDIUM | MEDIUM | P2 |
| Projected month-end cost gauge | MEDIUM | MEDIUM | P2 |
| Cap-approaching alert | MEDIUM | MEDIUM | P2 |
| Server-side bulk-select by age | MEDIUM | MEDIUM | P2 |
| Per-feature credit breakdown | LOW | HIGH | P3 |
| Custom plan picker / card form | NEGATIVE | HIGH | **Do not build** |
| Bulk delete work orders | NEGATIVE | LOW | **Do not build** |

**Priority key:** P1 = must have for this milestone · P2 = add after validation · P3 = future

---

## Competitor Feature Analysis

| Feature | Typical SMB SaaS (Stripe-portal-based) | Ops/ticketing tools (Jira/ServiceNow-style) | Our Approach |
|---------|----------------------------------------|---------------------------------------------|--------------|
| Plan change / payment method | Redirect to Stripe/Chargebee hosted portal | N/A | Stripe Customer Portal (already wired) — no custom UI |
| Metered usage display | Shown on invoice; some show a live meter | N/A | Custom live meter vs internal `credit_ledger` + per-room cap (unique to our pricing) |
| Archive vs delete | — | Bulk close/archive, soft-hide, audit retained; hard delete admin-gated or absent | Bulk-archive via orthogonal `archived_at` flag; NO hard delete; audit always preserved |
| Bulk operations | — | Multi-select + bulk transition/archive on closed items | Multi-select terminal WOs, atomic audited RPC, management-gated |

---

## Sources

- PatelRep codebase: `apps/api/routers/billing.py`, `apps/api/routers/webhooks.py`, `apps/api/routers/work_orders.py`, `apps/api/services/work_orders/transitions.py`, `supabase/migrations/014_billing.sql`, `supabase/migrations/065_work_order_transition_audit.sql`, `CLAUDE.md` (conventions A1–A4, pricing, roles) — HIGH confidence
- [Stripe — Introducing the Billing customer portal](https://stripe.com/blog/billing-customer-portal) — HIGH
- [Stripe Customer Portal: plan changes, pauses, cancellations without custom UI (OperatorIQ)](https://operatoriq.io/blog/stripe-customer-portal-plan-changes/) — MEDIUM
- [Stripe — Update a portal configuration (API reference)](https://stripe.com/docs/api/customer_portal/configurations/update) — HIGH
- [Stripe — Set payment methods per-subscription](https://docs.stripe.com/billing/subscriptions/payment-methods-setting) — HIGH

---
*Feature research for: self-serve billing management + bulk-archive work orders (PatelRep subsequent milestone)*
*Researched: 2026-08-03*
</content>
