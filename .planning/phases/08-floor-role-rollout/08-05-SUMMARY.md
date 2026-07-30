---
phase: 08-floor-role-rollout
plan: 05
subsystem: mobile-ui
tags: [react-native, expo, theme-migration, work-orders, useTheme, StatusBadge, Toast]

# Dependency graph
requires:
  - phase: 08-floor-role-rollout
    provides: "08-00's Wave 0 theme token additions (textDisabled, accentBrassSoft/Line) that this plan's C.* -> theme.* migration depends on"
provides:
  - "Work Orders list (work-orders/index.tsx) fully migrated to Phase 7 primitives - zero legacy C.* refs"
  - "WorkOrderCard rebuilt on Card+Pressable+StatusBadge+Button (D-08 reference implementation)"
  - "CreateWorkOrderModal migrated to primitives with both Alert.alert calls converted to Toast"
affects: ["08-06 (work-orders/[woId].tsx - shares CATEGORY_META import from WorkOrderCard.tsx)", "phase-9 (room-status/index.tsx will find CreateWorkOrderModal already migrated, per D-10)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level lookup tables (CATEGORY_META) consumed by files outside a plan's scope stay sourced from the static lightTheme export, not the useTheme() hook, to avoid breaking external static imports"
    - "Per-item color lookups (PRIORITIES list) keep only key/label in the array; color resolves via a small theme-aware helper function called at render time - mirrors ReportIssueModal's established if/else pattern"
    - "Card has no onPress - Pressable wraps Card, layout overrides (asymmetric padding/gap) go in the caller's style array, Card owns bg/border/shadow"

key-files:
  created: []
  modified:
    - apps/mobile/components/engineering/WorkOrderCard.tsx
    - "apps/mobile/app/(app)/work-orders/index.tsx"
    - apps/mobile/components/engineering/CreateWorkOrderModal.tsx
    - apps/mobile/__tests__/screens/WorkOrdersList.test.tsx

key-decisions:
  - "CATEGORY_META stays a static exported object sourced from lightTheme (not useTheme()) because work-orders/[woId].tsx and EngineerHome.tsx - both out of this plan's scope - import it as a plain object with no ThemeProvider access"
  - "Test harness gap fixed twice (ThemeProvider then ToastProvider) as each of Task 1's and Task 3's useTheme()/useToast() wiring surfaced a missing provider ancestor in WorkOrdersList.test.tsx - same regression class Phase 7 fixed for HousekeeperHome.test.tsx"

patterns-established:
  - "D-08 WorkOrderCard rebuild pattern (Pressable-wraps-Card, StatusBadge chips, Button claim action) is the reference other card rebuilds (TaskCard, RoomQueueCard) should mirror"

requirements-completed: [FLOOR-03]

# Metrics
duration: ~40min
completed: 2026-07-30
---

# Phase 8 Plan 05: Work Orders List Migration Summary

**Work Orders list, WorkOrderCard, and CreateWorkOrderModal migrated from the legacy `C` token constant to `useTheme()` + Phase 7 primitives (Card/StatusBadge/Button/StateBlock/Toast) - zero behavior change to fetch, search/filter, RBAC, or offline claim logic.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-07-30
- **Tasks:** 3/3 completed
- **Files modified:** 4 (3 plan-scoped + 1 test-harness fix)

## Accomplishments
- `WorkOrderCard.tsx` rebuilt on `Card` + `Pressable` + `StatusBadge` + `Button` (D-08) - the phase's reference card-rebuild implementation
- `work-orders/index.tsx` (474 lines, 29 `C.*` refs) fully migrated: hero, search bar, section labels, done-toggle, and all 3 loading/empty states now theme-reactive
- `CreateWorkOrderModal.tsx` (318 lines, 31 `C.*` refs, 2 `Alert.alert` calls) migrated to primitives; both alerts converted to `Toast` per the locked fire-together pattern

## Task Commits

Each task was committed atomically:

1. **Task 1: Rebuild WorkOrderCard on Card+Pressable+StatusBadge+Button (D-08)** - `9779be98` (feat)
2. **Task 2: Migrate work-orders/index.tsx (search/filter/list)** - `47913f02` (feat)
3. **Task 3: Migrate CreateWorkOrderModal (2 alerts -> Toast)** - `f02b89c0` (feat)

_Note: Tasks 1 and 3 each include a same-commit test-harness fix (ThemeProvider, then ToastProvider) required to keep `WorkOrdersList.test.tsx` green - see Deviations below._

## Files Created/Modified
- `apps/mobile/components/engineering/WorkOrderCard.tsx` - Rebuilt shell (Pressable+Card), chips/done-badge as StatusBadge, claim action as Button; CATEGORY_META now sourced from `lightTheme` instead of `C`
- `apps/mobile/app/(app)/work-orders/index.tsx` - All 29 `C.*`/`shellTokens` refs replaced with `theme.*`; loading + 3 empty states now render via `StateBlock`
- `apps/mobile/components/engineering/CreateWorkOrderModal.tsx` - All 31 `C.*` refs replaced with `theme.*`; submit/cancel buttons now `<Button>`; both `Alert.alert` calls converted to `Toast`
- `apps/mobile/__tests__/screens/WorkOrdersList.test.tsx` - Wrapped `render()` calls in `ThemeProvider` + `ToastProvider` (test-only, no assertion changes)

## Decisions Made
- **CATEGORY_META sourcing:** kept as a plain static export (not a `useTheme()`-dependent function) sourced from the already-existing static `lightTheme` object, because two files outside this plan's scope (`work-orders/[woId].tsx`, in-progress under parallel plan 08-06, and `EngineerHome.tsx`) import and index it directly with no `ThemeProvider` in their call chain. Converting it to a hook-based function would have broken both. Since the app is pinned to `lightTheme` only this milestone (Phase 10 unlocks dark mode), the produced colors are pixel-identical to the previous `C.*`-sourced values - this is a zero-visual-change, scope-safe substitution, not a design change.
- **PRIORITIES color resolution:** dropped the inline `color` field from the `PRIORITIES` array (previously baked in with `C.alert`/`C.accent`/`C.ink3`) and replaced it with a small `priorityColor(key)` helper called at render time, mirroring the exact pattern `ReportIssueModal.tsx` (08-03) already established for the same problem (per-item color driven by theme, not a static list).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] WorkOrdersList.test.tsx missing ThemeProvider ancestor**
- **Found during:** Task 1 (WorkOrderCard rebuild) verification
- **Issue:** `WorkOrderCard`'s new `useTheme()` call throws (`useThemeMode must be used within a ThemeProvider`) when rendered without a `ThemeProvider` ancestor. The test rendered `<WorkOrdersScreen />` directly, so all 4 tests failed with "Unable to find node on an unmounted component." Same regression class Phase 7 fixed for `HousekeeperHome.test.tsx` (commit `f60f4d57`).
- **Fix:** Added a `renderScreen()` helper wrapping `<WorkOrdersScreen />` in `<ThemeProvider>`, matching the established pattern in `RoomBoard.test.tsx`/`RoomDetail.test.tsx`.
- **Files modified:** `apps/mobile/__tests__/screens/WorkOrdersList.test.tsx`
- **Verification:** All 4 tests pass.
- **Committed in:** `9779be98` (Task 1 commit)

**2. [Rule 1 - Bug] WorkOrdersList.test.tsx missing ToastProvider ancestor**
- **Found during:** Task 3 (CreateWorkOrderModal migration) - discovered via full-suite `jest` run, not the plan's per-task verify command (which only targets `WorkOrdersList.test.tsx`, `type-check`, `lint` for Task 3 - none of which render the WO list screen)
- **Issue:** `CreateWorkOrderModal` is rendered unconditionally inside `work-orders/index.tsx` (controlled by a `visible` prop, but the component tree - and its `useToast()` call - mounts regardless). Adding `useToast()` in Task 3 broke `WorkOrdersList.test.tsx` (`useToastActions must be used within a ToastProvider`), even though that test file doesn't touch the modal directly.
- **Fix:** Extended the same `renderScreen()` helper to also wrap in `<ToastProvider>`, matching `RoomDetail.test.tsx`'s established double-provider pattern.
- **Files modified:** `apps/mobile/__tests__/screens/WorkOrdersList.test.tsx` (same file as fix 1, folded into Task 3's commit)
- **Verification:** Full `jest --runInBand` suite: 135/135 tests, 25/25 suites green.
- **Committed in:** `f02b89c0` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - test-harness bugs directly caused by this plan's own `useTheme()`/`useToast()` wiring)
**Impact on plan:** Both fixes were required to keep the plan's own mandated test green; no scope creep, no production code affected by either fix.

## Issues Encountered

- **Worktree branch was stale relative to `main` by ~28 commits** (created before the phase 08 plan files and 08-00..08-04 work were merged), so `.planning/phases/08-floor-role-rollout/08-05-PLAN.md` and all sibling docs didn't exist at the start of this session. Resolved with a safe fast-forward merge (`git merge main --ff-only`) since the worktree branch was a pure ancestor of `main` with no divergent commits - non-destructive, no rewind, no lost work.
- `08-PATTERNS.md` (referenced by the plan's `<context>` block) was an uncommitted file in the main repo working tree, not present in this worktree even after the fast-forward. Read directly via its absolute path in the main checkout (`C:\Users\Henil\projects\PatelRep\.planning\phases\08-floor-role-rollout\08-PATTERNS.md`) since the Read tool can access any path on disk; its content (the `C.*` -> `theme.*` migration map, WorkOrderCard/CreateWorkOrderModal-specific guidance) was applied directly without needing to commit a copy into this plan's scope.
- `apps/mobile/node_modules` was absent in this worktree; installed via `npm install --legacy-peer-deps` per the parallel-execution setup note. No lockfile drift (node_modules is gitignored).
- Two full-suite `jest` failures on the first combined run were pre-existing flakes unrelated to this plan: `ProfileHandoff.test.tsx` timing out under parallel worker load (passes cleanly in isolation and in the final `--runInBand` run) - confirmed not caused by these changes and left untouched.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- FLOOR-03 (list half) satisfied: engineer views/creates work orders on primitives; `WorkOrderCard` is the D-08 reference rebuild other cards (`TaskCard`, `RoomQueueCard`) should mirror.
- `CreateWorkOrderModal` is shared with `room-status/index.tsx` (Phase 9, SCREENS-04, D-10) - Phase 9 will find it already primitive-based when it migrates Room Status.
- 08-06 (parallel plan, `work-orders/[woId].tsx`) imports `CATEGORY_META` from `WorkOrderCard.tsx` - unaffected, the export's shape (plain object, same keys/values) is unchanged, only its internal color sourcing moved from `C` to `lightTheme`.
- No blockers for FLOOR-03's detail half (08-06) or any other Phase 8 plan.

---
*Phase: 08-floor-role-rollout*
*Completed: 2026-07-30*

## Self-Check: PASSED

- FOUND: `apps/mobile/components/engineering/WorkOrderCard.tsx`
- FOUND: `apps/mobile/app/(app)/work-orders/index.tsx`
- FOUND: `apps/mobile/components/engineering/CreateWorkOrderModal.tsx`
- FOUND: `.planning/phases/08-floor-role-rollout/08-05-SUMMARY.md`
- FOUND commit: `9779be98` (Task 1)
- FOUND commit: `47913f02` (Task 2)
- FOUND commit: `f02b89c0` (Task 3)
- FOUND commit: `4d101378` (docs: summary)
