# ADR-0003: H4 customer billing, reconciliation and controlled overage

- **Status:** Accepted for H4 (implemented, default disabled, not activated anywhere).
- **Date:** 2026-11-15
- **Builds on:** ADR-0002 (H3 provider-spend ledger). Nothing in ADR-0002 is withdrawn.

## Context: what the audit found (H4.1)

The financial flow was traced from an AI call to Stripe before anything changed.

**Legacy AI usage (live today).** `middleware/credits.py` turns provider token usage into credits (`compute_credits`,
with a per-feature floor). `assert_ai_allowance` refuses before a provider call once the hotel is at its cap.
`check_and_deduct_credits` then adds the credits to the open `credit_ledger` row in one statement (`deduct_ai_credits`,
migration 217), and `log_ai_interaction` writes `ai_interactions`. `credit_ledger.overage_cost_cents` is a generated
column at 2 cents/credit (migrations 014/020). `routers/billing.py::true_up_tenant` creates one Stripe **invoice item**
per period. It is called by the in-process scheduler (`billing.monthly-trueup`) and by `customer.subscription.deleted`.

**H3 agent usage (not activated).** `agent_model_attempts` / `agent_model_spend_events` (migrations 244–245) hold USD
**provider expense**. Nothing derived customer credits from them.

**Writers.**

| Table | Writers |
|---|---|
| `credit_ledger` | `get_or_create_current_period_ledger` (insert), `deduct_ai_credits` / `increment_credits_used` (usage), `true_up_tenant` (finalize + Stripe id), `invoice.paid` webhook (Stripe id). **H4 adds:** the H4 RPCs (agent breakdown columns + `credits_used` for agent charges). |
| `ai_interactions` | `log_ai_interaction` only (legacy). H4 never writes it. |
| `subscriptions` | hotel creation, Stripe webhooks (`customer.subscription.*`, `checkout.session.completed`, `invoice.payment_failed`). H4 only reads it. |
| Stripe invoice items | `true_up_tenant` (legacy). **H4 adds** the outbox processor (test mode only, not scheduled). No code creates Stripe invoices. |
| `agent_model_attempts` / `agent_model_spend_events` | H3 RPCs only. The H4 wrappers call the H3 RPCs; they never write these tables directly. |

**Findings (fixed in this PR, each with a regression test):**

- **F1: invoice item ids were stored as invoice ids.** `true_up_tenant` wrote the `ii_…` id into
  `credit_ledger.stripe_invoice_id`. Separately, `invoice.paid` wrote the real `in_…` id onto whichever period was
  *current* on the day the webhook arrived. The overage item for month N sits on the renewal invoice paid in month N+1,
  so that stamp landed on the wrong period. Fix: a new `stripe_invoice_item_id` column holds the item id.
  `invoice.paid` now stamps only the ledger whose item is on that invoice's lines.
- **F2: fractional cents were sent to Stripe.** `overage_cost_cents` is NUMERIC(10,4), so a fractional amount made
  `InvoiceItem.create` fail. That period then never finalized and failed again every night. Fix: the amount is
  rounded once, half up, to whole cents, as migration 020 documented.
- **F3: the last day of every month was dropped.** `period_end` is the last day and is inclusive. Both the cron query
  (`period_end <= today`) and `true_up_tenant` (`today < period_end`) treated that day as already over. The cron fires
  at 00:00 on days 28–31, so on the last day it finalized at midnight. `increment_credits_used` / `deduct_ai_credits`
  ignore finalized rows, so all usage on that day was never billed. Fix: a period ends only after its last day, and the
  job runs on days 1–3.
- **F4: `invoice.payment_failed` read a field that no longer exists.** It read top-level `invoice.subscription`, which
  is gone in current Stripe API versions (now `parent.subscription_details.subscription`). Fix: both shapes are
  accepted.

**Hardening findings (fixed in migration 250, each with negative real-database tests):**

- **F9: the bare H3 dispatch RPC bypassed revoked or stale authorization.** Migration 249's trigger only required that
  a `held` hold existed. Calling `agent_model_attempt_dispatch` directly dispatched a held attempt after the GM revoked
  overage, after the policy was superseded or retired, or after consent was narrowed below the overage already held
  (all reproduced on a real database, including changes committing during the dispatch). Fix:
  `agent__customer_dispatch_refusal()` is the single definition of a dispatchable hold. The trigger enforces it for
  every writer while billing is enforced, and the H4 wrapper uses it too. It serializes with policy changes (shared
  advisory lock) and consent changes (ledger row lock). With billing disabled the trigger stays a no-op.
- **F6 (fixed): duplicate legacy charge after a failed stamp.** Reproduced on a real database. Stripe accepted the
  item, the record write failed, and the retry after the 24-hour key window created a second item. Fix: the legacy
  true-up now runs through `billing_trueup_operations`, a durable outbox built on the same concepts as H4's.
  There is one operation per hotel-month, created with the ledger finalization before any Stripe call. Its id is the
  idempotency key and item metadata. The worker searches before every create, reconciles ambiguous outcomes, and stops
  in `manual_intervention` on unexplained legacy-format items. Already-finalized periods are never touched.
- **F7 (fixed): webhook retry after failure.** A failed handler now releases the event's de-duplication marker (HTTP
  500), so Stripe's redelivery is processed. Invoice events use the item ids from every page of invoice lines.
- **F5 (contained): cancellation billing.** `customer.subscription.deleted` now records the period in the legacy
  outbox as `manual_intervention` (`cancellation_policy_pending`). It never submits anything to Stripe and never
  finalizes the ledger. An operator cannot resubmit it until a commercial policy is approved.

**Findings documented, not changed (they need a product or ops decision, see customer-billing.md §12):**

- **F5 (policy still open):** whether and how to bill legacy overage at cancellation (final invoice or no charge).
  Until it is decided, cancellations stay in manual review (see above).
- **F7 (residual):** de-duplication is still select-then-insert. A duplicate delivery inside that window is harmless
  because every handler is idempotent.
- **F8: a NULL `cap_cents` means no cap.** For legacy usage that is unchanged pricing. For agent usage H4 requires a
  non-null policy cap.

## Decision

| Concern | Decision |
|---|---|
| Customer total | `credit_ledger.credits_used` stays the single customer-facing total. H4 adds *breakdown* columns (`agent_credits_used`, `agent_overage_credits`, `agent_overage_usd`, `agent_held_*`), updated in the same statement as `credits_used`. There is no second balance. The reconciler checks the breakdown against the journal and open holds exactly. |
| Charge source | Only **settled, costed** H3 provider expense. Uncertain/unreconciled attempts keep their hold in `awaiting_reconciliation` with no charge. Missing evidence is never estimated. |
| Charge identity | One charge per H3 attempt, enforced by a partial unique index. Retries, replays, crashes and concurrent reconcilers converge on that row. Corrections are compensating, two-person adjustments; a charge is never edited. |
| Pre-dispatch authorization | A customer-credit **hold** is created in the same transaction as the H3 provider reservation. If the customer cannot cover the conservative quote, the provider reservation is released in that transaction. Dispatch re-checks hold, policy and consent immediately before the H3 dispatch marker. A trigger on `agent_model_attempts` refuses any `reserved → dispatched` without a live hold while billing is enforced, so calling the bare H3 RPC cannot bypass billing. Since migration 250 the same trigger also re-verifies the policy and the overage consent through `agent__customer_dispatch_refusal()`, the single check shared with the wrapper. |
| Pricing policy | Versioned per hotel. Proposed by one operator and approved by a different one. Immutable once approved. Charges snapshot the policy id and rates. `usd_per_credit` must equal the legacy 2 cents while both kinds of usage share `credit_ledger` (otherwise one balance would mean two prices). |
| Overage consent | Append-only versions. Only the hotel's active GM can authorize or revoke, via the authenticated API, and the database re-verifies the GM. Authorizing requires the exact current policy id, its terms version and the exact server-computed maximum charge. Consent is bound to a policy, so a new policy pauses overage until it is reconfirmed. Revocation applies to every undispatched hold. Already-incurred charges remain. |
| Caps | Per billing period. (a) The GM's authorized overage credits. (b) The policy's hard agent-overage cap in USD (always set). (c) The subscription's `cap_cents` whole-bill cap when set. All three are checked under the ledger row lock, so concurrent requests cannot pass them. |
| Legacy vs. H4 billing | Legacy bills **only** legacy overage: total overage minus the consented agent overage, with the whole-bill cap applied. H4 bills **only** consented agent overage, through its own outbox. With no agent usage, the legacy amount is unchanged. |
| Stripe strategy | One invoice item per (hotel, period, sequence) operation, created with `subscription=<active sub>` so Stripe adds it to that subscription's next scheduled invoice. No standalone invoices. Cancelled or inactive subscriptions are never auto-billed. |
| Durable idempotency | The outbox row id is the Stripe idempotency key *and* item metadata. Before every create, the worker searches the customer's items for that metadata. An ambiguous outcome is reconciled before anything is sent again, so a retry long after Stripe prunes keys cannot double-bill. |
| Activation | Independent default-off gates: DB `customer_billing_mode`, DB `stripe_trueup_enabled`, process gates `AGENT_BILLING_*` (refused in production), `H4_LIVE_STRIPE_SUPPORTED = False`, and `livemode = false` constrained in the outbox table. Nothing is scheduled. |

## Rejected alternatives

- **A separate agent credit balance:** two balances drift, and the hotel would see two allowances.
- **Charging from H3 reservations or exposure:** it bills money that may never have been spent.
- **A post-call check only:** the provider would already be paid by the time the customer limit is checked.
- **Standalone invoices per period:** they risk double presentation alongside the subscription invoice and add payment
  flows that PatelRep does not have.
- **Trusting Stripe idempotency alone:** keys can be pruned after 24 hours.
- **Moving legacy usage onto H4 in this PR:** it would change live billing for every hotel without a product decision.

## Consequences

- One extra row lock (the hotel's `credit_ledger` row) per paid agent attempt. Holds and legacy deductions serialize per
  hotel (short transactions).
- A provider overrun above the reservation is PatelRep's expense, recorded as `uncharged_overrun_credits`. It is never
  billed above the customer's authorization.
- Late charges, e.g. an operator reconciling an attempt after the period was billed, are journaled with `late = true`.
  They do not rewrite a finalized ledger, and they are billed in the next outbox sequence for that period.
