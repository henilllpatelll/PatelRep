# Workflow QA Findings — 2026-06-25
Tested: Claudia (housekeeper), Sandra (supervisor), Miguel (engineer) on Android emulator.

## 2026-06-26 Verification Update

Retest attempted on Android emulator `emulator-5554` with `com.patelrep.app`.

- **Credential check:** Supabase auth succeeds for Claudia, Sandra, and Miguel with the credentials supplied for this test.
- **Runtime blocker:** after clearing app data and reconnecting the Expo dev client to Metro at `http://10.0.2.2:8081`, the app repeatedly fails before login with `Error loading app` / `Read timed out`.
- **Config finding:** `apps/mobile/.env` points the mobile app to `EXPO_PUBLIC_API_URL=http://10.0.2.2:8002/v1`; port `8002` was not initially running PatelRep API. Starting FastAPI on `0.0.0.0:8002` exposed the expected PatelRep routes, but the dev-client bundle still timed out.
- **Read-only backend smoke:** against the existing PatelRep API on `127.0.0.1:8002`, Claudia auth + `/v1/housekeeping/my-rooms` returned 26 rooms; Sandra auth + `/v1/housekeeping/board` returned 114 rooms and `/v1/housekeeping/assignments` returned 2 housekeeper load rows; Miguel auth + `/v1/work-orders` returned 3 work orders.
- **Implication:** the workflow findings below remain the best current app-behavior notes from the prior emulator pass, but a fresh end-to-end retest is blocked until the dev-client bundle load is stable.

Online SOP cross-reference used for this review:
- Housekeeping room policies should include procedures, reporting faulty appliances, and checklists by room type/service type; standard room cleaning flows cover bedroom and bathroom tasks, appliance checks, restocking, floor work, and a final look.
- Supervisor room inspection SOPs expect a documented checklist, systematic room pass, issue notes/actions, and final approval before the room is ready for the next guest.
- Maintenance/work-order closure should capture the problem found, action taken, parts with quantities, photo evidence, technician sign-off, and optionally supervisor verification; PM work should live in the same prioritized queue as reactive work.

---

## BUGS FOUND

### B1 — Sign-out broken (pre-existing)
Confirmation fires but user remains authenticated. Workaround: `adb shell pm clear com.patelrep.app`.

### B2 — Come Back Later report button infinite loading (pre-existing)
`submitNote` call to `POST /rooms/{room_id}/notes` hangs silently, blocking `setBlockerBusy(null)`. Loading spinner never clears.

### B3 — FocusCard "Start with 123" doesn't navigate (pre-existing)
Tapping the mosaic card shortcut button on home screen does nothing; mosaic tiles directly do work.

### B4 — "Balance with AI" returns "No housekeepers found on shift for this date"
Fires even though Claudia has 26 assigned rooms. AI assignment uses shift scheduling data that is not populated; manual assignment uses the staff table. These two data sources are disconnected.
- **File:** `apps/mobile/components/supervisor/atoms.tsx` (or supervisor API)
- **Fix:** Ensure AI balance falls back to today's active assignments when shift schedule is empty, or display a clearer message explaining why.

### B5 — Supervisor (Sandra) appears in housekeeper assignment picker
When manually assigning rooms, Sandra's name appears as an option alongside Claudia and Elisa. Role contamination — supervisors should not be assignable to room cleaning.
- **Fix:** Filter picker to `role = 'housekeeper'` only.

### B6 — Inspection detail rows not tappable
Past inspections in the "Done" tab show room + inspector + timestamp + PASSED/FAILED but tapping a row does nothing. No detail view to see what was checked or why a room failed.
- **Fix:** Add an inspection detail sheet with checklist results and any failure notes.

### B7 — No checklist enforcement before "Mark Clean"
Housekeeper can submit a room as clean with 0/6 checklist items completed. No gate exists.
- **Fix:** Require at least N checklist items (or all mandatory items) before enabling the Mark Clean button.

---

## WORKFLOW GAPS vs. STANDARD HOTEL PROCEDURES

### HOUSEKEEPING

| Gap | Industry Standard | Current State |
|-----|-----------------|---------------|
| No checklist completion gate | Room must pass inspection checklist before "submit" | Mark Clean allowed at 0/6 |
| Generic checklist | Checklist should differ by room type (studio vs suite, kitchen vs no kitchen) | Same 6-item checklist for all |
| Only 3 Come Back Later presets | Should include afternoon options (2 PM, 3 PM, 4 PM) | 11 AM, 12 PM, 1 PM only |
| Supply request has no quantities | Housekeepers must specify how many of each item | No quantity field |
| Supply request recipient unknown | System shows who receives/approves request | No indication |
| No RESERVATION/TIMING checkout time | Housekeeper needs to know checkout time and next arrival | Only shows FO status and start time |
| DND sign blocker sends no alert to front desk | DND at checkout time should auto-alert FO to call room | DND just posts a room note |

### SUPERVISOR

| Gap | Industry Standard | Current State |
|-----|-----------------|---------------|
| No inspection checklist | Supervisor physically checks: bed corners, bathroom amenities, mini-bar, mirror, floor | Binary PASS / FAIL only |
| No "Fail + Send back" flow | Failed room returns to housekeeper queue with notes | No fail option visible |
| No proactive inspection | Supervisor can inspect any READY room without waiting for housekeeper submit | Queue only shows submitted rooms |
| No section assignment | Assign all Floor 1 rooms to Claudia in one action | Must assign room-by-room |
| No color legend on Room Board | Engineers know what teal/amber/pink mean at a glance | No legend |
| Room detail lacks guest status | Shows service type and housekeeper only | No checkout time, next arrival, VIP flag |
| AI Balance disconnected from shift data | Should balance based on who is clocked in today | Returns "no housekeepers found" |
| Supervisor appears in housekeeper picker | Role filter missing (Bug B5) | Sandra assignable as cleaner |
| Inspect done rows not tappable (Bug B6) | Full inspection history viewable | Rows non-interactive |
| No shift broadcast to team | Supervisor can message all housekeepers ("checkout rush on 3rd floor") | BroadcastModal exists but not connected to home |
| No housekeeper clock-in status | Shows who is "on shift" today | No clock-in/out visible |

### ENGINEERING / MAINTENANCE

| Gap | Industry Standard | Current State |
|-----|-----------------|---------------|
| Engineer cannot create work orders from mobile | Engineer discovers leak, creates WO on spot | CreateWorkOrderModal exists (untracked file) but not wired to Orders tab |
| No "Escalate" or "Reassign" action on WO | Chief engineer can reassign if engineer is stuck | No escalation path |
| No way to place room On OOO from mobile | Engineer takes room OOO for repairs | Must use web dashboard |
| No "Estimated return to service" on OOO rooms | OOO room shows when it'll be back | Rooms tab shows OOO status but no ETA |
| No photo on work order at discovery | Maintenance photo evidence is critical | "Add photo" exists but no camera integration tested |
| Assets require web dashboard to register | Engineer discovers broken AC unit, adds it on phone | "Assets are added via the web dashboard" |
| No PM schedules on mobile | Engineer sees today's preventive maintenance tasks | PM quick link on home, not tested (not in tab bar) |
| PARTS USED is a free-text field | Parts should link to inventory for stock tracking | Free text only |
| No signature capture | Guest acknowledgment for access or repair | Not present |
| Work order age: 19h open before claim | SLA alerts should push to engineers proactively | Push notification not verified — WO sat unclaimed |

---

## WHAT'S WORKING WELL

- **Housekeeper**: Room card mosaic, checklist UI, Come Back Later presets, blocker system, Mark Clean flow, Done tab
- **Supervisor**: Room Board with live floor grid, color-coded tiles, filter tabs, room detail sheet with reassign, Assign tab with workload cards, AI balance button (UX good, data disconnected), Inspect PASSED/FAILED tracking
- **Engineer**: Home screen "Start Here" urgent WO surfacing, Claim & start, ON THE CLOCK timer, DETAILS + PHOTOS + ACTIVITY + WRAP-UP + PARTS USED fields, Mark complete with confirmation, Done accordion with priority tags and timestamps, Rooms tab with ALL/Vacant/Occupied/OOO filters + guest name search

---

## PRIORITY FIX LIST (ordered)

1. **[CRITICAL]** B7 — Enforce checklist before Mark Clean
2. **[HIGH]** B2 — Fix Come Back Later infinite loading
3. **[HIGH]** B4 — Fix AI Balance (use active assignments as fallback)
4. **[HIGH]** B5 — Filter assignment picker by housekeeper role
5. **[HIGH]** Wire `CreateWorkOrderModal` to the Orders tab + button
6. **[HIGH]** Add inspection fail flow + checklist to Inspect tab
7. **[MEDIUM]** B1 — Fix sign-out session clearing
8. **[MEDIUM]** Add checkout time + next arrival to room detail sheet
9. **[MEDIUM]** Add "Place on OOO" action from Rooms tab (engineer)
10. **[MEDIUM]** Add Come Back Later afternoon presets (2 PM, 3 PM)
11. **[LOW]** Make inspection Done rows tappable (detail sheet)
12. **[LOW]** Add Room Board color legend
13. **[LOW]** Add section-assign shortcut (assign whole floor to one housekeeper)
