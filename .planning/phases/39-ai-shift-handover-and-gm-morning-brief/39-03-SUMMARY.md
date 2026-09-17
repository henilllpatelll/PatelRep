---
phase: 39-ai-shift-handover-and-gm-morning-brief
plan: 03
subsystem: logbook
tags: [fastapi, logbook, shift-summaries, acknowledgment, supabase, nextjs, api-client]

requires:
  - "shift_summaries.acknowledged_by / acknowledged_at (from 39-01, applied live)"
provides:
  - "POST /v1/logbook/shift-summary/{summary_id}/acknowledge (any-role, idempotent, tenant-scoped)"
  - "get_shift_summary returns acknowledged_by, acknowledged_at, acknowledged_by_name"
  - "web logbookApi.acknowledgeShiftSummary + extended getShiftSummary return type"
affects: [39-04, 39-05]

tech-stack:
  added: []
  patterns:
    - "read-confirmation endpoint gated by get_current_user only (no require_role) — deliberately not GM-only"
    - "idempotent acknowledge: re-ack returns original acknowledged_by/at unchanged with already_acknowledged flag, never 409"

key-files:
  created:
    - apps/api/tests/test_shift_summary_acknowledgment.py
  modified:
    - apps/api/routers/logbook.py
    - apps/web/lib/api/logbook.ts

key-decisions:
  - "Idempotent response includes an additive already_acknowledged:true flag (CONTEXT allowed either silent no-op or flag) so the UI can distinguish a fresh ack from a re-click without a refetch."
  - "Name resolution reuses the internal.py user_profiles lookup pattern via a small local _resolve_user_name helper, preferring preferred_name then full_name to match the logbook EntryCard convention; no new shared helper introduced."

patterns-established: []

duration: 5min
completed: 2026-09-17
---

# Phase 39 Plan 03: Shift-Summary Acknowledgment Endpoint + Web Client Summary

**Adds an any-role, idempotent, tenant-scoped acknowledge endpoint and surfaces the acknowledger's resolved name on GET, plus the matching typed web API client methods.**

## Performance

- **Duration:** ~5 min
- **Completed:** 2026-09-17
- **Tasks:** 3/3 completed
- **Files modified:** 3 (2 modified, 1 created)

## Accomplishments
- `POST /v1/logbook/shift-summary/{summary_id}/acknowledge`: no `require_role` gate (any authenticated staff may confirm a handoff read), idempotent (re-ack returns the original acknowledger unchanged with an `already_acknowledged: true` flag, never a 409), tenant-scoped on both the read and the update, 404 on missing/cross-tenant id.
- `get_shift_summary` extended to resolve and return `acknowledged_by_name` (null when unacknowledged) alongside the raw `acknowledged_by`/`acknowledged_at` the `select("*")` already returned.
- `_resolve_user_name` helper added to logbook.py, reusing the `user_profiles` lookup pattern from `internal.py` (preferred_name then full_name).
- `apps/web/lib/api/logbook.ts`: `getShiftSummary` return type extended with `id` + the three acknowledgment fields; new `acknowledgeShiftSummary(summaryId)` method POSTs to the endpoint and returns the acknowledgment shape.
- New test file `test_shift_summary_acknowledgment.py` (6 tests, all green): any-role acknowledge, idempotent no-overwrite, 404 missing, 404 cross-tenant, name resolution, and null-name-when-unacknowledged.

## Task Commits
1. **Task 1: acknowledge endpoint + extend get_shift_summary** — `78b29f08`
2. **Task 2: acknowledgment test file (6 tests green)** — `a5a4103e`
3. **Task 3: extend web logbook API client** — `d8c6cc1e`

## Files Created/Modified
- **Created:** `apps/api/tests/test_shift_summary_acknowledgment.py`
- **Modified:** `apps/api/routers/logbook.py`, `apps/web/lib/api/logbook.ts`

## Decisions Made
- Idempotent response carries an additive `already_acknowledged: true` flag (CONTEXT left this to Claude's discretion) so Plan 04's UI can tell a fresh ack from a re-click without refetching.
- Reused the existing `internal.py` `user_profiles` lookup pattern via a small local `_resolve_user_name` helper rather than introducing a new shared profile-lookup utility.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## Verification
- `python -c "import ast; ast.parse(...)"` on logbook.py: parses.
- `python -m pytest tests/test_shift_summary_acknowledgment.py -v`: 6 passed.
- `npx tsc --noEmit` in apps/web: no errors originating from logbook.ts.

## User Setup Required
None. Migration 105 (columns) was already applied live by the orchestrator in 39-01.

## Next Phase Readiness
Plan 04 (UI: Logbook page Acknowledge button + OvernightRecapStrip affordance) can consume `logbookApi.acknowledgeShiftSummary` and the extended `getShiftSummary` type directly. No blockers.

## Self-Check: PASSED

---
*Phase: 39-ai-shift-handover-and-gm-morning-brief*
*Completed: 2026-09-17*
