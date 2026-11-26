# 11 — Commercial Strategy

> **Status:** One all-inclusive subscription is the founder-approved commercial direction (FD-03), and existing
> billing safeguards and controlled-overage contracts are preserved (FD-36). The design principles in §2 are
> **proposed**. Exact pricing, allowances, fair-use rules, exceptional overage and third-party fee treatment are
> **open** (§10). This document changes no billing code, contract, Stripe object or customer term.
> **Baseline:** `origin/main` @ `41995dcb` (2026-11-26). **Authority:** [README § Authority and precedence](README.md#authority-and-precedence).

## 1. Direction

Hotels buy **one PatelRep subscription** that includes every capability domain — Operations, People, Guest, Growth,
Owner and Connect ([02 §3](02-product-constitution.md#3-capability-domains-fd-34)). There are no separately purchased
modules. PatelRep sells measurable results (FD-21); the price is justified by time returned and better operations,
shown with evidence ([09 §8](09-performance-and-impact-engine.md#8-customer-roi)).

## 2. Proposed commercial design

| Principle | Meaning |
|---|---|
| All domains included | Every customer gets the whole platform; readiness, not price, decides what lights up ([07](07-adaptive-intelligence.md)) |
| Avoid restrictive per-seat pricing | Every employee can use PatelRep; inviting the night auditor never costs more |
| Price by property, not by person | Pricing may vary with property size and operating complexity |
| AI included, with sustainable safeguards | AI is part of the product, bounded by fair-use rules and pre-flight cost controls (§7) |
| Transparent integration expenses | Any cost PatelRep incurs to connect a provider is disclosed in advance (§8) |
| No surprise charges | Nothing is billed that the customer did not see coming and agree to |
| Third-party subscriptions stay separate | The hotel keeps paying its PMS, payroll and other vendors directly |
| Cost visibility per property | AI, API, infrastructure, onboarding and support costs are tracked per property (§6) |

## 3. What is implemented today

Verified in code at the baseline:

| Element | Implemented behavior | Evidence |
|---|---|---|
| Base fee | 9,900 cents per month | `apps/api/middleware/credits.py` (`BASE_FEE_CENTS`), `apps/api/routers/hotels.py` |
| Trial | 30 days, status `trialing` | `apps/api/routers/hotels.py` |
| Included AI credits | 5,000 per billing period | `supabase/migrations/014_billing.sql`, `apps/api/middleware/credits.py` |
| Credit price | Overage billed at 2 cents per credit by generated ledger columns | `supabase/migrations/014_billing.sql` (recreated in 020) |
| Metering | Credits from actual provider token usage, with per-feature minimums; `DOLLARS_PER_CREDIT` converts provider cost into credits | `apps/api/middleware/credits.py` |
| Cap | `cap_cents = room_count × 250`, set when the hotel is created and applied to the whole bill including the base fee | `apps/api/routers/hotels.py`, `apps/api/middleware/credits.py` |
| Enforcement | A pre-check refuses metered AI calls at the cap with HTTP 402 before any provider spend; a GM sees an 80 % warning, computed when the credits view is opened, with the base fee counted as spend | `apps/api/middleware/credits.py`, `apps/api/routers/billing.py` |
| True-up | Monthly Stripe true-up on days 1–3 at 01:00 UTC through a durable outbox (migration 250); cancellations held for manual review until a cancellation policy is decided | `apps/api/core/scheduler.py`, `apps/api/routers/billing.py` |
| Agent billing (H4) | Versioned two-person pricing policies, pre-dispatch holds, GM-only overage consent; **default disabled**, Stripe test mode only, live Stripe refused in code and by a constraint | [agent-harness/customer-billing.md](../agent-harness/customer-billing.md), [ADR-0003](../agent-harness/adr-0003-h4-customer-billing.md) |

## 4. Conflicts with the all-inclusive direction

These are recorded, **not changed**. Active billing contracts and live billing behavior stay exactly as they are
until a reviewed commercial decision and its implementation land ([CF-02](15-strategic-decision-register.md#9-conflicts-and-recommended-resolutions)).

| Statement or behavior | Where | Issue |
|---|---|---|
| "$99/mo + $0.02/AI credit, cap $2.50/room/month" | `CLAUDE.md`, `README.md` | Usage-priced AI rather than AI included |
| "$99 / month" and "Plus $0.02 per AI credit, capped at $2.50 per room each month" | `apps/web/app/page.tsx` (public site) | Public pricing copy; must change in step with any new terms |
| "1-month free trial with 10,000 AI credits" | `apps/api/routers/onboarding.py` (onboarding assistant prompt) | Contradicts the 5,000 credits the code provisions |
| "AI spend cap" in billing UI vs. a whole-bill cap in code vs. an H4 "overage cap" that excludes the plan fee | `apps/api/routers/billing.py`, web billing components | One word, three meanings |
| Two overage regimes on one ledger | Legacy AI overage bills automatically up to the cap; agent overage requires GM consent | Inconsistent consent model |
| Product name "PatelRep Pro" vs "PatelRep Base" | `apps/api/routers/billing.py`, `apps/api/LAUNCH_CHECKLIST.md` | Naming drift |
| Small properties | With `cap_cents = rooms × 250` and a 9,900-cent base inside the cap, a property under 40 rooms has negative headroom, so the pre-check refuses every metered AI call (copilot, SOP answers, shift summaries), including during the trial, and the included credits can never be used; unmetered paths still incur provider cost. Onboarding accepts 1 to 1,000 rooms (`apps/api/models/requests.py`), so such hotels can be created today (code reading; not exercised) | A defect in an existing billing safeguard: behavior stays unchanged until it is decided in the OC-01/OC-02 package ([CF-02](15-strategic-decision-register.md#9-conflicts-and-recommended-resolutions)) |
| 80 % warning for small properties | The warning counts the base fee as spend, so at 49 rooms or fewer it fires with zero AI usage | Decide together with the cap (CF-02) |
| `.planning/PROJECT.md` says overage before a mid-cycle cancellation is invoiced | `.planning/PROJECT.md` | Code now holds cancellations for manual review |

## 5. Transition principles

Proposed. When the all-inclusive model is designed (OC-01 to OC-05):

1. **Never silently rewrite an active contract.** Existing customers keep their terms until they agree to new ones.
2. **Notice before change**, in writing, with the old and new terms side by side.
3. **No retroactive charges.** Usage settled while billing was disabled is never billed (the existing H4 answer to
   "unbilled work", [customer-billing.md §13](../agent-harness/customer-billing.md)).
4. **Consent for anything beyond the plan.** Exceptional overage, if kept, requires explicit GM consent with caps —
   the H4 pattern — for every kind of usage, not only agents.
5. **One implementation path.** Billing changes go through reviewed code and migrations, the two-person pricing-policy
   process, Stripe test mode and a staged activation ([customer-billing.md §12](../agent-harness/customer-billing.md)).

## 6. Cost tracking per property

| Cost | Source today | Gap |
|---|---|---|
| AI model usage | Credits from actual tokens (`middleware/credits.py`); USD provider-spend ledger for the harness (H3) | Several AI calls, including a nightly prediction job and embeddings, are not metered ([CF-23](15-strategic-decision-register.md#9-conflicts-and-recommended-resolutions)) |
| Integration and API usage | None | PatelRep Connect metering per provider and property (PA-13, [05 §7](05-integration-strategy.md#7-usage-metering-and-cost-governance)) |
| Infrastructure | Not allocated per property | Allocation method (TD-21) |
| Onboarding and support | Not recorded | Time tracking for internal staff |

Per-property cost is internal information used to keep pricing sustainable; it is never shown to hotels as a charge
they did not agree to.

## 7. AI usage safeguards under an all-inclusive plan

Proposed safeguards; the allowance values and rules are open (OC-02).

* **Fair use, defined by property** (OC-02): allowances may scale with property size and complexity, and are
  published in advance.
* **Pre-flight before spend**: allowance and readiness checks run before any paid call (existing pattern).
* **Graceful degradation**: at a limit, free paths keep working — rule-based parsing, phone-side answers, cached
  results — as they already do at today's cap ([MOBILE_HOUSEKEEPER_AI.md §6](../MOBILE_HOUSEKEEPER_AI.md)).
* **Early warning**: managers see usage trends and thresholds before anything is restricted.
* **Exceptional overage only with consent** (OC-03), never automatic.

## 8. Integration expenses

* A hotel's own software subscriptions are paid by the hotel to its vendors.
* Costs PatelRep incurs to connect a provider (partner programs, per-call API fees, unified-integration-provider
  fees) are disclosed per provider before the hotel connects it. Whether they are included, passed through at cost or
  covered by an allowance is open (OC-04).
* No connection is enabled in a way that creates a cost the hotel was not shown.

## 9. Go-to-market principles

* Lead with results; show Hours Returned and operational outcomes with evidence classes.
* Pilot first, then convert using the property's own measured results ([12](12-customer-pilot-strategy.md)).
* Customer names, quotes and results are used only with written permission.
* The founder handles commercial agreements, payments, partner applications and third-party authorizations (FD-28).

## 10. Open commercial decisions

| Id | Decision |
|---|---|
| OC-01 | Price structure and levels: property-size bands and complexity factors |
| OC-02 | Included AI allowances and fair-use rules |
| OC-03 | Whether exceptional overage exists, and its consent and cap model |
| OC-04 | Treatment of third-party integration fees |
| OC-05 | Transition terms for existing customers on the current plan |
| OC-06 | Pilot commercial terms for the founder's hotel |
| OC-07 | Agent usage allowance, markup and credit price (H4 open decisions) |
| OC-08 | Cancellation billing policy (H4 F5) |
| OC-09 | Customer-facing consent terms and their versioning (H4) |
| OC-10 | Onboarding and implementation fees, if any |
| OC-11 | Portfolio and multi-property pricing |
| OC-12 | Contract length, billing frequency and service commitments |

All are tracked in the [decision register](15-strategic-decision-register.md#3-open-commercial-decisions).
