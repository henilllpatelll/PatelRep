---
phase: 07-theme-foundation-primitives
plan: 04
subsystem: ui
tags: [react-native, expo, theme, design-system, ionicons]

# Dependency graph
requires:
  - phase: 07-theme-foundation-primitives (plan 01)
    provides: "useTheme()/ThemeProvider reactive theme shell over tokens.ts"
provides:
  - "Card primitive: reusable themed surface (bg/border/radius/shadow) with dimmed variant"
  - "StatusBadge primitive: statusKey -> icon+color+label, covers room-status + work-order priority/SLA families"
affects: [08-floor-role-rollout, 09-remaining-screens-rollout, 10-dark-mode-accessibility-qa]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Presentational primitives keep static layout in StyleSheet.create, pull colors inline from useTheme() at render"
    - "Style merge order locked: base -> variant -> caller style last"
    - "Status coloring always routes through theme.status.*, never an inline hex"

key-files:
  created:
    - apps/mobile/components/ui/Card.tsx
    - apps/mobile/components/ui/StatusBadge.tsx
  modified: []

key-decisions:
  - "StatusBadge's 'low' status has no dedicated status token; used theme.textMuted for fg (nearest themed neutral) instead of inlining the UI-SPEC's ink4 hex, keeping the badge theme-reactive per D-12 (pre-approved deviation, verified correct by gsd-plan-checker)."

patterns-established:
  - "Card: base surface + optional dimmed variant, colors only via useTheme(), never a static token import"
  - "StatusBadge: single statusKey prop drives an icon+bg+fg+border lookup table; no icon-only escape hatch"

requirements-completed: [UI-02, UI-04]

# Metrics
duration: 25min
completed: 2026-07-29
---

# Phase 7 Plan 4: Card and StatusBadge Primitives Summary

**Card surface primitive extracted from RoomQueueCard's shell, and StatusBadge formalizing WorkOrderCard's icon+color+label convention into one 13-key component reading colors via useTheme().status.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-29T01:05:00Z
- **Completed:** 2026-07-29T01:30:00Z
- **Tasks:** 2 completed
- **Files modified:** 2 created

## Accomplishments
- `Card` (`apps/mobile/components/ui/Card.tsx`): pure surface wrapper (children + optional `dimmed`/`style`), extracting `RoomQueueCard`'s ad-hoc shell (`evening.tsx` `styles.card`/`cardDimmed`) into a reusable primitive. Exact values preserved: `borderRadius: 16`, symmetric `padding: 16`, `shadowOpacity: 0.06`/`elevation: 2` base, `theme.surfaceMuted`/`theme.borderSubtle`/`opacity: 0.7` dimmed variant. Colors resolved only via `useTheme()`.
- `StatusBadge` (`apps/mobile/components/ui/StatusBadge.tsx`): single `statusKey` prop covers all 13 states across both room-status (`ready`/`clean`/`dirty`/`occupied`/`pickup`/`outOfOrder`) and work-order priority/SLA (`emergency`/`urgent`/`low`/`onHold`/`overdue`/`inProgress`/`completed`) families (D-10). Always renders icon + label + color together — no icon-only mode (D-11). All colors resolve through `useTheme().status` (D-12); zero inline hex literals.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create the Card primitive** - `a68f19a6` (feat)
2. **Task 2: Create the StatusBadge primitive** - `28a4ba07` (feat)

_No TDD tasks in this plan; both are presentational primitives with typecheck-only verification._

## Files Created/Modified
- `apps/mobile/components/ui/Card.tsx` - Themed surface wrapper (bg/border/radius/shadow) with base + dimmed variants
- `apps/mobile/components/ui/StatusBadge.tsx` - Status-key-driven icon+color+label badge covering both status families

## Decisions Made
- Followed the plan's pre-approved deviation for `StatusBadge`'s `"low"` status: used `theme.textMuted` instead of a nonexistent `ink4` theme key, per the plan's explicit note that this was already verified correct by gsd-plan-checker.
- No other decisions — plan's exact prop shapes, style values, and icon/color mapping table were followed verbatim.

## Deviations from Plan

None - plan executed exactly as written. (The `low`-status `theme.textMuted` choice was already specified as the correct approach in the plan text itself, not an executor-introduced deviation.)

## Issues Encountered
- This worktree's branch was created before the phase 07 plan files existed on `main` (it branched from the pre-Phase-7 milestone-roadmap commit). Merged `main` (fast-forward, `51032585..6a500324`) to pull in the 07-CONTEXT/07-PATTERNS/07-UI-SPEC docs and Plan 01's `ThemeProvider`/`useTheme()` output that this plan depends on. No conflicts.
- This worktree had no `node_modules` at all (git worktrees don't include gitignored directories), which made `npx tsc --noEmit` fail on every import including pre-existing files, not just the new ones. Created Windows directory junctions (`node_modules` and `apps/mobile/node_modules` -> the main checkout's) so `npx tsc --noEmit` could resolve dependencies. These are gitignored, not committed, and were verified to leave `git status` clean.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `Card` and `StatusBadge` are available under `components/ui/` for Phase 8's floor-role screen migrations (My Rooms, Room Board, Work Orders, Tasks, Inspect) to adopt.
- Neither primitive is wired into any existing screen yet — `WorkOrderCard`/`RoomQueueCard` remain unchanged this phase, confirmed by a repo-wide import search finding zero call sites, satisfying ROADMAP SC5 (zero visual change).
- `npx tsc --noEmit` in `apps/mobile` reports 0 errors after these changes (verified against a pre-existing 0-error baseline once `node_modules` was linked).

## Self-Check: PASSED

- FOUND: apps/mobile/components/ui/Card.tsx
- FOUND: apps/mobile/components/ui/StatusBadge.tsx
- FOUND: .planning/phases/07-theme-foundation-primitives/07-04-SUMMARY.md
- FOUND: commit a68f19a6 (Task 1: Card)
- FOUND: commit 28a4ba07 (Task 2: StatusBadge)
- FOUND: commit 54b86a69 (docs: complete plan)

---
*Phase: 07-theme-foundation-primitives*
*Completed: 2026-07-29*
