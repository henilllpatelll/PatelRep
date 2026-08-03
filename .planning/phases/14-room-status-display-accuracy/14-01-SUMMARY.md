---
phase: 14-room-status-display-accuracy
plan: 01
subsystem: api
tags: [fastapi, supabase, housekeeping, room-status]

# Dependency graph
requires: []
provides:
  - Housekeeping board GET /housekeeping/board falls back to room_status.assigned_to when no today room_assignments row exists (ROOMSTATUS-01)
  - Regression test coverage for all 3 ROOMSTATUS-01 success criteria
affects: [housekeeping, ai-copilot-assignments]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Board endpoint prefers today's room_assignments row when present, otherwise falls back to the room_status.assigned_to mirror — assignment_id/date/shift_id stay None in the fallback case so no assignment is fabricated"

key-files:
  created: []
  modified:
    - apps/api/routers/housekeeping.py
    - apps/api/tests/smoke/test_housekeeping_assignments.py

key-decisions:
  - "room_status.assigned_to is authoritative whenever no today room_assignments row exists, even if it is a leftover from a prior day (room_status has no per-assignment timestamp to distinguish current vs. stale) — user explicitly approved this reversal of the prior 'not stale' behavior"

patterns-established:
  - "When room_status mirrors an assignment field with no timestamp, treat it as authoritative in the absence of a same-day source-of-truth row, rather than suppressing it as potentially stale"

# Metrics
duration: 22min
completed: 2026-08-02
---

# Phase 14 Plan 01: Room Status Display Accuracy Summary

**One-line backend fallback so the housekeeping board surfaces `room_status.assigned_to` when no today `room_assignments` row exists, replacing false "Unassigned" states with the real assignee.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-08-02T22:10:00Z
- **Completed:** 2026-08-02T22:32:00Z
- **Tasks:** 3 (2 auto + 1 checkpoint:human-verify)
- **Files modified:** 2

## Accomplishments
- `GET /housekeeping/board` (`get_housekeeping_board`) now falls back to `room.get("assigned_to")` (the live `room_status.assigned_to` mirror) when `assignment_map` has no row for the requested date, instead of forcing `assigned_to` to `None`
- `assignment_id`, `assignment_date`, and `assignment_shift_id` remain `None` in the fallback case — no assignment row is fabricated, only the assignee name is surfaced
- Updated the one conflicting test assertion and added a new regression test (`test_board_uses_room_status_assignee_when_no_today_assignment_row`) covering all 3 success criteria in one deterministic board call
- User explicitly confirmed the deliberate reversal of the prior "not stale assignee" behavior at the Task 3 checkpoint

## Task Commits

Each task was committed atomically:

1. **Task 1: Fall back to room_status.assigned_to on the board when no today assignment row exists** - `f9d7ccf9` (fix)
2. **Task 2: Update conflicting test + add regression coverage for all 3 success criteria** - `08e413f2` (test)
3. **Task 3: Confirm the deliberate reversal of the prior "not stale assignee" board behavior** - checkpoint:human-verify, resolved by user approval (no code commit — confirmation gate only)

**Plan metadata:** `97256e2a` (docs: record progress through Task 2, paused at Task 3 checkpoint)

## Files Created/Modified
- `apps/api/routers/housekeeping.py` - `get_housekeeping_board`'s `assigned_to` field now falls back to `room.get("assigned_to")` when no today `room_assignments` row exists
- `apps/api/tests/smoke/test_housekeeping_assignments.py` - updated `test_board_uses_selected_date_assignments_not_stale_room_status`'s conflicting assertion (renamed to reflect the fallback), added `test_board_uses_room_status_assignee_when_no_today_assignment_row` covering SC1/SC2/SC3

## Decisions Made
- **room_status.assigned_to is authoritative when no today assignment row exists**, even for a leftover prior-day assignee. `room_status` carries no per-assignment timestamp, so "current" and "stale-from-yesterday" mirrors are indistinguishable in code. The plan's stated intent (ROOMSTATUS-01) was to always surface `room_status.assigned_to` rather than suppress it — the Task 3 checkpoint asked the user to confirm this explicitly since it's a real behavior change (a room can now show an assignee that isn't backed by a same-day `room_assignments` row). **User selected "Approve as-is"** — no revision needed.

## Deviations from Plan

None - plan executed exactly as written. Task 3 was a confirmation-only checkpoint (no code change permitted per plan instructions) and resolved via explicit user approval.

## Issues Encountered

None.

## Self-Verification (per CLAUDE.md Self-Verification Policy)

- Full `apps/api` pytest suite: **511/513 passed**. The 2 failures are in `test_management_roi.py` and were confirmed via `git stash` to pre-exist this plan's changes (unrelated to housekeeping/assignments).
- `apps/api/tests/smoke/test_housekeeping_assignments.py`: **29/29 passed**, including the renamed `test_board_falls_back_to_room_status_assignee_when_no_today_assignment_row` and the new `test_board_uses_room_status_assignee_when_no_today_assignment_row`.
- Live browser walkthrough on `localhost:3000` (web) / `localhost:8003` (api): housekeeping board loads with zero console errors; Assign mode correctly assigns, displays, and removes a housekeeper name end-to-end with zero residue left in the dev DB.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- ROOMSTATUS-01 is fully satisfied; Phase 14 is the last phase in milestone v1.2 Stabilization Pass.
- No blockers. `.wolf`-tracked doc-drift item (crons via APScheduler, not GitHub Actions) remains open but is explicitly out of v1.2 scope.

---
*Phase: 14-room-status-display-accuracy*
*Completed: 2026-08-02*
