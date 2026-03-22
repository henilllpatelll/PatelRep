---
phase: 03-engineer-workflow-push-eas
plan: "05"
subsystem: infra
tags: [eas, expo, android, firebase, push-notifications, build]

# Dependency graph
requires:
  - phase: 03-engineer-workflow-push-eas
    provides: push token registration infrastructure (03-01), mobile notifications lib (03-00)
provides:
  - EAS preview build profile with android.buildType: apk for pilot sideload distribution
  - (Pending human action) app.json extra.eas.projectId for push token registration
  - (Pending human action) google-services.json for Android EAS build

affects: [apps/mobile/lib/notifications.ts, eas build CI, pilot distribution]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "EAS preview profile with android.buildType: apk — APK sideload for pilot (no Play Store)"

key-files:
  created: []
  modified:
    - apps/mobile/eas.json

key-decisions:
  - "android.buildType: apk chosen for preview profile — APK sideloads without Play Store, correct for single-hotel pilot distribution"

patterns-established:
  - "EAS preview = internal APK distribution; EAS production = aab for Play Store (future)"

requirements-completed: [INFRA-03]

# Metrics
duration: 2min
completed: 2026-03-22
---

# Phase 03 Plan 05: EAS Build Configuration Summary

**EAS preview profile configured with android.buildType: apk for pilot APK sideload; human setup pending for eas init (projectId), google-services.json, and FCM credentials**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-22T03:27:26Z
- **Completed:** 2026-03-22T03:29:00Z
- **Tasks:** 1 of 2 (Task 2 is a human-action checkpoint)
- **Files modified:** 1

## Accomplishments
- Added `android.buildType: apk` to the EAS `preview` build profile in eas.json — enables APK sideload distribution for the pilot hotel without requiring Play Store
- Verified via Python JSON validation: `PASS: preview profile has android.buildType: apk`
- Task 2 (eas init, google-services.json, FCM credentials, Apple credentials) is a human-action gate — instructions provided in checkpoint return

## Task Commits

Each task was committed atomically:

1. **Task 1: Add android.buildType: apk to eas.json preview profile** - `3714af2` (chore)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `apps/mobile/eas.json` - Added `android.buildType: apk` to preview build profile

## Decisions Made
- `android.buildType: apk` chosen for sideload: APK installs directly on Android without Play Store; `aab` (the default) requires Play Store publishing — APK is correct for single-hotel pilot distribution

## Deviations from Plan

None - Task 1 executed exactly as written. Task 2 is a checkpoint:human-action that stops execution per protocol.

## Issues Encountered
None

## User Setup Required

**External services require manual configuration.** Complete these steps in order after this checkpoint:

**STEP 1 — Run eas init (writes projectId to app.json):**
```
cd apps/mobile
eas init
```
This logs into Expo, registers the project on EAS, and writes `extra.eas.projectId` to app.json automatically. Commit app.json after.

**STEP 2 — Add google-services.json (required for Android EAS build):**
- Firebase Console -> Project Settings -> Your Apps -> Android app (com.patelrep.app)
- If app doesn't exist: click "Add app", enter package name `com.patelrep.app`
- Click "Download google-services.json"
- Place at: `apps/mobile/google-services.json`
- Commit (contains only public identifiers, safe to commit)

**STEP 3 — Upload FCM V1 service account for push (optional for first build, required for push to work):**
- Firebase Console -> Project Settings -> Service accounts -> Generate new private key
- Save JSON file
- Run: `eas credentials` -> Select Android -> Add FCM V1 service account key -> upload JSON

**STEP 4 — iOS (can defer if not Apple Developer enrolled):**
- If enrolled: `eas build --platform ios --profile production`
- If not enrolled: skip — Android APK alone satisfies pilot's immediate need

**STEP 5 — Trigger Android APK build to verify:**
```
cd apps/mobile
eas build --platform android --profile preview
```
Build takes 5-15 minutes in EAS cloud. Download APK and sideload to Android device.

**Resume signal:** Type "eas-done" when app.json has projectId and the Android APK build has started (or completed).

## Next Phase Readiness
- eas.json APK profile is ready — Task 1 complete
- Blocked on human action: eas init + google-services.json + FCM credentials before Android EAS build can succeed
- Once human steps complete, INFRA-03 is fully satisfied for Android; iOS TestFlight satisfies full requirement after Apple credentials

---
*Phase: 03-engineer-workflow-push-eas*
*Completed: 2026-03-22*
