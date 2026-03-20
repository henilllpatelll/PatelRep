---
phase: 01-foundation
plan: 03
subsystem: mobile-auth-ux
tags: [splash-screen, offline-banner, auth-hydration, expo-router, react-native]
dependency_graph:
  requires: [01-02]
  provides: [OfflineBanner component, SplashScreen hydration guard]
  affects: [apps/mobile/app/_layout.tsx, apps/mobile/app/(auth)/_layout.tsx, apps/mobile/app/(app)/_layout.tsx]
tech_stack:
  added: [expo-splash-screen@~0.27.0]
  patterns: [isLoading gate before redirect, module-scope SplashScreen.preventAutoHideAsync, selector-based store subscription]
key_files:
  created:
    - apps/mobile/components/shared/OfflineBanner.tsx
  modified:
    - apps/mobile/app/_layout.tsx
    - apps/mobile/app/(auth)/_layout.tsx
    - apps/mobile/app/(app)/_layout.tsx
    - apps/mobile/jest.config.js
decisions:
  - "SplashScreen.preventAutoHideAsync at module scope (not inside component) — must run before React mounts"
  - "setIsLoading(false) called at end of every onAuthStateChange callback including initial hydration event"
  - "5s safety timeout in _layout.tsx prevents permanent splash lock on slow devices"
  - "React pinned to root node_modules in jest.config.js to eliminate two-React-copy Invalid hook call error"
  - "expo-splash-screen installed at ~0.27.0 to match SDK 51 compatibility range"
metrics:
  duration: 4 min
  completed_date: "2026-03-20"
  tasks_completed: 2
  files_modified: 5
---

# Phase 01 Plan 03: SplashScreen Hydration Guard + OfflineBanner Summary

**One-liner:** SplashScreen hydration guard with isLoading gating across all three Expo Router layouts plus OfflineBanner component, eliminating the cold-open login flash.

## What Was Built

### OfflineBanner component (`apps/mobile/components/shared/OfflineBanner.tsx`)
Named export reads `isOnline` from appStore via a single-field selector. Returns `null` when online (zero layout impact). Renders a full-width red (#EF4444) bar with white "No internet connection" text when offline.

### Root layout hydration guard (`apps/mobile/app/_layout.tsx`)
- `SplashScreen.preventAutoHideAsync()` called at **module scope** before component mounts
- `setIsLoading(false)` called as the last line of every `onAuthStateChange` callback — fires on the initial hydration event and all subsequent events
- `useEffect` watching `isLoading` calls `SplashScreen.hideAsync()` once loading resolves
- 5-second safety `setTimeout` calls `setIsLoading(false)` to prevent permanent splash lock on slow devices

### Auth layout guard (`apps/mobile/app/(auth)/_layout.tsx`)
- `isLoading` destructured from store alongside `isAuthenticated`
- Redirect to `/(app)` only fires when `!isLoading && isAuthenticated` — eliminates early redirect during cold open

### App layout guard (`apps/mobile/app/(app)/_layout.tsx`)
- `isLoading` destructured; redirect to `/(auth)/login` gated on `!isLoading && !isAuthenticated`
- Early return now checks `isLoading || !user` (previously only `!user`)
- `OfflineBanner` rendered above `Tabs` inside a Fragment

## Verification

Full jest suite: **5/5 tests GREEN**
- `__tests__/lib/api/client.test.ts`: 3 tests (unchanged, still passing)
- `__tests__/components/OfflineBanner.test.tsx`: 2 tests (GREEN after this plan)

TypeScript: `npx tsc --noEmit` — clean, no errors.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Two React instances caused Invalid hook call in tests**
- **Found during:** Task 1 verification (OfflineBanner.test.tsx)
- **Issue:** `react-test-renderer` resolves from root `node_modules` (uses root React), while component code resolves `react` from `apps/mobile/node_modules` (workspace React). Two separate React instances at test time trigger "Invalid hook call".
- **Fix:** Added `moduleNameMapper` entries in `jest.config.js` to pin `react` and `react/.*` imports to the root `node_modules/react` path — same copy used by `react-test-renderer`.
- **Files modified:** `apps/mobile/jest.config.js`
- **Commit:** 5032f0c

**2. [Rule 3 - Blocking] expo-splash-screen not installed**
- **Found during:** Task 2 TypeScript check
- **Issue:** `expo-splash-screen` was used in `_layout.tsx` but was not in `package.json` or `node_modules`, causing TS2307 error.
- **Fix:** `npm install expo-splash-screen@~0.27.0` — version chosen to match SDK 51 compatibility range (same pattern as other expo packages in package.json).
- **Files modified:** `apps/mobile/package.json`, root `package-lock.json`
- **Commit:** 9c047ff

## Self-Check: PASSED

- OfflineBanner.tsx: FOUND
- _layout.tsx: FOUND
- (auth)/_layout.tsx: FOUND
- (app)/_layout.tsx: FOUND
- commit 5032f0c: FOUND
- commit 9c047ff: FOUND
