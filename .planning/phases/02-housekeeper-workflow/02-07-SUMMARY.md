---
phase: 02-housekeeper-workflow
plan: 07
subsystem: ui
tags: [react-native, expo-router, zustand, appStore, optimistic-update]

# Dependency graph
requires:
  - phase: 02-housekeeper-workflow
    provides: appStore.myRooms populated with flat Room shape including vip_flag, checkin_time, risk_level
provides:
  - Room detail screen sources data from appStore.myRooms (no secondary API call)
  - PATCH /rooms/{real-uuid}/status sends correct UUID in URL path
  - VIP badge and check-in time display correctly from non-undefined store values
affects: [02-08, housekeeper-workflow-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Store-first data: detail screens look up from already-loaded list store, no redundant API calls"
    - "Optimistic update: both online and offline status change paths use { ...room, status: newStatus }"

key-files:
  created: []
  modified:
    - apps/mobile/app/(app)/my-rooms/[roomId].tsx

key-decisions:
  - "myRooms.find() in useEffect (not useMemo) to re-run when myRooms updates after background sync"
  - "Optimistic setRoom used for online PATCH path — avoids { data: Room } wrapper unwrap, matches offline path behavior"

patterns-established:
  - "Store lookup pattern: myRooms.find((r) => r.id === roomId) replaces detail-screen GET calls"

requirements-completed: [HK-03, HK-07]

# Metrics
duration: 3min
completed: 2026-03-22
---

# Phase 2 Plan 7: Room Detail roomId Unwrap Fix Summary

**Store-sourced room detail eliminates /rooms/undefined/status 404s and enables VIP badge + check-in time display**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-22T01:25:58Z
- **Completed:** 2026-03-22T01:28:37Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Replaced `api.get('/rooms/${roomId}')` with `myRooms.find((r) => r.id === roomId)` store lookup
- PATCH call now uses `room.id` from the correctly-shaped store object (real UUID, not undefined)
- VIP badge (`vip_flag`) and check-in time (`checkin_time`) now receive non-undefined values
- Both online and offline status-change paths use consistent optimistic `{ ...room, status: newStatus }` update

## Task Commits

Each task was committed atomically:

1. **Task 1: Source room detail from appStore.myRooms instead of GET /rooms/{id}** - `1c8f65d` (fix)

**Plan metadata:** TBD (docs commit)

## Files Created/Modified
- `apps/mobile/app/(app)/my-rooms/[roomId].tsx` - Fixed data source (store lookup), fixed PATCH optimistic update

## Decisions Made
- Used `useEffect` with `[roomId, myRooms]` dependency array (not `useMemo`) so the lookup re-runs when `myRooms` updates after a background sync refresh
- Online PATCH path uses optimistic `{ ...room, status: newStatus }` rather than unwrapping `{ data: Room }` response — same behavior as offline path, avoids double-unwrap bug

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- HK-03 (status update sends correct UUID) and HK-07 (VIP/check-in display) are now unblocked
- Plan 02-08 human verification checkpoint can now confirm VIP badge, check-in time, and correct PATCH URL on device

---
*Phase: 02-housekeeper-workflow*
*Completed: 2026-03-22*
