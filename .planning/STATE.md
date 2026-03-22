---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: "Checkpoint: 03-05 Task 2 human-action — eas init, google-services.json, FCM credentials needed"
last_updated: "2026-03-22T03:29:00.845Z"
last_activity: "2026-03-21 — Plan 02-01 complete: extended my-rooms select (vip_flag/ETA/risk) + fire-and-forget assignment push"
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 20
  completed_plans: 19
  percent: 45
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-19)

**Core value:** A housekeeper opens the app, sees their rooms, marks them clean, and reports issues — in under 30 seconds per room, even with spotty Wi-Fi.
**Current focus:** Phase 2 — Housekeeper Workflow

## Current Position

Phase: 2 of 4 (Housekeeper Workflow) — IN PROGRESS
Plan: 1 of 7 in current phase — plan 01 done, plan 02 next
Status: In progress
Last activity: 2026-03-21 — Plan 02-01 complete: extended my-rooms select (vip_flag/ETA/risk) + fire-and-forget assignment push

Progress: [████░░░░░░] 45%

## Performance Metrics

**Velocity:**
- Total plans completed: 2
- Average duration: 22 min
- Total execution time: 0.7 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 2/4 | 44 min | 22 min |

**Recent Trend:**
- Last 5 plans: 01-01 (setup), 01-02 (infra fixes)
- Trend: On track

*Updated after each plan completion*
| Phase 01-foundation P01 | 8min | 2 tasks | 6 files |
| Phase 01-foundation P03 | 4min | 2 tasks | 5 files |
| Phase 01-foundation P04 | 10 | 2 tasks | 2 files |
| Phase 02-housekeeper-workflow P02 | 5 | 1 tasks | 2 files |
| Phase 02-housekeeper-workflow P00 | 2 | 2 tasks | 2 files |
| Phase 02-housekeeper-workflow P04 | 2 | 2 tasks | 3 files |
| Phase 02-housekeeper-workflow P03 | 4 | 2 tasks | 4 files |
| Phase 02-housekeeper-workflow P05 | 5 | 2 tasks | 2 files |
| Phase 02-housekeeper-workflow P06 | 1 | 1 tasks | 0 files |
| Phase 02-housekeeper-workflow P06 | 20 | 2 tasks | 0 files |
| Phase 02-housekeeper-workflow P07 | 3 | 1 tasks | 1 files |
| Phase 02-housekeeper-workflow P08 | 2 | 2 tasks | 3 files |
| Phase 03-engineer-workflow-push-eas P00 | 3 | 2 tasks | 5 files |
| Phase 03-engineer-workflow-push-eas P03 | 2 | 2 tasks | 2 files |
| Phase 03-engineer-workflow-push-eas P04 | 2 | 2 tasks | 3 files |
| Phase 03-engineer-workflow-push-eas P02 | 8 | 2 tasks | 3 files |
| Phase 03-engineer-workflow-push-eas P01 | 4 | 2 tasks | 5 files |
| Phase 03-engineer-workflow-push-eas P05 | 2 | 1 tasks | 1 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Phase 1 front-loads all auth + infrastructure fixes — hardcoded projectId, 401 no-recovery, and auth hydration race must be resolved before any feature work produces honest test results
- [Roadmap]: Phase 4 has no new v1 requirements — it activates differentiators (ETA, risk badge, sync badge, locale auto-detect) that depend on backend data already flowing
- [01-02]: isLoading defaults to true — auth state is unresolved at store init, must be true until session check completes
- [01-02]: AppState.addEventListener at module scope, no cleanup — intentionally permanent for app lifetime
- [01-02]: isRetry is internal to request(), not on api export — callers see zero API change
- [01-02]: jest.config.js uses modulePaths for monorepo: jest-expo hoisted to root, react-native in workspace
- [Phase 01-foundation]: jest-expo@51 installed locally in apps/mobile to override monorepo-hoisted v55 — SDK 51 compatibility + react-native preset resolution
- [Phase 01-foundation]: SplashScreen.preventAutoHideAsync at module scope — must run before React mounts; setIsLoading(false) fires on every onAuthStateChange including initial hydration
- [Phase 01-foundation]: React pinned to root node_modules in jest.config.js to eliminate two-React-copy Invalid hook call error in component tests
- [Phase 01-foundation]: expo-splash-screen installed at ~0.27.0 to match SDK 51 compatibility range
- [Phase 01-foundation]: redirectSystemPath converts # to ? so Expo Router 3.5 can parse Supabase magic link tokens as query params
- [Phase 01-foundation]: callback.tsx delegates redirect to onAuthStateChange — no router.replace on success to avoid session/navigation race condition
- [Phase 02-housekeeper-workflow]: i18n-first: translation keys added before components to prevent silent blank text in t() calls
- [Phase 02-housekeeper-workflow]: checkinTime uses {{time}} interpolation matching react-i18next call pattern
- [02-01]: asyncio.create_task chosen for fire-and-forget push dispatch — already in async FastAPI route, no BackgroundTasks overhead needed
- [02-01]: Explicit column list replaces wildcard select on room_status — PostgREST wildcard doesn't reliably propagate vip_flag/risk_level/predicted_ready_at through joins
- [Phase 02-housekeeper-workflow]: Wave 0 TDD stubs: sync.test.ts and ReportIssueModal.test.tsx created in RED state before implementations — Nyquist compliance for HK-04 and HK-06
- [Phase 02-housekeeper-workflow]: Submit button uses literal 'Submit' text matching test assertion getByText(/submit/i)
- [Phase 02-housekeeper-workflow]: work_order/create added to flushSyncQueue: missing handler discovered via TDD RED test, fixed inline per Rule 1
- [Phase 02-housekeeper-workflow]: index.tsx api.get response unwrap: same { data: Room[] } envelope bug as sync.ts fixed during Task 2
- [Phase 02-housekeeper-workflow]: Alert.alert removed from offline status update path: OfflineBanner in layout already communicates offline state
- [Phase 02-housekeeper-workflow]: Silent catch on hotel name fetch — display-only, failure should not interrupt profile screen
- [Phase 02-housekeeper-workflow]: Push token registration returns null + console.warn when EAS projectId missing — correct Phase 2 behavior before EAS project setup
- [Phase 02-housekeeper-workflow]: API import check via AST syntax parsing is sufficient when .env not present locally — pydantic-settings validation at module init is expected in dev without env
- [Phase 02-housekeeper-workflow]: Human approval received: all 6 verification criteria (SC-1 through SC-6) confirmed passing on device/simulator — Phase 2 complete
- [Phase 02-housekeeper-workflow]: myRooms.find() in useEffect with [roomId, myRooms] deps — re-runs on background sync refresh
- [Phase 02-housekeeper-workflow]: Online PATCH path uses optimistic { ...room, status: newStatus } — avoids { data: Room } unwrap, matches offline path
- [Phase 02-housekeeper-workflow]: rooms.submit key placed after checkinTime in both locale files — consistent with existing ordering pattern in the rooms namespace
- [Phase 03-engineer-workflow-push-eas]: Wave 0 TDD stubs committed in RED state before any Phase 3 implementation — sync claim/complete handlers, notifications API path, WO detail testID, WO list offline enqueue, ENG-06 push helper
- [Phase 03-engineer-workflow-push-eas]: WorkOrdersList test 3 and test_wo_push.py are minimal RED stubs — test 3 will turn GREEN in 03-02, test_wo_push.py real assertion added in 03-01
- [Phase 03-engineer-workflow-push-eas]: api.patch used for push token registration — API endpoint reads user from JWT, no supabase.auth.getUser() needed in mobile client
- [Phase 03-engineer-workflow-push-eas]: Dual-path notification handler: killed-app uses getLastNotificationResponseAsync() on mount; backgrounded uses addNotificationResponseReceivedListener
- [Phase 03-engineer-workflow-push-eas]: STATUS_COLORS constant mirrors PRIORITY_COLORS pattern — consistent color map approach in WO screen; t() second arg item.status used as fallback for unmapped status keys
- [Phase 03-engineer-workflow-push-eas]: work_order/claim flushSyncQueue handler sends empty body {} — claim endpoint takes no payload, consistent with API contract
- [Phase 03-engineer-workflow-push-eas]: Offline complete path omits photo_urls from enqueueAction — photos require Supabase storage upload which is itself network-dependent; deferred to online path only
- [Phase 03-01]: test_wo_push.py uses sys.modules mock to stub core.database at import time — avoids real Supabase init in unit tests without full env
- [Phase 03-01]: PATCH /staff/me/push-token uses get_current_user (not require_role) — all roles register push tokens
- [Phase 03-01]: All Expo push data payloads include url field for deep link navigation (/(app)/work-orders/{wo_id} and /(app)/my-rooms/{room_id})
- [Phase 03-engineer-workflow-push-eas]: android.buildType: apk chosen for EAS preview profile — APK sideloads without Play Store, correct for single-hotel pilot distribution

### Pending Todos

None yet.

### Blockers/Concerns

- [Pre-Phase 3]: `google-services.json` is missing from the repo — must be generated from Firebase console and added as an EAS secret before Android push testing
- [Pre-Phase 3]: Push token currently written directly to Supabase bypassing the API — plan must decide whether to add `PATCH /staff/me/push-token` endpoint or keep the direct write (INFRA-02 implementation detail)
- [Pre-Phase 3]: `lastNotificationResponse` behavior when app is killed (vs backgrounded) has platform-specific quirks — verify Expo Router navigation target before implementing push deep links

## Session Continuity

Last session: 2026-03-22T03:29:00.842Z
Stopped at: Checkpoint: 03-05 Task 2 human-action — eas init, google-services.json, FCM credentials needed
Resume file: None
