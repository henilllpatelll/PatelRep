---
phase: 28-batch-actions
plan: 03
subsystem: web
tags: [nextjs, react-query, i18n, room-readiness, batch, rbac]

# Dependency graph
requires:
  - phase: 28-batch-actions
    plan: 01
    provides: "POST /housekeeping/room-readiness/batch-reassign, POST /housekeeping/room-readiness/batch-acknowledge and their final response shapes"
provides:
  - "housekeepingApi.batchReassignAtRiskRooms / batchAcknowledgeAtRiskRooms — typed API client methods"
  - "PredictionPanel checkbox multi-select + inline contextual batch action bar"
  - "housekeeping.predictionPanel.* batch i18n keys (en.ts/es.ts, at parity)"
affects: [28-04 (asset batch frontend — extends the same en.ts/es.ts predictionPanel-adjacent namespace)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inline contextual action bar (not modal): selection state + confirm sub-state live at the panel level, mirroring PredictionRow's own idle -> confirm-X -> result mode machine, scaled from 1 room to N"
    - "Shared board-refresh reset point: onActionComplete is wrapped once (handleActionComplete) so both single-row actions and batch actions clear panel-level selection/batchMode identically"

key-files:
  created: []
  modified:
    - apps/web/lib/api/housekeeping.ts
    - apps/web/components/housekeeping/PredictionPanel.tsx
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts

key-decisions:
  - "Selection state (Set<string>) and batchMode ('idle'|'confirm-reassign'|'confirm-acknowledge') live at the PredictionPanel level, not per-row, since selection spans multiple PredictionRow instances"
  - "Select all/deselect all is scoped only to the currently-rendered canAct (HIGH-risk, supervisor/GM) room ids in atRiskRooms — never hotel-wide — per plan instruction"
  - "Per-room batch result summary reuses the existing single-row outcome i18n strings (reassignedTo/escalatedNoCapacity/acknowledged/alreadyAcknowledged/actionFailed) rather than duplicating them, plus one new batchResultSummary count line"

patterns-established: []

# Metrics
duration: ~40min
completed: 2026-08-13
---

# Phase 28 Plan 03: Room-Readiness Batch Actions Frontend Summary

**Checkbox multi-select on HIGH-risk actionable rows plus an inline contextual action bar in `PredictionPanel.tsx`, wired to two new typed API client methods, letting a supervisor/GM batch-reassign or batch-acknowledge at-risk rooms and see a per-room outcome — not a modal, not a single toast.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 3 completed (2 code tasks + 1 live-verification task)
- **Files modified:** 4

## Accomplishments

- `housekeepingApi.batchReassignAtRiskRooms(roomIds)` / `batchAcknowledgeAtRiskRooms(roomIds)` added to `apps/web/lib/api/housekeeping.ts`, typed against Plan 28-01's exact final response shapes (`BatchReassignResult` / `BatchAcknowledgeResult` discriminated unions, `{ data: { results, succeeded, failed } }`)
- `PredictionRow` (`PredictionPanel.tsx`) gained a checkbox rendered only when `canAct` (`canAssignRooms && risk_level === 'HIGH'`) — the exact same gate the existing single-row action buttons already use, so MEDIUM rows and non-supervisor views never get a checkbox by construction
- `PredictionPanel` gained selection state (`Set<string>`), an inline contextual action bar (shown once `selected.size >= 1`, top of the expanded body) with selected count, a select-all/deselect-all toggle scoped to the currently-rendered actionable rows, and Batch reassign / Batch acknowledge buttons
- Confirm step mirrors `PredictionRow`'s own `idle -> confirm-X` mode machine (`batchMode: 'idle' | 'confirm-reassign' | 'confirm-acknowledge'`), firing a `useMutation` on confirm
- Per-room result summary renders from `data.results` as a compact list (reusing existing per-outcome i18n strings) plus a `batchResultSummary` succeeded/failed count line — not a single toast, not N toasts
- `handleActionComplete()` wraps the `onActionComplete` prop so both single-row and batch actions clear `selected`/`batchMode` on the same board-refresh callback, preventing stale selections after a refresh changes risk levels
- 9 new `housekeeping.predictionPanel.*` i18n keys added to `en.ts`/`es.ts` at confirmed parity (`batchReassign`, `batchAcknowledge`, `selectAll`, `deselectAll`, `selectedCount`, `confirmBatchReassign`, `confirmBatchAcknowledge`, `batchResultSummary`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add batch API client methods + EN/ES i18n keys** - `fca289e9` (feat)
2. **Task 2: Add checkbox selection + contextual action bar to PredictionPanel.tsx** - `978e059f` (feat)
3. **Task 3: Live self-verification on localhost** - no code changes (verification only)

## Live Verification (Task 3)

**Environment fix (Rule 3, blocking, no code change):** the dev API server on `:8003` predated this session's 28-01 backend commits — `GET /openapi.json` showed zero `batch-reassign`/`batch-acknowledge` routes registered, the same class of stale-`--reload`-process gotcha documented in `27-03-SUMMARY.md`/`06-05-SUMMARY.md`. Killed the stale `uvicorn`/`multiprocessing.spawn` processes and restarted `npm run dev:api`; `GET /openapi.json` then correctly listed both new routes.

**Data fallback applied (documented precedent from 27-03, confirmed still current):** `GET /v1/housekeeping/predictions` against the live tenant returns `at_risk_count: 0` (verified via a real GM Supabase auth token against the running API). The parent page (`apps/web/app/(dashboard)/housekeeping/page.tsx:732`) only mounts `<PredictionPanel>` at all when `predictions.some(p => risk_level === 'HIGH' || 'MEDIUM')` — a pre-existing, unmodified gate — so with zero at-risk rooms the panel (and therefore any checkbox/action-bar UI) does not render on this tenant right now. This is the exact scenario the plan's own DATA FALLBACK anticipated, confirmed still true today.

Verified per the plan's three-part fallback:
- **(a) API reachability, live:** called both new endpoints directly against a real room id pulled from `GET /housekeeping/board` (`375646b7-f567-4ad4-8887-01ff2d13018c`, an OCCUPIED room with no readiness prediction). `batch-acknowledge` → `{"results":[{"room_id":"...","action":"error","status":404,"detail":"Prediction not found"}],"succeeded":0,"failed":1}`; `batch-reassign` → `{"results":[{"room_id":"...","action":"error","status":409,"detail":"Room is no longer awaiting cleaning"}],"succeeded":0,"failed":1}` — both are the router's real business-logic responses (not a generic route-not-found 404), proving the endpoints are live and match the frontend's typed response shapes exactly.
- **(b) Checkbox/action-bar gating, by code inspection:** `PredictionRow`'s checkbox and `PredictionPanel`'s action bar both gate on the identical `canAssignRooms && risk_level === 'HIGH'` condition the pre-existing single-row buttons already use and that Plan 27-02/27-03 already RBAC-tested; `toggleSelected` is only ever wired to the gated checkbox, so `selected` can never contain a non-`canAct` room id by construction. A scripted Playwright pass against the real logged-in GM session (`localhost:3001/housekeeping`) confirmed **zero console errors** and confirmed the panel section is absent from the DOM given the current zero-at-risk-room state, consistent with the page-level gate.
- **(c) Full success/failure matrix:** covered by Plan 28-01's 14 automated tests (`test_room_readiness_batch_actions.py`) against the exact backend the frontend now calls.

Non-regression: `PredictionRow`'s existing single-row Reassign/Escalate/Acknowledge buttons and confirm-subrows were not restructured — only a sibling checkbox and an `isSelected`/`onToggleSelect` prop pair were added; `npm run type-check` and `npm run lint` (via `eslint`) both pass clean with zero errors across all three changed web files.

## Files Created/Modified

- `apps/web/lib/api/housekeeping.ts` - `batchReassignAtRiskRooms`/`batchAcknowledgeAtRiskRooms` + `BatchReassignResult`/`BatchAcknowledgeResult`/`BatchRoomActionError` types
- `apps/web/components/housekeeping/PredictionPanel.tsx` - checkbox on `PredictionRow`, selection/batchMode/batchResult state + inline action bar + per-room result list on `PredictionPanel`, shared `handleActionComplete` reset
- `apps/web/i18n/locales/en.ts` / `es.ts` - 9 new `housekeeping.predictionPanel.*` batch keys, confirmed parity

## Decisions Made

- Selection reset happens through a single shared `handleActionComplete` wrapper (not two separate reset paths for single-row vs. batch), so board-refresh always clears stale selections regardless of which action triggered it.
- Select-all/deselect-all scoped strictly to `atRiskRooms.filter(HIGH).map(room_id)` (the currently-rendered actionable set), never a separate hotel-wide fetch — matches CONTEXT.md's explicit instruction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restarted stale dev API server missing 28-01's new routes**
- **Found during:** Task 3 live verification
- **Issue:** `:8003` uvicorn process predated 28-01's backend commits (started 2026-08-12 5:17 PM); `GET /openapi.json` listed no `batch-reassign`/`batch-acknowledge` routes.
- **Fix:** Killed the stale `uvicorn --reload` parent/child processes and their orphaned `multiprocessing.spawn` worker, restarted `npm run dev:api`.
- **Verification:** `GET /openapi.json` now lists both new routes; direct calls returned real business-logic responses.
- **Committed in:** N/A (environment-only, no code change)

---

**Total deviations:** 1 auto-fixed (blocking/environment, no code change)
**Impact on plan:** None on shipped code — same anticipated risk class the plan itself flagged (citing 27-03/06-05 precedent).

## Issues Encountered

None beyond the one documented environment deviation above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 28-04 (asset batch frontend, wave 3) depends on both this plan and 28-02 finishing, including this plan's i18n key additions to `en.ts`/`es.ts` — the new `housekeeping.predictionPanel.*` batch keys were added additively at the end of the existing `predictionPanel` block, so 28-04 can extend the same files without conflict.
- No blockers.

---
*Phase: 28-batch-actions*
*Completed: 2026-08-13*

## Self-Check: PASSED

All modified files confirmed present on disk with expected content; both task commit hashes (`fca289e9`, `978e059f`) confirmed present in `git log --oneline --all`.
