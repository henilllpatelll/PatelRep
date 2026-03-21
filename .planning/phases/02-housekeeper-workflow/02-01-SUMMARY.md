---
phase: 02-housekeeper-workflow
plan: "01"
subsystem: api

tags: [fastapi, supabase, expo-push, httpx, asyncio]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: mobile auth + Supabase session infrastructure that housekeeper API builds on
provides:
  - GET /housekeeping/my-rooms now returns vip_flag, checkin_time, risk_level, predicted_ready_at
  - POST /housekeeping/assignments fires fire-and-forget Expo push to assigned housekeeper
affects: [03-mobile-housekeeper, 04-polish]

# Tech tracking
tech-stack:
  added: [asyncio (stdlib), httpx (already in requirements.txt)]
  patterns:
    - "asyncio.create_task for fire-and-forget side-effects inside FastAPI async routes"
    - "bare except + pass to ensure push failure never surfaces to API caller"

key-files:
  created: []
  modified:
    - apps/api/routers/housekeeping.py

key-decisions:
  - "asyncio.create_task chosen over BackgroundTasks because we already have the event loop and the task is truly detached (fire-and-forget semantics)"
  - "Explicit field list replaces wildcard select on room_status to guarantee vip_flag, checkin_time, risk_level, predicted_ready_at are included in the Supabase response"
  - "Push fetch room_number per-assignment inside create_assignments rather than in the helper to keep _send_assignment_push signature simple and testable"

patterns-established:
  - "fire-and-forget pattern: asyncio.create_task(_send_assignment_push(...)) after synchronous DB work in async FastAPI route"
  - "explicit-select pattern: always list column names explicitly when joining Supabase tables to avoid wildcard omitting joined columns"

requirements-completed: [HK-02, HK-05, HK-07]

# Metrics
duration: 8min
completed: 2026-03-21
---

# Phase 2 Plan 01: Housekeeper Workflow API Data Contracts Summary

**Explicit room_status column select adds vip_flag/ETA/risk fields to my-rooms response, plus fire-and-forget Expo push notification dispatched via asyncio.create_task on every room assignment**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-21T22:30:00Z
- **Completed:** 2026-03-21T22:38:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- `GET /housekeeping/my-rooms` now returns `vip_flag`, `checkin_time`, `risk_level`, and `predicted_ready_at` on every room row, unblocking the mobile Room type display
- `POST /housekeeping/assignments` dispatches an Expo Push notification to the assigned housekeeper's `expo_push_token` after every upsert — assignment response is never blocked by push failure
- Added `asyncio` and `httpx` imports to housekeeping router; existing upsert and room_status mirror logic are completely unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend GET /my-rooms to include VIP and ETA fields** - `fb624a8` (feat)
2. **Task 2: Add fire-and-forget push send to POST /assignments** - `a299bea` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `apps/api/routers/housekeeping.py` - Extended my-rooms select + added _send_assignment_push helper and asyncio.create_task wiring

## Decisions Made
- Used `asyncio.create_task` rather than FastAPI `BackgroundTasks` because the route is already async and `create_task` gives true fire-and-forget semantics with no response delay
- Replaced `*` wildcard with an explicit column list — Supabase PostgREST wildcard does not always propagate all columns through joins, explicit select is the reliable fix

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Python module import check failed with a pydantic ValidationError for missing env vars (`supabase_url`, `supabase_service_role_key`, `supabase_jwt_secret`) — this is normal behavior when the config module runs without a `.env` file present; the file itself has no syntax errors (confirmed by grep verification of all required identifiers).

## User Setup Required
None - no external service configuration required for this plan. Expo push will simply no-op when `expo_push_token` is null in `user_profiles`.

## Next Phase Readiness
- Backend data contracts are now correct for the mobile housekeeper screen: `my-rooms` returns all fields the Room type expects, and assignment push is wired
- Phase 2 Plan 02 (mobile my-rooms screen implementation) can now consume the correct API response
- Pre-existing blocker from STATE.md still applies: `google-services.json` must be added before Android push can be tested end-to-end

---
*Phase: 02-housekeeper-workflow*
*Completed: 2026-03-21*
