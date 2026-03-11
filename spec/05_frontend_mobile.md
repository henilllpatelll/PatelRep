# PatelRep — Frontend Mobile (React Native + Expo)

## 1. Project Structure

```
apps/mobile/
├── app/                          # Expo Router (file-based routing)
│   ├── (auth)/
│   │   ├── login.tsx             # Login screen
│   │   └── _layout.tsx
│   ├── (app)/
│   │   ├── _layout.tsx           # Tab navigator (role-based tabs)
│   │   ├── index.tsx             # Home screen (role-based redirect)
│   │   ├── my-rooms/
│   │   │   ├── index.tsx         # Housekeeper: My Rooms list
│   │   │   └── [roomId].tsx      # Room detail screen
│   │   ├── work-orders/
│   │   │   ├── index.tsx         # Engineer: Work order queue
│   │   │   └── [woId].tsx        # Work order detail
│   │   ├── tasks/
│   │   │   ├── index.tsx         # Task list (front desk / supervisor)
│   │   │   └── [taskId].tsx      # Task detail
│   │   ├── inspect/
│   │   │   └── [roomId].tsx      # Supervisor inspection screen
│   │   ├── copilot/
│   │   │   └── index.tsx         # Full-screen AI Copilot chat
│   │   ├── logbook/
│   │   │   └── index.tsx         # Logbook entries
│   │   ├── notifications/
│   │   │   └── index.tsx         # Notification center
│   │   └── profile/
│   │       └── index.tsx         # Staff profile + settings
├── components/
│   ├── housekeeping/
│   ├── engineering/
│   ├── tasks/
│   ├── copilot/
│   └── shared/
├── lib/
│   ├── supabase.ts               # Supabase client (React Native)
│   ├── api/                      # FastAPI client
│   ├── offline/
│   │   ├── db.ts                 # Expo SQLite setup
│   │   ├── sync.ts               # Online/offline sync engine
│   │   └── queue.ts              # Offline write queue
│   └── notifications.ts          # Expo Push setup
├── stores/                       # Zustand stores
├── i18n/                         # react-i18next EN/ES
└── types/
```

---

## 2. Navigation Structure (Role-Based Tabs)

```typescript
// Role → Tab configuration
const ROLE_TABS = {
  housekeeper: [
    { name: 'my-rooms', icon: 'bed', label: 'My Rooms' },
    { name: 'copilot', icon: 'robot', label: 'Copilot' },
    { name: 'logbook', icon: 'book', label: 'Logbook' },
    { name: 'notifications', icon: 'bell', label: 'Alerts' },
  ],
  engineer: [
    { name: 'work-orders', icon: 'wrench', label: 'Work Orders' },
    { name: 'copilot', icon: 'robot', label: 'Copilot' },
    { name: 'logbook', icon: 'book', label: 'Logbook' },
    { name: 'notifications', icon: 'bell', label: 'Alerts' },
  ],
  housekeeping_supervisor: [
    { name: 'my-rooms', icon: 'grid', label: 'Room Board' },
    { name: 'tasks', icon: 'checkmark', label: 'Tasks' },
    { name: 'copilot', icon: 'robot', label: 'Copilot' },
    { name: 'notifications', icon: 'bell', label: 'Alerts' },
  ],
  front_desk: [
    { name: 'tasks', icon: 'list', label: 'Requests' },
    { name: 'my-rooms', icon: 'bed', label: 'Rooms' },
    { name: 'copilot', icon: 'robot', label: 'Copilot' },
    { name: 'notifications', icon: 'bell', label: 'Alerts' },
  ],
}
```

---

## 3. Key Screens

### 3.1 Housekeeper Home — "My Rooms" (`/my-rooms`)

The primary screen for housekeeping staff. Dead simple.

```
┌──────────────────────────────────────────────┐
│  ☰  Good morning, Maria!    🔔(3)  [EN|ES]   │
│  Today: Thursday, March 6 · Morning Shift     │
│  ──────────────────────────────────────────   │
│  YOUR ROOMS TODAY (8)                         │
│  ──────────────────────────────────────────   │
│  ┌────────────────────────────────────────┐   │
│  │  🔴 Room 412      CHECKOUT · VIP       │   │
│  │  King Suite · ~40 min                  │   │
│  │  John Smith arrives at 3 PM ⚠ Priority │   │
│  │  [Start Cleaning]                      │   │
│  └────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────┐   │
│  │  🔴 Room 308      CHECKOUT             │   │
│  │  Standard Double · ~25 min             │   │
│  │  No early arrival                      │   │
│  │  [Start Cleaning]                      │   │
│  └────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────┐   │
│  │  🔵 Room 214      IN PROGRESS          │   │
│  │  Standard Double · Started 9:15 AM     │   │
│  │  [Mark Clean]  [Add Note]              │   │
│  └────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────┐   │
│  │  🟡 Room 201    STAYOVER · PICKUP      │   │
│  │  King Suite · ~20 min                  │   │
│  │  [Start Service]                       │   │
│  └────────────────────────────────────────┘   │
│  ──────────────────────────────────────────   │
│  COMPLETED TODAY: 2 rooms                     │
│  ──────────────────────────────────────────   │
│                                               │
│  [🤖 Copilot]  [🔔 Alerts]  [📖 Logbook]     │
└──────────────────────────────────────────────┘
```

**AI Copilot Bubble** — floating bottom-right on all screens:
```
                              ┌─────────────┐
                              │ 🤖 Ask AI   │
                              └─────────────┘
```
Tapping opens the copilot overlay.

---

### 3.2 Room Detail Screen (`/my-rooms/[roomId]`)

```
┌──────────────────────────────────────────────┐
│  ← Room 412                    ⚑ VIP         │
│  ──────────────────────────────────────────   │
│  STATUS: IN PROGRESS                         │
│  Started: 9:42 AM (18 min ago)               │
│  ──────────────────────────────────────────   │
│  GUEST INFO                                   │
│  John Smith → Check-in 3:00 PM               │
│  VIP Level: Platinum                          │
│  Requests: Extra pillows, hypoallergenic      │
│  ──────────────────────────────────────────   │
│  ROOM INFO                                    │
│  King Suite · Floor 4 · 650 sqft              │
│  Last cleaned: Yesterday 2:15 PM by Maria G.  │
│  ──────────────────────────────────────────   │
│  MAINTENANCE NOTES                            │
│  ⚠ WO-1038 (2 days ago): Bathroom faucet      │
│    drip — Fixed by Carlos R.                  │
│  ──────────────────────────────────────────   │
│  QUICK ACTIONS                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Report   │ │  Extra   │ │  Maintenance │  │
│  │ Issue    │ │ Amenities│ │  Request     │  │
│  └──────────┘ └──────────┘ └──────────────┘  │
│  ──────────────────────────────────────────   │
│  [Mark Clean]                                 │
└──────────────────────────────────────────────┘
```

Quick action buttons pre-fill the AI copilot with context ("Report issue in Room 412").

---

### 3.3 AI Copilot Screen (`/copilot`)

Full-screen version + persistent overlay on all other screens.

```
┌──────────────────────────────────────────────┐
│  ← AI Copilot                                │
│  ──────────────────────────────────────────   │
│  [AI] Good morning, Maria! You have 8 rooms  │
│       today. Room 412 is a VIP arrival at    │
│       3PM — I suggest starting there.        │
│  ──────────────────────────────────────────   │
│  [You] Room 412 needs extra towels and VIP   │
│        turndown setup                        │
│  ──────────────────────────────────────────   │
│  [AI] Got it! I'll create:                   │
│       ✓ Extra towels → Room 412 (you)        │
│       ✓ VIP turndown setup → Room 412 (you)  │
│       Priority: Urgent (VIP guest 3PM)        │
│       ┌──────────────┐ ┌───────────────────┐ │
│       │  ✓ Confirm  │ │  ✏ Edit Details  │ │
│       └──────────────┘ └───────────────────┘ │
│  ──────────────────────────────────────────   │
│  QUICK ACTIONS                                │
│  [Report Issue] [Extra Amenities] [Ask SOP]   │
│  ──────────────────────────────────────────   │
│  ┌──────────────────────────────────────────┐ │
│  │ Type a message or tap quick action...    │ │
│  └──────────────────────────────────────────┘ │
│  (EN)                                    [↑]  │
└──────────────────────────────────────────────┘
```

**Language toggle:** Small `EN|ES` toggle in top bar. Switches the copilot response language and UI labels.

---

### 3.4 Engineer Work Order Queue (`/work-orders`)

```
┌──────────────────────────────────────────────┐
│  ☰  Work Orders              🔔(2)           │
│  [🔴 Urgent (2)] [Normal (5)] [Completed]    │
│  ──────────────────────────────────────────   │
│  ┌────────────────────────────────────────┐   │
│  │  🔴 WO-1042        URGENT · OPEN       │   │
│  │  AC not cooling — Room 514             │   │
│  │  Created 2h ago · SLA: ⚠ OVERDUE 15m  │   │
│  │  [Claim & Start]                       │   │
│  └────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────┐   │
│  │  🔴 WO-1044        URGENT · OPEN       │   │
│  │  Toilet not flushing — Room 201        │   │
│  │  Created 45 min ago · SLA: 15 min left │   │
│  │  [Claim & Start]                       │   │
│  └────────────────────────────────────────┘   │
│  ──────────────────────────────────────────   │
│  ┌────────────────────────────────────────┐   │
│  │  🟡 WO-1039        NORMAL · IN PROGRESS│   │
│  │  Replace light fixture — Lobby         │   │
│  │  Assigned to you · Started 10:20 AM    │   │
│  │  [View] [Mark Complete]                │   │
│  └────────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

---

### 3.5 Work Order Detail Screen (`/work-orders/[woId]`)

```
┌──────────────────────────────────────────────┐
│  ← WO-1042                     🔴 URGENT     │
│  ──────────────────────────────────────────   │
│  AC not cooling — Room 514                   │
│  ──────────────────────────────────────────   │
│  Status: IN PROGRESS                         │
│  Assigned: Carlos Rodriguez (you)             │
│  SLA: ⚠ OVERDUE — 15 minutes                │
│  Created by: Front Desk · 2h ago             │
│  ──────────────────────────────────────────   │
│  DESCRIPTION                                  │
│  Guest reported AC not working. Temp in       │
│  room is 78F. Guest checking out at 11AM.     │
│  ──────────────────────────────────────────   │
│  ASSET                                        │
│  HVAC Unit — Room 514 (2019, Carrier 42XL15)  │
│  History: 2 work orders in last 90 days       │
│  ──────────────────────────────────────────   │
│  PHOTOS                                       │
│  [+ Before Photo]  [+ After Photo]            │
│  ──────────────────────────────────────────   │
│  NOTES / PARTS USED                           │
│  [___________________________________]        │
│  ──────────────────────────────────────────   │
│  Labor Hours: [1.5]                           │
│  ──────────────────────────────────────────   │
│  [Mark Complete]                              │
└──────────────────────────────────────────────┘
```

---

### 3.6 Supervisor Inspection Screen (`/inspect/[roomId]`)

```
┌──────────────────────────────────────────────┐
│  ← Inspect Room 412          King Suite      │
│  ──────────────────────────────────────────   │
│  BATHROOM                          2/3 ✓     │
│  ┌──────────────────────────────────────────┐ │
│  │ ✅ Toilet clean and flushing             │ │
│  │ ✅ Sink and countertop clean             │ │
│  │ ❌ Towels folded correctly    [Note]     │ │
│  └──────────────────────────────────────────┘ │
│  ──────────────────────────────────────────   │
│  SLEEPING AREA                     3/3 ✓     │
│  ┌──────────────────────────────────────────┐ │
│  │ ✅ Bed made with hospital corners        │ │
│  │ ✅ Pillows fluffed and positioned        │ │
│  │ ✅ Nightstand clear and dusted           │ │
│  └──────────────────────────────────────────┘ │
│  ──────────────────────────────────────────   │
│  GENERAL                           3/4 ✓     │
│  ┌──────────────────────────────────────────┐ │
│  │ ✅ Floor vacuumed                        │ │
│  │ ✅ Trash emptied                         │ │
│  │ ✅ Amenities fully stocked               │ │
│  │ ❌ TV remote in designated spot [Note]   │ │
│  └──────────────────────────────────────────┘ │
│  ──────────────────────────────────────────   │
│  RESULT: ⚠ CONDITIONAL                       │
│  2 items failed. Mark as:                    │
│  [✅ Pass (overlook)] [❌ Fail (re-clean)]    │
└──────────────────────────────────────────────┘
```

If "Fail" is selected: housekeeper gets push notification, room resets to DIRTY.

---

## 4. Offline Mode Implementation

```typescript
// lib/offline/db.ts — Expo SQLite local cache
import * as SQLite from 'expo-sqlite'
const db = SQLite.openDatabase('patelrep.db')

// Tables: rooms_cache, tasks_cache, work_orders_cache, pending_writes

// lib/offline/sync.ts
export async function syncOnReconnect() {
  const pending = await getPendingWrites()
  for (const write of pending) {
    try {
      await applyWrite(write)           // POST to FastAPI
      await markWriteComplete(write.id)
    } catch (e) {
      if (isConflict(e)) {
        await handleConflict(write, e)  // Server wins for assignments
      }
    }
  }
  await pullLatestData()                // Refresh local cache
}

// lib/offline/queue.ts
export async function queueWrite(action: PendingWrite) {
  await db.runAsync(
    'INSERT INTO pending_writes (action, payload, created_at) VALUES (?, ?, ?)',
    [action.type, JSON.stringify(action.payload), new Date().toISOString()]
  )
}
```

**Network state detection:**
```typescript
import NetInfo from '@react-native-community/netinfo'
NetInfo.addEventListener(state => {
  if (state.isConnected) syncOnReconnect()
  setOnlineStatus(state.isConnected)
})
```

---

## 5. Push Notifications Setup

```typescript
// lib/notifications.ts
import * as Notifications from 'expo-notifications'

export async function registerForPushNotifications() {
  const { status } = await Notifications.requestPermissionsAsync()
  if (status !== 'granted') return null

  const token = await Notifications.getExpoPushTokenAsync({
    projectId: process.env.EXPO_PROJECT_ID
  })

  // Save token to FastAPI → stored on user profile
  await api.post('/users/push-token', { token: token.data })
  return token.data
}

// Notification handlers
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

// Deep link on tap: notification data contains { type, task_id, room_id, work_order_id }
// → navigate to relevant screen
```

---

## 6. i18n (EN/ES) Implementation

```typescript
// i18n/en.json (excerpt)
{
  "rooms": {
    "status": {
      "dirty": "Dirty",
      "clean": "Clean",
      "inspected": "Inspected",
      "in_progress": "In Progress",
      "ooo": "Out of Order"
    },
    "start_cleaning": "Start Cleaning",
    "mark_clean": "Mark Clean"
  },
  "copilot": {
    "placeholder": "Ask anything about your operations...",
    "quick_actions": {
      "report_issue": "Report Issue",
      "extra_amenities": "Extra Amenities",
      "ask_sop": "Ask SOP"
    }
  }
}

// i18n/es.json (excerpt)
{
  "rooms": {
    "status": {
      "dirty": "Sucia",
      "clean": "Limpia",
      "inspected": "Inspeccionada",
      "in_progress": "En Proceso",
      "ooo": "Fuera de Servicio"
    },
    "start_cleaning": "Comenzar Limpieza",
    "mark_clean": "Marcar como Limpia"
  }
}
```

Language preference is stored on `user_profiles.language_pref` and loaded on login. Staff can toggle in Profile settings.

---

## 7. Tech Stack

| Dependency | Version | Purpose |
|---|---|---|
| Expo | SDK 51 | Build toolchain, native APIs |
| React Native | 0.74 | UI framework |
| Expo Router | 3 | File-based navigation |
| TypeScript | 5 | Type safety |
| Zustand | 4 | Global state |
| @supabase/supabase-js | 2 | DB client + realtime |
| expo-sqlite | latest | Local offline cache |
| expo-notifications | latest | Push notifications |
| expo-camera | latest | Photo capture for work orders |
| expo-file-system | latest | File handling |
| expo-image-picker | latest | Gallery photo picker |
| react-i18next | latest | EN/ES translations |
| @react-native-community/netinfo | latest | Network state detection |
| react-native-reanimated | 3 | Smooth animations |
| NativeWind | 4 | Tailwind CSS for React Native |
| date-fns | 3 | Date formatting |
| zod | 3 | Input validation |

---

## 8. Expo EAS Build & Distribution

```json
// eas.json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "ios": { "simulator": false }
    },
    "production": {
      "ios": { "buildConfiguration": "Release" },
      "android": { "buildType": "apk" }
    }
  },
  "submit": {
    "production": {
      "ios": { "appleId": "...", "ascAppId": "..." },
      "android": { "serviceAccountKeyPath": "..." }
    }
  }
}
```

**Distribution flow:**
1. Beta testers (pilot hotel): Expo Go app + development build
2. Internal testing: TestFlight (iOS) + Play Store internal track (Android)
3. Production: App Store + Play Store submission via `eas submit`

---

## 9. Performance Targets

- App cold start: < 2 seconds
- Room list render (100 rooms): < 200ms (FlatList with getItemLayout)
- AI Copilot response (NL→task): < 1 second (GPT-4o-mini target)
- Status board realtime update: < 300ms from DB change to UI
- Photo upload (compression): Max 2MB per photo (auto-compressed with expo-image-manipulator)
