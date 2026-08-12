---
phase: 16-self-serve-billing-management
plan: 02
subsystem: payments
tags: [stripe, webhooks, idempotency, fastapi]

# Dependency graph
requires: []
provides:
  - "stripe_webhook_events(event_id PK, event_type, processed_at) table (migration 090)"
  - "Insert-or-skip dedup guard in stripe_webhook() covering every event.type branch"
affects: [16-03-self-serve-billing-management]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Idempotency-by-event-id guard placed immediately after signature verification, before any handler dispatch, so all current and future event.type branches inherit dedup protection automatically"

key-files:
  created:
    - supabase/migrations/090_stripe_webhook_events.sql
  modified:
    - apps/api/routers/webhooks.py
    - apps/api/tests/smoke/test_webhooks_and_transitions.py

key-decisions:
  - "Insert-or-skip dedup (select-then-insert), not a DB UNIQUE-constraint race guard — a duplicate delivery landing inside the race window is an accepted, extremely low-probability residual risk per 16-RESEARCH.md"

patterns-established:
  - "Any future Stripe event handler added to stripe_webhook()'s elif chain is automatically covered by the dedup gate — no per-handler idempotency work needed"

# Metrics
duration: resumed session (Task 1 completed in a prior interrupted session, Task 2 completed this session)
completed: 2026-08-04
---

# Phase 16 Plan 02: Stripe Webhook Event Deduplication Summary

**Insert-or-skip dedup guard on `stripe_webhook_events(event_id)` added to the top of `stripe_webhook()`, so Stripe's documented at-least-once retry delivery can no longer double-run any handler side effect (BILLING-09).**

## Performance

- **Tasks:** 2 completed
- **Files modified:** 3 (1 new migration, 1 router, 1 test file)

## Accomplishments
- New `stripe_webhook_events` table (migration 090), PK-only, no RLS, mirroring the `cron_health` (migration 068) service-role-only convention
- `stripe_webhook()` now selects on `event.id` before any handler runs; if found, returns `{"status": "duplicate_ignored"}` as a no-op; if not found, inserts the row and proceeds through the existing `event.type` dispatch unchanged
- Guard is placed before the `event.type in (...)` chain, so it uniformly protects all current handlers (`customer.subscription.created/updated`, `customer.subscription.deleted`, `checkout.session.completed`, `invoice.payment_failed`, `invoice.paid`) and any handler Plan 16-03 adds later

## Task Commits

Each task was committed atomically:

1. **Task 1: stripe_webhook_events table** - `760891a1` (feat) — completed in a prior interrupted session
2. **Task 2: Event-ID dedup guard in stripe_webhook()** - `fb5de5ed` (feat) — completed this session

## Files Created/Modified
- `supabase/migrations/090_stripe_webhook_events.sql` - New `stripe_webhook_events` table (event_id PK, event_type, processed_at), not applied to remote Supabase project per established convention (deployment handled separately)
- `apps/api/routers/webhooks.py` - Dedup guard inserted into `stripe_webhook()` immediately after `construct_event`'s try/except, before the `event.type` dispatch chain
- `apps/api/tests/smoke/test_webhooks_and_transitions.py` - `stripe_event()` helper extended with an `event_id` param (default `"evt_test_default"`, so the 3 pre-existing stripe tests pass unmodified); both existing stripe tests' `FakeDB` seeds gained `"stripe_webhook_events": []`; 2 new tests added: duplicate `event.id` is ignored with the handler never running (subscription `plan_status` stays unchanged), and a new `event.id` is recorded in `stripe_webhook_events` and its handler runs normally

## Decisions Made
None beyond what the plan specified - followed the plan's exact select-then-insert approach and accepted the documented low-probability race-window risk rather than adding DB-level unique-constraint race handling (out of scope, called out explicitly in the plan).

## Deviations from Plan

None - plan executed exactly as written. Task 1's migration file and Task 2's implementation both match the plan's specified code verbatim.

## Issues Encountered

This plan's execution was resumed after a prior session was interrupted mid-Task-2 by a session/usage limit (not a code failure). On resume, the working tree already contained a complete, correct implementation of Task 2 (dedup guard + both new tests + `stripe_webhook_events: []` seed additions on the 2 pre-existing tests) — verified against the plan's task breakdown line-by-line before committing, no rework needed. The working tree at resume time also contained unrelated uncommitted changes to `apps/api/middleware/credits.py`, `apps/api/routers/billing.py`, `apps/api/routers/hotels.py`, and a new `apps/api/tests/test_billing_usage.py` — these belong to Plan 16-01 (a separate, still-in-flight plan being executed concurrently by a different agent) and were deliberately left untouched and uncommitted by this plan; only the 2 files in this plan's `files_modified` list were staged and committed.

Full API suite run showed 3 pre-existing failures unrelated to this plan's changes (confirmed via `git stash` isolation of just this plan's 2 files): `test_billing_credits_hotel_a_returns_no_data_message` (caused by Plan 16-01's in-flight uncommitted `billing.py` changes) and 2 `test_management_roi.py` failures (already documented in STATE.md as a pre-existing baseline flake predating this plan). This plan's own test file (`test_webhooks_and_transitions.py`, 17 tests) is fully green in isolation.

## User Setup Required

None - no external service configuration required. Migration 090 is written but deliberately not applied to the remote Supabase project (deployment handled separately, matching the established convention from prior phases).

## Next Phase Readiness
- BILLING-09 closed. Plan 16-03 (BILLING-07/08, `customer.subscription.deleted` final true-up logic) already executed (commit `c44bf49a`) and now inherits dedup protection retroactively via this plan's guard, since the guard sits before the entire `event.type` dispatch chain regardless of commit order.
- Migration 090 still needs to be applied to the remote Supabase project before this dedup guard is live in production — flagged as a deployment follow-up, consistent with how migrations 086/087/089 were handled.

---
*Phase: 16-self-serve-billing-management*
*Completed: 2026-08-04*
