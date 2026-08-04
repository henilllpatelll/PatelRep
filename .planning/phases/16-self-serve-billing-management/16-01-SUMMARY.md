---
phase: 16-self-serve-billing-management
plan: 01
subsystem: billing
tags: [fastapi, supabase, credit-ledger, notifications, tdd]

requires: []
provides:
  - "get_or_create_current_period_ledger() shared helper in middleware/credits.py, used by both the AI-call deduction path and GET /billing/credits"
  - "subscriptions.cap_cents set at hotel creation (room_count * 250)"
  - "GET /billing/credits returns cap_remaining_cents, projected_month_end_cost_cents, approaching_cap"
  - "billing_cap_warning in-app notification, deduplicated to once per billing period"
affects: [16-04-frontend-billing-page]

tech-stack:
  added: []
  patterns:
    - "Lazy-create current-period ledger shared between AI-call path and read path, eliminating duplicate query logic"
    - "Once-per-period notification dedup via .contains('data', {period}) mirroring internal.py::_queue_safety_notification's once-per-day dedup shape"

key-files:
  created:
    - apps/api/tests/test_billing_usage.py
  modified:
    - apps/api/middleware/credits.py
    - apps/api/routers/billing.py
    - apps/api/routers/hotels.py
    - apps/api/tests/smoke/test_tenant_isolation.py

key-decisions:
  - "Notification is queued lazily on the next GET /billing/credits call (billing page load), not by an independent scheduled check — avoids a new cron/delivery channel, per 16-RESEARCH.md Open Question 5"
  - "cap_cents drift when room_count changes post-creation (PATCH /hotels/{id}) is an accepted, out-of-scope gap per 16-RESEARCH.md Open Question 2"

patterns-established:
  - "Shared lazy-create helper pattern: extract inline lazy-create logic into a reusable function when a second read path needs the same 'never stale/missing' guarantee"

duration: ~45min
completed: 2026-08-04
---

# Phase 16 Plan 01: Billing Usage Accuracy Summary

**Fixed four backend data-accuracy gaps (BILLING-02/03/05/06) that made the self-serve billing page show placeholder/missing data: lazy ledger creation now shared with the read path, cap_cents actually set at hotel creation, month-end cost projection and cap headroom added to the credits endpoint, and an 80%-cap notification deduplicated to once per period.**

## Performance

- **Duration:** ~45 min (resumed from a prior interrupted session; Task 1 code was already present uncommitted and was verified/corrected before committing)
- **Completed:** 2026-08-04
- **Tasks:** 2 completed
- **Files modified:** 5 (4 plan-scoped + 1 out-of-scope regression fix in an adjacent test file)

## Accomplishments
- `GET /billing/credits` no longer returns a "No billing period found" placeholder for a GM opening the billing page before any AI call has run that period — it now lazily creates and returns a real zero-usage ledger, sharing the exact same code path `check_and_deduct_credits` already used (BILLING-02).
- New hotels get a non-null `subscriptions.cap_cents = room_count * 250`, so the existing cap-enforcement check in `credits.py` actually fires instead of silently no-op'ing on a NULL cap (BILLING-03).
- `GET /billing/credits` now returns `cap_remaining_cents` (headroom before the cap) and `projected_month_end_cost_cents` (linear extrapolation of overage cost from elapsed days to the full period), computed server-side (BILLING-05).
- Crossing 80% of the spend cap queues exactly one `billing_cap_warning` in-app notification per billing period, regardless of how many times the billing page is loaded (BILLING-06).

## Task Commits

1. **Task 1: Extract shared lazy-create ledger helper; set cap_cents at hotel creation** - `c4fc69c4` (feat)
2. **Task 2: Cap headroom, month-end cost projection, and 80%-cap notification** - `2b004d60` (feat)

_Both commits include their TDD test coverage (RED tests were written first each task, then GREEN implementation, all in one commit per task since the task boundary was the natural review unit)._

## Files Created/Modified
- `apps/api/middleware/credits.py` - Added `get_or_create_current_period_ledger()`; `check_and_deduct_credits` now calls it instead of an inline duplicate query
- `apps/api/routers/billing.py` - `get_credits` now uses the shared helper and returns `cap_remaining_cents`/`projected_month_end_cost_cents`/`approaching_cap`; new `_queue_cap_warning()` helper
- `apps/api/routers/hotels.py` - `create_hotel`'s subscriptions insert now includes `cap_cents: body.room_count * 250`
- `apps/api/tests/test_billing_usage.py` - New file, 8 tests (4 Task 1 + 4 Task 2), TDD RED→GREEN
- `apps/api/tests/smoke/test_tenant_isolation.py` - Updated one pre-existing test (see Deviations)

## Decisions Made
None beyond what the plan specified — implementation followed the plan's provided code closely.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/regression] Existing tenant-isolation test asserted the now-obsolete placeholder message**
- **Found during:** Task 1 full-suite regression run
- **Issue:** `tests/smoke/test_tenant_isolation.py::test_billing_credits_hotel_a_returns_no_data_message` asserted `GET /billing/credits` returns `{"message": "No billing period found"}` for a hotel with no `credit_ledger` row — this was the exact BILLING-02 bug this plan was written to fix, so the test broke by design once the fix landed.
- **Fix:** Renamed to `test_billing_credits_hotel_a_gets_isolated_zero_usage_ledger` and rewrote assertions to verify the new correct behavior: a lazily-created, zero-usage ledger scoped to Hotel A, with no leakage of Hotel B's `cap_cents` (25000) into Hotel A's response. Preserves the test's actual intent (tenant isolation on the billing endpoint) rather than the stale behavior it happened to assert.
- **Files modified:** `apps/api/tests/smoke/test_tenant_isolation.py`
- **Verification:** `pytest tests/smoke/test_tenant_isolation.py -q` — 39/39 pass; full suite 533/535 (2 pre-existing unrelated `test_management_roi.py` failures, confirmed pre-existing via STATE.md history predating this plan)
- **Committed in:** `c4fc69c4` (part of Task 1 commit)

**Note on resume context:** this plan was resumed after a prior executor session was interrupted mid-task by a usage limit, not a code failure. Task 1's implementation (credits.py, billing.py, hotels.py edits, and the first 4 tests in test_billing_usage.py) was found already correctly written and uncommitted in the working tree, matching the plan's spec exactly. It was verified (tests run, full suite checked) rather than redone, then committed. A concurrent, unrelated executor (plan 16-02, Stripe webhook dedup) was also active in the same working tree during this session — `apps/api/routers/webhooks.py` and `apps/api/tests/smoke/test_webhooks_and_transitions.py` had uncommitted changes outside this plan's file scope; those were deliberately left untouched and excluded from every `git add` in this plan's commits.

## Self-Check: PASSED

- FOUND: apps/api/middleware/credits.py (get_or_create_current_period_ledger present)
- FOUND: apps/api/routers/billing.py (projected_month_end_cost_cents present)
- FOUND: apps/api/routers/hotels.py (cap_cents present)
- FOUND: apps/api/tests/test_billing_usage.py (8 tests, all passing)
- FOUND commit c4fc69c4
- FOUND commit 2b004d60
