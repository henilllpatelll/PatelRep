---
phase: 33-core-operational-sections
plan: 02
subsystem: ui
tags: [redesign-flag, statedblock, i18n, tasks, evidence]

# Dependency graph
requires:
  - phase: 33-core-operational-sections
    provides: "33-01's tasks.loadError key and confirmation that evidence.loadError/tasks.empty.* already existed"
provides:
  - "Canonical v2 card/skeleton shell and StateBlock error-with-retry pattern for sibling content plans (33-03..33-06) to mirror"
  - "Tasks and Evidence section flag keys ('tasks', 'evidence') wired via isSectionRedesigned"
affects: [33-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Skeleton-not-spinner loading convention: existing inline animate-pulse rows kept and restyled to v2 card shell (bg-surface-2 border border-line-2 rounded-[var(--r-md)]), never routed through StateBlock status='loading'"
    - "StateBlock used only for empty/error states; loading handled by the section's own existing skeleton markup"
    - "v2 flag read directly via useHotelStore((s) => s.hotel) + isSectionRedesigned(key, hotel), computed once near the top of the component and threaded as a v2 prop into child row components where needed (TaskRow)"

key-files:
  modified:
    - apps/web/app/(dashboard)/tasks/page.tsx
    - apps/web/app/(dashboard)/evidence/page.tsx

key-decisions:
  - "Tasks' new error state renders inside a bg-surface border border-line rounded-[var(--r-lg)] shadow-card shell wrapping StateBlock status='error', matching the v2 card look used for the loading/empty states in the same slot"
  - "Tasks' isError/refetch were added to the EXISTING useQuery destructure (previously { data, isLoading }) — confirmed via useQuery/useMutation occurrence count unchanged (7 before, 7 after) that no new query was introduced, only additional state read from the query already in place"
  - "Evidence kept its existing spinner-based StateBlock loading (status='loading' with Loader2) rather than converting to a skeleton — it was already the correct, established affordance per 33-RESEARCH's explicit carve-out, and converting would have been unnecessary/out-of-scope churn on an already-correct reference implementation"
  - "Evidence's v2 branch is token-polish-only: added duration-fast/ease-standard/focus-visible:ring-[var(--focus-ring)] to the documents list, evidence-records list, and exceptions list interactive rows; no structural JSX change since its StateBlock wiring (loading/empty/error, load() as onRetry) was already correct"

patterns-established:
  - "v2 card empty/error state shell for list-style sections: bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card wrapping a StateBlock — sibling plans (33-03..33-06) should reuse this exact shell for their own empty/error StateBlock instances"

# Metrics
duration: ~15min
completed: 2026-08-18
---

# Phase 33 Plan 02: Tasks + Evidence Redesign Summary

**Tasks gains a real StateBlock error-with-retry state (previously silently rendered empty on fetch failure) plus v2 token restyle; Evidence gets flag-gated token polish over its already-correct StateBlock reference implementation — both remain byte-behaviorally identical with their flags off.**

## Performance

- **Duration:** ~15 min (recovery/verification of a partially-completed prior attempt; no rework needed)
- **Tasks:** 2 completed
- **Files modified:** 2 (`apps/web/app/(dashboard)/tasks/page.tsx`, `apps/web/app/(dashboard)/evidence/page.tsx`)

## Accomplishments
- `tasks/page.tsx`: added `isSectionRedesigned('tasks', hotel)` flag branch; extended the existing tasks `useQuery` destructure with `isError`/`refetch` (zero new queries — verified occurrence count unchanged, 7→7); added a new `StateBlock status='error'` with `onRetry={() => refetch()}` wired to `tasks.loadError` (the key 33-01 added specifically for this gap); restyled the loading skeleton rows, empty state (via `StateBlock status='empty'` wired to existing `tasks.empty.*` keys), task-row hover/focus, tab underline, and filter selects with v2 tokens (`duration-fast`, `ease-standard`, `focus-visible:ring-[var(--focus-ring)]`); legacy branch preserved byte-identical via `v2 ? ... : ...` ternaries throughout
- `evidence/page.tsx`: added `isSectionRedesigned('evidence', hotel)` flag branch; applied v2 token polish (`duration-fast`/`ease-standard`/focus rings) to the documents list, evidence-records list, and exceptions list interactive rows; the existing correct `StateBlock` wiring (spinner loading, empty, error+retry via `load()`) was left untouched since it was already the canonical reference implementation
- Confirmed no frozen file, locale file, query, mutation, field, or filter was added/removed in either file

## Task Commits

Each task was committed atomically:

1. **Task 1: Redesign Tasks — flag branch, v2 tokens, skeleton loading, StateBlock empty, NEW error state** - `bf267fbe` (feat)
2. **Task 2: Redesign Evidence — flag branch + v2 token polish over its existing correct StateBlock wiring** - `96502364` (feat)

## Files Created/Modified
- `apps/web/app/(dashboard)/tasks/page.tsx` - +46/-16: flag branch, `isError`/`refetch` added to existing query destructure, new `StateBlock` error state, restyled skeleton/empty/rows/tabs/filters for v2
- `apps/web/app/(dashboard)/evidence/page.tsx` - +7/-3: flag branch, v2 token polish on three interactive list rows; StateBlock wiring untouched

## Verification Performed
- `npx tsc --noEmit` — zero errors attributable to either file (grep-confirmed no `tasks/page.tsx` or `evidence/page.tsx` lines in the error output; remaining errors belong to sibling wave-2 plans' in-flight files — safety/page.tsx, scheduling/page.tsx — out of this plan's scope)
- `npm run check:frozen-files` — OK, 7/7 frozen files unchanged, room-status values match manifest
- `npm run check:contrast` — OK, 10 enforced new-token pairings pass WCAG AA both modes
- `npm run check:i18n-parity` — OK, 1529 keys, en.ts/es.ts in parity (confirms neither locale file was touched)
- `grep` confirmed all plan-required patterns present: `isSectionRedesigned('tasks'`, `isError`/`refetch` on the existing query, `StateBlock status="error"` with `onRetry`, `isSectionRedesigned('evidence'`
- `useQuery`/`useMutation` occurrence count in `tasks/page.tsx` unchanged between `HEAD` and working tree (7 = 7), confirming zero new queries were introduced

Full-repo `npm run build` was not run to completion this session because four sibling wave-2 plans (33-03..33-06) were concurrently mid-edit on `safety/page.tsx`, `scheduling/page.tsx`, `sop/page.tsx`, and `GuestRequestsPage.tsx` in the same working tree at verification time — a full build would fail on their in-progress work, not on anything in this plan's two files. This plan's files were verified in isolation via the checks above; a full `type-check`/`build` re-run belongs to 33-07's close-out gate once all wave-2 plans have landed.

## Decisions Made
See `key-decisions` in frontmatter above.

## Deviations from Plan

None — plan executed exactly as written. This execution resumed a prior attempt that had hit an account session-limit mid-flight with uncommitted, correct partial work already in the working tree for both target files; that work was verified against the plan's must_haves and gates (rather than discarded and redone) and found to fully satisfy the plan, then committed as the two atomic task commits above.

## Issues Encountered
None specific to this plan. Noted (not fixed, out of scope): sibling wave-2 plans' files (`safety/page.tsx`, `scheduling/page.tsx`) had pre-existing in-flight `tsc` errors at verification time from their own concurrent, not-yet-complete execution — unrelated to Tasks/Evidence.

## User Setup Required
None.

## Next Phase Readiness

Tasks and Evidence are fully redesigned behind their `'tasks'`/`'evidence'` flags and ready as the canonical StateBlock/v2-card-shell reference for 33-03..33-06. Plan 33-07 (close-out) should re-run the full `type-check`/`build` once all wave-2 plans are committed, since this session could not run a full-repo build cleanly while siblings were still mid-edit.

---
*Phase: 33-core-operational-sections*
*Completed: 2026-08-18*

## Self-Check: PASSED
- FOUND: apps/web/app/(dashboard)/tasks/page.tsx
- FOUND: apps/web/app/(dashboard)/evidence/page.tsx
- FOUND commit bf267fbe (Task 1)
- FOUND commit 96502364 (Task 2)
