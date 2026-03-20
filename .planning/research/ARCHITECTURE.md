# Architecture Research

**Domain:** React Native / Expo mobile app — hotel staff operations (offline-capable, push notifications, FastAPI backend)
**Researched:** 2026-03-19
**Confidence:** HIGH (based on direct codebase analysis + established Expo patterns)

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    MOBILE APP (Expo SDK 51)                       │
├──────────────────────────────────────────────────────────────────┤
│  SCREENS (Expo Router v3 — file-based)                           │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────┐  │
│  │  my-rooms/  │  │ work-orders/│  │  tasks/  │  │ profile/ │  │
│  │  index.tsx  │  │  index.tsx  │  │ index.tsx│  │index.tsx │  │
│  │  [roomId]   │  │   [woId]    │  │          │  │          │  │
│  └──────┬──────┘  └──────┬──────┘  └────┬─────┘  └────┬─────┘  │
│         │                │              │              │         │
├─────────┴────────────────┴──────────────┴──────────────┴─────────┤
│  STATE LAYER (Zustand)                                            │
│  ┌─────────────────┐  ┌─────────────────┐                        │
│  │   appStore      │  │  workOrderStore  │  (to be created)      │
│  │ user, isOnline, │  │  workOrders,     │                        │
│  │ myRooms,        │  │  activeTab       │                        │
│  │ unreadCount     │  │                  │                        │
│  └────────┬────────┘  └────────┬─────────┘                       │
│           │                    │                                  │
├───────────┴────────────────────┴──────────────────────────────────┤
│  DATA ACCESS LAYER                                                │
│  ┌───────────────┐  ┌───────────────┐  ┌────────────────────┐   │
│  │ lib/api/      │  │ lib/offline/  │  │ lib/notifications  │   │
│  │ client.ts     │  │ db.ts         │  │ .ts                │   │
│  │ (fetch+JWT)   │  │ sync.ts       │  │ (Expo Push)        │   │
│  └───────┬───────┘  └───────┬───────┘  └────────────────────┘   │
│          │                  │                                     │
├──────────┴──────────────────┴───────────────────────────────────┤
│  PLATFORM SERVICES                                               │
│  ┌───────────────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │  Supabase Auth    │  │  expo-sqlite   │  │  NetInfo       │  │
│  │  (AsyncStorage    │  │  (patelrep.db) │  │  (connectivity)│  │
│  │   session persist)│  │                │  │                │  │
│  └───────────────────┘  └────────────────┘  └────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
          │ HTTPS + Bearer JWT                │ Expo Push Service
          ▼                                   ▼
┌─────────────────────┐             ┌─────────────────────┐
│  FastAPI (Railway)  │             │  APNs / FCM         │
│  /v1/housekeeping/  │             │  (via Expo Push)    │
│  /v1/work-orders/   │             └─────────────────────┘
│  /v1/rooms/         │
└─────────────────────┘
          │ admin.invite / auth.getUser
          ▼
┌─────────────────────┐
│  Supabase           │
│  (auth only from    │
│   mobile — no       │
│   direct DB calls)  │
└─────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `app/_layout.tsx` (root) | Auth state listener, NetInfo listener, push setup, sync trigger on reconnect | appStore, supabase.auth, NetInfo, notifications, sync |
| `app/(auth)/_layout.tsx` | Redirect unauthenticated users to login | appStore |
| `app/(app)/_layout.tsx` | Role-based tab rendering via `getTabsForRole(role)` | appStore (user.role) |
| `app/(app)/my-rooms/index.tsx` | Housekeeper room list — online fetch + SQLite fallback | api, appStore, offline/db |
| `app/(app)/my-rooms/[roomId].tsx` | Room detail — status update, report issue | api, offline/db, sync queue |
| `app/(app)/work-orders/index.tsx` | Engineer work order list with open/in_progress/completed tabs | api, workOrderStore |
| `app/(app)/work-orders/[woId].tsx` | Work order detail — claim, status update, add notes | api, offline/db, sync queue |
| `stores/appStore.ts` | Global auth, network state, housekeeper room list, notification badge | All screens |
| `stores/workOrderStore.ts` | Work order list + active tab state (to be created — mirrors appStore pattern) | Work order screens |
| `lib/api/client.ts` | Authenticated fetch wrapper — reads Supabase session for JWT, all HTTP verbs | supabase.auth |
| `lib/offline/db.ts` | SQLite schema init + CRUD for rooms, tasks, work_orders, sync_queue | expo-sqlite |
| `lib/offline/sync.ts` | NetInfo check, flush sync queue to API, refresh rooms from API | api/client, offline/db |
| `lib/notifications.ts` | Expo push permission request, token retrieval, save token to Supabase user_profiles | expo-notifications, supabase |
| `lib/supabase.ts` | Supabase client with AsyncStorage session persistence | @supabase/supabase-js |

## Recommended Project Structure

```
apps/mobile/
├── app/
│   ├── _layout.tsx              # Root: auth listener, NetInfo, push setup
│   ├── (auth)/
│   │   ├── _layout.tsx          # Stack layout — no tab bar
│   │   └── login.tsx            # Magic link + password sign-in
│   └── (app)/
│       ├── _layout.tsx          # Tabs — rendered by role
│       ├── my-rooms/
│       │   ├── index.tsx        # Housekeeper room list (offline-capable)
│       │   └── [roomId].tsx     # Room detail + status actions
│       ├── work-orders/
│       │   ├── index.tsx        # Engineer WO list with status tabs
│       │   └── [woId].tsx       # WO detail + claim + notes
│       ├── tasks/
│       │   └── index.tsx        # Shared task list (stub → real API)
│       ├── copilot/
│       │   └── index.tsx        # AI stub — deferred to v2
│       └── profile/
│           └── index.tsx        # User name, role, hotel, language toggle
├── stores/
│   ├── appStore.ts              # Auth + network + myRooms + unreadCount
│   └── workOrderStore.ts        # Work orders + active tab (to be created)
├── lib/
│   ├── api/
│   │   ├── client.ts            # Base fetch wrapper (exists)
│   │   ├── rooms.ts             # Typed room API methods (to be created)
│   │   └── workOrders.ts        # Typed WO API methods (to be created)
│   ├── offline/
│   │   ├── db.ts                # SQLite schema + CRUD (exists)
│   │   └── sync.ts              # Queue flush + room refresh (exists)
│   ├── notifications.ts         # Push token setup (exists — needs projectId fix)
│   └── supabase.ts              # Supabase client (exists)
├── i18n/
│   ├── index.ts
│   └── locales/
│       ├── en.json
│       └── es.json
├── app.json
├── eas.json
└── package.json
```

### Structure Rationale

- **`app/(auth)/` vs `app/(app)/`:** Expo Router group segments let the root layout render a `<Stack>` with two named children; the `(app)` group's own layout handles tabs, so auth screens never show a tab bar.
- **`stores/` split by domain:** `appStore` stays lean (auth + network + global badge). Work order state goes in `workOrderStore` to avoid a monolithic store that every screen re-renders on every update.
- **`lib/api/` domain modules:** `client.ts` is the base fetch wrapper; domain files (`rooms.ts`, `workOrders.ts`) export typed functions. Screens import domain functions, not the raw `api` object — this makes mock/test substitution easy and keeps type safety at the call site.
- **`lib/offline/` isolated:** All SQLite logic is behind `db.ts`; `sync.ts` orchestrates the queue + API bridge. Screens should never call `db.ts` directly for mutations — always go through the sync pattern.

## Architectural Patterns

### Pattern 1: Offline-First Mutation (Write-Through to SQLite + Queue)

**What:** On any status update, write to SQLite immediately (optimistic UI), enqueue to `sync_queue`, then attempt the API call. If the API call succeeds, delete the queue item. If it fails, leave it in the queue for the next `syncOnConnect()` call.

**When to use:** Any mutation the housekeeper or engineer makes on the floor — room status updates, WO status changes, adding notes.

**Trade-offs:** UI is always snappy (no spinner waiting for network). Risk of a brief stale state if server-side validation rejects the transition. For this domain (simple status state machine) the server should rarely reject, so this is acceptable.

**Example:**
```typescript
// Pattern: optimistic local write → queue → attempt API
async function updateRoomStatus(roomId: string, newStatus: string) {
  // 1. Update SQLite immediately (UI reflects instantly)
  await upsertRooms([{ ...currentRoom, status: newStatus }]);
  appStore.getState().setMyRooms(await getRooms() as Room[]);

  // 2. Enqueue for reliable delivery
  await enqueueAction("room_status", "update", { status: newStatus }, roomId);

  // 3. Attempt live sync if online
  if (appStore.getState().isOnline) {
    await flushSyncQueue();
  }
}
```

### Pattern 2: Auth Token Flow (Supabase JWT → FastAPI)

**What:** The mobile app authenticates with Supabase (magic link or password). Supabase issues a JWT that contains `hotel_id` and `role` as custom claims (injected by Supabase Auth Hook). Every API call reads the current session via `supabase.auth.getSession()` and passes the `access_token` as `Authorization: Bearer`. FastAPI middleware decodes the JWT using the Supabase JWT secret and extracts `hotel_id` + `role`.

**When to use:** Every API call — no exception. The API client (`lib/api/client.ts`) already handles this automatically.

**Trade-offs:** `supabase.auth.getSession()` is async — adds ~1ms overhead per call, acceptable. Token refresh is automatic via `autoRefreshToken: true`. On token expiry during a long offline session, the next online sync will trigger a refresh before flushing the queue.

**Token refresh edge case:** `flushSyncQueue()` calls `api.patch/post` which calls `getAuthHeader()` which calls `getSession()`. Supabase auto-refreshes if the token is expired. No explicit refresh handling needed in sync code.

**Example:**
```typescript
// Already implemented in lib/api/client.ts
// Supabase session → Bearer token on every request
async function getAuthHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  return { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
}
```

### Pattern 3: Push Token Registration at Login

**What:** After `onAuthStateChange` fires `SIGNED_IN`, the root layout calls `setupPushNotifications()`. This requests permission, gets the Expo push token, and saves it directly to `user_profiles.expo_push_token` via Supabase client. The FastAPI prediction service reads `expo_push_token` from `user_profiles` when sending supervisor alerts.

**When to use:** Called once after sign-in in the root layout `useEffect`. Should be idempotent — re-registration with the same token is safe.

**Trade-offs:** Current implementation writes directly to Supabase from mobile (the one exception to the API-first rule). This is intentional — it avoids a round-trip through FastAPI for a simple profile update. The token is not sensitive enough to require API-layer validation.

**Critical fix needed:** `notifications.ts` line 35 has `projectId: "YOUR_EXPO_PROJECT_ID"` hardcoded. Must be replaced with `Constants.expoConfig?.extra?.eas?.projectId` read from `app.json` at build time.

**Example:**
```typescript
// Fix for notifications.ts — read projectId from app config
import Constants from "expo-constants";

const token = await Notifications.getExpoPushTokenAsync({
  projectId: Constants.expoConfig?.extra?.eas?.projectId,
});
```

### Pattern 4: Role-Based Navigation (Expo Router Tabs)

**What:** The `(app)/_layout.tsx` calls `getTabsForRole(user.role)` to determine which tab screens to render. All tab screens exist as files on disk; `getTabsForRole` controls which appear in the tab bar. This means all routes are always accessible via deep link but the tab bar surfaces only role-appropriate ones.

**When to use:** This pattern already exists. Do not render conditional route groups (e.g., a separate `(housekeeper)/` group) — that creates routing complexity for no benefit at pilot scale.

**Trade-offs:** All screens load regardless of role (minor bundle impact). Acceptable for a ~6 screen app. If a screen has sensitive data, the API enforces role-gating on the server, so client-side tab hiding is UX only, not a security boundary.

**Role-to-tab mapping:**

| Role | Tabs Shown |
|------|-----------|
| `housekeeper` | My Rooms, Tasks, Copilot (stub), Profile |
| `engineer` | Work Orders, Tasks, Copilot (stub), Profile |
| `housekeeping_supervisor`, `front_desk`, `gm`, others | My Rooms, Work Orders, Tasks, Copilot (stub), Profile |

### Pattern 5: NetInfo-Driven Sync Lifecycle

**What:** Root layout registers a single `NetInfo.addEventListener` listener. On every connectivity change, it updates `appStore.isOnline`. When transitioning from offline → online, it calls `syncOnConnect()` which: (1) flushes the sync queue, (2) refreshes the room list from the API.

**When to use:** This pattern is already wired in `app/_layout.tsx`. The work orders list does not yet use this pattern — it fetches on mount only, with no SQLite fallback.

**Planned extension:** Work orders need the same pattern as rooms — fetch from API when online, fall back to SQLite `work_orders` table, and enqueue mutations. The SQLite schema for `work_orders` already exists in `db.ts`.

## Data Flow

### Request Flow: Room Status Update (Online)

```
Housekeeper taps "Mark Clean"
    ↓
[roomId].tsx calls updateRoomStatus()
    ↓
upsertRooms([{...room, status: "CLEAN"}])  →  SQLite rooms table (immediate)
    ↓
appStore.setMyRooms(await getRooms())      →  UI re-renders (optimistic)
    ↓
enqueueAction("room_status", "update", {status:"CLEAN"}, roomId)  →  SQLite sync_queue
    ↓
isOnline? → flushSyncQueue()
    ↓
api.patch(`/rooms/${roomId}/status`, {status:"CLEAN"})
    ↓
FastAPI: JWT decode → hotel_id + role check → state machine validate → DB update
    ↓
deleteSyncQueueItem(id)  →  queue item removed
```

### Request Flow: Room Status Update (Offline → Sync on Reconnect)

```
Housekeeper taps "Mark Clean" (no connectivity)
    ↓
SQLite write + optimistic UI update (same as online)
    ↓
enqueueAction() → item sits in sync_queue
    ↓
[phone reconnects — NetInfo fires]
    ↓
app/_layout.tsx NetInfo listener → syncOnConnect()
    ↓
flushSyncQueue() iterates queue in FIFO order
    ↓
api.patch("/rooms/{id}/status") for each queued item
    ↓
deleteSyncQueueItem(id) on success, leaves on failure (retry next sync)
    ↓
refreshRooms() → upsertRooms() → appStore.setMyRooms()
    ↓
UI shows server-authoritative state
```

### Request Flow: Auth Token → API

```
App launch
    ↓
supabase.auth.onAuthStateChange fires SIGNED_IN
    ↓
supabase.from("user_profiles").select("*").eq("id", user.id)  (direct Supabase call)
    ↓
appStore.setUser(profile)  →  isAuthenticated = true
    ↓
setupPushNotifications() → Expo permission → getExpoPushTokenAsync()
    ↓
supabase.from("user_profiles").update({expo_push_token})  (direct Supabase call)
    ↓
[App screens mount — each screen calls api.get/post/patch]
    ↓
lib/api/client.ts getAuthHeader() → supabase.auth.getSession()
    ↓
session.access_token → Authorization: Bearer {JWT}
    ↓
FastAPI middleware → jwt.decode(token, supabase_jwt_secret)
    ↓
hotel_id + role extracted from claims → request proceeds
```

### Push Notification Flow: Room Assignment Alert

```
Supervisor assigns room to housekeeper (web dashboard)
    ↓
FastAPI: POST /housekeeping/assignments
    ↓
Background: notify_supervisors_high_risk() or assignment notification
    ↓
FastAPI reads user_profiles.expo_push_token for assigned housekeeper
    ↓
POST https://exp.host/--/api/v2/push/send  {to: token, title: "Room Assigned", body: "Room 214"}
    ↓
Expo Push Service → APNs (iOS) / FCM (Android)
    ↓
Device receives notification
    ↓
[If app is foregrounded] Notifications.setNotificationHandler fires shouldShowAlert: true
    ↓
[If app is backgrounded] System notification tray
```

### State Management

```
supabase.auth.onAuthStateChange
    ↓ setUser()
appStore (user, isAuthenticated, isOnline, myRooms, unreadCount)
    ↓ subscribed by
All screens via useAppStore() selector hooks

NetInfo.addEventListener
    ↓ setIsOnline() + syncOnConnect()
appStore.isOnline
    ↓ read by
my-rooms/index.tsx (decides online fetch vs SQLite fallback)
work-orders/index.tsx (should read — currently does not, gap to fill)

API calls → response data
    ↓ upsertRooms() + setMyRooms()
SQLite + appStore (dual write — SQLite is cache, Zustand is UI)
```

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1 hotel (pilot, ~80 rooms, 8 staff) | Current architecture is sufficient. SQLite sync queue, Zustand stores, single API. |
| 10 hotels (~800 rooms, 80 staff) | Add `workOrderStore` split from appStore. Add pagination to room list (currently fetches all assigned rooms — fine at 15 rooms/housekeeper). |
| 100+ hotels | Add background fetch (Expo TaskManager) for periodic sync instead of only on NetInfo reconnect. Add retry with exponential backoff in `flushSyncQueue`. |

### Scaling Priorities

1. **First bottleneck:** `sync_queue` can accumulate if staff work offline for long shifts. Current implementation processes up to 50 items per flush (LIMIT 50 in `getPendingSyncQueue`). Sufficient for pilot. Will need pagination or batch endpoint for heavy offline use.
2. **Second bottleneck:** `appStore.myRooms` holds all assigned rooms in memory. At pilot scale (~15 rooms/housekeeper), this is trivial. Over 100 rooms per housekeeper, consider virtualization (already using FlatList, which handles this).

## Anti-Patterns

### Anti-Pattern 1: Direct Supabase DB Calls from Mobile for Domain Data

**What people do:** Call `supabase.from("rooms").select()` directly from mobile screens instead of going through the FastAPI.

**Why it's wrong:** Bypasses the FastAPI role validation layer, state machine enforcement, and audit logging. RLS will catch unauthorized reads, but the business logic (valid transitions, SLA calculation, history rows) only runs in FastAPI.

**Do this instead:** Call `api.get("/housekeeping/my-rooms")`, `api.patch("/rooms/{id}/status")` — the existing `client.ts` pattern. The two legitimate direct Supabase calls (auth state and push token save to `user_profiles`) are intentional and documented.

### Anti-Pattern 2: Storing Zustand State Without SQLite Mirror for Offline-Critical Data

**What people do:** Add work order data to Zustand without writing to the `work_orders` SQLite table.

**Why it's wrong:** When the app restarts offline, Zustand state is gone. SQLite persists across app restarts. The `work_orders` table already exists in `db.ts` — use it.

**Do this instead:** Any data the engineer needs when on the floor should follow the same dual-write pattern as rooms: `upsertWorkOrders(data)` to SQLite, then `setWorkOrders(data)` to Zustand. On mount, check SQLite first, then API.

### Anti-Pattern 3: Per-Screen NetInfo Subscriptions

**What people do:** Each screen registers its own `NetInfo.addEventListener` to know if it's online.

**Why it's wrong:** Multiple listeners for the same event, redundant re-renders, harder to reason about connectivity state.

**Do this instead:** `isOnline` lives in `appStore`. Screens read `useAppStore(s => s.isOnline)`. Only the root layout (`_layout.tsx`) registers the NetInfo listener, which is already the pattern in this codebase.

### Anti-Pattern 4: Calling `syncOnConnect()` Inside Screen Components

**What people do:** Add sync calls inside `useEffect` in individual screens to ensure fresh data.

**Why it's wrong:** Race condition with the root layout's NetInfo listener — two concurrent flushes can send duplicate API mutations.

**Do this instead:** Screens trigger a re-fetch of their own data (pull-to-refresh or `useEffect` on mount). Only the root layout calls `syncOnConnect()`. The `_syncInProgress` mutex in `sync.ts` partially protects against this, but the right fix is architecture: one sync orchestrator.

### Anti-Pattern 5: Hardcoded Expo Project ID in notifications.ts

**What people do (and what is currently scaffolded):** `projectId: "YOUR_EXPO_PROJECT_ID"` placeholder in `getExpoPushTokenAsync`.

**Why it's wrong:** `getExpoPushTokenAsync` without a valid project ID fails silently in Expo Go and throws in production builds. No push tokens are registered.

**Do this instead:**
```typescript
import Constants from "expo-constants";
const projectId = Constants.expoConfig?.extra?.eas?.projectId
  ?? Constants.easConfig?.projectId;
```
Then ensure `app.json` has `"extra": { "eas": { "projectId": "<uuid>" } }`.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| FastAPI (Railway) | `lib/api/client.ts` — authenticated fetch, `EXPO_PUBLIC_API_URL` env var | All domain mutations go here |
| Supabase Auth | `lib/supabase.ts` — `supabase.auth.onAuthStateChange`, `AsyncStorage` session persistence | Token auto-refresh enabled |
| Supabase DB (user_profiles) | Direct call for push token save only — `supabase.from("user_profiles").update()` | Only legitimate non-API DB call |
| Expo Push Notifications | `lib/notifications.ts` — permission request, `getExpoPushTokenAsync`, save to user_profiles | Needs projectId fix before first device build |
| APNs / FCM | Not called directly — mediated by Expo Push Service at `https://exp.host/--/api/v2/push/send` | FastAPI calls this; mobile only receives |
| NetInfo | `@react-native-community/netinfo` — single listener in root layout | Drives sync lifecycle and offline banner |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Screens → State | Zustand `useAppStore()` / `useWorkOrderStore()` selectors | No prop-drilling past 1 level |
| Screens → API | Domain functions in `lib/api/rooms.ts`, `lib/api/workOrders.ts` (not raw `api` object) | Type-safe domain wrappers, consistent with web pattern |
| API mutations → SQLite | `enqueueAction()` + `upsertRooms()`/`upsertWorkOrders()` — dual write | SQLite is ground truth when offline |
| Root layout → sync | `syncOnConnect()` called only from root NetInfo listener | Single orchestrator — no screen-level sync calls |
| Push token → Supabase | Direct `supabase.from("user_profiles").update()` in `notifications.ts` | Exception to API-first rule; documented and intentional |

## Build Order Implications

The component dependencies imply this build sequence:

1. **Foundation (already exists):** `lib/supabase.ts`, `lib/api/client.ts`, `lib/offline/db.ts`, `stores/appStore.ts`
2. **Fix push token registration:** `lib/notifications.ts` — projectId placeholder blocks all push functionality; fix before any push testing
3. **Typed API domain modules:** `lib/api/rooms.ts` + `lib/api/workOrders.ts` — screens depend on these for typed calls
4. **Room status update flow:** `app/(app)/my-rooms/[roomId].tsx` — needs typed API + sync queue write pattern
5. **Work order store + offline:** `stores/workOrderStore.ts` + `upsertWorkOrders()` in `db.ts` — WO screens need this before they can go offline-capable
6. **Work order detail flow:** `app/(app)/work-orders/[woId].tsx` — claim + status update + notes require store + API modules
7. **Profile screen:** `app/(app)/profile/index.tsx` — reads from appStore; no API dependency beyond what's already loaded at auth
8. **End-to-end push:** Wire `notify_assignment` call in FastAPI when assignment is created — reads `expo_push_token` from `user_profiles`

## Sources

- Direct codebase analysis: `apps/mobile/` (2026-03-19)
- `lib/offline/db.ts` — confirms SQLite schema for rooms, tasks, work_orders, sync_queue
- `lib/offline/sync.ts` — confirms queue flush pattern and room refresh flow
- `lib/notifications.ts` — confirms push setup flow and the hardcoded projectId gap
- `app/_layout.tsx` — confirms root layout owns NetInfo listener + auth subscription
- `app/(app)/_layout.tsx` — confirms role-based tab rendering pattern
- `stores/appStore.ts` — confirms Zustand shape; work order state not yet present
- `apps/api/routers/work_orders.py` — confirms `/work-orders?status=` filter endpoint exists
- `.planning/codebase/ARCHITECTURE.md` — system-level context (multi-tenant JWT, API-first mobile rule)
- Expo SDK 51 managed workflow — offline-first patterns are well-established in this version

---
*Architecture research for: React Native Expo hotel staff mobile app (PatelRep Mobile)*
*Researched: 2026-03-19*
