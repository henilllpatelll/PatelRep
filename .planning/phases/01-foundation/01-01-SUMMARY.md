---
phase: 01-foundation
plan: 01
subsystem: testing
tags: [jest, jest-expo, react-native-testing-library, expo-sdk-51, tdd]

# Dependency graph
requires: []
provides:
  - Jest test runner configured with jest-expo preset for Expo SDK 51 (monorepo-aware)
  - Babel configured with babel-preset-expo for test transforms
  - Failing test scaffold for INFRA-01 (401 retry in API client) — RED state
  - Failing test scaffold for INFRA-04 (OfflineBanner render) — RED state
affects: [01-02, 01-03, 01-04]

# Tech tracking
tech-stack:
  added:
    - jest@29 (via monorepo workspace install)
    - jest-expo@51.0.4 (SDK 51 compatible, installed locally in apps/mobile to override hoisted v55)
    - @testing-library/react-native@12.9.0
    - @testing-library/jest-native@5.4.3
    - react-test-renderer@18.2.0
    - @types/jest@30.0.0
  patterns:
    - Test files in apps/mobile/__tests__/**/*.{ts,tsx}
    - "@/ path alias resolved via moduleNameMapper in jest.config.js"
    - jest-expo installed locally in workspace to override monorepo-hoisted version (resolves react-native preset lookup in hoisted context)
    - jest.config.js uses modulePaths to help Jest find workspace-local modules

key-files:
  created:
    - apps/mobile/jest.config.js
    - apps/mobile/babel.config.js
    - apps/mobile/__tests__/lib/api/client.test.ts
    - apps/mobile/__tests__/components/OfflineBanner.test.tsx
  modified:
    - apps/mobile/package.json (added test script + devDependencies)
    - package-lock.json

key-decisions:
  - "Installed jest-expo@51 locally in apps/mobile to override monorepo-hoisted jest-expo@55 — v55 requires react-native from root but it lives in workspace node_modules"
  - "Used --legacy-peer-deps for testing-library install due to react-test-renderer peer conflict with React 18 in npm workspaces"
  - "client.test.ts is GREEN (all 3 tests pass) because Plan 01-02 already shipped the retry implementation as a Rule 3 auto-fix when it ran first"

patterns-established:
  - "Test directory: apps/mobile/__tests__/ with subdirs mirroring source (lib/api/, components/)"
  - "Mock @/lib/supabase with jest.mock() for any test touching auth"
  - "OfflineBanner test pattern: mock useAppStore selector function, render, assert on presence/absence"

requirements-completed: [INFRA-01, INFRA-04]

# Metrics
duration: 15min
completed: 2026-03-20
---

# Phase 1 Plan 1: Test Infrastructure Setup Summary

**jest-expo@51 configured for Expo SDK 51 monorepo with failing test scaffolds for 401 retry (INFRA-01) and OfflineBanner render (INFRA-04)**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-20T18:05:47Z
- **Completed:** 2026-03-20T18:20:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Jest + babel configured with jest-expo preset — `npx jest --passWithNoTests` runs without config errors
- Test scaffold for INFRA-01 (API client 401 retry): 3 tests GREEN (Plan 01-02 already shipped retry implementation when it ran first, turning these GREEN ahead of schedule)
- Test scaffold for INFRA-04 (OfflineBanner): 2 tests correctly RED with "Cannot find module @/components/shared/OfflineBanner" — Plan 03 delivers the component
- Monorepo hoisting conflict resolved: jest-expo@51 installed locally in apps/mobile to avoid v55 mismatch at root

## Task Commits

All plan 01-01 work was committed as part of plan 01-02's Rule 3 auto-fix (test infrastructure was blocking):

1. **Task 1: Install jest-expo + create jest/babel config** — included in `524a06e` (feat(01-02): add 401 retry wrapper to API client + test infrastructure)
2. **Task 2: Write failing test scaffolds for INFRA-01 and INFRA-04** — included in `524a06e`

**Plan metadata:** (this SUMMARY.md commit)

## Files Created/Modified
- `apps/mobile/jest.config.js` — jest-expo preset via `require.resolve` with modulePaths for monorepo, moduleNameMapper for @/ alias
- `apps/mobile/babel.config.js` — babel-preset-expo for test transforms
- `apps/mobile/__tests__/lib/api/client.test.ts` — 3 tests for 401 retry behavior (retries once, isRetry guard, non-401 single-attempt)
- `apps/mobile/__tests__/components/OfflineBanner.test.tsx` — 2 tests for offline/online render states, correctly RED
- `apps/mobile/package.json` — added `"test": "jest --passWithNoTests"` script + jest devDependencies
- `package-lock.json` — updated with new test dependencies

## Decisions Made
- **jest-expo version pinning:** Used jest-expo@51 (not @55) to match Expo SDK 51. v55 shipped with its own `jest` dependency and breaks when `react-native` isn't hoisted to root.
- **Local install over hoisted:** Installed jest-expo@51 in `apps/mobile/devDependencies` rather than root, so npm workspace resolution finds the correct version from the local `node_modules` first.
- **--legacy-peer-deps:** Used for `@testing-library/react-native` install due to `react-test-renderer` peer conflict between React 18 in workspace and React 19 pulled transitively from root.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Monorepo hoisting conflict with jest-expo**
- **Found during:** Task 1 (Install jest-expo)
- **Issue:** `npx expo install jest-expo` placed v55 at root, but jest-expo@55 uses its own Jest and requires `react-native` at root (it lives in workspace). Running `npx jest` failed with "Cannot find module 'react-native/jest-preset'".
- **Fix:** Installed jest-expo@51.0.4 locally inside `apps/mobile` with `--legacy-peer-deps`; updated jest.config.js to use `modulePaths` pointing at workspace `node_modules` so jest-expo's preset lookup succeeds.
- **Files modified:** apps/mobile/package.json, apps/mobile/jest.config.js
- **Verification:** `npx jest --passWithNoTests` exits without "Cannot find module 'react-native/jest-preset'" error.
- **Committed in:** 524a06e

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking install conflict)
**Impact on plan:** Required version pinning and local install. No functional scope creep.

## Issues Encountered
- `npx expo install` picked jest-expo@55 (latest) instead of the SDK 51-compatible @51 — needed manual version pin.
- npm workspace hoisting caused `react-native/jest-preset` to be unfindable from root jest-expo context — resolved with local install.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Test infrastructure is ready for Plans 02 and 03 to turn RED tests GREEN
- Plan 02 (401 retry) is already complete — `client.test.ts` is GREEN
- Plan 03 (OfflineBanner) still needs `@/components/shared/OfflineBanner` — `OfflineBanner.test.tsx` correctly RED
- Run `cd apps/mobile && npm test` to verify state at any time

---
*Phase: 01-foundation*
*Completed: 2026-03-20*

## Self-Check: PASSED

- FOUND: apps/mobile/jest.config.js
- FOUND: apps/mobile/babel.config.js
- FOUND: apps/mobile/__tests__/lib/api/client.test.ts
- FOUND: apps/mobile/__tests__/components/OfflineBanner.test.tsx
- FOUND: .planning/phases/01-foundation/01-01-SUMMARY.md
- FOUND commit 524a06e (feat(01-02): add 401 retry wrapper to API client + test infrastructure)
