# Day Simulation Audit — PatelRep
*Simulated: full shift cycle across Housekeeper → Supervisor → Engineer → Chief → GM roles*
*Last run: 2026-04-15 (via Playwright against production)*

---

## Status Legend
- 🔴 **Open** — not fixed
- 🟡 **Regressed** — changed but still broken (or worse)
- ✅ **Fixed** — confirmed resolved in production
- 🆕 **New** — discovered this session

---

## Bugs (confirmed code issues)

### ✅ B7 — React hydration errors on every page load (10 errors)
**Files:**
- `apps/web/app/(dashboard)/dashboard/page.tsx:20` — hardcoded `"Good morning"` string in SSR
- `apps/web/components/dashboard/EngineerDashboard.tsx:66-67`
- `apps/web/components/dashboard/HousekeeperDashboard.tsx:64-65`
- `apps/web/components/dashboard/SupervisorDashboard.tsx:23-24`

React errors #418 ("Hydration failed"), #423 ("entire root switches to client rendering"), and #425 ("Text content does not match server-rendered HTML") fire on every dashboard page load. The `new Date().getHours()` calls in role dashboards render a time-based greeting on both server and client — the server render time (UTC, at request time) differs from the client render time (browser local time), causing a mismatch. The GM dashboard has no time check at all and always SSR-renders `"Good morning"`.

**Fix:** Wrap the greeting in a `useEffect`+`useState` pattern so it only renders client-side, or add `suppressHydrationWarning` on the specific element.

---

### ✅ B8 — Room Board defaults to tomorrow for US hotels after ~7 PM local time
**File:** `apps/web/stores/housekeepingStore.ts:43-44`

```ts
function todayISO(): string {
  return new Date().toISOString().split('T')[0]  // ← UTC date, not local
}

selectedDate: todayISO(),  // line 50 — Zustand initial state
```

`toISOString()` always returns UTC. For a Texas hotel (CDT = UTC−5), after 7 PM local time `new Date().toISOString()` returns the *next* day's date. The Room Board initialises showing tomorrow while every other page in the app uses `format(new Date(), 'yyyy-MM-dd')` from date-fns (local timezone). Supervisors starting a night shift see no rooms assigned because they're looking at an empty tomorrow.

**Fix:** Replace `todayISO()` with `format(new Date(), 'yyyy-MM-dd')` from date-fns (already imported elsewhere in the project).

---

### ✅ B5 — "Good morning" hardcoded on GM dashboard regardless of time
**File:** `apps/web/app/(dashboard)/dashboard/page.tsx:20`

```tsx
Good morning{hotel ? `, ${hotel.name}` : ''}!
```

No `getHours()` check — always "Good morning" regardless of shift. Night-shift GMs clocking in at 11 PM are greeted with "Good morning." Also contributes to the B7 hydration errors since role dashboards have time checks but this one doesn't.

---

### ✅ N12 — Raw DB enum labels in stat cards across three pages
**Files:**
- `apps/web/app/(dashboard)/reports/page.tsx:198`
- `apps/web/app/(dashboard)/guest-requests/page.tsx` — stat card labels
- `apps/web/app/(dashboard)/lost-found/page.tsx` — stat card labels

Users see `IN_PROGRESS`, `INSPECTED`, `UNCLAIMED`, `ESCALATED`, `DISCARDED` in all-caps as stat card labels. These are raw PostgreSQL enum values passed directly from the API. The housekeeping board already maps them correctly via a STATUS_CONFIG object — the same pattern needs applying here.

**Fix (reports/page.tsx:198):**
```tsx
<p className="text-xs font-medium mt-0.5">
  {status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
</p>
```
Apply the same one-liner to the guest-requests and lost-found stat card label renders.

---

## Navigation & Operation Issues

### ✅ N14 — No "Create Work Order" button on the Work Orders page
**File:** `apps/web/app/(dashboard)/engineering/work-orders/page.tsx`

The page is list-only. A GM or chief engineer who needs to log an urgent work order manually has no entry point here. The only creation paths are: (1) room drawer in housekeeping, (2) PM Schedules page auto-generate, (3) Predictions page. None are obvious from the Work Orders page itself, which is the natural place a chief engineer would start their day.

---

### ✅ N15 — Tab state not URL-encoded on Guest Requests (and likely Tasks)
**Files:** `apps/web/app/(dashboard)/guest-requests/page.tsx`, `apps/web/app/(dashboard)/tasks/page.tsx`

`?tab=escalated` doesn't switch the active tab — tab selection is pure client state with no URL sync. Deep linking doesn't work; sharing a URL to "Escalated requests" always opens on "Open." Browser back/forward navigation also doesn't restore the selected tab.

---

### 🔴 N8 — Assignments page always appears empty
**File:** `apps/web/app/(dashboard)/housekeeping/assignments/page.tsx`

The page shows "No assignments found for this date. Use AI Auto-Assign or assign rooms from the Housekeeping Board." — but the Room Board has 109 dirty rooms and at least one housekeeper In Progress. Assignments created via the Room Board's chip-tap flow aren't reflected here. The two pages remain parallel and confusing: supervisors who go to "Assignments" expecting to see load balance find nothing.

---

### 🔴 N6 — Housekeeper gets no feedback after marking a room CLEAN
**File:** `apps/web/app/(dashboard)/housekeeping/page.tsx:287-292`

After tapping "Done Cleaning" the room card shows "Waiting for supervisor" with no:
- Timestamp of when the room became CLEAN
- Confirmation that the supervisor was notified
- Estimated wait or queue position

Housekeepers are left uncertain whether to walk to the supervisor or wait at the door.

---

### ✅ N5 — Notification bell permanently hidden
**File:** `apps/web/components/shared/Header.tsx`

Bell icon is rendered with `className="hidden"` — invisible and inaccessible from every page in the app. Either wire it to a notifications panel or remove it from the DOM.

---

## Fixed (confirmed in production)

| # | Fix |
|---|-----|
| ✅ G1 | Work Orders page now exists at `/engineering/work-orders` with status tabs + search |
| ✅ N1 | Engineers now have a full work order list view |
| ✅ N2 | Maintenance sidebar nav leads to Work Orders (not Assets) |
| ✅ N9 | Logbook "Today" shortcut added |
| ✅ N10 | Scheduling week view highlights today's column |
| ✅ B2 | `doneCount` now filters `INSPECTED` only |
| ✅ B3 | Notes use dedicated `addNote()` API (no spurious status-change side effects) |
| ✅ B6 | Framer Motion `layoutId` unique between nav subtrees |

---

## Quick Wins (low effort, high impact)

| # | Fix | File | Effort |
|---|-----|------|--------|
| ✅ B8 | Replace `toISOString().split('T')[0]` → `format(new Date(), 'yyyy-MM-dd')` | `housekeepingStore.ts:44` | **Trivial** |
| ✅ N12 | Apply `.replace(/_/g, ' ').replace(/\b\w/g, c=>c.toUpperCase())` to status label renders | `reports/page.tsx:198` | **Trivial** |
| ✅ B7/B5 | Wrap greeting in `useEffect`+`useState` to make it client-only | `dashboard/page.tsx:20` + role dashboards | Small |
| ✅ N15 | Sync active tab to `?tab=` URL param and read on mount | `guest-requests/page.tsx`, `tasks/page.tsx` | Small |
| ✅ N5 | Bell not present in Header.tsx — already removed | `Header.tsx` | Trivial |
| ✅ N14 | Add `+ New Work Order` modal/button for `gm` and `chief_engineer` roles | `engineering/work-orders/page.tsx` | Medium |

---

## Structural Gaps (still open)

### G2 — No batch inspect / inspect queue flow
Room inspection is a sequential batch operation — a supervisor walks floor-by-floor inspecting every CLEAN room. Current UX: tap room → open drawer → click "Inspect" → complete form → drawer closes → find next CLEAN room → repeat. A queue mode or "Next room" button after completing an inspection would cut tap count significantly for a 20-room round.
