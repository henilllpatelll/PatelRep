---
phase: 33-core-operational-sections
plan: 06
subsystem: ui
tags: [i18n, react-i18next, next.js, state-block, redesign-flag]

# Dependency graph
requires:
  - phase: 33-core-operational-sections
    provides: "33-01's scheduling.* locale namespace (pageTitle, pageSubtitle, roster.loadError, roster.empty, assignments.loadError, assignments.empty, staff.empty, shifts.empty, byShiftEmpty), consumed read-only"
provides:
  - "Staff Scheduling (scheduling/page.tsx) flag-branched on isSectionRedesigned('scheduling', hotel)"
  - "Every hidden hardcoded object-literal-prop string (StateBlock error/empty, EmptyState title, PageHeader title/subtitle) converted to scheduling.* t() calls in the v2 branch"
affects: [33-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "v2 boolean computed once at the page root via useHotelStore + isSectionRedesigned, then threaded as an explicit prop into each inline sub-component (TodayRoster/ShiftManagement/WeekCalendar) rather than each sub-component re-deriving it — keeps a single source of truth for the flag across a large multi-component file"

key-files:
  modified:
    - apps/web/app/(dashboard)/scheduling/page.tsx

key-decisions:
  - "Left region headings ('Today's Roster', 'Manage Shifts') and deep create/edit-form field labels untouched — no matching scheduling.* key exists for them (33-01's key list is state/chrome-only), and the plan scoped this plan to StateBlock/EmptyState/PageHeader object-literal-prop strings plus page chrome, not a full-file literal audit"
  - "staff.empty and byShiftEmpty (WeekCalendar's two EmptyState instances) reuse the same isError/onRefetch wiring already driven by assignmentsQuery — matches 33-01's documented decision that WeekCalendar's isError has no staff-specific error source distinct from assignments"

patterns-established: []

# Metrics
duration: ~15min (continuation of a prior session that hit an account session-limit mid-flight)
completed: 2026-08-18
---

# Phase 33 Plan 06: Staff Scheduling Redesign + Hidden i18n Summary

**Staff Scheduling (1388-LOC, multi-query file) flag-branched on `isSectionRedesigned('scheduling', hotel)`, with every hardcoded StateBlock/EmptyState/PageHeader object-literal-prop string converted to `scheduling.*` i18n keys.**

## Performance

- **Duration:** ~15 min this session (continuation — prior attempt hit an account session-limit mid-task, leaving an uncommitted partial edit)
- **Tasks:** 1 completed
- **Files modified:** 1 (`apps/web/app/(dashboard)/scheduling/page.tsx`)

## Accomplishments
- `SchedulingPage` now computes `const v2 = isSectionRedesigned('scheduling', hotel)` once via `useHotelStore`, threaded as an explicit `v2` prop into `TodayRoster`, `ShiftManagement`, and `WeekCalendar`
- Converted every hidden hardcoded object-literal-prop string to a `scheduling.*` key: `PageHeader` `title`/`subtitle` → `scheduling.pageTitle`/`scheduling.pageSubtitle`; roster `StateBlock` `error.message`/`empty.title` → `scheduling.roster.loadError`/`scheduling.roster.empty`; shift-management `EmptyState` `title` → `scheduling.shifts.empty`; week-calendar mobile+desktop error text (both `isError` branches) → `scheduling.assignments.loadError`; week-calendar mobile empty-day text → `scheduling.assignments.empty`; by-staff table `EmptyState` → `scheduling.staff.empty`; by-shift table `EmptyState` → `scheduling.byShiftEmpty`
- Each region's error `onRetry`/error text is wired to that region's own existing query refetch — `rosterQuery.refetch()` (roster), `assignmentsQuery.refetch()`/`staffQuery.refetch()` (week calendar, via the page-level `onRefetch` callback) — no new query added
- Legacy branch (`v2` false) is byte-behaviorally identical to pre-plan code: every converted string falls back to the exact original English literal via a `v2 ? t(...) : '<original literal>'` ternary
- `type-check` (scheduling/page.tsx clean), `check:frozen-files`, `check:contrast`, `check:i18n-parity` all green

## Task Commits

Each task was committed atomically:

1. **Task 1: Flag-branch Scheduling and convert hidden object-literal-prop strings to scheduling.* i18n** - `99957ed9` (feat)

**Plan metadata:** (this commit, docs — created after this summary)

## Files Created/Modified
- `apps/web/app/(dashboard)/scheduling/page.tsx` - Added `isSectionRedesigned('scheduling', hotel)` gate; threaded `v2` prop into `TodayRoster`/`ShiftManagement`/`WeekCalendar`; converted `PageHeader` title/subtitle and all `StateBlock`/`EmptyState` error/empty object-literal-prop strings to `scheduling.*` t() calls with legacy-literal fallback when `v2` is false

## Decisions Made
See `key-decisions` in frontmatter — both were within the plan's own stated discretion (defer non-state/chrome literals; reuse assignments-driven error wiring for the staff/by-shift empty states per 33-01's documented "no distinct staff error source" finding).

## Deviations from Plan

None — plan executed exactly as written.

**Session continuity note:** A prior execution attempt on this same plan ran and hit an account session-limit mid-task, leaving the working tree with an uncommitted, partial edit: `v2` props had been declared on `TodayRoster`/`ShiftManagement`/`WeekCalendar` and all their internal `StateBlock`/`EmptyState` strings converted, but the `v2` prop was never threaded through to the three call sites in `SchedulingPage`, and `PageHeader`'s `title`/`subtitle` were still unconditionally hardcoded English — causing `Property 'v2' is missing` type errors. This session verified the partial edit's already-completed string conversions matched the plan exactly (correct key names, correct legacy fallback, correct refetch wiring), then completed it by (1) threading `v2` into all three call sites and (2) converting `PageHeader`'s `title`/`subtitle` (an explicitly plan-named hit at ~line 159-160) — rather than discarding and redoing the file from scratch, since the existing partial work was correct and finishing it was faster than a full redo. No plan content or scope changed.

## Issues Encountered
`npm run build` currently fails on an unrelated file, `apps/web/app/(dashboard)/safety/page.tsx` (`Property 'redesigned' does not exist on type 'IntrinsicAttributes'`) — confirmed via `git status` that this file is mid-flight, uncommitted work from the parallel sibling plan 33-05, not touched by this plan. `scheduling/page.tsx` itself type-checks clean in isolation (`npx tsc --noEmit` shows zero errors for this file). The full `build` gate should be re-run at 33-07 close-out once all wave-2 plans (33-02..33-06) have landed and committed.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
`scheduling/page.tsx` is done and committed; ready for 33-07's close-out verification once the other wave-2 sibling plans land. The full `npm run build` gate needs a clean re-run at that point (currently blocked only by 33-05's in-flight `safety/page.tsx`, not by this plan).

---
*Phase: 33-core-operational-sections*
*Completed: 2026-08-18*

## Self-Check: PASSED
- FOUND: apps/web/app/(dashboard)/scheduling/page.tsx
- FOUND commit 99957ed9 (Task 1)
