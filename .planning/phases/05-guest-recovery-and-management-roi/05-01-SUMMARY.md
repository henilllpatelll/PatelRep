---
phase: 05-guest-recovery-and-management-roi
plan: 01
subsystem: database
tags: [postgres, rls, migration, twilio, sms, pydantic, fastapi, pytest]

# Dependency graph
requires:
  - phase: 05-guest-recovery-and-management-roi
    provides: "migration 072 guest recovery schema (guest_requests, guest_messages append-only trigger, lost_found_items, reject_guest_recovery_mutation)"
provides:
  - "guest_requests.guest_phone column (D-04) — outbound recipient + inbound match key"
  - "tenants.average_daily_rate_cents column with 0–10,000,000 CHECK (D-07) — GM-configured ADR, NULL = not configured"
  - "lost_found_items.disposition_flagged_at column (D-11) — retention-cron flag, separate from status"
  - "lost_found_items.retention_due_at backfilled to created_at + 90 days for all rows (D-10)"
  - "public.guest_message_delivery_events append-only table (RLS + immutable trigger) for Twilio status callbacks"
  - "twilio==9.10.9 pinned + four settings.twilio_* config fields (empty defaults)"
  - "UpdateHotelRequest.average_daily_rate_cents field consumed by PATCH /v1/hotels/{hotel_id}"
  - "FakeTwilioClient / FakeTwilioRestException test double for credential-free SMS testing (D-01)"
affects: [05-02, 05-03, 05-04, guest-messaging, sms-delivery, lost-found-retention, management-roi]

# Tech tracking
tech-stack:
  added: [twilio==9.10.9]
  patterns:
    - "Append-only delivery-event table pattern: Twilio status callbacks append to guest_message_delivery_events instead of updating the immutable guest_messages row"
    - "Retention flagging via dedicated disposition_flagged_at column — automation never mutates lost_found_items.status (preserves human-authorization requirement)"
    - "Credential-free provider testing via FakeTwilioClient double (mirrors fake_supabase.py convention: plain classes, call recording, no mock framework)"

key-files:
  created:
    - supabase/migrations/084_guest_phone_adr_and_retention.sql
    - apps/api/tests/smoke/fake_twilio_client.py
  modified:
    - apps/api/requirements.txt
    - apps/api/core/config.py
    - apps/api/models/requests.py

key-decisions:
  - "disposition_flagged_at is a separate column, not a new lost_found_items.status enum value — status stays 'unclaimed' until a human logs a real disposition custody event"
  - "Delivery outcomes append to a new guest_message_delivery_events table because guest_messages has a BEFORE UPDATE OR DELETE immutability trigger (072) that blocks status callbacks from updating the message row"
  - "ADR stored in cents as INTEGER with DB CHECK (0–10,000,000) + Pydantic ge/le — defense in depth against revenue-math poisoning; NULL means unconfigured so the ROI endpoint reports configured:false"
  - "All four twilio_* settings default to '' so the app boots with no credentials (current local reality per D-01); the send wrapper (05-02) refuses to send when unconfigured rather than failing open"

patterns-established:
  - "Append-only audit table reusing reject_guest_recovery_mutation() + tenant RLS policy shape from migration 072"
  - "Provider SDK test double lives in apps/api/tests/smoke/ as a fixture module only (no pytest tests) so cross-wave imports stay green"

requirements-completed: [D-01, D-04, D-07, D-10]

# Metrics
duration: ~5 min active (Tasks 1–2) + blocking checkpoint for live migration apply
completed: 2026-07-24
---

# Phase 5 Plan 01: Guest Recovery + ROI Data Foundation Summary

**Migration 084 adds guest_phone, tenant ADR (cents), lost&found retention flagging + 90-day backfill, and an append-only guest_message_delivery_events table (RLS + immutable trigger); plus the Twilio SDK pin, four Twilio settings, the UpdateHotelRequest ADR field, and a credential-free FakeTwilioClient — applied live to Supabase project oacnwalhcpqdabivweki.**

## Performance

- **Duration:** ~5 min active work (Tasks 1–2), then a blocking human-verify checkpoint while the orchestrator applied migration 084 to the live database
- **Started:** 2026-07-24T19:24:08Z
- **Completed:** 2026-07-24T19:36:02Z
- **Tasks:** 3 (2 auto + 1 blocking checkpoint)
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- Migration 084 written with all five schema changes, two supporting indexes, an RLS-enabled append-only delivery-event table, and a documented rollback block — then applied and verified against the live Supabase project.
- Every `lost_found_items` row now has a non-null `retention_due_at` (90-day backfill, D-10 verified: `count(*) WHERE retention_due_at IS NULL` = 0).
- Twilio SDK pinned (`twilio==9.10.9`) and four `twilio_*` settings added with empty defaults so the app boots credential-free.
- `UpdateHotelRequest.average_daily_rate_cents` accepted by the existing GM-gated `PATCH /v1/hotels/{hotel_id}` with no new endpoint (D-07).
- `FakeTwilioClient` / `FakeTwilioRestException` test double available for all credential-free SMS testing in downstream waves (D-01).

## Task Commits

Each task was committed atomically:

1. **Task 1: Write migration 084 — guest_phone, ADR, retention flagging, delivery-event table** - `2fd7334d` (feat)
2. **Task 2: Add Twilio dependency, settings, ADR request field, and FakeTwilioClient** - `6fe4d84c` (feat)
3. **Task 3: [BLOCKING] Apply migration 084 to the live Supabase project** - no code commit (live DB apply performed by orchestrator; approved 2026-07-24)

## Files Created/Modified
- `supabase/migrations/084_guest_phone_adr_and_retention.sql` - guest_phone, tenants.average_daily_rate_cents (+CHECK), lost_found_items.disposition_flagged_at, 90-day retention backfill, guest_message_delivery_events append-only table (RLS + immutable trigger), two supporting indexes, rollback comment block
- `apps/api/requirements.txt` - pinned `twilio==9.10.9`
- `apps/api/core/config.py` - `twilio_account_sid` / `twilio_auth_token` / `twilio_phone_number` / `twilio_status_callback_url` settings (empty defaults)
- `apps/api/models/requests.py` - `average_daily_rate_cents: Optional[int] = Field(default=None, ge=0, le=10000000)` on `UpdateHotelRequest`
- `apps/api/tests/smoke/fake_twilio_client.py` - credential-free Twilio double recording send calls and raising configurable Twilio error codes

## Decisions Made
See `key-decisions` in frontmatter. Summary: append delivery outcomes to a new table (guest_messages is immutable); retention flagging via a dedicated column (never mutate status); ADR in cents with layered DB+Pydantic bounds; Twilio settings default empty for credential-free boot.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. Tasks 1–2 completed and committed cleanly; Task 3 was a planned blocking checkpoint. The migration was applied to the live Supabase project (`oacnwalhcpqdabivweki`) by the orchestrator after the checkpoint, with verification results confirmed:
- `guest_requests.guest_phone` present (1 row)
- `tenants.average_daily_rate_cents` present (1 row)
- `lost_found_items.disposition_flagged_at` present (1 row)
- `lost_found_items WHERE retention_due_at IS NULL` = 0
- trigger `guest_message_delivery_events_immutable` present (1 row)
- `public.guest_message_delivery_events` exists with RLS enabled
- security advisors show no new ERROR/critical finding tied to the new table (only the pre-existing, unrelated `public.cron_health` RLS-disabled finding and standard uniform GraphQL-exposure lints)

## User Setup Required
**Twilio SMS requires manual configuration before live delivery can be verified.** Per the plan's `user_setup`:
- Env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (E.164)
- Dashboard: inbound SMS webhook → `https://<api-host>/v1/webhooks/twilio-sms` (POST); status callback → `https://<api-host>/v1/webhooks/twilio-status`
- All four `twilio_*` settings default to `""`; code is unit-tested against `FakeTwilioClient`, so live SMS delivery is explicitly unverified (D-01) until credentials are present.

## Next Phase Readiness
- Wave 1 data + dependency foundation is live. All downstream Phase 5 plans (05-02 SMS send/opt-out, 05-03 inbound reply, 05-04 lost&found retention cron, ROI/ADR reporting) can now read/write against real columns.
- Blocking gate cleared: every Phase 5 endpoint that touches these columns will resolve at runtime rather than 500 on a missing column.
- No blockers for wave 2. Twilio credentials remain the only external dependency, gated behind FakeTwilioClient for CI.

## Self-Check: PASSED

- `supabase/migrations/084_guest_phone_adr_and_retention.sql` — FOUND
- `apps/api/tests/smoke/fake_twilio_client.py` — FOUND
- `apps/api/requirements.txt`, `apps/api/core/config.py`, `apps/api/models/requests.py` — FOUND
- Commit `2fd7334d` (Task 1) — FOUND
- Commit `6fe4d84c` (Task 2) — FOUND
- Commit `fce5060c` (SUMMARY) — FOUND

---
*Phase: 05-guest-recovery-and-management-roi*
*Completed: 2026-07-24*
