# PatelRep Web App — Role Workflow Audit
**Date:** 2026-06-30  
**Tester:** Claude Code (Playwright automation)  
**Accounts tested:** GM (hp.patelrep@gmail.com), Supervisor (sandra@gmail.com), Front Desk (henill@gmail.com)  
**Environment:** Production — https://patelrep-production.up.railway.app  
**Hotel:** Sonesta ES Suites Fossil Creek — 114 rooms

---

## Role Access Matrix

| Section | GM | Supervisor | Front Desk |
|---|---|---|---|
| Dashboard | Full GM view | Supervisor-specific | FD-specific (Late Checkouts widget) |
| Housekeeping Board | ✅ + Assign mode | ✅ + Assign mode | ✅ Read-only |
| Assignments tab | ✅ | ✅ | ❌ |
| Inspections tab | ✅ | ✅ | ❌ |
| Engineering | ✅ | ❌ | ❌ |
| Guest Requests | Simple list view | Simple list view | Kanban (Open / In Progress / Resolved Today) |
| Tasks | ✅ | ✅ | ✅ |
| Staff management | ✅ | ❌ | ❌ |
| Schedule | ✅ | ✅ | ❌ |
| Logbook | ✅ | ✅ | ✅ |
| Reports | All 4 tabs | Daily Summary + Staff Performance only | ✅ |
| SOP Library | ✅ | ✅ | ✅ |
| AI Copilot | ✅ (broken) | ✅ (broken) | ❌ |

---

## ❌ Bugs Found

### BUG-1 — AI Copilot 500 error (All roles) 🔴 High
- **What happens:** Submitting any message to the AI Copilot chat returns "Something went wrong. Please try again." The browser console shows `HTTP 500` on `POST /v1/ai/copilot/chat`.
- **Root cause:** Anthropic API key almost certainly invalid or missing in Railway production environment variables.
- **Impact:** Core AI feature completely non-functional. AI risk alerts, AI assignment suggestions, and AI shift summaries may also be affected.
- **Fix:** Rotate `ANTHROPIC_API_KEY` in Railway → API service → Variables.

### BUG-2 — Notification bell panel never opens (All roles) 🟠 Medium
- **What happens:** The bell icon in the top bar shows a badge of "3" unread notifications, but clicking it does nothing — no panel opens.
- **Impact:** Staff cannot read or acknowledge any notifications.
- **Fix:** Investigate the notification dropdown component for a missing click handler or z-index/portal rendering issue.

### BUG-3 — Supervisor dashboard shows all zeros (Supervisor) 🔴 High
- **What happens:** Sandra's dashboard loads but shows Total Rooms: 0, Assigned: 0, To Inspect: 0, Inspected: 0%. The "Floor Team" widget shows "0 on shift — No assignments today" and "Room Map" shows "No room data loaded."
- **Impact:** The supervisor dashboard is completely useless for daily operations — it cannot be relied on to start the shift.
- **Fix:** Investigate the API calls behind the supervisor dashboard (likely `/v1/housekeeping/board` or a supervisor-specific summary endpoint) — check for RBAC rejection or missing query parameters.

### BUG-4 — Front Desk Room Board stuck on "Never synced" (Front Desk) 🔴 High
- **What happens:** The Front Desk role navigates to `/housekeeping` and sees the Room Board header but the content area shows a loading skeleton indefinitely. The sync indicator reads "Live · Never synced" and no rooms load.
- **Impact:** Front Desk cannot see room readiness, which is their primary need for assigning rooms to arriving guests.
- **Fix:** Check whether the FD role is being rejected by the housekeeping board API (`GET /v1/housekeeping/board`). If the endpoint requires `housekeeping_supervisor` or higher, add `front_desk` to the allowed roles.

### BUG-5 — GM dashboard greeting shows email prefix instead of name (GM) 🟡 Low
- **What happens:** The GM dashboard heading reads "Good morning, hp.patelrep." using the email local-part instead of the user's display name.
- **Fix:** Use `user.full_name` or `user.first_name` from the staff profile; fall back to email only if name is empty.

---

## GM Workflow

### What Works ✅

| Feature | Notes |
|---|---|
| Dashboard overview | Real-time room status (Vacant Dirty / In Progress / Inspected / Pickup / OOO), AI Risk Alerts, SLA Compliance 30-day chart, Top Staff Performers |
| Housekeeping Room Board | Floor-grouped cards, live Supabase Realtime sync, building A/B filter, color-coded status, date navigation |
| Room Detail Drawer | Status, last action timestamp, checkout time, Mark Checked Out, Add Note, Submit Work Order, Lost & Found shortcut, Room History section |
| Housekeeping Inspections | Ready-to-Strip queue, Inspection Queue; Mark Stripped action works and updates count live |
| Engineering Work Orders | Kanban board (Open / In Progress / On Hold / Completed), AI Triage button, New Work Order form |
| New Work Order form | Location (text), Title (required), Category (7 options: Plumbing / Electrical / HVAC / Furniture / Appliance / Structural / Safety / General), Priority (Urgent / Normal / Low), Guest Reported toggle, Photo upload |
| New Task form | Location (optional), Title (required), Type dropdown, Priority dropdown, Assign To (staff selector), Notes |
| Guest Requests | Active Requests + History tabs, New Request action |
| Staff Management | 6 team members, Edit / Deactivate, Add Manually / Invite |
| Staff Scheduling | Weekly calendar, By Staff / By Shift toggle, department filter (Housekeeping / Engineering / Front Desk / Management) |
| Reports | Daily Summary, Staff Performance, Maintenance, AI Usage tabs with date picker |
| Shift Logbook | AI summary auto-generates at 7 AM / 3 PM / 11 PM; manual Add Entry |
| SOP Library | Categorized tabs (All / Housekeeping / Engineering / HR / Emergency / General), AI-powered search |
| Lost & Found | Log Found Item |
| Settings | Hotel Profile, Departments, Front Desk config, Roles, Inspections, Housekeeping, Rooms, Billing, Integrations, Feedback |

### Gaps vs Standard Hotel Procedures 🔴

1. **No arrivals/departures list** — GMs need today's expected check-ins and check-outs by name and room. The dashboard shows only status counts; no reservation-based view exists.

2. **No occupancy %, ADR, or RevPAR on dashboard** — Standard GM dashboards (Mews, Opera, Quore) lead with live OCC%, Average Daily Rate, and RevPAR. Completely absent here.

3. **No VIP arrival workflow** — No consolidated "VIPs arriving today" list with room preferences, amenity setups, or room-readiness gating before check-in.

4. **No late checkout approval queue** — GMs and supervisors are responsible for approving or denying guest late checkout requests. No dedicated workflow screen exists; late checkouts appear only as a dashboard widget on the Front Desk role.

5. **New Work Order has no room picker** — The Location field is free-text. A WO cannot be formally linked to a specific room from the creation form; it must be opened from within a room card instead.

6. **No shift handover / MOD sign-off** — The logbook AI summary covers narrative handover, but there is no structured Manager on Duty checklist or formal sign-off field per AHLA standard practice.

7. **No DND welfare check escalation** — Rooms flagged DND on the board have no timer or threshold trigger for a welfare check. There is no GM workflow to authorize or log a welfare check.

8. **Assets and PM Schedules are empty** — Engineering backbone has no registered assets and no PM schedules set up, so AI failure predictions have nothing to analyze.

---

## Housekeeping Supervisor Workflow

### What Works ✅

| Feature | Notes |
|---|---|
| Room Board | Identical view to GM; full 114-room board with live sync |
| Assign Mode | Select housekeeper → tap rooms to assign; pending count badge on housekeeper chip; Save button; Exit assign button all functional |
| AI Assignments panel | Shows Unassigned count, Needs Work count, Auto-Assign with AI button visible in assign mode |
| Housekeeper picker | Shows Claudia, Elisa, Sandra — correct active housekeeper roster |
| Inspections | Ready-to-Strip queue (1 room: 227 Departure Floor 2); Inspection Queue; Mark Stripped works |
| Housekeeping tabs | Room Board, Assignments, Inspections all accessible |

### Gaps vs Standard Hotel Procedures 🔴

1. **Supervisor dashboard data completely broken (BUG-3)** — All metrics show 0. A supervisor starting their shift cannot use this screen at all.

2. **No real-time housekeeper productivity view** — Standard supervisory tools (Quore, HotSOS, Amadeus) show each housekeeper's completed/remaining room count, average clean time per room type, and pace vs shift target in real-time. The Floor Team widget has no data.

3. **No inspection checklist form** — When a room enters the Inspection Queue there is no structured checklist (bed make, bathroom, amenities, minibar, etc.) with pass/fail per item and optional photo capture. Only pass/fail at the room level appears to exist.

4. **No re-clean dispatch from failed inspection** — If a supervisor fails a room inspection there is no workflow to send it back to the original housekeeper with a specific note or to reassign it to another housekeeper.

5. **No team broadcast messaging** — Supervisors in Quore can send a note to all housekeepers on shift (e.g., "All rooms by floor 3 are priority — VIP check-in at 2 PM"). No equivalent exists.

6. **Supervisor cannot see Engineering** — A housekeeping supervisor often needs to submit or track work orders on behalf of housekeepers (e.g., broken toilet reported during cleaning). Engineering is entirely hidden from this role.

7. **No DND threshold / welfare check escalation** — Same gap as GM. No timer shows how long a room has been on DND, and there is no workflow for the supervisor to request or log a welfare check.

---

## Front Desk Workflow

### What Works ✅

| Feature | Notes |
|---|---|
| Dashboard | "Good morning, Henill." correct name; Rooms Ready %, Open Requests, In Progress, Needs Cleaning KPIs; Late Checkouts widget present |
| Guest Requests kanban | Well-designed 3-column layout: Open / In Progress / Resolved Today — ideal for shift management |
| Housekeeping Room Board | Accessible (though currently not loading — BUG-4) |
| Lost & Found | Log Found Item accessible |
| Tasks | Create and track tasks |
| Logbook | Shift Logbook accessible |
| SOP Library | Accessible |

### Gaps vs Standard Hotel Procedures 🔴

1. **No check-in workflow** — The most fundamental front desk function. There is no way to log a guest arrival, confirm a reservation, assign a room, or issue a key. Entirely absent.

2. **No check-out / departure workflow** — No way to process a guest departure, settle a folio, or confirm a room is now vacant and ready for housekeeping.

3. **No room availability or blocking view** — Front Desk cannot see which rooms are clean and ready to assign to walk-in guests, block a room for maintenance, or upgrade a VIP to an available room.

4. **No reservation / guest lookup** — FD cannot search for a reservation by guest name, confirmation number, or room number to pull up stay details.

5. **Late Checkouts widget loads but has no actions** — The dashboard shows the Late Checkouts section but it was in a loading skeleton state with no approve/deny/confirm buttons visible. FD should be able to act on these directly.

6. **No phone / wake-up call logging** — A standard FD responsibility. No call log or wake-up call scheduler exists.

7. **No room blocking for arriving guests** — When a VIP or specific-request guest is expected, FD typically "blocks" their preferred room to prevent it being assigned elsewhere. Not possible.

8. **FD is missing AI Copilot access** — Front Desk agents frequently need quick answers ("what's the SOP for a noise complaint?", "which rooms are ready on floor 3?"). The AI Copilot is not available to FD at all.

---

## Priority Fix List

| Priority | Item | Effort |
|---|---|---|
| 🔴 P0 | Fix AI Copilot 500 error — rotate Anthropic API key on Railway | Minutes |
| 🔴 P0 | Fix supervisor dashboard data loading (all zeros) | Small |
| 🔴 P0 | Fix Front Desk Room Board "Never synced" — likely RBAC issue on board endpoint | Small |
| 🔴 P0 | Fix notification bell panel not opening | Small |
| 🟠 P1 | Late checkout approve/deny actions for Front Desk | Medium |
| 🟠 P1 | Real-time housekeeper productivity metrics on supervisor dashboard | Medium |
| 🟠 P1 | Inspection checklist form (per-item pass/fail + photo) | Medium |
| 🟠 P1 | Re-clean dispatch from failed inspection back to housekeeper | Small |
| 🟠 P1 | GM dashboard greeting — use full name not email prefix | Tiny |
| 🟡 P2 | Room picker (not free-text) on New Work Order form | Small |
| 🟡 P2 | Arrivals/departures list for GM and Front Desk | Large |
| 🟡 P2 | Give Front Desk access to AI Copilot | Small |
| 🟡 P2 | Team broadcast message for Supervisor | Medium |
| 🟡 P2 | Engineering access for Housekeeping Supervisor (read-only WO create) | Medium |
| 🔵 P3 | OCC%, ADR, RevPAR on GM dashboard | Large (needs PMS integration) |
| 🔵 P3 | VIP arrival workflow | Large |
| 🔵 P3 | Check-in / check-out workflow for Front Desk | Very Large |
| 🔵 P3 | DND welfare check escalation | Medium |
