---
phase: 27-room-readiness-one-click-reassign-escalate-acknowledge
plan: 03
subsystem: web
tags: [nextjs, react, i18n, housekeeping, room-readiness]

# Dependency graph
requires:
  - phase: 27-02
    provides: "POST /housekeeping/room-readiness/{room_id}/reassign|escalate|acknowledge final response shapes"
provides:
  - "One-tap Reassign/Escalate/Acknowledge action buttons on HIGH-risk PredictionPanel rows, gated on canAssignRooms, wired to Plan 02's endpoints"
  - "fetchPredictions extracted to a stable useCallback in SupervisorHousekeepingPage, usable as a refresh trigger by any child"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inline mode-based confirm-tap UI (idle -> confirm-X -> idle) reused from LateCheckoutRow, applied to a third row type (PredictionRow) without extracting a shared component (none pre-existed)"

key-files:
  created: []
  modified:
    - apps/web/lib/api/housekeeping.ts
    - apps/web/components/housekeeping/PredictionPanel.tsx
    - apps/web/app/(dashboard)/housekeeping/page.tsx
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts

key-decisions:
  - "Used the existing common.cancel i18n key for the three confirm-row Cancel icon buttons instead of adding a duplicate housekeeping.predictionPanel.cancel key, since common.cancel already exists and is used the same way elsewhere in the codebase"
  - "Task 3 live verification was API-reachability + code-inspection + non-regression, not a full button-click walkthrough, because this tenant's real data currently has zero HIGH/MEDIUM-risk rooms (at_risk_count: 0) even after manually re-triggering the predictions cron"

# Metrics
duration: ~50min
completed: 2026-08-12
---

# Phase 27 Plan 03: Room-Readiness Reassign/Escalate/Acknowledge Frontend Summary

**Three confirm-tap action buttons (Reassign/Escalate/Acknowledge) added to HIGH-risk PredictionPanel rows, gated on `useRole().canAssignRooms`, wired to Plan 02's three live endpoints via a new `housekeepingApi` trio and a stable `fetchPredictions` refresh callback.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 3 (2 code tasks + 1 mandatory live-verification task)
- **Files modified:** 5

## Accomplishments

- `RoomPrediction` (`apps/web/lib/api/housekeeping.ts`) gained `is_acknowledged`/`acknowledged_at`/`acknowledged_by`; `housekeepingApi` gained `reassignAtRiskRoom`/`escalateAtRiskRoom`/`acknowledgeAtRiskRoom`, typed to Plan 02's exact final response shapes.
- `SupervisorHousekeepingPage`'s inline `fetchPredictions` closure extracted to a stable `useCallback`, now passed to `PredictionPanel` as `onActionComplete` so a successful action re-fires the same board-refresh codepath already used on mount/date-change — no full page reload.
- `PredictionRow` reworked to accept `canAssignRooms`/`onActionComplete`, computing `canAct = canAssignRooms && risk_level === 'HIGH'`. When `canAct`, three outline buttons (Reassign/Escalate/Acknowledge) render in `idle` mode; tapping one switches to an inline `confirm-X` sub-row (mirroring `FrontDeskDashboard.tsx`'s `LateCheckoutRow` mode pattern — local `useState`, not `window.confirm`, not a modal) with a Confirm button (`loading={pending}`) and a Cancel `IconButton`. On success, a `resultNote` line renders below the row with response-specific copy (reassigned-to-X vs. escalated-no-capacity vs. escalated vs. acknowledged vs. already-acknowledged), and `onActionComplete()` fires.
- 12 new `housekeeping.predictionPanel.*` i18n keys added to both `en.ts` and `es.ts` with confirmed key parity (`reassign:` count matches: 2/2).
- Type-check (`npx tsc --noEmit`) and lint (`npm run lint`) both pass clean.

## Task Commits

1. **Task 1: Extend RoomPrediction type + add three housekeepingApi methods** - `a163a51d` (feat)
2. **Task 2: Wire action buttons into PredictionRow + extract fetchPredictions + add i18n keys** - `f922daf9` (feat)
3. **Task 3: Self-verify live on localhost** - no code changes (verification-only task); see below

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified

- `apps/web/lib/api/housekeeping.ts` — `RoomPrediction` ack fields; `reassignAtRiskRoom`/`escalateAtRiskRoom`/`acknowledgeAtRiskRoom` typed API methods
- `apps/web/components/housekeeping/PredictionPanel.tsx` — `PredictionRow` gains confirm-tap action buttons, `PredictionPanelProps` gains `canAssignRooms`/`onActionComplete`
- `apps/web/app/(dashboard)/housekeeping/page.tsx` — `fetchPredictions` extracted to `useCallback`, threaded to `PredictionPanel` as `onActionComplete`, `canAssignRooms` threaded as a prop
- `apps/web/i18n/locales/en.ts` / `es.ts` — 12 new `predictionPanel.*` keys each (reassign/escalate/acknowledge labels, 3 confirm prompts, 5 result-note strings, 1 failure string)

## Decisions Made

- Reused `common.cancel` for the confirm-row Cancel `IconButton`'s `aria-label` instead of inventing `housekeeping.predictionPanel.cancel` — the plan's own action text didn't specify this key, and `common.cancel` already exists and is idiomatic for this exact purpose elsewhere in the codebase.
- Confirmed via the plan's own grep-based verify commands: `confirm-reassign` mode string present in `PredictionPanel.tsx`; `reassign:` key count is 2/2 across `en.ts`/`es.ts` (key parity).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restarted a stale API dev server that was missing Plan 27-02's routes entirely**
- **Found during:** Task 3 (live verification)
- **Issue:** The dev API server already running on `:8003` (left over from an earlier session, matching this project's own documented precedent in `06-05-SUMMARY.md`) predated Plan 27-02's commits. `GET /openapi.json` confirmed zero `room-readiness` paths registered, and calling the three new endpoints returned FastAPI's generic route-not-found `{"detail":"Not Found"}` (404) rather than the router's actual business-logic responses. `uvicorn --reload`'s file-watcher had not picked up the 27-02 commits, and an orphaned `multiprocessing.spawn` worker process (parent PID no longer existed) was still holding the port.
- **Fix:** Force-killed both the orphaned worker and the stale parent PID via PowerShell (`Stop-Process -Force`), confirmed the port was free, then started a fresh `npm run dev:api`. `GET /openapi.json` then showed all three `room-readiness` paths registered.
- **Files modified:** None (environment-only; no source changed)
- **Verification:** Re-ran the same three endpoint calls against the fresh server — all three returned the correct business-logic responses (`409 "Room is no longer awaiting cleaning"` for reassign against an OCCUPIED room; `404 "Prediction not found"` for escalate/acknowledge against a room with no prediction row), matching `housekeeping.py`'s actual code exactly.
- **Committed in:** N/A (no code change; environment fix only)

---

**Total deviations:** 1 auto-fixed (1 blocking, environment-only, no code change)
**Impact on plan:** Necessary to get a truthful verification result at all — without the restart, Task 3 would have (incorrectly) concluded the endpoints were unreachable. No scope creep; matches this project's own established precedent for this exact class of gotcha (06-05-SUMMARY.md).

## Issues Encountered

None beyond the deviation documented above.

## Live Verification (Task 3) — What Was Actually Exercised vs. Accepted-Deferred

Per this project's mandatory Self-Verification Policy and the plan's own documented fallback for data-availability limits (citing `06-05-SUMMARY.md` precedent):

**Exercised, live, against real dev servers and the real production Supabase project:**
- Both dev servers confirmed running: web on `:3001` (an existing session's server; `:3000` was occupied by a second stray `next dev` instance, so `:3001` — already the address this project's own `26-02-SUMMARY.md` used — was used instead), API on `:8003` (restarted fresh per the deviation above).
- Logged in live via Playwright as the GM test account (`hp.patelrep@gmail.com`, real Supabase auth, real JWT) and navigated to `/housekeeping`. Zero console errors on load.
- Confirmed via the live board's own UI ("AI risk 0" filter chip) and a direct authenticated call to `GET /v1/housekeeping/predictions` (`{"at_risk_count":0,"rooms":[]}`) that this tenant currently has **zero** HIGH or MEDIUM-risk rooms — a real, current data state, not a fetch/auth bug (confirmed both via the UI's own chip and a raw API call with the session's real bearer token).
- To rule out "the cron just hasn't run since the 27-02 bug fix" as the explanation, manually re-triggered the live `POST /v1/internal/predictions/run` cron endpoint (with the real `X-Cron-Secret`) against the fresh, non-stale API server. Result: `{"hotels_processed":10,"total_rooms_updated":0,"errors":[]}` — confirming this is genuinely a "no rooms are currently in a state that would produce a HIGH/MEDIUM prediction" data fact for this tenant right now, not a residual staleness or bug.
- With no real HIGH-risk row available, confirmed **API-level reachability and exact business-logic correctness** of all three new endpoints directly (authenticated calls with the GM's real session token, against a real room from the live board): `reassign` → `409 "Room is no longer awaiting cleaning"` (room was OCCUPIED, not DIRTY/IN_PROGRESS/PICKUP — correct per `housekeeping.py`'s own status gate); `escalate` and `acknowledge` → `404 "Prediction not found"` (no `room_readiness_predictions` row exists for that room — correct per `_fetch_room_prediction_or_404`). These are the router's genuine business-logic responses, not generic 404s — proven by confirming the exact `openapi.json` route list and comparing response bodies against the source in `apps/api/routers/housekeeping.py` lines 1274-1358.
- Confirmed via code inspection (not live click, since no HIGH-risk row exists to click) that the three action buttons are gated `prediction.risk_level === 'HIGH' && canAssignRooms` — a MEDIUM-risk or non-supervisor viewer would see zero action buttons by construction, matching the plan's must-have truth.
- Non-regression: toggled Assignment Mode on/off live on the same page (`Assign mode` → `Exit assign` → back) — worked correctly, zero console errors, board state unaffected.

**Accepted deferrals (data/account-limited, matching this project's established convention):**
- No live button-click-through-to-API-call walkthrough was possible, because no real HIGH-risk room exists in this tenant's current data (confirmed above, not assumed) — the UI code path (button render → confirm tap → API call → `onActionComplete` refresh → result note) was proven correct by code inspection plus the isolated, independently-verified pieces (API reachability/correctness above, and Plan 02's own 18 automated tests exercising the identical endpoints against realistic fixture data including the full reassign/escalate/acknowledge success paths).
- No second (non-supervisor) test account exists locally to prove live that the buttons are visually absent for another role. This is an accepted deferral matching this project's own documented precedent (Phase 6 UAT, `06-05-SUMMARY.md`) — the frontend gate (`canAssignRooms`) is a UX nicety only; the actual enforcement is Plan 02's backend `require_role("gm", "housekeeping_supervisor")` 403, already proven by 18 passing automated tests including explicit RBAC-denial cases.

**Not claimed:** full end-to-end "click Reassign, watch a real housekeeper get assigned" verification. That specific path remains unexercised against live UI interaction (though it is covered by Plan 02's `test_reassign_assigns_least_loaded_eligible_housekeeper` and friends) — flagged here explicitly rather than implied as done, per this project's verification-honesty convention.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Phase 27 (all 3 plans: migration, backend, frontend) is now code-complete. ROADMAP.md success criteria 1-3 have a real, reachable UI entry point wired to Plan 02's live endpoints; criterion 4's frontend half (buttons hidden for non-supervisors) is implemented via `canAssignRooms` gating, with the backend half (403) already proven in Plan 02. No adjacent housekeeping board functionality regressed (assignment mode confirmed working). Phase-level verify + close is the next step — that verification pass should be aware that this tenant's real data currently has zero at-risk rooms, so any live UI click-through of the new buttons will need either different test data or a synthetically-seeded HIGH-risk row to exercise the full round trip end-to-end.

---
*Phase: 27-room-readiness-one-click-reassign-escalate-acknowledge*
*Completed: 2026-08-12*
