---
phase: 02-housekeeper-workflow
plan: "05"
subsystem: ui
tags: [react-native, expo, expo-constants, i18n, push-notifications, profile]

# Dependency graph
requires:
  - phase: 02-housekeeper-workflow
    provides: i18n keys including profile.hotel added in plan 02-02
  - phase: 02-housekeeper-workflow
    provides: api client (lib/api/client.ts) and appStore with user.hotel_id
provides:
  - Profile screen fetches and displays hotel name via GET /hotels/{hotel_id}
  - Push notification registration reads EAS projectId from Constants.expoConfig (no hardcoded placeholder)
affects: [02-housekeeper-workflow, push-notifications, phase-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "expo-constants used for runtime config access (Constants.expoConfig?.extra?.eas?.projectId)"
    - "Silent catch on display-only API fetches — hotel name failure does not break screen"
    - "Graceful degradation with console.warn when EAS projectId not configured"

key-files:
  created: []
  modified:
    - apps/mobile/app/(app)/profile/index.tsx
    - apps/mobile/lib/notifications.ts

key-decisions:
  - "Silent catch on hotel name fetch — it is display-only, failure should not interrupt profile screen"
  - "Constants.easConfig fallback typed with inline cast to avoid TS error (easConfig not in standard types)"
  - "Return null + console.warn (not throw) when EAS projectId missing — correct Phase 2 behavior before EAS setup"

patterns-established:
  - "Display-only fetches use silent .catch(() => {}) — only critical data fetches show errors"
  - "Push token config reads from Constants.expoConfig?.extra?.eas?.projectId first, easConfig second"

requirements-completed: [PROF-01, PROF-02, HK-05]

# Metrics
duration: 5min
completed: 2026-03-22
---

# Phase 2 Plan 05: Profile Hotel Name + Push Token Fix Summary

**Profile screen fetches hotel name via GET /hotels/{hotel_id} and displays it with t("profile.hotel"), and push token registration now reads EAS projectId from Constants.expoConfig instead of the hardcoded placeholder.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-22T00:04:00Z
- **Completed:** 2026-03-22T00:05:06Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Profile screen now shows hotel name below role, fetched on mount from the hotels API using user.hotel_id from appStore
- Push token registration no longer silently fails on real devices — EAS projectId is read from app.json config at runtime
- When EAS projectId is not yet configured (pre-Phase 3), registerForPushNotifications returns null with a clear console.warn instead of sending an invalid token to Expo

## Task Commits

Each task was committed atomically:

1. **Task 1: Add hotel name fetch to profile screen** - `848a17f` (feat)
2. **Task 2: Fix push token projectId in notifications.ts** - `48cc5aa` (fix)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `apps/mobile/app/(app)/profile/index.tsx` - Added useEffect + useState for hotel name, api import, hotel display row, hotel style
- `apps/mobile/lib/notifications.ts` - Added expo-constants import, replaced hardcoded projectId with Constants.expoConfig lookup + graceful null return

## Decisions Made
- Silent catch on hotel name fetch — hotel name is display-only, a failed fetch should not crash or show an error on the profile screen
- `Constants.easConfig` fallback uses an inline type cast `as { projectId?: string } | undefined` because easConfig is not in the standard expo-constants types for SDK 51
- Return null + console.warn (not throw) when projectId is missing — this is the correct Phase 2 behavior before EAS project is set up

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. The EAS projectId setup is a pre-Phase 3 human step already documented in STATE.md blockers.

## Next Phase Readiness
- PROF-01, PROF-02, HK-05 requirements are now complete
- Profile screen is fully functional for v1 (name, role, hotel name, language toggle, sign out)
- Push token registration is unblocked — once EAS projectId is set in app.json extra.eas.projectId, tokens will register correctly on real devices
- Remaining Phase 2 blocker: `google-services.json` must be added as an EAS secret before Android push testing (pre-Phase 3)

---
*Phase: 02-housekeeper-workflow*
*Completed: 2026-03-22*

## Self-Check: PASSED

- FOUND: apps/mobile/app/(app)/profile/index.tsx
- FOUND: apps/mobile/lib/notifications.ts
- FOUND: .planning/phases/02-housekeeper-workflow/02-05-SUMMARY.md
- FOUND commit 848a17f: feat(02-05): add hotel name fetch to profile screen
- FOUND commit 48cc5aa: fix(02-05): read EAS projectId from Constants.expoConfig in notifications.ts
