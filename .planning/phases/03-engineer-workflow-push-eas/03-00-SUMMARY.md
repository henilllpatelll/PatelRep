---
phase: 03-engineer-workflow-push-eas
plan: "00"
subsystem: testing
tags: [jest, react-native, tdd, wave-0, work-orders, push-notifications, offline-sync]

# Dependency graph
requires: []
provides:
  - "Wave 0 RED test stubs for engineer workflow: sync claim/complete, notifications push-token API path, WO list offline enqueue, WO detail completion payload, ENG-06 push helper placeholder"
affects:
  - 03-01-engineer-push-backend
  - 03-02-work-orders-mobile
  - 03-03-eas-push-setup

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD Wave 0: all test files written in RED state before any implementation code — Nyquist compliance for later plan verify commands"
    - "Screen tests use jest.mock for expo-router useLocalSearchParams, api client, stores, and offline db"
    - "Notifications test asserts API path (api.patch) rather than direct Supabase write — INFRA-02 behavioral contract"

key-files:
  created:
    - apps/mobile/__tests__/lib/offline/sync.test.ts
    - apps/mobile/__tests__/lib/notifications.test.ts
    - apps/mobile/__tests__/screens/WorkOrderDetail.test.tsx
    - apps/mobile/__tests__/screens/WorkOrdersList.test.tsx
    - apps/api/tests/smoke/test_wo_push.py
  modified:
    - apps/mobile/__tests__/lib/offline/sync.test.ts

key-decisions:
  - "Wave 0 RED state correct: sync claim/complete RED (handlers missing in sync.ts), notifications RED (currently calls supabase directly), WorkOrderDetail RED (testID not yet on TextInput), WorkOrdersList third test RED (offline enqueue not wired in index.tsx), test_wo_push.py RED (push helper doesn't exist yet)"
  - "sync.test.ts extended (not replaced) — 3 existing GREEN tests preserved, 2 new RED appended inside flushSyncQueue describe block"
  - "WorkOrdersList first two tests intentionally GREEN — existing index.tsx already renders title/priority/room and Claim button; only offline enqueue path is missing"
  - "test_wo_push.py uses assert False as minimal RED placeholder — real assertion will be filled in plan 03-01 after push function exists"

patterns-established:
  - "Wave 0 pattern: screens/__tests__ directory created for screen-level component tests alongside existing lib/ and components/ test directories"

requirements-completed: [ENG-01, ENG-02, ENG-03, ENG-04, ENG-05, ENG-06, ENG-07, INFRA-02]

# Metrics
duration: 3min
completed: 2026-03-22
---

# Phase 03 Plan 00: Wave 0 TDD Stubs Summary

**5 test files committed in RED state establishing behavioral contracts for engineer workflow, push token API path, offline WO claim/complete, and ENG-06 push helper — before any Phase 3 implementation code is written**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-22T03:14:15Z
- **Completed:** 2026-03-22T03:17:30Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Extended sync.test.ts with 2 RED cases for work_order/claim and work_order/complete offline handlers
- Created notifications.test.ts: 2 RED tests enforcing INFRA-02 contract (push token via api.patch not direct Supabase)
- Created WorkOrderDetail.test.tsx: 2 RED tests verifying completion_notes payload shape sent to api.post
- Created WorkOrdersList.test.tsx: 2 GREEN + 1 RED (offline enqueue path not yet wired)
- Created test_wo_push.py: RED placeholder for ENG-06 assertion that push helper fires on WO claim

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend sync.test.ts + create notifications.test.ts and WorkOrderDetail.test.tsx** - `df0f170` (test)
2. **Task 2: Create WorkOrdersList.test.tsx and test_wo_push.py** - `b410599` (test)

_Note: TDD Wave 0 plan — all commits are test-only, no implementation commits_

## Files Created/Modified
- `apps/mobile/__tests__/lib/offline/sync.test.ts` - Extended with 2 RED test cases for work_order/claim and work_order/complete handlers in flushSyncQueue
- `apps/mobile/__tests__/lib/notifications.test.ts` - New: 2 RED tests asserting savePushTokenToProfile calls api.patch not supabase.from
- `apps/mobile/__tests__/screens/WorkOrderDetail.test.tsx` - New: 2 RED tests checking testID="completion-notes" and api.post payload shape
- `apps/mobile/__tests__/screens/WorkOrdersList.test.tsx` - New: 2 GREEN (renders, Claim button) + 1 RED (offline enqueue)
- `apps/api/tests/smoke/test_wo_push.py` - New: RED placeholder for ENG-06 push-on-claim assertion

## Decisions Made
- sync.test.ts was extended (not rewritten) — existing 3 tests in flushSyncQueue + 2 refreshRooms tests all preserved GREEN
- test_wo_push.py uses `assert False` as minimal RED stub to satisfy Nyquist Wave 0 requirement without prematurely implementing assertions against non-existent code
- WorkOrdersList tests 1 and 2 are intentionally GREEN because the existing index.tsx already renders card fields and the Claim button — only the offline enqueue path (test 3) is the true RED stub for plan 03-02

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed describe block closure in sync.test.ts**
- **Found during:** Task 1 (Extend sync.test.ts)
- **Issue:** Edit insertion placed new test cases outside the `flushSyncQueue` describe block, creating orphaned code and a syntax error (unexpected token at line 113)
- **Fix:** Rewrote file with new tests correctly inside the `flushSyncQueue` describe block before the closing `})`
- **Files modified:** apps/mobile/__tests__/lib/offline/sync.test.ts
- **Verification:** npm test ran successfully, 5 tests in flushSyncQueue describe block confirmed
- **Committed in:** df0f170 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — Bug)
**Impact on plan:** Necessary fix for parse correctness; no scope change.

## Issues Encountered
- Initial Edit tool insertion placed the two new sync test cases after the `flushSyncQueue` describe closing `});` instead of inside it, causing a Babel parse error. Diagnosed via test runner error output and fixed by rewriting the file with correct structure.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 5 Wave 0 test files exist and are runner-discoverable
- Existing tests (client.test.ts, OfflineBanner, ReportIssueModal) remain GREEN — no regressions
- Plan 03-01 (engineer push backend) can reference test_wo_push.py as its verify target
- Plan 03-02 (work orders mobile) can reference WorkOrdersList.test.tsx test 3 and WorkOrderDetail.test.tsx as its verify targets
- Plan 03-03 (EAS setup) can reference notifications.test.ts as its verify target
- sync.test.ts claim/complete RED tests will turn GREEN when 03-02 adds handlers to flushSyncQueue

---
*Phase: 03-engineer-workflow-push-eas*
*Completed: 2026-03-22*
