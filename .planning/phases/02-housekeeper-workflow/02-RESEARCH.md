# Phase 2: Housekeeper Workflow - Research

**Researched:** 2026-03-21
**Domain:** React Native (Expo SDK 51) — offline-first mobile, push notifications, i18n, work order creation
**Confidence:** HIGH

---

## Summary

Phase 2 wires the housekeeper's primary workflow: see assigned rooms, move them through DIRTY → IN_PROGRESS → CLEAN, report issues as work orders, and trust that offline updates sync reliably. The mobile scaffold has significant existing code — screens, stores, offline DB, and sync queue are all partially built — but several critical gaps and bugs must be resolved before the requirements can be met.

The most important discovery: much of Phase 2 is **completion and hardening of already-scaffolded code**, not greenfield work. The `my-rooms` screen, room detail drawer, offline DB schema, sync queue, and i18n strings are all present. What is missing or broken is: (1) the `my-rooms` API endpoint does not return `vip_flag`, `checkin_time`, or `predicted_ready_at` fields required by HK-02 and HK-07; (2) `sync.ts` refreshes rooms via the wrong endpoint (`/rooms?my_rooms=true` instead of `/housekeeping/my-rooms`); (3) the push notification flow (HK-05) writes the token directly to Supabase instead of through the API; (4) the Profile screen (PROF-01) does not show hotel name (no API call to fetch it); and (5) the "Report Issue" path (HK-06) has no UI — it exists only as a label in the copilot quickActions i18n string.

**Primary recommendation:** Audit each requirement against what the scaffold provides, fix the gaps in logical dependency order (API fields → room list → detail → issue reporting → push → profile), and write tests for the offline-sync contract because it is the riskiest, least-visible failure mode.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| HK-01 | Housekeeper sees only assigned rooms | `/housekeeping/my-rooms` endpoint exists and filters by `assigned_to + tenant_id`; room list screen exists |
| HK-02 | Room list shows room number, floor, status, ETA | Endpoint missing `predicted_ready_at`; `Room` type + card already render all other fields; ETA field present in i18n and DB |
| HK-03 | Status update DIRTY→IN_PROGRESS→CLEAN in ≤3 taps | Room detail screen + `handleStatusChange` already implement optimistic update; transition rules live in rooms router |
| HK-04 | Status update works offline, syncs on reconnect | `sync_queue` table + `flushSyncQueue` in sync.ts exist; sync triggered via `NetInfo`; `refreshRooms` hits wrong endpoint — must fix |
| HK-05 | Push notification on room assignment | `expo-notifications` installed; `registerForPushNotifications()` exists; token saved directly to Supabase (bypasses API); no assignment push send logic in API yet |
| HK-06 | Report Issue → work order on engineering dashboard | `POST /work-orders` exists with `room_id` param; no mobile UI for report issue exists; must build modal + API call |
| HK-07 | Room detail shows VIP flag + checkin time | `vip_flag` + `checkin_time` columns in DB; API `/my-rooms` endpoint does not include them; RoomDetailScreen does not render them |
| PROF-01 | Profile shows name, role, hotel name | Name + role already rendered from `user` store; hotel name not in `UserProfile` — requires API call to `/hotels/{hotel_id}` |
| PROF-02 | Sign Out returns to login screen | `handleSignOut` calls `supabase.auth.signOut()`; auth listener in Phase 1 handles redirect — already works |
| L10N-01 | All new UI strings have EN + ES translations | i18n setup complete; EN + ES locale files exist with most strings; missing keys for report-issue modal and profile hotel name field |
</phase_requirements>

---

## Standard Stack

### Core (already in project — do not re-install)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| expo | ~51.0.0 | Expo SDK baseline | Project standard |
| expo-router | ~3.5.16 | File-based routing + tab navigator | Project standard |
| expo-sqlite | ~14.0.6 | Offline SQLite DB | Already used for sync_queue + rooms |
| expo-notifications | ~0.28.8 | Push token registration + receive | Already installed + configured |
| @react-native-community/netinfo | 11.3.1 | Online/offline detection | Already used in sync.ts |
| zustand | ^4.5.4 | State (appStore) | Project standard |
| react-i18next | ^14.1.2 | i18n | Already wired in all screens |
| @testing-library/react-native | ^12.9.0 | Component tests | Already in devDeps |
| jest-expo | ^51.0.4 | Jest preset | Already in devDeps + jest.config.js |

### No New Dependencies Required

All libraries needed for Phase 2 are already installed. Do not add new packages.

---

## Architecture Patterns

### Recommended Project Structure (additions only)

```
apps/mobile/
├── app/(app)/
│   ├── my-rooms/
│   │   ├── index.tsx          # EXISTS — needs ETA + floor section added
│   │   └── [roomId].tsx       # EXISTS — needs VIP/checkin, Report Issue button
├── components/
│   └── housekeeping/
│       └── ReportIssueModal.tsx   # NEW — modal for HK-06
├── lib/
│   ├── api/
│   │   └── workOrders.ts          # NEW — typed API client for work orders
│   └── offline/
│       ├── db.ts              # EXISTS — no changes needed
│       └── sync.ts            # EXISTS — fix refreshRooms() endpoint
├── i18n/locales/
│   ├── en.json                # EXISTS — add reportIssue + profile.hotel keys
│   └── es.json                # EXISTS — add same keys in Spanish
└── __tests__/
    ├── components/
    │   └── ReportIssueModal.test.tsx  # NEW
    └── lib/
        └── offline/
            └── sync.test.ts           # NEW — offline flush contract
```

### Pattern 1: Optimistic Status Update with Offline Queue

**What:** Immediately update local state, write to SQLite sync_queue if offline, fire API call if online. Both paths converge on the same final state.

**When to use:** Every status mutation (DIRTY→IN_PROGRESS, IN_PROGRESS→CLEAN)

**Existing implementation** (`apps/mobile/app/(app)/my-rooms/[roomId].tsx`):
```typescript
// Already implemented — reference this pattern, don't rewrite it
async function handleStatusChange(newStatus: string) {
  if (isOnline) {
    const updated = await api.patch<Room>(`/rooms/${room.id}/status`, payload);
    setRoom(updated);
  } else {
    await enqueueAction("room_status", "update", payload, room.id);
    setRoom({ ...room, status: newStatus as Room["status"] }); // optimistic
  }
}
```

**Key insight:** The room detail screen already implements this correctly. Do not rewrite it — extend it.

### Pattern 2: Sync-on-Connect

**What:** When NetInfo detects a transition to online state, flush the sync queue, then refresh rooms from the server.

**Current bug:** `sync.ts` line 56 calls `/rooms?my_rooms=true` — that endpoint does not exist. Must change to `/housekeeping/my-rooms`.

**Corrected pattern:**
```typescript
// apps/mobile/lib/offline/sync.ts — ONLY change this one line
export async function refreshRooms(): Promise<void> {
  try {
    const result = await api.get<{ data: unknown[] }>("/housekeeping/my-rooms");
    await upsertRooms(result.data);   // unwrap { data: [...] }
  } catch (err) {
    console.warn("Failed to refresh rooms:", err);
  }
}
```

**Also note:** The API returns `{ data: [...] }` — the current `refreshRooms` passes the wrapper object directly to `upsertRooms`. Must unwrap `.data`.

### Pattern 3: Modal-Based Issue Reporting

**What:** "Report Issue" button on room detail opens a modal with description field + category select → POST /work-orders with `room_id` pre-filled.

**When to use:** HK-06 only — a focused modal keeps the room detail screen uncluttered.

```typescript
// apps/mobile/components/housekeeping/ReportIssueModal.tsx (new)
// props: roomId, roomNumber, visible, onClose, onSubmit
// Calls POST /work-orders with:
//   { room_id: roomId, title: `Issue in Room ${roomNumber}`, description, category: "general", priority: "normal" }
// On success: close modal + show brief confirmation, no navigation
// Offline: enqueue as work_order/create in sync_queue (already supported by sync.ts)
```

### Pattern 4: Profile Screen Hotel Name

**What:** PROF-01 requires hotel name. `UserProfile` in `appStore` has `hotel_id` but not `hotel_name`. The web uses `GET /hotels/{hotel_id}` to get hotel name.

**Recommended approach:** Add a `hotelName` field to `appStore`, fetch it in the profile screen on mount via `GET /hotels/${user.hotel_id}`, cache in store. Do not add it to `UserProfile` type (the user profile endpoint doesn't join hotel table).

```typescript
// In ProfileScreen — fetch hotel name on mount
const [hotelName, setHotelName] = useState<string>("");
useEffect(() => {
  if (user?.hotel_id) {
    api.get<{ data: { name: string } }>(`/hotels/${user.hotel_id}`)
      .then(res => setHotelName(res.data.name))
      .catch(() => {});
  }
}, [user?.hotel_id]);
```

### Pattern 5: Push Token Registration at Login

**Current state:** `notifications.ts` has `savePushTokenToProfile()` which writes directly to Supabase (`user_profiles.expo_push_token`). This bypasses the API and is flagged as a known concern in STATE.md.

**Decision for Phase 2:** The STATE.md blocker says "plan must decide". For this phase, keep the direct Supabase write — it works functionally and the API endpoint does not exist yet. HK-05 is about the housekeeper *receiving* a notification when a room is assigned, not about the registration path. INFRA-02 (proper API endpoint) is deferred to Phase 3.

**For HK-05:** Room assignment push is triggered server-side. When a GM assigns a room via the web dashboard, the API (housekeeping router `POST /housekeeping/assignments`) needs to send a push to the housekeeper's `expo_push_token`. This logic must be added to the API, not the mobile app.

### Anti-Patterns to Avoid

- **Don't re-fetch all rooms on every status change.** The detail screen already updates local state optimistically. Only call `refreshRooms` on sync flush or explicit pull-to-refresh.
- **Don't show Alert.alert for offline status changes.** The current detail screen does `Alert.alert("", t("common.offline"))` on offline update — this is disruptive. Replace with a brief in-card success indicator or trust that the OfflineBanner (already visible) communicates the offline state.
- **Don't create a new i18n namespace.** All strings go into the flat `translation` namespace. Use dot-notation keys: `"rooms.reportIssue"`, `"profile.hotel"`, etc.
- **Don't write to `sync_queue` for work order creation if online.** Only enqueue when offline. Fire directly to API when connected.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Network state detection | Custom ping logic | `@react-native-community/netinfo` (already used) | Handles airplane mode, cell vs. WiFi, etc. |
| Offline queue persistence | In-memory array | `sync_queue` SQLite table (already exists) | Survives app kills; already wired in sync.ts |
| Push token registration | Manual APNs/FCM code | `expo-notifications` (already installed) | Cross-platform; handles permissions |
| i18n string interpolation | Template strings | `react-i18next` `t()` with params e.g. `t("rooms.eta", {time})` | Already configured |
| Optimistic UI rollback | Custom diff state | Zustand + local `setRoom` (already pattern in detail screen) | Simpler than CRDT or event sourcing for this use case |

---

## Common Pitfalls

### Pitfall 1: API Response Envelope Mismatch
**What goes wrong:** The FastAPI backend wraps all responses in `{ "data": [...] }` or `{ "data": {...} }`. The current `sync.ts` passes the entire response object to `upsertRooms()` instead of `.data`. This silently stores an empty room list and the housekeeper sees a blank screen after reconnect.
**Why it happens:** `api.get<unknown[]>()` is typed as returning the raw array, but the actual response shape is `{ data: [...] }`.
**How to avoid:** Always type API calls as `api.get<{ data: T[] }>()` and unwrap before storing. The room list screen (`index.tsx`) already does this correctly by calling `/housekeeping/my-rooms` — the sync.ts is the outlier.
**Warning signs:** Room list empty after pull-to-refresh post-offline period.

### Pitfall 2: `require_role("housekeeper")` vs `get_current_user`
**What goes wrong:** `/housekeeping/my-rooms` uses `require_role("housekeeper")`. If a GM or supervisor tries to use the housekeeper screen (e.g., during testing), they get a 403. During development on a GM test account this looks like a broken endpoint.
**How to avoid:** Use a dedicated housekeeper test account when testing HK-01 through HK-07. Note this in the plan.

### Pitfall 3: SQLite WAL Mode and Concurrent Writes
**What goes wrong:** `sync.ts` and UI components both write to the SQLite DB. Without a mutex, concurrent writes during sync flush can corrupt the queue (item double-deleted or partially written).
**Why it happens:** `_syncInProgress` flag in `sync.ts` prevents concurrent flushes, but UI `enqueueAction` calls are not gated.
**How to avoid:** The existing `_syncInProgress` guard in `flushSyncQueue` is sufficient since `enqueueAction` is only called during offline status changes (not during flush). Do not add more locking complexity.

### Pitfall 4: `expo-notifications` projectId
**What goes wrong:** `registerForPushNotifications()` has `projectId: "YOUR_EXPO_PROJECT_ID"` as a placeholder. Without the real EAS project ID, `getExpoPushTokenAsync` throws and push token registration silently fails.
**Why it happens:** Scaffold was written before EAS project was configured.
**How to avoid:** Read the projectId from `expo-constants` (`Constants.expoConfig?.extra?.eas?.projectId`) instead of hardcoding. Alternatively read from `app.json` `extra.eas.projectId` if set. For Phase 2, push registration is needed for HK-05; the EAS build itself is Phase 3.
**Warning signs:** `registerForPushNotifications()` returns `null` even when permissions are granted.

### Pitfall 5: Missing i18n Keys Cause Silent Blank Text
**What goes wrong:** `t("rooms.reportIssue")` returns the key string `"rooms.reportIssue"` if the key is missing in the locale file. This looks like a bug in the UI but is actually a missing translation.
**How to avoid:** Add both EN and ES translations before building any new screen that uses them. The rule in this project: translation keys go in before the component is built.

### Pitfall 6: `my-rooms` Endpoint Missing VIP/ETA Fields
**What goes wrong:** `GET /housekeeping/my-rooms` selects `rooms(id, room_number, floor, room_types(...))` but does NOT select `vip_flag`, `checkin_time`, `predicted_ready_at`, or `risk_level` from `room_status`. The mobile `Room` type has these fields but they will always be `null` even when the backend has data.
**How to avoid:** Extend the Supabase select in `housekeeping.py` `get_my_rooms()` to include these fields from `room_status` directly (they are columns on `room_status`, not a join).

---

## Code Examples

### Corrected `my-rooms` API endpoint (backend change required)

```python
# apps/api/routers/housekeeping.py — get_my_rooms()
# Current (missing fields):
.select("*, rooms(id, room_number, floor, room_types(name, base_clean_minutes))")

# Fixed (adds all fields needed by HK-02 and HK-07):
.select(
    "id, room_id, tenant_id, status, assigned_to, "
    "vip_flag, checkin_time, risk_level, predicted_ready_at, "
    "rooms(id, room_number, floor, room_types(name, base_clean_minutes))"
)
```

### ReportIssueModal minimal contract

```typescript
// apps/mobile/components/housekeeping/ReportIssueModal.tsx
interface ReportIssueModalProps {
  visible: boolean;
  roomId: string;
  roomNumber: string;
  onClose: () => void;
}
// POST /work-orders body:
const payload = {
  room_id: roomId,
  title: `Issue in Room ${roomNumber}`,
  description,          // from TextInput
  category: "general",  // default; could offer a picker
  priority: "normal",
};
// Offline path: enqueueAction("work_order", "create", payload) — already handled by sync.ts
```

### Push notification server-side send (API addition for HK-05)

```python
# apps/api/routers/housekeeping.py — after inserting room_assignment row
# Fetch housekeeper's expo_push_token from user_profiles
# Use Expo Push API (httpx POST to https://exp.host/--/api/v2/push/send)
# Only if token present — never block the assignment on push failure
import httpx

async def _send_assignment_push(hotel_id: str, housekeeper_id: str, room_number: str):
    profile = supabase.table("user_profiles") \
        .select("expo_push_token") \
        .eq("id", housekeeper_id) \
        .single().execute()
    token = (profile.data or {}).get("expo_push_token")
    if not token:
        return
    async with httpx.AsyncClient() as client:
        await client.post("https://exp.host/--/api/v2/push/send", json={
            "to": token,
            "title": "Room Assigned",
            "body": f"Room {room_number} has been assigned to you",
            "data": {"type": "room_assignment", "room_number": room_number},
        })
```

### i18n new keys needed (en.json additions)

```json
{
  "rooms": {
    "reportIssue": "Report Issue",
    "reportIssueTitle": "Report an Issue",
    "reportIssueDescription": "Describe the issue...",
    "issueSubmitted": "Issue reported successfully",
    "issueCategory": "Category",
    "checkinTime": "Check-in: {{time}}",
    "vipGuest": "VIP Guest"
  },
  "profile": {
    "hotel": "Hotel",
    "title": "Profile"
  }
}
```
(Mirror keys in `es.json`)

---

## Gap Analysis: What Exists vs. What's Needed

| Requirement | Mobile Screen | API Endpoint | Gap |
|-------------|---------------|--------------|-----|
| HK-01 | `my-rooms/index.tsx` — renders assigned rooms | `/housekeeping/my-rooms` with `assigned_to` filter | Sync endpoint mismatch in `sync.ts` |
| HK-02 | `RoomCard` renders status, room number, floor | `/my-rooms` missing `predicted_ready_at`, `risk_level` | API field gap + ETA display logic |
| HK-03 | `[roomId].tsx` handles full status cycle optimistically | `PATCH /rooms/{id}/status` with transition validation | None — already works |
| HK-04 | `sync_queue` + `flushSyncQueue` exist | Same patch endpoint | `refreshRooms()` wrong URL + response unwrap |
| HK-05 | `registerForPushNotifications()` exists | No push-send on assignment | Placeholder `projectId` + no server-side send |
| HK-06 | No UI exists | `POST /work-orders` with `room_id` param | Need `ReportIssueModal` + API client |
| HK-07 | Detail screen has `vip_flag` + `risk_level` render | `/my-rooms` missing `vip_flag`, `checkin_time` | API field gap |
| PROF-01 | Name + role displayed; hotel name absent | `GET /hotels/{id}` returns `name` field | Need hotel name fetch in profile screen |
| PROF-02 | `handleSignOut` calls `supabase.auth.signOut()` | N/A | Already works; auth listener handles redirect |
| L10N-01 | EN + ES locale files exist | N/A | Missing keys for reportIssue + profile.hotel |

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `expo-notifications` v1 API (`.getExpoPushTokenAsync()` with no options) | v0.28 requires `{ projectId }` option | Must pass projectId or registration fails |
| Direct Supabase writes for token storage | API-mediated token storage (Phase 3) | Phase 2 keeps direct write; acceptable for pilot |
| `expo-sqlite` legacy synchronous API | `expo-sqlite` v14 async API with `openDatabaseAsync` + `withTransactionAsync` | Already used correctly in `db.ts` |

---

## Validation Architecture

`nyquist_validation` is enabled in `.planning/config.json`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | jest-expo 51.0.4 + @testing-library/react-native 12.9.0 |
| Config file | `apps/mobile/jest.config.js` |
| Quick run command | `cd apps/mobile && npx jest --passWithNoTests --testPathPattern="__tests__"` |
| Full suite command | `cd apps/mobile && npx jest --passWithNoTests` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HK-04 | `flushSyncQueue` processes room_status items and calls PATCH endpoint | unit | `npx jest __tests__/lib/offline/sync.test.ts -x` | Wave 0 |
| HK-04 | `flushSyncQueue` skips failed items, leaves them in queue | unit | same file | Wave 0 |
| HK-04 | `refreshRooms` calls `/housekeeping/my-rooms` and unwraps `data` | unit | same file | Wave 0 |
| HK-06 | `ReportIssueModal` renders and calls POST /work-orders on submit | unit | `npx jest __tests__/components/ReportIssueModal.test.tsx -x` | Wave 0 |
| HK-06 | `ReportIssueModal` enqueues to sync_queue when offline | unit | same file | Wave 0 |
| PROF-02 | Sign Out calls `supabase.auth.signOut()` | unit | manual-only — requires auth mock setup beyond scope | N/A |

Tests for HK-01, HK-02, HK-03, HK-07, PROF-01, L10N-01 are verified manually on device per the success criteria (visual/interaction-based).

### Sampling Rate
- **Per task commit:** `cd apps/mobile && npx jest --passWithNoTests --testPathPattern="__tests__"` (< 30 seconds)
- **Per wave merge:** `cd apps/mobile && npx jest --passWithNoTests`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `apps/mobile/__tests__/lib/offline/sync.test.ts` — covers HK-04 (sync queue flush + room refresh)
- [ ] `apps/mobile/__tests__/components/ReportIssueModal.test.tsx` — covers HK-06 (issue reporting UI + offline path)

---

## Open Questions

1. **Expo Project ID for push tokens**
   - What we know: `notifications.ts` hardcodes `"YOUR_EXPO_PROJECT_ID"`; the `app.json` does not have `extra.eas.projectId` set
   - What's unclear: Whether the EAS project exists in the Expo dashboard for this account
   - Recommendation: Read from `Constants.expoConfig?.extra?.eas?.projectId` with a fallback; document that HK-05 requires EAS project creation (a one-time step), but do not block Phase 2 on it — HK-05 can be the last plan in the phase

2. **`POST /housekeeping/assignments` push trigger point**
   - What we know: The mobile app receives pushes; the push must be sent when a GM assigns a room (web dashboard action)
   - What's unclear: Which API call triggers assignment — `POST /housekeeping/assignments` (bulk upsert) or the auto-assign endpoint
   - Recommendation: Add push send after the bulk upsert in the assignments router; make it fire-and-forget (background task, never block the HTTP response)

3. **`Alert.alert` on offline update — UX decision**
   - What we know: Current detail screen shows `Alert.alert("", t("common.offline"))` after queueing a status change
   - What's unclear: Whether the pilot hotel finds this disruptive or reassuring
   - Recommendation: Replace with a toast-style `StatusBar` flash or remove entirely (OfflineBanner already visible) — this is Claude's discretion; plan should choose one approach

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `apps/mobile/` — all screens, stores, offline lib, i18n files
- Direct code inspection: `apps/api/routers/housekeeping.py`, `rooms.py`, `work_orders.py`, `staff.py`
- Direct schema inspection: `supabase/migrations/004_rooms.sql`, `013_ai_systems.sql`
- `apps/mobile/package.json` — exact library versions

### Secondary (MEDIUM confidence)
- Expo SDK 51 docs (expo-notifications 0.28) — `getExpoPushTokenAsync` requires `projectId` option
- Expo Push Notifications API — `https://exp.host/--/api/v2/push/send` endpoint shape

### Tertiary (LOW confidence)
- None — all findings based on direct codebase inspection

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed from package.json
- Architecture: HIGH — all patterns derived from existing code; gaps identified by direct diff of API contract vs. mobile types
- Pitfalls: HIGH — all pitfalls confirmed by reading actual code, not speculation

**Research date:** 2026-03-21
**Valid until:** 2026-04-21 (stable stack, no fast-moving dependencies)
