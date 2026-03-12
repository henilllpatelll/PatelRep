# Codebase Concerns

**Analysis Date:** 2026-03-12

## Tech Debt

### Supabase Error Handling - Unvalidated Query Results

**Issue:** Extensive use of `.execute()` without validation. Queries use `.single()` and `.maybe_single()` but don't consistently check for errors or empty responses.

**Files:**
- `apps/api/routers/housekeeping.py` - Line 27-39 (board fetch), 206-240 (status update)
- `apps/api/routers/rooms.py` - Line 201-210 (get current status), 62-67 (room fetch)
- `apps/api/routers/assets.py` - Multiple `.execute()` without validation
- `apps/api/middleware/credits.py` - Line 33-34, 44-45, 61, 70 (`.single()` calls)

**Impact:** Silent failures on database query errors. If `.single()` returns no data or raises an exception, the code may proceed with `None` values causing downstream crashes. No distinction between "not found" and "database error".

**Fix approach:** Wrap `.execute()` calls in try-except blocks. Check `.data` before accessing fields. Explicitly handle `.single()` vs `.maybe_single()` cases. Create a helper function for safe Supabase queries that raises HTTPException on DB errors.

---

### Cron Secret Used for Opera Webhook HMAC

**Issue:** Opera webhook signature validation uses CRON_SECRET (a shared internal secret) combined with hotel_id to derive HMAC secret.

**Files:**
- `apps/api/routers/webhooks.py` - Line 28 (secret derivation: `f"{settings.cron_secret}:{hotel_id}"`)
- `apps/api/services/opera/webhooks.py` - Receives hotel_id from main webhook handler

**Impact:** CRON_SECRET is meant for internal cron auth (Railway internal endpoint validation), not cryptographic signing. This secret must be rotated if exposed. If attacker learns CRON_SECRET, they can forge Opera webhook signatures for any hotel.

**Fix approach:** Generate and store a dedicated `opera_webhook_secret` per hotel in `opera_credentials` table. Use that for HMAC validation instead. Update `opera_callback` to generate a random webhook secret when connecting.

---

### Unauthenticated Opera Webhook Parsing

**Issue:** Opera webhook handler accepts requests with optional signature validation (only enforced in production).

**Files:**
- `apps/api/routers/webhooks.py` - Line 26-30 (conditional signature check), 67 (prod-only enforcement)

**Impact:** In development, any HTTP client can send crafted Opera webhook events to trigger room status changes, reservations updates, or DND flags without authentication. This bypasses all RLS policies.

**Fix approach:** Always validate signatures in all environments. If dev testing needs unauthenticated requests, use a separate test endpoint with admin-only role requirement.

---

### Database Query Sorting in Python

**Issue:** Housekeeping board endpoint fetches room data from Supabase and sorts in Python because "supabase-py does not support ordering by joined table columns directly."

**Files:**
- `apps/api/routers/housekeeping.py` - Line 25-48 (fetch all room_status rows, sort in Python)

**Impact:** Fetches ALL room_status rows for hotel (potentially hundreds) into memory, then sorts. As hotel grows, this becomes O(N) in-memory load per request. No pagination.

**Fix approach:** Use Supabase compute to sort by room.floor and room.room_number via a view or RPC function. Or implement cursor-based pagination to fetch 50 rooms at a time.

---

### Housekeeper Profile Speed Calculation - Time Zone Aware

**Issue:** Elapsed time calculation uses `datetime.utcnow().replace(tzinfo=start_dt.tzinfo)` which attempts to cast UTC to a potentially different timezone without proper conversion.

**Files:**
- `apps/api/routers/rooms.py` - Line 83 (elapsed minutes calculation)

**Impact:** If `updated_at` from database is stored in hotel's local timezone or with a non-UTC offset, elapsed time calculation will be inaccurate. This skews housekeeper speed profiles.

**Fix approach:** Ensure all timestamps in database are stored as UTC. Use `datetime.fromisoformat()` to parse and compare in UTC only. Convert to local timezone only for display.

---

## Security Considerations

### JWT Custom Claims Not Validated Server-Side

**Issue:** Supabase Auth hook injects `hotel_id` and `role` into JWT claims. API relies on these claims for RLS and authorization but doesn't verify they match database state.

**Files:**
- `apps/api/middleware/auth.py` - Line 29-31 (extracts from JWT)
- All routers using `require_role()` dependency - Line 46-55 in auth.py

**Impact:** If JWT claims are forged or stale, user can access hotels they don't belong to or bypass role restrictions. No verification that `hotel_id` in claims matches any `user_roles` entry.

**Fix approach:** After extracting JWT claims, verify `user_id` + `hotel_id` combination exists in `user_roles` table with appropriate role. Cache validation result briefly to avoid DB hit per request.

---

### Opera OAuth Credentials Stored in Plaintext

**Issue:** Opera `access_token` and `refresh_token` stored as plaintext strings in `opera_credentials` table.

**Files:**
- `apps/api/services/opera/auth.py` - Line 63-68 (stores tokens after refresh)
- `apps/api/routers/integrations.py` - Line 82-90 (stores tokens after OAuth callback)

**Impact:** Database breach exposes OAuth tokens. Attacker can access Opera Cloud reservations, room statuses, and guest profiles without GM credentials.

**Fix approach:** Use Supabase Vault (pgcrypto) or a key management service. Encrypt tokens using hotel-specific key derived from hotel_id. Store only encrypted ciphertext in DB.

---

### API Error Messages Expose System Details

**Issue:** Generic exception handler returns stringified exception messages to client.

**Files:**
- `apps/api/main.py` - Line 116-121 (generic exception handler)
- `apps/api/routers/ai_copilot.py` - Line 217 (returns `str(exc)` in response)

**Impact:** Stack traces, SQL errors, or internal service names can leak to attackers. Example: "psycopg2.DatabaseError: relation "rooms" does not exist" reveals database schema.

**Fix approach:** Catch exceptions at handler level. Log full details server-side (with hotel_id context). Return generic error message to client: "An error occurred. Please try again." or "Service temporarily unavailable."

---

### Stripe Webhook Trusts Metadata Without Signature Verification Details

**Issue:** Stripe webhook extracts hotel_id from `event.data.object.metadata.get("hotel_id")` after signature verification. If hotel_id is missing, the update silently does nothing.

**Files:**
- `apps/api/routers/webhooks.py` - Line 101-108, 110-116 (subscription updates)

**Impact:** If Stripe metadata format changes or hotel_id is omitted, subscription updates fail silently. Billing status may not sync, allowing account to operate without payment.

**Fix approach:** Log a warning when hotel_id is missing. Use customer lookup as fallback (Stripe customer ID to hotel_id mapping). Require hotel_id in metadata with explicit validation.

---

## Performance Bottlenecks

### OpenAI Embeddings Batch Processing - No Retry or Error Recovery

**Issue:** PDF SOP indexing embeds chunks in batches of 100 via OpenAI. If a batch fails, the entire document indexing fails with no resume capability.

**Files:**
- `apps/api/services/ai/sop_rag.py` - Line 146-155 (batch embedding loop)

**Impact:** Large PDFs (>5000 chunks) may timeout or fail halfway through. User sees "failed" status but can't retry; document must be re-uploaded.

**Fix approach:** Implement per-chunk error recovery. If a batch fails, mark failed chunks with `indexing_status = "failed"` and allow partial indexing. Add exponential backoff retry.

---

### SOP RAG Similarity Search No Result Limit Enforcement

**Issue:** `match_sop_chunks` RPC accepts `match_count` parameter but Supabase migration doesn't show explicit LIMIT enforcement.

**Files:**
- `apps/api/services/ai/sop_rag.py` - Line 237-245 (RPC call with match_count=5)
- `supabase/migrations/017_functions.sql` - Function definition

**Impact:** If `match_count` is not enforced in RPC, a hotel with 100k+ SOP chunks could trigger massive query retrieving thousands of rows, slowing down response.

**Fix approach:** Verify migration 017 includes `LIMIT match_count` in the RPC function. Add assertion on frontend to cap match_count <= 10.

---

### Room Readiness Predictions - No Caching

**Issue:** Room predictions endpoint calls `room_readiness_predictions` table on every housekeeping board request without caching.

**Files:**
- `apps/api/routers/housekeeping.py` - Line 52-59 (fetches predictions every request)

**Impact:** If 100+ rooms updated every 30s, predictions table grows without bounds. Query time increases. No way to track when predictions were last computed.

**Fix approach:** Add `computed_at` timestamp to `room_readiness_predictions`. Cache predictions for 5 minutes. Only refetch if older than cache TTL.

---

## Fragile Areas

### Room Status Transitions - Race Condition on Concurrent Updates

**Issue:** Room status update reads current status, validates transition, then updates. No row-level locking between read and write.

**Files:**
- `apps/api/routers/rooms.py` - Line 201-240 (get current status, validate, update)

**Impact:** If two supervisors mark the same DIRTY room as IN_PROGRESS simultaneously:
1. Supervisor A reads status = DIRTY
2. Supervisor B reads status = DIRTY
3. Both validate DIRTY→IN_PROGRESS (allowed)
4. Both update to IN_PROGRESS
5. History shows two updates but room only transitioned once

Assignment could be lost if A and B try to assign different housekeepers.

**Fix approach:** Use Supabase advisory locks (SELECT ... FOR UPDATE) on room_status row. Or use a versioned update: `WHERE room_id = X AND version = 123` and increment version on every update.

---

### Housekeeper Profile Update - Unsafe Division

**Issue:** Rolling average calculation uses `old_count` directly without null checks or type validation.

**Files:**
- `apps/api/routers/rooms.py` - Line 100-103 (rolling average)

**Impact:** If `completion_count` is null or 0, division by new_count could be edge-casey. If `avg_clean_minutes` is null, casting to float might fail.

**Fix approach:** Validate types in queries. Use COALESCE in SQL: `COALESCE(avg_clean_minutes, 30)` to ensure float. Add assertions on Python side.

---

### Staff Invitation - Email Delivery Not Confirmed

**Issue:** API calls `supabase.auth.admin.invite_user_by_email()` but doesn't verify Supabase successfully sent the email. Response status isn't checked.

**Files:**
- `apps/api/routers/staff.py` - Invite endpoint (uses Supabase auth admin API)

**Impact:** If Supabase email service is down, invitation fails silently. Staff member never receives invite link. GM has no feedback.

**Fix approach:** Check Supabase response for errors. Implement retry with exponential backoff. Add invitation delivery status tracking in `staff_invitations` table.

---

### Opera Webhook Idempotency - No Request ID Tracking

**Issue:** Opera webhook handlers check hotel existence but don't track whether an event was already processed.

**Files:**
- `apps/api/services/opera/webhooks.py` - Handlers for checkout, checkin, modified, DND, make_up_room
- `apps/api/routers/webhooks.py` - Line 82-84 (calls handlers without idempotency check)

**Impact:** If Opera retries webhook (network failure, HTTP 5xx), the same event (e.g., CHECKED_OUT) processes twice:
- Room status updated twice
- History entries duplicated
- Guest charged for two checkouts if billing hook exists

**Fix approach:** Add `opera_event_id` field to a `processed_opera_events` table. Check if event already processed before handling. Store event_id + received_at for 30-day deduplication window.

---

## Scaling Limits

### Supabase RLS Policy Complexity

**Issue:** 40+ RLS policies across 28 tables. Policies rely on JWT custom claims (`hotel_id`, `role`) matching database state.

**Files:**
- `supabase/migrations/016_rls_policies.sql` - Full RLS policy file (200+ lines)

**Impact:** As row count grows (millions of guests, work orders, logs):
- RLS evaluation adds CPU overhead per query
- Complex policies (e.g., supervisor can update tasks for their department) require joins
- No clear way to audit which policies are actually protecting which tables
- Hard to debug access control issues ("user can't see data" — which policy blocked it?)

**Fix approach:** Simplify policies to two tiers: tenant-level (everyone sees their hotel) and role-level (distinct for gm, supervisor, staff). Document policy intent per table. Add query explain plans to measure RLS overhead.

---

### Database Storage - No Partition or Archival Strategy

**Issue:** Tables like `ai_interactions`, `room_status_history`, `logbook_entries` grow unbounded. No retention policy or partitioning.

**Files:**
- All logging/history tables defined in migrations 001-017

**Impact:** After 1 year:
- `ai_interactions` could have 10M+ rows (if 30 requests/day × 365 days × 1000 hotels)
- `room_status_history` could have 50M+ rows
- Full table scans become slow
- Backup/restore times increase
- Storage costs increase

**Fix approach:** Implement table partitioning by tenant_id and date. Archive rows older than 1 year to cold storage (Supabase object storage or S3). Create RLS-compatible views that hide archived data from users.

---

### Session Management - No Logout Token Blacklist

**Issue:** Supabase Auth manages sessions via JWT refresh tokens in localStorage. Logout revokes session server-side but doesn't invalidate tokens at API layer.

**Files:**
- Web: `apps/web/lib/hooks/useAuth.ts` - Calls supabase.auth.signOut()
- API: No token blacklist/revocation check

**Impact:** If user logs out from one device, an old token from another device remains valid. Attacker with token can still call API for 1 hour (typical JWT expiry).

**Fix approach:** Store list of revoked token JTIs (if included in token) or last_logout_at timestamp per user. Check token issue time vs logout time on protected endpoints.

---

## Missing Critical Features

### No Audit Log for Sensitive Operations

**Issue:** Room status changes, work order assignments, and staff invitations have history tables but no centralized audit trail with who/when/what/why.

**Files:**
- `apps/api/routers/rooms.py` - Writes to `room_status_history` on transitions
- `apps/api/routers/work_orders.py` - No explicit audit log
- No audit table in schema

**Impact:** GM cannot answer: "Who changed this room from CLEAN to DIRTY and why?" Compliance risk (hotels may need audit trails for insurance/legal). Difficult to debug malicious user behavior.

**Fix approach:** Create `audit_log` table with columns: tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, reason, timestamp. Log all updates via trigger or application code.

---

### No Request Rate Limiting per User/Hotel

**Issue:** Rate limiter is configured but applied globally by IP (`get_remote_address`). No per-user or per-hotel limits.

**Files:**
- `apps/api/main.py` - Line 4-5, 20 (slowapi limiter with IP-based key)

**Impact:** Malicious user behind corporate NAT shares IP with other users. Slowapi blocks all users. Or attacker spoofs X-Forwarded-For header to bypass limit.

**Fix approach:** Use user_id from JWT as rate limit key instead of IP. Track usage per hotel_id. Set different limits for different operations (AI queries: 100/day, room updates: 1000/day).

---

### No Alerting for Operational Issues

**Issue:** Exceptions are logged but no alerting mechanism. Background jobs (`run_all_hotel_predictions`, Opera sync) may fail silently.

**Files:**
- `apps/api/routers/internal.py` - Cron endpoints
- `apps/api/services/ai/predictions.py` - Prediction jobs

**Impact:** If Room Readiness predictions fail for a hotel, GM never knows. Opera sync silently stops syncing reservations after token expiry or network failure.

**Fix approach:** Add Sentry or equivalent error tracking. Send Slack/email alert on cron job failure. Log job outcome (success/failure) to `job_runs` table with error details.

---

## Test Coverage Gaps

### Integration Tests Missing for Critical Flows

**Issue:** Only smoke tests exist. No integration tests for room status workflow, Opera sync, or billing.

**Files:**
- `apps/api/tests/smoke/test_endpoints.py` - Basic endpoint checks only
- No tests for: status transitions, Opera webhook handling, AI credit deduction

**Impact:** Regressions in core logic (room status machine, Opera sync retry logic) aren't caught before production. Example: refactoring status validation accidentally allows invalid transition.

**Risk:** High - room status is critical path for housekeeping operations.

**Priority:** High

**Fix approach:** Add integration tests:
- Test all 9 room status transitions with valid/invalid sequences
- Test Opera webhook idempotency (process same event twice)
- Test credit deduction with edge cases (low balance, cap reached)

---

### No Tests for Concurrent/Race Conditions

**Issue:** No tests for concurrent room status updates, simultaneous Opera webhooks, or parallel staff invitations.

**Impact:** Race conditions (e.g., double-update) won't be caught until load testing or production.

**Priority:** High

**Fix approach:** Add pytest-asyncio tests that:
- Spawn two tasks updating same room status simultaneously
- Verify history shows both updates (or locks prevent one)
- Test concurrent prediction runs for same hotel

---

### Web Frontend Tests Missing

**Issue:** No tests for web components or pages. React components render without error checking.

**Files:**
- `apps/web/app/(dashboard)/onboarding/page.tsx` - 1786 lines, no tests
- `apps/web/components/**/*.tsx` - No component tests

**Impact:** Breaking changes in API (e.g., field renamed) cause component crashes in production.

**Priority:** Medium

**Fix approach:** Add Jest/Testing Library tests for:
- Onboarding flow (form validation, step progression)
- RoomCard component (all status colors render correctly)
- AICopilotBubble (error state handling)

---

### Mobile Offline Sync Not Tested

**Issue:** Offline sync queue (`apps/mobile/lib/offline/sync.ts`) has no tests for queue persistence or conflict handling.

**Impact:** If SQLite sync queue corrupts, user loses pending room status updates. No way to recover.

**Priority:** High

**Fix approach:** Add unit tests for:
- Enqueue/dequeue operations
- Retry on network failure
- Conflict detection (server version newer than local)

---

## Dependencies at Risk

### Supabase Python SDK - Old Version (2.5.0)

**Issue:** Current version is 2.5.0 (from Nov 2024). No major version upgrade path tracked.

**Files:**
- `apps/api/requirements.txt` - Line 5

**Risk:** Dependency may have unreported security issues. Upgrade to 3.x may break RPC/RLS handling.

**Impact:** Security patches not applied. API drift from latest Supabase features/fixes.

**Migration plan:** Test supabase 3.x in a feature branch. Verify RPC calls and auth still work. Upgrade if stable.

---

### pdfplumber (10.3.0) - Unmaintained Upstream

**Issue:** pdfplumber used for SOP document parsing. Project has reduced activity.

**Files:**
- `apps/api/services/ai/sop_rag.py` - Line 9, 124
- `apps/api/requirements.txt` - Line 11

**Risk:** PDF parsing bugs may not be fixed. If a malicious PDF crashes indexing, no patched version available.

**Impact:** Denial of service: GM uploads crafted PDF, indexing crashes, API unresponsive.

**Migration plan:** Monitor pdfplumber releases. Have fallback (pypdf or PyPDF4) ready if project dies.

---

### OpenAI Python SDK (1.35.0) - Rapid Iteration

**Issue:** OpenAI SDK versions frequently to track API changes. Current version is from mid-2024.

**Files:**
- `apps/api/requirements.txt` - Line 8

**Risk:** API breaking changes (model names, parameter structures) may require code changes without warning.

**Impact:** SOP RAG or task parsing breaks when OpenAI retires a model or changes API.

**Migration plan:** Pin major version (1.x) but not patch. Add monitoring for OpenAI deprecation notices. Test weekly against latest model (gpt-4o-mini).

---

## Deployment & Operations

### No Health Check for Background Jobs

**Issue:** Cron endpoints in `routers/internal.py` have no health probe. Railway restarts API if any cron job fails.

**Files:**
- `apps/api/routers/internal.py` - Cron endpoints

**Impact:** Long-running job (predict rooms for 100 hotels) times out, API restarts, all in-flight requests reset.

**Fix approach:** Implement separate health check that doesn't depend on cron success. Log cron outcome. Return 200 even if job fails (async/queue pattern).

---

### Environment Variable Validation at Startup

**Issue:** `.env` is required but missing values silently default or cause runtime errors.

**Files:**
- `apps/api/core/config.py` - Pydantic settings with no explicit validation

**Impact:** If ANTHROPIC_API_KEY is missing, app starts but crashes on first SOP query.

**Fix approach:** In `main.py` lifespan startup, validate all required settings are present. Raise exception immediately if missing.

---

This concerns document provides actionable guidance for prioritizing refactoring and hardening efforts. The highest-impact issues are race conditions, auth/webhook validation, and test coverage.

---

*Concerns audit: 2026-03-12*
