---
phase: 01-foundation
plan: 02
subsystem: auth
tags: [zustand, supabase, react-native, jest, jest-expo, fetch, token-refresh]

# Dependency graph
requires:
  - phase: 01-foundation/01-01
    provides: test scaffolds for client.test.ts (RED state written by Plan 01)
provides:
  - isLoading boolean in appStore starting at true with setIsLoading setter
  - AppState.addEventListener lifecycle hook in supabase.ts calling start/stopAutoRefresh
  - request() 401 retry wrapper: refreshSession on first 401, throws on second
  - client.test.ts GREEN (3/3 tests passing)
  - jest-expo test infrastructure configured for monorepo
affects:
  - 01-03 (OfflineBanner — test scaffold already in RED, needs component)
  - 01-04 (auth hydration — uses isLoading from appStore)
  - All future plans using api.get/post/patch/delete (transparent retry behavior)

# Tech tracking
tech-stack:
  added:
    - jest-expo 55.0.11 (test preset for Expo SDK 51)
    - "@testing-library/react-native 12.x"
    - "@testing-library/jest-native 5.x"
    - "@types/jest 30.x"
  patterns:
    - 401 retry: request() with isRetry flag — one refresh attempt, then throws
    - AppState lifecycle: module-scope addEventListener, no cleanup (app lifetime listener)
    - Monorepo jest config: modulePaths pointing to workspace node_modules for hoisted deps

key-files:
  created:
    - apps/mobile/__tests__/lib/api/client.test.ts
    - apps/mobile/__tests__/components/OfflineBanner.test.tsx
    - apps/mobile/jest.config.js
    - apps/mobile/babel.config.js
  modified:
    - apps/mobile/stores/appStore.ts
    - apps/mobile/lib/supabase.ts
    - apps/mobile/lib/api/client.ts
    - apps/mobile/package.json

key-decisions:
  - "isLoading defaults to true (not false) — Zustand is synchronous so the initial value must represent unresolved auth state"
  - "AppState.addEventListener registered at module scope, no removeEventListener — listener is intentionally permanent for app lifetime"
  - "401 retry uses internal isRetry flag not exposed on api export — callers see no API change"
  - "jest.config.js uses modulePaths to bridge monorepo: jest-expo hoisted to root, react-native in workspace node_modules"
  - "client.test.ts mock for getSession updates after refreshSession call to simulate real Supabase session update"

patterns-established:
  - "Token retry pattern: single retry with isRetry guard prevents infinite loops on persistent 401s"
  - "Monorepo jest config: spread preset + modulePaths = workspace-aware module resolution"

requirements-completed: [AUTH-03, AUTH-05, INFRA-01]

# Metrics
duration: 22min
completed: 2026-03-20
---

# Phase 1 Plan 2: Infrastructure Bug Fixes Summary

**401 retry wrapper with refreshSession, isLoading state in Zustand, and AppState token refresh lifecycle — client.test.ts 3/3 GREEN**

## Performance

- **Duration:** 22 min
- **Started:** 2026-03-20T18:06:05Z
- **Completed:** 2026-03-20T18:28:00Z
- **Tasks:** 2
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments
- Added `isLoading: boolean` (starts `true`) + `setIsLoading` to AppState interface and Zustand store
- Wired `AppState.addEventListener` at module scope in supabase.ts — tokens auto-refresh on foreground, pause on background
- Rewrote `request()` in client.ts with `isRetry` flag: on first 401 calls `refreshSession`, retries once; on second 401 throws session-expired error
- Set up jest-expo test infrastructure for monorepo (modulePaths fix for hoisted dependencies)
- All 3 client.test.ts tests GREEN; OfflineBanner.test.tsx in correct RED state for Plan 03

## Task Commits

Each task was committed atomically:

1. **Task 1: Add isLoading to appStore and AppState refresh lifecycle** - `75aeab0` (feat)
2. **Task 2: Add 401 retry wrapper to API client + test infrastructure** - `524a06e` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `apps/mobile/stores/appStore.ts` - Added isLoading: true + setIsLoading to AppState interface and store implementation
- `apps/mobile/lib/supabase.ts` - Added AppState import + module-scope addEventListener for start/stopAutoRefresh
- `apps/mobile/lib/api/client.ts` - Rewrote request() with isRetry param and 401/refreshSession branch
- `apps/mobile/package.json` - Added test script + jest/testing-library devDependencies
- `apps/mobile/jest.config.js` - Created: jest-expo preset with modulePaths for monorepo node_modules
- `apps/mobile/babel.config.js` - Created: babel-preset-expo config
- `apps/mobile/__tests__/lib/api/client.test.ts` - Created: 3 tests for 401 retry (all GREEN)
- `apps/mobile/__tests__/components/OfflineBanner.test.tsx` - Created: 2 tests for offline banner (RED — Plan 03)

## Decisions Made
- `isLoading` defaults to `true` not `false` — auth state is unresolved at store init, must block render until session check completes
- AppState listener registered at module scope with no cleanup — intentional; it should live for the full app lifetime
- `isRetry` is an internal function parameter, not on the `api` export — callers see zero API change
- jest.config.js uses `modulePaths` pointing to workspace `node_modules` — resolves the monorepo hoisting mismatch where `jest-expo` is in root but `react-native` is in the workspace
- Updated client.test.ts mock so `getSession` returns `token-2` after `refreshSession` is called — simulates real Supabase session update behavior

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test infrastructure from Plan 01 was not yet set up**
- **Found during:** Task 2 (401 retry wrapper — verification requires running jest)
- **Issue:** No jest.config.js, babel.config.js, or test dependencies existed; jest-expo and testing-library not installed; __tests__ directory empty
- **Fix:** Installed jest-expo + testing-library via npm, created jest.config.js and babel.config.js, created both test files (client.test.ts + OfflineBanner.test.tsx), fixed monorepo preset path issue with modulePaths
- **Files modified:** jest.config.js, babel.config.js, package.json, __tests__/lib/api/client.test.ts, __tests__/components/OfflineBanner.test.tsx
- **Verification:** `npx jest --testPathPatterns="client.test"` passes 3/3 tests
- **Committed in:** `524a06e` (Task 2 commit)

**2. [Rule 1 - Bug] client.test.ts mock for getSession needed dynamic update after refreshSession**
- **Found during:** Task 2 verification (first test run showed token-1 instead of token-2 on retry)
- **Issue:** Static `mockResolvedValue` for getSession always returned token-1; after refreshSession, Supabase updates internal session but mock didn't reflect this
- **Fix:** Changed getSession mock to `mockImplementation` that updates after refreshSession call, accurately simulating real Supabase client behavior
- **Files modified:** apps/mobile/__tests__/lib/api/client.test.ts
- **Verification:** `retries once with refreshed token on 401` test now passes with Bearer token-2 on second call
- **Committed in:** `524a06e` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking infrastructure, 1 test mock bug)
**Impact on plan:** Both fixes necessary for test verification to work. No scope creep.

## Issues Encountered
- npm workspaces hoisting: `jest-expo` installed to monorepo root but its `jest-preset.js` requires `react-native/jest-preset` which is only in the workspace `node_modules`. Resolved with `modulePaths: [path.resolve(__dirname, 'node_modules')]` in jest.config.js pointing Jest to the workspace's local node_modules.

## Next Phase Readiness
- Plan 03 can implement OfflineBanner component and turn its test GREEN
- Plan 04 (auth hydration) can use `isLoading` + `setIsLoading` from appStore
- All downstream API calls now transparently recover from expired tokens via the retry wrapper

---
*Phase: 01-foundation*
*Completed: 2026-03-20*
