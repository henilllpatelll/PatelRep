# Phase 1: Foundation - Research

**Researched:** 2026-03-20
**Domain:** React Native + Expo SDK 51 auth, deep linking, session persistence, 401 recovery, offline detection
**Confidence:** HIGH (most findings verified against official Expo and Supabase docs)

---

## Summary

Phase 1 fixes four broken foundations before any feature work can produce honest test results. The scaffold already has Supabase configured with AsyncStorage and autoRefreshToken, but it is missing the AppState lifecycle hook that actually starts/stops refresh cycles on mobile, so tokens silently expire mid-shift. The root layout performs navigation inside `useEffect` before the auth store is hydrated, causing the login flash on cold open — the fix is `SplashScreen.preventAutoHideAsync()` called at module scope plus an `isLoading` guard. Magic link deep linking is broken in the current expo-router 3.5 version because hash fragments (`#access_token=...`) are silently stripped; the fix is a one-file `+native-intent.ts` workaround. The API client throws on 401 instead of retrying with a refreshed token; the fix is a `withRetry` wrapper around the existing `fetch` calls.

**Primary recommendation:** Fix all four problems in this order — SplashScreen hydration guard, AppState token refresh, magic link `+native-intent.ts`, 401 retry wrapper — as each one is independently testable on a physical device.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUTH-01 | User can log in with email/password on a physical device | Login screen scaffold exists; needs SplashScreen guard so the user lands on home screen without flash |
| AUTH-02 | User can log in via magic link (deep link opens app, not browser) | Requires `+native-intent.ts` hash-to-querystring fix AND an `app/(auth)/auth/callback.tsx` route that calls `supabase.auth.setSession()` |
| AUTH-03 | Auth session persists across app restarts without re-login | Supabase client already has `persistSession: true` + AsyncStorage; needs the `isLoading` guard so the persisted session is read before any redirect fires |
| AUTH-04 | App does not flash login screen on cold open for authenticated users | Requires `SplashScreen.preventAutoHideAsync()` at module scope + `isLoading` boolean in auth state that gates all redirects |
| AUTH-05 | Auth session auto-refreshes during an 8-hour shift without logging user out | Requires AppState listener calling `supabase.auth.startAutoRefresh()` on foreground and `stopAutoRefresh()` on background |
| INFRA-01 | API client retries with fresh token on 401 instead of hard logout | Requires `withRetry` wrapper in `lib/api/client.ts` that calls `supabase.auth.refreshSession()` on 401 and retries once |
| INFRA-04 | App shows "offline" banner when device has no internet connection | NetInfo `addEventListener` already wired in `_layout.tsx`; needs a persistent banner component reading `isOnline` from `appStore` rendered in `(app)/_layout.tsx` |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @supabase/supabase-js | ^2.43.4 (already installed) | Auth client, session management, token refresh | Official Supabase JS SDK; handles AsyncStorage persistence natively |
| expo-router | ~3.5.16 (already installed) | File-system routing, deep link handling | Already in use; Expo's recommended router for SDK 51 |
| expo-splash-screen | bundled with SDK 51 | Keep splash visible during auth hydration | Required to prevent cold open login flash |
| @react-native-async-storage/async-storage | 1.23.1 (already installed) | Session token persistence across restarts | Supabase official storage adapter for React Native |
| @react-native-community/netinfo | 11.3.1 (already installed) | Network connectivity detection | Already wired in `_layout.tsx`; used for offline banner |
| react-native AppState | built-in RN | Detect foreground/background transitions | Required for `startAutoRefresh`/`stopAutoRefresh` lifecycle |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| expo-linking | ~6.3.1 (already installed) | Parse deep link URLs in auth callback | Used in the `app/(auth)/auth/callback.tsx` route |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `+native-intent.ts` hash fix | Downgrade expo-router to 3.5.18 | Downgrade creates future upgrade debt; the native-intent file is 3 lines and is the community-endorsed fix |
| `supabase.auth.refreshSession()` on 401 | Sign user out on 401 | Signing out breaks the "no spurious logout" requirement of AUTH-05 |
| NetInfo `isConnected` | `isInternetReachable` | `isInternetReachable` has higher latency and returns `null` initially; `isConnected` is sufficient for a banner |

---

## Architecture Patterns

### Recommended Project Structure (additions to existing scaffold)

```
apps/mobile/
├── app/
│   ├── +native-intent.ts          # NEW: hash-to-querystring deep link fix
│   ├── _layout.tsx                 # MODIFY: add SplashScreen + isLoading + AppState
│   ├── (auth)/
│   │   ├── _layout.tsx             # MODIFY: add isLoading guard before redirect
│   │   ├── login.tsx               # EXISTS: no changes needed
│   │   └── auth/
│   │       └── callback.tsx        # NEW: exchanges access_token/refresh_token for session
│   └── (app)/
│       ├── _layout.tsx             # MODIFY: add OfflineBanner render, isLoading guard
│       └── [tabs...]
├── components/
│   └── shared/
│       └── OfflineBanner.tsx       # NEW: persistent banner reading isOnline from store
├── lib/
│   ├── api/
│   │   └── client.ts               # MODIFY: add withRetry 401 wrapper
│   └── supabase.ts                 # MODIFY: add AppState listener for start/stopAutoRefresh
└── stores/
    └── appStore.ts                  # MODIFY: add isLoading boolean to auth slice
```

### Pattern 1: SplashScreen + isLoading hydration guard

**What:** Call `SplashScreen.preventAutoHideAsync()` at module scope before the root component. Track `isLoading: true` in `appStore` until `onAuthStateChange` fires the first time. Root layout hides splash only after `isLoading` becomes false. All redirect logic is gated on `!isLoading`.

**When to use:** Every cold open. Without this, Expo Router renders the navigation tree before Supabase has read AsyncStorage, showing the login screen for ~300ms even when the session is valid.

**Example:**
```typescript
// apps/mobile/app/_layout.tsx
// Source: https://docs.expo.dev/versions/latest/sdk/splash-screen/
import * as SplashScreen from 'expo-splash-screen';

// Must be at module scope, before any component
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { setUser, setIsOnline, isLoading, setIsLoading } = useAppStore();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          // fetch profile...
          setUser(profile);
        } else {
          setUser(null);
        }
        // First event resolves the hydration — now safe to show UI
        setIsLoading(false);
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
    </>
  );
}
```

### Pattern 2: AppState token refresh lifecycle

**What:** Call `supabase.auth.startAutoRefresh()` when app enters foreground and `stopAutoRefresh()` when it goes to background. Without this, Supabase cannot detect mobile foreground/background transitions on its own.

**When to use:** Must be set up once in `supabase.ts` or `_layout.tsx` on app mount.

**Example:**
```typescript
// Source: https://supabase.com/docs/reference/javascript/auth-startautorefresh
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase';

AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
```

**Note:** Register this listener once at app startup. Call it in `supabase.ts` at module scope (after client creation) so it runs exactly once regardless of navigation.

### Pattern 3: Magic link deep link — hash fragment fix

**What:** Expo Router 3.5 strips hash fragments from deep link URLs. Supabase magic links redirect to `patelrep://auth/callback#access_token=...&refresh_token=...`. The `#` is stripped, so tokens never reach the app.

**Fix:** Create `app/+native-intent.ts` with a `redirectSystemPath` export that converts `#` to `?` before Expo Router parses the URL.

**Example:**
```typescript
// apps/mobile/app/+native-intent.ts
// Source: https://github.com/expo/router/issues/724 (community-confirmed fix)
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  // Convert hash fragment to query params so Expo Router can parse them
  return path.includes('#') ? path.replace('#', '?') : path;
}
```

Then create the callback route:
```typescript
// apps/mobile/app/(auth)/auth/callback.tsx
// Source: https://supabase.com/docs/guides/auth/native-mobile-deep-linking
import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '@/lib/supabase';

export default function AuthCallback() {
  const params = useLocalSearchParams<{
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  }>();

  useEffect(() => {
    async function handleCallback() {
      const { access_token, refresh_token, error } = params;

      if (error) {
        router.replace('/(auth)/login');
        return;
      }

      if (access_token && refresh_token) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        if (sessionError) {
          router.replace('/(auth)/login');
          return;
        }
        // onAuthStateChange in root layout will set user and trigger redirect
      } else {
        router.replace('/(auth)/login');
      }
    }

    handleCallback();
  }, [params]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" />
    </View>
  );
}
```

Also register the redirect URL in Supabase Dashboard:
`patelrep://auth/callback`

### Pattern 4: 401 retry wrapper in API client

**What:** When the API returns 401, call `supabase.auth.refreshSession()`, then retry the original request once with the new token. If refresh fails, rethrow so the caller can handle it (do NOT auto-logout — let `onAuthStateChange` handle `SIGNED_OUT` events).

**When to use:** Wrap only the `request()` function inside `lib/api/client.ts`. No changes needed at call sites.

**Example:**
```typescript
// apps/mobile/lib/api/client.ts (modified request function)
// Source: https://supabase.com/docs/reference/javascript/auth-refreshsession
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  isRetry = false
): Promise<T> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && !isRetry) {
    // Attempt to get a fresh token
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) {
      // Retry once with new token
      return request<T>(method, path, body, true);
    }
    // Refresh failed — rethrow as auth error; onAuthStateChange handles SIGNED_OUT
    throw new Error('Session expired. Please log in again.');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail ?? `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}
```

### Pattern 5: Offline banner

**What:** `isOnline` is already tracked in `appStore` and updated by the NetInfo listener in `_layout.tsx`. A `OfflineBanner` component reads this value and renders a persistent red bar at the top of the screen.

**When to use:** Render inside `(app)/_layout.tsx` so it appears on all authenticated screens.

**Example:**
```typescript
// apps/mobile/components/shared/OfflineBanner.tsx
import { View, Text, StyleSheet } from 'react-native';
import { useAppStore } from '@/stores/appStore';

export function OfflineBanner() {
  const isOnline = useAppStore((s) => s.isOnline);
  if (isOnline) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>No internet connection</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#EF4444',
    paddingVertical: 6,
    alignItems: 'center',
  },
  text: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
```

**Note:** `isConnected` from NetInfo can be `null` on first emit. The existing `_layout.tsx` already does `!!state.isConnected` which correctly treats `null` as falsy. Do not change this.

### Anti-Patterns to Avoid

- **Redirect in root `_layout.tsx` before `isLoading` is false:** This fires before AsyncStorage is read and shows the login flash. All redirect logic must be gated on `!isLoading`.
- **Calling `SplashScreen.preventAutoHideAsync()` inside a component or `useEffect`:** This may fire too late after Expo Router has already rendered. It must be at module scope.
- **Auto-logout on 401 without retry:** INFRA-01 explicitly requires a retry. Hard logout breaks shifts.
- **Registering AppState listener inside a React component without cleanup:** Creates duplicate listeners on re-renders. Register once at module scope in `supabase.ts`.
- **Using `Stack.Protected` from Expo Router docs:** This API requires SDK 53+. This project uses SDK 51 — use the `isLoading` + `useSegments` redirect pattern instead.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session token persistence | Custom AsyncStorage read/write | `supabase.auth` with `storage: AsyncStorage` | Already handles token encryption, expiry, serialization |
| Token refresh scheduling | Custom timer/interval | `supabase.auth.startAutoRefresh()` / `stopAutoRefresh()` | Official API; handles jitter, retry, and concurrent refresh deduplication |
| Deep link URL parsing | Custom URL parser | `useLocalSearchParams()` from expo-router | After `+native-intent.ts` converts `#` to `?`, Expo Router parses params natively |
| Network detection | Custom ping loop | NetInfo `addEventListener` | Already in place; handles Wi-Fi, cellular, and airplane mode transitions |
| Auth state machine | Custom state transitions | `supabase.auth.onAuthStateChange` | Emits SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED — covers all cases |

---

## Common Pitfalls

### Pitfall 1: Login flash on cold open (AUTH-04)
**What goes wrong:** `_layout.tsx` fires `onAuthStateChange` asynchronously. Expo Router renders the navigation tree before the first event arrives. The `(app)` layout sees `isAuthenticated: false` (initial Zustand state) and redirects to login before the session loads from AsyncStorage.
**Why it happens:** Zustand stores initialize synchronously with default values. AsyncStorage reads are async.
**How to avoid:** Add `isLoading: true` as initial state in `appStore`. Set it to `false` only after the first `onAuthStateChange` event (any event). Gate ALL redirect logic on `!isLoading`. Keep SplashScreen visible until `isLoading` is false.
**Warning signs:** Login screen briefly visible on cold open even when session exists.

### Pitfall 2: Token expires mid-shift (AUTH-05)
**What goes wrong:** Supabase's `autoRefreshToken: true` config works in browsers by hooking into page visibility events. On React Native, there is no equivalent built-in hook — the library cannot detect foreground/background without explicit `AppState` wiring.
**Why it happens:** `autoRefreshToken` on non-browser platforms does not automatically pause/resume based on app visibility.
**How to avoid:** Add `AppState.addEventListener` with `startAutoRefresh`/`stopAutoRefresh` at module scope in `supabase.ts`. Verify with a 30-minute background test.
**Warning signs:** Session works on fresh launch but 401s appear after the device has been idle.

### Pitfall 3: Magic link opens browser instead of app (AUTH-02)
**What goes wrong:** The redirect URL in `signInWithOtp` options must exactly match a registered URL in Supabase Dashboard. If `patelrep://auth/callback` is not in "Additional Redirect URLs", Supabase will reject the redirect.
**Why it happens:** Supabase validates redirect URLs against an allowlist for security.
**How to avoid:** Register `patelrep://auth/callback` in Supabase Dashboard > Auth > URL Configuration > Additional Redirect URLs.
**Warning signs:** Magic link email works but clicking it opens a browser error page.

### Pitfall 4: Hash fragment stripped, tokens lost (AUTH-02)
**What goes wrong:** Expo Router 3.5 strips the `#` from deep link URLs. Without `+native-intent.ts`, `patelrep://auth/callback#access_token=abc` arrives at the callback route with no params.
**Why it happens:** Expo Router's internal linking config uses standard URL parsing which treats `#` as a non-routing fragment.
**How to avoid:** Create `app/+native-intent.ts` with `redirectSystemPath` converting `#` to `?` before Expo Router processes the URL.
**Warning signs:** Callback route receives `params` with all values undefined.

### Pitfall 5: 401 retry causes infinite loop (INFRA-01)
**What goes wrong:** If `refreshSession()` itself returns 401 (refresh token also expired), the retry wrapper loops indefinitely.
**Why it happens:** Missing `isRetry` guard in the request function.
**How to avoid:** Pass an `isRetry` flag. On the second attempt, skip the refresh and rethrow. The `isRetry = false` default parameter ensures single-retry semantics.
**Warning signs:** Network tab shows the same API request repeating endlessly.

### Pitfall 6: NetInfo `isConnected` null on first emit
**What goes wrong:** On app launch, NetInfo may emit `isConnected: null` before it resolves the actual state. If the banner logic uses strict `=== false`, it will not show when it should.
**Why it happens:** NetInfo needs a moment to probe the actual connection state.
**How to avoid:** The existing `_layout.tsx` already uses `!!state.isConnected` which treats `null` as falsy (offline). The banner should use `!isOnline` where `isOnline` starts as `true` in `appStore` — this way the banner only appears after NetInfo confirms offline.

---

## Code Examples

### appStore.ts: add isLoading
```typescript
// apps/mobile/stores/appStore.ts
interface AppState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;          // ADD: true until first onAuthStateChange fires
  setUser: (user: UserProfile | null) => void;
  setIsLoading: (loading: boolean) => void;
  isOnline: boolean;
  setIsOnline: (online: boolean) => void;
  // ...rest unchanged
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,             // ADD: starts as true
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setIsLoading: (isLoading) => set({ isLoading }),
  isOnline: true,
  setIsOnline: (isOnline) => set({ isOnline }),
  // ...rest unchanged
}));
```

### (auth)/_layout.tsx: gate redirect on isLoading
```typescript
// Source: https://docs.expo.dev/router/advanced/authentication-rewrites/
export default function AuthLayout() {
  const { isAuthenticated, isLoading } = useAppStore(
    (s) => ({ isAuthenticated: s.isAuthenticated, isLoading: s.isLoading })
  );

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/(app)');
    }
  }, [isAuthenticated, isLoading]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
```

### (app)/_layout.tsx: gate redirect + offline banner
```typescript
export default function AppLayout() {
  const { user, isAuthenticated, isLoading } = useAppStore();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/(auth)/login');
    }
  }, [isAuthenticated, isLoading]);

  if (isLoading || !user) return null;

  return (
    <>
      <OfflineBanner />
      <Tabs ...>{/* tabs */}</Tabs>
    </>
  );
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Stack.Protected` for auth guards | Only available in SDK 53+ | SDK 53 (2025) | Project is on SDK 51 — must use `useSegments`/`isLoading` redirect pattern |
| `Linking.useURL()` for deep links | `useLocalSearchParams()` after `+native-intent.ts` | Expo Router 3.x | `useURL` has timing issues on iOS; native-intent + local params is more reliable |
| `autoRefreshToken: true` (implicit) | Explicit `AppState` + `startAutoRefresh()` | supabase-js v2 for RN | Mobile apps require explicit foreground/background signaling |

**Deprecated/outdated:**
- `Stack.Protected`: SDK 53+ only. Do not use on this project.
- `Linking.useURL()` for auth callbacks: Has iOS timing issues per supabase/supabase#9435. Use `useLocalSearchParams()` in the callback route instead.

---

## Open Questions

1. **Supabase redirect URL allowlist configuration**
   - What we know: The redirect URL `patelrep://auth/callback` is hardcoded in `login.tsx` and in `app.json` scheme
   - What's unclear: Whether the Supabase project has `patelrep://auth/callback` registered in Dashboard > Auth > Additional Redirect URLs
   - Recommendation: Planner should include a verification task that checks this configuration. If not registered, the magic link test will fail silently.

2. **`isLoading` initial state in (auth)/_layout.tsx during cold open**
   - What we know: Zustand `isLoading` starts as `true`. The auth and app layouts both depend on it.
   - What's unclear: Whether `onAuthStateChange` reliably fires within splash screen display time on low-end Android devices
   - Recommendation: Add a 5-second timeout in the root layout that forces `isLoading = false` as a safety fallback, to prevent permanent splash lock.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected in scaffold |
| Config file | None — Wave 0 must add |
| Quick run command | `npx jest --testPathPattern="auth" --passWithNoTests` |
| Full suite command | `npx jest --passWithNoTests` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | Password login reaches home screen | manual smoke | Physical device test | N/A |
| AUTH-02 | Magic link opens app not browser, session established | manual smoke | Physical device + email test | N/A |
| AUTH-03 | Session persists across app restart | manual smoke | Kill + reopen app on device | N/A |
| AUTH-04 | No login flash on cold open | manual smoke | Physical device cold open | N/A |
| AUTH-05 | No logout after 30 min background | manual smoke | Background app 30 min, return | N/A |
| INFRA-01 | 401 triggers retry not logout | unit | `npx jest --testPathPattern="client"` | Wave 0 |
| INFRA-04 | Offline banner shows when no internet | unit | `npx jest --testPathPattern="OfflineBanner"` | Wave 0 |

**Note:** AUTH-01 through AUTH-05 require physical device verification. They cannot be automated meaningfully in a unit test environment and are best verified via the success criteria checklist in `/gsd:verify-work`.

### Sampling Rate
- **Per task commit:** `npx jest --testPathPattern="(client|OfflineBanner)" --passWithNoTests`
- **Per wave merge:** `npx jest --passWithNoTests`
- **Phase gate:** Full suite green + physical device checklist before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `apps/mobile/__tests__/lib/api/client.test.ts` — covers INFRA-01 (401 retry with mock fetch)
- [ ] `apps/mobile/__tests__/components/OfflineBanner.test.tsx` — covers INFRA-04 (renders when isOnline false)
- [ ] `apps/mobile/jest.config.js` — jest setup for React Native / Expo
- [ ] `apps/mobile/babel.config.js` — confirm Babel preset for jest transforms
- [ ] Framework install: `cd apps/mobile && npx expo install jest-expo @types/jest`

---

## Sources

### Primary (HIGH confidence)
- [Expo SplashScreen docs](https://docs.expo.dev/versions/latest/sdk/splash-screen/) — preventAutoHideAsync module-scope pattern
- [Supabase startAutoRefresh API reference](https://supabase.com/docs/reference/javascript/auth-startautorefresh) — AppState pattern for mobile
- [Supabase refreshSession API reference](https://supabase.com/docs/reference/javascript/auth-refreshsession) — 401 retry wrapper
- [Supabase Native Mobile Deep Linking guide](https://supabase.com/docs/guides/auth/native-mobile-deep-linking) — createSessionFromUrl / setSession pattern
- [Expo Router authentication-rewrites guide](https://docs.expo.dev/router/advanced/authentication-rewrites/) — redirect-based auth for pre-SDK 53

### Secondary (MEDIUM confidence)
- [detl.ca SDK 51 auth routes guide](https://www.detl.ca/blog/how-to-create-authenticated-routes-with-the-new-expo-sdk-51-using-expo-router) — complete useSegments + SplashScreen pattern, verified consistent with official Expo docs
- [expo/router GitHub issue #724](https://github.com/expo/router/issues/724) — hash fragment stripping; `+native-intent.ts` workaround community-verified
- [react-native-netinfo GitHub](https://github.com/react-native-netinfo/react-native-netinfo) — `isConnected` vs `isInternetReachable` behavior, null initial state

### Tertiary (LOW confidence)
- Community discussions on supabase/supabase GitHub re: magic link + RN issues — cross-referenced with official docs; specific timing behavior on iOS not formally documented

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — All libraries already in package.json; APIs verified against official docs
- Architecture: HIGH — Patterns sourced from official Expo + Supabase documentation
- Pitfalls: HIGH — Hash fragment issue confirmed in official GitHub issue tracker; other pitfalls verified against official docs
- Test framework: LOW — No test setup exists in scaffold; Wave 0 gaps are inferred from project structure

**Research date:** 2026-03-20
**Valid until:** 2026-09-20 (stable libraries; SDK 51 is locked by project choice)
