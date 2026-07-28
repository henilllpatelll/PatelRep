---
phase: 06-pms-and-ai-expansion
plan: 04
subsystem: api
tags: [opera, webhooks, hmac, security, pilot-flag, tdd]

# Dependency graph
requires:
  - phase: 06-pms-and-ai-expansion (06-02)
    provides: "tenants.opera_pilot_enabled column (migration 085, live) + the pilot-gate concept/lookup pattern used by integrations.py and services/opera/sync.py"
provides:
  - "_verify_opera_signature sourced from opera_credentials.webhook_secret (fails closed), replacing the CRON_SECRET-derivation defect"
  - "opera_webhook silent no-op gate for tenants.opera_pilot_enabled=False, ordered before signature check and handler dispatch"
  - "test_opera_webhooks.py: signature (correct/wrong/missing secret), pilot no-op, all 5 handler dispatches, unknown-event/hotel no-ops"
affects: [06-05 (phase gate)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Webhook pilot no-op mirrors the existing 'hotel not found or not connected' silent-ignore shape — public inbound webhooks can never 403 (unlike the request-response /integrations/opera/* endpoints, which do 403 via _require_opera_pilot)"

key-files:
  created:
    - apps/api/tests/smoke/test_opera_webhooks.py
  modified:
    - apps/api/routers/webhooks.py

key-decisions:
  - "_verify_opera_signature's third parameter changed from hotel_id to webhook_secret directly — the caller (opera_webhook) now resolves the secret from the already-fetched opera_credentials row instead of deriving a key inside the verify function"
  - "Pilot-gate lookup placed in opera_webhook (router), not services/opera/webhooks.py handlers, per the plan's stated preference — mirrors _require_opera_pilot's lookup+None-guard shape from integrations.py"
  - "OHIP's exact real-world webhook signing scheme (header name/algorithm) remains unverified against a live sandbox (06-RESEARCH Open Question 1) — documented in a code comment, not bypassed; the fix guarantees the correct secret SOURCE and fail-closed behavior, which is the verifiable, correct-by-construction goal this plan targeted"

patterns-established:
  - "Correct-by-construction webhook secret sourcing: any future public webhook needing per-tenant HMAC verification should read the secret from the resolved tenant's credentials row (as _verify_twilio_signature/_verify_opera_signature both now do), never derive from an internal-only secret"

requirements-completed: [D-03, D-05, D-06]

# Metrics
duration: 4min
completed: 2026-07-28
---

# Phase 6 Plan 04: Opera webhook signature fix + pilot no-op Summary

**Fixed a real security defect (`_verify_opera_signature` validated against `CRON_SECRET` — a key Oracle never knows — so it could never pass an authentic Opera-signed payload) and extended the D-03 pilot gate to the inbound webhook path, TDD RED→GREEN.**

## Performance

- **Duration:** 4 min (RED commit 04:22:29 → GREEN commit 04:23:30, plus setup/read time)
- **Started:** 2026-07-28T09:19Z (approx, after 06-03 close)
- **Completed:** 2026-07-28T09:23:33Z
- **Tasks:** 2/2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- `_verify_opera_signature` now takes the per-hotel `opera_credentials.webhook_secret` directly (sourced by the caller from the already-resolved credentials row) instead of deriving an HMAC key from `settings.cron_secret + hotel_id`. Fails closed when the signature header or secret is missing/empty.
- `opera_webhook` silently no-ops (`{"status": "ignored", "reason": "opera_pilot_not_enabled"}`) for any hotel with `tenants.opera_pilot_enabled=False`, checked immediately after hotel resolution and before any signature verification or handler dispatch — Oracle is never sent a 403 it can't act on.
- New `test_opera_webhooks.py` (10 tests): 3 signature tests (accepts correct secret / rejects CRON_SECRET-signed payload / fails closed on missing secret), 1 pilot no-op test, 4 handler-dispatch tests (checkout/checkin/dnd/make_up_room — each asserting `room_status` update + `room_status_history` insert with `change_source="opera_webhook"` where applicable), 2 no-op tests (unknown event type, unknown hotel).
- Full API suite: 496/496 passing (was 486 before this plan).

## Task Commits

Each task was committed atomically:

1. **Task 1: Write RED webhook signature + dispatch + pilot-noop tests** - `6b03ea9c` (test)
2. **Task 2: Fix _verify_opera_signature + add pilot no-op gate** - `68e81999` (fix)

_TDD plan: RED (Task 1) → GREEN (Task 2). No REFACTOR commit needed — the GREEN change was already minimal and clean._

## Files Created/Modified

- `apps/api/tests/smoke/test_opera_webhooks.py` - New test file: HMAC signature verification (correct/wrong/missing secret), pilot no-op gate, all 5 Opera webhook handler dispatches, unknown-event/unknown-hotel no-ops
- `apps/api/routers/webhooks.py` - `_verify_opera_signature` re-keyed to `opera_credentials.webhook_secret`; `opera_webhook` fetches `webhook_secret` alongside `tenant_id`, adds the `tenants.opera_pilot_enabled` no-op gate before signature check/dispatch

## Decisions Made

- Kept the pilot gate in the router (`opera_webhook`) rather than inside the five handler functions in `services/opera/webhooks.py` — the plan flagged this as router-preferred so the flow reads linearly: resolve hotel → not found? ignore → pilot disabled? ignore → verify signature → dispatch. This also means the handlers themselves remain reusable/callable directly (as the dispatch tests do) without re-implementing the gate at each call site.
- Left `_verify_opera_signature`'s function signature changed (third param renamed `hotel_id` → `webhook_secret`) rather than doing the secret lookup inside the function — the caller already has the `opera_credentials` row in scope from tenant resolution, so passing the secret directly avoids a second DB round-trip and keeps the function pure/testable (as the 3 direct unit tests demonstrate).

## Deviations from Plan

None — plan executed exactly as written. The plan's own "Open Question 1 / Assumption A1" scoping constraint (do not fabricate Oracle's exact wire signing format; use the verifiable per-hotel-secret contract instead) was followed as instructed, not treated as a gap requiring a decision.

## Issues Encountered

None. The RED phase correctly failed on `test_signature_accepts_webhook_secret` and `test_webhook_noop_for_non_pilot_hotel` against the pre-fix code (confirmed via `python -m pytest tests/smoke/test_opera_webhooks.py -v`); the other 8 tests passed unchanged against pre-existing code (dispatch handlers and existing no-op paths already worked), which is expected since those weren't touched by the defect.

## User Setup Required

None — no external service configuration required. Note for a future live pilot: `opera_credentials.webhook_secret` is schema-provisioned but **not yet written by `opera_connect`** (flagged by 06-RESEARCH as an existing gap, out of this plan's scope) — when a real hotel is enrolled, that column will need to be populated (e.g., during connect, or via a manual op) before Oracle-signed webhooks can pass verification in production.

## Next Phase Readiness

- Both Wave 2 plans (06-03, 06-04) are closed. Ready for Wave 3's 06-05 phase gate (full suite + web type-check + live GM browser walkthrough, human-verify checkpoint).
- No blockers. The only residual, explicitly-accepted gap (T-06-17 in this plan's threat register) is that Oracle OHIP's exact webhook wire format is unverified against a live sandbox — this is a documented, accepted risk, not a defect left open.

---
*Phase: 06-pms-and-ai-expansion*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: apps/api/tests/smoke/test_opera_webhooks.py
- FOUND: apps/api/routers/webhooks.py
- FOUND: commit 6b03ea9c (test)
- FOUND: commit 68e81999 (fix)
