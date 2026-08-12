---
phase: 22-expo-sdk-54-57-bump
plan: 01
subsystem: testing
tags: [jest, react-i18next, expo, new-architecture, android, cng, testing-library]

# Dependency graph
requires: []
provides:
  - "Green jest baseline (409/409) for apps/mobile, established as the reference gate for all three SDK hop plans (22-02, 22-03, 22-04)"
  - "New-Architecture config divergence eliminated: committed apps/mobile/android/ removed from git; app.json newArchEnabled:true is now the sole committed New-Arch source of truth"
affects: [22-02, 22-03, 22-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "react-i18next test mocks must implement interpolation (replace {{key}} placeholders using the values arg) to faithfully exercise components that call t(key, { ... }) — a pass-through t: (key) => key mock silently diverges from real rendered text"

key-files:
  created: []
  modified:
    - apps/mobile/__tests__/screens/ProfileHandoff.test.tsx
    - apps/mobile/__tests__/screens/GuestRequestsList.test.tsx
  removed:
    - apps/mobile/android/ (50 tracked files — CNG project, EAS-ignored, regenerable)

key-decisions:
  - "All 3 pre-existing jest failures were fixed (not quarantined) — each root-caused to a stale/incomplete i18n mock in the test file itself, not a component bug or an SDK-related regression."
  - "Deleted apps/mobile/android/ entirely per the plan's locked recommendation rather than the minimal gradle.properties-sync alternative, since .easignore already excludes it from EAS builds and it is a CNG-regenerable artifact."

patterns-established:
  - "When a react-i18next jest mock needs to assert interpolated text, give it a small key->template dict + a real {{placeholder}} replace function instead of a bare key-passthrough — matches how the real library renders and keeps tests honest about actual UI output."

# Metrics
duration: 4min
completed: 2026-08-05
---

# Phase 22 Plan 01: SDK-Hop Baseline (jest green + New-Arch reconciliation) Summary

**Fixed all 3 pre-existing jest failures (root-caused to stale i18n mocks, not component bugs) for a clean 409/409 baseline, and deleted the stale EAS-ignored `apps/mobile/android/` directory so `app.json`'s `newArchEnabled: true` is the sole committed New-Architecture config before the SDK 54→57 hops begin.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-08-05T08:22:59Z
- **Completed:** 2026-08-05T08:26:14Z
- **Tasks:** 2 completed
- **Files modified:** 2 (test files); 50 files removed (android/)

## Accomplishments
- Jest baseline is now fully green: **409/409 tests passing, 45/45 suites**, exit code 0 — no quarantined tests. This is the reference baseline every subsequent hop plan (22-02, 22-03, 22-04) compares its own `npx jest` run against.
- `npx tsc --noEmit` confirmed clean (exit 0), unaffected by the fixes.
- Committed `apps/mobile/android/` directory (50 files, stale June build artifacts, EAS-ignored per `.easignore`) removed from git tracking, eliminating the New-Arch config divergence between it (`newArchEnabled=false`) and `app.json` (`newArchEnabled=true`).
- Confirmed `app.json` still sets `newArchEnabled: true` (both ios/android keys) and was not edited.
- Confirmed `babel.config.js`'s `dynamic-import-node` plugin (Hermes/Supabase dynamic-import crash guard) is intact and untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1: Establish a green jest baseline** - `75d1a808` (fix)
2. **Task 2: MOBILE-02 — delete stale committed android/ directory** - `965a22d5` (chore)

_No plan-metadata commit yet — created as part of this same execution; see final commit below._

## Files Created/Modified
- `apps/mobile/__tests__/screens/ProfileHandoff.test.tsx` - added missing `"profile.appVersion": "PatelRep v{{version}}"` key to the mock i18n table (mock table already interpolated `{{}}` placeholders; the key itself was simply absent)
- `apps/mobile/__tests__/screens/GuestRequestsList.test.tsx` - replaced the bare `t: (key) => key` mock with a small `mockTranslations` dict (`"guestRequests.roomLabel": "Room {{room}}"`) plus real `{{placeholder}}` interpolation, so `t("guestRequests.roomLabel", { room: "214" })` renders `"Room 214"` as the real library would
- `apps/mobile/android/` - removed from git tracking (50 files: gradle config, AndroidManifest, native res assets, debug keystore, google-services.json, gradle wrapper)

## Decisions Made
- **Fix vs. quarantine for the 3 failing tests:** all 3 were fixed, none quarantined. Root cause for every failure was identical in shape: a hand-rolled `react-i18next` jest mock that either omitted a key (`ProfileHandoff`) or didn't support interpolation at all (`GuestRequestsList`), so the mock's rendered text diverged from what the real i18n library — and thus the real running app — actually renders. This is squarely a test-fixture bug, not app/source behavior needing a change, and well within the "fix, don't quarantine" bar since the root cause was found quickly and the fix was proportionate.
- **Delete `android/` outright** (not the "sync gradle.properties" minimal alternative): the plan's own research established `.easignore` already excludes `android/` from EAS builds (CNG prebuilds fresh from `app.json`), so keeping a stale, EAS-ignored, 50-file native directory around only preserves a maintenance trap. Deletion is fully revertible from git history if a local Gradle workflow is ever needed.

## Deviations from Plan

None — plan executed exactly as written. The plan anticipated a possible fallback to `test.skip` quarantine for tests whose root cause proved "genuinely unrelated to this phase and disproportionate to fix"; that fallback was not needed since both root causes (missing mock key; missing mock interpolation) were found quickly and were trivial, proportionate fixes.

## Issues Encountered
- After `git rm -r android`, local untracked Gradle/Kotlin build artifacts (`.gradle/`, `.kotlin/`, `app/build/`, `build/`, `local.properties`, `build-*.log`) remain on disk under `apps/mobile/android/` — these were never git-tracked (previously excluded by the now-deleted `android/.gitignore`) and are pre-existing local build output from a prior local `expo run:android`, not new artifacts from this plan. They show as untracked in `git status` but are harmless (not part of any commit) and out of scope for this plan's file list — left untouched. If desired, a future cleanup could `rm -rf apps/mobile/android` locally or add a root-level `android/` gitignore rule; neither was in scope here.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness

The two preconditions for the three SDK hop plans (22-02 `54→55`, 22-03 `55→56`, 22-04 `56→57`) are now in place:
- **jest baseline:** 409/409 green, 0 quarantined. Each hop plan's `npx jest` gate now unambiguously means "no new failures" — any red after a hop is upgrade-caused, not pre-existing noise.
- **New-Arch config:** `app.json` (`newArchEnabled: true`) is the sole committed source of truth; no divergent `android/gradle.properties` remains to confuse local vs. EAS build behavior. This also means SDK 55's removal of the `newArchEnabled` field from `app.json` (handled in 22-02) has no conflicting artifact left to reconcile.

No blockers for 22-02.

---
*Phase: 22-expo-sdk-54-57-bump*
*Completed: 2026-08-05*

## Self-Check: PASSED

- FOUND: `.planning/phases/22-expo-sdk-54-57-bump/22-01-SUMMARY.md`
- FOUND: commit `75d1a808`
- FOUND: commit `965a22d5`
