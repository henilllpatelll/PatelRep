---
phase: 17-backlog-cleanup
plan: 01
subsystem: web+api
tags: [null-safety, staff, avatar, ux, react-query]

requires: []
provides:
  - "Null-safe full_name across staff API + all 3 render surfaces (Staff, Scheduling, Housekeeping)"
  - "Shared getDisplayName() fallback helper in lib/utils/avatar.ts"
affects: [staff-page, scheduling-page, housekeeping-page]

tech-stack:
  added: []
  patterns: ["getDisplayName(name, fallback) as the single source of truth for staff name rendering"]

key-files:
  created: []
  modified:
    - apps/api/routers/staff.py
    - apps/web/lib/utils/avatar.ts
    - apps/web/app/(dashboard)/staff/page.tsx
    - apps/web/app/(dashboard)/scheduling/page.tsx
    - apps/web/app/(dashboard)/housekeeping/page.tsx

key-decisions:
  - "housekeeping/page.tsx applies getDisplayName once at the data-mapping source (line 99, building the housekeepers list) rather than at each of its 3 downstream render sites, since all downstream reads already flow through that single mapped value."

patterns-established: []

duration: unknown (executed across a prior interrupted session; commits recovered and verified this session)
completed: 2026-08-04
---

# Phase 17 Plan 01: Staff Display Name Null-Safety Summary

**Fixes UX-01: a NULL `user_profiles.full_name` no longer crashes or renders blank on Staff, Scheduling, or Housekeeping — it shows "Unnamed Staff" everywhere, sourced from one shared, null-safe helper.**

## Performance

- **Tasks:** 2
- **Files modified:** 5
- **Completed:** 2026-08-04

## Accomplishments
- `apps/api/routers/staff.py:136` fixed from `profile.get("full_name", "")` (only substitutes on missing key, not on `None`) to `profile.get("full_name") or ""` — matches the established safe pattern already used in `housekeeping.py`, `reports.py`, `programs.py`.
- `apps/web/lib/utils/avatar.ts` gained a null-safe `getInitials(name?: string | null)` and a new exported `getDisplayName(name?: string | null, fallback = 'Unnamed Staff')` helper — single source of truth.
- All 3 duplicate local `getInitials` implementations (in `staff/page.tsx`, `scheduling/page.tsx`, `housekeeping/page.tsx`) deleted and replaced with the shared import.
- Every unguarded `.full_name`/`.name` render, split, and search site across the 3 files now routes through `getDisplayName`.
- `npm run type-check` (apps/web) passes with zero errors, confirmed this session.

## Task Commits

1. **Task 1: Backend null-safety fix + shared frontend helper** - `72dd7536` (fix)
2. **Task 2: Consolidate duplicate getInitials + apply fallback across render sites** - split across 3 file-scoped commits (all same task, committed per-file rather than as one combined diff):
   - `77bea298` (fix) - staff page
   - `25d307d4` (fix) - scheduling page
   - `8bd0b6e4` (fix) - housekeeping page

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `apps/api/routers/staff.py` - `list_staff()` no longer emits `full_name: null` for a NULL profile row
- `apps/web/lib/utils/avatar.ts` - null-safe `getInitials`, new `getDisplayName` fallback helper
- `apps/web/app/(dashboard)/staff/page.tsx` - local `getInitials` removed; 6 render/split/search sites wrapped in `getDisplayName`
- `apps/web/app/(dashboard)/scheduling/page.tsx` - local `getInitials` removed; 5 render/split/option-label sites wrapped in `getDisplayName` (the pre-existing `memberName` fallback chain at ~line 1198 left untouched, out of scope per plan)
- `apps/web/app/(dashboard)/housekeeping/page.tsx` - local `getInitials` removed; fallback applied once at the housekeepers-list mapping source (line 99), covering all 3 downstream `hk.name` reads

## Decisions Made
- Task 2's 3 files were committed individually per-file (one fix commit each) rather than combined into a single Task 2 commit — functionally equivalent, no scope difference from the plan.

## Deviations from Plan

None — plan executed exactly as written. Verified this session via direct grep/read of all 5 touched files against the plan's exact line-level spec; every call site matches (housekeeping's 3 downstream sites correctly rely on the single upstream fix at line 99, as the plan anticipated).

## Issues Encountered

**Session-continuity note (not a code issue):** this plan's implementation commits (`72dd7536`, `77bea298`, `25d307d4`, `8bd0b6e4`) were made by a prior executor running as 1 of 8 fully-parallel agents that hit the account session limit mid-run — after all 4 commits landed but before SUMMARY.md was written. This session verified all 4 commits exist, all 5 touched files match the plan's exact spec (backend fix, helper exports, all local `getInitials` duplicates removed, all render/split/search sites wrapped), and `npm run type-check` passes clean — then wrote this SUMMARY and closed the plan. No code was re-done.

**Live browser walkthrough not performed this session:** no Playwright/browser tool was available to this executor (same environment constraint documented in `15-02-SUMMARY.md`). Static verification (backend/frontend code match against plan spec + clean type-check) was completed; a live check with a NULL-named staff row rendering "Unnamed Staff" with no console error remains an open follow-up, consistent with how other Phase 17 plans have flagged unexercised live-browser steps.

## User Setup Required

None — this is a pure code fix, no migration or external config needed.

## Next Phase Readiness
- No blockers for other Phase 17 plans. This plan had no dependencies and no declared dependents.
- Recommended follow-up (not blocking): a live authenticated browser walkthrough of Staff, Scheduling, and Housekeeping pages with a seeded NULL-`full_name` staff row, to close the residual live-verification gap noted above.

---
*Phase: 17-backlog-cleanup*
*Completed: 2026-08-04*

## Self-Check: PASSED
- FOUND: apps/api/routers/staff.py (contains `profile.get("full_name") or ""`)
- FOUND: apps/web/lib/utils/avatar.ts (contains `getDisplayName`)
- FOUND: commit 72dd7536
- FOUND: commit 77bea298
- FOUND: commit 25d307d4
- FOUND: commit 8bd0b6e4
- FOUND: .planning/phases/17-backlog-cleanup/17-01-SUMMARY.md
