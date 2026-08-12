# Phase 16: Self-Serve Billing Management - Research

**Researched:** 2026-08-03
**Domain:** Stripe billing (Customer Portal, invoicing, webhooks) + FastAPI/Supabase usage-metering
**Confidence:** HIGH (existing code fully read; Stripe practices verified against official docs via Context7)

## Summary

This phase is less "build new Stripe integration" and more "hardware the half-built one that's already in the repo, and delete a dead duplicate." The Stripe Customer Portal endpoint (`POST /billing/portal`), checkout endpoint, and invoice listing already exist in `apps/api/routers/billing.py` and are **already wired into the live UI** at `apps/web/app/(dashboard)/settings/billing/page.tsx` (linked from the sidebar nav). BILLING-01 is close to done there — but there is a second, unlinked, dead-code billing page at `apps/web/app/(dashboard)/billing/page.tsx` that still shows a disabled "Manage Subscription (Coming soon)" button and duplicates ~90% of the live page's UI. This is almost certainly what BILLING-01's "replaces Coming soon" phrasing refers to, and CLAUDE.md's domain map (`Billing | billing.py | (dashboard)/billing`) is stale/wrong — it documents the dead route, not the live one. The planner must decide: delete the dead page, redirect it to `/settings/billing`, or merge features into it and retire `/settings/billing`. Given `/settings/billing` is the one actually reachable from navigation and already has portal+checkout+invoices wired, the lowest-risk path is to consolidate on `/settings/billing` and remove (or redirect) `/billing`.

The three revenue-integrity requirements (BILLING-07/08/09) are real, verified gaps, not already-mitigated risks: the monthly true-up cron (`apps/api/routers/internal.py::monthly_trueup`) creates a Stripe `InvoiceItem` for every tenant with overage on every single invocation with **no guard against re-running** — if the GitHub Actions cron fires on two consecutive nights in the `28-31 * *` window (which it will, every month, by design), every hotel with overage gets double-billed. The `credit_ledger` table already has unused `is_finalized` / `finalized_at` / `stripe_invoice_id` columns from migration 014 that were clearly designed to prevent exactly this, but the cron never reads or writes them. Similarly, `POST /webhooks/stripe` has zero event-ID deduplication — Stripe's own docs (verified via Context7) explicitly warn that webhook endpoints "might occasionally receive the same event more than once" and recommend logging processed event IDs. The codebase already has a proven idempotency pattern to copy: migration `078_evidence_exception_engine.sql`'s `notification_deliveries` table uses a `UNIQUE (tenant_id, idempotency_key)` index plus a `SELECT ... FOR UPDATE` lookup-then-act pattern inside a `SECURITY DEFINER` function — this is the direct template for both the webhook-event dedup table and the true-up "already invoiced" stamp.

BILLING-02/03/05/06 (usage display, cap, projection, 80%-alert) all sit on top of one more discovered gap: `subscriptions.cap_cents` (the $2.50/room/month cap column, added in migration 014) is **never set anywhere in the codebase** — not at hotel creation (`apps/api/routers/hotels.py::create_hotel`), not anywhere else. It is always `NULL`. Because `check_and_deduct_credits()` in `middleware/credits.py` only enforces the cap `if sub.get("cap_cents")`, the $2.50/room cap is currently silent and non-functional in production. The planner must add `cap_cents = room_count * 250` at subscription creation (and decide how/whether to keep it in sync if `room_count` changes later — flagged as an open question, no existing mechanism watches `tenants.room_count` changes for billing purposes). Separately, `credit_ledger` rows are created lazily — only the first AI call after a period rollover creates the new row (`middleware/credits.py`, not `billing.py`). The `GET /billing/credits` endpoint has no such fallback: it just returns `{"message": "No billing period found"}` if the AI-triggered row doesn't exist yet, which is the concrete manifestation of BILLING-02's "goes stale after rollover" symptom — it's not stale data, it's a missing-row placeholder screen for a period until any AI feature is used.

**Primary recommendation:** Treat this phase as three independent tracks that share almost no code: (1) frontend consolidation + cap/usage-gauge display fixes (web-only, `/settings/billing`), (2) true-up cron idempotency hardening (backend, `internal.py` + new `credit_ledger` columns already exist), (3) webhook event dedup (backend, new small table + `webhooks.py` guard). None of the three blocks the others — plan them as separable units of work, but sequence the webhook-dedup table before wiring `subscription.deleted` final-invoicing (BILLING-08) since that handler will now go through the same dedup gate.

## User Constraints

No CONTEXT.md exists for this phase — `/gsd:discuss-phase` was explicitly skipped. No locked decisions to honor. All findings below are researcher judgment/recommendation for the planner to weigh, not user-approved decisions.

## Standard Stack

### Core (already in place — no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `stripe` (Python SDK) | 15.4.0 (pinned in `apps/api/requirements.txt`) | Customer Portal sessions, Checkout, Invoice/InvoiceItem, webhook verification | Already used throughout `billing.py`, `webhooks.py`, `internal.py` |
| Supabase Python SDK | existing pin | All persistence — no ORM per project convention | Existing project-wide convention (CLAUDE.md) |
| `@tanstack/react-query` | existing | Client data fetching/caching on the billing page | Already used in both billing pages |

No new packages are needed for this phase. Everything required (idempotency tables, dedup patterns, notification queueing) can be built with the existing stack.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom `stripe_webhook_events` table for dedup | Stripe's `Idempotency-Key` request header alone | Idempotency-Key only protects the *request that creates the invoice item*, and expires after 24h (verified via Context7) — it cannot prevent the cron from re-invoicing on a *different night's run* which is exactly the multi-night failure mode BILLING-07 describes. A persistent "already invoiced this period" stamp in Postgres is required; the Stripe key is defense-in-depth on top of it, not a replacement. |
| App-level webhook event log | Stripe CLI / Dashboard's built-in webhook retry inspection | Doesn't stop your own handler from double-acting; Stripe's own docs recommend app-side event-ID logging regardless of dashboard tooling. |

## Architecture Patterns

### Existing billing surface (as-is)

```
apps/api/routers/billing.py       # GET /subscription, /credits, POST /portal, /checkout, GET /invoices
apps/api/routers/webhooks.py      # POST /webhooks/stripe — subscription.*, checkout.session.completed,
                                   #   invoice.payment_failed, invoice.paid — NO event.id dedup today
apps/api/routers/internal.py      # POST /internal/billing/monthly-trueup (cron) — NO idempotency today
apps/api/middleware/credits.py    # check_and_deduct_credits() — lazy credit_ledger row creation,
                                   #   cap enforcement gated on cap_cents (currently always NULL)
apps/api/routers/hotels.py        # create_hotel() — creates subscriptions row, NEVER sets cap_cents
apps/api/routers/auth.py          # GET /auth/me — already returns subscription incl. cap_cents (passthrough)

apps/web/app/(dashboard)/settings/billing/page.tsx   # LIVE page — linked from nav, portal+checkout+invoices wired
apps/web/app/(dashboard)/billing/page.tsx            # DEAD/unlinked duplicate — "Coming soon" disabled button
apps/web/lib/api/billing.ts                          # billingApi client — used by both pages
```

**Table state (migration 014, unchanged since):**
- `subscriptions.cap_cents` — column exists, **always NULL in practice** (never written).
- `credit_ledger.is_finalized`, `.finalized_at`, `.stripe_invoice_id` — columns exist, **never written by the true-up cron** (only `stripe_invoice_id` is written, and only by the `invoice.paid` webhook handler, unrelated to true-up idempotency).
- `credit_ledger.credits_used` is `NUMERIC(10,4)` (migration 020) — fractional credits, already correct.

### Pattern: Idempotency via UNIQUE constraint + lookup-before-act (COPY THIS)
**What:** Migration `078_evidence_exception_engine.sql` added `idempotency_key TEXT` to `notification_deliveries` with `CREATE UNIQUE INDEX ... (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL`, then a `SECURITY DEFINER` SQL function does `SELECT ... FOR UPDATE` against that key before deciding to insert or skip.
**When to use:** Directly applicable to both BILLING-07 (true-up: key = `tenant_id + period_start`, stamped onto `credit_ledger.is_finalized`/`stripe_invoice_id` after successful invoice creation) and BILLING-09 (webhook dedup: key = Stripe `event.id`, stored in a small new table before processing, checked before any side effect).
**Example (existing code, `supabase/migrations/078_evidence_exception_engine.sql`):**
```sql
ALTER TABLE public.notification_deliveries
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_deliveries_idempotency
  ON public.notification_deliveries (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
-- function does SELECT ... FOR UPDATE on (tenant_id, idempotency_key), branches on FOUND
```

### Pattern: cron_health recording (COPY THIS for any new/modified cron)
**What:** Every internal cron endpoint calls `_record_cron_run(job_name, error=...)` (defined in `internal.py`) to upsert last success/failure into a `cron_health` table for monitoring.
**When to use:** Keep this call in `monthly_trueup` after the idempotency fix; do not remove it.

### Pattern: mocked-Stripe test harness (COPY THIS — no live Stripe credentials exist locally)
**What:** `apps/api/tests/smoke/test_webhooks_and_transitions.py` already has `FakeDB`/`FakeQuery`/`FakeRequest` classes and a `stripe_event(event_type, obj)` helper (`SimpleNamespace(type=..., data=SimpleNamespace(object=...))`), plus `monkeypatch.setattr(webhooks_router.stripe.Webhook, "construct_event", lambda *_a, **_kw: stripe_event(...))` to bypass real Stripe signature verification in tests.
**When to use:** Every new/changed Stripe code path in this phase (webhook dedup, `subscription.deleted` final true-up, true-up cron idempotency) must be tested this way — there is no live Stripe API access in this environment (per project's Current Scope constraint).
**Example (existing test, lines ~572-599 of that file):**
```python
monkeypatch.setattr(
    webhooks_router.stripe.Webhook,
    "construct_event",
    lambda *_args, **_kwargs: stripe_event("customer.subscription.updated", sub),
)
response = await webhooks_router.stripe_webhook(FakeRequest(headers={"stripe-signature": "sig"}))
```

### Pattern: notification dedup-once-per-day (candidate for BILLING-06's 80% alert)
**What:** `internal.py::_queue_safety_notification()` checks for an existing notification of the same `(tenant_id, user_id, type)` with matching `data` created today before inserting, returning `False` if a duplicate would be created.
**When to use:** A lighter-weight alternative to a dedicated idempotency table if the 80%-cap alert is implemented as a "queue once per billing period" notification rather than a strict idempotency-keyed row. Recommend scoping the "already alerted" check to the billing period (not just "today") since usage crossing 80% only needs one alert per period, not one per day it stays above 80%.

### Anti-Patterns to Avoid
- **Relying on Stripe's `Idempotency-Key` header alone for the true-up cron:** it expires after 24 hours (verified via Context7/Stripe docs), so it cannot protect against a cron that reruns on a *later* night — only against the same request retrying within the same run. The persistent Postgres stamp is mandatory; the Stripe key is a secondary layer.
- **Trusting `credit_ledger.credits_used - credits_included` for "already invoiced" state:** that's usage data, not billing state. Use the dedicated `is_finalized`/`stripe_invoice_id` columns (already in schema) as the sole source of truth for "has this period been billed."
- **Building a whole new billing settings page from scratch:** `/settings/billing/page.tsx` is 90% there. Extend it; don't rewrite.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Plan change / payment method UI | A custom in-app plan-picker or card-entry form | Stripe Customer Portal (`stripe.billing_portal.Session.create`, already implemented in `billing.py`) | Portal handles PCI scope, plan-switch proration, and payment-method updates natively; BILLING-01 explicitly calls for wiring the *existing* endpoint, not building new UI. |
| Webhook signature verification | Manual HMAC parsing | `stripe.Webhook.construct_event(payload, sig, settings.stripe_webhook_secret)` (already used) | Already correct in `webhooks.py`; do not touch this part. |
| Duplicate-request protection on invoice creation | A homegrown lock/mutex | Stripe's native `Idempotency-Key` param on `stripe.InvoiceItem.create(..., idempotency_key=...)` **plus** the Postgres "already finalized" stamp | Two independent layers; the Stripe key catches same-run retries, the DB stamp catches cross-run reruns. |

**Key insight:** Every piece of Stripe-facing infrastructure this phase needs (Portal, webhook verification, invoice creation, idempotency keys) is a native Stripe API feature already partially wired in this codebase. The actual engineering work is almost entirely on the Postgres/idempotency side, not the Stripe integration side.

## Common Pitfalls

### Pitfall 1: Cron firing on multiple nights is not a hypothetical — it's the schedule as designed
**What goes wrong:** `CRON_SECRET`-gated `POST /v1/internal/billing/monthly-trueup` runs on schedule `0 0 28-31 * *` (per CLAUDE.md's cron table) — i.e., potentially 2-4 times per month by design (to catch short months). Without a guard, every one of those runs creates a fresh `stripe.InvoiceItem` for every tenant with overage.
**Why it happens:** The cron was written to compute overage from `credit_ledger` fresh every run, with no check for prior invoicing.
**How to avoid:** Before creating an `InvoiceItem` for a tenant/period, check `credit_ledger.is_finalized` for that `(tenant_id, period_start)` row; skip if true. After successful Stripe call, set `is_finalized = TRUE`, `finalized_at = now()`, `stripe_invoice_id = <id>` in the same transaction/request (Supabase SDK has no cross-table transactions, so do the Stripe call first, then the DB stamp — and make the DB stamp idempotent/retriable itself in case the stamp write fails after a successful Stripe call, which would otherwise cause the *next* cron run to re-bill; log loudly if the stamp write fails post-charge so it can be manually reconciled).
**Warning signs:** Duplicate `InvoiceItem`s on the same Stripe customer for the same month; the existing `errors` counter in `monthly_trueup`'s return value not distinguishing "already billed, skipped" from "billed now" from "failed."

### Pitfall 2: `subscription.deleted` webhook flips status before overage is captured
**What goes wrong:** Current handler for `customer.subscription.deleted` immediately sets `plan_status = "cancelled"`. If a GM cancels mid-cycle via the Portal, any overage accrued between period start and cancellation date is never invoiced — the next `monthly_trueup` run either finds no `active` subscription (it filters `plan_status == "active"`) and skips the tenant entirely, or runs against a period that's already closed.
**Why it happens:** No "final true-up" step exists in the deletion path; BILLING-08 requires the true-up logic to run here too, before the status flip.
**How to avoid:** Factor the true-up-a-single-tenant logic out of `monthly_trueup` into a reusable function; call it from the `customer.subscription.deleted` webhook handler *before* writing `plan_status = "cancelled"`, using the ledger row that's still open for the current period. This reuses the same idempotency stamp from Pitfall 1, so a webhook retry (see Pitfall 3) won't double-invoice here either.
**Warning signs:** Hotels that cancel mid-month showing overage in `credit_ledger` that never gets a `stripe_invoice_id`.

### Pitfall 3: Webhook retries acting twice — not hypothetical, Stripe explicitly does this
**What goes wrong:** Stripe explicitly documents (verified via Context7) that "webhook endpoints might occasionally receive the same event more than once." Every handler in `webhooks.py` (`customer.subscription.updated`, `invoice.paid`, the new `customer.subscription.deleted` final-invoice logic from Pitfall 2, etc.) currently re-runs its full side effect set on every delivery, retried or not.
**Why it happens:** No `event.id` log exists anywhere in the schema or code today.
**How to avoid:** Add a small table (e.g. `stripe_webhook_events(event_id TEXT PRIMARY KEY, event_type TEXT, processed_at TIMESTAMPTZ)`) and, at the very top of `stripe_webhook()`, attempt an insert of `event.id`; if it already exists (unique-violation or a pre-check `SELECT`), return `{"status": "duplicate_ignored"}` immediately without touching any handler. This single gate covers BILLING-09 and hardens BILLING-08's new logic for free.
**Warning signs:** None currently observable because nothing logs event IDs — this is a silent risk today, confirmed by absence rather than by an incident.

### Pitfall 4: `cap_cents` is silently NULL — the advertised $2.50/room cap does not function today
**What goes wrong:** `hotels.py::create_hotel()` inserts a `subscriptions` row with no `cap_cents`. `credits.py::check_and_deduct_credits()` only enforces the cap `if sub.get("cap_cents")` — so with `cap_cents` always `None`, the cap check is always skipped and a hotel's AI overage is currently unbounded (contradicts the pricing model in CLAUDE.md: "capped at $2.50/room/month").
**Why it happens:** Nothing ever computes `room_count * 250` and writes it.
**How to avoid:** Set `cap_cents = body.room_count * 250` in `create_hotel()` alongside the existing subscription insert. Decide (open question below) whether to also update it when `tenants.room_count` changes via `PATCH /hotels/{id}` — if room count changes are rare/manual and out of scope, at minimum flag the staleness risk to the planner rather than silently leaving it.
**Warning signs:** Any hotel with real overage usage never getting capped/throttled; billing page showing `cap_cents: null` for all existing tenants until backfilled.

### Pitfall 5: `GET /billing/credits` has no lazy-create fallback, unlike the credit-deduction path
**What goes wrong:** `middleware/credits.py::check_and_deduct_credits()` creates a fresh `credit_ledger` row for the current period on first AI call after rollover. `billing.py::get_credits()` has no equivalent — it just returns `{"data": {"message": "No billing period found"}}` if no row exists yet for the current period, which is the literal window right after every monthly rollover until some AI feature is used.
**Why it happens:** Two independent code paths ended up with different row-creation behavior; the router endpoint was written assuming a row would already exist.
**How to avoid:** Either (a) extract the lazy-create-ledger-row logic from `credits.py` into a shared helper both call, or (b) have a period-rollover mechanism (a new lightweight cron, or a call at the top of `get_credits()`) pre-create the next period's `credit_ledger` row for every active subscription slightly before/at rollover so it's never missing. Option (a) is simpler and requires no new cron; option (b) more literally "never goes stale" but adds a new scheduled job. Flagged as an open question for the planner — see below.
**Warning signs:** GM opens billing page on the 1st of the month before any AI call has happened that day/period and sees "No billing period found" instead of `0 / 5000 credits used`.

### Pitfall 6: Two billing pages, one dead — don't fix the wrong one
**What goes wrong:** It would be easy to "fix" the disabled button in `apps/web/app/(dashboard)/billing/page.tsx` (matching CLAUDE.md's stale domain-map entry) without realizing `apps/web/app/(dashboard)/settings/billing/page.tsx` is the one users actually reach (linked from `settings/layout.tsx` and `lib/utils/navigation.ts`), already has the portal wired, and would end up duplicated/diverging further.
**Why it happens:** CLAUDE.md documents `(dashboard)/billing` as the billing route; it's out of date.
**How to avoid:** Confirm with a route check (`grep` for `href.*billing` — done, results above) before touching either file. Recommend: delete `apps/web/app/(dashboard)/billing/page.tsx` (or turn it into a `redirect('/settings/billing')`), extend `settings/billing/page.tsx` for the new BILLING-03/04/05/06 UI, and correct CLAUDE.md's domain map entry as part of this phase's cleanup.
**Warning signs:** None yet — this is a pre-emptive finding, not an observed bug.

## Code Examples

### Existing Customer Portal wiring (BILLING-01 — already correct, just needs the dead page removed/redirected)
```python
# apps/api/routers/billing.py — already implemented, do not rebuild
@router.post("/portal")
async def create_portal_session(current_user: CurrentUser = Depends(require_role("gm"))):
    sub_result = supabase.table("subscriptions").select("stripe_customer_id")\
        .eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    stripe_cid = (sub_result.data or {}).get("stripe_customer_id") if sub_result.data else None
    if not stripe_cid:
        raise HTTPException(status_code=400, detail="No Stripe customer associated with this account.")
    session = stripe.billing_portal.Session.create(
        customer=stripe_cid,
        return_url=f"{settings.app_url}/settings/billing",
    )
    return {"data": {"url": session.url}}
```

### Idempotency pattern to replicate for true-up (schema shape only — write for this phase)
```sql
-- Reuse existing columns already in credit_ledger (migration 014) — no new columns needed for BILLING-07:
--   is_finalized BOOLEAN, finalized_at TIMESTAMPTZ, stripe_invoice_id TEXT
-- Guard in monthly_trueup: skip any ledger row where is_finalized = TRUE before calling Stripe.
```

### Stripe Idempotency-Key on invoice creation (defense-in-depth, verified via Context7)
```python
# Source: https://docs.stripe.com/api/idempotent_requests (Context7 /websites/stripe)
stripe.InvoiceItem.create(
    customer=stripe_cid,
    amount=overage_cents,
    currency="usd",
    description=f"AI Credits Overage: {overage_credits} credits @ $0.02",
    idempotency_key=f"trueup-{tenant_id}-{period_start.isoformat()}",  # stable per period, survives single-run retries
)
```

### Stripe's own guidance on webhook dedup (verified via Context7)
> "Webhook endpoints might occasionally receive the same event more than once. To guard against duplicated event receipts, log the event IDs you've processed and avoid reprocessing already-logged events."
> — Source: https://docs.stripe.com/webhooks/signatures

## State of the Art

| Old Approach (this codebase, today) | Recommended Approach | When Changed | Impact |
|--------------------------------------|----------------------|---------------|--------|
| True-up cron recomputes and invoices from scratch every run | Stamp `is_finalized`/`stripe_invoice_id` per `(tenant_id, period_start)` before considering a tenant billed again | This phase | Eliminates double-charge risk on the `28-31 * *` multi-fire schedule |
| Webhook handlers have no event-id memory | Insert-or-skip on `event.id` at the top of `stripe_webhook()` | This phase | Makes every handler (including the new BILLING-08 final-invoice logic) naturally retry-safe |
| `cap_cents` never set | Set at subscription creation from `room_count * 250` | This phase | Makes the advertised $2.50/room/month cap actually enforce |

Nothing here is "deprecated Stripe API" — the stripe-python 15.4.0 SDK and all endpoints used (`billing_portal.Session`, `checkout.Session`, `Invoice`, `InvoiceItem`, `Webhook.construct_event`) are current, stable Stripe API surface as of the researched docs.

## Open Questions

1. **Should `/billing/page.tsx` (dead) be deleted, redirected, or merged?**
   - What we know: It's unreferenced by any nav/link in the codebase; `/settings/billing/page.tsx` is the live, linked page with more functionality already built.
   - What's unclear: Whether any external bookmark/deep-link relies on `/billing` (low risk — this is an internal SaaS dashboard, not public-facing), and whether the planner wants a redirect (safer, preserves old links) vs. hard delete (cleaner, matches "remove dead code" cleanup policy).
   - Recommendation: Redirect `/billing` → `/settings/billing` (one-line `redirect()` in a Next.js page/route) rather than a bare 404, and fix CLAUDE.md's domain map entry.

2. **Should `cap_cents` re-sync when `tenants.room_count` changes post-onboarding?**
   - What we know: `cap_cents` is set once (recommended fix) at hotel creation from `body.room_count`. `PATCH /hotels/{id}` (in `hotels.py`) can update `room_count` independently and does not touch `subscriptions.cap_cents`.
   - What's unclear: How often room count actually changes after onboarding in practice (likely rare — hotels don't often add/remove rooms), and whether this phase's scope should include that sync or explicitly defer it.
   - Recommendation: In-scope minimum is setting `cap_cents` at creation (fixes the "always NULL" bug, which is the acute problem). Recommend flagging the room-count-drift case as an explicit backlog item rather than silently ignoring it, since CLAUDE.md's pricing model promises the cap tracks room count.

3. **Where does the projected month-end cost gauge (BILLING-05) compute its projection — backend or frontend?**
   - What we know: All raw inputs (`credits_used`, `period_start`, `period_end`, today's date, `cap_cents`) are already returned or easily addable to `GET /billing/credits`. A simple linear projection (`used / days_elapsed * days_in_period`) needs no new data source.
   - What's unclear: Whether the planner wants this computed server-side (consistent, testable, cacheable) or client-side (zero backend change, but duplicates the "days elapsed" math already implicitly known by the period dates already shipped to the client).
   - Recommendation: Compute server-side in `GET /billing/credits` and add a `projected_month_end_cost_cents` field — keeps the math in one place and matches this codebase's convention of doing calculation in routers, not components (per CLAUDE.md's "Services layer depth" convention — this is router-level logic, not a new service).

4. **Does the 80%-cap alert (BILLING-06) need email, or is in-app/push notification sufficient?**
   - What we know: The `notifications` table (migration 013) supports in-app + push (Expo) delivery today with a free-text `type` column (no CHECK constraint — adding a new type like `billing_cap_warning` requires no migration). Email-based GM alerts exist elsewhere (`routers/internal.py`'s `reports/daily-summary-email` cron, via Resend) but billing has no email hook today.
   - What's unclear: Whether GM-facing billing alerts need the higher-reliability email channel given the financial stakes, or whether in-app/push (consistent with the rest of the alerting system, e.g. safety training escalations) is acceptable.
   - Recommendation: Start with the existing in-app/push `notifications` pattern (`_queue_safety_notification`-style dedup, scoped to "once per billing period" rather than "once per day") since it requires no new infrastructure; treat email escalation as a stretch goal only if time permits, since Resend/email plumbing for billing doesn't currently exist and would be new surface area.

5. **Does BILLING-06's "approaching 80%" alert need to run on a cron, or can it be computed lazily when the GM loads the billing page?**
   - What we know: Nothing currently polls credit usage proactively; all cron jobs in `internal.py` are triggered externally via GitHub Actions on fixed schedules (`0 6 * * *` etc. — no existing "check billing usage" cron).
   - What's unclear: "Proactive alert" implies push/notification (not just a UI banner the GM has to open the app to see), which requires *some* server-side trigger independent of page loads — but adding a new cron job means updating `.github/workflows/cron-jobs.yml` and the CLAUDE.md cron table, which is a larger footprint than a pure UI change.
   - Recommendation: A new lightweight cron (e.g. `POST /v1/internal/billing/usage-alerts`, daily) that checks all active subscriptions' `credit_ledger.overage_cost_cents + base_fee` against `cap_cents * 0.8` and queues a dedup'd notification is the only way to satisfy "proactive" in the literal sense (delivered without the GM opening the app). This is new scope beyond what exists today — confirm with planner whether "proactive" can be satisfied by a prominent banner shown on next page load instead, which would avoid the new cron entirely.

## Sources

### Primary (HIGH confidence)
- Direct codebase read: `apps/api/routers/billing.py`, `webhooks.py`, `internal.py`, `middleware/credits.py`, `hotels.py`, `auth.py`, `apps/web/app/(dashboard)/billing/page.tsx`, `apps/web/app/(dashboard)/settings/billing/page.tsx`, `apps/web/lib/api/billing.ts`, `apps/web/lib/utils/navigation.ts`, `apps/web/app/(dashboard)/settings/layout.tsx`
- Direct migration read: `supabase/migrations/014_billing.sql`, `020_fix_credits_decimal.sql`, `078_evidence_exception_engine.sql`, `013_ai_systems.sql`
- Direct test read: `apps/api/tests/smoke/test_webhooks_and_transitions.py` (existing mocked-Stripe test pattern)
- Context7 `/websites/stripe` — webhook duplicate-event handling guidance (docs.stripe.com/webhooks/signatures), idempotent POST requests (docs.stripe.com/api/idempotent_requests, docs.stripe.com/error-low-level)
- `apps/api/requirements.txt` — confirms `stripe==15.4.0` pinned version

### Secondary (MEDIUM confidence)
- None — all critical claims in this document were verified directly against the current codebase or official Stripe documentation via Context7.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries needed; all versions read directly from `requirements.txt`.
- Architecture / existing-code gaps: HIGH — every finding (dead page, missing `cap_cents`, missing idempotency, missing webhook dedup) was verified by direct file reads, not inference.
- Stripe API patterns (idempotency keys, webhook dedup guidance): HIGH — verified via Context7 against official Stripe docs, not training-data recall.
- Open questions (email vs. in-app alerting, cron vs. lazy check for 80% alert, room-count drift): MEDIUM — these are legitimate product/scope decisions with no single correct answer; recommendations given but planner judgment required.

**Research date:** 2026-08-03
**Valid until:** 30 days (stable domain — Stripe SDK and internal codebase state change slowly; re-verify `cap_cents`/dead-page findings if significant billing work lands between now and planning)
