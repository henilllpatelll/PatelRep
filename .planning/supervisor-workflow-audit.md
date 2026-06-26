# Housekeeping Supervisor Workflow Audit
**Tester:** Sandra (sandra@gmail.com) — HK Supervisor, Sonesta ES Suites Fossil Creek
**Date:** 2026-06-26 | **Device:** Android Emulator (API 35, 1080×2400)
**Branch:** main | **Tested via:** ADB + screenshot QA

---

## Screens Tested

| Screen | Loaded | Interacted |
|---|---|---|
| Home (mosaic + team loads) | ✅ | ✅ |
| Room Board (live floor grid) | ✅ | ✅ |
| Room Board → Room Detail Sheet | ✅ | ✅ |
| Assign (manual assignment) | ✅ | ✅ |
| Assign → AI Balance | ✅ | ✅ |
| Inspect queue | ✅ | ⚠️ buttons unresponsive via ADB |
| Profile | ✅ | — |

---

## Bugs to Fix

### 🔴 BUG 1 — AI Balance always fails
**File:** `apps/api/routers/ai_copilot.py` (or wherever `POST /ai-suggest-assignments` lives)
**Symptom:** "Balance with AI" returns `"No housekeepers found on shift for this date"` even though
Claudia and Elisa both appear correctly in the manual housekeeper picker.
**Root cause:** The AI suggest endpoint queries `staff_role_schedules` for clock-in records. Staff
can be active/assignable without a formal shift record in that table.
**Fix:** Query active staff by role (`housekeeper`, `housekeeping_supervisor`) with
`is_active = true` — the same source `extractAssignableStaff` in
`apps/mobile/lib/housekeeping/supervisor.ts` uses. Do not gate on shift records for assignment.

### 🟡 BUG 2 — No confirmation feedback after assignment save
**File:** `apps/mobile/components/supervisor/HousekeeperPicker.tsx`
**Symptom:** Picker shows "Saving…" then silently dismisses. Room disappears from unassigned list
with no toast, success state, or haptic feedback.
**Fix:** After successful save, show a brief success state inside the picker (green checkmark for
~600ms) or fire a `ToastAndroid.show` / `Haptics.notificationAsync(SUCCESS)` before dismiss.

### 🟡 BUG 3 — Inspect pass/fail buttons appear non-responsive on Android
**File:** `apps/mobile/app/(app)/inspect/index.tsx`
**Symptom:** ✓/✗ buttons on queue cards did not trigger the confirmation modal across multiple ADB
tap attempts. Code is correct (`openConfirm` on `onPress` of 44×44 `TouchableOpacity`).
**Likely cause:** ScrollView touch propagation on Android — the queue cards live inside a
`ScrollView` and Android can steal touch events before `TouchableOpacity` receives them.
**Fix to try:** Add `disableScrollViewPanResponder` prop to the ScrollView, or wrap the action
buttons in a `View` with `collapsable={false}`. **Confirm first with a physical finger tap.**

### 🟡 BUG 4 — Claudia's workload estimate shows ~810 min left (13.5 hrs)
**File:** `apps/mobile/lib/housekeeping/supervisor.ts` → `buildTeamLoads()`
**Symptom:** Home screen team load row shows "3 of 30 done · ~810m left" for Claudia.
**Root cause:** Either `base_clean_minutes` per room type is misconfigured in Supabase, or 30 rooms
is an unrealistically large assignment (industry standard is 12–16 rooms/shift).
**Fix:** Audit `room_types.base_clean_minutes` in the DB. Cap displayed "minutes left" to a
realistic shift ceiling (e.g., 480 min) and show a warning chip if a housekeeper is over-assigned.

### 🟡 BUG 5 — Swipe-up on Room Detail Sheet dismisses instead of expands
**File:** `apps/mobile/components/supervisor/RoomDetailSheet.tsx`
**Symptom:** Swiping up on the bottom sheet dismisses it. Expected: expand to reveal full content
(notes, WO status, history).
**Fix:** Increase the sheet's snap point or set `snapPoints={['40%', '85%']}` so the first upward
swipe expands rather than the gesture handler interpreting it as a dismiss drag.

### 🟡 BUG 6 — Room 101 shown as READY but Unassigned
**File:** API — `GET /housekeeping/board`
**Symptom:** Room Detail Sheet for room 101 shows status READY (INSPECTED) with "Assigned to:
Unassigned". An inspected room should have had an assignment at some point.
**Fix:** Investigate whether `room_assignments` row was deleted after inspection. Board query
should fall back to `room_status.assigned_to` if no `room_assignments` row exists for today.

---

## Gaps to Implement (ranked by floor-time impact)

### 🔴 GAP 1 — Re-clean workflow after failed inspection
**Standard procedure:** When a room fails inspection the supervisor sends it back to the
housekeeper with a note. Currently failing a room has no downstream effect — supervisor must
manually go to Assign and re-assign from scratch.
**What to build:**
- After submitting a failed inspection, show a sheet: "Send back to [housekeeper]?" with the fail
  notes pre-filled.
- On confirm: reset room status to `DIRTY`, create a task assigned to the original housekeeper
  with the inspection fail notes as the description.
- On the housekeeper's My Rooms list, the room should re-appear with a red "Re-clean" chip.
**Files:** `apps/mobile/app/(app)/inspect/index.tsx`, `apps/api/routers/housekeeping.py`

### 🟡 GAP 2 — Late checkout visibility on Assign screen
**Standard procedure:** Before assigning rooms, the supervisor needs to know which rooms have
a pending or approved late checkout (guest still in room past standard checkout time).
**What to build:**
- On each unassigned room row in Assign, show a `⏰ Late CO` chip when
  `late_checkout_requests.status = 'approved'` or `status = 'pending'` for that room.
- Tap the chip → show requested time in a tooltip.
**Files:** `apps/mobile/app/(app)/assignments/index.tsx`,
`apps/mobile/lib/api/housekeepingSupervisor.ts`

### 🟡 GAP 3 — "Behind schedule" signal on Room Board
**Standard procedure:** Rooms still DIRTY or unstarted past a configurable time (e.g., 11 AM for
checkouts, 1 PM for stayovers) should be flagged for the supervisor.
**What to build:**
- In `buildFloorSnapshot` add a `behindSchedule` list: rooms with status `DIRTY` or `PICKUP`
  where `checkout_time` < now (for departures) or where it's past 1 PM (for stayovers).
- Show a red `🕐 Behind` chip on the Room Board tile and a nonzero signal in the hero.
**Files:** `apps/mobile/lib/housekeeping/supervisor.ts`, `apps/mobile/app/(app)/room-board/index.tsx`

### 🟡 GAP 4 — DND override authorization
**Standard procedure:** If a DND sign has been on a room for 2+ hours with no response, the
supervisor physically checks on the guest. The app should support logging this action.
**What to build:**
- On Room Detail Sheet for a DND room, show a "Override DND — Check on guest" button (supervisor
  role only).
- Tapping creates a task: "Supervisor wellness check — Room [X]" assigned to the supervisor.
- After the check, the supervisor can mark it resolved (room is accessible) or escalate to GM.
**Files:** `apps/mobile/components/supervisor/RoomDetailSheet.tsx`,
`apps/api/routers/tasks.py`

### 🟡 GAP 5 — Conditional pass ("Needs touch-up") in Inspect
**Standard procedure:** Most hotel inspection flows have three outcomes: Pass, Fail (full redo),
and Conditional/Touch-up (minor issue, housekeeper fixes in place, no full redo needed).
**What to build:**
- Add a third `⚡ Touch-up` button alongside ✓/✗ on inspect queue cards.
- Maps to `overall_result: 'conditional'` (already defined in the DB and in
  `RESULT_META` in inspect screen).
- The confirmation modal for conditional should ask for the specific item needing attention
  (single-line, no full checklist).
**Files:** `apps/mobile/app/(app)/inspect/index.tsx` — add third `TouchableOpacity` in
`queueActions`, update modal title/label copy in `locales/en.json` + `locales/es.json`

### 🟡 GAP 6 — Photo capture during inspection (failed rooms)
**Standard procedure:** Supervisors photograph issues to protect against disputes and document
housekeeper feedback.
**What to build:**
- In the fail confirmation modal, add an optional "Add photo" row that opens `expo-image-picker`.
- Upload via `POST /housekeeping/inspections/{id}/photos` (create endpoint if missing).
- Photo thumbnail shows in the Done detail modal.
**Files:** `apps/mobile/app/(app)/inspect/index.tsx`,
`apps/api/routers/housekeeping.py`

### 🟢 GAP 7 — VIP / special-request flags on Assign screen rooms
**Standard procedure:** Supervisors assign VIP rooms to their most experienced housekeeper.
**What to build:**
- Add `is_vip` and `special_request` fields to the board/assignments API response where
  `reservations.vip_code IS NOT NULL`.
- On unassigned room rows in Assign, show a gold `★ VIP` chip.
**Files:** `apps/api/routers/housekeeping.py` (board query), `apps/mobile/app/(app)/assignments/index.tsx`

### 🟢 GAP 8 — End-of-shift summary from mobile
**Standard procedure:** Supervisor submits an end-of-shift report to the GM before clocking out.
**What to build:**
- Add an "End shift" button on the Home screen (visible after 3 PM or when mosaic shows < 5
  rooms remaining).
- Pre-fills a summary: X rooms completed, Y inspected, Z failed, OOO count, any open WOs.
- Supervisor adds a free-text note, submits → creates a `logbook_entries` row with
  `category = 'shift_summary'` and sends a push notification to the GM.
**Files:** `apps/mobile/components/home/SupervisorHome.tsx`,
`apps/api/routers/logbook.py`

### 🟢 GAP 9 — Individual message to a specific housekeeper
**Standard procedure:** Supervisor needs to quickly redirect one housekeeper ("skip 207, start
310 first") without broadcasting to everyone.
**What to build:**
- In the Home team load row, add a message icon button next to each housekeeper's row.
- Opens a direct message modal → `POST /notifications/direct` with `recipient_id`.
**Files:** `apps/mobile/components/home/SupervisorHome.tsx`,
`apps/api/routers/notifications.py`

---

## Implementation Order (suggested)

```
Sprint 1 — Fix what's broken
  BUG 1  AI Balance staff query fix           (API only, ~1hr)
  BUG 2  Assignment save toast                (mobile only, ~30min)
  BUG 3  Inspect touch propagation            (verify first, ~30min)
  BUG 4  Workload minute cap                  (~30min)

Sprint 2 — Highest floor value
  GAP 1  Re-clean workflow after fail         (mobile + API, ~3hr)
  GAP 2  Late checkout chips on Assign        (mobile + API, ~2hr)
  GAP 5  Conditional pass (Touch-up) button   (mobile only, ~1.5hr)

Sprint 3 — Operational completeness
  GAP 3  Behind-schedule signal               (mobile only, ~2hr)
  GAP 6  Photo capture in inspect             (mobile + API, ~3hr)
  GAP 7  VIP flag on Assign rows              (mobile + API, ~1.5hr)

Sprint 4 — Supervisor lifecycle
  GAP 4  DND override authorization           (mobile + API, ~2hr)
  GAP 8  End-of-shift summary                 (mobile + API, ~3hr)
  GAP 9  Individual housekeeper message       (mobile + API, ~2hr)
  BUG 5  Sheet snap-point fix                 (~30min)
  BUG 6  READY/Unassigned data fix            (~30min)
```

---

## Key File Reference

| What | File |
|---|---|
| Supervisor home screen | `apps/mobile/components/home/SupervisorHome.tsx` |
| Room Board screen | `apps/mobile/app/(app)/room-board/index.tsx` |
| Assignments screen | `apps/mobile/app/(app)/assignments/index.tsx` |
| Inspect screen | `apps/mobile/app/(app)/inspect/index.tsx` |
| Supervisor domain logic | `apps/mobile/lib/housekeeping/supervisor.ts` |
| Housekeeper picker | `apps/mobile/components/supervisor/HousekeeperPicker.tsx` |
| Room detail sheet | `apps/mobile/components/supervisor/RoomDetailSheet.tsx` |
| Supervisor API wrappers | `apps/mobile/lib/api/housekeepingSupervisor.ts` |
| Housekeeping router (API) | `apps/api/routers/housekeeping.py` |
| AI assignments router (API) | `apps/api/routers/ai_copilot.py` |
| Locales | `apps/mobile/locales/en.json`, `apps/mobile/locales/es.json` |
