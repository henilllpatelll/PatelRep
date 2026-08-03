# Project Research Summary

**Project:** PatelRep — self-serve billing management + bulk-archive for Engineering work orders
**Domain:** Additive milestone on an existing FastAPI + Next.js 16 multi-tenant hotel-ops SaaS (live Stripe billing + append-only audited work-order state machine)
**Researched:** 2026-08-03
**Confidence:** HIGH

## Executive Summary

This milestone is **not greenfield** — it extends two systems that already exist in production. Self-serve billing already has a working spine (Stripe Customer Portal, checkout, invoices, credits endpoint, monthly true-up cron, and a webhook sync handler); the bulk-archive capability sits on top of an existing work-order state machine with an append-only `operational_audit_events` audit trail and a Realtime-subscribed Engineering board. Across all four research files the headline is consistent: **almost no new libraries or greenfield architecture are required.** The real work is data-shape fixes, credit-ledger rollover, wiring already-built UI, and one additive `archived_at` column + audited bulk RPC + selection UI built from primitives already in the tree.

The recommended approach is deliberately minimalist and opinionated. For billing: lean entirely on the **Stripe hosted Customer Portal + Checkout** (redirect flows, zero card data in the SPA, no PCI scope) and build first-party endpoints only for PatelRep-owned state — chiefly the `cap_cents` spend cap and the `credit_ledger` period rollforward. Do **not** add Stripe.js/Elements, a custom plan picker, or a multi-tier price catalog. For archive: model it as an **orthogonal `archived_at` flag**, never a new `status` enum value, and route the bulk operation through a `SECURITY DEFINER` RPC that writes one audit row per work order atomically — mirroring the existing `transition_work_order_with_audit` pattern.

The dominant risk theme is **revenue integrity and "looks done but isn't"** — this app has a documented three-bug history (flat-cost billing, fake-success UI, undeployed migrations) that the pitfalls research explicitly maps every risk against. The biggest hazards: overage silently lost when a GM self-cancels mid-cycle; the month-end true-up cron firing 3–4 nights in a row with no idempotency guard (duplicate charges GMs will now see in the new invoice UI); bulk-archive bypassing the audit trail or leaking across tenants (IDOR via service-role RLS bypass); and migrations merged but never applied to the live Supabase project. Critically, **neither billing nor (fully) the live Realtime board can be exercised end-to-end locally** — there are no local Stripe keys — so verification must include Stripe-CLI replay and live-board testing as explicit phase-gate steps, not mocked happy paths.

## Key Findings

### Recommended Stack

Effectively **no new dependencies.** The Python `stripe==15.4.0` SDK, Stripe Customer Portal + Checkout (API features, not packages), FastAPI + Supabase Python SDK, Next.js 16 App Router, React Query, and a plain React `Set` for selection state cover everything. The single load-bearing detail is the pinned Stripe API version: `stripe==15.4.0` pins a post-Basil/Dahlia API version where `current_period_start/end` **no longer exist on the Subscription object** — they moved to subscription items. The current `webhooks.py` reads them via `getattr(sub, ...)` and silently writes `NULL`, which is the root cause of the "period display goes stale" bug. This is a data-shape fix, not a library change.

**Core technologies:**
- `stripe==15.4.0` (Python SDK) — Portal/Checkout sessions, InvoiceItem overage, webhook verification — already the billing engine; version pin is load-bearing (read period from `items.data[].current_period_*`)
- Stripe **Customer Portal + Checkout** (hosted redirects) — self-serve payment method / cancel / invoices — zero card data in the SPA, no PCI scope, no Stripe.js
- FastAPI + Supabase Python SDK (no ORM) — additive endpoints + audited RPC — tenant-scoped `.eq("hotel_id", …)` on every query
- React Query + plain React `Set<string>` state — bulk-select + mutations — no data-grid/table library needed
- `pytest` monkeypatch (primary) / optional `stripe-mock` — billing tests without live creds

**Explicitly do NOT add:** Stripe.js/react-stripe-js (Elements), a multi-tier Product/Price catalog, react-table, or a hard-`DELETE` archive path.

### Expected Features

Two capabilities. **Billing:** the "management" pieces (plan change, payment method) are already solved by the hosted portal — the real work is the credit-ledger accuracy fix. **Archive:** archive means "hide from the active board but keep findable + fully audited," never "delete."

**Must have (table stakes):**
- Wire the web "Manage subscription" button to the existing `/billing/portal` (remove "Coming soon") + configure the portal in the Stripe Dashboard
- Fix `credit_ledger` rollforward so `/billing/credits` always reflects the current period (idempotent upsert on `UNIQUE(tenant_id, period_start)`)
- Surface current-period usage + `$2.50/room` cap + remaining headroom; past-due banner deep-linking to portal
- `archived_at` column + partial index migration on `work_orders`
- `POST /work-orders/bulk-archive` + `/bulk-unarchive` — terminal-status-guarded, audited, atomic, management-gated
- Default active list excludes archived (patch **both** list branches) + "Archived" filter/tab
- Multi-select UI on the work-orders board

**Should have (competitive):**
- Live projected month-end cost gauge (client-side linear projection over `/billing/credits` data)
- Cap-approaching (80%) proactive alert via existing daily cron + notifications domain
- Server-side bulk-select ("archive all completed older than N days")

**Defer (v2+):**
- Per-feature AI-credit breakdown (needs attribution at credit-write time)
- Opt-in age-based auto-archive
- Add-on credit-pack self-purchase

**Do not build (anti-features):** custom in-app plan picker / card form, in-app proration calculator, storing PAN/card in Supabase, bulk **delete** of work orders, `'archived'` as a status value.

### Architecture Approach

Both capabilities are additive integrations that share **no router, table, or migration** — they are safe to build as independent parallel phases. Billing adds first-party endpoints only for controls the Stripe portal cannot express (the `cap_cents` spend cap; optional pause/resume) plus the ledger rollforward; likely no new migration for the cap itself (column exists). Bulk-archive needs one new migration adding `archived_at` (+ `archived_by`) + a partial index + an audited `bulk_archive_work_orders()` RPC, one new bulk endpoint, and one filter line added to the board's list query. The Realtime subscription must **not** be changed — it is a dumb invalidator; filtering happens in the REST list query.

**Major components:**
1. New migration (`archived_at`/`archived_by` + partial index `WHERE archived_at IS NULL` + `bulk_archive_work_orders()` RPC) — orthogonal archive flag, atomic audited bulk update
2. `work_orders.py` — new `POST /bulk-archive` (+ `/bulk-unarchive`), and `.is_("archived_at","null")` default filter added to **both** the engineer merge branch and the manager branch, plus `?archived=true` opt-in
3. `billing.py` + `webhooks.py` — `PATCH /billing/cap`, credit-ledger rollforward upsert, period-field extraction fix, entitlement sync on `subscription.updated`, cancel-time final true-up, webhook `event.id` dedupe
4. Web UI — engineering board multiselect + Archive action (Realtime block untouched); billing page cap editor + usage/cap gauge + past-due banner (React Query pull, no Realtime)

### Critical Pitfalls

1. **Overage lost on self-serve cancel** — the month-end true-up cron skips non-`active` subs, so overage accrued before a mid-cycle portal cancellation is billed $0. Run an immediate final true-up on `customer.subscription.deleted` before flipping `plan_status`.
2. **True-up cron not idempotent (fires 28th–31st)** — `InvoiceItem.create` has no idempotency key or "already invoiced" guard, producing 2–4 duplicate overage charges GMs will now see in the new invoice UI. Add a deterministic idempotency key **and** an `overage_invoiced_at` ledger stamp (idempotency window < cron window).
3. **Bulk-archive bypasses the audit trail** — a set-based `UPDATE ... WHERE id IN (...)` writes zero `operational_audit_events` rows (the append-only trigger only blocks mutation of audit rows, it does not compel a write). Use a `SECURITY DEFINER` RPC with `INSERT ... SELECT` one audit row per WO; test `count(audit) == count(archived)`.
4. **Cross-tenant archive (IDOR)** — the service-role Supabase client bypasses RLS, so a bulk `.in_("id", ids)` without a tenant filter lets a GM archive another hotel's WOs. Enforce `WHERE tenant_id = p_tenant_id` on every bulk write; return per-ID results.
5. **`archived` modeled as a status** — collides with the CHECK constraint, transition matrix, Kanban columns, and status-filtering crons. Use the orthogonal `archived_at` flag; only allow archiving terminal (`completed`/`cancelled`) WOs, enforced in the RPC.
6. **"Looks done but isn't" (no local Stripe creds; live Realtime board)** — mocked happy paths pass CI then 500 in prod. Bake `stripe listen`/`stripe trigger` replay + live-board testing into the Definition of Done, asserting resulting DB state.
7. **Migration merged but never applied to live Supabase** — the exact v1.2 failure. Make "verify each new column/RPC exists in the live project" an explicit closing phase gate.
8. **Entitlement drift + no webhook dedupe** — `subscription.updated` syncs only `plan_status`, not `credits_included`/`cap_cents`; and no `event.id` dedupe means retried events double-act once cancel-time invoicing is added.
9. **Realtime board flood / stale archived rows** — a bulk UPDATE fires N events; the board must filter `archived_at IS NULL` in the list query (not the subscription filter — that would suppress the very UPDATE that drops the card).
10. **Partial bulk failure reported as full success** — return an explicit `{archived:[...], skipped:[{id,reason}]}`, never the input length as the success count.

## Implications for Roadmap

Research strongly supports **two independent phases** (different routers, tables, migrations, components — no ordering dependency). If serialized, do archive first because it is fully verifiable on localhost; billing second because it is verification-limited without live Stripe keys.

### Phase 1: Work-Order Bulk-Archive
**Rationale:** Fully self-contained and **fully verifiable on localhost** (dev servers + Supabase). Touches the Realtime-subscribed Engineering board, so front-loading maximizes non-regression test time on a critical golden path.
**Delivers:** `archived_at` migration + partial index + audited `bulk_archive_work_orders()` RPC; `POST /bulk-archive` + `/bulk-unarchive`; list-query filter on both branches + Archived tab; multiselect board UI with confirm-and-count.
**Addresses:** multi-select, terminal-only archive, default-excludes-archived, archived filter, unarchive, per-archive audit (all P1 table stakes).
**Avoids:** Pitfalls 3 (audit bypass), 4 (`archived` as status), 5 (IDOR), 9 (Realtime flood/stale), 10 (partial-success).

### Phase 2: Self-Serve Billing Management
**Rationale:** Mostly additive over the existing Stripe spine; the cap endpoint needs no migration. Sequenced second because local env has **no Stripe keys** — checkout/portal/webhook/true-up paths cannot be exercised end-to-end locally, so it is the weaker "prove it on localhost" candidate.
**Delivers:** wired portal button + Dashboard portal config; `webhooks.py` period-extraction fix; credit-ledger rollforward upsert; `PATCH /billing/cap`; usage/cap/headroom gauge + past-due banner; entitlement sync + cancel-time true-up + true-up idempotency + webhook `event.id` dedupe.
**Uses:** existing `stripe==15.4.0`, hosted Portal/Checkout, React Query pull model.
**Implements:** `billing.py`/`webhooks.py` additive endpoints; new `overage_invoiced_at` ledger column (migration).
**Avoids:** Pitfalls 1 (cancel overage), 2 (true-up idempotency), 6 (fake-success), 8 (entitlement drift / dedupe), 11 (webhook dedupe).

### Phase Ordering Rationale
- **Independence:** the two features never touch the same files, tables, or migrations — they can run in parallel or in either order with no coupling.
- **Verifiability drives sequence:** archive is 100% localhost-testable; billing is credential-blocked locally, so it goes second (or runs in parallel with a staging Stripe test-mode account).
- **Migration hygiene:** both phases must end with a live-Supabase schema-existence gate. Next sequential migration numbers are cited inconsistently across research (STACK/ARCH say 089; PITFALLS says 085) — **confirm the actual current max before writing** and heed documented numbering-collision gotchas (`0201`, dual `039`s).

### Research Flags
Phases likely needing deeper research during planning:
- **Phase 2 (Billing):** MEDIUM-priority research on Stripe usage-based-subscription portal limits (usage-based subs can cancel but **not** update in the portal), test-vs-live portal config, and the Basil/Dahlia period-field migration specifics. Verify against live `webhooks.py`/`internal.py` and Stripe docs during planning.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Bulk-Archive):** Well-grounded in existing code — mirrors the `transition_work_order_with_audit` RPC, established `archived_at`-flag pattern, and known Realtime-invalidator behavior. Straight implementation from this research.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Existing code inspected directly; Stripe API-version behavior verified against official changelog |
| Features | HIGH | Both capabilities grounded in existing PatelRep code; portal behavior verified against current Stripe docs |
| Architecture | HIGH | All findings verified against current source (routers, transitions, page components, migrations) |
| Pitfalls | HIGH | Billing pitfalls verified against Stripe docs + live code reads; archive pitfalls from audit/transition/Realtime source; mapped to the documented v1.2 bug classes |

**Overall confidence:** HIGH

### Gaps to Address
- **Migration number discrepancy:** research files cite 085 vs 089 for the next migration. Confirm the actual current max in `supabase/migrations/` before writing, and watch documented numbering collisions.
- **Local verification blind spot (billing):** no local Stripe keys means checkout/portal/webhook/true-up cannot be E2E-tested locally. Plan for Stripe-CLI test-mode replay and/or staging; treat mocked passes as insufficient for Definition of Done.
- **Mid-cycle plan-change policy:** whether an in-progress `credit_ledger` row's `credits_included` should re-base on upgrade (and cap proration) is a product decision to make explicit during Phase 2 planning.
- **Usage-based portal limitation:** Stripe blocks *updating* usage-based subs in the portal (cancel only). If self-serve plan-change is desired, route it through Checkout/API, not the portal — decide scope during planning.

## Sources

### Primary (HIGH confidence)
- PatelRep codebase — `apps/api/routers/billing.py`, `webhooks.py`, `work_orders.py`, `internal.py`, `middleware/credits.py`, `services/work_orders/transitions.py`; `apps/web/app/(dashboard)/settings/billing/page.tsx`, `engineering/work-orders/page.tsx`, `lib/api/billing.ts`; `supabase/migrations/007`, `014`, `030`, `065`; `requirements.txt`; `package.json`; root `CLAUDE.md` (A1–A4, pricing, roles, Current Scope, migration gotchas)
- [Stripe changelog — deprecate subscription current_period_start/end (Basil 2025-03-31)](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end)
- [Stripe — customer management / Customer Portal](https://docs.stripe.com/customer-management) — portal capabilities; usage-based subs cancel-only; separate test/live config
- [Stripe — subscription invoices & cancellation](https://docs.stripe.com/billing/invoices/subscription) — pending items bill at end of next period; cancel stops auto-collection
- `.planning/v1.2-MILESTONE-AUDIT.md` / `CLAUDE.md` — the three documented bug classes (flat-cost, fake-success, undeployed-migration)

### Secondary (MEDIUM confidence)
- [stripe-python releases / CHANGELOG](https://github.com/stripe/stripe-python/releases) — 15.x current line, pins 2026 Dahlia API version
- [dev.to — Stripe Basil moved current_period_end off Subscription](https://dev.to/flarecanary/stripe-basil-quietly-moved-currentperiodend-off-subscription-and-a-lot-of-code-broke-3eo7) — corroborates breakage pattern
- Stripe metered-billing 2026 guides (hamsterstack, buildmvpfast) — legacy Usage Records removed since `2025-03-31.basil`; idempotency keys prevent double-charge
- [OperatorIQ — Stripe Customer Portal plan changes](https://operatoriq.io/blog/stripe-customer-portal-plan-changes/)

### Tertiary (LOW confidence)
- None material — findings are anchored in direct code reads and official Stripe docs.

---
*Research completed: 2026-08-03*
*Ready for roadmap: yes*
