# Deferred Items — Phase 10

- **Pre-existing test warning (observed during 10-01):** `WorkOrdersList.test.tsx` passes, but its asynchronous `loadActive` state updates emit React `act(...)` warnings. This predates and is unrelated to the appearance provider; no production behavior failed.
- **Provider hydration test warnings (introduced by 10-01, deferred to root-gating work):** `ReportIssueModal.test.tsx` and `RoomDetailSheet.test.tsx` render the real `ThemeProvider` without awaiting its new AsyncStorage hydration, so React reports an unwrapped state update even though both suites pass. Plan 10-01 owns only the provider and focused theme tests; the Phase 10 root hydration/navigation plans should update shared render helpers or await hydration without changing production behavior.
