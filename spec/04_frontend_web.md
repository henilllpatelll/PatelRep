# PatelRep — Frontend Web (Next.js 14)

## 1. Project Structure

```
apps/web/
├── app/                          # Next.js 14 App Router
│   ├── (auth)/
│   │   ├── login/
│   │   │   └── page.tsx          # Login page (magic link + password)
│   │   └── layout.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx            # Sidebar + header shell
│   │   ├── page.tsx              # Redirect to /dashboard
│   │   ├── dashboard/
│   │   │   └── page.tsx          # GM Overview Dashboard
│   │   ├── housekeeping/
│   │   │   ├── page.tsx          # Room Status Board
│   │   │   ├── assignments/
│   │   │   │   └── page.tsx      # Assignment management
│   │   │   └── inspections/
│   │   │       └── page.tsx      # Inspection history
│   │   ├── engineering/
│   │   │   ├── page.tsx          # Work Order Queue
│   │   │   ├── assets/
│   │   │   │   └── page.tsx      # Asset Register
│   │   │   └── pm-schedules/
│   │   │       └── page.tsx      # PM Schedule management
│   │   ├── staff/
│   │   │   └── page.tsx          # Staff management + invites
│   │   ├── scheduling/
│   │   │   └── page.tsx          # Shift calendar
│   │   ├── logbook/
│   │   │   └── page.tsx          # Logbook viewer
│   │   ├── reports/
│   │   │   └── page.tsx          # Report generation
│   │   ├── sop/
│   │   │   └── page.tsx          # SOP library management
│   │   ├── settings/
│   │   │   ├── page.tsx          # General settings
│   │   │   ├── integrations/
│   │   │   │   └── page.tsx      # Opera Cloud + other integrations
│   │   │   └── billing/
│   │   │       └── page.tsx      # Subscription + credit usage
│   │   └── onboarding/
│   │       └── page.tsx          # Onboarding wizard
│   ├── api/                      # Next.js API routes (thin wrappers if needed)
│   └── layout.tsx                # Root layout
├── components/
│   ├── ui/                       # Shadcn/ui primitives
│   ├── dashboard/
│   ├── housekeeping/
│   ├── engineering/
│   ├── shared/
│   └── ai/
├── lib/
│   ├── supabase/                 # Supabase client + server instances
│   ├── api/                      # FastAPI client functions
│   ├── hooks/                    # Custom React hooks
│   └── utils/
├── stores/                       # Zustand global state stores
├── i18n/                         # i18next config + translation files
└── types/                        # TypeScript types (generated from DB schema)
```

---

## 2. Key Pages & Components

### 2.1 GM Dashboard (`/dashboard`)

**Layout:** 4-column grid on desktop, stacks on mobile.

**Components:**

```
<DashboardPage>
  <DashboardHeader>            // "Good morning, John. Here's today at Austin Suites."
  <ROIMetricsStrip>            // 3 metric cards: Labor Saved, Readiness Rate, SLA Compliance
  <AIRiskAlertsPanel>          // Top AI risk alerts (expandable)
  <LiveOpsGrid>
    <RoomStatusSummaryCard>    // Donut: Dirty/Clean/Inspected/OOO counts
    <OpenWorkOrdersCard>       // Count by priority, link to engineering
    <StaffOnShiftCard>         // Who's working today, by dept
    <GuestArrivalCard>         // Today's arrivals, at-risk count
  </LiveOpsGrid>
  <TrendChartsRow>
    <SLAComplianceChart>       // 30-day line chart
    <RoomReadinessChart>       // Weekly bar chart
    <LaborEfficiencyChart>     // Rooms/hr trend
  </TrendChartsRow>
  <AICopilotBubble />          // Persistent (all pages)
</DashboardPage>
```

**`<ROIMetricsStrip>` data:**
```
┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
│  Labor Hours Saved  │ │  Check-in Readiness │ │   SLA Compliance    │
│      12.4 hrs       │ │        94%          │ │        91%          │
│    this week        │ │  ▲ +8% vs last wk   │ │  ▼ -2% vs last wk  │
└─────────────────────┘ └─────────────────────┘ └─────────────────────┘
```

**`<AIRiskAlertsPanel>` data:**
```
⚠ 3 rooms at risk of missing check-in (3PM)
   Room 312 | 45 min late | Housekeeper overloaded → [Reassign]
   Room 408 | 30 min late | Late checkout → [View]

⚡ HVAC Unit 5F-North — 87% failure risk
   3 work orders in 60 days → [Schedule Inspection]

🔴 Work Order WO-1042 — SLA BREACH
   AC Repair Room 514 | 15 min overdue → [View]
```

---

### 2.2 Housekeeping Room Board (`/housekeeping`)

**Component:**
```
<HousekeepingPage>
  <HousekeepingHeader>
    <DatePicker />
    <ShiftSelector />
    <AssignmentModeToggle />      // "View" vs "Assign" mode
    <RiskFilterChip />            // Show only at-risk rooms
    <SyncStatusBadge />           // "Synced with Opera 2 min ago"
  </HousekeepingHeader>
  <RoomStatusBoard>
    <FloorSection floor={4}>
      <RoomCard room={room} />    // See below
      ...
    </FloorSection>
    ...
  </RoomStatusBoard>
  <AssignmentSidebar>            // Shown when AssignmentMode is active
    <HousekeeperWorkloadList />
    <AIAssignButton />
    <SaveAssignmentsButton />
  </AssignmentSidebar>
</HousekeepingPage>
```

**`<RoomCard>` variants by status:**
```
DIRTY (red border)              CLEAN (yellow)
┌─────────────────┐             ┌─────────────────┐
│ 412       DIRTY │             │ 308       CLEAN  │
│ King Suite ⚑VIP │             │ Standard Double  │
│ ▪ Maria Garcia  │             │ Awaiting inspect │
│ ETA: 3:45 PM ⚠ │             │                  │
│ [Reassign]      │             │ [Inspect]        │
└─────────────────┘             └─────────────────┘

INSPECTED (green)               OOO (gray)
┌─────────────────┐             ┌─────────────────┐
│ 201    INSPECTED│             │ 512         OOO  │
│ Double Queen    │             │ AC repair        │
│ Ready for guest │             │ WO-1042 open     │
│ Arrives: 2 PM   │             │                  │
│ [View Details]  │             │ [View WO]        │
└─────────────────┘             └─────────────────┘
```

Color coding:
- DIRTY + HIGH risk = red fill + flashing border
- DIRTY + MEDIUM risk = orange fill
- DIRTY + LOW risk = red fill (normal)
- IN_PROGRESS = blue fill
- CLEAN = yellow fill
- INSPECTED = green fill
- OOO = gray fill

**Drag-and-drop reassignment:** Drag a room card onto a housekeeper name in the Assignment Sidebar.

---

### 2.3 Engineering Work Order Queue (`/engineering`)

```
<EngineeringPage>
  <EngineeringHeader>
    <TabBar tabs={["Open (12)", "In Progress (3)", "Completed", "PM Schedule"]} />
    <FilterBar priority asset_category assigned_to />
    <CreateWorkOrderButton />
  </EngineeringHeader>

  <WorkOrderList>
    <WorkOrderCard wo={workOrder} />
    ...
  </WorkOrderList>

  <FailurePredictionSidebar>
    <AssetRiskRanking />         // Top 5 failure risks
  </FailurePredictionSidebar>
</EngineeringPage>
```

**`<WorkOrderCard>`:**
```
┌───────────────────────────────────────────┐
│ WO-1042          🔴 URGENT    IN PROGRESS  │
│ AC not cooling — Room 514                  │
│ Created: 2h ago by Front Desk              │
│ Assigned: Carlos Rodriguez                 │
│ SLA: 1 hr | ⚠ OVERDUE 15 min             │
│ [View] [Reassign] [Mark Complete]          │
└───────────────────────────────────────────┘
```

---

### 2.4 GM Analytics Dashboard Components

**`<TrendChart>` (Recharts)**:
- SLA compliance rate over 30 days (line)
- Rooms/hr by housekeeper (grouped bar)
- Work orders opened vs completed (area chart)
- AI credit usage trend (line)

**`<StaffPerformanceTable>`:**
```
┌──────────────────────────────────────────────────────────────┐
│ Staff           │ Dept  │ Rooms/Hr │ SLA %  │ Tasks Done │   │
├──────────────────────────────────────────────────────────────┤
│ Maria Garcia    │ HK    │ 2.8      │ 97%    │ 156        │   │
│ Carmen Lopez    │ HK    │ 2.4      │ 91%    │ 138        │   │
│ Carlos Rodriguez│ ENG   │ N/A      │ 89%    │ 42 WOs     │   │
└──────────────────────────────────────────────────────────────┘
```

---

### 2.5 AI Copilot Bubble (All Pages)

Persistent floating button, bottom-right corner on all pages.

```
State: Collapsed
┌────────────────┐
│  🤖  Copilot   │    ← Floating Action Button
└────────────────┘

State: Expanded (chat panel slides up)
┌────────────────────────────────────┐
│  PatelRep AI Copilot           [✕] │
│  ─────────────────────────────     │
│  [AI] Room 312 is at HIGH risk     │
│       for missing 3PM check-in.    │
│       Maria has 8 rooms left.      │
│       Suggest reassigning to Carmen│
│       [Reassign to Carmen] [Dismiss]│
│  ─────────────────────────────     │
│  [You] Show me rooms at risk today  │
│  [AI] 3 rooms at risk:             │
│       • 312 (HIGH, 45 min late)    │
│       • 408 (MEDIUM, 30 min late)  │
│       • 204 (LOW, 10 min late)     │
│  ─────────────────────────────     │
│  ┌──────────────────────────────┐  │
│  │ Ask anything about your ops  │  │
│  └──────────────────────────────┘  │
│  [Quick: Room at risk] [SLA status] │
└────────────────────────────────────┘
```

**Quick action chips** (context-aware, change per page):
- On Dashboard: "Today's at-risk rooms", "SLA status", "Labor efficiency"
- On Housekeeping: "Reassign all late rooms", "Who's fastest today?", "Show VIPs"
- On Engineering: "Most urgent work orders", "Overdue PMs", "Failure risks"

---

### 2.6 Settings — Integrations Page

```
<IntegrationsPage>
  <OperaCloudCard>
    Status: ● Connected (synced 2 min ago)
    Hotel ID: 123456
    Last reservation sync: 2026-03-06 08:15 AM
    [Disconnect] [Test Connection] [Force Sync]
  </OperaCloudCard>

  <SOPLibraryCard>
    12 documents indexed (47 SOP pages)
    [Upload New SOP] [View Library]
  </SOPLibraryCard>
</IntegrationsPage>
```

---

### 2.7 Onboarding Wizard

6-step self-serve wizard with AI assistant sidebar.

```
Step 1: Hotel Profile
  ┌──────────────────────────────┐  ┌────────────────────────────┐
  │ Tell us about your hotel     │  │  AI Assistant              │
  │ ─────────────────────────    │  │  ──────────────────────    │
  │ Hotel Name: [___________]    │  │  Hi! I'm here to help      │
  │ Address:    [___________]    │  │  you get set up.           │
  │ Room Count: [___________]    │  │                            │
  │ Timezone:   [America/Chicago]│  │  Tip: Your room count      │
  │                              │  │  determines your monthly   │
  │ [Continue →]                 │  │  price cap ($2.50/room).   │
  └──────────────────────────────┘  └────────────────────────────┘

Step 2: Import Rooms (CSV or Opera sync)
Step 3: Invite Staff (email + role assignment)
Step 4: Connect Opera Cloud (optional, skippable)
Step 5: Upload SOPs (optional, skippable)
Step 6: Configure PM Schedule (optional)
```

---

## 3. State Management

**Zustand stores:**
```typescript
// stores/hotelStore.ts
interface HotelStore {
  hotel: Hotel | null
  subscription: Subscription | null
  credits: CreditLedger | null
}

// stores/housekeepingStore.ts
interface HousekeepingStore {
  rooms: Room[]
  predictions: RoomPrediction[]
  selectedDate: Date
  selectedShift: Shift | null
  assignmentMode: boolean
  pendingAssignments: Record<string, string> // roomId → userId
}

// stores/notificationStore.ts
interface NotificationStore {
  notifications: Notification[]
  unreadCount: number
}
```

**Supabase Realtime subscriptions (in layout):**
```typescript
// Subscribe to room status changes → update housekeepingStore
supabase.channel('room_status')
  .on('postgres_changes', { event: 'UPDATE', table: 'room_status' }, handler)
  .subscribe()

// Subscribe to task changes
supabase.channel('tasks')
  .on('postgres_changes', { event: '*', table: 'tasks' }, handler)
  .subscribe()
```

---

## 4. Tech Stack Details

| Dependency | Version | Purpose |
|---|---|---|
| Next.js | 14 | App Router, SSR, routing |
| React | 18 | UI framework |
| TypeScript | 5 | Type safety |
| Tailwind CSS | 3 | Styling |
| Shadcn/ui | latest | Component library (built on Radix) |
| Recharts | 2 | Charts and analytics |
| Zustand | 4 | Global state management |
| @supabase/ssr | latest | Supabase SSR client |
| react-i18next | latest | EN/ES i18n |
| @tanstack/react-query | 5 | Server state + caching |
| react-beautiful-dnd | latest | Drag-and-drop room assignments |
| date-fns | 3 | Date manipulation |
| zod | 3 | Schema validation |
| react-hook-form | 7 | Form management |

---

## 5. i18n Setup

```typescript
// i18n/index.ts
i18n.init({
  resources: {
    en: { translation: require('./locales/en.json') },
    es: { translation: require('./locales/es.json') }
  },
  lng: userProfile.language_pref,    // 'en' or 'es'
  fallbackLng: 'en'
})

// Usage
const { t } = useTranslation()
t('housekeeping.room_status.dirty')   // "Dirty" or "Sucia"
t('tasks.priority.urgent')            // "Urgent" or "Urgente"
```

---

## 6. Role-Based UI Rendering

```typescript
// lib/hooks/useRole.ts
export function useRole() {
  const { user } = useAuth()
  return {
    isGM: user.role === 'gm',
    isSupervisor: ['gm', 'housekeeping_supervisor', 'chief_engineer'].includes(user.role),
    canAssignRooms: ['gm', 'housekeeping_supervisor'].includes(user.role),
    canViewBilling: user.role === 'gm',
    canManageStaff: user.role === 'gm',
  }
}

// In component
const { canAssignRooms } = useRole()
{canAssignRooms && <AssignmentModeToggle />}
```

---

## 7. Performance Considerations

- **Room board:** Virtualized list (`react-window`) for hotels with 150+ rooms
- **Realtime:** Debounce Supabase realtime events (50ms) to batch rapid updates
- **Images:** Next.js Image component with Supabase Storage CDN URLs
- **Charts:** Lazy loaded — don't block initial dashboard paint
- **API calls:** React Query with 30s stale time for room board data
- **SLA timer:** Client-side countdown using `setInterval`, not server polling
