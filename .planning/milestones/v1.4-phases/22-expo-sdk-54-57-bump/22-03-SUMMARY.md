---
phase: 22-expo-sdk-54-57-bump
plan: 03
subsystem: mobile
tags: [expo, sdk-56, expo-router, react-native, eas, android, jest]

# Dependency graph
requires:
  - phase: 22-expo-sdk-54-57-bump
    provides: "SDK 55 green rollback boundary from Plan 02"
provides:
  - "Expo SDK 56.0.18 / React Native 0.85.3 / React 19.2.3 / expo-router 56.2.17 dependency graph"
  - "SDK 56 Expo Router navigation-fork imports produced by the official codemod"
  - "Green Android preview build 20c05179-893a-4a2b-83b7-8d8ea0c1edbd and isolated hop rollback commit fdcdc72a"
affects: [22-04, 22-05, mobile-builds]

# Tech tracking
tech-stack:
  added:
    - "@react-native/jest-preset 0.85.3"
  upgraded:
    - "expo 55.0.28 -> 56.0.18"
    - "react-native 0.83.10 -> 0.85.3"
    - "react 19.2.0 -> 19.2.3"
    - "expo-router 55.0.17 -> 56.2.17"
    - "typescript 5.x -> 6.0.3"
  patterns:
    - "SDK 56 Expo Router navigation types/providers come from expo-router/react-navigation, not direct @react-navigation packages"

key-files:
  created: []
  modified:
    - apps/mobile/package.json
    - apps/mobile/package-lock.json
    - apps/mobile/app.json
    - apps/mobile/app/_layout.tsx
    - apps/mobile/lib/theme/navigationTheme.ts
    - apps/mobile/__tests__/lib/theme/navigationTheme.test.ts
    - apps/mobile/tsconfig.json
    - apps/mobile/jest.config.js
    - apps/mobile/app/(app)/room-status/index.tsx

key-decisions:
  - "Used the plan-authorized codemod-only fallback because Expo Doctor 1.20.1 explicitly rejects direct @react-navigation packages alongside SDK 56 expo-router."
  - "Moved splash configuration into the expo-splash-screen plugin because SDK 56 rejects the legacy top-level splash key."
  - "Capped Jest at two workers to avoid SDK 56 test-process contention while preserving the full 412-test suite."

patterns-established:
  - "Treat Expo Doctor as authoritative when a roadmap dependency premise conflicts with the installed SDK's router contract; record the literal requirement gap rather than forcing an invalid graph."

# Metrics
duration: 213min
completed: 2026-08-05
---

# Phase 22 Plan 03: Expo SDK 56 Hop Summary

**Upgraded the mobile app to Expo 56.0.18 / React Native 0.85.3, migrated navigation imports to Expo Router's SDK 56 fork, passed all local gates, and produced a finished EAS Android preview build before committing rollback boundary `fdcdc72a`.**

## Performance

- **Duration:** 213 min (including about 180 min in the EAS worker queue)
- **Started:** 2026-08-05T14:55:48Z
- **Completed:** 2026-08-05T18:28:17Z
- **Tasks:** 3 completed
- **Files modified:** 9

## Accomplishments

- Resolved Expo **56.0.18**, React Native **0.85.3**, React **19.2.3**, expo-router **56.2.17**, and TypeScript **6.0.3**.
- Ran the official `sdk-56-expo-router-react-navigation-replace` codemod across 145 source files; it changed the two application navigation import sites and their focused test to `expo-router/react-navigation`.
- Confirmed no application, component, library, or test imports remain from `@react-navigation/*` and preserved the Hermes/Supabase `dynamic-import-node` Babel guard.
- Reconciled SDK 56 splash config, Jest preset peer, TypeScript 6 config, and React Native 0.85 style typing.
- Passed Expo Doctor **21/21**, `tsc --noEmit`, Jest **45/45 suites and 412/412 tests**, and the focused navigation-theme test **4/4**.
- EAS Android preview build **20c05179-893a-4a2b-83b7-8d8ea0c1edbd** finished green and produced [the preview APK](https://expo.dev/artifacts/eas/BLQvF-oDfvYMhm3MH2i7Sh57QAd9glSUfccnS9Xf7T0.apk).

## Task Commits

The plan requires the complete hop to remain uncommitted until the single EAS build is green, so all three tasks landed together:

1. **Tasks 1-3: Expo SDK 56 dependency/codemod reconciliation plus finished Android gate** - `fdcdc72a` (feat)

_Plan metadata is committed separately after this summary and state update._

## Files Created/Modified

- `apps/mobile/package.json` / `package-lock.json` - SDK 56 dependency graph and aligned test/tooling peers.
- `apps/mobile/app.json` - moved splash configuration under the SDK 56 splash-screen plugin.
- `apps/mobile/app/_layout.tsx` - imports the navigation provider from Expo Router's fork.
- `apps/mobile/lib/theme/navigationTheme.ts` - imports navigation theme types/defaults from the fork.
- `apps/mobile/__tests__/lib/theme/navigationTheme.test.ts` - keeps the focused theme contract on the forked API.
- `apps/mobile/tsconfig.json` - removes deprecated TypeScript 6 `baseUrl` and declares Jest/Node types.
- `apps/mobile/jest.config.js` - caps workers at two to avoid SDK 56 process contention.
- `apps/mobile/app/(app)/room-status/index.tsx` - replaces removed `StyleSheet.absoluteFillObject` typing with equivalent explicit edges.

## Decisions Made

- **Navigation dependency fallback:** a temporary exact `@react-navigation/native@7.3.14` pin resolved as one root version, but the latest Expo Doctor then failed its SDK 56 compatibility check and explicitly required removing all `@react-navigation` packages. The pin was removed and the plan's codemod-only fallback was used. This leaves MOBILE-03's literal direct-dependency wording unsatisfied at SDK 56 while keeping the SDK's authoritative health gate green.
- **Jest worker cap:** six async screen tests timed out only under the default parallel worker count and all passed together in-band; `maxWorkers: 2` restores reliable full-suite execution without weakening coverage.
- **One rollback commit:** source, config, lockfile, tests, and build evidence were held until the sole remote build reached `FINISHED`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used the plan-authorized codemod-only navigation fallback**
- **Found during:** Task 1 dependency reconciliation
- **Issue:** Expo Router 56 no longer depends on React Navigation, and Expo Doctor rejects a direct `@react-navigation/native` install alongside SDK 56.
- **Fix:** Removed the temporary exact pin and kept all navigation imports on `expo-router/react-navigation`.
- **Verification:** Expo Doctor 21/21; dependency tree contains no `@react-navigation/native`; focused theme tests 4/4.

**2. [Rule 3 - Blocking] Reconciled SDK 56 config and tooling contracts**
- **Found during:** Task 1 local gates
- **Issue:** legacy splash config, missing Jest preset peer, TypeScript 6 `baseUrl`, and React Native 0.85 `StyleSheet.absoluteFillObject` typing blocked doctor, test, or type gates.
- **Fix:** moved splash config, installed the matching preset, updated tsconfig, and used equivalent explicit absolute positioning.
- **Verification:** Doctor, TypeScript, and all 412 Jest tests passed.

**3. [Rule 1 - Bug] Stabilized the full Jest suite under SDK 56**
- **Found during:** Task 2 Jest gate
- **Issue:** default parallelism caused six unrelated async screen tests to exceed five seconds; the same tests passed 30/30 in-band.
- **Fix:** set `maxWorkers: 2` in the existing Jest config.
- **Verification:** plain `npx jest` passed 45/45 suites and 412/412 tests twice, including the final post-EAS run.

---

**Total deviations:** 3 auto-fixed (2 blocking compatibility issues, 1 test-runner stability bug). No user-facing scope expansion.

## Issues Encountered

- npm 10.x repeatedly hit Windows `UNKNOWN -4094 open package-lock.json`; `npx npm@11.5.1 install` wrote the lockfile successfully before `expo install --fix` completed.
- The sole EAS build waited about three hours in queue. The attached local command timed out just before the build started, but the remote build remained active; build-ID-specific read-only polling continued to `FINISHED` without resubmission.
- The full Jest suite still emits pre-existing async `act(...)`, i18next initialization, and open-handle warnings, but exits 0 with all 412 tests passing.

## User Setup Required

None.

## Next Phase Readiness

- SDK 56 is committed at green rollback boundary `fdcdc72a`.
- Local doctor, typecheck, Jest, focused navigation-theme, dependency-tree, and EAS Android preview gates are green.
- Plan 22-04 may begin the SDK 56 -> 57.0.9 hop; it was intentionally not started here.
- MOBILE-03's direct-dependency wording must be reconciled with Expo Router 56+'s explicit incompatibility before Phase 22 is declared complete.

---
*Phase: 22-expo-sdk-54-57-bump*
*Completed: 2026-08-05*

## Self-Check: PASSED

- FOUND: `.planning/phases/22-expo-sdk-54-57-bump/22-03-SUMMARY.md`
- FOUND: commit `fdcdc72a`
