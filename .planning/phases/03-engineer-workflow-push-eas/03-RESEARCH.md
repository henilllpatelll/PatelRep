# Phase 3: Engineer Workflow + Push + EAS - Research

**Researched:** 2026-03-21
**Domain:** React Native (Expo SDK 51) — engineer work order screens, offline sync, push notification deep linking, EAS Build distribution
**Confidence:** HIGH

---

## Summary

Phase 3 completes the engineer's mobile workflow (ENG-01 through ENG-07), firms up push notification deep linking for both housekeepers and engineers (HK-05 already sends; INFRA-02 requires API-based token registration), and produces installable pilot builds via EAS (INFRA-03).

The most important discovery: **most of the engineer workflow scaffold already exists and is correct.** `work-orders/index.tsx` renders a tabbed list with claim button; `[woId].tsx` renders detail with completion notes. What is missing or wrong is: (1) the list screen fetches `status=tab` but the backend `/work-orders` endpoint for an engineer returns `assigned_to.eq.<me> OR assigned_to.is.null` — both assigned AND open — so the tab filter is only half the requirement; (2) the detail screen does not show current status prominently enough to render the "Mark Done" path clearly (it only shows the completion section when `status === "in_progress"`); (3) the offline path for work order status changes is partially wired (`work_order/update` handler in `flushSyncQueue`) but there is no `enqueueAction` call anywhere in the WO screens — status changes go online-only; (4) the `savePushTokenToProfile` function writes the Expo push token **directly to Supabase**, bypassing the API, which violates INFRA-02; (5) `app.json` is missing the `extra.eas.projectId` key that `registerForPushNotifications()` reads, so every token registration silently returns `null` today; (6) EAS Build infrastructure needs a `preview` profile with `android.buildType: "apk"` and a production/preview profile for iOS TestFlight, plus `google-services.json` committed to the repo (it is currently only referenced in `app.json` but the file is absent).

Push notification deep linking has a well-known platform quirk: `addNotificationResponseReceivedListener` is **not called** when the app opens from a killed/terminated state. The correct pattern uses both the listener (for foreground/backgrounded) AND `Notifications.getLastNotificationResponseAsync()` checked on mount (for killed state). Both must extract a `url` or typed field from `notification.request.content.data` and call `router.push()`.

**Primary recommendation:** Fix offline WO sync enqueue, fix push token path (API PATCH), add EAS projectId to app.json, commit google-services.json, configure eas.json preview profile, and wire the dual-path notification navigator. No new libraries are needed.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ENG-01 | Engineer sees WOs assigned to them + open/unassigned | Backend `.or_()` filter already returns both; index.tsx tab filter is an additive UX layer on top — list must show assigned WOs on "in_progress" tab and open/unassigned on "open" tab |
| ENG-02 | WO list shows title, priority, status, room number | All four fields present in `WorkOrder` type and rendered in index.tsx card; room_number comes from `rooms(room_number)` join which exists in the API select |
| ENG-03 | Engineer can claim an open WO | `POST /work-orders/{id}/claim` exists and sets `status=in_progress`, `assigned_to=me`; claimWorkOrder() in index.tsx calls it; needs offline enqueue path added |
| ENG-04 | Engineer can update WO status (OPEN→IN_PROGRESS→DONE) | API has `/claim` (→in_progress) and `/complete` (→completed); the word "DONE" in requirements maps to `completed` in the DB schema |
| ENG-05 | Engineer can add resolution notes | `completeWorkOrder()` in [woId].tsx already sends `completion_notes` via `POST /work-orders/{id}/complete`; field `notes` in `CompleteWorkOrderRequest` confirmed |
| ENG-06 | Engineer receives push notification when WO assigned | Pattern exists in housekeeping.py `_send_assignment_push`; need equivalent `_send_wo_assignment_push` in work_orders.py triggered when `assigned_to` is set on WO creation or claim |
| ENG-07 | WO status updates work offline and sync when back online | `flushSyncQueue` already has `work_order/update` handler calling `PATCH /work-orders/{id}`; missing the `enqueueAction("work_order", "update", ...)` call in WO screens; also need `work_order/claim` entry type |
| INFRA-02 | Push token registered via API on each login | `savePushTokenToProfile` currently writes directly to Supabase; must add `PATCH /staff/me/push-token` (or reuse `PATCH /staff/me`) endpoint and call it instead |
| INFRA-03 | EAS Build produces APK (Android) and IPA (TestFlight) | eas.json preview profile needs `"android": {"buildType": "apk"}`; production profile needs iOS store credentials; `extra.eas.projectId` must be set in app.json; google-services.json must exist |
</phase_requirements>

---

## Standard Stack

### Core (already in project — do not re-install)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| expo | ~51.0.0 | SDK baseline | Project standard |
| expo-router | ~3.5.16 | File-based routing + navigation | Project standard |
| expo-notifications | ~0.28.8 | Push token + notification listeners | Already installed + configured |
| expo-sqlite | ~14.0.6 | Offline SQLite sync queue | Already used for room_status offline |
| @react-native-community/netinfo | 11.3.1 | Online/offline detection | Already used in _layout.tsx |
| zustand | ^4.5.4 | App state (appStore) | Project standard |
| react-i18next | ^14.1.2 | EN/ES translations | Already wired in all screens |
| jest-expo | ^51.0.4 | Test runner | Already in devDeps |
| @testing-library/react-native | ^12.9.0 | Component tests | Already in devDeps |

### No New Dependencies Required

All libraries needed for Phase 3 are already installed. Do not add packages.

---

## Architecture Patterns

### Recommended Structure (changes only)

```
apps/mobile/
├── app/
│   ├── _layout.tsx              # ADD: notification deep link handler (dual-path)
│   └── (app)/
│       └── work-orders/
│           ├── index.tsx        # FIX: offline claim path + enqueueAction for status
│           └── [woId].tsx       # FIX: add enqueueAction for offline complete
├── lib/
│   ├── api/
│   │   └── client.ts            # No changes needed
│   ├── notifications.ts         # FIX: replace savePushTokenToProfile (direct Supabase)
│   │                            #      with API call to PATCH /staff/me/push-token
│   └── offline/
│       └── sync.ts              # ADD: work_order/claim handler in flushSyncQueue
├── i18n/locales/
│   ├── en.json                  # ADD: workOrders.done, workOrders.myOrders
│   └── es.json                  # ADD: same keys in Spanish
apps/mobile/app.json             # ADD: extra.eas.projectId (after eas init)
apps/mobile/eas.json             # UPDATE: preview profile android.buildType=apk
apps/mobile/google-services.json # ADD: from Firebase console (commit to repo)
apps/api/routers/
│   ├── work_orders.py           # ADD: _send_wo_assignment_push + trigger on claim
│   └── staff.py                 # ADD: PATCH /staff/me/push-token endpoint
```

### Pattern 1: Work Order Offline Claim

**What:** Enqueue a `work_order/claim` action in SQLite when offline; flush sends `POST /work-orders/{id}/claim` on reconnect.
**When to use:** `isOnline` is false when user taps Claim.

```typescript
// Source: mirrors room_status offline pattern in [roomId].tsx
async function claimWorkOrder(id: string) {
  if (isOnline) {
    await api.post(`/work-orders/${id}/claim`, {});
  } else {
    await enqueueAction("work_order", "claim", {}, id);
    // Optimistic local status update
    setWorkOrders(prev =>
      prev.map(wo => wo.id === id ? { ...wo, status: "in_progress" } : wo)
    );
  }
  loadWorkOrders();
}
```

And in `flushSyncQueue` (sync.ts), add the handler:

```typescript
} else if (item.entity_type === "work_order" && item.action === "claim") {
  await api.post(`/work-orders/${item.entity_id}/claim`, {});
}
```

### Pattern 2: Work Order Offline Complete

**What:** Enqueue completion notes + status change when offline; flush calls `POST /work-orders/{id}/complete`.

```typescript
// In [woId].tsx completeWorkOrder()
if (isOnline) {
  await api.post(`/work-orders/${workOrder.id}/complete`, {
    completion_notes: completionNotes,
    photo_urls: photos,
  });
} else {
  await enqueueAction("work_order", "complete", {
    completion_notes: completionNotes,
  }, workOrder.id);
  // Optimistic update
  setWorkOrder({ ...workOrder, status: "completed" });
}
```

And in `flushSyncQueue`:
```typescript
} else if (item.entity_type === "work_order" && item.action === "complete") {
  await api.post(`/work-orders/${item.entity_id}/complete`, payload);
}
```

### Pattern 3: Push Token via API (INFRA-02)

**What:** Replace the direct Supabase write with a `PATCH /staff/me/push-token` API call.
**Why:** INFRA-02 requires token registration via the API, not direct DB writes.

Backend (staff.py):
```python
# Source: mirrors _update_housekeeper_profile pattern in rooms.py
@router.patch("/me/push-token")
async def update_push_token(
    body: UpdatePushTokenRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    supabase.table("user_profiles")\
        .update({"expo_push_token": body.token})\
        .eq("id", current_user.user_id)\
        .execute()
    return {"data": {"success": True}}
```

Mobile (notifications.ts), replace `savePushTokenToProfile`:
```typescript
// Source: mirrors api.patch pattern in [roomId].tsx
export async function savePushTokenToProfile(token: string): Promise<void> {
  await api.patch("/staff/me/push-token", { token });
}
```

### Pattern 4: Push Notification Deep Linking (Dual-Path)

**What:** Handle notification taps in both backgrounded and killed states.
**Critical fact:** `addNotificationResponseReceivedListener` is NOT called when the app is launched from a killed state. Must use `Notifications.getLastNotificationResponseAsync()` checked on mount for that case.

```typescript
// Source: Expo docs + github.com/expo/expo/issues/18403 confirmed pattern
// In _layout.tsx useEffect (after router is ready)

// Path 1: killed state — check once on mount
const lastResponse = await Notifications.getLastNotificationResponseAsync();
if (lastResponse) {
  const url = lastResponse.notification.request.content.data?.url as string | undefined;
  if (url) router.push(url as `/${string}`);
}

// Path 2: backgrounded/foreground — listener
const sub = Notifications.addNotificationResponseReceivedListener((response) => {
  const url = response.notification.request.content.data?.url as string | undefined;
  if (url) router.push(url as `/${string}`);
});
return () => sub.remove();
```

Notification payload `data` field from the API must include `url`:
- Room assignment: `{"type": "room_assignment", "url": "/(app)/my-rooms/<roomId>", "room_number": "101"}`
- WO assignment: `{"type": "wo_assignment", "url": "/(app)/work-orders/<woId>", "wo_id": "<id>"}`

The existing `_send_assignment_push` in housekeeping.py only sends `room_number` in data — the `url` key must be added.

### Pattern 5: Engineer WO Push Notification (ENG-06)

**What:** Mirroring `_send_assignment_push` from housekeeping.py in work_orders.py.
**Trigger:** When a WO is assigned (either via `POST /work-orders` with `assigned_to` set, or via `POST /work-orders/{id}/claim`).

```python
# Source: mirrors housekeeping.py _send_assignment_push pattern exactly
async def _send_wo_assignment_push(engineer_id: str, wo_id: str, title: str) -> None:
    try:
        profile = supabase.table("user_profiles")\
            .select("expo_push_token")\
            .eq("id", engineer_id)\
            .single().execute()
        token = (profile.data or {}).get("expo_push_token")
        if not token:
            return
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post("https://exp.host/--/api/v2/push/send", json={
                "to": token,
                "title": "Work Order Assigned",
                "body": title,
                "data": {
                    "type": "wo_assignment",
                    "url": f"/(app)/work-orders/{wo_id}",
                    "wo_id": wo_id,
                },
            })
    except Exception:
        pass
```

### Pattern 6: EAS Build Configuration

**Android APK sideload:**
```json
{
  "build": {
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    }
  }
}
```
Command: `eas build --platform android --profile preview`

**iOS TestFlight (production profile):**
```json
{
  "build": {
    "production": {
      "ios": {}
    }
  }
}
```
Command: `eas build --platform ios --profile production` then `eas submit --platform ios`

The existing `eas.json` already has `preview` and `production` profiles. The preview profile needs `"android": {"buildType": "apk"}` added. The production iOS profile is structurally fine — it needs real Apple credentials.

**Required before `eas build` works:**
1. `eas init` — adds `extra.eas.projectId` to `app.json`
2. `google-services.json` — committed at `apps/mobile/google-services.json` (matches `app.json` `android.googleServicesFile`)
3. Apple Developer account enrolled ($99/yr) for iOS TestFlight
4. FCM V1 service account JSON uploaded to EAS via `eas credentials`

### Anti-Patterns to Avoid

- **Only `addNotificationResponseReceivedListener` for navigation:** Misses the killed-app case on both iOS and Android. Always pair with `getLastNotificationResponseAsync()`.
- **Direct Supabase writes for push token:** Bypasses API auth middleware, violates INFRA-02, and splits the update path.
- **AAB for Android pilot distribution:** App Bundle requires Play Store review. Use `buildType: "apk"` for sideloading.
- **Sending `url` without `/(app)/` prefix:** Expo Router requires the full route path from the root. `work-orders/abc` will not navigate; `/(app)/work-orders/abc` will.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Push delivery to APNs/FCM | Custom HTTP to APNs/FCM | Expo Push API (`exp.host/--/api/v2/push/send`) | Handles token routing, platform differences, batching, retry |
| Android signing | Manual keystore management | EAS manages credentials automatically | EAS auto-provisions Android keystore on first build |
| iOS code signing | Manual provisioning profiles | EAS manages via `eas credentials` | Complex; EAS automates cert + profile lifecycle |
| Offline SQLite schema changes | ALTER TABLE migrations | Add columns in `initSchema` with `IF NOT EXISTS` check | SQLite on mobile has no migration tooling — idempotent CREATE handles re-opens |

---

## Common Pitfalls

### Pitfall 1: Killed-App Push Navigation Silently Fails

**What goes wrong:** Engineer taps push notification from killed state, app opens to home tab instead of the work order.
**Why it happens:** `addNotificationResponseReceivedListener` is not invoked when the app cold-starts from a notification tap. This is a confirmed platform behavior (iOS and Android), not a bug.
**How to avoid:** Always call `Notifications.getLastNotificationResponseAsync()` in a `useEffect` in `_layout.tsx` after the router is mounted. Process its result the same way as the listener response.
**Warning signs:** Navigation works when testing from background (common dev pattern) but fails for pilot users who fully close the app.

### Pitfall 2: Missing EAS projectId Silently Disables Push

**What goes wrong:** `registerForPushNotifications()` logs a warning and returns `null`; no token is ever saved; push notifications never arrive.
**Why it happens:** `notifications.ts` checks `Constants.expoConfig?.extra?.eas?.projectId` and early-returns with a `console.warn` if missing. The current `app.json` does not have `extra.eas.projectId`.
**How to avoid:** Run `eas init` in `apps/mobile/` before the first build. This adds the `extra.eas.projectId` field to `app.json`.
**Warning signs:** Push token column in `user_profiles` stays null for all users.

### Pitfall 3: google-services.json Missing Breaks Android EAS Build

**What goes wrong:** `eas build --platform android` fails with "google-services.json is missing".
**Why it happens:** `app.json` references `./google-services.json` under `android.googleServicesFile`, but the file does not exist in the repo (confirmed absent in git status).
**How to avoid:** Download `google-services.json` from Firebase console for the project's Android app and commit it to `apps/mobile/google-services.json`. The file contains only public-facing identifiers and is safe to commit.
**Warning signs:** EAS build fails at the Gradle configuration step.

### Pitfall 4: WO Status Changes Online-Only (No Offline Enqueue)

**What goes wrong:** Engineer in a basement with poor signal taps "Mark Done" — the request fails silently or shows an error; the status is not queued for later sync.
**Why it happens:** The existing `[woId].tsx` `completeWorkOrder()` calls `api.post()` directly with no `isOnline` check and no `enqueueAction()` fallback. The offline handler in `flushSyncQueue` exists for `work_order/update` but is never triggered because nothing enqueues to it.
**How to avoid:** Add `isOnline` check from `useAppStore` in `[woId].tsx` and `index.tsx`; enqueue on offline path using `enqueueAction("work_order", "complete", ...)` and `enqueueAction("work_order", "claim", ...)` respectively. Add `work_order/claim` and `work_order/complete` handlers to `flushSyncQueue`.
**Warning signs:** ENG-07 test passes online but fails in airplane mode.

### Pitfall 5: Push Data `url` Missing Breaks Deep Linking

**What goes wrong:** Notification tap opens the app but navigator does nothing (or crashes with "invalid route").
**Why it happens:** The existing `_send_assignment_push` in housekeeping.py sends `data: {"type": "room_assignment", "room_number": "101"}` — no `url` key. The deep link handler reads `data.url`.
**How to avoid:** Every push notification payload sent from the API must include a `url` field with the full Expo Router path (e.g., `"/(app)/work-orders/<woId>"`). Update the existing housekeeping push helper at the same time as adding the WO push helper.
**Warning signs:** `router.push(url)` receives `undefined` and does nothing.

### Pitfall 6: iOS TestFlight Requires Apple Developer Program Enrollment

**What goes wrong:** `eas build --platform ios` fails at provisioning step.
**Why it happens:** Ad hoc distribution and TestFlight both require Apple Developer Program membership ($99/yr). EAS cannot provision iOS credentials without it.
**How to avoid:** The pilot founder must enroll before this phase can be fully verified. EAS CLI will prompt for credentials interactively on first iOS build.
**Warning signs:** `eas build` fails with "no Apple credentials available".

---

## Code Examples

### Verified: Offline Pattern (mirrors existing room_status in [roomId].tsx)

```typescript
// Source: C:/Users/Henil/projects/PatelRep/apps/mobile/app/(app)/my-rooms/[roomId].tsx
const { isOnline } = useAppStore();
if (isOnline) {
  await api.patch(`/rooms/${room.id}/status`, payload);
} else {
  await enqueueAction("room_status", "update", payload, room.id);
}
```

### Verified: Fire-and-Forget Push (mirrors housekeeping.py pattern)

```python
# Source: C:/Users/Henil/projects/PatelRep/apps/api/routers/housekeeping.py lines 189-207
asyncio.create_task(_send_assignment_push(str(a.housekeeper_id), room_number))
```

### Verified: flushSyncQueue existing work_order handler

```typescript
// Source: C:/Users/Henil/projects/PatelRep/apps/mobile/lib/offline/sync.ts lines 41-44
} else if (item.entity_type === "work_order" && item.action === "update") {
  await api.patch(`/work-orders/${item.entity_id}`, payload);
}
```

### Verified: Push Token Read Pattern

```typescript
// Source: C:/Users/Henil/projects/PatelRep/apps/mobile/lib/notifications.ts lines 35-48
const projectId =
  Constants.expoConfig?.extra?.eas?.projectId ??
  (Constants.easConfig as { projectId?: string } | undefined)?.projectId ??
  "";
if (!projectId) {
  console.warn("[push] EAS projectId not set ...");
  return null;
}
const token = await Notifications.getExpoPushTokenAsync({ projectId });
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| FCM Legacy API | FCM V1 (service account) | 2024 (legacy API deprecated) | Must upload FCM service account JSON via `eas credentials`, not legacy server key |
| `getLastNotificationResponse()` (sync) | `getLastNotificationResponseAsync()` (async) | expo-notifications ~0.20 | The async version is required in newer SDK versions |
| AAB for all Android builds | APK for sideload, AAB for store | Always | APK is the only format that can be sideloaded without Play Store |

**Deprecated/outdated:**
- FCM Legacy Server Key: replaced by FCM V1 service account. Do not use the old Server Key approach.
- Direct Supabase writes for push tokens: project is migrating to API-mediated writes (INFRA-02).

---

## Open Questions

1. **Apple Developer Program enrollment status**
   - What we know: iOS TestFlight requires paid enrollment ($99/yr)
   - What's unclear: Whether the founder has enrolled or intends to before Phase 3 verification
   - Recommendation: Plan iOS build as a separate task; Android APK can be verified independently. If enrollment is missing, Android sideload alone satisfies the pilot's immediate need.

2. **EAS project ID — eas init already run?**
   - What we know: `app.json` has no `extra.eas.projectId` field today
   - What's unclear: Whether the founder has run `eas init` and the file is just not committed, or whether it has never been run
   - Recommendation: Include `eas init` as an explicit task step; check for the field before running builds.

3. **Firebase project for Android push**
   - What we know: `app.json` references `./google-services.json` which is confirmed absent from the repo
   - What's unclear: Whether a Firebase project exists or needs to be created
   - Recommendation: Block EAS Android build on this; include "create Firebase project + download google-services.json" as an explicit prerequisite step in the plan.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | jest-expo ^51.0.4 + @testing-library/react-native ^12.9.0 |
| Config file | `apps/mobile/jest.config.js` (exists) |
| Quick run command | `cd apps/mobile && npm test -- --passWithNoTests --testPathPattern="offline\|workOrders"` |
| Full suite command | `cd apps/mobile && npm test -- --passWithNoTests` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ENG-01 | Engineer WO list shows assigned + open | unit | `npm test -- --testPathPattern="workOrders"` | ❌ Wave 0 |
| ENG-03 | Claim enqueues offline when no internet | unit | `npm test -- --testPathPattern="sync"` | ✅ (sync.test.ts — add case) |
| ENG-04 | Complete enqueues offline when no internet | unit | `npm test -- --testPathPattern="sync"` | ✅ (sync.test.ts — add case) |
| ENG-05 | Resolution notes sent in complete payload | unit | `npm test -- --testPathPattern="workOrders"` | ❌ Wave 0 |
| ENG-07 | flushSyncQueue handles work_order/claim + work_order/complete | unit | `npm test -- --testPathPattern="sync"` | ✅ (sync.test.ts — extend) |
| INFRA-02 | Push token saved via API not direct Supabase | unit | `npm test -- --testPathPattern="notifications"` | ❌ Wave 0 |
| INFRA-03 | EAS Build produces APK + IPA | manual | Manual: `eas build --platform android --profile preview` | N/A |
| ENG-02 | WO card renders title/priority/status/room | component | `npm test -- --testPathPattern="workOrders"` | ❌ Wave 0 |
| ENG-06 | Push sent when WO assigned (API side) | unit (Python) | `cd apps/api && python -m pytest tests/ -x -k "wo_push"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `cd apps/mobile && npm test -- --passWithNoTests --testPathPattern="sync\|offline"`
- **Per wave merge:** `cd apps/mobile && npm test -- --passWithNoTests`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `apps/mobile/__tests__/lib/offline/sync.test.ts` — extend with `work_order/claim` and `work_order/complete` handler cases (file exists, add cases)
- [ ] `apps/mobile/__tests__/lib/notifications.test.ts` — covers INFRA-02: verifies `savePushTokenToProfile` calls `api.patch` not `supabase`
- [ ] `apps/mobile/__tests__/screens/WorkOrdersList.test.tsx` — covers ENG-01, ENG-02: renders WO cards with correct fields
- [ ] `apps/mobile/__tests__/screens/WorkOrderDetail.test.tsx` — covers ENG-05: completion notes payload
- [ ] `apps/api/tests/smoke/test_wo_push.py` — covers ENG-06: verifies push helper is called on claim

---

## Sources

### Primary (HIGH confidence)

- Official Expo docs: `https://docs.expo.dev/build/eas-json/` — EAS build profile structure, `buildType: "apk"`, `distribution: "internal"`
- Official Expo docs: `https://docs.expo.dev/push-notifications/fcm-credentials/` — FCM V1 setup, `google-services.json` in repo, service account upload
- Official Expo docs: `https://docs.expo.dev/versions/latest/sdk/notifications/` — `getLastNotificationResponseAsync()` for killed-state navigation
- Project source: `apps/api/routers/housekeeping.py` lines 189–246 — `_send_assignment_push` pattern (verified working in Phase 2)
- Project source: `apps/mobile/lib/offline/sync.ts` — `flushSyncQueue` with existing `work_order/update` handler
- Project source: `apps/mobile/lib/notifications.ts` — projectId read pattern + direct Supabase write (confirmed gap)
- Project source: `apps/mobile/app.json` — confirmed missing `extra.eas.projectId`

### Secondary (MEDIUM confidence)

- GitHub expo/expo issue #18403 + #12954 — confirms `addNotificationResponseReceivedListener` not called from killed state; `getLastNotificationResponseAsync()` is the correct solution
- GitHub expo/router issue #636 — community discussion on notification + router integration confirming `router.push(url)` pattern

### Tertiary (LOW confidence)

- None — all critical claims have official source backing

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed present in package.json, no new installs needed
- Architecture: HIGH — patterns are direct extensions of verified Phase 2 patterns already in the codebase
- Pitfalls: HIGH — EAS projectId gap, google-services.json absence, and killed-app push navigation confirmed from source inspection and official docs/issues
- EAS Build: MEDIUM — eas.json structure confirmed from official docs; exact iOS TestFlight flow depends on Apple credentials not yet verified

**Research date:** 2026-03-21
**Valid until:** 2026-06-21 (stable Expo SDK 51; expo-notifications API unlikely to change in this window)
