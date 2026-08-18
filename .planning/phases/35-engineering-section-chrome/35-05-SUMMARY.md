---
phase: 35-engineering-section-chrome
plan: 05
subsystem: ui
tags: [nextjs, react-query, i18next, engineering, pm-schedules]

# Dependency graph
requires:
  - phase: 35-engineering-section-chrome
    provides: "35-01 i18n foundation — programs.pmSchedules.* keys confirmed already complete, en.ts/es.ts frozen for the rest of Phase 35"
provides:
  - "pm-schedules/page.tsx flag-gated (engineering) table loading→Skeleton, error→StateBlock, empty→EmptyState, all reusing the pre-existing programs.pmSchedules.* namespace verbatim"
  - "PMCompletionModal.tsx self-reads the engineering flag; its two previously-unhandled overviewData/staffData queries gain isLoading-gated Skeleton placeholders (deliberately no isError)"
affects: [35-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "v2 ternary branching at each render site (not early-return) to keep legacy markup byte-identical when flag is off, matching the established Phase 33/34 pattern"
    - "EmptyState's action prop accepts an arbitrary ReactNode, allowing the desktop empty-row's extra 'example schedules' grid to be preserved inside the action slot rather than dropped"

key-files:
  created: []
  modified:
    - "apps/web/app/(dashboard)/engineering/pm-schedules/page.tsx"
    - "apps/web/components/engineering/PMCompletionModal.tsx"

key-decisions:
  - "No new engineering.pmSchedulesPage.* namespace created — locked CONTEXT decision honored; confirmed via grep across both files (zero matches)"
  - "No programs.pmSchedules.* key renamed, moved, or duplicated — locale files (en.ts/es.ts) were not touched at all in this plan (check:i18n-parity confirmed 1578 keys, unchanged from 35-01's post-close baseline)"
  - "Existing invalidateQueries({ queryKey: ['pm-schedules'] }) retry mechanism reused verbatim inside StateBlock's error.onRetry — no new query, no new queryKey"
  - "PMCompletionModal's overviewData/staffData queries gained isLoading only, not isError — deliberate narrow gap-closing scope per plan; a full error-state treatment for a completion-confirmation modal's supporting data was explicitly out of this phase's boundary"

patterns-established: []

# Metrics
duration: 10min
completed: 2026-08-18
---

# Phase 35 Plan 05: PM Schedules Chrome Summary

**PM Schedules table's loading/error/empty states and PMCompletionModal's two unhandled supporting queries converted to shared Skeleton/StateBlock/EmptyState primitives behind the `engineering` flag, reusing the existing `programs.pmSchedules.*` i18n namespace and retry mechanism verbatim — zero namespace migration.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-08-18T23:19:17Z (approx, per STATE.md last-updated at session start)
- **Completed:** 2026-08-18T23:29:07Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `pm-schedules/page.tsx` reads `isSectionRedesigned('engineering', hotel)` once and threads `dataI18nSkip={v2}` into `PageHeader`
- Table error state (`isError`) now uses `StateBlock status="error"` under `v2`, wired to the existing `t('programs.pmSchedules.failedToLoad')` key and the existing `queryClient.invalidateQueries({ queryKey: ['pm-schedules'] })` retry — legacy raw markup preserved unchanged under `!v2`
- Mobile-card loading placeholders (4x `h-32` divs) converted to `<Skeleton variant="card" className="h-32" />` under `v2`
- Both the mobile-card empty state and the desktop table's separate empty-row block (which additionally renders 3 "example PM schedule" cards) converted to `<EmptyState>` under `v2`, reusing `programs.pmSchedules.noSchedules`/`noSchedulesHelp`/`createSchedule` — the desktop block's extra example-cards grid was preserved inside `EmptyState`'s `action` slot rather than dropped
- `PMCompletionModal.tsx` self-reads the same `engineering` flag; its `overviewData` (drives the checklist-template `<select>`) and `staffData` (drives the verifier `<select>`) queries — previously destructuring only `{ data }` with zero loading/error UI — now also destructure `isLoading`, and each `<select>` is gated behind a `Skeleton className="h-9"` placeholder while `v2 && isLoading`

## Task Commits

Each task was committed atomically:

1. **Task 1: Flag; table loading→Skeleton, error→StateBlock, mobile-empty→EmptyState** - `b85a4972` (feat)
2. **Task 2: PMCompletionModal — flag, v2 skeleton for its 2 unhandled supporting queries** - `a70b14cd` (feat)

**Plan metadata:** committed separately below.

## Files Created/Modified
- `apps/web/app/(dashboard)/engineering/pm-schedules/page.tsx` - Flag-gated Skeleton/StateBlock/EmptyState wiring for table loading/error/empty, PageHeader dataI18nSkip
- `apps/web/components/engineering/PMCompletionModal.tsx` - Flag-gated Skeleton loading placeholders for its two supporting queries (overviewData, staffData)

## Decisions Made
- No new `engineering.pmSchedulesPage.*` namespace was created, and no `programs.pmSchedules.*` key was renamed, moved, or duplicated — confirmed via grep across both modified files (zero matches for `engineering.pmSchedulesPage`) and via `check:i18n-parity` reporting the exact same 1578-key count as 35-01 left it, proving neither locale file was touched by this plan. This holds the CONTEXT-locked decision: `programs.pmSchedules.*` is also used by the Programs section's own already-shipped, Phase-33-verified PM view, and migrating would have risked regressing that unrelated, working usage for zero user-facing benefit.
- The existing `queryClient.invalidateQueries({ queryKey: ['pm-schedules'] })` retry mechanism was reused verbatim inside `StateBlock`'s `error.onRetry` — no new query, no new queryKey, no change to the `isError`/`isLoading` destructuring on the `schedulesData` query itself.
- PMCompletionModal's `overviewData`/`staffData` queries were extended with `isLoading` only, deliberately not `isError` — matching the plan's explicit scope boundary that this modal's supporting-data gap-closing should stay narrow (a minimal loading treatment) rather than expand into a full error-state redesign for a completion-confirmation modal.
- The desktop table's empty-row block is visually distinct from the mobile-card empty state (it additionally renders a 3-card "example PM schedule" grid before the create-schedule button). Rather than dropping that grid to fit a plain `EmptyState`, it was preserved by passing the entire example-grid-plus-button subtree as `EmptyState`'s `action` prop (which accepts an arbitrary `ReactNode`), keeping the same existing `programs.pmSchedules.*` keys throughout.

## Deviations from Plan

None - plan executed exactly as written. Both `must_haves.truths` and `must_haves.artifacts` were satisfied on the first pass; no Rule 1-4 fixes were needed.

## Issues Encountered

One transient parallel-execution collision (not a code defect): `npm run build` initially failed with `Another next build process is already running` because a sibling wave-2 plan's own build was in flight at the same moment (expected — 5 wave-2 plans, including this one, run fully parallel per `35-CONTEXT.md`). Resolved by polling/retrying until the sibling's build released the lock; the eventual build ran clean across all 43 routes with zero errors attributable to this plan's changes. No git-index commingling occurred on either of this plan's 2 task commits — both `git show --stat` checks confirmed exactly one file changed per commit, so the pathspec-restricted `git commit -m "..." -- <path>` pattern (used per this plan's own instructions, informed by Phase 34's precedent) worked cleanly here with no rework needed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `pm-schedules/page.tsx` and `PMCompletionModal.tsx` are both fully flag-gated and ready for 35-07's close-out verification sweep (live browser check with the `engineering` flag flipped on the test hotel, alongside the other wave-2 sibling plans' sections).
- No blockers. `programs.pmSchedules.*` namespace remains single-owner (Programs section's own PM view + this Engineering PM Schedules page), unmigrated, and verified in parity across both locales.

---
*Phase: 35-engineering-section-chrome*
*Completed: 2026-08-18*

## Self-Check: PASSED

- FOUND: `apps/web/app/(dashboard)/engineering/pm-schedules/page.tsx`
- FOUND: `apps/web/components/engineering/PMCompletionModal.tsx`
- FOUND: commit `b85a4972`
- FOUND: commit `a70b14cd`
