# Stack Research

**Domain:** Self-serve subscription billing (Stripe) + bulk-archive UI for an existing FastAPI + Next.js 16 multi-tenant SaaS
**Researched:** 2026-08-03
**Confidence:** HIGH (existing code inspected directly; Stripe API-version behavior verified against official changelog)

> Scope: this milestone **extends** an already-integrated Stripe billing stack and an already-built
> work-order state machine. The headline finding is that **almost no new libraries are needed** — the
> real work is (a) a webhook data-shape fix forced by Stripe's API version, (b) credit-ledger period
> rollover, (c) finishing the already-wired Customer Portal UI, and (d) an additive `archived_at`
> column + bulk endpoint + selection UI built from primitives already in the tree. Adding new payment
> UI libraries here would be a mistake — see [What NOT to Use](#what-not-to-use).

---

## TL;DR Recommendations

| Question | Answer |
|----------|--------|
| Customer Portal vs custom Elements/Checkout UI? | **Stripe Customer Portal** (hosted). Already used in `billing.py::create_portal_session`. Do not add Stripe Elements. |
| New Stripe product/price model needed? | **No new catalog required.** One persistent recurring Price is a nice-to-have over the current inline `price_data`, but the single-plan + usage-overage model already works. |
| New frontend billing libs (`@stripe/stripe-js`, `@stripe/react-stripe-js`)? | **No.** Portal + Checkout are redirect flows; the browser never touches card data. |
| New frontend libs for bulk-select? | **No.** React `Set` state + checkboxes + React Query mutation. No data-grid dependency. |
| Root cause of "period display goes stale after period end"? | **Stripe API version.** `stripe==15.4.0` pins a 2026 Dahlia API version; `current_period_start/end` no longer exist on the Subscription object — they moved to subscription **items**. `webhooks.py` reads them via `getattr(sub, ..., None)` → writes `NULL`. |

---

## Recommended Stack

### Core Technologies (already installed — keep, do not change)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `stripe` (Python SDK) | **15.4.0** (installed) | Server-side Stripe API: Customer Portal sessions, Checkout, invoices, InvoiceItem overage, webhook signature verification | Current stable line (15.x is latest as of 2026). Already the app's billing engine. Pins API version `2026-xx.dahlia` — **this version pin is load-bearing** (see [Version Compatibility](#version-compatibility)). |
| Stripe **Customer Portal** (`billing_portal.Session`) | API feature (no separate package) | Hosted self-serve: update payment method, view/download invoices, cancel/renew, (optional) switch plans | Zero card data in your UI → **no PCI-DSS SAQ-A scope, no `@stripe/stripe-js` needed**. Only call is `Session.create` → trivially mockable with no local Stripe creds. Already implemented backend + already wired on `settings/billing`. |
| Stripe **Checkout** (`checkout.Session`) | API feature | Hosted trial→paid upgrade flow | Same hosted/redirect benefit as Portal. Already implemented in `billing.py::create_checkout_session`. |
| FastAPI + Supabase Python SDK | existing | `billing.py`, `webhooks.py`, `internal.py` monthly true-up, new bulk-archive endpoint | No ORM; tenant-scoped `.eq("tenant_id", …)` / `.eq("hotel_id", …)` per repo convention. |
| Next.js App Router | **16.3.0-preview.10** (installed) | Billing page + Engineering work-order list/bulk-archive UI | Note: this repo is on the **Next 16 preview** — read `node_modules/next/dist/docs/` before writing app code (per `apps/web/AGENTS.md`); training-data Next patterns may be stale. |
| React | 18.3.1 | Client components | Bulk-select state lives in a client component (`'use client'`). |
| `@tanstack/react-query` | 5.101.4 | Server-state + mutations for portal/checkout/bulk-archive | Already the data layer on both billing pages. Bulk-archive = one `useMutation` + `invalidateQueries`. |
| Zustand | 5.0.14 | Auth/hotel/engineering stores | No billing store needed; billing is React Query only. |
| `date-fns` | installed | Period/invoice date formatting | Already used on both billing pages. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `stripe-mock` (Stripe's official mock HTTP server) | Docker image `stripe/stripe-mock` (latest) | Local/CI integration tests against a realistic Stripe API without live keys | Optional. Useful if you want end-to-end request coverage of Portal/Checkout session creation. For most cases, monkeypatching (below) is lighter. |
| `pytest` monkeypatch / fixtures | existing (`pytest`) | Mock `stripe.billing_portal.Session.create`, `stripe.checkout.Session.create`, `stripe.Webhook.construct_event`, `stripe.InvoiceItem.create` | **Primary testing strategy** — no local Stripe creds exist, so all billing paths must be fixture-driven. Follow the existing pattern in `apps/api/tests/smoke/test_webhooks_and_transitions.py`. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Stripe Dashboard (Test mode) | Configure Customer Portal features (payment-method update, invoice history, cancellation); optionally create the persistent $99 recurring Price | **Config, not code.** Portal behavior (what the customer can do) is set in the Dashboard, versioned per-environment. Plan-switching in the portal requires listed Prices — not needed for the current single-plan model. |
| Stripe CLI (`stripe listen` / `stripe trigger`) | Replay webhook events with valid signatures | Requires a Stripe account/login; **not usable in the credential-less local env**. Reserve for a Dashboard-connected environment; locally rely on `construct_event` monkeypatch. |

## Installation

```bash
# NOTHING new is required for the core milestone.
# Python billing SDK is already present:
#   apps/api/requirements.txt  ->  stripe==15.4.0

# Optional test tooling (only if you want realistic API mocking beyond monkeypatch):
docker run --rm -it -p 12111:12111 stripe/stripe-mock   # stripe-mock server

# Frontend: DO NOT install these — see "What NOT to Use":
#   npm install @stripe/stripe-js @stripe/react-stripe-js   # ← NOT needed
```

## Integration Points With Existing Code

### Billing — what already exists (do not rebuild)

| Concern | Existing implementation | Milestone action |
|---------|------------------------|------------------|
| Self-serve manage (payment method, cancel, invoices) | `billing.py::create_portal_session` → `stripe.billing_portal.Session.create` | **Already done.** Surface it in the UI (below). |
| Trial → paid | `billing.py::create_checkout_session` | Already done; consider named Price (nice-to-have). |
| Invoices list | `billing.py::list_invoices` | Already done; shown on `settings/billing`. |
| Usage/credits display | `billing.py::get_credits` (reads `credit_ledger` where `period_start <= today <= period_end`) | **Fix rollover** (below). |
| Webhook sync | `webhooks.py::stripe_webhook` (subscription created/updated/deleted, checkout.completed, invoice.paid/payment_failed) | **Fix period extraction** (below). |
| Monthly overage true-up | `internal.py::monthly_trueup` → `stripe.InvoiceItem.create` | Depends on the ledger row existing for the current period — see rollover. |

### Billing — the two real bugs this milestone must fix

**1. Period fields are `NULL` because of the pinned Stripe API version (root cause of "stale after period end").**
`webhooks.py` (lines ~152–154) does:
```python
"current_period_start": _ts(getattr(sub, "current_period_start", None)),
"current_period_end":   _ts(getattr(sub, "current_period_end", None)),
```
Under the Dahlia API version pinned by `stripe==15.4.0` (post-Basil, 2025-03-31), **`current_period_start`/`current_period_end` no longer exist on the Subscription object** — they moved to each subscription **item**. `getattr(..., None)` therefore silently writes `NULL`, so `subscriptions.current_period_start/end` never advance and the UI period label goes blank/stale. Fix: read from the item, e.g. `sub["items"]["data"][0]["current_period_start"]` (and `..._end`). This is a **data-shape fix, not a library change** — it is the highest-value change in the milestone.

**2. `credit_ledger` has no current-period row after rollover.**
`get_credits` returns `{"message": "No billing period found"}` when no ledger row spans `today`. Nothing currently **creates** the new-period ledger row when the billing period advances. Add ledger-row creation keyed off the (now-correctly-populated) period boundary — either in the `customer.subscription.updated` webhook branch (when `current_period_start` changes) or as an idempotent upsert at the start of `monthly_trueup` / `get_credits`. This closes the loop with fix #1: once period dates are correct, the rollover logic has something reliable to key on.

### Billing — the UI gap (the "Coming soon" placeholder)

There are **two** billing pages:
- `app/(dashboard)/settings/billing/page.tsx` — **already fully wired**: "Manage Billing" → `billingApi.createPortalSession()`, "Upgrade Plan" → `createCheckoutSession()`, invoices table.
- `app/(dashboard)/billing/page.tsx` — the **stale** page with the disabled `Manage Subscription (Coming soon)` button and no invoices.

Recommendation: **consolidate to the `settings/billing` page** (redirect or delete the older `(dashboard)/billing` page) rather than re-implementing the portal button twice. Self-serve is achieved purely by the existing portal redirect — **no new frontend billing library**.

### Work-order bulk-archive — additive, no schema rewrite

| Layer | Recommendation |
|-------|----------------|
| Schema | New migration adding `archived_at TIMESTAMPTZ NULL` to `work_orders` (soft-archive, reversible). Partial index `WHERE archived_at IS NULL` to keep the default list fast. **Distinct from the existing hard `DELETE`** in `delete_work_order` — archive is reversible and audit-friendly. |
| List filter | Extend `list_work_orders` to exclude `archived_at IS NOT NULL` by default; add an `archived: bool` / `include_archived` query param for an "Archived" view. Preserve the existing engineer two-query merge path. |
| Bulk endpoint | New `POST /work-orders/bulk-archive` (and `/bulk-unarchive`) taking `{ ids: UUID[] }`, `require_role("gm", "chief_engineer")`, tenant-scoped `.in_("id", ids).eq("tenant_id", …)`. Write one audit event per WO through the **existing append-only audit path** (`operational_audit_events` / the `transition_work_order_with_audit` RPC pattern) so archive is traceable like every other WO change. |
| Frontend | Client component holding `Set<string>` of selected IDs; header/row checkboxes; a contextual bulk-action bar; one React Query `useMutation` → `invalidateQueries(['work-orders'])`. **No table/grid library.** |

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Stripe **Customer Portal** (hosted) | Custom UI with **Stripe Elements** + `@stripe/react-stripe-js` (build your own payment-method form, plan picker) | Only if you needed deeply branded in-app card capture or flows the portal can't express (e.g., complex multi-tier upgrade UX embedded mid-app). This app has **one plan + usage overage** and **no local card-handling requirement** → Elements is pure cost (PCI scope, more code, more to mock). Not justified. |
| Reuse existing **inline `price_data`** Checkout, add persistent Price only if convenient | Create a full **Product/Price catalog** with multiple tiers | Only when you introduce real plan tiers the customer can switch between in the portal (portal plan-switching requires *listed* Prices; inline ad-hoc prices can't be switch targets). Today there is one plan, so a catalog is premature. |
| `archived_at` **soft-archive column** | Separate `work_orders_archive` table / status value `archived` | A dedicated status collides with the state-machine `CHECK` constraint and the `transition_*` RPC semantics; a separate table complicates the tenant-scoped list joins. A nullable timestamp is the least-invasive, reversible option. |
| React `Set` state for selection | `@tanstack/react-table` (row selection model) | Only if the WO list grows into a full data-grid (column sorting/resizing/virtualized selection). For a bulk-archive checkbox flow it is over-engineering. |
| `pytest` monkeypatch of `stripe.*` | `stripe-mock` server | Use `stripe-mock` when you want realistic request/response validation in CI; monkeypatch when you just need to assert your code calls Stripe correctly and handles the returned shape. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@stripe/stripe-js` / `@stripe/react-stripe-js` (Elements) | Pulls card handling into your SPA → PCI-DSS SAQ-A-EP scope, more code, and (critically) **can't be exercised locally with no Stripe creds**. The hosted Portal/Checkout redirect flows need none of it. | Existing hosted **Customer Portal + Checkout** redirects. |
| A new multi-tier **Product/Price catalog** | Single-plan pricing ($99 + $0.02/credit overage capped at $2.50/room/mo) doesn't need switchable Prices; a catalog adds config and webhook surface for zero user value now. | Keep single plan; overage stays as `InvoiceItem` on true-up. Add one named recurring Price only if you want cleaner portal/subscription objects. |
| Reading `subscription.current_period_start/end` (top-level) | **Removed** in Stripe Basil (2025-03-31) and the pinned Dahlia API version — silently returns `None` → the exact stale-period bug. | Read `subscription.items.data[i].current_period_start/end`. |
| Hard `DELETE` for the new "archive" action | Existing `delete_work_order` cascades and destroys audit history; archive must be reversible and traceable. | `archived_at` soft-archive + append-only audit event. |
| A client-side `useState` **array** for bulk selection with `.includes()`/`.filter()` | O(n) membership checks and awkward toggle logic on large WO lists | `Set<string>` with `.has()/.add()/.delete()` (immutable copy on update). |
| Downgrading/unpinning `stripe` to "fix" the None period fields | The version pin isn't the bug; **the code reads the wrong path**. Downgrading to a pre-Basil API version reintroduces other deprecations. | Fix the read path; keep `stripe==15.4.0`. |

## Stack Patterns by Variant

**If the portal must let GMs change plans (future multi-tier):**
- Create persistent Products/Prices in the Dashboard and enable "switch plans" in the Portal configuration.
- Because portal plan-switching cannot target inline `price_data` prices.

**If you only need payment-method update + cancel + invoices (current reality):**
- Ship the existing `create_portal_session` redirect as-is; configure the Portal in the Dashboard to expose only those actions.
- Because it's the minimum surface, fully testable via a single mocked `Session.create`.

**If CI needs realistic Stripe behavior:**
- Add `stripe-mock` as a service container.
- Otherwise monkeypatch — because no live keys exist locally and unit-level mocking is faster.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `stripe==15.4.0` | Pinned API version `2026-xx.dahlia` (post-Basil) | **Load-bearing pin.** Subscription billing periods live on `items.data[].current_period_*`, not the top-level object. Any code (webhooks, period display, rollover) reading the old fields must be updated. |
| Next.js `16.3.0-preview.10` | React `18.3.1`, React Query `5.101.4` | Preview build — consult `node_modules/next/dist/docs/` before writing App Router code; do not assume training-data Next 14/15 conventions. Bulk-select UI is plain client-component React, unaffected. |
| Supabase Python SDK | Postgres migrations (`archived_at` column, partial index) | Soft-archive is a plain nullable column; no RLS policy change required if existing WO policies already scope by `tenant_id` (verify the new column isn't filtered out by a column-level policy). |

## Sources

- `apps/api/routers/billing.py`, `webhooks.py`, `internal.py`, `work_orders.py`; `apps/web/app/(dashboard)/(settings/)billing/page.tsx`; `supabase/migrations/007_work_orders.sql`; `apps/api/requirements.txt`; `apps/web/package.json` — direct code inspection (HIGH).
- [Stripe changelog: deprecate subscription current_period_start/end (Basil 2025-03-31)](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end) — confirms fields moved to subscription items (HIGH).
- ["Stripe Basil Quietly Moved current_period_end Off Subscription" (dev.to)](https://dev.to/flarecanary/stripe-basil-quietly-moved-currentperiodend-off-subscription-and-a-lot-of-code-broke-3eo7) — corroborates real-world breakage pattern (MEDIUM).
- [stripe-python releases / CHANGELOG (GitHub)](https://github.com/stripe/stripe-python/releases) — confirms 15.x is current line and pins a 2026 Dahlia API version (MEDIUM).
- [Stripe customer management / portal docs](https://docs.stripe.com/customer-management) — hosted portal capabilities: payment method, invoices, cancellation, plan switching config (MEDIUM).

---
*Stack research for: self-serve Stripe billing management + work-order bulk-archive (PatelRep)*
*Researched: 2026-08-03*
