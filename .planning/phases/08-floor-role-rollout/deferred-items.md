# Deferred Items — Phase 8 (Floor-Role Rollout)

## Full mobile jest-suite parallel-worker timeouts (pre-existing, out of scope for 08-01)

**Found during:** 08-01 execution, post-task full-suite regression check (`cd apps/mobile && npx jest`).

**Symptom:** 9 of 24 test suites fail with `Exceeded timeout of 5000 ms` inside `waitFor(...)` when the
full suite runs together: `EngineerHome`, `GuestRequestsList`, `WorkOrderDetail`, `WorkOrdersList`,
`InspectorQueue`, `ProfileHandoff`, `TasksVariationA`, `RoomStatusList`, `RoomDetail`.

**Root cause:** Not a code regression. None of these test files import `my-rooms/index.tsx` or
`RoomQueueCard` (the only two files 08-01 touched). Re-running each failing suite in isolation
(`npx jest __tests__/screens/RoomDetail.test.tsx`, `npx jest __tests__/screens/EngineerHome.test.tsx`)
passes 100% green in ~9-16s each. This is jest-worker resource contention/timeout when many
`react-test-renderer` suites run in parallel on this machine, not a functional bug.

**Scope decision:** Pre-existing, unrelated to 08-01's two touched files (`apps/mobile/app/(app)/my-rooms/index.tsx`,
`apps/mobile/components/shared/evening.tsx`). Per CLAUDE.md Scope Boundary, out of scope for this task —
not fixed. Left for a future infra pass (e.g. `--maxWorkers` tuning or `testTimeout` increase in
`jest.config`) if it starts blocking CI.

**Verification of 08-01's own changed files:** `npx jest __tests__/screens/MyRoomsScreen.test.tsx` passes
8/8 both standalone and as part of the full-suite run (it was never in the failing list).
