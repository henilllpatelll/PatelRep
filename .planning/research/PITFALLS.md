# Pitfalls Research

**Domain:** React Native Expo SDK 51 — hotel staff mobile app (housekeepers + engineers)
**Researched:** 2026-03-19
**Confidence:** HIGH (critical pitfalls verified against official Expo docs and live GitHub issues; code-specific pitfalls verified against actual scaffolded files)

---

## Critical Pitfalls

### Pitfall 1: Hardcoded Placeholder projectId in getExpoPushTokenAsync

**What goes wrong:**
`notifications.ts` line 35 contains `projectId: "YOUR_EXPO_PROJECT_ID"` — a literal placeholder. When this runs on a real device, `getExpoPushTokenAsync` will either throw `Error: No 'projectId' found` or return a token scoped to the wrong project. Push notifications silently fail to arrive, or tokens are registered against the wrong EAS project.

**Why it happens:**
The scaffold was generated before the EAS project was linked. Developers often test in Expo Go (where projectId is inferred from the running Expo account) and miss that the production path needs an explicit value.

**How to avoid:**
Replace the hardcoded string with dynamic resolution using `expo-constants`:
```ts
import Constants from "expo-constants";
const projectId =
  Constants?.expoConfig?.extra?.eas?.projectId ??
  Constants?.easConfig?.projectId;
```
This resolves the projectId from `app.json`'s `extra.eas.projectId` field, which EAS populates automatically on `eas build`. Do this before any push notification work begins — it is the first thing to wire.

**Warning signs:**
- `getExpoPushTokenAsync` throws at runtime on a physical device
- Push tokens are `null` even when permission is `granted`
- Tokens register fine in Expo Go development but fail in EAS builds

**Phase to address:** Phase 1 (Push Notification Wiring) — must be resolved before any push token registration is attempted on a physical device.

---

### Pitfall 2: Testing Push Notifications on iOS Simulator

**What goes wrong:**
iOS Simulator cannot receive APNs push notifications. `getExpoPushTokenAsync` will fail silently or return a device token that Expo Push Service cannot deliver to. All notification delivery tests on simulator return success from the send API yet nothing is received — leading to false confidence that the feature works.

**Why it happens:**
Developers build and test on simulator for speed. The Expo Push send API accepts the token and returns `{ status: "ok" }` even when the target is a simulator token, since it cannot know the device type at send time.

**How to avoid:**
- Use `getDevicePushTokenAsync` for raw APNs token testing — it throws immediately on simulator, making the constraint explicit.
- Use `scheduleNotificationAsync` (local notification) on simulator to verify client-side notification handler and UI.
- All end-to-end push tests must run on a physical iOS device via EAS internal distribution.
- For the pilot hotel, distribute via TestFlight internal testing (no App Store review needed for internal builds).

**Warning signs:**
- All notification tests passing in development but staff not receiving notifications in production
- No error thrown during token registration on simulator — Expo Go masks this

**Phase to address:** Phase 1 (Push Notification Wiring) — build EAS development client and test on physical device from day one.

---

### Pitfall 3: sync.ts Does Not Retry with Attempt Limit or Backoff

**What goes wrong:**
`flushSyncQueue` in `sync.ts` iterates through all pending items and catches errors with a `console.warn`, leaving failed items in the queue indefinitely. If a sync item fails permanently (e.g., the server rejects it as invalid), it will block the queue or be retried indefinitely. The `sync_queue` table has an `attempts` column but `sync.ts` never increments it or enforces a maximum retry limit.

**Why it happens:**
The scaffold was written to demonstrate the pattern without full error handling. The comment "increment attempts via separate update if needed" in `sync.ts` line 45 explicitly flags this as unfinished.

**How to avoid:**
- Increment `attempts` on each failure: `UPDATE sync_queue SET attempts = attempts + 1 WHERE id = ?`
- After N attempts (recommend 5), move the item to a dead-letter state or delete it and log to the API
- For transient network errors (no connectivity), leave in queue. For 4xx API errors (validation rejected), remove immediately — retrying will never succeed
- Distinguish error types: `response.status >= 400 && response.status < 500` = permanent failure, delete; `catch (NetworkError)` = transient, keep

**Warning signs:**
- Queue depth growing unboundedly over a shift
- Old stale status updates replaying hours later and overwriting newer server state
- Hotel staff seeing room status "jump back" after reconnecting

**Phase to address:** Phase 2 (Offline Sync Hardening) — implement before pilot deployment.

---

### Pitfall 4: NetInfo.isConnected Is Not a Reliable Proxy for API Reachability

**What goes wrong:**
`sync.ts` checks `state.isConnected` via NetInfo before flushing the queue. On hotel Wi-Fi, a device can be connected to the SSID (isConnected = true) but the captive portal is active, the AP is saturated, or the gateway is down. NetInfo returns `true`, the sync flush fires, all requests time out or return network errors, and the queue fills with failed attempts that are not retried with backoff.

**Why it happens:**
NetInfo reports Layer 2/3 connectivity (IP assigned), not Layer 7 reachability (can reach your API). This gap is particularly wide in hotels where Wi-Fi coverage is inconsistent across floors and staff roam constantly.

**How to avoid:**
- Wrap all API calls with a reasonable timeout (e.g., 10 seconds) so stuck requests fail fast rather than hanging
- Use `NetInfo.isInternetReachable` (checks actual internet connectivity, not just association) alongside `isConnected`
- Perform a lightweight health-check ping to the Railway API (`GET /health`) before flushing the full queue when reconnecting
- Implement exponential backoff in `flushSyncQueue` rather than a single pass

**Warning signs:**
- Sync queue flushing fires but all items fail silently
- Staff report status updates "not saving" on certain floors of the hotel
- App appears online (shows no offline banner) but API calls time out

**Phase to address:** Phase 2 (Offline Sync Hardening).

---

### Pitfall 5: EAS Build — android.buildType Not Set to "apk" for Pilot Sideload

**What goes wrong:**
The current `eas.json` does not define a `preview` profile with `android.buildType: "apk"`. EAS Build defaults to AAB (Android App Bundle) format, which cannot be directly installed on Android devices. For the pilot hotel using APK sideload (no Play Store), an AAB is unusable — staff cannot install it.

**Why it happens:**
AAB is the default for EAS because it is optimized for Play Store delivery. The `preview` profile exists in `eas.json` but is missing the `android.buildType` override.

**How to avoid:**
Add to `eas.json` preview profile:
```json
"preview": {
  "distribution": "internal",
  "android": {
    "buildType": "apk"
  }
}
```
For iOS, the `preview` profile with `distribution: "internal"` already produces an IPA for TestFlight internal distribution — no change needed there.

**Warning signs:**
- EAS build succeeds but downloaded file is `.aab` not `.apk`
- Android pilot staff cannot install the file from the download link

**Phase to address:** Phase 3 (EAS Build Setup) — verify before distributing to the pilot hotel.

---

### Pitfall 6: Supabase Session Not Propagated to API Client After Background Resume

**What goes wrong:**
`api/client.ts` calls `supabase.auth.getSession()` on every request to get the current access token. Supabase's `autoRefreshToken: true` (correctly set in `supabase.ts`) refreshes the token in the background. However, if the device was backgrounded for an extended period and the background refresh timer was killed by the OS (common on iOS with aggressive battery optimization), `getSession()` may return an expired token. The API returns 401, the error message is thrown as `Error: HTTP 401`, and the user is left looking at an error state with no recovery path.

**Why it happens:**
iOS and Android can terminate background processes including JavaScript timers. The Supabase auto-refresh relies on a JS timer interval. On mobile, unlike a browser, there is no guarantee the timer fires while backgrounded.

**How to avoid:**
- In `getAuthHeader`, call `supabase.auth.getSession()` and check if `session.expires_at` is within 60 seconds of expiry; if so, call `supabase.auth.refreshSession()` before the request
- Add a global 401 handler in `api/client.ts`: on HTTP 401, attempt one `refreshSession()` then retry the original request once; if the retry also 401s, sign the user out and navigate to login
- Register an `AppState` change listener: when the app returns to `active` from `background`, call `supabase.auth.getSession()` proactively to trigger a refresh

**Warning signs:**
- Staff report being "kicked out" of the app after leaving it idle overnight
- API calls fail after the app resumes from background with error messages showing 401
- Supabase JWT expiration default is 1 hour — any shift longer than an hour with background time will hit this

**Phase to address:** Phase 1 (Auth + API Layer) — must be wired before any screen uses real API data.

---

### Pitfall 7: Expo Router Authentication Redirect Race Condition

**What goes wrong:**
If the app's root layout (`_layout.tsx`) renders before the auth state is resolved (user + session loaded from AsyncStorage), it will redirect unauthenticated users to the login screen for a split second — then redirect again to the dashboard if they are actually authenticated. Staff see a flash of the login screen on every app open. Worse, if the redirect happens before AsyncStorage resolves, protected screens briefly render with no session context, potentially firing API calls with null tokens.

**Why it happens:**
AsyncStorage reads are async. The Zustand `appStore` initializes with `user: null` synchronously, so any layout that gates on `user !== null` sees a false negative on first render.

**How to avoid:**
- Add a loading state to `appStore`: `isHydrating: true` until the Supabase `onAuthStateChange` fires for the first time
- In the root layout, render a full-screen splash/loader while `isHydrating` is true — do not redirect until hydration completes
- Use Expo Router's `SplashScreen.preventAutoHideAsync()` and only call `SplashScreen.hideAsync()` after hydration completes

**Warning signs:**
- White flash or brief login screen visible on app open when already logged in
- `getAuthHeader` throwing "Not authenticated" on the first API call despite user being logged in
- Auth-gated screens sometimes render momentarily before the redirect fires

**Phase to address:** Phase 1 (Auth + Navigation) — foundational to all other screens.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `savePushTokenToProfile` writes directly to Supabase (not the FastAPI) | Simpler scaffolding | Bypasses the API auth layer; if RLS changes or the API adds token validation logic, this call is invisible to it | Never — send the token via `PATCH /profile` on the FastAPI instead |
| No attempt counter on sync_queue failures | Simple retry loop | Queue grows stale; permanent failures retry forever; queue never drains cleanly | Never in production — implement attempt limit before pilot |
| `YOUR_EXPO_PROJECT_ID` placeholder in notifications.ts | Fast scaffold | Silent push failure in any EAS build | Never — replace in Phase 1 |
| eas.json env vars hardcoded as `YOUR_SUPABASE_URL` placeholders | Simple template | EAS builds fail silently or use wrong endpoints | Never — use EAS secrets or `.env` injection before first real build |
| `console.warn` as only error handling in sync.ts | Faster development | No observability in production; errors invisible to operator | Only during development, must be replaced before pilot |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Expo Push (APNs) | Testing token registration and delivery end-to-end in Expo Go | Use EAS development build on a physical iOS device; Expo Go uses shared credentials that can mask token-scoping issues |
| Expo Push (FCM) | Missing `google-services.json` at build time (file is referenced in `app.json` but not committed) | Add `google-services.json` as an EAS secret or commit it (it does not contain sensitive keys beyond project ID); confirm it exists before `eas build` |
| Supabase Auth (mobile) | Calling `supabase.auth.getUser()` for push token save without checking if session is valid first | Always check `session !== null` before any Supabase call from mobile; `getUser()` makes a network request and will fail offline |
| NetInfo | Using `isConnected` alone to decide to sync | Use `isInternetReachable` AND add a timeout; `isConnected` is true on hotel Wi-Fi with a dead gateway |
| FastAPI JWT middleware | API returns 401 when Supabase JWT has expired and client did not refresh before the request | Implement the retry-on-401 pattern in `api/client.ts` as described in Pitfall 6 |
| EAS Build secrets | Leaving `YOUR_SUPABASE_URL` / `YOUR_SUPABASE_ANON_KEY` as literal strings in `eas.json` | Use `eas secret:create` to store values per-environment; reference as `$EXPO_PUBLIC_SUPABASE_URL` in `eas.json` env block |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `SELECT * FROM rooms ORDER BY floor, room_number` with no index on `floor` | Room list loads slowly as SQLite table grows | Add `CREATE INDEX IF NOT EXISTS idx_rooms_floor ON rooms(floor)` in `initSchema` | At ~80 rooms (pilot size) this is fine; becomes noticeable above ~500 rooms if the hotel chain expands |
| Sync queue limit of 50 items (`LIMIT 50` in `getPendingSyncQueue`) with no pagination loop | If >50 items queue up during a long offline period, the excess items are never flushed in one sync pass | Process in pages: loop until `getPendingSyncQueue` returns empty | During a full shift offline (unusual but possible), a housekeeper doing 40+ rooms could exceed 50 queued writes |
| `withTransactionAsync` wrapping the full room upsert in a single transaction | Holds a write lock for the entire array insert; UI reads block | Acceptable for ~80 rooms; batch in groups of 20 if hotel size grows | Fine for pilot; revisit if hotel has >200 rooms |
| No debounce on status update button | Housekeeper double-taps → two status updates queued → server-side transition validation rejects the second → confusing error toast | Add a `disabled` state on the update button for 1-2 seconds after tap | Happens at any scale; fix before pilot |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| `savePushTokenToProfile` calls Supabase directly with the anon key — any user can write to `user_profiles.expo_push_token` for any row if RLS is misconfigured | A housekeeper could overwrite another housekeeper's push token, redirecting their notifications | Route through `PATCH /staff/me/push-token` on the FastAPI which enforces JWT `user_id` claim; never allow mobile to write to Supabase directly except via auth |
| `EXPO_PUBLIC_` prefix makes all env vars visible in the JS bundle | Anon key and API URL are intentionally public, but if a secret is accidentally given an `EXPO_PUBLIC_` prefix it is exposed in the binary | Audit every env var name before an EAS build; secrets with no `EXPO_PUBLIC_` prefix are not embedded in the bundle |
| Push token stored in `user_profiles` without expiry or rotation | Stale tokens accumulate; a token for a former employee's device can receive notifications if their profile is not fully deactivated | When deactivating a staff member via the web dashboard, also clear their `expo_push_token` field |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No offline banner when sync queue is non-empty | Housekeeper marks room clean, sees no confirmation, taps again — creates duplicate queue entry | Show a persistent subtle banner ("Saving when online...") when `sync_queue` has items and `isInternetReachable` is false |
| Room status update spinner with no timeout | Housekeeper walks into a dead zone mid-update — spinner spins forever, they re-tap, duplicate entry | Set a 10-second timeout on API calls; on timeout, enqueue to sync_queue and show "Saved offline" confirmation |
| Magic link email opens in the system browser, not the app | Housekeeper taps the link on their phone, it opens Safari instead of the app — they are confused | Verify the `patelrep://` deep link scheme in `app.json` is registered, and that the magic link redirect URL in Supabase is set to `patelrep://auth/callback` not an HTTP URL |
| No "you have N new assignments" badge on app icon | Housekeepers miss assignment push notifications if phone is silenced | Set `shouldSetBadge: true` in `setNotificationHandler` (already set) AND call `setBadgeCountAsync(0)` when the user opens the Rooms screen |
| Language defaults to English regardless of device locale | Spanish-speaking housekeepers see English UI on first launch | Read `expo-localization` `locale` on first launch; if `es`, set i18n language and persist to user profile |

---

## "Looks Done But Isn't" Checklist

- [ ] **Push Notifications:** `notifications.ts` token registration looks complete but `projectId` is a placeholder — verify `Constants.easConfig.projectId` resolves correctly in a real EAS build before marking done
- [ ] **Offline Sync:** `sync.ts` has the queue flush loop but `attempts` is never incremented and there is no max-retry guard — the sync queue is not production-ready
- [ ] **EAS Build (Android):** `eas.json` preview profile produces AAB by default, not APK — pilot Android sideload will not work without adding `"buildType": "apk"`
- [ ] **EAS Secrets:** All `YOUR_SUPABASE_URL` / `YOUR_SUPABASE_ANON_KEY` values in `eas.json` are placeholders — no real build will succeed until these are replaced with EAS secrets
- [ ] **google-services.json:** `app.json` references `./google-services.json` for FCM but this file is not committed and likely does not exist — Android push notifications will fail at build time
- [ ] **Push Token Persistence:** `savePushTokenToProfile` writes directly to Supabase, bypassing the API — not consistent with the "API-first, no direct Supabase from mobile" architectural decision
- [ ] **Auth Hydration:** No `isHydrating` guard in root layout — app may flash login screen on every cold open for authenticated users
- [ ] **401 Recovery:** `api/client.ts` has no retry-on-401 logic — sessions expiring during a long shift will require a manual re-login with no user guidance
- [ ] **Notification Deep Link:** Tapping a push notification when the app is killed does not navigate to the specific room or work order — the `lastNotificationResponse` listener must be wired in the root layout
- [ ] **Work Order Sync:** `sync.ts` handles `room_status` updates and `task` creates but `work_order` status updates are not included in `refreshRooms` — engineers' data does not refresh on reconnect

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Wrong projectId in push token registration | LOW | Update `notifications.ts`, rebuild with EAS, redistribute — no data migration needed |
| Sync queue with unprocessed permanent failures | MEDIUM | Add a one-time migration to clear queue items with `attempts > 5`; add attempt counter going forward |
| EAS build produces AAB instead of APK for pilot | LOW | Add `buildType: "apk"` to `eas.json`, trigger a new build — 15 minutes |
| Auth session expiry during pilot causing mass logouts | MEDIUM | Hot-fix the 401 retry handler via OTA update (no rebuild needed since it is JS-only logic) |
| google-services.json missing at build time | LOW | Generate from Firebase console, add as EAS secret, trigger rebuild |
| Push token saved to wrong project (wrong projectId) | MEDIUM | Existing tokens in `user_profiles` are invalid; after fix, tokens regenerate on next app open automatically |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Hardcoded projectId placeholder | Phase 1: Push Notification Wiring | Token resolves to non-null UUID string when running EAS dev build on physical device |
| iOS simulator cannot receive APNs | Phase 1: Push Notification Wiring | End-to-end delivery test runs on physical iPhone via EAS internal distribution |
| No retry/attempt-limit in sync queue | Phase 2: Offline Sync Hardening | Force-fail 3 API calls while offline; verify queue item `attempts` increments and item is removed after limit |
| NetInfo false positive on hotel Wi-Fi | Phase 2: Offline Sync Hardening | Test sync flush while connected to a hotspot with no internet; verify no infinite retry loop |
| EAS APK buildType not set | Phase 3: EAS Build Setup | Download artifact from EAS dashboard; confirm `.apk` extension and direct install on Android device succeeds |
| EAS secrets all placeholder values | Phase 3: EAS Build Setup | `eas secret:list` shows all four required values; build log shows no `YOUR_` strings |
| Supabase JWT expiry / 401 no recovery | Phase 1: Auth + API Layer | Background app for 2 hours on physical device; resume and make an API call; verify it succeeds without user intervention |
| Auth hydration race → login flash | Phase 1: Auth + Navigation | Cold-open app while logged in 10 times; confirm no login screen flash |
| Push tap does not navigate to screen | Phase 1: Push Notification Wiring | Send push while app is killed; tap notification; verify navigation lands on correct room/work order |
| Work orders not refreshed on reconnect | Phase 2: Offline Sync Hardening | Go offline, receive a work order assignment via web dashboard, reconnect; verify work order appears without manual refresh |

---

## Sources

- [Expo Push Notifications Setup (official)](https://docs.expo.dev/push-notifications/push-notifications-setup/) — projectId requirement
- [expo-notifications GitHub issue #23225](https://github.com/expo/expo/issues/23225) — "No projectId found" error pattern
- [Expo Push Notifications FAQ (official)](https://docs.expo.dev/push-notifications/faq/) — simulator limitation stated explicitly
- [Expo SQLite (official)](https://docs.expo.dev/versions/latest/sdk/sqlite/) — WAL mode, transaction API
- [EAS Build APK configuration (official)](https://docs.expo.dev/build-reference/apk/) — buildType: "apk" requirement for sideload
- [EAS Build eas.json reference (official)](https://docs.expo.dev/build/eas-json/) — profile configuration
- [Expo Router Authentication (official)](https://docs.expo.dev/router/advanced/authentication/) — redirect and hydration patterns
- [Expo Router Protected Routes (official)](https://docs.expo.dev/router/advanced/protected/) — Stack.Protected guard
- [@react-native-community/netinfo (official)](https://docs.expo.dev/versions/latest/sdk/netinfo/) — isConnected vs isInternetReachable
- [react-native-netinfo GitHub issue #590](https://github.com/react-native-netinfo/react-native-netinfo/issues/590) — false-positive on screen wake
- [Supabase Auth sessions (official)](https://supabase.com/docs/guides/auth/sessions) — JWT refresh behavior on mobile
- [Supabase autoRefreshToken issue](https://github.com/supabase/auth-js/issues/563) — background timer killed by OS
- [Expo Router issue #30141](https://github.com/expo/expo/issues/30141) — deep link into nested tab stack, no back button
- [Expo notifications: killed state issue #14078](https://github.com/expo/expo/issues/14078) — NotificationResponseReceivedListener behavior
- [Expo notifications foreground/background caveats](https://dev.to/marianapatcosta/basics-and-caveats-of-expo-notifications-23cd) — platform differences documented
- Code audit: `apps/mobile/lib/notifications.ts`, `apps/mobile/lib/offline/sync.ts`, `apps/mobile/lib/offline/db.ts`, `apps/mobile/lib/api/client.ts`, `apps/mobile/app.json`, `apps/mobile/eas.json`

---
*Pitfalls research for: React Native Expo SDK 51 hotel staff mobile app (PatelRep)*
*Researched: 2026-03-19*
