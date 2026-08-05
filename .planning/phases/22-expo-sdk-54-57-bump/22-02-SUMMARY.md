---
phase: 22-expo-sdk-54-57-bump
plan: 02
subsystem: mobile
tags: [expo, sdk-55, react-native, new-architecture, eas, android, jest]

# Dependency graph
requires:
  - phase: 22-expo-sdk-54-57-bump
    provides: "Plan 01 green Jest baseline and CNG/New-Architecture reconciliation"
provides:
  - "Expo SDK 55.0.28 / React Native 0.83.10 / React 19.2.0 dependency graph"
  - "SDK-55-valid mandatory New Architecture config with obsolete newArchEnabled fields removed"
  - "Green Android preview build 10c95e4d-6cac-4a7e-b677-d0fa5a8b5418 and isolated hop rollback commit 11e4b41a"
affects: [22-03, 22-04, mobile-builds]

# Tech tracking
tech-stack:
  added: []
  upgraded:
    - "expo 54 -> 55.0.28"
    - "react-native 0.81.5 -> 0.83.10"
    - "react 19.1.0 -> 19.2.0"
    - "expo-router 6.0.24 -> 55.0.17"
  patterns:
    - "Each Expo major hop must pass expo-doctor, TypeScript, Jest, and a finished EAS Android build before its rollback commit"

key-files:
  created: []
  modified:
    - apps/mobile/package.json
    - apps/mobile/package-lock.json
    - apps/mobile/app.json
    - apps/mobile/app/_layout.tsx
    - apps/mobile/lib/theme/appearance.ts
    - apps/mobile/__tests__/lib/theme/appearance.test.ts
    - apps/mobile/__tests__/lib/theme/AppChrome.test.ts

key-decisions:
  - "Removed ios/android newArchEnabled because SDK 55 makes New Architecture mandatory and rejects those platform fields."
  - "Removed the deprecated StatusBar backgroundColor prop and locked its absence with a focused source-contract test."
  - "Aligned react-test-renderer to React 19.2.0 and @testing-library/react-native to expo-router 55's >=13.2.0 peer contract."

patterns-established:
  - "After expo install --fix, independently audit SDK config/deprecations and test-only React peers; the installer does not necessarily reconcile them."

# Metrics
duration: 128min
completed: 2026-08-05
---

# Phase 22 Plan 02: Expo SDK 55 Hop Summary

**Upgraded the mobile app to Expo 55.0.28 / React Native 0.83.10, reconciled SDK 55 New-Architecture and StatusBar changes, passed all local gates, and produced a finished EAS Android preview build before committing the hop as rollback boundary `11e4b41a`.**

## Performance

- **Duration:** 128 min (including 102 min in the EAS worker queue)
- **Started:** 2026-08-05T12:39:31Z
- **Completed:** 2026-08-05T14:47:18Z
- **Tasks:** 2 completed
- **Files modified:** 7

## Accomplishments

- Resolved Expo **55.0.28**, React Native **0.83.10**, React **19.2.0**, and expo-router **55.0.17** through the SDK 55-aligned dependency graph.
- Removed both platform `newArchEnabled` fields from `app.json`; New Architecture is mandatory/default in SDK 55 and `expo-doctor` rejects the obsolete fields.
- Removed the deprecated Android `backgroundColor` prop from the root Expo `StatusBar`, with a focused regression assertion that it remains absent.
- Accepted React Native 0.83's `ColorSchemeName` value `unspecified` as the existing light fallback and added focused coverage.
- Preserved `babel-plugin-dynamic-import-node` in `babel.config.js`; `expo-av` remains unused.
- Passed `expo-doctor` **19/19**, `tsc --noEmit`, and Jest **45/45 suites, 412/412 tests**.
- EAS Android preview build **10c95e4d-6cac-4a7e-b677-d0fa5a8b5418** finished green and produced [the preview APK](https://expo.dev/artifacts/eas/a3GvJVlnaJzraNcKkVOuBB9TYTe8hA5cOmXwkgWhVRQ.apk).

## Task Commits

The plan's Task 2 explicitly owns the isolated post-EAS rollback boundary, so Task 1's dependency/config/test changes and Task 2's green-build evidence landed together:

1. **Tasks 1-2: Expo SDK 55 hop plus finished EAS Android gate** - `11e4b41a` (feat)

_Plan metadata is committed separately after this summary and state update._

## Files Created/Modified

- `apps/mobile/package.json` - SDK 55 Expo/React Native/React package matrix and compatible test peers.
- `apps/mobile/package-lock.json` - resolved SDK 55 dependency graph.
- `apps/mobile/app.json` - removed invalid platform `newArchEnabled` fields; registered Expo font/sqlite plugins emitted by `expo install --fix`.
- `apps/mobile/app/_layout.tsx` - removed the SDK-55-deprecated StatusBar Android background color prop.
- `apps/mobile/lib/theme/appearance.ts` - accepts React Native 0.83's `unspecified` color scheme.
- `apps/mobile/__tests__/lib/theme/appearance.test.ts` - covers `unspecified` for system and explicit preferences.
- `apps/mobile/__tests__/lib/theme/AppChrome.test.ts` - asserts the deprecated StatusBar prop is absent.

## Decisions Made

- **Mandatory New Architecture:** removed the two obsolete flags rather than relocating them; SDK 55 enables New Architecture by default and `android/` remains CNG-regenerable/untracked from Plan 01.
- **Test peer alignment:** upgraded `react-test-renderer` to 19.2.0 and React Native Testing Library to the expo-router-compatible 13.x line after the first Jest pass exposed peer mismatch timeouts.
- **One rollback commit:** held the whole working hop until EAS returned `FINISHED`, matching the plan's explicit rule that no partial SDK 55 commit exists before the cloud build is green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed a deprecated StatusBar prop that the research audit missed**
- **Found during:** Task 1 deprecation audit
- **Issue:** `app/_layout.tsx` still supplied `backgroundColor` to Expo `StatusBar`.
- **Fix:** Removed the prop and inverted the existing source-contract assertion to require its absence.
- **Files modified:** `app/_layout.tsx`, `__tests__/lib/theme/AppChrome.test.ts`
- **Verification:** Focused theme tests and the full 412-test Jest suite passed.

**2. [Rule 3 - Blocking] Reconciled React Native 0.83 typing and SDK 55 test peers**
- **Found during:** Task 1 TypeScript/Jest gates
- **Issue:** `ColorSchemeName` now includes `unspecified`; React 19.2 was paired with renderer 19.1 and React Native Testing Library 12.9.
- **Fix:** Added the typed fallback/test matrix and aligned renderer/testing-library peers.
- **Files modified:** `lib/theme/appearance.ts`, its tests, `package.json`, `package-lock.json`
- **Verification:** TypeScript exited 0; Jest passed 45/45 suites and 412/412 tests.

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking compatibility issue). Both were required for the plan's prescribed gates; no scope expansion.

## Issues Encountered

- npm 10.9.3 intermittently failed to replace `package-lock.json` on Windows with `UNKNOWN -4094 open`; the same install under npm 10.9.4 wrote the lockfile successfully, and `npm ls` then exited cleanly.
- EAS CLI's first local archive attempt hit Git's Windows local-clone protection before a build was created. A command-scoped `GIT_CLONE_PROTECTION_ACTIVE=false` retry created the sole remote build.
- The EAS worker queue lasted about 102 minutes. The original attached shell timed out locally after one hour, but the remote build stayed alive; a build-ID-specific waiter continued until `FINISHED` without submitting a duplicate.
- The GSD commit helper misparsed the multi-word message as pathspecs on PowerShell. Native Git was used with an exact seven-file staging list; no unrelated dirty files entered the commit.

## User Setup Required

None.

## Next Phase Readiness

- SDK 55 is a committed, green rollback boundary at `11e4b41a`.
- Local doctor, typecheck, Jest, and EAS Android preview gates are all green.
- Plan 22-03 may begin the SDK 55 -> 56 hop; it was intentionally not started here.

---
*Phase: 22-expo-sdk-54-57-bump*
*Completed: 2026-08-05*

## Self-Check: PASSED

- FOUND: `.planning/phases/22-expo-sdk-54-57-bump/22-02-SUMMARY.md`
- FOUND: commit `11e4b41a`
