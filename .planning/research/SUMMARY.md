# Project Research Summary

**Project:** PatelRep Mobile — Hotel Staff Mobile App (Expo SDK 51)
**Domain:** React Native offline-first field staff app (housekeeping + engineering roles)
**Researched:** 2026-03-20
**Confidence:** HIGH

## Executive Summary

PatelRep Mobile is a field-staff operations app for hotel housekeepers and engineers at independent Texas hotels (~80 rooms). The app is built on a correctly-scaffolded Expo SDK 51 managed workflow with FastAPI backend, Supabase auth, expo-sqlite offline storage, and Expo Push Notifications. The single most important characteristic of this domain is that hotel floors and back-of-house areas have unreliable Wi-Fi — every user interaction must work offline-first, with writes to SQLite occurring before any network call is attempted. Competitors (Quore, HotSOS, Alice) do not explicitly document offline support; this is a genuine differentiator that the existing scaffold already anticipates via its sync queue pattern.

The recommended approach is to treat the mobile app as a thin shell over two well-defined workflows: housekeepers updating room status (DIRTY → IN_PROGRESS → CLEAN) and engineers managing work orders (claim → resolve + note). Both workflows must work offline, and both need push notifications to replace radio chatter. The scaffold is structurally sound but has several critical placeholders and missing wiring that must be resolved before any real device testing is possible: a hardcoded `YOUR_EXPO_PROJECT_ID` in `notifications.ts`, missing AppState listener for Supabase token refresh, no `buildType: "apk"` in the EAS preview profile, and an unfinished sync queue that never increments the `attempts` counter.

The key risk is time lost to deferred wiring that looks complete in the scaffold but is not functional. Push notifications require a physical device with an EAS development build — Expo Go will mask all issues. The sync queue will appear to work in development but will silently accumulate permanent failures in production without an attempt limit and dead-letter logic. All critical fixes are low-complexity JS-only changes; none require native module additions or architectural reversals. The recommended build order front-loads these fixes in Phase 1 so that Phases 2 and 3 build on a solid foundation.

---

## Key Findings

### Recommended Stack

The scaffold is already on the correct stack for Expo SDK 51. No version changes or library swaps are recommended. The work is completion and bug fixes, not technology choices.

**Core technologies:**
- `expo ~51.0.0` / `react-native 0.74.2`: Managed workflow runtime — SDK 51 is the last LTS-stable before SDK 52's breaking SQLite changes; do not upgrade independently
- `expo-router ~3.5.16`: File-based navigation — v3 changed `router.push()` to always add a stack entry; use `router.replace()` for auth redirects
- `expo-sqlite ~14.0.6`: Offline SQLite cache — async API correctly used throughout; `work_orders` sync refresh function is missing and must be added
- `@supabase/supabase-js ^2.43.4`: Auth + session persistence via AsyncStorage — correct choice for SDK 51; SecureStore is unsuitable due to 2048-byte key limit
- `expo-notifications ~0.28.8`: Push tokens and foreground handlers — correct setup except for hardcoded `YOUR_EXPO_PROJECT_ID` placeholder which blocks all push functionality
- `zustand ^4.5.4`: Global state (`appStore` for auth/network/rooms; `workOrderStore` to be created) — correct for React Native, no Suspense dependency issues
- EAS Build (managed workflow): `preview` profile missing `android.buildType: "apk"` — will produce unusable AAB for pilot sideload without this fix

**Critical version constraints:**
- Do not mix SDK 51 with RN 0.75+ — the SDK pins the RN version
- `expo-router ~3.5.x` is SDK 51's correct minor; Router 4.x requires SDK 52+
- `expo-notifications ~0.28.x` is SDK 51-pinned; 0.29+ targets SDK 52

### Expected Features

Competitor analysis (Quore Cleanings Plus, HotSOS Mobile, Alice/Actabl, HelloShift, Snapfix, hotelkit) establishes a clear table-stakes set. The most important research insight is that **offline support is a genuine differentiator** — no major competitor explicitly documents it, yet hotel floor connectivity makes it a hard requirement.

**Must have (table stakes for pilot launch):**
- Housekeeper room list scoped to assigned rooms, with SQLite fallback when offline
- Room status update (DIRTY → IN_PROGRESS → CLEAN): < 3 taps, optimistic update, offline-queued
- Offline sync queue that flushes on reconnect — highest-complexity must-have; existing scaffold is the right foundation but needs hardening
- Push notification when room assigned to housekeeper — replaces radio chatter (Quore's "breakout push")
- Report issue from room — every competitor supports this; creates a work order with room context pre-filled
- Engineer work order list (open / in_progress / done tabs) — standard 3-tab pattern across HotSOS and Alice
- Claim work order (OPEN → IN_PROGRESS, one tap) and update to DONE with resolution note
- Push notification when work order assigned to engineer
- Login end-to-end on device (magic link deep link + password)
- DND flag prominently visible on room card
- Offline banner persistent across all screens
- EN/ES language toggle, persistent — key differentiator for Texas market; no major competitor offers meaningful i18n

**Should have (competitive differentiators, v1.x):**
- Risk badge (HIGH only) and ETA on room card — no competitor surfaces AI predictions on mobile; ETAs and risk come from the same prediction payload already generated by the backend, making this low-effort
- Sync badge showing last-synced timestamp — builds staff trust in spotty-Wi-Fi environments
- Photo attachment on work order / issue report (Snapfix built its brand on this; medium complexity)
- "My Shifts" read-only screen — once core sync is solid

**Defer (v2+):**
- Inspection workflow on mobile — full sub-app (checklists, photo, supervisor sign-off); web-only for pilot
- AI Copilot chat — requires reliable network, staffs' mental bandwidth on the floor is limited; stub screen stays but feature is deferred
- Minibar / linen logging — requires inventory database and PMS folio write-back
- Lost & found module — photo, categorization, guest matching chain
- Biometric login — shared-device scenarios make biometrics unreliable; post-pilot polish

### Architecture Approach

The architecture follows a strict layered pattern: screens read from Zustand stores, stores are populated by API calls and SQLite dual-writes, and all domain mutations go through FastAPI (not directly to Supabase). The two legitimate exceptions to the API-first rule are `supabase.auth.onAuthStateChange` (auth bootstrap) and `user_profiles.expo_push_token` (direct Supabase write) — both are intentional and documented. The single most important architectural invariant is that `syncOnConnect()` is called exclusively from the root layout's NetInfo listener; screens must not call it directly to avoid race conditions.

**Major components:**
1. `app/_layout.tsx` (root): Auth state listener, NetInfo listener, push setup, sync trigger on reconnect — single orchestrator for all global lifecycle events
2. `lib/offline/db.ts` + `lib/offline/sync.ts`: SQLite schema + CRUD and queue flush — ground truth for offline state; screens must never call `db.ts` mutations directly
3. `stores/appStore.ts` + `stores/workOrderStore.ts` (to create): Zustand UI state — appStore stays lean (auth + network + rooms); work orders get their own store to avoid monolithic re-renders
4. `lib/api/rooms.ts` + `lib/api/workOrders.ts` (to create): Typed domain API wrappers over `client.ts` — all screens import typed functions, not the raw api object
5. `lib/notifications.ts`: Push token registration at login — idempotent; called from root layout after `SIGNED_IN` event

**Key patterns (all verified against codebase):**
- **Offline-first mutation:** SQLite write → optimistic UI → enqueue → attempt API if online → delete queue item on success
- **Auth token flow:** Supabase JWT with `hotel_id` + `role` custom claims → Bearer token on every FastAPI call via `client.ts`
- **Role-based navigation:** `getTabsForRole(role)` in `(app)/_layout.tsx` — tab bar is UX-only gating; API enforces role security
- **NetInfo-driven sync:** Single listener in root layout; `isOnline` in appStore; work orders must be extended to use this pattern (currently fetch-on-mount only)

### Critical Pitfalls

1. **Hardcoded `YOUR_EXPO_PROJECT_ID` in `notifications.ts`** — replace with `Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId` before any push work begins; all push functionality silently fails without this fix (Phase 1)

2. **No retry limit or attempt counter in `sync.ts`** — the `attempts` column exists in `sync_queue` but is never incremented; permanent failures retry forever, stale status updates replay hours later overwriting newer state; distinguish 4xx (delete immediately) from network errors (retry with backoff, max 5 attempts) (Phase 2)

3. **Supabase JWT expiry with no 401 recovery in `api/client.ts`** — iOS/Android OS can kill background JS timers that drive `autoRefreshToken`; staff backgrounding the app during a shift hit 401s on resume with no recovery path; implement retry-on-401 with one `refreshSession()` attempt before signing out (Phase 1)

4. **Auth hydration race condition** — `appStore` initializes with `user: null` synchronously; root layout redirects to login before AsyncStorage resolves, causing a login flash on every cold open; add `isHydrating: true` state and gate all redirects on hydration completion; use `SplashScreen.preventAutoHideAsync()` (Phase 1)

5. **EAS `preview` profile produces AAB, not APK** — pilot Android staff cannot install an AAB sideload; add `"android": { "buildType": "apk" }` to the preview profile in `eas.json` (Phase 3); also: all `YOUR_SUPABASE_URL` / `YOUR_SUPABASE_ANON_KEY` values in `eas.json` are placeholders that must be replaced with EAS secrets before any real build

---

## Implications for Roadmap

Based on combined research, the scaffolded codebase needs completion in three natural phases that mirror the dependency graph. Phases should not be reordered — each phase's fixes are prerequisites for the next phase's features.

### Phase 1: Foundation Fixes + Auth + Push Wiring

**Rationale:** Three critical blockers (hardcoded projectId, auth hydration race, 401 no-recovery) will cause every subsequent test to produce misleading results. These must be resolved first, before a single feature is built, because they affect every screen. Push notification wiring is also here because the Expo push token infrastructure (`notifications.ts` fix + EAS dev build) must be verified on a physical device before any notification-dependent features are considered done.

**Delivers:** A working app baseline — authenticated sessions survive backgrounds, push tokens register correctly, no login flash on cold open, API calls recover from JWT expiry without user intervention.

**Addresses (from FEATURES.md):** Login end-to-end on device (magic link deep link + password), offline banner on all screens.

**Avoids (from PITFALLS.md):**
- Pitfall 1: Hardcoded projectId — fix in `notifications.ts`
- Pitfall 6: JWT expiry / 401 no recovery — add retry-on-401 in `api/client.ts`
- Pitfall 7: Auth hydration race — add `isHydrating` guard + SplashScreen hold

**Stack requirements:** `expo-constants` for projectId resolution, `AppState` listener for Supabase token refresh, `SplashScreen` API for hydration gating.

**Research flag:** Standard patterns — well-documented in official Expo and Supabase docs; no additional research phase needed.

---

### Phase 2: Housekeeper Workflow (Room Status + Offline Sync Hardening)

**Rationale:** The housekeeper room list and status update workflow are the core value proposition for the pilot hotel. The offline sync must be hardened in this phase (not deferred) because unreliable Wi-Fi is guaranteed in the hotel environment — deploying without attempt limits exposes the pilot to room status "jumping back" and queue overflow during full shifts. Architecture research establishes that `workOrderStore` and `lib/api/rooms.ts` must exist before the room detail screen can be wired.

**Delivers:** Housekeepers can see their assigned rooms, update status with optimistic UI, and have updates reliably sync when connectivity is restored. DND flags are visible. Sync queue is production-safe.

**Addresses (from FEATURES.md):**
- Housekeeper room list (real API data + SQLite fallback)
- Room status update (DIRTY → IN_PROGRESS → CLEAN, < 3 taps, offline-queued)
- Offline sync queue with flush-on-reconnect
- DND flag prominently visible on room card
- Offline banner consistent on all screens

**Avoids (from PITFALLS.md):**
- Pitfall 3: No retry/attempt-limit in sync queue — increment `attempts`, add max-retry, distinguish 4xx vs network errors
- Pitfall 4: NetInfo false positive on hotel Wi-Fi — use `isInternetReachable`, add 10s API timeout, lightweight health-check ping before queue flush

**Creates:** `lib/api/rooms.ts` (typed domain wrappers), `stores/workOrderStore.ts` (structure only — work orders come in Phase 3), `refreshWorkOrders()` in `sync.ts` mirroring `refreshRooms()`.

**Research flag:** Standard patterns — offline-first mutation pattern is well-documented and already established in the codebase. No additional research phase needed.

---

### Phase 3: Engineer Workflow + Push Notifications End-to-End

**Rationale:** Engineer work orders share the same offline infrastructure built in Phase 2. Once the sync queue is hardened and the room pattern is working, the work order pattern is a direct application of the same architecture. Push notifications go here (not Phase 1) because the token wiring was fixed in Phase 1, but actual notification delivery requires the FastAPI assignment endpoints to call the Expo Push API — which requires the work order and room assignment flows to exist first.

**Delivers:** Engineers can claim and resolve work orders. Housekeepers can report issues from rooms. Both roles receive push notifications on assignment. EAS build is configured for pilot distribution (APK sideload + TestFlight internal).

**Addresses (from FEATURES.md):**
- Engineer work order list (open / in_progress / done) with real API data
- Claim work order (one tap, OPEN → IN_PROGRESS)
- Update WO to DONE with resolution note
- Report issue from room (housekeeper creates WO)
- Push notification when room assigned to housekeeper
- Push notification when WO assigned to engineer
- EN/ES language toggle, persistent

**Avoids (from PITFALLS.md):**
- Pitfall 2: iOS simulator cannot receive APNs — all push delivery tests on physical device via EAS internal distribution
- Pitfall 5: EAS APK buildType — add `"android": { "buildType": "apk" }` to preview profile; replace all `YOUR_` placeholder values in `eas.json` with EAS secrets; verify `google-services.json` exists for FCM

**Creates:** `lib/api/workOrders.ts`, `app/(app)/work-orders/[woId].tsx` (full implementation), FastAPI assignment notification calls (reads `expo_push_token` from `user_profiles`), report-issue form on room detail screen.

**Research flag:** Push notification deep linking (tap notification → navigate to specific room or WO when app is killed) needs attention — verified as a known gotcha in PITFALLS.md; `lastNotificationResponse` listener must be wired in root layout. Standard pattern but easy to miss.

---

### Phase 4: Differentiators + Pilot Polish (v1.x)

**Rationale:** After the pilot hotel validates core workflows, the low-effort differentiators from FEATURES.md can be enabled. ETA and risk badge are the highest-value items here — the predictions backend already generates this data, and the room card scaffold already renders `risk_level`; it is purely UI hookup work. Photo attachments are medium-complexity and should be triggered by pilot feedback rather than built speculatively.

**Delivers:** AI-sourced ETA and risk badge on room cards, sync badge ("Saved 2 min ago"), photo attachment on issue reports, language defaults to device locale on first launch.

**Addresses (from FEATURES.md):**
- ETA and risk badge on room card (v1.x differentiator)
- Sync badge showing last-synced timestamp
- Photo attachment on WO / issue (trigger: pilot hotel reports photos reduce back-and-forth)
- Language auto-detect from `expo-localization` on first launch

**Avoids (from PITFALLS.md):**
- Push token stored without expiry — clear `expo_push_token` when staff member is deactivated via web dashboard
- `EXPO_PUBLIC_` prefix audit — ensure no secrets accidentally use the public prefix

**Research flag:** Photo attachments require Supabase Storage bucket configuration and a WO attachment endpoint on FastAPI (not yet built). A brief research pass on Supabase Storage + `expo-image-picker` integration is recommended before implementation.

---

### Phase Ordering Rationale

- **Phase 1 must be first:** The auth hydration race and push token placeholder affect every screen and test. Building features on top of broken auth produces misleading test results and compounds debugging time.
- **Phase 2 before Phase 3:** Work order sync is architecturally identical to room sync; hardening the pattern once in Phase 2 makes Phase 3 a straightforward application. Building work orders before the room pattern is solid risks duplicating the same sync bugs.
- **Phase 3 before Phase 4:** Push notifications require both assignment workflows to exist (rooms in Phase 2, work orders in Phase 3). EAS build configuration must be validated before distributing to the pilot hotel.
- **Phase 4 is additive:** All Phase 4 features are enhancements with no downstream dependencies. They can be delivered in any order based on pilot hotel feedback.

### Research Flags

Phases needing deeper research during planning:
- **Phase 3 (push deep linking):** The `lastNotificationResponse` listener behavior when the app is killed vs backgrounded has platform-specific quirks documented in PITFALLS.md. Verify the correct Expo Router navigation target for both states before implementing.
- **Phase 4 (photo attachments):** Requires Supabase Storage bucket setup + `expo-image-picker` integration + new FastAPI endpoint. Brief research pass recommended before implementation.

Phases with standard patterns (skip research-phase):
- **Phase 1:** Auth hydration fix, AppState listener, 401 retry — all patterns are in official Expo and Supabase docs with code examples.
- **Phase 2:** Offline-first mutation pattern is fully specified in ARCHITECTURE.md with working code examples. Sync queue hardening is well-understood.
- **Phase 3 (work orders, not push):** Direct application of Phase 2 room pattern to work orders — identical architecture, no research needed.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against official Expo SDK 51 docs; critical incompatibilities (Router 4.x requires SDK 52, deprecated sync SQLite API) explicitly documented |
| Features | HIGH | Competitor analysis covers 7 products; table-stakes features are consistent across all; i18n differentiator validated for Texas market; anti-features well-reasoned |
| Architecture | HIGH | Based on direct codebase analysis of the scaffolded files; all patterns verified against official docs; component boundaries match established Expo SDK 51 conventions |
| Pitfalls | HIGH | Critical pitfalls verified against official docs and live GitHub issues; code-specific pitfalls verified against actual scaffolded files with line-level precision |

**Overall confidence:** HIGH

### Gaps to Address

- **`google-services.json` missing:** `app.json` references this file for FCM but it does not exist in the repo. Must be generated from the Firebase console and added as an EAS secret before Phase 3 Android push testing. Low risk, low effort — flag before Phase 3 begins.
- **`push_tokens` table strategy:** FEATURES.md notes that tokens must be re-upserted on every login in case they rotate. PITFALLS.md flags that the current `savePushTokenToProfile` writes directly to Supabase bypassing the API. The recommended resolution is to add a `PATCH /staff/me/push-token` endpoint on FastAPI — this should be clarified in Phase 3 planning before implementation begins.
- **Work order offline scope:** Architecture research notes that `sync.ts` handles `room_status` updates but `work_order` status mutations are not included. The `work_orders` SQLite table exists in `db.ts` but `refreshWorkOrders()` has not been added to `sync.ts`. This gap must be explicitly tracked in Phase 2/3 planning.
- **Notification deep link navigation:** The exact Expo Router navigation pattern for push tap → correct screen when the app is killed (vs backgrounded) is noted as a gotcha but not fully specified. This needs a brief verification pass before Phase 3 implementation.

---

## Sources

### Primary (HIGH confidence)
- [Expo Router v3 Changelog](https://expo.dev/changelog/2024-01-23-router-3) — `router.push` behavior, babel plugin removal
- [Expo Router Authentication](https://docs.expo.dev/router/advanced/authentication-rewrites/) — `<Redirect>` pattern, hydration guard
- [Expo Push Notifications Setup](https://docs.expo.dev/push-notifications/push-notifications-setup/) — `Constants.expoConfig?.extra?.eas?.projectId` pattern
- [Expo SQLite v14 Docs](https://docs.expo.dev/versions/latest/sdk/sqlite/) — `openDatabaseAsync`, async API
- [EAS Build APK Reference](https://docs.expo.dev/build-reference/apk/) — `buildType: "apk"` for sideload
- [EAS Build eas.json Reference](https://docs.expo.dev/build/eas-json/) — profile structure, `distribution: "internal"`
- [Supabase React Native Quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/expo-react-native) — AsyncStorage adapter, AppState listener
- [Supabase auth-startautorefresh reference](https://supabase.com/docs/reference/javascript/auth-startautorefresh) — AppState + `startAutoRefresh`/`stopAutoRefresh`
- [@react-native-community/netinfo docs](https://docs.expo.dev/versions/latest/sdk/netinfo/) — `isConnected` vs `isInternetReachable`
- Direct codebase analysis: `apps/mobile/` (2026-03-19/20) — all scaffolded files verified

### Secondary (MEDIUM confidence)
- [Quore Cleanings Plus](https://www.quore.com/product-premium/cleanings-plus) — competitor feature analysis
- [HotSOS Mobile — Amadeus](https://www.amadeus-hospitality.com/service-optimization-software/hotsos/) — engineer WO workflow patterns
- [Alice/Actabl on Hotel Tech Report](https://hoteltechreport.com/operations/housekeeping-software/alice-housekeeping) — push and assignment patterns
- [HelloShift housekeeping](https://www.helloshift.com/housekeeping-management) — issue reporting from rooms
- [Expo offline-first guide](https://docs.expo.dev/guides/local-first/) — SQLite + sync queue patterns
- [expo-notifications GitHub issue #23225](https://github.com/expo/expo/issues/23225) — "No projectId found" error
- [Supabase autoRefreshToken issue](https://github.com/supabase/auth-js/issues/563) — background timer killed by OS

### Tertiary (LOW confidence)
- [Xenia: Best hotel housekeeping apps 2025](https://www.xenia.team/articles/free-hotel-housekeeping-app) — aggregator, competitor feature coverage only
- [Altexsoft: Housekeeping software features](https://www.altexsoft.com/blog/housekeeping-management-software/) — general domain context

---
*Research completed: 2026-03-20*
*Ready for roadmap: yes*
