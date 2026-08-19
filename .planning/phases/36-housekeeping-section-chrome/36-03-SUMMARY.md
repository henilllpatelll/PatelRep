---
phase: 36-housekeeping-section-chrome
plan: 03
subsystem: web-ui
tags: [housekeeping, typography, redesign-flag, chrome]

# Dependency graph
requires: ["36-01"]
provides:
  - "AssignmentSidebar.tsx v2-gated 12px-regular stat-tile labels + 20px-semibold stat numerals, self-reading isSectionRedesigned('housekeeping', hotel)"
  - "PredictionPanel.tsx (+ its in-file PredictionRow sub-component) v2-gated 12px consolidation of every fractional-pixel text size, self-reading isSectionRedesigned('housekeeping', hotel)"
affects: [36-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Self-read flag pattern (35-03-PLAN.md precedent) applied to two more chrome components: each top-level exported component reads isSectionRedesigned('housekeeping', hotel) via useHotelStore directly, no prop threaded in from housekeeping/page.tsx (36-02's file) — keeps the two parallel plans fully decoupled."
    - "In-file prop hop: PredictionPanel.tsx's module-private PredictionRow sub-component receives v2 as a prop from its one call site inside the same file, rather than self-reading the flag a second time — avoids a redundant useHotelStore subscription per row."

key-files:
  created: []
  modified:
    - apps/web/components/housekeeping/AssignmentSidebar.tsx
    - apps/web/components/housekeeping/PredictionPanel.tsx

key-decisions:
  - "AssignmentSidebar stat-tile numerals: kept font-mono (not switched to font-display) at the new text-xl (20px) semibold size under v2, since these are count numerals analogous to my-rooms stat numerals — font-mono preserves numeral legibility/tabular alignment better than font-display for this glanceable count use, while still landing on the UI-SPEC's declared 20px/semibold stat-numeral role. !v2 keeps text-lg (18px) exactly as before."
  - "PredictionPanel's SkeletonRow (lines 49-66) was deliberately left as its own bespoke component, unconditional on v2, per the plan's explicit discretion note — it is already token-based (bg-surface-3/animate-pulse) and its internal multi-line label/pill/timestamp placeholder structure isn't replicated by the shared Skeleton primitive without losing shape fidelity. Not forced into Skeleton; not gated on v2."
  - "PredictionPanel's noRisks empty-state message (line 543, font-display italic text-[14px]) left untouched — already at the UI-SPEC's declared 14px, and not a 'heading' role requiring a weight change; this is the intentional 'all clear' render, distinct from the isLoading-driven SkeletonRow path above it, and out of scope per 36-CONTEXT.md's 'restyle, don't rewrite' framing."
  - "Confirmed by direct diff review (git diff filtered to non-className/non-flag-read lines) that PredictionPanel.tsx's only non-className/non-import change is the single 'v2,' prop-destructure line added to PredictionRow — zero business-logic line touched."

patterns-established: []

# Metrics
duration: 8min
completed: 2026-08-19
---

# Phase 36 Plan 03: Housekeeping Assignment Sidebar + Prediction Panel Chrome Summary

**Flag-gated both `AssignmentSidebar.tsx` and `PredictionPanel.tsx` onto the v2 typography scale — consolidating every `text-[11px]`/`text-[11.5px]`/`text-[10.5px]` fractional-pixel instance to `text-xs` (12px) and dropping `font-medium` to regular, all behind a self-read `isSectionRedesigned('housekeeping', hotel)` check, with zero change to any AI-assign/reassign/escalate/acknowledge/batch action flow in either flag state.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-08-19T02:05:00Z
- **Completed:** 2026-08-19T02:13:00Z
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments

### Task 1 — AssignmentSidebar.tsx
- Added `useHotelStore`/`isSectionRedesigned` imports; component now self-reads `const hotel = useHotelStore((s) => s.hotel)` and `const v2 = isSectionRedesigned('housekeeping', hotel)`.
- Stat-tile labels ("Unassigned"/"Needs work", lines 68/72 pre-plan): `v2 ? 'text-xs text-ink3' : 'text-[11px] font-medium text-ink3'` — 12px regular under v2, exact pre-plan fractional-size + font-medium preserved under !v2.
- Stat-tile numerals (lines 69/73 pre-plan): `v2 ? 'mt-1 font-mono text-xl font-semibold text-ink' : 'mt-1 font-mono text-lg font-semibold text-ink'` — 20px semibold under v2 (matching the my-rooms stat-numeral role), 18px under !v2 exactly as before.
- Confirmed no hardcoded non-token colors exist anywhere in the file; the `bg-[var(--ai-soft)]`/`text-[var(--ai)]` AI-attribution icon treatment (header) is already token-based and correct per the Color table — left as-is in both flag states.
- `handleAiAutoAssign` (API call, toast success/info/error calls) byte-unchanged.

### Task 2 — PredictionPanel.tsx
- Top-level `PredictionPanel` component self-reads the flag the same way; threads `v2` as a prop into its module-private `PredictionRow` sub-component at its one call site (inside the `atRiskRooms.map(...)`).
- Every fractional-pixel instance converted to a `v2 ? 'text-xs ...' : '<exact pre-plan value>'` ternary:
  - ETA text (`text-[11px] font-mono text-ink-3`) → `text-xs font-mono text-ink-3`
  - Risk-factor pills (`text-[10.5px] bg-surface-3 text-ink-2 border border-line`) → `text-xs bg-surface-3 text-ink-2 border border-line`
  - Confidence score (`text-[11px] font-mono text-[var(--ai)] ... font-semibold`) → `text-xs font-mono text-[var(--ai)] ... font-semibold` (semibold kept — row's emphasis point)
  - 3 single-room confirm banners (`text-[11.5px] text-ink2 font-medium flex-1`) → `text-xs text-ink2 flex-1` (font-medium dropped)
  - `resultNote` (`text-[11.5px] text-ink3`) → `text-xs text-ink3`
  - "All clear" indicator (`text-[11px] font-mono text-[var(--ai)] opacity-70`) → `text-xs font-mono text-[var(--ai)] opacity-70`
  - selectAll/deselectAll link (`text-[11.5px] text-ink3 hover:text-ink2 underline underline-offset-2`) → `text-xs ...` (same suffix)
  - 2 batch confirm banners (`text-[11.5px] text-ink2 font-medium flex-1`) → `text-xs text-ink2 flex-1`
  - Batch result summary (`text-[11.5px] font-semibold text-ink2`) → `text-xs font-semibold text-ink2` (semibold kept — section label)
  - Batch result list items (`text-[11px] text-ink3 font-mono`) → `text-xs text-ink3 font-mono`
  - Selected-count span (already 12px, `text-[12px] font-semibold text-ink`) and `noRisks` empty message (already 14px) left untouched — no `v2` branch needed, both already compliant.
- `SkeletonRow` left unconditional on `v2`, kept as its own bespoke-but-token-based component (see key-decisions).
- Zero change to `runAction`, `handleActionComplete`, `toggleSelected`, `handleSelectAllToggle`, `confirmBatchAction`, both `useMutation` definitions, or any `mode`/`batchMode` transition — confirmed via a filtered `git diff` showing only className/import/flag-read/prop-hop lines changed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Flag-gate + restyle AssignmentSidebar.tsx** - `97b2911d` (feat)
2. **Task 2: Flag-gate + restyle PredictionPanel.tsx** - `1a3ee5d6` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `apps/web/components/housekeeping/AssignmentSidebar.tsx` - Self-reads `housekeeping` flag; v2-gated 12px-regular stat labels + 20px-semibold stat numerals; !v2 byte-identical to pre-plan
- `apps/web/components/housekeeping/PredictionPanel.tsx` - Self-reads `housekeeping` flag (threaded into `PredictionRow` as a prop); v2-gated 12px consolidation of all fractional-pixel text + font-medium drop; !v2 byte-identical to pre-plan

## Decisions Made
- AssignmentSidebar stat numerals keep `font-mono` at the new 20px/semibold size rather than switching to `font-display` (legibility for glanceable counts).
- PredictionPanel's `SkeletonRow` intentionally stays a bespoke, unconditional (non-`v2`-gated) component — already token-based, structurally necessary given its multi-line placeholder shape.
- PredictionPanel's `noRisks` empty message left untouched — already at the declared 14px scale, not a heading role.

## Deviations from Plan

None — plan executed exactly as written. Line-number references in the plan (~150, 159, 165, 207, 220, 233, 245, 385, 416, 449, 476, 506, 523) matched the actual pre-plan file within a few lines (actual: 150, 159, 165, 207, 220, 233, 245, 385, 416, 449, 476, 506, 523 — effectively identical to the plan's estimates once the file was re-read fresh at execution time).

## Issues Encountered

A full-project `npm run type-check` transiently reported an error in `apps/web/app/(dashboard)/housekeeping/page.tsx` (a `v2` prop missing on a `PageHeader`/`HousekeeperBar`-adjacent usage) while the parallel 36-02 agent was mid-edit on that file. This was confirmed unrelated to this plan's two files (error line number shifted between two consecutive check runs, and neither `AssignmentSidebar.tsx` nor `PredictionPanel.tsx` appeared in the error). A final type-check run after 36-02 completed came back fully green with no errors anywhere in the project.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Cross-plan decoupling from 36-02 held: neither file this plan touched overlaps with `housekeeping/page.tsx`, and both self-read the flag independently (no prop dependency in either direction).
- 36-04 (if it exists / whatever consumes this wave) can proceed — `AssignmentSidebar.tsx` and `PredictionPanel.tsx` are now on the v2 typography scale, flag-gated, with zero business-logic drift.
- No blockers or concerns carried forward.

---
*Phase: 36-housekeeping-section-chrome*
*Completed: 2026-08-19*

## Self-Check: PASSED

- FOUND: apps/web/components/housekeeping/AssignmentSidebar.tsx
- FOUND: apps/web/components/housekeeping/PredictionPanel.tsx
- FOUND: .planning/phases/36-housekeeping-section-chrome/36-03-SUMMARY.md
- FOUND: 97b2911d (Task 1 commit)
- FOUND: 1a3ee5d6 (Task 2 commit)
