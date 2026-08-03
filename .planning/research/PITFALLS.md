# Pitfalls Research

**Domain:** Self-serve billing/subscription management on a LIVE Stripe integration (base + metered AI-credit overage) and bulk-archive for Engineering work orders on an append-only audit + per-tenant RLS system
**Researched:** 2026-08-03
**Confidence:** HIGH (billing pitfalls verified against current Stripe docs + read of live `billing.py`, `webhooks.py`, `credits.py`, `internal.py::monthly_trueup`; archive pitfalls derived from read of `065_work_order_transition_audit.sql` + `transitions.py` + documented Realtime/cron constraints)

> This app has a documented three-bug history that this milestone must NOT repeat:
> 1. **Flat-cost billing** (v1.0) — charged fixed cost instead of deriving from real usage (CLAUDE.md A3).
> 2. **Fake success** (v1.2) — UI claimed success without doing the underlying work.
> 3. **Undeployed migration** (v1.2) — migrations written, tested, merged, but never applied to the live Supabase project.
>
> Every pitfall below is tagged with which of these classes it risks re-triggering.

---

## Critical Pitfalls

### Pitfall 1: Portal cancellation silently drops already-accrued overage (revenue leak)

**What goes wrong:**
The `monthly-trueup` cron (`internal.py:239`) only invoices tenants whose `plan_status == "active"`. If a GM uses the (now self-serve) Customer Portal to cancel mid-cycle, the Stripe `customer.subscription.deleted` webhook sets `plan_status = "cancelled"` (`webhooks.py:157-164`). The `credit_ledger.credits_used` overage accrued for that partial month is then **never** pushed to Stripe — the cron skips the tenant. The hotel used AI credits over the cap and is billed $0 for them.

**Why it happens:**
Overage is billed *retroactively* by a month-end cron, but self-serve cancellation can happen *any* day. The two systems were never reconciled because, pre-self-serve, cancellations were rare/manual. Stripe confirms: on cancellation it "stops automatic collection of all finalized invoices," and pending invoice items only bill "at the end of the next billing period" — but the trueup never *creates* the invoice item for a cancelled sub in the first place.

**How to avoid:**
On `customer.subscription.deleted`, before flipping to `cancelled`, run an immediate final overage true-up for the current period against `credit_ledger` (or set `invoice_now`/create the InvoiceItem then). Alternatively, have the trueup process `plan_status IN ('active','cancelled')` for any ledger period that overlaps the cancellation date and hasn't been trued-up yet.

**Warning signs:**
A cancelled tenant with `credit_ledger.credits_used > credits_included` and no corresponding Stripe InvoiceItem. Monthly overage revenue lower than dashboard-reported credit consumption.

**Phase to address:** Self-serve billing phase — this is the #1 flat-cost-class regression risk of the milestone.
**Risks re-triggering:** Flat-cost / revenue-integrity (A3).

---

### Pitfall 2: `monthly-trueup` is not idempotent and runs 3–4 nights in a row

**What goes wrong:**
The cron is scheduled `0 0 28-31 * *` — it fires on the 28th, 29th, 30th, **and** 31st. Each run calls `stripe.InvoiceItem.create(...)` (`internal.py:256`) with **no idempotency key** and no "already invoiced this period" guard. As `credits_used` keeps climbing across those nights, a hotel over its cap can receive **2–4 separate overage InvoiceItems** in one month. Adding self-serve billing UI (where GMs now *see* their invoices via `/billing/invoices`) means customers will finally notice these duplicates.

**Why it happens:**
The `28-31` schedule is a "catch month-end regardless of length" hack; the handler was written assuming a single run. There is no `overage_invoiced_at` / `trueup_invoice_item_id` column on `credit_ledger` to detect a prior run.

**How to avoid:**
(a) Pass a deterministic `idempotency_key` to `InvoiceItem.create`, e.g. `f"trueup:{tenant_id}:{period_start.isoformat()}"` — Stripe dedupes identical keys for 24h, which does NOT cover a 4-day window, so *also* (b) add an `overage_invoiced_at` (or `trueup_invoice_item_id`) column to `credit_ledger`, set it on success, and skip ledgers already stamped. Belt-and-suspenders because the idempotency window is shorter than the cron window.

**Warning signs:**
Multiple InvoiceItems with identical `AI Credits Overage` descriptions for the same customer in one billing period. `invoices_created` count from the cron > number of distinct over-cap tenants.

**Phase to address:** Self-serve billing phase (fix before exposing invoices in the UI).
**Risks re-triggering:** Flat-cost / revenue-integrity (A3).

---

### Pitfall 3: Bulk-archive writes zero audit rows (append-only trail broken by a set-based UPDATE)

**What goes wrong:**
The existing single-item path (`transition_work_order_with_audit`, migration 065) inserts exactly one `operational_audit_events` row per state change inside a `SECURITY DEFINER` RPC. A bulk-archive built for "performance" as a single `UPDATE work_orders SET is_archived = true WHERE id IN (...)` produces **zero** audit rows — the append-only history the whole table exists to guarantee is silently bypassed. Auditors later see work orders that transitioned to archived with no actor, no timestamp, no reason.

**Why it happens:**
The append-only trigger only blocks `UPDATE`/`DELETE` *on `operational_audit_events` itself* — it does **not** force a write when `work_orders` changes. Nothing at the DB level compels an audit insert, so a bulk path that skips the RPC looks correct and passes tests that only check `is_archived`.

**How to avoid:**
Implement bulk-archive as a `SECURITY DEFINER` RPC that writes one `operational_audit_events` row per work order (`action = 'work_order.archived'`, `old_state`/`new_state`, `actor_id`, `actor_role`, `reason_code`, `source`) via `INSERT ... SELECT`, mirroring migration 065. Add a test asserting `count(audit_events) == count(archived_work_orders)` for the batch.

**Warning signs:**
`SELECT count(*) FROM operational_audit_events WHERE action='work_order.archived'` lags behind the number of archived work orders. Archive UI shows a success toast but the WO's history tab has no "archived" entry.

**Phase to address:** Bulk-archive phase.
**Risks re-triggering:** Fake-success (audit says it happened; audit trail says it didn't).

---

### Pitfall 4: `archived` modeled as a work-order *status* — collides with the state machine, crons, and CHECK constraint

**What goes wrong:**
A tempting shortcut is adding `'archived'` to the `work_orders.status` enum. But `status` is governed by a CHECK constraint (`065`: `status IN ('open','escalated','in_progress','on_hold','completed','cancelled')`) and a strict transition state machine (`transitions.py::_ALLOWED_TRANSITIONS`). Adding a 7th status breaks the `Literal` type, the transition table, and every cron that filters on status (escalation check, predictions). Archived work orders would also need transitions *out* of archived, ballooning the matrix.

**Why it happens:**
"Archived" feels like a lifecycle state, so it's modeled alongside the others instead of as an orthogonal flag.

**How to avoid:**
Archive is **orthogonal** to status. Add a separate `is_archived BOOLEAN NOT NULL DEFAULT false` + `archived_at TIMESTAMPTZ` (+ optionally `archived_by`) column. Leave the status enum and transition state machine untouched. Only allow archiving work orders already in a terminal status (`completed`/`cancelled`) — enforce this in the RPC, not just the UI.

**Warning signs:**
PR diff touches the `work_orders_status_check` constraint or `_ALLOWED_TRANSITIONS`. Escalation cron starts throwing on an unknown status.

**Phase to address:** Bulk-archive phase (schema design step).
**Risks re-triggering:** Non-regression (breaks escalation/prediction crons and the transition validator).

---

### Pitfall 5: Bulk-archive trusts a client-supplied ID list → cross-tenant archive (IDOR)

**What goes wrong:**
Bulk endpoints take a list of work-order IDs. If the archive query is `...update().in_("id", ids)` without a tenant filter, a GM can pass another hotel's work-order IDs and archive them. The service-role Supabase client used by the API **bypasses RLS**, so the DB won't stop it — RLS is only the "second layer" (CLAUDE.md), and the SELECT-only RLS policy on `operational_audit_events` doesn't guard `work_orders` writes at all.

**Why it happens:**
Single-item endpoints get away with a bare `.eq("id", id)` because the ID came from that tenant's own list. Bulk endpoints accept arbitrary arrays, and the tenant scope is easy to forget when iterating.

**How to avoid:**
Every bulk query MUST include `.eq("hotel_id", current_user.hotel_id)` (or pass `p_tenant_id` into the RPC and `WHERE tenant_id = p_tenant_id` on the UPDATE, exactly as `transition_work_order_with_audit` does). Return per-ID results so callers can't assume all requested IDs were in-scope. Gate the route with `require_role("housekeeping_supervisor","engineer","gm")` — never a floor role.

**Warning signs:**
The archive query has no `hotel_id`/`tenant_id` predicate. `archived` counts that exceed the number of IDs the requesting tenant actually owns.

**Phase to address:** Bulk-archive phase (endpoint + RPC).
**Risks re-triggering:** Non-regression / security (multi-tenancy invariant).

---

### Pitfall 6: Neither Portal nor bulk-archive flows are exercisable locally → "looks done but isn't"

**What goes wrong:**
There are **no local Stripe credentials** (CLAUDE.md Current Scope): the Portal session, checkout, webhook signature verification, and trueup InvoiceItem creation cannot run end-to-end on localhost. A "Manage subscription" button that opens `stripe.billing_portal.Session.create` will pass mocked tests and *look* finished, then 500 in production (bad `return_url`, unconfigured Portal, wrong price, missing customer). This is precisely how the v1.2 fake-success class arises.

**Why it happens:**
Local mocks/fixtures return happy-path objects, so the UI shows success. The failure only manifests against the live Stripe account and the real webhook endpoint.

**How to avoid:**
Use the **Stripe CLI in test mode** as an explicit phase step: `stripe listen --forward-to localhost:8000/webhooks/stripe` to replay real signed events, and `stripe trigger customer.subscription.deleted` / `invoice.paid` to validate the handlers. Verify the **Customer Portal is configured in the Stripe Dashboard** (test *and* live mode are separate configurations). Do not accept "button opens something" as done — assert the resulting DB state changes (`plan_status`, ledger stamp) after a replayed webhook.

**Warning signs:**
Tests only assert the mock was called, not the resulting `subscriptions`/`credit_ledger` row. No `stripe listen` in the phase's verification steps. Portal button works in demo but returns a Stripe "configuration not found" error in prod.

**Phase to address:** Self-serve billing phase — bake Stripe-CLI replay into the phase's Definition of Done.
**Risks re-triggering:** Fake-success.

---

### Pitfall 7: New billing/archive migrations merged but never applied to the live Supabase project

**What goes wrong:**
This milestone needs new schema: an idempotency/`overage_invoiced_at` column on `credit_ledger` (Pitfall 2), and `is_archived`/`archived_at` + an index + the bulk-archive RPC on `work_orders` (Pitfalls 3–5). If these are written and merged but not `apply_migration`'d to the live project (exactly what happened twice in v1.2), the API code will reference columns/RPCs that don't exist → 500s in prod that green local tests never caught.

**Why it happens:**
Migrations live in `supabase/migrations/` as SQL files; nothing in CI guarantees they were pushed to the remote Supabase project. Local tests run against a schema that may already have the columns.

**How to avoid:**
Make **"verify migration applied to the live Supabase project"** an explicit phase-gate step (mirroring the v1.2 precedent). Concretely: after merge, run `list_tables` / query `information_schema.columns` against the remote project to confirm `credit_ledger.overage_invoiced_at`, `work_orders.is_archived`, and the archive RPC exist before closing the phase. Next sequential migration numbers start at **085** (latest applied is 084) — and watch the documented numbering-collision gotcha (e.g. `0201`, dual `039`s).

**Warning signs:**
`column ... does not exist` / `function ... does not exist` errors in Railway API logs post-deploy. A migration file present in git with no corresponding remote schema object.

**Phase to address:** Both phases — as a closing gate, not a mid-phase assumption.
**Risks re-triggering:** Undeployed migration (the exact v1.2 failure).

---

### Pitfall 8: Self-serve upgrade/downgrade drifts `credits_included`/`cap_cents` from the live plan

**What goes wrong:**
The local `subscriptions` mirror stores `credits_included`, `cap_cents`, `plan_status`. Both the credit gate (`credits.py:118-127`) and the trueup (`internal.py:250-253`) read these local values, not Stripe. If self-serve lets a GM change plan (or Stripe changes it via proration), and the webhook doesn't sync `credits_included`/`cap_cents`, the app enforces the *old* allowance/cap while Stripe bills the *new* plan — over- or under-charging. Note `credit_ledger` for the month is created **once** with the `credits_included` value that was current on first AI use (`credits.py:92-99`); a mid-month plan change won't retroactively update the open ledger.

**Why it happens:**
The `customer.subscription.updated` handler (`webhooks.py:140-155`) syncs `plan_status`/period fields but **not** `credits_included` or `cap_cents`. Plan entitlements were assumed static.

**How to avoid:**
On `customer.subscription.updated`, map the Stripe price/product to entitlements and update `credits_included` + `cap_cents`. Decide and document mid-cycle policy: whether an in-progress `credit_ledger` row's `credits_included` is re-based on upgrade (and prorate the cap the same way Stripe prorates). Keep the cap as `$2.50/room/month × room_count` — recompute if room count changes.

**Warning signs:**
`subscriptions.credits_included` never changes despite plan switches. Cap enforcement (402 "cap reached") triggers at a threshold that doesn't match the customer's current plan.

**Phase to address:** Self-serve billing phase (webhook entitlement sync).
**Risks re-triggering:** Flat-cost / revenue-integrity (A3) — wrong allowance is a cousin of fixed-cost billing.

---

### Pitfall 9: Bulk-archive floods the Realtime Engineering board / leaves archived WOs visible

**What goes wrong:**
Engineering Work Orders is one of only three Realtime surfaces (CLAUDE.md A2, migration 030). A bulk UPDATE of N work orders fires **N** Realtime change events at once → board flicker, thundering-herd re-renders, and possible dropped events. Worse: if the board's query doesn't filter `is_archived = false`, archived work orders keep showing (or reappear when a later event lands), making the archive look like it "didn't work."

**Why it happens:**
Archive was scoped as a data operation; the Realtime board's existing query and subscription filters weren't updated to exclude archived rows. Bulk = many simultaneous replica-identity change events.

**How to avoid:**
Add `is_archived = false` to the board's list query AND to any Realtime subscription filter. Consider a single "archived: N" summary event or a short client-side debounce over the batch rather than N individual re-renders. Verify Realtime replica identity carries the `is_archived` column so the client can filter on the incoming payload.

**Warning signs:**
Board visibly flickers/reorders when a batch is archived. Archived work orders still appear on the board until a manual refresh. Console shows a burst of N subscription callbacks.

**Phase to address:** Bulk-archive phase (must touch the board query + subscription, tested against the live board per the Self-Verification policy).
**Risks re-triggering:** Fake-success (UI shows archived count but rows remain) + non-regression (Realtime board).

---

### Pitfall 10: Partial bulk failure reported as full success

**What goes wrong:**
In a batch of 42, some rows fail the "must be terminal status" or tenant-scope check while others succeed. A non-transactional handler that returns `{"archived": 42}` regardless (or swallows per-row errors like the Opera/Twilio handlers deliberately do) tells the GM all 42 archived when only 30 did — the v1.2 fake-success pattern applied to bulk ops.

**Why it happens:**
Bulk handlers often loop-and-continue, and the response is a static count or the requested-list length rather than the actually-succeeded set.

**How to avoid:**
Either make the whole batch atomic in one RPC transaction (all-or-nothing), or return an explicit per-ID result `{archived: [...], skipped: [{id, reason}]}` and surface skips in the UI. Never return the input length as the success count.

**Warning signs:**
Success count always equals the requested count. No "skipped" branch in the response model. UI has no way to show partial results.

**Phase to address:** Bulk-archive phase.
**Risks re-triggering:** Fake-success.

---

### Pitfall 11: Stripe webhooks are not deduplicated by `event.id`

**What goes wrong:**
The `/webhooks/stripe` handler (`webhooks.py:129`) verifies the signature but does **not** record processed `event.id`s. Stripe retries deliveries; self-serve billing will generate far more events (portal edits, plan changes, payment retries). Re-delivered events re-run handlers. Most current handlers are idempotent UPDATEs, but any handler that *creates* or *increments* (future final-true-up on cancel, per Pitfall 1) will double-act on a retry.

**Why it happens:**
Low event volume today made retries harmless; self-serve raises volume and adds create/increment side effects.

**How to avoid:**
Persist processed `event.id`s (a `stripe_webhook_events` table or an upsert with unique constraint) and short-circuit already-seen events before any side effect. Keep all new webhook side effects idempotent.

**Warning signs:**
Duplicate rows/charges traceable to two deliveries of the same Stripe `event.id`. Stripe Dashboard shows webhook retries with 200s but doubled downstream effects.

**Phase to address:** Self-serve billing phase (harden before adding cancel-time invoicing from Pitfall 1).
**Risks re-triggering:** Flat-cost / revenue-integrity (A3).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Bulk-archive as one set `UPDATE`, skipping per-row audit inserts | Fast, few lines | Silently breaks the append-only audit trail; unrecoverable history gap | **Never** |
| Add `'archived'` to the `status` enum instead of a flag | No new column | Breaks CHECK constraint, transition matrix, and status-filtering crons | **Never** |
| Trust the client-supplied ID list without a `hotel_id` filter | Simpler query | Cross-tenant archive (IDOR) | **Never** |
| Sync only `plan_status` on `subscription.updated`, not entitlements | Less webhook code | `credits_included`/`cap_cents` drift → wrong billing | Only if plans are truly single-tier and immutable (document it) |
| `InvoiceItem.create` with no idempotency guard | Works on a single run | Duplicate overage charges across the 28–31 cron window | **Never** once invoices are user-visible |
| Mock Stripe in tests and call it "done" | Green CI without live creds | Portal/webhook 500s in prod (fake-success) | Only if paired with a Stripe-CLI replay gate before phase close |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Stripe Customer Portal | Assuming the Portal can change a usage-based plan | Stripe: usage-based subs can be **cancelled but not updated** in the Portal. Design self-serve "plan change" via Checkout/API, not Portal, or gate it |
| Stripe Customer Portal | Portal configured in test mode only | Test-mode and live-mode Portal configs are **separate**; configure both or live returns "configuration not found" |
| Stripe InvoiceItem / metered usage | Reaching for the legacy Usage Records API | Removed since API `2025-03-31.basil`; metered *prices* now require a backing Meter. PatelRep's manual `InvoiceItem.create` still works — just add idempotency keys |
| Stripe webhooks | No local signature testing (no creds) | `stripe listen --forward-to localhost:8000/webhooks/stripe` + `stripe trigger` to replay real signed events |
| Stripe cancellation | Expecting pending invoice items to auto-bill after cancel | On cancel, Stripe stops auto-collection of finalized invoices; pending items bill at end of *next* period unless you `invoice_now`. The trueup never creates them for cancelled subs → reconcile explicitly (Pitfall 1) |
| Supabase service-role client | Assuming RLS protects bulk writes | Service-role **bypasses RLS**; enforce `hotel_id`/`tenant_id` in the query. RLS on `operational_audit_events` is SELECT-only |
| Supabase Realtime | Bulk UPDATE without updating board filters | Add `is_archived=false` to query + subscription; expect N events per batch |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| N-per-row Realtime events on bulk archive | Board flicker, dropped events, re-render storm | Batch/debounce; filter archived rows out of the board | Archiving tens of WOs at once on an active board |
| Row-by-row audit insert loop over a large batch | Slow archive request, possible timeout | Use `INSERT ... SELECT` for audit rows inside the RPC transaction | Hundreds of WOs in one archive action |
| `credit_ledger` scan in trueup without period index | Slow cron as tenants grow | Ensure index on `(period_start)` / `(tenant_id, period_start)` | Hundreds+ of tenants |
| Listing `/billing/invoices` hits Stripe live every load | Latency + Stripe rate limits | Cache invoice list briefly; paginate | Frequent billing-page visits |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Bulk-archive endpoint not role-gated | A housekeeper archives Engineering work orders | `require_role("housekeeping_supervisor","engineer","gm")` |
| Client ID list archived without tenant filter | Cross-tenant data tampering (IDOR) | `.eq("hotel_id", user.hotel_id)` / `WHERE tenant_id = p_tenant_id` on every bulk write |
| Billing routes exposed beyond GM | Non-owner cancels the subscription or reads invoices | Keep all `/billing/*` on `require_role("gm")` (as today); apply same to any new self-serve route |
| Portal session created for a stored `stripe_customer_id` without re-checking tenant | Wrong customer's billing exposed | Always resolve `stripe_customer_id` via `.eq("tenant_id", user.hotel_id)` (current code does — preserve it) |
| Logging full Stripe payloads / customer IDs | PII/secret leakage in logs | Log truncated identifiers only (as Twilio handler does with `***%s[-4:]`) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Billing UI shows local `subscriptions` mirror immediately after a Portal change | Stale plan shown until webhook lands → user re-clicks/double-acts | Show "update pending" state; refresh on webhook or poll Stripe once on return |
| Offering "change plan" in Portal for a usage-based sub | Button does nothing / confuses (Stripe blocks update) | Route plan changes through Checkout/API, not the Portal |
| No confirm + count on bulk archive | Accidental mass-archive of active work orders | Confirm dialog with exact count + terminal-status-only preview; support undo |
| Archive with no un-archive path | Work orders "lost"; users panic | Provide filterable archived view + audited un-archive (`action='work_order.unarchived'`) |
| Cap-reached 402 with no self-serve remedy | GM hits "cap reached" and can't act | Link the 402 to the billing page to raise cap / upgrade |

## "Looks Done But Isn't" Checklist

- [ ] **Self-serve cancel:** Often missing the final overage true-up — verify a cancelled tenant with overage still gets an InvoiceItem before `plan_status` flips.
- [ ] **Monthly true-up:** Often missing idempotency across the 28–31 window — verify a second same-day run creates **zero** new InvoiceItems.
- [ ] **Portal button:** Often missing live-mode Portal config — verify it opens against the **live** Stripe account, not just a mock.
- [ ] **Webhook handlers:** Often missing `event.id` dedupe — verify replaying the same event twice doesn't double-act.
- [ ] **Bulk archive:** Often missing per-row audit rows — verify `count(archived) == count(operational_audit_events action='work_order.archived')`.
- [ ] **Bulk archive:** Often missing tenant scope — verify passing another hotel's WO IDs archives nothing.
- [ ] **Realtime board:** Often missing `is_archived=false` filter — verify archived WOs disappear live and don't flicker back.
- [ ] **Escalation/prediction crons:** Often missing archived exclusion — verify they skip archived WOs.
- [ ] **Migrations:** Often merged but not applied — verify each new column/RPC exists in the **live** Supabase project before phase close.
- [ ] **Plan entitlements:** Often only `plan_status` synced — verify `credits_included`/`cap_cents` update on `subscription.updated`.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Duplicate overage InvoiceItems already created | LOW–MEDIUM | Delete duplicate pending InvoiceItems in Stripe before the invoice finalizes; add idempotency + ledger stamp to prevent recurrence |
| Overage lost on cancellation | MEDIUM | Reconcile `credit_ledger` vs Stripe for cancelled tenants; issue one-off invoice items for the gap; add cancel-time true-up |
| Bulk archive wrote no audit rows | HIGH | Audit history is unrecoverable for the affected batch; back-fill best-effort `operational_audit_events` from `work_orders.archived_at/archived_by` if captured, else document the gap |
| Cross-tenant archive occurred | HIGH | Un-archive affected WOs (audited), notify affected tenant, add tenant filter + regression test |
| Migration not applied in prod | LOW | `apply_migration` to the live project; add a schema-existence check to the phase gate |
| Realtime board flooded | LOW | Add archived filter + batch debounce; no data loss |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Overage lost on cancel | Self-serve billing | Replay `customer.subscription.deleted` for an over-cap tenant; confirm an InvoiceItem is created before status flips |
| 2. True-up not idempotent | Self-serve billing | Run trueup twice same period; assert 0 new InvoiceItems on 2nd run; ledger stamp present |
| 3. Bulk archive skips audit | Bulk-archive | Assert `count(audit rows) == count(archived)` for a batch |
| 4. `archived` as status | Bulk-archive | Confirm status enum + transition matrix untouched; crons still pass |
| 5. Cross-tenant archive (IDOR) | Bulk-archive | Pass foreign WO IDs; assert nothing archived |
| 6. Not exercisable locally | Self-serve billing | `stripe listen`/`stripe trigger` replay in phase DoD; assert DB state change |
| 7. Undeployed migration | Both (closing gate) | Query live Supabase `information_schema` for new columns/RPCs |
| 8. Entitlement drift | Self-serve billing | Trigger `subscription.updated`; assert `credits_included`/`cap_cents` update |
| 9. Realtime flood/stale | Bulk-archive | Watch the live board during a batch archive; no flicker, rows leave immediately |
| 10. Partial failure as success | Bulk-archive | Mixed valid/invalid batch returns explicit skipped list |
| 11. No webhook dedupe | Self-serve billing | Replay same `event.id` twice; assert single side effect |

## Sources

- Stripe Docs — Customer Portal / customer management (usage-based subs can cancel but not update; separate test/live config): https://docs.stripe.com/customer-management — HIGH
- Stripe Docs — Subscription invoices & cancellation (pending invoice items bill at end of next period; cancel stops auto-collection): https://docs.stripe.com/billing/invoices/subscription , https://docs.stripe.com/api/subscriptions/cancel — HIGH
- Stripe metered billing 2026 (legacy Usage Records removed since API `2025-03-31.basil`; metered prices require a Meter; idempotency keys prevent double-charge): https://hamsterstack.com/how-to/stripe/implement-usage-based-billing/ , https://www.buildmvpfast.com/blog/stripe-metered-billing-implementation-guide-saas-2026 — MEDIUM (secondary sources, corroborated)
- Stripe idempotency keys (dedupe within 24h; deterministic keys from internal IDs): https://www.rapidevelopers.com/stripe-guide/how-to-prevent-duplicate-charges-with-stripe-api , https://singhajit.com/how-stripe-prevents-double-payment/ — MEDIUM
- Codebase reads (HIGH, authoritative for this app): `apps/api/routers/billing.py`, `apps/api/routers/webhooks.py`, `apps/api/middleware/credits.py`, `apps/api/routers/internal.py::monthly_trueup`, `apps/api/services/work_orders/transitions.py`, `supabase/migrations/065_work_order_transition_audit.sql`, `CLAUDE.md` (A2/A3 constraints, cron schedule, Current Scope, migration numbering gotchas)
- v1.2 milestone history (flat-cost, fake-success, undeployed-migration bug classes): `CLAUDE.md`, `.planning/v1.2-MILESTONE-AUDIT.md`

---
*Pitfalls research for: self-serve Stripe billing management + bulk-archive on append-only/RLS work orders*
*Researched: 2026-08-03*
