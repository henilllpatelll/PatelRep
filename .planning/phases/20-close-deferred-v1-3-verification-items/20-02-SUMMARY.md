---
phase: 20-close-deferred-v1-3-verification-items
plan: 02
subsystem: testing
tags: [playwright, e2e, fastapi, react-query, supabase, cors, rate-limit, postgres-fk, scheduling, guest-requests]

# Dependency graph
requires:
  - phase: 20-close-deferred-v1-3-verification-items
    plan: 01
    provides: e2e/20-verify-rbac.spec.ts sibling pattern, RBAC_API_URL local-seeding override, chief_engineer DB fix precedent
provides:
  - "e2e/20-verify-gm.spec.ts — durable live-browser coverage for VERIFY-02 (Unnamed Staff fallback) and VERIFY-03 (guest-request drawer advance chain + kanban reflect)"
  - "apps/api/routers/scheduling.py today_roster fix — Scheduling page's Today's Roster panel actually renders staff now (was structurally always empty)"
  - "apps/api/main.py middleware reorder — CORS headers now present on every response including RateLimit's early 429s"
  - "apps/web/components/guest-requests/GuestRequestsPage.tsx drawer resync fix — the advance-chain drawer no longer goes stale after the first click"
  - "supabase/migrations/093_guest_requests_delete_cascade.sql — written, NOT yet applied (needs Supabase MCP access this executor doesn't have)"
affects: [21-test-data-hygiene]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Retry-click loop around a freshly-navigated page's first interactive click, to absorb Next.js dev-mode hydration lag rather than a single unconditional click()"
    - "data-testid=\"gr-column-{key}\" on kanban columns — minimal testability addition, no behavior change, needed to scope status-reflection assertions unambiguously"
    - "Windows dev-server restart checklist: killing a uvicorn --reload tree can orphan a multiprocessing.spawn child that keeps the old listening socket alive; Get-NetTCPConnection's reported OwningProcess can itself be a stale/phantom PID — cross-reference against Get-Process, and independently confirm via Get-Process python* for orphaned spawn_main children, not just the PID Get-NetTCPConnection names"

key-files:
  created:
    - e2e/20-verify-gm.spec.ts
    - supabase/migrations/093_guest_requests_delete_cascade.sql
  modified:
    - apps/api/routers/scheduling.py
    - apps/api/main.py
    - apps/web/components/guest-requests/GuestRequestsPage.tsx
    - e2e/helpers/rbac-users.ts

key-decisions:
  - "user_profiles.full_name is a NOT NULL DB column (migration 003) — the NULL-name fixture uses an empty string, which is the only DB-valid way to trigger getDisplayName's fallback and matches the exact `profile.get('full_name') or ''` condition the app code already checks for"
  - "Housekeeping page's assign-bar chip renders only the FIRST WORD of the fallback name (existing `.split(' ')[0]` pattern also used elsewhere in staff/page.tsx) — asserted on the chip's accessible name containing 'Unnamed', not the literal string 'Unnamed Staff', to match real rendered behavior rather than assume untested code reads correctly"
  - "Did not attempt to weaken or delete the guest_request_events/messages/recovery-actions append-only design — migration 093 preserves UPDATE-immutability exactly as migration 087 already established for the identical lost_found_custody_events case, only allowing the full parent record (and its trail) to cascade-delete"
  - "Did not run `supabase db push` to apply migration 093 — same reasoning as migration 092 in 20-01: this executor has no Supabase MCP access and the established project precedent is to write+flag rather than force an unsafe local push against a remote history with pre-existing drift"

patterns-established:
  - "When a live-browser check needs zero-console-errors as an acceptance bar, a rate-limited backend endpoint (auth/me, etc.) can produce transient false failures under back-to-back manual test-debugging sessions — this is expected/correct rate-limiting behavior, not a bug, once the underlying CORS-masking defect (bug-770) is fixed; distinguish real recurring failures from self-inflicted quota exhaustion by waiting for the rate-limit window before re-asserting flakiness"

# Metrics
duration: ~110min
completed: 2026-08-05
---

# Phase 20 Plan 02: VERIFY-02 + VERIFY-03 Live-Browser Verification Summary

**Closed both remaining deferred v1.3 verification items with live-browser evidence and fixed four real, previously-undiscovered production bugs surfaced along the way: a structurally-broken Scheduling roster endpoint, a CORS-masking rate-limit middleware ordering bug, a stale-drawer state bug that silently 422'd every second guest-request advance click, and a guest-request DELETE endpoint that has never worked for any request, ever.**

## Performance

- **Duration:** ~110 min
- **Completed:** 2026-08-05T01:54:00Z
- **Tasks:** 2/2 completed
- **Files modified:** 6 (2 created: spec + migration; 4 modified: scheduling.py, main.py, GuestRequestsPage.tsx, rbac-users.ts) plus `.wolf/buglog.json`

## Accomplishments
- `e2e/20-verify-gm.spec.ts` created and passing (3/3 tests, not skipped) across multiple consecutive full runs: VERIFY-02 (NULL/empty `full_name` renders "Unnamed Staff" on Staff, Scheduling, and Housekeeping, zero console errors) and VERIFY-03 (drawer advance chain walks a real guest request through all 6 legal transitions with the kanban board reflecting each new status).
- **Real bug #1 — Scheduling roster structurally broken (bug-764):** `GET /schedules/today-roster` returned a bare `{"data": [...]}` array while the frontend's `TodayRosterResponse` contract expects `{"data": {"roster": [...], "date": ...}}` — `res.data.roster` was always `undefined`, so the "Today's Roster" panel silently rendered empty for every hotel regardless of who was actually on shift, and the raw rows also hardcoded `full_name`/`role` to `None` instead of joining `user_profiles`/`user_roles`. Fixed both at the source; verified live.
- **Real bug #2 — CORS headers missing on every rate-limited response (bug-770):** `CORSMiddleware` sat inside (behind) `RateLimitMiddleware` in `main.py`'s registration order, so a client that tripped a rate limit got a 429 with zero `Access-Control-*` headers — browsers report this as an opaque "blocked by CORS policy" console error, hiding the real 429 from the frontend, on every legitimately rate-limited cross-origin request in production. Reordered so CORS wraps RateLimit; verified live (429 response now carries `access-control-allow-origin`).
- **Real bug #3 — Guest Request drawer goes stale after the first advance click (bug-765):** the open drawer held its own `request` snapshot captured at card-click time, never re-synced after a successful transition (which only invalidates the kanban query) — so the drawer kept rendering the pre-transition status and its stale button, and a second click re-sent the already-applied status, which the backend correctly 422's, silently (no `onError` handler). This was the literal deferred VERIFY-03 risk. Fixed with a `useEffect` resync; verified live end-to-end (6/6 sequential drawer clicks, zero 422s).
- **Real bug #4 — `DELETE /guest-requests/{id}` has never deleted anything, ever (bug-773):** `guest_request_events.guest_request_id` was `ON DELETE RESTRICT` and every request gets a "created" event at creation, so this endpoint 400's for 100% of requests, including one deleted a moment after creation with zero transitions. This is the exact gap migration 087 explicitly flagged and deferred while fixing the identical issue for `lost_found_custody_events`. Wrote `supabase/migrations/093_guest_requests_delete_cascade.sql` applying 087's same reviewed design to the three remaining tables — **not yet applied** (no Supabase MCP access this session; same escalation as migration 092 in 20-01).
- Found and worked around a Windows dev-environment issue (bug-766): killing a uvicorn `--reload` process tree left an orphaned `multiprocessing.spawn` child holding the listening socket, which kept answering requests with pre-edit code even after a brand-new uvicorn process was confirmed started; `Get-NetTCPConnection`'s reported owning PID was itself a stale/dead reference. Diagnosed via a planted response marker, resolved by explicitly hunting orphaned `python.exe` processes via `Get-Process python*` rather than trusting the netstat-reported PID alone.

## Task Commits

1. **Task 1: VERIFY-02 — NULL full_name renders "Unnamed Staff", zero console errors** - `d22a9322` (feat) — spec file (both VERIFY-02 and VERIFY-03, per plan design), `scheduling.py` roster fix, `main.py` CORS/rate-limit reorder, `rbac-users.ts` `API_URL` export.
2. **Task 2: VERIFY-03 — guest-request drawer advance chain + kanban reflect** - `3356692c` (feat) — `GuestRequestsPage.tsx` drawer resync fix + testids, migration 093.

**Plan metadata:** (this commit, docs) — to follow.

## Files Created/Modified
- `e2e/20-verify-gm.spec.ts` - New spec: VERIFY-02 (1 test, 3 pages) + VERIFY-03 (1 test, full 6-step chain), service-role fixture seed/teardown helpers mirroring `20-verify-rbac.spec.ts`.
- `apps/api/routers/scheduling.py` - `today_roster`: batch-fetches `user_profiles`/`user_roles` for on-shift users and wraps the response as `{"data": {"roster": [...], "date": ...}}` to match the frontend contract.
- `apps/api/main.py` - Reordered `add_middleware` calls: RateLimit → CORS → SecurityHeaders (was CORS → RateLimit → SecurityHeaders), so CORS/SecurityHeaders headers apply to every response including RateLimit's early 429s.
- `apps/web/components/guest-requests/GuestRequestsPage.tsx` - Added a `useEffect` that re-syncs the open drawer's `request` to the latest kanban query data on refetch; added `data-testid="gr-column-{key}"` to kanban columns; wrapped `allRequests` in `useMemo` (clears a `react-hooks/exhaustive-deps` warning the new effect surfaced).
- `e2e/helpers/rbac-users.ts` - Exported the already-computed `API_URL` constant for reuse by sibling specs.
- `supabase/migrations/093_guest_requests_delete_cascade.sql` - New, **written but not applied**: CASCADEs `guest_request_events`/`guest_messages`/`guest_recovery_actions` FKs and narrows their immutability triggers to UPDATE-only, mirroring migration 087.
- `.wolf/buglog.json` - bug-764 (roster shape/null-name), bug-765 (drawer staleness), bug-766 (Windows orphaned-process debugging), bug-770 (CORS/rate-limit ordering), bug-773 (guest-request delete cascade).

## Decisions Made
- Used an empty string (not `NULL`) for the seeded NULL-name fixture, since `user_profiles.full_name` is `NOT NULL` at the DB layer — matches the exact fallback condition the app code (`profile.get("full_name") or ""`) already checks for, and is the only DB-valid way to reach this state.
- Asserted the Housekeeping page's chip-list fallback on "Unnamed" (not "Unnamed Staff"), because that specific render site intentionally shows only the first word of the display name (an existing pattern, also used on the Staff page's role-schedule modal) — corrected the assertion to match observed real rendering rather than the plan's literal wording, without weakening what's being proven (the fallback still fires, still zero console errors).
- Left `delete_guest_request`'s Python code untouched — the router logic was already correct (delete parent, clean up linked task, rely on DB cascade for the rest); the bug was purely a schema gap, so the schema is the only thing that needed fixing.
- Escalated migration 093 rather than force-apply it, following the exact precedent set for migration 092 in 20-01 (no Supabase MCP access in this executor's toolset; unscoped `db push` is unsafe against this project's known pre-existing remote migration-history drift).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Scheduling "Today's Roster" panel structurally always empty**
- **Found during:** Task 1, seeding the NULL-name fixture and needing it to appear in the roster
- **Issue:** `GET /schedules/today-roster` returned `{"data": [...]}` (bare array) but the frontend expects `{"data": {"roster": [...], "date": ...}}`; also hardcoded `full_name`/`role` to `None`.
- **Fix:** Batch-fetch profiles/roles and return the contracted shape.
- **Files modified:** `apps/api/routers/scheduling.py`
- **Verification:** Live curl round-trip (seeded a real housekeeper's shift_assignment, confirmed `full_name`/`role` populated and roster/date wrapper present) plus the passing Playwright assertion.
- **Committed in:** `d22a9322`

**2. [Rule 1 - Bug] CORS headers absent on rate-limited 429 responses**
- **Found during:** Task 1, an intermittent zero-console-errors assertion failure
- **Issue:** `RateLimitMiddleware` sat outside `CORSMiddleware`, so its early-return 429s bypassed CORS header injection entirely.
- **Fix:** Reordered middleware registration so CORS wraps RateLimit.
- **Files modified:** `apps/api/main.py`
- **Verification:** `curl -i -H "Origin: ..."` against an exhausted rate limit now shows `access-control-allow-origin`; re-ran spec to confirm the real (correctly-surfaced) 429 no longer masquerades as a CORS block; full pytest suite unaffected (554/556, same 2 pre-existing failures).
- **Committed in:** `d22a9322`

**3. [Rule 1 - Bug] Guest Request drawer 422s on the second advance click**
- **Found during:** Task 2, driving the VERIFY-03 live flow
- **Issue:** Drawer's `request` state never re-synced after a transition succeeded, so its button kept re-sending the already-applied status.
- **Fix:** `useEffect` resync against the kanban query's live data.
- **Files modified:** `apps/web/components/guest-requests/GuestRequestsPage.tsx`
- **Verification:** Live: 6/6 sequential drawer clicks with zero 422s, board reflecting each status.
- **Committed in:** `3356692c`

**4. [Rule 1 - Bug, escalated] `DELETE /guest-requests/{id}` always 400s**
- **Found during:** Task 2, the spec's own fixture teardown
- **Issue:** `guest_request_events.guest_request_id` `ON DELETE RESTRICT` blocks deleting any guest_request (every request has a "created" event from the instant it exists).
- **Action taken:** Wrote `supabase/migrations/093_guest_requests_delete_cascade.sql`, mirroring migration 087's already-reviewed CASCADE + UPDATE-only-immutability design for the two other tables it explicitly deferred. Not applied — no migration-apply tool access this session.
- **Files modified:** `supabase/migrations/093_guest_requests_delete_cascade.sql` (new, not yet applied)
- **Verification:** Reproduced the 23503 error directly via curl on a freshly-created, zero-transition request; confirmed root cause via migration history + trigger definition; migration written to the exact proven pattern.
- **Committed in:** `3356692c`
- **Follow-up required:** Orchestrator/team-lead needs to apply migration 093 via Supabase MCP. Once applied, `e2e/20-verify-gm.spec.ts` VERIFY-03's teardown DELETE call will start succeeding with no code change, and the 10 residual `verified`-status guest_requests left by this session's repeated test/debug runs (title `ilike '%VERIFY-03%'`) can be swept in one query.

---

**Total deviations:** 4 real bugs fixed/escalated at the source (2 fully fixed and verified live: scheduling roster shape, CORS/rate-limit ordering; 1 fixed and verified live: drawer staleness; 1 written as a migration and escalated, matching established project precedent for missing migration-apply tool access).
**Impact on plan:** All four were necessary to genuinely exercise the two VERIFY items live (not scope creep) — none of the four could have been discovered without live-browser verification, which is exactly this phase's purpose. No assertion was weakened to work around any of them.

## Issues Encountered
- **Windows uvicorn --reload orphaned-process issue (bug-766), same class as 20-01's bug-754 but a new specific failure mode:** killing the reloader process tree left an orphaned `multiprocessing.spawn` child that kept the listening socket alive and kept serving pre-edit code; `Get-NetTCPConnection`'s `OwningProcess` value pointed at an already-terminated PID. Resolved by planting a temporary marker in a response to prove staleness, then hunting orphaned `python.exe` processes via `Get-Process python*` rather than trusting the reported listener PID.
- **Self-inflicted rate-limit false-flakiness during debugging:** repeated back-to-back manual `curl`/Playwright runs against `/v1/auth/me` (10/min auth-route limit) intermittently tripped the *real* rate limit purely from this session's own heavy testing cadence, not from the spec's normal single-run behavior (one login + 3 page navigations, well under the limit). Confirmed via a clean run after waiting out the window; not a product defect beyond the CORS-masking bug already fixed above.

## User Setup Required

**Follow-up (parallels 20-01's migration 092 resolution):**
- `supabase/migrations/093_guest_requests_delete_cascade.sql` needs to be applied to the `oacnwalhcpqdabivweki` dev project via Supabase MCP (`apply_migration`). Written and verified safe by inspection (mirrors migration 087's already-applied, already-reviewed design exactly).
- Once applied, an optional one-time sweep can remove the 10 residual `guest_requests` rows this session's repeated test/debug runs left behind (`status='verified'`, `title ILIKE '%VERIFY-03%'`) — harmless (correctly terminal, not visible on the active kanban board) but worth clearing for Phase 21 hygiene bookkeeping.

## Next Phase Readiness
- VERIFY-02 and VERIFY-04 (20-01) and VERIFY-03/VERIFY-02 (this plan) now all have durable, repeatable Playwright coverage — `e2e/20-verify-gm.spec.ts` is CI-able once `TEST_PASSWORD`/`RBAC_API_URL` are set in that environment, same as its sibling.
- **Teardown confirmation:** across the final clean runs, `@patelrep-test.com` auth users = 0, orphaned `shift_assignments` for today = 0 (both fully self-cleaning). `guest_requests` residue = 10 rows, all clearly marker-tagged (`title ILIKE '%VERIFY-03%'`), all `status='verified'` (not visible on the active kanban board, harmless), explicitly logged (not silently swallowed) as blocked on migration 093 — this is an honest, migration-gated limitation, not an untracked leak. Phase 21 (Test-Data Hygiene) should either accept this as a documented trade-off of exercising a real audited workflow live, or plan the migration-093 apply + one-time sweep noted above.
- Phase 20 is now fully closed: all 4 deferred v1.3 verification items (VERIFY-01 through VERIFY-04) have live-browser evidence, with 2 migrations (092, 093) written and escalated for orchestrator application.

---
*Phase: 20-close-deferred-v1-3-verification-items*
*Completed: 2026-08-05*

## Self-Check: PASSED

- FOUND: e2e/20-verify-gm.spec.ts
- FOUND: supabase/migrations/093_guest_requests_delete_cascade.sql
- FOUND: .planning/phases/20-close-deferred-v1-3-verification-items/20-02-SUMMARY.md
- FOUND: commit d22a9322
- FOUND: commit 3356692c
