---
phase: 10-dark-mode-accessibility-qa
plan: 03
subsystem: mobile-navigation
tags: [react-native, expo-router, dark-mode, accessibility, navigation, tdd]

requires:
  - phase: 10-01
    provides: Hydrated System/Light/Dark appearance preference and effective mode
  - phase: 10-02
    provides: Contrast-safe content, shell, action, notification, and on-color tokens
provides:
  - Typed React Navigation theme adapter backed by PatelRep semantic tokens
  - Splash-gated first native frame coordinated with auth and appearance hydration
  - Theme-reactive status bar, role tabs, headers, notification badges, and Copilot FAB
  - Static regression contract preserving role routes, hidden routes, listeners, and deep links
affects: [10-04, 10-05, 10-06, 10-09, 10-10, 10-11]

tech-stack:
  added: []
  patterns:
    - Keep PatelRep theme context outside a hydration-gated root chrome consumer
    - Adapt semantic tokens into the native navigator shape instead of passing app tokens directly
    - Resolve all navigator colors at render time while preserving route data sources

key-files:
  created:
    - apps/mobile/lib/theme/navigationTheme.ts
    - apps/mobile/__tests__/lib/theme/navigationTheme.test.ts
    - apps/mobile/__tests__/lib/theme/AppChrome.test.ts
  modified:
    - apps/mobile/app/_layout.tsx
    - apps/mobile/app/(app)/_layout.tsx

key-decisions:
  - "Use the deeper mode-specific shell surface, ink, and line roles for native navigator card chrome."
  - "Use the React Navigation provider already installed by Expo Router because the researched expo-router/react-navigation subpath is absent from Expo Router 6.0.24."
  - "Keep notification chrome on the protected dirty/status-red semantic role while leaving badge behavior unchanged."

duration: 8min
completed: 2026-07-31
---

# Phase 10 Plan 03: Native Navigation Chrome Summary

**Hydrated appearance now controls the first visible navigator frame, native status bar, role tabs, headers, notification chrome, and Copilot FAB from one effective PatelRep theme mode.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-31T06:57:54Z
- **Completed:** 2026-07-31T07:05:41Z
- **Tasks:** 3
- **Implementation/test files modified:** 5

## Accomplishments

- Added a complete typed React Navigation adapter for distinct light/dark semantic snapshots while retaining native platform font defaults.
- Split the root into an outer PatelRep provider and inner chrome consumer, holding both splash dismissal and navigator/status content until appearance hydration settles.
- Wired navigation theme and explicit unanimated status-bar foreground/background to the same effective mode.
- Replaced every frozen `C.*` tab/header/FAB color with live shell, AI, and on-color roles.
- Added translated accessibility labels to generated role tabs and the Copilot FAB without changing role allow-lists, hidden routes, redirects, listeners, badges, or destinations.

## TDD Cycle

### RED

- `navigationTheme.test.ts` failed because the navigation adapter did not exist.
- `AppChrome.test.ts` failed against automatic status-bar styling, auth-only splash dismissal, missing hydration gating, frozen protected-layout colors, and untranslated accessibility labels.

### GREEN

- `navigationTheme.ts` maps native roles from `getThemeTokens(mode)` and `DefaultTheme.fonts`.
- Root chrome does not render before preference hydration and uses one effective mode for navigator/status styling.
- Protected chrome resolves at render time through `useTheme()` and preserves all existing routing data paths.

### REFACTOR

- Kept theme-specific FAB colors outside the static `StyleSheet`.
- Kept the adapter small and dependency-free, with native fonts reused rather than duplicated.

## Task Commits

1. **Task 1 RED: specify the navigation theme adapter** - `4930357e` (test)
2. **Task 1 GREEN: implement the navigation theme adapter** - `27170bbb` (feat)
3. **Task 2 RED: specify first-frame chrome behavior** - `ad1ee512` (test)
4. **Task 2 GREEN: gate root chrome by appearance hydration** - `f026b1d8` (feat)
5. **Task 3 RED: specify protected navigation chrome** - `ca718d7a` (test)
6. **Task 3 GREEN: theme tabs, headers, and Copilot FAB** - `001cb4b1` (feat)

## Files Created/Modified

- `apps/mobile/lib/theme/navigationTheme.ts` - typed semantic-token to React Navigation theme mapping.
- `apps/mobile/app/_layout.tsx` - provider split, hydration-gated splash/content, navigation provider, and explicit status bar.
- `apps/mobile/app/(app)/_layout.tsx` - live themed tabs, headers, badge chrome, and accessible Copilot FAB.
- `apps/mobile/__tests__/lib/theme/navigationTheme.test.ts` - light/dark mapping, native-font, distinct-snapshot, and frozen-token coverage.
- `apps/mobile/__tests__/lib/theme/AppChrome.test.ts` - first-frame, unanimated chrome, role-route preservation, hidden-route, badge/listener, and accessibility-label contracts.

## Decisions Made

- Native navigator `card`, `text`, and `border` use `theme.shell.surface`, `theme.shell.ink`, and `theme.shell.line` so navigation remains a deeper boundary than content in both modes.
- Native `notification` uses `theme.status.dirty`, matching the protected operational red family without changing badge calculation or reset behavior.
- The provider import comes from `@react-navigation/native`, which Expo Router 6.0.24 already installs and exposes. No package or lockfile changed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used the installed React Navigation provider path**

- **Found during:** Task 2
- **Issue:** The research example imported `expo-router/react-navigation`, but that subpath does not exist in installed `expo-router@6.0.24` and fails module resolution.
- **Fix:** Imported and aliased `ThemeProvider` from the already-installed `@react-navigation/native` package used by Expo Router.
- **Files modified:** `apps/mobile/app/_layout.tsx`
- **Verification:** Focused Jest, full TypeScript, lint, and all mobile tests pass without a dependency change.
- **Committed in:** `f026b1d8`

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** The native provider and theme contract are unchanged; only the valid installed export path differs from the research snippet.

## Issues Encountered

- Workspace type-check temporarily reported errors in the parallel 10-05 RED test. After that executor completed GREEN, 10-03 reran the unchanged checkout and type-check passed.
- The full suite retains known non-failing React `act(...)` console warnings and the deliberate offline-sync warning fixture; all 318 tests pass.
- Interactive Android chrome inspection was not possible because neither `adb` nor an Android emulator is installed. Plan 10-10 remains the mandatory real-device/emulator gate.

## Authentication Gates

None.

## User Setup Required

None - no dependency, environment variable, account, or service configuration was added.

## Verification

- `npx jest __tests__/lib/theme/AppChrome.test.ts __tests__/lib/theme/navigationTheme.test.ts __tests__/lib/roleTabs.test.ts --runInBand` - **PASS (3 suites, 15 tests)**
- `npm run type-check` - **PASS**
- `npm run lint` - **PASS**
- `npm test -- --runInBand` - **PASS (37 suites, 318 tests)**
- `rg -n "\\bC\\.|StatusBar style=\"auto\"" apps/mobile/app/_layout.tsx apps/mobile/app/(app)/_layout.tsx` - **PASS (no matches)**
- Owned-file `git diff --check` - **PASS**
- Android runtime tools - **NOT AVAILABLE (`adb=False`, `emulator=False`)**

## Next Phase Readiness

- Profile appearance controls can now switch the effective mode into a navigator shell that updates immediately.
- Later shared-composite/accessibility plans can assume root, tabs, headers, badges, status bar, and FAB consume the semantic theme contract.
- Plan 10-10 must still validate first-frame flash behavior, each role shell, and live theme changes on Android hardware or an emulator.

## Self-Check: PASSED

- All five implementation/test artifacts and this summary exist.
- All six TDD task commits resolve as Git commits.
- Focused, integrated, type, lint, static-audit, and diff checks are green.

---
*Phase: 10-dark-mode-accessibility-qa*
*Completed: 2026-07-31*
