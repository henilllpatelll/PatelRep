---
phase: 17-backlog-cleanup
plan: 08
subsystem: web
tags: [housekeeping, inspections, rbac, staff-assignment]

requires: []
provides:
  - "Inspection re-assign picker includes housekeeping_supervisor staff, matching the main Housekeeping board's assignment picker"
affects: [housekeeping inspections, staff assignment pickers]

tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - "apps/web/app/(dashboard)/housekeeping/inspections/page.tsx"

key-decisions:
  - "Mirrored housekeeping/page.tsx line 97's exact filter pattern (role === 'housekeeper' || role === 'housekeeping_supervisor') rather than inventing a new one, per the plan's explicit instruction."
  - "tasks/page.tsx:240's housekeeper-only filter is a separate feature (task assignment) and was explicitly left untouched, per 17-RESEARCH.md Open Question 3's scope decision."

patterns-established: []

duration: 10min
completed: 2026-08-04
---

# Phase 17 Plan 08: Widen inspection re-assign picker to include supervisors Summary

**`inspections/page.tsx`'s re-assign drawer staff filter now includes `housekeeping_supervisor` alongside `housekeeper`, closing the inconsistency with the already-correct main Housekeeping board picker (STAFF-01 half).**

## Performance

- **Duration:** 10 min
- **Completed:** 2026-08-04
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- `housekeepers` filter at `inspections/page.tsx:170` widened from `s.role === 'housekeeper'` to `s.role === 'housekeeper' || s.role === 'housekeeping_supervisor'`, matching `housekeeping/page.tsx:97`'s existing pattern exactly.
- No backend change needed — `GET /staff` already returns supervisor rows in the response, and `_ensure_housekeeper()` in `housekeeping.py` already accepts both roles.
- `tasks/page.tsx:240` confirmed untouched (out of scope per plan's explicit scope decision).

## Task Commits

1. **Task 1: Widen the re-assign picker's role filter to include supervisors** - `0d31badd` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `apps/web/app/(dashboard)/housekeeping/inspections/page.tsx` - `housekeepers` filter (line 170) now includes `housekeeping_supervisor`

## Decisions Made
- Followed the plan's exact instruction to mirror `housekeeping/page.tsx`'s pattern rather than introducing a shared helper — only one other call site exists and the plan explicitly scoped this to a one-line change.
- Left `tasks/page.tsx` untouched per the plan's explicit scope exclusion (task assignment is a different feature from the room-assignment picker).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**Environment note (not a code deviation):** during execution, the target file was observed reverted to its pre-edit state between the first Edit tool call and verification, twice — consistent with concurrent activity from other agents active in this shared session/working directory (confirmed via `git status` showing unrelated in-flight changes to `.planning/STATE.md`, `.wolf/*`, and other Phase 17 plan files at the same time). Re-applied the edit a third time and committed immediately to lock it in; verified via a direct Node.js file read (bypassing any shell/tool caching) and a clean `git show HEAD --stat` before proceeding. No impact on the correctness of the final change.

An unrelated pre-existing `tsc` error (`staff/page.tsx(114,8): error TS2304: Cannot find name 'getInitials'`) appeared on the first `type-check` run despite `getInitials` being defined in that file — a transient artifact of the same concurrent-edit activity mid-run, not a real regression. A second `type-check` run immediately after passed cleanly with zero errors.

## User Setup Required

None. No backend or environment change needed — this was a frontend-only filter widening with no new dependencies.

## Next Phase Readiness
- Closes STAFF-01 (both halves now consistent: main board picker and inspection re-assign picker both include supervisors).
- Live browser verification (failing an inspection, opening the re-assign drawer, selecting a supervisor, confirming re-assign succeeds) was not performed in this session — no browser/Playwright tool was available to this executor. Recommended as a follow-up manual/automated check before closing ROADMAP Phase 17 success criterion 5 end-to-end, though the change is a direct mirror of an already-verified-working pattern (`housekeeping/page.tsx`) and backend support was already confirmed present.

---
*Phase: 17-backlog-cleanup*
*Completed: 2026-08-04*

## Self-Check: PASSED
- FOUND: apps/web/app/(dashboard)/housekeeping/inspections/page.tsx (housekeeping_supervisor filter present)
- FOUND: commit 0d31badd
- FOUND: .planning/phases/17-backlog-cleanup/17-08-SUMMARY.md
