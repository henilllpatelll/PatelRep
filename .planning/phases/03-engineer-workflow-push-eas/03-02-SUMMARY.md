---
phase: 03-engineer-workflow-push-eas
plan: "02"
subsystem: mobile
tags: [react-native, expo, offline, sqlite, sync-queue, work-orders]

requires:
  - phase: 03-00
    provides: TDD RED stubs for sync claim/complete handlers + WO screen offline tests

provides:
  - work_order/claim handler in flushSyncQueue (POST /work-orders/{id}/claim)
  - work_order/complete handler in flushSyncQueue (POST /work-orders/{id}/complete)
  - Offline-first claimWorkOrder in index.tsx with enqueueAction + optimistic update
  - Offline-first completeWorkOrder in [woId].tsx with enqueueAction + optimistic setWorkOrder
  - testID="completion-notes" on TextInput in WorkOrderDetailScreen

affects:
  - 03-03 (push notifications — uses same isOnline/enqueueAction pattern)
  - 03-05 (EAS build — packages these offline-first screens)

tech-stack:
  added: []
  patterns:
    - "isOnline branch pattern: online path calls api directly; offline path calls enqueueAction + applies optimistic state update"
    - "flushSyncQueue extended with new entity_type/action branches — delete call remains shared after the if-else chain"

key-files:
  created: []
  modified:
    - apps/mobile/lib/offline/sync.ts
    - apps/mobile/app/(app)/work-orders/index.tsx
    - apps/mobile/app/(app)/work-orders/[woId].tsx

key-decisions:
  - "work_order/claim flushSyncQueue handler sends empty body {} — claim endpoint takes no payload, consistent with API contract"
  - "work_order/complete handler passes full payload from sync queue — completion_notes travels through queue as-is"
  - "Offline complete path omits photo_urls from enqueueAction payload — photos require Supabase storage upload which is itself network-dependent; deferred to online path only"
  - "loadWorkOrders() still called after offline claim — refreshes list from local SQLite cache without network call"

patterns-established:
  - "Offline branch: enqueueAction(entityType, action, payload, entityId) + optimistic state mutation"
  - "TDD: sync.test.ts RED stubs from 03-00 turned GREEN by adding branches to flushSyncQueue if-else chain"

requirements-completed: [ENG-03, ENG-04, ENG-05, ENG-07]

duration: 8min
completed: 2026-03-22
---

# Phase 03 Plan 02: Offline Work Order Claim and Complete Summary

**Offline-first WO claim and complete via enqueueAction + flushSyncQueue handlers, with optimistic state updates and all 23 mobile tests GREEN**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-22T03:19:00Z
- **Completed:** 2026-03-22T03:27:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Extended flushSyncQueue in sync.ts with work_order/claim (POST /work-orders/{id}/claim) and work_order/complete (POST /work-orders/{id}/complete) branches — all 5 flushSyncQueue test cases GREEN
- Added offline-first path to claimWorkOrder in index.tsx: isOnline check, enqueueAction("work_order", "claim", {}, id), optimistic status flip to "in_progress"
- Added offline-first path to completeWorkOrder in [woId].tsx: isOnline check, enqueueAction("work_order", "complete", {completion_notes}, id), optimistic setWorkOrder to "completed"
- Added testID="completion-notes" to TextInput — WorkOrderDetail.test.tsx both assertions GREEN
- Full suite: 23 tests, 7 suites, all PASS, no regressions

## Task Commits

1. **Task 1: Add work_order/claim and work_order/complete handlers to sync.ts** — `f550de1` (feat)
2. **Task 2: Add offline paths to index.tsx and [woId].tsx + testID** — `8196d63` (feat)

## Files Created/Modified

- `apps/mobile/lib/offline/sync.ts` — Added claim and complete branches to flushSyncQueue if-else chain
- `apps/mobile/app/(app)/work-orders/index.tsx` — Added useAppStore + enqueueAction imports, isOnline hook, offline claimWorkOrder path
- `apps/mobile/app/(app)/work-orders/[woId].tsx` — Added useAppStore + enqueueAction imports, isOnline hook, offline completeWorkOrder path, testID on TextInput

## Decisions Made

- work_order/claim handler sends empty body `{}` — the claim endpoint takes no payload, consistent with API contract
- Offline complete path omits `photo_urls` from the enqueued payload — photo upload requires Supabase storage which is itself network-dependent; deferred to online-only path
- `loadWorkOrders()` is still called after offline claim — it reads from local SQLite cache without requiring a network call

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- ENG-07 (offline WO sync) fully satisfied: claim and complete both queue correctly and flush on reconnect
- sync.ts, index.tsx, and [woId].tsx all satisfy their must_have artifact patterns
- Ready for Plan 03 (push notification deep links) and Plan 04 (WO status chip + UX polish)

---
*Phase: 03-engineer-workflow-push-eas*
*Completed: 2026-03-22*
