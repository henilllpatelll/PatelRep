# Mobile App Workflow Audit Report
**Date:** 2026-06-28  
**Tested by:** Claude Code (emulator-5554, Android)  
**Accounts:** Claudia (housekeeper), Sandra (supervisor), Miguel (engineer)  
**Reference standards:** Quore, HotSOS, ALICE, Amadeus HotOSS

---

## Housekeeping Workflow (Claudia)

### What Works
| Feature | Status |
|---|---|
| Home screen — date, assigned room count, "Start with" CTA | ✓ |
| My Rooms list — grouped by building, room number, status pill | ✓ |
| Room detail — checklist, photos, notes, "Mark Clean" | ✓ |
| Resume in-progress room via home screen link | ✓ |
| Room board visible on Home (limited view) | ✓ |

### Bugs
| ID | Description |
|---|---|
| BUG-234 | In-progress room (e.g. 118) disappears from My Rooms **Remaining** list while being cleaned — housekeeper loses track of their active room |

### Gaps vs. Quore / HotSOS
| # | Gap |
|---|---|
| HK-1 | No elapsed timer showing how long a room has been IN_PROGRESS |
| HK-2 | No maintenance issue report shortcut from inside the cleaning screen |
| HK-3 | No VIP / rush-room visual priority flag on housekeeper's room list |
| HK-4 | No linen / supply request integration |
| HK-5 | Room checklist items don't distinguish mandatory vs. optional tasks |
| HK-6 | No mini-bar check or room damage report on room completion |
| HK-7 | No daily assignment summary at login ("You have 14 rooms today") |

---

## Supervisor Workflow (Sandra)

### What Works
| Feature | Status |
|---|---|
| Room Board — live color-coded grid | ✓ |
| Assign tab — assign rooms to housekeepers | ✓ |
| Inspect tab — opens inspect queue | ✓ |
| Profile tab | ✓ |

### Bugs
| ID | Description |
|---|---|
| BUG-235 | Supervisor Home KPI tiles ("Rooms Cleaned", "Inspected", "Remaining") all show **0** despite live Room Board showing real data |

### Gaps vs. Quore / HotSOS
| # | Gap |
|---|---|
| SUP-1 | Inspect queue is disconnected from "Ready for Inspection" rooms — no direct "tap to inspect" CTA from ready rooms on the board |
| SUP-2 | No "Reject Inspection" flow — can't mark an inspected room back to DIRTY with a reason |
| SUP-3 | No way to reassign rooms between housekeepers from the app |
| SUP-4 | No productivity metrics per housekeeper (rooms/hr, completed vs. assigned) |
| SUP-5 | No shift overview — who's working, what's done, what's pending |
| SUP-6 | No priority flagging from supervisor to housekeeper ("do room 210 first — VIP early check-in") |
| SUP-7 | No end-of-shift sign-off flow |

---

## Engineering Workflow (Miguel)

### What Works
| Feature | Status |
|---|---|
| Engineering Home — bench-clear state, "N in queue · N on bench · N closed today" | ✓ |
| Quick links: Orders, Rooms, Assets, PM — all route correctly | ✓ |
| Work Orders list — search, "No open orders" state, Done accordion | ✓ |
| Create WO — title, location, category chips, priority (Emergency/Urgent/Normal/Low), reported-by | ✓ |
| WO creation → success dialog + real-time queue update | ✓ |
| WO claim → "In Progress" badge + ON THE CLOCK live timer | ✓ |
| "Arrived on Site" → activity log entry "Engineer arrived on site — HH:MM" | ✓ |
| "Mark complete" → success dialog, WO → Done, home counter increments | ✓ |
| Wrap-up section — "What was done" + "Parts used" fields | ✓ |
| Rooms tab — floor-grouped, color-coded status rails, All/Vacant/Occupied/OOO filters | ✓ |
| OOO filter — shows OOO rooms correctly | ✓ |
| Context-aware OOO action: OOO room → "Return to Service", non-OOO → "Place on OOO" | ✓ |
| Escalate button — correctly hidden for already-URGENT WOs (shown for Normal/Low) | ✓ |
| Assets tab — correct empty state ("Assets are added via the web dashboard") | ✓ |
| PM Schedules — All/Due/Overdue filters, Log Complete button | ✓ |

### Bugs Fixed This Session
| ID | Description | Fix |
|---|---|---|
| BUG-238 | OOO "Place on OOO" action shown to `engineer` role but backend denied with 403. Root cause: `room_status_transitions.py` restricted OOO to `{gm, housekeeping_supervisor}` only. | **FIXED** — Added `chief_engineer` to backend OOO permissions. Mobile now computes `canManageOoo = chief_engineer \| gm \| housekeeping_supervisor` and only includes OOO buttons for those roles. Plain `engineer` sees only "Create Work Order". |

### Gaps vs. Quore / HotSOS
| # | Gap |
|---|---|
| ENG-1 | WO list cards don't show category (Plumbing / HVAC / Electrical) |
| ENG-2 | No priority SLA countdown on URGENT WOs ("58 min to SLA breach") |
| ENG-3 | OOO action sheet doesn't show the existing OOO reason when room is already OOO |
| ENG-4 | "ADD REASON" for OOO on Android places OOO without collecting reason — `Alert.prompt` is iOS-only; needs a custom inline modal for Android |

---

## Outstanding Bugs (all workflows)

| ID | Workflow | Description | Priority |
|---|---|---|---|
| BUG-234 | Housekeeping | In-progress room disappears from My Rooms Remaining list | High |
| BUG-235 | Supervisor | Home KPI tiles always show 0 / "Board is empty" | High |

---

## Prioritized Fix List

### P1 — Fix bugs blocking core workflows
1. **BUG-234** — In-progress room disappears from Remaining list
2. **BUG-235** — Supervisor Home KPI tiles show 0

### P2 — High-impact gaps (floor staff time-savers)
3. **ENG-1** — Show category on WO list cards
4. **ENG-2** — Priority SLA countdown on URGENT WOs
5. **SUP-1** — Connect Inspect queue to Ready rooms
6. **HK-1** — Elapsed timer on in-progress rooms
7. **HK-3** — VIP / rush-room priority flag

### P3 — Nice-to-have completions
8. **ENG-3** — Show OOO reason in action sheet
9. **ENG-4** — Android OOO reason modal
10. **SUP-2** — Reject inspection flow
11. **HK-2** — Maintenance report shortcut from cleaning screen
