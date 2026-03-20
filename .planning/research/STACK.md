# Stack Research

**Domain:** React Native hotel staff mobile app (Expo SDK 51, managed workflow)
**Researched:** 2026-03-20
**Confidence:** HIGH (all critical APIs verified against official docs and current source)

---

## Current State of the Scaffold

The app at `apps/mobile/` is already scaffolded on the correct base stack. This document records the verified-correct patterns for each technology area so that implementation work does not regress to stale APIs.

| Already Correct | Needs Fix / Completion |
|-----------------|------------------------|
| expo ~51.0.0, expo-router ~3.5.16 | `notifications.ts`: hardcoded `"YOUR_EXPO_PROJECT_ID"` placeholder |
| expo-sqlite ~14.0.6, async API used throughout `db.ts` | `eas.json`: missing `android.buildType: "apk"` on the `preview` profile |
| AsyncStorage as Supabase storage adapter | `supabase.ts`: missing AppState listener for `startAutoRefresh` / `stopAutoRefresh` |
| react-native-url-polyfill imported in `supabase.ts` | `db.ts`: `work_orders` table missing; sync.ts only refreshes rooms on reconnect |
| NetInfo addEventListener for online/offline detection | Auth guard in `(app)/_layout.tsx` uses `router.replace` in useEffect — valid for SDK 51, needs `mounted` guard |

---

## Recommended Stack

### Core Technologies

| Technology | Version (locked in package.json) | Purpose | Why Recommended |
|------------|----------------------------------|---------|-----------------|
| expo | ~51.0.0 | Managed workflow runtime | SDK 51 is the last LTS-stable before SDK 52's breaking SQLite changes; matches existing scaffold exactly |
| expo-router | ~3.5.16 | File-based navigation | Ships with SDK 51; v3 introduced `router.navigate()` (use over `router.push()` for replace-like behavior) and moved babel plugin into `babel-preset-expo` |
| react-native | 0.74.2 | Native runtime | Pinned by SDK 51; do not upgrade independently |
| typescript | ^5.4.0 | Type safety | Compatible with React 18.2 typings |

### Navigation (Expo Router v3)

| Pattern | Correct API | Notes |
|---------|-------------|-------|
| Tab navigator | `<Tabs>` + `<Tabs.Screen>` | Already used in `(app)/_layout.tsx` — correct |
| Stack navigator | `<Stack>` + `<Stack.Screen>` | Used in root `_layout.tsx` — correct |
| Auth guard (SDK 51) | `<Redirect href="/sign-in" />` inside nested layout, NOT `router.replace` inside `useEffect` | The `useEffect` + `router.replace` pattern in `(app)/_layout.tsx` works but risks "navigate before mount" errors; the `<Redirect>` pattern is more robust for SDK 51 |
| Typed routes | `experiments.typedRoutes: true` in `app.json` | Already enabled; gives TypeScript autocomplete on `href` |
| Route groups | `(auth)/`, `(app)/` with `_layout.tsx` per group | Already scaffolded correctly |
| Breaking change from v2 | `router.push()` always pushes a new entry; use `router.navigate()` for conditional push | Confirm all auth redirects use `router.replace()`, not `router.push()` |

### Push Notifications (expo-notifications ~0.28.8)

| Concern | Correct Pattern | Problem in Current Code |
|---------|-----------------|------------------------|
| `projectId` source | `Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId` | Current code has literal `"YOUR_EXPO_PROJECT_ID"` placeholder |
| Where `projectId` lives in `app.json` | Must be set under `expo.extra.eas.projectId` OR rely on `Constants.easConfig.projectId` (auto-populated by EAS Build) | `app.json` has no `extra.eas.projectId` field yet — either add it or use the `easConfig` fallback |
| Android channel | `Notifications.setNotificationChannelAsync("default", {...})` before token fetch | Already done correctly in `notifications.ts` |
| Foreground handler | `Notifications.setNotificationHandler(...)` at module level | Already done correctly |
| Permission check before token | `getPermissionsAsync()` then `requestPermissionsAsync()` | Already done correctly |

**Verified `getExpoPushTokenAsync` call (HIGH confidence — official docs):**
```typescript
const projectId =
  Constants?.expoConfig?.extra?.eas?.projectId ??
  Constants?.easConfig?.projectId;

if (!projectId) throw new Error("No projectId found for push notifications");

const token = await Notifications.getExpoPushTokenAsync({ projectId });
```

### Offline Storage (expo-sqlite ~14.0.6)

The existing `db.ts` uses the correct v14 async API. Key verification:

| API | Status | Notes |
|-----|--------|-------|
| `openDatabaseAsync(name)` | Correct — used in `db.ts` | `openDatabase()` (sync, no Async suffix) is deprecated in v14; do not use |
| `db.execAsync(sql)` | Correct — used for schema init | Executes raw SQL, no parameter escaping; safe for schema DDL only |
| `db.runAsync(sql, params[])` | Correct — used for inserts | Returns `{ lastInsertRowId, changes }` |
| `db.getAllAsync(sql, params[])` | Correct — used for reads | Returns typed array |
| `db.withTransactionAsync(fn)` | Correct — used in `upsertRooms` | All writes inside lambda; auto-rollback on throw |
| `SQLiteProvider` + `useSQLiteContext()` | NOT used in scaffold | An alternative React context pattern; the current singleton `getDb()` pattern is fine and simpler for this use case |

**`work_orders` table gap:** `db.ts` has the schema but `sync.ts` only calls `refreshRooms()` on reconnect. A `refreshWorkOrders()` function analogous to `refreshRooms()` is needed.

**WAL mode:** Already enabled via `PRAGMA journal_mode = WAL` in `initSchema` — correct; WAL improves concurrent read performance on mobile.

### Supabase Auth (supabase-js ^2.43.4)

The existing `lib/supabase.ts` is mostly correct but is **missing the AppState listener** required for reliable token refresh on mobile.

**Why the AppState listener is required (MEDIUM confidence — official Supabase docs):**
The `supabase-js` auto-refresh timer runs continuously in browsers because browsers fire visibility events. On React Native, the library cannot detect foreground/background transitions on its own. Without the listener, a user who backgrounds the app for longer than the JWT expiry (default 3600s) will be silently signed out when they return.

**Correct pattern to add alongside existing createClient call:**
```typescript
import { AppState } from "react-native";

AppState.addEventListener("change", (state) => {
  if (state === "active") {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
```

**SecureStore vs AsyncStorage:** The current code uses `AsyncStorage`. This is acceptable for a pilot. `expo-secure-store` would be more secure but has a 2048-byte size limit per key — the full Supabase session JSON typically exceeds this, requiring a chunk-based adapter or MMKV+SecureStore hybrid. AsyncStorage is the correct choice for SDK 51 pilot unless the hotel demands encrypted-at-rest storage.

### EAS Build

| Profile | Current `eas.json` | Required Fix | Why |
|---------|--------------------|--------------|-----|
| `preview` (Android sideload) | No `android` block | Add `"android": { "buildType": "apk" }` | Default EAS Android output is `.aab` (Play Store format). APK is required for direct device sideloading. Without this, `eas build -p android --profile preview` produces an `.aab` that cannot be installed without Play Store. |
| `preview` (iOS TestFlight) | `"distribution": "internal"` absent | Add `"distribution": "internal"` to the `preview` profile | Internal distribution produces a signed `.ipa` that can be uploaded to TestFlight via EAS Submit |
| `production` | No `android.buildType` | Leave as default (`.aab`) | Production profiles should produce AAB for Play Store |

**Correct `preview` profile:**
```json
"preview": {
  "distribution": "internal",
  "android": {
    "buildType": "apk"
  },
  "env": {
    "EXPO_PUBLIC_API_URL": "https://api.patelrep.com/v1",
    "EXPO_PUBLIC_SUPABASE_URL": "YOUR_SUPABASE_URL",
    "EXPO_PUBLIC_SUPABASE_ANON_KEY": "YOUR_SUPABASE_ANON_KEY"
  }
}
```

**CLI version:** `eas.json` requires `>= 10.0.0` — correct; EAS CLI 10+ is required for SDK 51 builds.

---

## Supporting Libraries

| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| @react-native-async-storage/async-storage | 1.23.1 | Supabase session persistence | Pinned by SDK 51 peer deps; do not upgrade independently |
| @react-native-community/netinfo | 11.3.1 | Online/offline detection | Used correctly in root `_layout.tsx` |
| expo-constants | ~16.0.2 | `Constants.expoConfig` / `Constants.easConfig` for projectId | Must import from `expo-constants`, not destructure from `expo` |
| expo-secure-store | ~13.0.2 | Secure key-value storage | Currently only used for plugin config; avoid for session storage due to 2048-byte limit |
| expo-notifications | ~0.28.8 | Push token + foreground notifications | Correct version for SDK 51; requires `expo-notifications` plugin in `app.json` (already present) |
| expo-sqlite | ~14.0.6 | Offline SQLite cache | v14 is the correct version for SDK 51; async API used throughout — correct |
| zustand | ^4.5.4 | Global state (appStore) | Correct for React Native; no Suspense dependency issues |
| react-i18next + i18next | ^14.x / ^23.x | EN/ES translations | Compatible with React 18; already scaffolded |
| react-native-url-polyfill | ^2.0.0 | Supabase requires URL/URLSearchParams globals | Must be imported at top of `lib/supabase.ts` — already done correctly |
| @expo/vector-icons | ^14.0.2 | Ionicons tab icons | Bundled with SDK 51; do not install a separate `react-native-vector-icons` |

---

## Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| EAS CLI (`eas-cli`) | Build + submit | Install globally: `npm install -g eas-cli`; version >= 10.0.0 required |
| Expo Go | Development on device | Limited to SDK 51 features; push notifications require a development build (not Expo Go) |
| EAS development build | Full native feature testing | Required for testing push notifications end-to-end; use `eas build --profile development` |
| TypeScript strict mode | Type checking | `tsconfig.json` already set; run `npm run type-check` before building |

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| AsyncStorage for Supabase session | expo-secure-store + MMKV chunked adapter | Only if hotel security policy requires encrypted-at-rest session tokens; adds significant complexity |
| Singleton `getDb()` pattern | `SQLiteProvider` + `useSQLiteContext()` | Use SQLiteProvider if adding multiple screens that each query the DB directly via hooks; for the current architecture (sync queue + store), singleton is simpler |
| `<Redirect>` in nested layout for auth guard | `useSegments` + `router.replace` in useEffect | The useEffect approach works for SDK 51 but is more prone to "navigate before mount" race conditions on cold start |
| EAS Build (managed) | Custom bare workflow + Xcode/Android Studio | Only needed if a native module outside the Expo ecosystem is required; not needed for this feature set |
| expo-notifications | Firebase Cloud Messaging (FCM) direct | FCM direct requires bare workflow and native config; Expo Push wraps FCM/APNs and works in managed workflow |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `SQLite.openDatabase()` (no Async suffix) | Deprecated in expo-sqlite v11+; removed in v14; will throw on SDK 51 | `SQLite.openDatabaseAsync()` |
| `router.push()` for auth redirects | In Router v3, `push()` always adds a new stack entry; using it to redirect to login creates an unremovable login screen on back press | `router.replace()` for auth redirects |
| `expo-router/babel` in `babel.config.js` | Removed in Router v3; functionality merged into `babel-preset-expo`; adding it causes build errors | Remove entirely; `babel-preset-expo` handles it |
| `Constants.manifest` for projectId | Deprecated in SDK 45+; returns null in managed builds | `Constants.expoConfig` or `Constants.easConfig` |
| Direct Supabase client calls for data (non-auth) | The architecture decision is API-first; mobile only calls the FastAPI backend; direct Supabase calls from mobile bypass the auth middleware and RLS is not a substitute for API-layer business logic | `lib/api/client.ts` for all data operations |
| `expo-secure-store` for full Supabase session | Hard 2048-byte limit per key; Supabase session JSON exceeds this; will silently fail to persist session | `AsyncStorage` (or MMKV + chunked SecureStore if encryption required) |
| Building Android without `buildType: "apk"` for sideload | Default output is `.aab`; cannot be installed on devices without going through Play Store | `"buildType": "apk"` in the `preview` EAS profile |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| expo ~51.0.0 | react-native 0.74.2 | Do not mix SDK 51 with RN 0.75+; the SDK pins the RN version |
| expo-router ~3.5.16 | expo ~51.0.0 | Router 3.5.x is the correct minor for SDK 51; Router 4.x requires SDK 52+ |
| expo-sqlite ~14.0.6 | expo ~51.0.0 | v14 is the correct major for SDK 51; v13 and below used the deprecated sync API |
| expo-notifications ~0.28.8 | expo ~51.0.0 | 0.28.x is pinned to SDK 51; 0.29+ targets SDK 52 |
| @supabase/supabase-js ^2.43.4 | react-native 0.74.x | Any 2.x works; 2.43+ includes `startAutoRefresh`/`stopAutoRefresh` methods |
| @react-native-async-storage/async-storage 1.23.1 | react-native 0.74.x | Pinned; upgrading may break Supabase session restore |

---

## Stack Patterns by Variant

**For push notification token registration (development build only, not Expo Go):**
- Use a development build via `eas build --profile development`
- Push notifications do not work in Expo Go (simulator or device)
- The `projectId` must be present in `app.json` under `extra.eas.projectId` OR EAS Build must have run at least once to populate `easConfig.projectId`

**For the Android pilot (sideload APK):**
- Use `eas build -p android --profile preview`
- Requires `"buildType": "apk"` in `eas.json` preview profile
- The build URL is shareable; pilot users download and tap to install (allow unknown sources must be enabled on device)

**For the iOS pilot (TestFlight):**
- Use `eas build -p ios --profile preview`
- Requires `"distribution": "internal"` in the preview profile
- Follow with `eas submit -p ios --profile production` to upload to TestFlight

**For offline-first work order operations:**
- The sync queue in `db.ts` already handles `work_order` / `update` actions
- Add a `refreshWorkOrders()` function to `sync.ts` mirroring `refreshRooms()` and call it from `syncOnConnect()`

---

## Sources

- [Expo Router v3 Changelog](https://expo.dev/changelog/2024-01-23-router-3) — Breaking changes: `router.push` behavior, babel plugin removal (MEDIUM confidence — official Expo blog)
- [Expo Router Authentication (Redirects)](https://docs.expo.dev/router/advanced/authentication-rewrites/) — `<Redirect>` pattern for SDK 51 auth guards (HIGH confidence — official Expo docs)
- [Expo Push Notifications Setup](https://docs.expo.dev/push-notifications/push-notifications-setup/) — `Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId` pattern (HIGH confidence — official Expo docs)
- [Expo SQLite v14 Docs](https://docs.expo.dev/versions/latest/sdk/sqlite/) — `openDatabaseAsync`, `runAsync`, `execAsync`, `withTransactionAsync` API (HIGH confidence — official Expo docs)
- [EAS Build APK Reference](https://docs.expo.dev/build-reference/apk/) — `buildType: "apk"` for Android sideloading (HIGH confidence — official Expo docs)
- [EAS Build eas.json Reference](https://docs.expo.dev/build/eas-json/) — Profile structure, `distribution: "internal"` (HIGH confidence — official Expo docs)
- [Supabase React Native Quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/expo-react-native) — `storage: AsyncStorage`, `autoRefreshToken: true`, `detectSessionInUrl: false` (HIGH confidence — official Supabase docs)
- [Supabase `auth-startautorefresh` reference](https://supabase.com/docs/reference/javascript/auth-startautorefresh) — `AppState.addEventListener` + `startAutoRefresh`/`stopAutoRefresh` pattern for React Native (HIGH confidence — official Supabase docs)
- [Supabase expo-sqlite localStorage polyfill](https://supabase.com/docs/guides/getting-started/quickstarts/expo-react-native) — Newer Supabase docs recommend `expo-sqlite/localStorage/install` polyfill; current scaffold uses AsyncStorage which is equivalent and more explicit (MEDIUM confidence — verified working pattern)

---

*Stack research for: PatelRep Mobile (Expo SDK 51, React Native, hotel staff app)*
*Researched: 2026-03-20*
