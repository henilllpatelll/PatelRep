---
name: patelrep-mobile
description: Expo SDK 51 React Native patterns and conventions for PatelRep apps/mobile/
metadata:
  filePattern: "apps/mobile/**"
  priority: 10
---

# PatelRep Mobile Layer

You are working on the **React Native + Expo SDK 51** staff app at `apps/mobile/`.

## Structure

```
apps/mobile/
├── app/
│   ├── _layout.tsx          Root layout — auth hydration, SplashScreen, i18n init
│   ├── (auth)/              login.tsx, callback.tsx (magic link)
│   └── (app)/               Protected tab navigator (tab bar: Rooms, Tasks, Copilot, Logbook, Notifications)
│       ├── my-rooms/        index.tsx (room list), [roomId].tsx (detail + status update)
│       ├── work-orders/     index.tsx (tabs: Open/Mine/Done), [woId].tsx (detail + claim/complete)
│       ├── tasks/           index.tsx
│       ├── copilot/         index.tsx (AI chat stub)
│       ├── logbook/         index.tsx
│       └── notifications/   index.tsx
├── lib/
│   ├── api.ts               Axios wrapper with JWT + 401 retry (NEVER bypass this for API calls)
│   ├── supabase.ts          Supabase JS client for auth only
│   ├── notifications.ts     Expo Push token registration + handlers
│   ├── i18n.ts              react-i18next setup
│   ├── offline/
│   │   ├── db.ts            Expo SQLite tables (rooms, work_orders, sync_queue)
│   │   └── sync.ts          flushSyncQueue() — plays back offline actions
│   └── api/
│       ├── rooms.ts         Typed API clients
│       ├── workOrders.ts
│       └── notifications.ts
├── stores/
│   └── appStore.ts          Zustand: user, session, hotel, rooms, workOrders, isOffline
├── components/
│   ├── OfflineBanner.tsx    Persistent banner when isOffline
│   └── ...
└── locales/
    ├── en.json
    └── es.json
```

## CRITICAL: Auth & API Rules

- **Auth**: Use `lib/supabase.ts` only for session management (`supabase.auth.*`)
- **All data**: Use `lib/api.ts` (`api.get`, `api.post`, `api.patch`, `api.delete`) — never call Supabase directly for data
- `api.ts` automatically attaches `Authorization: Bearer <token>` from current session
- `api.ts` has 401 auto-retry: refreshes token once then re-issues the request
- API base URL: `EXPO_PUBLIC_API_URL` (e.g., `https://api.patelrep.com/v1`)

## API Call Pattern

```typescript
import api from '@/lib/api'

// GET
const { data } = await api.get<{ data: Room[] }>('/housekeeping/my-rooms')
const rooms = data.data  // unwrap { data: [...] } envelope

// POST
const { data } = await api.post<{ data: WorkOrder }>('/work-orders', payload)
const wo = data.data

// PATCH
await api.patch(`/rooms/${roomId}/status`, { status: 'CLEAN' })
```

## Offline Pattern

Every action that mutates data must handle the offline path:

```typescript
import { isOnline } from '@/stores/appStore'
import { enqueueAction } from '@/lib/offline/sync'

const updateStatus = async (roomId: string, status: string) => {
  // 1. Optimistic update in store
  useAppStore.getState().updateRoomStatus(roomId, status)

  if (isOnline()) {
    // 2a. Online: API call
    await api.patch(`/rooms/${roomId}/status`, { status })
  } else {
    // 2b. Offline: enqueue for later
    await enqueueAction({ type: 'room/update_status', roomId, status })
  }
}
```

`flushSyncQueue()` is called in `lib/offline/sync.ts` when connectivity is restored.

## Sync Queue Action Types

Registered in `sync.ts`:
- `room/update_status`
- `work_order/claim`
- `work_order/complete`
- `work_order/create` (issue reporting)

Adding a new action type: add a `case` in the switch inside `flushSyncQueue()`.

## i18n Pattern

```typescript
import { useTranslation } from 'react-i18next'

const { t } = useTranslation()

// Usage:
t('rooms.status.dirty')          // simple key
t('rooms.checkinTime', { time }) // interpolation — key must use {{time}} in JSON
```

Locale files: `locales/en.json`, `locales/es.json`. Add keys before adding UI text.

## Push Notifications

```typescript
import { registerForPushNotifications } from '@/lib/notifications'

// Call once on app start (after auth):
await registerForPushNotifications()
// This requests permission, gets Expo push token, and PATCHes /staff/me/push-token
```

Deep link targets (in push payload `url` field):
- Rooms: `/(app)/my-rooms/{roomId}`
- Work orders: `/(app)/work-orders/{woId}`

## Navigation

Expo Router file-based. Use `router.push` / `router.replace` / `router.back()`.

```typescript
import { router } from 'expo-router'

router.push(`/(app)/my-rooms/${roomId}`)
router.back()
```

**Auth redirect rule**: Always use `router.replace` (not `router.push`) for auth redirects to avoid back-stack loops.

## Zustand Store

```typescript
import { useAppStore } from '@/stores/appStore'

const { user, hotel, rooms, workOrders, isOffline } = useAppStore()
const { setRooms, updateRoomStatus } = useAppStore()
```

## Styling

NativeWind (Tailwind on React Native). Use `className` prop on View/Text/etc.

```tsx
<View className="flex-1 bg-gray-900 p-4">
  <Text className="text-white text-lg font-semibold">{room.room_number}</Text>
</View>
```

Status colors mirror the web dashboard:
- DIRTY: `bg-red-500`
- IN_PROGRESS: `bg-yellow-500`
- CLEAN: `bg-green-500`
- INSPECTED: `bg-blue-500`
- OUT_OF_ORDER: `bg-gray-500`

## EAS Build

Preview builds (for pilot):
```bash
# Android APK — sideload, no Play Store needed
eas build --platform android --profile preview

# iOS — requires Apple Developer account
eas build --platform ios --profile preview
```

EAS secrets (set before building):
```bash
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value "..."
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "..."
eas secret:create --scope project --name EXPO_PUBLIC_API_URL --value "https://api.patelrep.com/v1"
```

**Current blocker (Phase 3):** `google-services.json` must be generated from Firebase console and added before Android push testing. This is a manual human step.

## Known Decisions (from STATE.md)

- `isLoading` defaults to `true` — auth state is unresolved at store init
- `redirectSystemPath` converts `#` to `?` so Expo Router 3.5 can parse magic link tokens as query params
- `callback.tsx` delegates redirect to `onAuthStateChange` — no `router.replace` on success to avoid session/navigation race
- `asyncio.create_task` fire-and-forget push on API assignment endpoint
- Offline `Alert.alert` removed — `OfflineBanner` in layout already communicates offline state
- Push token returns `null` + `console.warn` when EAS projectId missing — expected in dev without EAS init
