---
phase: 03-engineer-workflow-push-eas
plan: "01"
subsystem: api
tags: [fastapi, push-notifications, expo, httpx, asyncio, pydantic]

requires:
  - phase: 03-00
    provides: Wave 0 TDD stubs in RED state — test_wo_push.py RED stub ready to turn GREEN

provides:
  - PATCH /staff/me/push-token endpoint writing expo_push_token to user_profiles
  - _send_wo_assignment_push helper in work_orders.py with data.url deep link
  - asyncio.create_task firing push on work order claim
  - url field in housekeeping _send_assignment_push data payload (deep link fix)
  - test_wo_push.py passing GREEN

affects:
  - 03-02 (work order mobile screens — push token registration on login)
  - 03-03 (EAS build — push token flow requires this endpoint)
  - 02-mobile (HK deep link navigation from push payload)

tech-stack:
  added: []
  patterns:
    - "asyncio.create_task for fire-and-forget push from FastAPI async routes"
    - "Module-level sys.modules mock pattern for testing FastAPI routers without full env"
    - "url field in Expo push data payload for deep link navigation"

key-files:
  created:
    - apps/api/tests/smoke/test_wo_push.py (real GREEN assertions replacing RED stub)
  modified:
    - apps/api/routers/work_orders.py (asyncio+httpx imports, _send_wo_assignment_push, claim_work_order update)
    - apps/api/routers/housekeeping.py (room_id param + url field in _send_assignment_push)
    - apps/api/routers/staff.py (get_current_user import, update_push_token endpoint)
    - apps/api/models/requests.py (UpdatePushTokenRequest model)

key-decisions:
  - "test_wo_push.py uses sys.modules mock to stub core.database at import time — avoids real Supabase init in unit tests without full env"
  - "patch target in test is routers.work_orders.httpx.AsyncClient (module attribute) not apps.api... — matches actual Python module path when pytest runs from apps/api/"
  - "PATCH /staff/me/push-token uses get_current_user (not require_role) — all roles (housekeeper, engineer, front_desk) register push tokens"

patterns-established:
  - "Push helper pattern: lookup expo_push_token from user_profiles, skip silently if missing, post to exp.host, catch all exceptions"
  - "All Expo push data payloads include url field for deep link navigation"
  - "asyncio.create_task pattern (not BackgroundTasks) for fire-and-forget push dispatch in async FastAPI routes"

requirements-completed: [ENG-06, INFRA-02]

duration: 4min
completed: 2026-03-22
---

# Phase 03 Plan 01: Push Token Registration + WO Assignment Push Summary

**PATCH /staff/me/push-token endpoint and _send_wo_assignment_push helper with deep link url fields in both Expo push payloads**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-22T03:20:28Z
- **Completed:** 2026-03-22T03:24:40Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `_send_wo_assignment_push(engineer_id, wo_id, title)` to work_orders.py with `data.url = "/(app)/work-orders/{wo_id}"` for deep link navigation
- Wired `asyncio.create_task(_send_wo_assignment_push(...))` into `claim_work_order` — fires fire-and-forget on successful WO claim
- Fixed housekeeping.py `_send_assignment_push` to include `data.url = "/(app)/my-rooms/{room_id}"` and accept `room_id` parameter
- Added `PATCH /staff/me/push-token` endpoint and `UpdatePushTokenRequest` model — any authenticated role can register their Expo push token
- Replaced Wave 0 RED stub in test_wo_push.py with real GREEN assertions verifying push payload shape and url field

## Task Commits

Each task was committed atomically:

1. **Task 1: _send_wo_assignment_push + housekeeping url field** - `7f32ada` (feat)
2. **Task 2: PATCH /staff/me/push-token endpoint** - `0228e76` (feat)

**Plan metadata:** (docs commit below)

_Note: TDD tasks have test + implementation in single commit (RED→GREEN in one shot since function was new)_

## Files Created/Modified

- `apps/api/routers/work_orders.py` - Added asyncio+httpx imports, `_send_wo_assignment_push` helper, updated `claim_work_order` to fire push on success
- `apps/api/routers/housekeeping.py` - Added `room_id` param and `url` field to `_send_assignment_push`; pass `str(a.room_id)` in `create_assignments`
- `apps/api/routers/staff.py` - Added `get_current_user` import, `UpdatePushTokenRequest` import, and `PATCH /me/push-token` endpoint
- `apps/api/models/requests.py` - Added `UpdatePushTokenRequest(token: str)` model
- `apps/api/tests/smoke/test_wo_push.py` - Replaced RED assert-False stub with real GREEN test using sys.modules mock pattern

## Decisions Made

- **Module mock pattern for test isolation:** `sys.modules['core.database'] = MagicMock()` before router import prevents real Supabase client init. This is necessary because the API relies on module-level `supabase` singleton and pytest runs without production env vars.
- **patch target path:** Test patches `routers.work_orders.httpx.AsyncClient` (not `apps.api.routers.*`) because pytest runs from `apps/api/` working directory — module is imported as `routers.work_orders`.
- **get_current_user for push-token:** All staff roles need push token registration (not just managers) — using `get_current_user` instead of `require_role` is correct.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test import path from apps.api.routers to routers**
- **Found during:** Task 1 (test verification)
- **Issue:** Plan specified `from apps.api.routers.work_orders import _send_wo_assignment_push` which fails when pytest runs from `apps/api/` — module is `routers.work_orders` not `apps.api.routers.work_orders`
- **Fix:** Changed import and patch targets to `routers.work_orders.*` and added sys.modules mock for `core.database` to avoid Supabase client init failure
- **Files modified:** apps/api/tests/smoke/test_wo_push.py
- **Verification:** `pytest tests/smoke/test_wo_push.py -v` passes GREEN (1 passed)
- **Committed in:** 7f32ada (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - test import path bug)
**Impact on plan:** Necessary correctness fix — test path mismatch would cause permanent test failure. No scope creep.

## Issues Encountered

- `pytest` and `supabase` packages not installed in system Python — installed inline (`pip install pytest pytest-asyncio supabase==2.5.0`). This is expected in a dev environment without a virtualenv activated.
- `SUPABASE_SERVICE_ROLE_KEY=test-key` in conftest.py fails Supabase JWT regex validation at module init — resolved by using a valid JWT-format string in the unit test env setup.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Push infrastructure is complete: token registration endpoint, WO assignment push, HK assignment push (with url)
- Plan 03-02 (mobile WO screens) can call `PATCH /staff/me/push-token` on login
- Plan 03-03 (EAS build) requires `google-services.json` from Firebase console — still a blocker for Android push testing

---
*Phase: 03-engineer-workflow-push-eas*
*Completed: 2026-03-22*
