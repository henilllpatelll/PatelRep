# Day Simulation Audit — PatelRep
*Simulated: full shift cycle across Housekeeper → Supervisor → Engineer → Chief → GM roles*
*Date: 2026-04-14*

---

## Bugs (confirmed code issues)

### B1 — AI Auto-Assign silently discards its result
**File:** `apps/web/app/(dashboard)/housekeeping/assignments/page.tsx:71–82`

```ts
const handleAiAutoAssign = async () => {
  setAiLoading(true)
  try {
    await housekeepingApi.aiSuggestAssignments(date)
    // In a real implementation this would open a suggestions modal  ← literal code comment
  } catch {
    // noop
  } finally {
    setAiLoading(false)
  }
}
```

The button shows a spinner, calls the AI endpoint, then nothing happens. No modal, no toast, no error message. Users will click it repeatedly thinking it's broken. The catch block silently swallows errors too, so failures are invisible.

---

### B2 — Housekeeper "done" count includes unconfirmed CLEAN rooms
**File:** `apps/web/app/(dashboard)/housekeeping/page.tsx:355`

```ts
const doneCount = myRooms.filter((r) => r.status === 'CLEAN' || r.status === 'INSPECTED').length
```

`CLEAN` means "awaiting supervisor inspection" — not done. The stats strip at the top shows a misleadingly inflated "done" number. A housekeeper who cleaned 8 rooms sees 8 "done" but a supervisor might not have inspected any yet. Should be `INSPECTED` only.

---

### B3 — Notes are saved via `updateRoomStatus` with no actual status change
**File:** `apps/web/components/housekeeping/RoomDetailDrawer.tsx:188`

```ts
async function handleAddNote() {
  // ...
  await housekeepingApi.updateRoomStatus(roomId, status, noteText.trim())
  // passes current status back unchanged, just to attach a note
}
```

This re-triggers all backend side effects tied to status changes — history log entries, Realtime broadcast events, and any notification hooks. Every note creates a spurious `DIRTY → DIRTY` (or whatever the current status) entry in the room's status history, polluting the audit trail.

---

### B4 — Housekeeper chip badge double-counts after saving assignments
**File:** `apps/web/app/(dashboard)/housekeeping/page.tsx:199–201`

```ts
{hk.rooms_assigned + assignedCount}
```

After `handleSave()` completes, `clearPendingAssignments()` zeroes out `pendingAssignments` but `hk.rooms_assigned` still holds the pre-save server value until the React Query cache refetches. The badge shows `N + N` (double) for a brief window, which looks like a bug to supervisors monitoring load balance.

---

### B5 — "Good morning" greeting hardcoded in all role dashboards
**Files:**
- `apps/web/components/dashboard/HousekeeperDashboard.tsx:93`
- `apps/web/components/dashboard/EngineerDashboard.tsx:100`
- `apps/web/components/dashboard/SupervisorDashboard.tsx:59`

All dashboards say "Good morning, {name}!" regardless of time of day. Hotel staff work all three shifts — a night-shift engineer clocking in at 11 PM is greeted with "Good morning." A simple time-of-day check (morning / afternoon / evening) is missing across the board.

---

### B6 — Framer Motion `layoutId` shared between independent sidebar subtrees
**File:** `apps/web/components/shared/Sidebar.tsx:205` and `:266`

Both `renderNavItem` (main nav) and `renderBottomLink` (Settings / Billing at the bottom) use `layoutId="sidebar-active"`. Framer Motion uses this ID to animate the active indicator between elements. When the active route is Settings (bottom link) and a main nav item was previously active, the spring tries to animate between two elements in different DOM positions, causing a visual jump or a misplaced indicator overlay.

---

## Navigation & Operation Issues

### N1 — Engineers have no work orders list page *(highest friction issue)*
**File:** `apps/web/app/(dashboard)/engineering/page.tsx`

```ts
export default function EngineeringPage() {
  redirect('/engineering/assets')
}
```

The entire engineering section contains three pages: Assets, PM Schedules, Predictions. There is no `/engineering/work-orders` route anywhere in the app. The `engineer` role's core daily task is to see and action their work order queue, but clicking "Full list →" on the Engineer Dashboard goes to `/engineering` which immediately redirects to the Assets page (capital equipment inventory with risk scores and warranty dates). An engineer on the floor cannot get a full filtered/sorted view of their work orders from any page other than the 20-item dashboard card.

---

### N2 — "Maintenance" sidebar nav goes to Assets, not Work Orders
**File:** `apps/web/components/shared/Sidebar.tsx:62–68`

The `engineer` role sees "Maintenance" in the sidebar. Clicking it lands on the Assets table — the wrong page for someone starting a shift. Assets is a management tool for chief engineers, not a daily operations view for floor engineers.

---

### N3 — Inspections sub-nav is misleadingly named
**File:** `apps/web/components/shared/Sidebar.tsx:55` | `apps/web/app/(dashboard)/housekeeping/inspections/page.tsx`

`/housekeeping/inspections` is a read-only history table with date range and result filters. The nav label "Inspections" implies this is where you *perform* inspections, but actual inspections are initiated from the Room Board drawer via `InspectionModal`. Supervisors searching for where to run inspections will land on the wrong page and be confused.

---

### N4 — After inspection completes, drawer closes with no continuity
**File:** `apps/web/components/housekeeping/RoomDetailDrawer.tsx:663–671`

```tsx
<InspectionModal
  onSuccess={() => {
    setShowInspectionModal(false)
    onClose()   // closes the drawer entirely
  }}
/>
```

On success, both the modal and the room drawer close. The supervisor is dropped back to the full board with no forward motion. Inspection shifts involve 10–20 rooms in sequence; each one requires: scan board → find next CLEAN room → tap → open drawer → click "Inspect" → submit → board drops back. A "Next room" shortcut or queue-based inspect mode would significantly reduce this friction.

---

### N5 — Notification bell is rendered but permanently hidden
**File:** `apps/web/components/shared/Header.tsx:121`

```tsx
<button
  className="hidden p-2 rounded-xl ..."   // ← display:none
  aria-label="Notifications"
>
  <Bell size={16} />
</button>
```

The bell icon is hidden with a `hidden` Tailwind class. There is no in-app notification panel accessible from anywhere in the UI, even though the system supports push notifications and in-app alerts. Staff have no way to review missed notifications from the header.

---

### N6 — Housekeeper gets no feedback loop after marking a room CLEAN
**File:** `apps/web/app/(dashboard)/housekeeping/page.tsx:287–292`

After tapping "Done" the room card shows "Waiting for supervisor" text. There is no:
- Timestamp of when the room became CLEAN
- Indication of whether the supervisor was automatically notified
- Estimated wait time

Housekeepers are left uncertain whether to walk over to the supervisor or wait. On busy checkouts days this gap causes floor-level coordination delays.

---

### N7 — "Tap for notes & issues" hint text is nearly invisible
**File:** `apps/web/app/(dashboard)/housekeeping/page.tsx:266`

```tsx
<p className="text-[10px] text-gray-300 mt-1">Tap for notes &amp; issues</p>
```

10px font in `gray-300` (near-white) on a white card, viewed on a phone in a hotel corridor. The note and work-order feature inside the room drawer is completely hidden from most housekeepers because the call-to-action is unreadable. Should be at minimum `text-xs text-gray-400`.

---

### N8 — Assignments page and Room Board are parallel and confusing
**Files:** `apps/web/app/(dashboard)/housekeeping/assignments/page.tsx` | `apps/web/app/(dashboard)/housekeeping/page.tsx`

The sidebar "Housekeeping" section has two overlapping assignment-related entries:
- **Room Board** (`/housekeeping`) — interactive board with chip-tap assignment and drag-and-drop
- **Assignments** (`/housekeeping/assignments`) — read-only table showing housekeeper load breakdown

A supervisor trying to *manage* assignments goes to "Assignments" and finds a read-only view. They have to figure out to go back to the board. The Assignments page also has an "Auto-Assign with AI" button that is broken (see B1), amplifying the confusion.

---

### N9 — Logbook has no "Jump to Today" shortcut
**File:** `apps/web/app/(dashboard)/logbook/page.tsx`

Date navigation is prev/next arrows only. After browsing historical entries, returning to today requires clicking → multiple times. The Inspections page has a "Today" shortcut button — the Logbook doesn't, despite identical date-navigation patterns.

---

### N10 — Scheduling week view has no visual "today" indicator
**File:** `apps/web/app/(dashboard)/scheduling/page.tsx`

The 7-column weekly grid has no highlighted column or marker showing which day is today. Staff opening the schedule mid-week must scan all column headers to orient themselves. This is standard calendar UX that's missing.

---

### N11 — Work orders submitted from the room drawer are untraceable
**File:** `apps/web/components/housekeeping/RoomDetailDrawer.tsx:218`

```tsx
setWoSuccess(`Work order submitted — engineering team notified for Room ${roomLabel}`)
setTimeout(() => setWoSuccess(null), 6000)  // disappears after 6s
```

The success banner disappears with no persistent record. No WO number is shown on the room card. No link to engineering. The housekeeper who reported "Toilet not flushing" in Room 203 has no way to later check what happened with that ticket.

---

## Quick Wins (low effort, high impact)

| # | Fix | File | Effort |
|---|-----|------|--------|
| B1 | Show AI suggestions in a modal or display a toast on error | `assignments/page.tsx:77` | Small |
| B2 | Change `doneCount` filter to `INSPECTED` only | `housekeeping/page.tsx:355` | Trivial |
| B3 | Add a dedicated `POST /v1/housekeeping/rooms/:id/notes` API call instead of re-POSTing a status update | `routers/housekeeping.py` + API client | Medium |
| B4 | Invalidate `staff-list` query immediately after save, or rely solely on `pendingAssignments` for the badge | `housekeeping/page.tsx:104-108` | Small |
| B5 | Add a `getGreeting()` helper based on `new Date().getHours()` | All dashboard components | Trivial |
| B6 | Give bottom-nav links a unique `layoutId` like `"sidebar-bottom-active"` | `Sidebar.tsx:266` | Trivial |
| N5 | Either unhide the bell and wire it to a notifications panel, or remove it from the DOM | `Header.tsx:121` | Small |
| N7 | Change hint text to `text-xs text-gray-400` | `housekeeping/page.tsx:266` | Trivial |
| N9 | Add "Today" button next to date navigation arrows | `logbook/page.tsx` | Small |
| N3 | Rename "Inspections" sub-nav label to "Inspection History" | `Sidebar.tsx:55` | Trivial |

---

## Structural Gaps

### G1 — No dedicated Work Orders page for engineers
The most impactful missing page in the app. Engineers need a full-page work order list with status tabs (Open / In Progress / On Hold / Completed), priority sort, and search by room or title. Currently the only way to see all WOs is the 20-item dashboard card. A `/engineering/work-orders` page with these filters would cover the engineer role's entire workday.

### G2 — No batch inspect / inspect queue flow
Room inspection is a sequential batch operation — a supervisor walks floor-by-floor inspecting every CLEAN room. The current UX is: tap room → open drawer → click "Inspect & Mark Clean" → complete form → drawer closes → find next room → repeat. A mode where completing one inspection auto-advances to the next CLEAN room (or shows a queue count) would reduce the tap count significantly for a 20-room inspection round.

### G3 — AI Auto-Assign is scaffolded but fully non-functional
The API endpoint exists, the button exists, and the loading state works. But the result is silently discarded (B1). This is the highest-visibility "broken" feature in the supervisor workflow. Completing the suggestion modal or replacing the button with an honest "Coming Soon" label would prevent repeated confusion.
