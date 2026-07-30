---
phase: 08-floor-role-rollout
plan: 07
subsystem: ui
tags: [react-native, expo, mobile, theming, design-system, tasks]

# Dependency graph
requires:
  - phase: 07-theme-foundation-primitives
    provides: useTheme()/ThemeProvider reactive shell, Card/StatusBadge/Button/StateBlock primitives
  - phase: 08-00
    provides: tokens.ts Wave 0 gap-fix keys (textDisabled, accentBrassSoft, accentBrassLine)
provides:
  - TaskCard rebuilt on Card + StatusBadge + Button (urgent/inProgress/overdue StatusKeys, doneBtn kept as a themed icon-only TouchableOpacity)
  - tasks/index.tsx fully on useTheme()/theme.shell.*, loading/empty states on StateBlock
  - Zero legacy C.* token refs in either file (FLOOR-04 complete)
affects: [09-remaining-screens-rollout]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Card shells with no onPress (TaskCard) replace the outer View with <Card> directly — no Pressable wrap needed, unlike WorkOrderCard/RoomQueueCard which are one big TouchableOpacity"
    - "Module-scope color-lookup tables (TYPE_META/BUCKET_RAIL) source from the static lightTheme export, not the reactive useTheme() hook, mirroring WorkOrderCard's CATEGORY_META precedent"
    - "StyleSheet.create holds layout-only styles; all color values move to inline style arrays merged at render time, since useTheme() is only available inside the component body"

key-files:
  created: []
  modified:
    - apps/mobile/components/tasks/TaskCard.tsx
    - apps/mobile/app/(app)/tasks/index.tsx
    - apps/mobile/__tests__/screens/TasksVariationA.test.tsx

key-decisions:
  - "Converted the overdue label (plain Text) into a full StatusBadge(statusKey='overdue') per the plan's explicit instruction, even though WorkOrderCard's analogous overdue indicator stayed plain text — TaskCard's overdue signal is now visually consistent with its urgent/inProgress siblings on the same card"
  - "doneBtn (icon-only circular mark-done control) stays a themed TouchableOpacity, not Button — Button always requires a label and has no icon-only shape; this was a locked decision in the plan's migration_reference, not a new judgment call"

requirements-completed: [FLOOR-04]

# Metrics
duration: 12min
completed: 2026-07-30
---

# Phase 8 Plan 07: Tasks List + TaskCard Migration Summary

**TaskCard rebuilt on Card/StatusBadge/Button and tasks/index.tsx migrated to useTheme()/StateBlock — zero legacy `C.*` token refs remain in either file, data/fetch/action logic unchanged.**

## Performance

- **Duration:** ~12 min (commit-to-commit)
- **Started:** 2026-07-29T22:25:16-05:00 (branch synced to main tip)
- **Completed:** 2026-07-29T22:34:44-05:00 (Task 2 commit)
- **Tasks:** 2/2 completed
- **Files modified:** 3 (2 plan-scoped + 1 test-infra fix)

## Accomplishments
- `TaskCard.tsx` outer shell rebuilt on `Card` (no `Pressable` wrap — the card itself has no `onPress`); priority/in-progress/overdue chips converted to `StatusBadge`; confirm/cancel buttons converted to `Button`; `doneBtn` kept as a themed icon-only `TouchableOpacity` per the plan's locked decision
- `tasks/index.tsx` fully wired to `useTheme()`/`theme.shell.*`; loading and empty states converted to `StateBlock`, reusing existing (untranslated) strings per D-06's i18n-gate-exempt boundary
- Zero `C.*` refs remain in either file (`grep -c "C\."` returns 0 for both)
- `TasksVariationA.test.tsx` updated to wrap render calls in `ThemeProvider` (a new hard dependency introduced by Card/StatusBadge/Button/StateBlock), matching the exact precedent already established in 08-01..08-06's own test updates

## Task Commits

1. **Task 1: Rebuild TaskCard on Card + StatusBadge + Button (D-08)** - `dc00dc38` (feat)
2. **Task 2: Migrate tasks/index.tsx to useTheme + StateBlock** - `79295de7` (feat)

_No plan-metadata commit yet — this commit (SUMMARY.md) follows._

## Files Created/Modified
- `apps/mobile/components/tasks/TaskCard.tsx` - Rebuilt on Card/StatusBadge/Button; TYPE_META/BUCKET_RAIL sourced from static `lightTheme` (module scope, not reactive); doneBtn stays a themed TouchableOpacity
- `apps/mobile/app/(app)/tasks/index.tsx` - `useTheme()` + `theme.shell.*` throughout; loading/empty states on `StateBlock`; fetch/action/composer logic untouched
- `apps/mobile/__tests__/screens/TasksVariationA.test.tsx` - Added `ThemeProvider` wrap around all 3 `render()` call sites (test-infra fix, required by the new primitive dependency, not a plan file)

## Decisions Made
- Overdue indicator converted to a full `StatusBadge` (not left as plain text like `WorkOrderCard`'s analogous overdue text) — the plan's migration_reference explicitly calls this out as a difference from `WorkOrderCard`'s pattern for this specific file.
- `TYPE_META`/`BUCKET_RAIL` kept as static `lightTheme`-sourced module constants rather than moved inside the component with `useTheme()` — mirrors `WorkOrderCard.tsx`'s `CATEGORY_META` precedent (Phase 7/8 established convention for module-scope, non-exported color-lookup tables), consistent even though `TYPE_META` isn't exported elsewhere unlike `CATEGORY_META`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added ThemeProvider wrap to TasksVariationA.test.tsx**
- **Found during:** Task 1 (TaskCard rebuild), first verification run
- **Issue:** `Card`/`StatusBadge`/`Button` all call `useTheme()` → `useThemeMode()`, which throws `"useThemeMode must be used within a ThemeProvider"` if not wrapped. The test file rendered `<TasksScreen />` bare, so introducing these primitives into `TaskCard` (rendered by `TasksScreen`) would break all 3 tests.
- **Fix:** Added `import { ThemeProvider } from "@/lib/theme/ThemeProvider"` and a `renderScreen()` helper wrapping `<TasksScreen />` in `<ThemeProvider>`; replaced all 3 bare `render(<TasksScreen />)` call sites with `renderScreen()`.
- **Files modified:** `apps/mobile/__tests__/screens/TasksVariationA.test.tsx`
- **Verification:** `npx jest __tests__/screens/TasksVariationA.test.tsx` — 3/3 pass
- **Committed in:** `dc00dc38` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary test-infra fix identical in shape to the fix already applied in 07's `HousekeeperHome.test.tsx` and every other Phase 8 plan's test file (WorkOrdersList, RoomBoard, RoomDetail, MyRoomsScreen, WorkOrderDetail, ReportIssueModal). No scope creep — no plan-file logic touched beyond what the tasks required.

## Issues Encountered
- `apps/mobile` had no `node_modules` in this worktree (fresh worktree checkout). Ran `npm install --legacy-peer-deps` per the parallel-execution instructions (not a junction to the main checkout, avoiding the known Windows "Filename too long" failure mode). No lockfile changes resulted (node_modules is gitignored).
- This worktree's branch (`worktree-agent-a868430942f91b2ea`) was created before waves 1-3 (08-00..08-06) were merged to `main` — it was a strict ancestor of `main` with zero local commits. Fast-forward merged to `main` tip (`git merge main --ff-only`) before starting, since the plan (`08-07-PLAN.md`) and its prerequisite context (`08-CONTEXT.md`, `08-RESEARCH.md`) only existed on `main`. This was a safe, non-destructive fast-forward (no divergent local commits existed to lose).

## Next Phase Readiness
- FLOOR-04 (Tasks) is complete: any floor role can view/complete tasks on primitives; data behavior (fetch, confirm/cancel/done actions, AI composer) is unchanged.
- Full mobile jest suite: 25/25 suites, 135/135 tests green (verified post-Task-2, no regressions in adjacent screens).
- `npm run type-check` and `npm run lint` both clean.
- Ready for Wave 4's remaining plan (08-08, Inspect) and Phase 8 close-out; no blockers introduced by this plan.

---
*Phase: 08-floor-role-rollout*
*Completed: 2026-07-30*
