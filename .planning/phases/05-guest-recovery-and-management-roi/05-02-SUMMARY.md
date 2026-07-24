---
phase: 05-guest-recovery-and-management-roi
plan: 02
subsystem: api
tags: [twilio, sms, fastapi, webhooks, pydantic, pytest, guest-recovery]

# Dependency graph
requires:
  - phase: 05-guest-recovery-and-management-roi
    provides: "migration 084 (guest_phone, guest_message_delivery_events append-only table), twilio_* settings, FakeTwilioClient test double (05-01)"
provides:
  - "services/sms/twilio_client.py — send_sms(), is_configured(), SmsNotConfiguredError, SmsOptedOutError, SmsSendError"
  - "guest_phone captured at guest-request creation and auto-filling the outbound recipient (D-04)"
  - "real outbound SMS send wired into POST /guest-requests/{id}/messages with append-only delivery-event tracking"
  - "reactive opt-out on Twilio error 21610 — sets contact_opted_out_at and blocks all subsequent sends (D-03)"
  - "GET /guest-requests/{id}/messages — ordered thread with effective_delivery_status per message (D-05)"
  - "POST /v1/webhooks/twilio-sms — signed inbound webhook, reply-only matching, never invents a guest request (D-02)"
  - "POST /v1/webhooks/twilio-status — signed delivery-status callback appending to guest_message_delivery_events"
affects: [05-03, 05-04, guest-messaging, sms-delivery]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Proxy-corrected URL for Twilio signature validation: f'{x-forwarded-proto}://{host}{request.url.path}' instead of str(request.url), because Railway terminates TLS before the app sees the request"
    - "Reply-only inbound matching: an inbound SMS only produces a database write when its From number matches an existing outbound guest_messages.recipient; a cold/unknown number returns {status: ignored} with zero writes"
    - "Reactive provider-error routing: SmsOptedOutError / SmsNotConfiguredError / SmsSendError are distinct exception types the router catches separately to decide 422 vs 200-queued vs 502"

key-files:
  created:
    - apps/api/services/sms/__init__.py
    - apps/api/services/sms/twilio_client.py
    - apps/api/tests/test_twilio_sms.py
  modified:
    - apps/api/models/requests.py
    - apps/api/routers/guest_requests.py
    - apps/api/routers/webhooks.py

key-decisions:
  - "A send raising SmsNotConfiguredError still records the queued message (200, not an error) — the message is captured for later delivery once credentials exist, rather than lost, matching the current no-credentials-locally reality (D-01)"
  - "guest_messages stays append-only (migration 072 trigger); every delivery-state change (sent/opted_out/failed/delivered) is a new row in guest_message_delivery_events, never an UPDATE on the message"
  - "Twilio signature validation fails closed in production (missing token or bad signature -> 401) and fails open in development, mirroring the existing opera_webhook idiom exactly"
  - "Created a local apps/api/.env with dummy (non-live) values so pytest could resolve Settings() in this worktree — the file is gitignored and was never committed; no real Twilio/Supabase credentials exist in it"

patterns-established:
  - "Router-level SMS exception routing: try/except on SmsOptedOutError / SmsNotConfiguredError / SmsSendError in that order, each writing a distinct guest_message_delivery_events row before deciding the HTTP response"

requirements-completed: [D-01, D-02, D-03, D-04, D-05]

# Metrics
duration: ~6 min active work across 3 tasks
completed: 2026-07-24
---

# Phase 5 Plan 02: Twilio SMS Send/Receive Summary

**Twilio send wrapper, guest_phone-backed outbound send with reactive 21610 opt-out, a signed reply-only inbound webhook, a signed delivery-status webhook, and a GET message-thread endpoint — all proven against FakeTwilioClient (live SMS delivery is UNVERIFIED, no Twilio credentials available locally, D-01).**

## Performance

- **Duration:** ~6 min active work (3 tasks, each test-then-implementation)
- **Started:** 2026-07-24T19:43:21Z (first task commit)
- **Completed:** 2026-07-24T19:48:45Z (last task commit)
- **Tasks:** 3 (all auto, all TDD)
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- `services/sms/twilio_client.py`: thin Twilio send wrapper. `is_configured()` gates on all three Twilio settings; `send_sms()` never touches the network when unconfigured; provider error code 21610 raises a distinct `SmsOptedOutError`; every other provider error raises `SmsSendError`; `to` is never logged (PII).
- `guest_requests.py`: `guest_phone` persists at creation and is added to the PATCH allow-list; `POST /{id}/messages` falls back to the stored `guest_phone` when no explicit recipient is given, 422s when neither exists, and now actually calls `send_sms` — routing `SmsOptedOutError` to a 422 + `contact_opted_out_at` write, `SmsNotConfiguredError` to a 200-queued (message preserved, not lost), and `SmsSendError` to a 502. `guest_messages` is never UPDATEd — every delivery outcome is appended to `guest_message_delivery_events`.
- New `GET /{id}/messages`: ordered thread, each message carries `effective_delivery_status` (latest event status, falling back to the row's own `delivery_status`), gated by `MESSAGE_ROLES`, 404 across tenants.
- `webhooks.py`: `POST /twilio-sms` (reply-only matching — an inbound number with no prior outbound `guest_messages.recipient` match creates zero rows and returns `{"status":"ignored","reason":"no_matching_outbound"}`) and `POST /twilio-status` (maps `MessageStatus` onto a new `guest_message_delivery_events` row keyed by `provider_message_id`). Both verify `X-Twilio-Signature` via `RequestValidator` against a proxy-corrected URL (`x-forwarded-proto` + `host`, never `str(request.url)`), 401 only in production, and always return HTTP 200 on internal errors so Twilio does not retry-storm.
- `apps/api/tests/test_twilio_sms.py`: 20 tests covering send-wrapper behavior (P5-SMS-01), guest_phone/opt-out/delivery routing (P5-SMS-02), and signature + reply-only + status-callback webhook behavior (P5-SMS-03). Full API suite: 361 tests pass.

## Task Commits

Each task was committed atomically (test-then-implementation per the TDD gate):

1. **Task 1: Twilio send wrapper with reactive opt-out detection**
   - `1541868f` (test) — 4 failing tests for `send_sms` / `is_configured` behavior
   - `575df1e0` (feat) — `services/sms/twilio_client.py` implementation, all 4 green
2. **Task 2: guest_phone capture, real outbound send, reactive opt-out, GET messages**
   - `b1262e56` (test) — 9 failing tests for guest_phone fallback, opt-out, delivery routing, thread read
   - `0597b918` (feat) — `models/requests.py` + `routers/guest_requests.py` implementation, all 13 (cumulative) green
3. **Task 3: Twilio inbound and status webhooks**
   - `967a8eff` (test) — 7 failing tests for signature verification, reply-only matching, status callback
   - `7c9e6855` (feat) — `routers/webhooks.py` implementation, all 20 (cumulative) green

## Files Created/Modified
- `apps/api/services/sms/__init__.py` — empty package marker
- `apps/api/services/sms/twilio_client.py` — `send_sms()`, `is_configured()`, `build_client()`, `SmsNotConfiguredError`, `SmsSendError`, `SmsOptedOutError`, `TWILIO_OPTED_OUT_ERROR_CODE`
- `apps/api/tests/test_twilio_sms.py` — 420 lines, 20 tests across all three tasks
- `apps/api/models/requests.py` — `CreateGuestRequestRequest.guest_phone`; `CreateGuestMessageRequest.recipient` now `Optional`
- `apps/api/routers/guest_requests.py` — `guest_phone` on create + PATCH allow-list, `_record_message_delivery()` helper, rewritten `send_guest_message`, new `list_guest_messages`
- `apps/api/routers/webhooks.py` — `_verify_twilio_signature()`, `twilio_sms_webhook`, `twilio_status_webhook`, `TWILIO_STATUS_MAP`

## Decisions Made
See `key-decisions` in frontmatter. Summary: queue-not-lose on missing credentials (200, not error); append-only delivery events instead of ever updating `guest_messages`; production-fail-closed / development-fail-open signature validation matching the existing Opera webhook idiom.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created a local, dummy-valued `apps/api/.env` for this worktree**
- **Found during:** Task 1, before any test could run
- **Issue:** `apps/api/.env` is gitignored and therefore absent from this fresh git worktree checkout. `core/config.py`'s `Settings()` requires `supabase_url`, `supabase_service_role_key`, `supabase_jwt_secret`, and `cron_secret` with no defaults, so `python -m pytest` failed at collection with a Pydantic `ValidationError` before any plan code could even be exercised.
- **Fix:** Wrote `apps/api/.env` with dummy, non-live values (`SUPABASE_URL=https://test.supabase.co`, etc.) sufficient to satisfy `Settings()` validation. All Twilio settings are left blank, consistent with the plan's "no live credentials" premise. The file is gitignored and was never staged or committed.
- **Files modified:** `apps/api/.env` (untracked, not committed)
- **Verification:** `python -m pytest tests/ -q` collects and runs (361 passed) instead of erroring at collection.
- **Committed in:** N/A — the file is gitignored by design and is not part of any task commit.

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to run any test in this worktree at all; no scope creep, no plan-code changes, no secrets involved.

## Issues Encountered
None beyond the `.env` blocker above, which was resolved before Task 1 began.

## User Setup Required
None new. Twilio credentials remain the only external dependency (documented in 05-01's summary): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, plus pointing the Twilio console's inbound-SMS webhook at `POST /v1/webhooks/twilio-sms` and the status callback at `POST /v1/webhooks/twilio-status`. **Live SMS send/receive: UNVERIFIED — no Twilio credentials available locally (D-01).** All behavior in this plan is proven against `FakeTwilioClient` only.

## Next Phase Readiness
- All five D-01..D-05 truths for this plan are implemented and unit-tested: send-wrapper behavior, reply-only inbound matching (zero writes on cold numbers), reactive 21610 opt-out blocking future sends, guest_phone persistence + auto-fill, and the message-thread read endpoint with per-message effective delivery status.
- `apps/api/tests/test_twilio_sms.py` (20 tests) plus the full API suite (361 tests) are green.
- No blockers for 05-03/05-04. The only remaining external dependency (real Twilio credentials + webhook URL configuration in the Twilio console) is a deployment-time step, not a code blocker.

## Self-Check: PASSED

- `apps/api/services/sms/__init__.py` — FOUND
- `apps/api/services/sms/twilio_client.py` — FOUND
- `apps/api/tests/test_twilio_sms.py` — FOUND
- `apps/api/models/requests.py`, `apps/api/routers/guest_requests.py`, `apps/api/routers/webhooks.py` — FOUND
- Commit `1541868f` (Task 1 test) — FOUND
- Commit `575df1e0` (Task 1 feat) — FOUND
- Commit `b1262e56` (Task 2 test) — FOUND
- Commit `0597b918` (Task 2 feat) — FOUND
- Commit `967a8eff` (Task 3 test) — FOUND
- Commit `7c9e6855` (Task 3 feat) — FOUND

---
*Phase: 05-guest-recovery-and-management-roi*
*Completed: 2026-07-24*
