---
phase: 03-engineer-workflow-push-eas
plan: "03"
subsystem: mobile-push
tags: [push-notifications, deep-linking, expo-notifications, tdd, infra]
dependency_graph:
  requires: [03-00, 03-01]
  provides: [INFRA-02-mobile, ENG-06-navigation]
  affects: [apps/mobile/lib/notifications.ts, apps/mobile/app/_layout.tsx]
tech_stack:
  added: []
  patterns:
    - "api.patch for push token registration (replaces direct Supabase write)"
    - "Dual-path Expo notification navigation: getLastNotificationResponseAsync + addNotificationResponseReceivedListener"
key_files:
  created: []
  modified:
    - apps/mobile/lib/notifications.ts
    - apps/mobile/app/_layout.tsx
decisions:
  - "api.patch used for push token registration — API endpoint reads user from JWT, no supabase.auth.getUser() needed in mobile client"
  - "Dual-path notification handler: killed-app uses getLastNotificationResponseAsync() on mount; backgrounded uses addNotificationResponseReceivedListener listener"
  - "useRouter hook in RootLayout — stable reference from expo-router, empty dep array is correct (runs once on mount)"
metrics:
  duration: "2 min"
  completed_date: "2026-03-22"
  tasks_completed: 2
  files_modified: 2
---

# Phase 03 Plan 03: Push Token API Migration + Dual-Path Notification Navigator Summary

**One-liner:** API-mediated push token registration (api.patch replaces direct Supabase write) plus dual-path killed/backgrounded notification deep linking in root layout.

## What Was Built

### Task 1: Replace savePushTokenToProfile with API call (TDD GREEN)
- Removed `supabase` import from `notifications.ts`
- Added `api` import from `@/lib/api/client`
- Rewrote `savePushTokenToProfile` to call `api.patch("/staff/me/push-token", { token })`
- The API endpoint reads the user identity from the JWT claim — no client-side user lookup needed
- `registerForPushNotifications` and `setupPushNotifications` unchanged
- `notifications.test.ts` passes GREEN: both assertions (api.patch called, supabase.from not called)

### Task 2: Dual-path notification deep link handler in _layout.tsx
- Added `import * as Notifications from "expo-notifications"`
- Added `useRouter` to existing expo-router import (`Stack, useRouter`)
- Added `const router = useRouter()` at top of `RootLayout` component body
- Added notification `useEffect` after the NetInfo `useEffect` with two paths:
  - **Path 1 (killed state):** `Notifications.getLastNotificationResponseAsync()` — checked once on mount; `addNotificationResponseReceivedListener` does NOT fire when the app is cold-started by a tap
  - **Path 2 (backgrounded/foreground):** `addNotificationResponseReceivedListener` subscription with cleanup via `subscription.remove()`
- Both paths extract `data.url` from notification content and call `router.push(url)`
- Empty dependency array is intentional — runs once on mount; `router` is a stable reference

## Deviations from Plan

None — plan executed exactly as written.

## Test Results

```
PASS __tests__/lib/notifications.test.ts
  savePushTokenToProfile
    ✓ calls api.patch /staff/me/push-token with token (2 ms)
    ✓ does NOT call supabase.from(user_profiles)

Tests: 2 passed, 2 total
```

TypeScript: No new errors introduced. Pre-existing TS errors in Wave 0 RED test stubs (ReportIssueModal.test.tsx, sync.test.ts) are out of scope for this plan.

## Commits

| Task | Hash | Description |
|------|------|-------------|
| 1 | aacd8b2 | feat(03-03): replace savePushTokenToProfile with API call |
| 2 | 9f303c1 | feat(03-03): add dual-path notification deep link handler to _layout.tsx |

## Self-Check: PASSED

- [x] `apps/mobile/lib/notifications.ts` — modified, no supabase import, uses api.patch
- [x] `apps/mobile/app/_layout.tsx` — modified, has getLastNotificationResponseAsync + addNotificationResponseReceivedListener
- [x] Commit aacd8b2 exists
- [x] Commit 9f303c1 exists
- [x] notifications.test.ts 2/2 GREEN
