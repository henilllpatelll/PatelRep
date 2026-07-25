---
phase: 05-guest-recovery-and-management-roi
reviewed: 2026-07-24T00:00:00Z
depth: standard
files_reviewed: 37
files_reviewed_list:
  - .github/workflows/cron-jobs.yml
  - apps/api/core/config.py
  - apps/api/main.py
  - apps/api/models/requests.py
  - apps/api/requirements.txt
  - apps/api/routers/guest_requests.py
  - apps/api/routers/internal.py
  - apps/api/routers/lost_found.py
  - apps/api/routers/management_roi.py
  - apps/api/routers/webhooks.py
  - apps/api/services/guest_recovery/contracts.py
  - apps/api/services/sms/__init__.py
  - apps/api/services/sms/twilio_client.py
  - apps/api/tests/smoke/fake_supabase.py
  - apps/api/tests/smoke/fake_twilio_client.py
  - apps/api/tests/smoke/test_tenant_isolation.py
  - apps/api/tests/test_guest_recovery.py
  - apps/api/tests/test_lost_found_retention.py
  - apps/api/tests/test_management_roi.py
  - apps/api/tests/test_twilio_sms.py
  - apps/web/app/(dashboard)/lost-found/page.tsx
  - apps/web/app/(dashboard)/management-roi/page.tsx
  - apps/web/app/(dashboard)/settings/general/page.tsx
  - apps/web/app/(dashboard)/settings/guest-requests/page.tsx
  - apps/web/app/(dashboard)/settings/layout.tsx
  - apps/web/app/(dashboard)/settings/rooms/page.tsx
  - apps/web/components/guest-requests/GuestRequestDrawer.tsx
  - apps/web/components/guest-requests/NewRequestModal.tsx
  - apps/web/components/settings/SlaPolicyForm.tsx
  - apps/web/components/shared/Sidebar.tsx
  - apps/web/i18n/locales/en.ts
  - apps/web/i18n/locales/es.ts
  - apps/web/lib/api/guest_requests.ts
  - apps/web/lib/api/hotels.ts
  - apps/web/lib/api/lost_found.ts
  - apps/web/lib/api/managementRoi.ts
  - supabase/migrations/084_guest_phone_adr_and_retention.sql
findings:
  critical: 2
  warning: 6
  info: 3
  total: 11
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-07-24
**Depth:** standard
**Files Reviewed:** 37
**Status:** issues_found

## Summary

Phase 5 delivers Twilio SMS guest recovery, lost & found retention, and a GM-only Management
ROI dashboard. The GM-only RBAC on `management_roi.py` is well-enforced and covered by
`test_every_roi_route_is_gm_only` / `test_every_roi_route_is_tenant_scoped`; tenant scoping on
the new Supabase queries is consistent (`.eq("tenant_id", current_user.hotel_id)` everywhere in
the ROI, guest-requests, and lost-found routers). The pure calculators in `contracts.py` are
well-factored and fixture-reconciled.

Two issues rise to BLOCKER: (1) the guest-message send path lets staff override the recipient
phone number, defeating the per-guest SMS consent gate; and (2) the guest-request PATCH endpoint
mutates `status` directly, bypassing the milestone state machine and — critically — skipping the
timestamp stamping that the Phase 5 ROI metrics depend on, so cards moved via PATCH silently
drop out of the verified-resolution and SLA-met calculations. Several WARNINGs concern metric
accuracy at window boundaries and a data-entry dead-end (ADR cannot be cleared once set).

## Critical Issues

### CR-01: SMS consent gate is bypassable via caller-supplied `recipient`

**File:** `apps/api/routers/guest_requests.py:207-212, 239`
**Issue:** `send_guest_message` validates SMS consent against the guest request
(`contact_consent_at` set, `contact_opted_out_at` null), but then sends to
`request.recipient or guest_request.get("guest_phone")`. `recipient` is an arbitrary
caller-supplied field (`CreateGuestMessageRequest.recipient`, `models/requests.py:815-818`).
Consent is recorded for the guest's own number, yet a staff member with a message role can set
`recipient` to any phone number and the code will send guest-recovery SMS content to it under
that consent flag. This is a guest-PII disclosure and an SMS-consent/TCPA compliance hole: the
number that actually receives the text was never the number consent was captured for.
**Fix:** Ignore `recipient` for the `sms` channel and always send to the on-file
`guest_phone`; or verify the supplied `recipient` equals the request's `guest_phone` before
sending:
```python
recipient = guest_request.get("guest_phone")
if request.channel == "sms" and not recipient:
    raise HTTPException(status_code=422, detail="No recipient phone number on file")
# do NOT honor request.recipient for SMS — consent is bound to guest_phone
```

### CR-02: PATCH `update_guest_request` bypasses the milestone state machine and desyncs ROI metrics

**File:** `apps/api/routers/guest_requests.py:514-534` (allowlist `GUEST_REQUEST_UPDATE_COLUMNS`, lines 28-38)
**Issue:** `status` is in `GUEST_REQUEST_UPDATE_COLUMNS`, so PATCH writes `status` directly with
no call to `validate_guest_request_transition`. This lets a request skip required milestones
(e.g. `open` → `verified`) that the dedicated `/transition` endpoint (lines 162-191) is built to
prevent, and it skips `_status_timestamp()` stamping. PATCH stamps `resolved_at`/`resolved_by`
(lines 524-527) but NOT `acknowledged_at`, `dispatched_at`, `arrived_at`, `guest_contacted_at`,
`verified_at`, or `reopened_at`. `calculate_guest_request_metrics` (`contracts.py:107-114`) only
counts a request as verified when `status == "verified" AND verified_at` is present, and only
counts SLA-met when `due_at AND verified_at` exist. A request advanced to `verified` via PATCH
therefore has `verified_at = null` and vanishes from both `verified_resolution_rate_pct` and
`sla_met_rate_pct` — the headline numbers on the new Management ROI dashboard. No
guest-request-event is recorded either, so the audit trail and the drawer's message-thread logic
are also starved. This is a cross-plan integration defect between the state machine (05-05) and
the ROI calculators (05-01/02).
**Fix:** Remove `status` from `GUEST_REQUEST_UPDATE_COLUMNS` and require all status changes to go
through `/transition`, or have PATCH delegate status changes to the same
`validate_guest_request_transition` + `_status_timestamp` + `_record_guest_request_event` path:
```python
GUEST_REQUEST_UPDATE_COLUMNS = {"title", "description", "room_id", "guest_name", "guest_phone", "priority"}
# status transitions must route through transition_guest_request()
```

## Warnings

### WR-01: Average Daily Rate can never be cleared once set

**File:** `apps/web/app/(dashboard)/settings/general/page.tsx:141-145`
**Issue:** When the ADR field is blank, the payload sets
`average_daily_rate_cents: undefined`. `undefined` is omitted from the JSON PATCH body, so the
backend (`UpdateHotelRequest.average_daily_rate_cents: Optional[int]`) never receives it and the
previously-stored value is retained. The field's helper text ("Leave blank if you would rather
not estimate it") implies a GM can un-configure ADR, but they cannot — clearing the input is a
no-op, and the D-07 revenue estimate stays on with a stale rate.
**Fix:** Send explicit `null` when the field is empty:
```ts
average_daily_rate_cents:
  values.average_daily_rate != null ? Math.round(values.average_daily_rate * 100) : null,
```

### WR-02: `calculate_repeat_failures` double-counts `total_repeat_work_orders`

**File:** `apps/api/services/guest_recovery/contracts.py:176-178`
**Issue:** `total_repeat_work_orders` sums repeat-asset failure counts *plus* repeat-room failure
counts. A work order that carries both `asset_id` and `room_id` (a common case — an asset lives
in a room) is counted once under its asset and again under its room, inflating the total. The
unit tests only exercise asset-only or room-only fixtures, so the double-count is untested.
**Fix:** Count distinct work orders, or document that the total is a per-dimension sum. If a
single figure is intended, track the set of contributing work-order IDs and take its length.

### WR-03: Downtime / clean-session pairing drops intervals opened before the query window

**File:** `apps/api/routers/management_roi.py:134-143` (and `contracts.py:206-220`, `management_roi.py:70-101`)
**Issue:** `get_downtime_revenue`, `get_housekeeping_efficiency`, and `forecast-7day` fetch
`room_status_history` filtered to `created_at >= window_start`. A room that went `OOO` (or
`IN_PROGRESS`) *before* the window and transitions back *inside* it is seen only as a closing
transition with no matching open, so `open_at` is None and the interval is silently discarded. A
room sitting OOO for weeks shows zero downtime — and thus zero revenue impact (D-07) — until it
next changes status. This under-reports the exact number the dashboard exists to surface.
**Fix:** Seed each room's `open_at` from the last transition at or before `window_start` (fetch
the most recent prior transition per room), or clamp the interval start to `window_start` when an
open is inferred.

### WR-04: Inbound SMS webhook matches outbound threads across tenants

**File:** `apps/api/routers/webhooks.py:199-211`
**Issue:** `twilio_sms_webhook` resolves the guest request by querying `guest_messages` for the
most recent outbound row with `recipient == from_number`, with no tenant filter (it cannot have
one — inbound Twilio payloads carry no tenant). If two hotels on the platform have both texted the
same guest phone number, an inbound reply is attached to whichever hotel texted most recently,
cross-wiring the reply into the wrong tenant's guest request and event log.
**Fix:** Scope matching to a recent time window and/or match on the `To` (hotel Twilio number)
in addition to `From`, so replies resolve to the tenant that owns the receiving number.

### WR-05: Guest-request auto-task failure is swallowed, leaving the request without SLA coverage

**File:** `apps/api/routers/guest_requests.py:140-150, 159`
**Issue:** `create_guest_request` logs (`logger.error`) but otherwise ignores a failed
auto-task insert, then returns the guest request as a success. The linked `task` is what the
escalation cron (`internal.py check_escalations`) watches for SLA breaches, so a guest request
whose task creation failed will never escalate — it is created "successfully" but is invisible to
the response-time machinery the phase is built around.
**Fix:** Either fail the request creation if the task insert fails, or surface a degraded status
to the caller so the gap is visible rather than silent.

### WR-06: `monthly_trueup` hardcodes the $99 base fee instead of `settings.base_plan_price_cents`

**File:** `apps/api/routers/internal.py:246-248`
**Issue:** The overage cap is computed as `min(overage_cents, cap_cents - 9900)`. The `9900`
duplicates `settings.base_plan_price_cents` (`config.py:40`). If the base plan price is ever
changed via config, this literal diverges and the Stripe true-up cap is computed against the
wrong base, over- or under-billing every tenant at the cap boundary.
**Fix:** `cap_cents - settings.base_plan_price_cents`.

## Info

### IN-01: `list_guest_requests` pagination params lack lower bounds

**File:** `apps/api/routers/guest_requests.py:494-495`
**Issue:** `page` and `per_page` are `Query(1)` / `Query(20)` with no `ge=` constraint, unlike
`lost_found.list_lost_found_items` (`page: Query(1, ge=1)`, `per_page: Query(20, ge=1, le=100)`).
A `page=0` or negative value produces a negative `.range()` offset.
**Fix:** Add `Query(1, ge=1)` and `Query(20, ge=1, le=100)` to match the lost-found endpoint.

### IN-02: GM self-approves their own compensation recovery action

**File:** `apps/api/routers/guest_requests.py:356-365`
**Issue:** `record_guest_recovery_action` sets `approved_by = current_user.user_id if
current_user.role == "gm" else None`. A GM requesting a compensation action is auto-recorded as
its own approver, with no separation-of-duty check. Likely acceptable given the GM is the top
authority, but worth confirming against the compensation-governance intent.
**Fix:** If separation of duty is desired for compensation, require a distinct approver as the PM
programs deferral flow does (`approved_by != requester`).

### IN-03: Reported `window_days` can disagree with the queried window

**File:** `apps/api/routers/management_roi.py:120`
**Issue:** `window_days=(end - start).days or DEFAULT_WINDOW_DAYS`. When a caller passes
`start_date == end_date`, `.days` is 0 and the reported `window_days` falls back to 90 while the
actual query window is a single day — the label shown on the dashboard
("2+ work orders in N days") would misstate the window.
**Fix:** Compute `window_days` from the same `(end - start)` used for the query without the `or`
fallback, or clamp both consistently.

---

_Reviewed: 2026-07-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
