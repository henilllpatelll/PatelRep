---
phase: 05-guest-recovery-and-management-roi
fixed_at: 2026-07-25T00:00:00Z
review_path: .planning/phases/05-guest-recovery-and-management-roi/05-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 5: Code Review Fix Report

**Fixed at:** 2026-07-25
**Source review:** .planning/phases/05-guest-recovery-and-management-roi/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (2 Critical, 6 Warning; Info skipped per scope)
- Fixed: 8
- Skipped: 0

**Test suite:** `cd apps/api && python -m pytest tests/ -q` → **427 passed, 0 failed**.
Two pre-existing tests asserted the old (buggy) behavior removed by CR-02 and WR-04;
both were refined to the corrected behavior, and one new test was added for the WR-04
match-window boundary.

## Fixed Issues

### CR-01: SMS consent gate bypassable via caller-supplied `recipient`

**Files modified:** `apps/api/routers/guest_requests.py`
**Commit:** a4c72e84
**Applied fix:** For the `sms` channel, `send_guest_message` now always sends to the
on-file `guest_phone` and never honors the caller-supplied `request.recipient`. A
missing `guest_phone` still returns 422. Non-SMS channels keep the prior
`recipient or guest_phone` behavior. Consent is bound to the number it was captured for.

### CR-02: PATCH `update_guest_request` bypasses the milestone state machine

**Files modified:** `apps/api/routers/guest_requests.py`
**Commit:** 8cf17303 (test: e518e577)
**Applied fix:** Removed `status`, `resolved_at`, and `resolved_by` from
`GUEST_REQUEST_UPDATE_COLUMNS`, so PATCH can no longer mutate status. All status
changes must route through `/transition`, which runs `validate_guest_request_transition`,
`_status_timestamp()`, and `_record_guest_request_event()`. Also removed the now-dead
`resolved_at`/`resolved_by` stamping block in the PATCH handler. The web frontend
already uses `transitionRequest()` for status changes (kanban), so the golden path is
unaffected — `updateRequest()` is only used for notes/field edits.
**Human verification recommended:** cross-plan integration change (state machine ↔ ROI
metrics); confirm no non-web caller relied on PATCH-setting status.

### WR-01: Average Daily Rate can never be cleared once set

**Files modified:** `apps/web/app/(dashboard)/settings/general/page.tsx`, `apps/api/routers/hotels.py`
**Commit:** 9217dad8
**Applied fix:** Two-part fix. Frontend now sends explicit `null` (not `undefined`) when
the ADR field is blank. Backend `update_hotel` used `model_dump(exclude_none=True)`, which
would have dropped the `null` too — added a targeted re-inclusion so an explicitly-provided
`average_daily_rate_cents: null` is written to clear the value, while unset fields remain
omitted. (The review only cited the frontend; the backend half was required to actually
make clearing work.)

### WR-02: `calculate_repeat_failures` double-counts `total_repeat_work_orders`

**Files modified:** `apps/api/services/guest_recovery/contracts.py`
**Commit:** 80a24fd8
**Applied fix:** Now tracks the set of contributing work-order IDs per asset and per room,
and `total_repeat_work_orders` is the length of the union across all repeat assets and
rooms — so a work order tagged with both a repeat asset and repeat room is counted once.
**Human verification recommended:** logic change to a headline metric; existing tests only
covered asset-only/room-only fixtures (all still pass).

### WR-03: Downtime / clean-session pairing drops intervals opened before the window

**Files modified:** `apps/api/routers/management_roi.py`
**Commit:** e2d42d2f
**Applied fix:** Added `_prior_state_by_room()` which fetches each room's most recent
status in a bounded (`PRIOR_STATE_LOOKBACK_DAYS = 90`) lookback before `window_start`.
Seeded into all three affected endpoints: `get_downtime_revenue` clamps the seed to
`window_start` (so pre-window downtime is not over-counted), while
`get_housekeeping_efficiency` and `get_seven_day_forecast` seed with the real prior
timestamp (so a cross-boundary clean reports its true duration). A room sitting OOO across
the boundary now reports downtime instead of zero.
**Human verification recommended:** interval-pairing logic across three endpoints.

### WR-04: Inbound SMS webhook matches outbound threads across tenants

**Files modified:** `apps/api/routers/webhooks.py`
**Commit:** fd48e428 (test: d69ca429)
**Applied fix:** Bounded the outbound-thread match to a recent window
(`INBOUND_MATCH_WINDOW_HOURS = 72`) so a stale outbound from another tenant cannot capture
a fresh inbound reply. Note: the Twilio sending number (`settings.twilio_phone_number`) is
global across tenants and outbound rows do not store a per-tenant `To`, so matching on `To`
(the review's alternative suggestion) cannot disambiguate tenants here — the recency window
is the applicable mitigation. Residual risk remains if two hotels text the same guest within
72h; fully eliminating it would require per-tenant Twilio numbers (out of scope).

### WR-05: Guest-request auto-task failure is swallowed

**Files modified:** `apps/api/routers/guest_requests.py`
**Commit:** 0c748b31
**Applied fix:** `create_guest_request` now tracks whether the SLA task was created. On
failure it records `task_created: false` in the `created` event metadata and returns a
`meta.degraded` flag with a warning in the response, so the missing SLA coverage is visible
to the caller rather than reported as a silent success. (Chose surfacing a degraded status
over hard-failing, since the guest request row is already inserted at that point.)

### WR-06: `monthly_trueup` hardcodes the $99 base fee

**Files modified:** `apps/api/routers/internal.py`
**Commit:** 0d751c8d
**Applied fix:** Replaced the literal `9900` in the overage-cap computation with
`settings.base_plan_price_cents`, so the Stripe true-up cap tracks the configured base plan
price.

---

_Fixed: 2026-07-25_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
