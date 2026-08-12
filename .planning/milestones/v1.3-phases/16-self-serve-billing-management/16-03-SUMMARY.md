---
phase: 16-self-serve-billing-management
plan: 03
subsystem: billing
tags: [fastapi, stripe, idempotency, cron, tdd]

requires: ["16-01", "16-02"]
provides:
  - "true_up_tenant(tenant_id, period_start, require_active=, require_period_ended=, today=) in billing.py -- single source of truth for per-tenant monthly-overage invoicing idempotency"
  - "run_monthly_trueup(*, today=) in internal.py, testable pure function queried by period_end<=today AND is_finalized=False"
  - "Final true-up on customer.subscription.deleted before the cancellation status flip"
affects: []

tech-stack:
  added: []
  patterns:
    - "credit_ledger.is_finalized/finalized_at/stripe_invoice_id as the durable idempotency stamp, not Stripe's Idempotency-Key alone (which expires after 24h and cannot protect against re-firing on a later night)"
    - "require_period_ended gate defaults True for the cron path, explicitly bypassed (False) only by the cancellation path where cancellation IS the terminating event"

key-files:
  created:
    - apps/api/tests/test_billing_trueup.py
  modified:
    - apps/api/routers/billing.py
    - apps/api/routers/internal.py
    - apps/api/routers/webhooks.py

key-decisions:
  - "true_up_tenant reads credit_ledger's own generated overage_credits/overage_cost_cents columns instead of recomputing in Python, keeping it in sync with get_credits()'s math"
  - "A true-up failure on subscription.deleted is logged but never blocks the cancellation flip -- a failed Stripe call must not trap a hotel in permanent active limbo"

patterns-established:
  - "Cron testability convention (run_X(*, today=...) pure function + thin route wrapper) now also covers billing.monthly-trueup, matching safety-training/drill-follow-up cron shapes already in internal.py"

duration: ~40min
completed: 2026-08-04
---

# Phase 16 Plan 03: Monthly True-Up Idempotency Summary

**`true_up_tenant()` makes the monthly overage-invoicing cron idempotent via `credit_ledger.is_finalized`, refuses to finalize a period before it has actually ended (closing the revenue-leak the plan checker flagged), and is reused by the cancellation webhook to bill final overage before a mid-cycle cancel.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-08-04
- **Tasks:** 2 completed
- **Files modified:** 4 (3 router files + 1 new test file)

## Accomplishments

- `internal.py::monthly_trueup` no longer double- or triple-bills a hotel's overage across its own 2-4x/month cron schedule (`0 0 28-31 * *`) — `true_up_tenant()` checks `credit_ledger.is_finalized` before invoicing anything, and the cron's own outer query additionally pre-filters to `period_end <= today` (BILLING-07).
- `true_up_tenant()` refuses to finalize a billing period while `today < ledger.period_end`, so an early cron firing (e.g. day 28 of a 30-day month) can no longer permanently drop the last 1-3 days of usage from billing — a distinct revenue-leak from plain double-billing, since `increment_credits_used()` (migration 020) no-ops once `is_finalized` is `TRUE`.
- Overage accrued before a mid-cycle self-serve cancellation (Stripe Customer Portal) is now invoiced by the `customer.subscription.deleted` handler calling `true_up_tenant(..., require_active=False, require_period_ended=False)` before the `plan_status` flip to `cancelled` (BILLING-08).
- The new cancellation-triggered true-up automatically inherits 16-02's event-id dedup gate (it sits before the entire `event.type` dispatch chain), so a retried `subscription.deleted` delivery cannot double-invoice.

## Task Commits

1. **Task 1: true_up_tenant() with is_finalized idempotency; rewire monthly_trueup** - `9d8489a4` (feat)
2. **Task 2: Final true-up on customer.subscription.deleted, before the cancellation flip** - `7a906d8a` (feat)

_Both tasks followed strict TDD (RED confirmed — 12 of 13 new tests failed before implementation, since `true_up_tenant` didn't exist yet — then GREEN)._

## Files Created/Modified

- `apps/api/routers/billing.py` — new `true_up_tenant()` function (not a route), plus `logging`/`datetime`/`timezone` imports
- `apps/api/routers/internal.py` — `monthly_trueup`'s inline invoicing logic replaced by `run_monthly_trueup(*, today=...)` (pure, testable) + a thin route wrapper; response shape changed from `{"invoices_created", "errors"}` to `{"invoiced", "errors", "skipped"}` (confirmed no test/frontend reads the old keys)
- `apps/api/routers/webhooks.py` — `customer.subscription.deleted` branch now calls `true_up_tenant()` (wrapped in try/except so a Stripe failure never blocks cancellation) before the `plan_status` update
- `apps/api/tests/test_billing_trueup.py` — new file, 13 tests (10 for Task 1, 3 for Task 2), TDD RED→GREEN

## Decisions Made

None beyond what the plan specified — implementation followed the plan's provided code and test list exactly, including the plan's explicit warning to read `credit_ledger`'s own generated `overage_credits`/`overage_cost_cents` columns rather than recompute in Python.

## Deviations from Plan

None — plan executed exactly as written. Every test, function signature, and call-site override (`require_active=False, require_period_ended=False` on the cancellation path) matches the plan's specified code verbatim.

## Verification

- `cd apps/api && python -m pytest tests/test_billing_trueup.py -q` — 13/13 pass.
- `cd apps/api && python -m pytest tests/ -q` — 546/548 pass. The 2 failures (`test_management_roi.py::test_roi_downtime_revenue_uses_tenant_adr`, `test_roi_housekeeping_efficiency_pairs_in_progress_to_clean`) are the same pre-existing, unrelated baseline failures already documented in `16-01-SUMMARY.md` and `.planning/STATE.md` — confirmed present before this plan's changes (only 2 failures both before and after Task 1/Task 2, and neither touches `management_roi.py`, `billing.py`, `internal.py`, or `webhooks.py`).
- Manual reasoning check: grepped both `true_up_tenant(...)` call sites — `internal.py`'s cron caller relies on the default `require_period_ended=True`; `webhooks.py`'s cancellation caller explicitly passes `require_period_ended=False`. Neither was left at the wrong default.

## Issues Encountered

**Stale claim found and corrected:** `16-02-SUMMARY.md`'s "Next Phase Readiness" section stated Plan 16-03 was "already executed (commit `c44bf49a`)" — that commit was actually a plan-revision commit made during checker feedback (only `.planning/phases/16-self-serve-billing-management/16-01-PLAN.md` and `16-03-PLAN.md` were touched, both `.md` planning documents, zero application code). Verified via `git show --stat` and by grepping `apps/api/routers/` for `true_up_tenant`/`run_monthly_trueup` before starting — neither existed in code prior to this session. This plan was executed for real in this session; `16-02-SUMMARY.md`'s stale claim should be disregarded for future reference.

## Self-Check: PASSED

- FOUND: apps/api/routers/billing.py (`def true_up_tenant` present)
- FOUND: apps/api/routers/internal.py (`def run_monthly_trueup` present, calls `true_up_tenant`)
- FOUND: apps/api/routers/webhooks.py (`true_up_tenant(` call in `customer.subscription.deleted` branch)
- FOUND: apps/api/tests/test_billing_trueup.py (13 tests, all passing)
- FOUND commit 9d8489a4
- FOUND commit 7a906d8a

---
*Phase: 16-self-serve-billing-management*
*Completed: 2026-08-04*
