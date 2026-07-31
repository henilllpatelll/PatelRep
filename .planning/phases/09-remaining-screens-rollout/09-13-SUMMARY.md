---
phase: 09-remaining-screens-rollout
plan: 13
subsystem: ui
tags: [react-native, expo, sop, theming, primitives, jest]

requires:
  - phase: 07-theme-foundation-primitives
    provides: Reactive useTheme hook and shared Card, Button, and StateBlock primitives
  - phase: 08-floor-role-rollout
    provides: Pressable-wrapped Card and inline theme-color migration patterns
provides:
  - SOP list and detail screens rendered through useTheme and shared primitives
  - Accessible SOP document navigation with the existing detail route preserved
  - Focused list/detail regression coverage for SOP API and navigation behavior
affects: [SCREENS-07, sop, mobile-theme-rollout, dark-mode-qa]

tech-stack:
  added: []
  patterns:
    - "SOP list rows use an accessible Pressable wrapped around the shared Card primitive."
    - "SOP screen loading, empty, and missing-document states render through StateBlock."

key-files:
  created:
    - apps/mobile/__tests__/screens/SopScreens.test.tsx
    - .planning/phases/09-remaining-screens-rollout/09-13-SUMMARY.md
  modified:
    - apps/mobile/app/(app)/sop/index.tsx
    - apps/mobile/app/(app)/sop/[sopId].tsx

key-decisions:
  - "Kept listDocuments(), getDocument(sopId), refresh behavior, and /(app)/sop/{id} routing unchanged during the presentation-only migration."
  - "Kept the existing inert Ask about this SOP affordance behavior while replacing its legacy HeroButton shell with the shared Button primitive."

patterns-established:
  - "Read-only library list/detail pairs can migrate to useTheme, Card, Pressable, Button, and StateBlock without changing their API effects or route arguments."

duration: 13min
completed: 2026-07-31
---

# Phase 09 Plan 13: SOP Theme and Primitives Summary

**The SOP library and document detail now use reactive theme values and shared mobile primitives while preserving their fetch, refresh, and navigation contracts.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-07-31T01:46:18Z
- **Completed:** 2026-07-31T01:58:53Z
- **Tasks:** 2 completed
- **Files modified:** 4

## Accomplishments

- Removed all legacy `C.*` and `shellTokens` usage from both SOP screens and routed screen-owned colors through `useTheme()`.
- Rebuilt the SOP search surface, category surfaces, and document rows with `Card`; document rows now use accessible `Pressable` wrappers while preserving the existing detail route.
- Replaced hand-rolled loading/empty/missing-document presentation with `StateBlock` and migrated detail content surfaces plus the existing AI affordance to shared primitives.
- Added focused regression coverage proving `listDocuments()`, `getDocument(sopId)`, and `/(app)/sop/{id}` navigation remain intact.

## Task Commits

1. **RED: Add SOP screen migration regressions** - `3a2c419f` (test)
2. **Task 1: Migrate SOP list** - `693e72b4` (refactor)
3. **Task 2: Migrate SOP detail** - `92bd706d` (refactor)

## Files Created/Modified

- `apps/mobile/app/(app)/sop/index.tsx` - Themed SOP list with Card/Pressable rows and StateBlock loading/empty states.
- `apps/mobile/app/(app)/sop/[sopId].tsx` - Themed SOP detail with Card, Button, and StateBlock primitives.
- `apps/mobile/__tests__/screens/SopScreens.test.tsx` - Focused API, route, and accessible-control regressions.
- `.planning/phases/09-remaining-screens-rollout/09-13-SUMMARY.md` - Plan execution record.

## Decisions Made

- Preserved all existing English copy because this plan explicitly prohibited adding new `t()` calls.
- Kept the current no-op behavior of the visible "Ask about this SOP" affordance; the task was presentation-only and did not authorize a new Copilot navigation/data contract.
- Added accessibility roles and labels to tappable SOP surfaces as part of adopting `Pressable`, without changing their routes.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The first focused RED run exposed a Jest mock-hoisting defect in the new test harness. The mock was corrected to assert against the mocked `expo-router` export, after which the test failed and passed for the intended screen behavior.
- The full mobile Jest suite passes but emits pre-existing React `act(...)` warnings from unrelated Work Orders/Icon tests and the intentional warning from the offline-sync failure fixture.
- Local Expo web verification could not start because the project does not install `react-dom@19.1.0` or `react-native-web@^0.21.0`; no Android `adb` target is available. No dependencies were added because this phase has a zero-new-dependency, presentation-only boundary.
- `.planning/STATE.md`, `.planning/ROADMAP.md`, and `.wolf/*` updates were intentionally skipped because the delegated ownership explicitly prohibited those edits.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SCREENS-07 is ready for Phase 10 dark-mode and accessibility QA through reactive `useTheme()` bindings.
- The focused SOP suite can be reused during later navigation and theme regression checks.

## Self-Check: PASSED

- Confirmed both SOP implementation files and the focused regression test exist.
- Confirmed commits `3a2c419f`, `693e72b4`, and `92bd706d` exist in git history.
- Confirmed both SOP files contain `useTheme` and have zero `C.*`, `shellTokens`, and `Alert.alert` references.
- Confirmed the list still calls `listDocuments()`, refresh still delegates to `load()`, rows still route to `/(app)/sop/${doc.id}`, and detail still calls `getDocument(sopId)`.
- Confirmed focused SOP Jest (2/2), full mobile Jest (29 suites / 144 tests), mobile type-check, mobile lint, and `git diff --check` pass.

---
*Phase: 09-remaining-screens-rollout*
*Completed: 2026-07-31*
