# PatelRep — UI Wireframes & Component Mockups

All wireframes are text-based mockups representing the intended layout. Dimensions are approximate.
Color conventions used throughout: 🔴 Urgent/High Risk | 🟡 Normal/In Progress | 🟢 Complete/Low Risk | ⬜ Neutral

---

## 1. Login Screen (Mobile)

```
┌──────────────────────────────────────────────┐
│                                              │
│              [PatelRep Logo]                 │
│         Hotel Operations, Simplified         │
│                                              │
│  ─────────────────────────────────────────   │
│                                              │
│  Email Address                               │
│  ┌──────────────────────────────────────┐    │
│  │ maria.garcia@austinsuites.com        │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  Password                                    │
│  ┌──────────────────────────────────────┐    │
│  │ ●●●●●●●●●●●●                         │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │           Sign In                    │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  ─────── or ──────────────────────────────   │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │      Send Magic Link Instead         │    │
│  └──────────────────────────────────────┘    │
│                                              │
│              [EN | ES]                       │
│                                              │
└──────────────────────────────────────────────┘
```

---

## 2. Housekeeper Home Screen (Mobile)

```
┌──────────────────────────────────────────────┐
│  ☰  Good morning, Maria!          🔔 (3)     │
│  Austin Suites · Morning Shift               │
│  Thursday, March 6, 2026                     │
│  ────────────────────────────────────────    │
│                                              │
│  YOUR ROOMS TODAY  ·  8 assigned             │
│  ────────────────────────────────────────    │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  🔴  Room 412          CHECKOUT · ⚑VIP │  │
│  │  King Suite · ~40 min                  │  │
│  │  John Smith → 3:00 PM ⚠ START FIRST   │  │
│  │                          [Start →]     │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  🔴  Room 308              CHECKOUT    │  │
│  │  Standard Double · ~25 min             │  │
│  │  No early arrival                      │  │
│  │                          [Start →]     │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  🔵  Room 214           IN PROGRESS    │  │
│  │  Standard Double                       │  │
│  │  Started 9:15 AM · 22 min ago          │  │
│  │  [Add Note]          [Mark Clean ✓]   │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  🟡  Room 201         STAYOVER PICKUP  │  │
│  │  King Suite · ~20 min                  │  │
│  │                          [Start →]     │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  ⬜  Room 115              CHECKOUT    │  │
│  │  Standard Double · ~25 min             │  │
│  │                          [Start →]     │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ✅  COMPLETED TODAY: 2 rooms               │
│      Room 102 · Room 106                    │
│  ────────────────────────────────────────    │
│                                              │
│  [🏠 Rooms] [🤖 AI] [📖 Log] [🔔 Alerts]   │
│                              ┌────────────┐  │
│                              │ 🤖 Ask AI  │  │
│                              └────────────┘  │
└──────────────────────────────────────────────┘
```

---

## 3. Room Detail Screen (Mobile — Housekeeper)

```
┌──────────────────────────────────────────────┐
│  ← Back                     ⚑ VIP GUEST     │
│  Room 412 · King Suite · Floor 4             │
│  ────────────────────────────────────────    │
│  STATUS: IN PROGRESS 🔵                      │
│  Started 9:42 AM (18 min ago)                │
│  ────────────────────────────────────────    │
│                                              │
│  ARRIVING GUEST                              │
│  John Smith                                  │
│  Check-in: 3:00 PM TODAY ⚠                  │
│  VIP Level: Platinum                         │
│  Requests: Extra pillows, Hypoallergenic     │
│  ────────────────────────────────────────    │
│                                              │
│  QUICK ACTIONS                               │
│  ┌────────────┐ ┌────────────┐ ┌──────────┐  │
│  │  🔧 Report │ │  ✨ Extra  │ │  📋 SOP  │  │
│  │   Issue    │ │ Amenities  │ │  Guide   │  │
│  └────────────┘ └────────────┘ └──────────┘  │
│                                              │
│  RECENT MAINTENANCE                          │
│  ⚠ WO-1038 (2 days ago): Bathroom faucet   │
│    drip — Fixed by Carlos R.                 │
│  ────────────────────────────────────────    │
│                                              │
│  NOTES FOR THIS ROOM                         │
│  ┌──────────────────────────────────────┐    │
│  │ Add a note...                        │    │
│  └──────────────────────────────────────┘    │
│  ────────────────────────────────────────    │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │           ✓ Mark Room Clean          │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

---

## 4. AI Copilot Chat (Mobile — Overlay)

```
┌──────────────────────────────────────────────┐
│  🤖 AI Copilot              [Minimize] [✕]  │
│  ────────────────────────────────────────    │
│                                              │
│  [AI] 9:41 AM                               │
│  Good morning, Maria! You have 8 rooms       │
│  today. Room 412 is a VIP checkout with      │
│  a 3PM arrival — I'd start there first.     │
│                                              │
│  [YOU] 9:43 AM                              │
│  Room 412 needs extra towels and VIP         │
│  turndown setup                              │
│                                              │
│  [AI] 9:43 AM                               │
│  Got it! I'll create 2 tasks for Room 412:   │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │ 📋 Extra Towels                      │    │
│  │    Room 412 · Normal · Housekeeping  │    │
│  │                                      │    │
│  │ ⭐ VIP Turndown Setup               │    │
│  │    Room 412 · Urgent · Due 2:30PM    │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  ┌───────────────┐ ┌────────────────────┐   │
│  │  ✓ Confirm   │ │  ✏ Edit Details   │   │
│  └───────────────┘ └────────────────────┘   │
│                                              │
│  ────────────────────────────────────────    │
│  Quick Actions:                              │
│  [Report Issue] [Extra Amenities] [Ask SOP]  │
│  ────────────────────────────────────────    │
│  ┌──────────────────────────────────────┐    │
│  │ Ask me anything... (EN | ES)         │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

---

## 5. GM Dashboard (Web — Full Width)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  PatelRep                                  Austin Suites · Thu Mar 6  🔔(5)  John M. ▾ │
├──────────┬─────────────────────────────────────────────────────────────────────────────┤
│          │                                                                               │
│  📊 Dashboard │  Good morning, John! Here's today at Austin Suites.    [🤖 Copilot]   │
│  🏠 Housekeeping  ──────────────────────────────────────────────────────────────────── │
│  🔧 Engineering  │                                                                      │
│  👥 Staff    │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │
│  📅 Schedule  │  │ Labor Saved     │  │ Readiness Rate  │  │ SLA Compliance  │        │
│  📖 Logbook  │  │   12.4 hrs/wk   │  │     94%         │  │     91%         │        │
│  📋 SOP Lib  │  │ ▲ +2hr vs avg  │  │  ▲ +8% vs wk   │  │  ▼ -2% vs wk   │        │
│  📊 Reports  │  └─────────────────┘  └─────────────────┘  └─────────────────┘        │
│  ⚙ Settings │                                                                          │
│             │  ──────────────────────────────────────────────────────────────────────  │
│  💳 Billing  │  AI RISK ALERTS                                                         │
│             │  ┌──────────────────────────────────────────────────────────────────┐   │
│             │  │ ⚠ 3 ROOMS AT RISK of missing 3PM check-in                       │   │
│             │  │   Room 312 · 45 min late · Maria overloaded  [Reassign →]        │   │
│             │  │   Room 408 · 30 min late · Late checkout     [View →]            │   │
│             │  │   Room 214 · 10 min late · VIP guest         [View →]            │   │
│             │  │                                                                    │   │
│             │  │ ⚡ HVAC Unit 5F-North — 87% failure risk this month               │   │
│             │  │   3 work orders in 60 days  [Schedule Inspection →]               │   │
│             │  │                                                                    │   │
│             │  │ 🔴 WO-1042 SLA BREACH — AC Room 514 · 15 min overdue             │   │
│             │  │   [View Work Order →]                                              │   │
│             │  └──────────────────────────────────────────────────────────────────┘   │
│             │                                                                          │
│             │  ──────────────────────────────────────────────────────────────────────  │
│             │  LIVE OPERATIONS                                                          │
│             │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌──────────┐ │
│             │  │ Room Status   │  │ Work Orders   │  │ Staff On Shift│  │ Arrivals │ │
│             │  │  Dirty: 24   │  │  Open: 8      │  │  HK: 4        │  │ Today: 22│ │
│             │  │  In Prog: 8  │  │  Urgent: 2 🔴 │  │  Eng: 2       │  │ At Risk: │ │
│             │  │  Clean: 31   │  │  Normal: 6    │  │  FD: 1        │  │   3 ⚠   │ │
│             │  │  Inspected:15│  │               │  │               │  │          │ │
│             │  │  OOO: 2      │  │  [View All →] │  │  [Schedule →] │  │ [Board→] │ │
│             │  └───────────────┘  └───────────────┘  └───────────────┘  └──────────┘ │
│             │                                                                          │
│             │  30-DAY TRENDS                                                           │
│             │  ┌──────────────────────────────┐  ┌───────────────────────────────┐   │
│             │  │ SLA Compliance Rate (%)       │  │ Rooms/Hr by Housekeeper       │   │
│             │  │  100│                         │  │  3.0│    ██                   │   │
│             │  │   90│  ╭───────────╮          │  │  2.5│ ██ ██ ██              │   │
│             │  │   80│╭─╯           ╰──        │  │  2.0│ ██ ██ ██ ██          │   │
│             │  │     └──────────────────────   │  │     └──────────────────────   │   │
│             │  │     Feb 5         Mar 6        │  │     Maria Carmen Ana  Luis    │   │
│             │  └──────────────────────────────┘  └───────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Housekeeping Room Board (Web — Manager View)

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Housekeeping Board            Thu Mar 6 · Morning Shift              [?]  │
│  ──────────────────────────────────────────────────────────────────────    │
│  [📅 Mar 6 ▾] [Morning Shift ▾] [⚠ Show At-Risk Only] [Assign Mode 🔀]   │
│  Synced with Opera: 2 min ago ✓                 [🤖 AI Auto-Assign]        │
│  ──────────────────────────────────────────────────────────────────────    │
│                                                                            │
│  FLOOR 4                              4 rooms · 2 at risk                  │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌──────────┐ │
│  │ 412    🔴 DIRTY │ │ 408    🔴 DIRTY │ │ 404    🔵 PROG  │ │ 401 ✅  │ │
│  │ King Suite ⚑VIP │ │ Std Double      │ │ Std Double      │ │ Inspected│ │
│  │ Maria Garcia    │ │ Maria Garcia    │ │ Carmen Lopez    │ │          │ │
│  │ ETA: 3:45 ⚠   │ │ ETA: 3:30 ⚠   │ │ ETA: 2:00 ✓    │ │ [Details]│ │
│  │ [Reassign]      │ │ [Reassign]      │ │ [View]          │ │          │ │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘ └──────────┘ │
│                                                                            │
│  FLOOR 3                              5 rooms · 0 at risk                  │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐              │
│  │ 312    🔴 DIRTY │ │ 308    🟡 CLEAN │ │ 301  ✅ INSPEC  │              │
│  │ Double Queen    │ │ Standard Double │ │ Double Queen    │              │
│  │ Ana Martinez    │ │ Awaiting Inspect│ │                 │              │
│  │ ETA: 1:45 ✓    │ │                 │ │                 │              │
│  │ [View]          │ │ [Inspect Now]   │ │ [Details]       │              │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘              │
│                                                                            │
│  ── [Load More Floors] ──                                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Supervisor Inspection Screen (Mobile)

```
┌──────────────────────────────────────────────┐
│  ← Inspect Room 412          King Suite      │
│  Housekeeper: Maria Garcia                   │
│  ────────────────────────────────────────    │
│  Progress: 7 of 12 items ▓▓▓▓▓▓▓░░░░░ 58%  │
│  ────────────────────────────────────────    │
│                                              │
│  BATHROOM                        2 / 3 ✓    │
│  ┌──────────────────────────────────────┐    │
│  │  ✅  Toilet clean and flushing       │    │
│  │  ✅  Sink and countertop wiped       │    │
│  │  ──────────────────────────────────  │    │
│  │  ○  Towels folded correctly          │    │
│  │  [✅ Pass]  [❌ Fail]  [— N/A]      │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  SLEEPING AREA                   3 / 3 ✓    │
│  ┌──────────────────────────────────────┐    │
│  │  ✅  Bed made with hospital corners  │    │
│  │  ✅  Pillows positioned correctly    │    │
│  │  ✅  Nightstand clear and dusted     │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  GENERAL                         2 / 4 ✓    │
│  ┌──────────────────────────────────────┐    │
│  │  ✅  Floor vacuumed                  │    │
│  │  ✅  Trash emptied                   │    │
│  │  ──────────────────────────────────  │    │
│  │  ○  TV remote in designated spot     │    │
│  │  [✅ Pass]  [❌ Fail]  [— N/A]      │    │
│  │  ──────────────────────────────────  │    │
│  │  ○  Amenities fully stocked          │    │
│  │  [✅ Pass]  [❌ Fail]  [— N/A]      │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  Overall Notes:                              │
│  ┌──────────────────────────────────────┐    │
│  │ Bathroom minor issues only           │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  ┌────────────────┐  ┌──────────────────┐   │
│  │  ✅ Pass Room  │  │  ❌ Fail (re-do)  │   │
│  └────────────────┘  └──────────────────┘   │
└──────────────────────────────────────────────┘
```

---

## 8. Engineering Work Order Detail (Web)

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Work Orders      WO-1042          🔴 URGENT · IN PROGRESS        │
│  ─────────────────────────────────────────────────────────────────   │
│                                                                       │
│  AC Not Cooling — Room 514                                           │
│  ─────────────────────────────────────────────────────────────────   │
│                                                                       │
│  ┌─────────────────────────────────┐  ┌──────────────────────────┐  │
│  │ DETAILS                         │  │ ASSET                     │  │
│  │                                 │  │ HVAC Unit — Room 514      │  │
│  │ Created: Today 7:32 AM          │  │ Carrier 42XL15 (2019)     │  │
│  │ By: Front Desk (Sarah J.)       │  │ Age: 7 years              │  │
│  │ Assigned: Carlos Rodriguez      │  │                           │  │
│  │ Category: HVAC                  │  │ ⚡ Failure Risk: HIGH 87% │  │
│  │ Room: 514                       │  │                           │  │
│  │                                 │  │ History:                  │  │
│  │ SLA: 1 hour (URGENT)            │  │ • WO-1039 (15 days ago)  │  │
│  │ Due: 8:32 AM — ⚠ OVERDUE 23m  │  │ • WO-1022 (60 days ago)  │  │
│  │                                 │  │ • WO-0998 (85 days ago)  │  │
│  │ Description:                    │  │                           │  │
│  │ Guest reported AC not working.  │  │ [View Full History]       │  │
│  │ Room temp is 78°F. Guest        │  │ [Schedule Replacement]    │  │
│  │ checking out at 11AM.           │  └──────────────────────────┘  │
│  └─────────────────────────────────┘                                 │
│                                                                       │
│  PHOTOS                                                               │
│  [Before Photo ─ Tap to upload]  [After Photo ─ Tap to upload]       │
│                                                                       │
│  NOTES & LABOR                                                        │
│  Notes: ┌────────────────────────────────────────────────────────┐   │
│         │ Replaced capacitor, recharged refrigerant...           │   │
│         └────────────────────────────────────────────────────────┘   │
│  Parts: [AC Capacitor x1, R-410A Refrigerant 1lb]                    │
│  Labor: [1.5] hours                                                   │
│                                                                       │
│  ACTIVITY                                                             │
│  9:32 AM · System: WO created by Front Desk                          │
│  9:35 AM · Carlos: Claimed work order                                │
│  9:51 AM · Carlos: Parts ordered — waiting on capacitor              │
│                                                                       │
│  ┌────────────────────┐   ┌──────────────────┐   ┌───────────────┐  │
│  │  Mark Complete ✓   │   │  Put On Hold ⏸   │   │  Escalate ↑   │  │
│  └────────────────────┘   └──────────────────┘   └───────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 9. Onboarding Wizard (Web — Step 2: Import Rooms)

```
┌──────────────────────────────────────────────────────────────────────┐
│  PatelRep Setup                                        Step 2 of 6   │
│  ──────────────────────────────────────────────────────────────────  │
│  ●──●──○──○──○──○                                                    │
│  Profile · Rooms · Staff · Opera · SOPs · PM Schedule                │
│  ──────────────────────────────────────────────────────────────────  │
│                                                                       │
│  ┌───────────────────────────────────────┐  ┌─────────────────────┐ │
│  │  IMPORT YOUR ROOMS                    │  │  AI Assistant       │ │
│  │  ─────────────────────────────────    │  │  ─────────────────  │ │
│  │                                       │  │                     │ │
│  │  Option 1: Connect Opera Cloud        │  │  Hi John! Importing │ │
│  │  ┌─────────────────────────────────┐  │  │  rooms is the       │ │
│  │  │  Connect Opera Cloud (fastest)  │  │  │  fastest way to     │ │
│  │  └─────────────────────────────────┘  │  │  get started.       │ │
│  │                                       │  │                     │ │
│  │  Option 2: Upload CSV                 │  │  Your hotel has 87  │ │
│  │  ┌─────────────────────────────────┐  │  │  rooms. I'll create │ │
│  │  │  Download Template  ↓           │  │  │  them all in about  │ │
│  │  └─────────────────────────────────┘  │  │  30 seconds once    │ │
│  │  [Drop CSV here or click to upload]   │  │  you connect Opera. │ │
│  │                                       │  │                     │ │
│  │  Option 3: Add Manually               │  │  💡 Tip: Connecting │ │
│  │  ┌─────────────────────────────────┐  │  │  Opera now also     │ │
│  │  │  Add Rooms Manually             │  │  │  enables real-time  │ │
│  │  └─────────────────────────────────┘  │  │  room status sync   │ │
│  │                                       │  │  and VIP guest      │ │
│  │  Preview (after upload):              │  │  detection.         │ │
│  │  ┌─────────────────────────────────┐  │  │                     │ │
│  │  │ Room #  Floor  Type    Status   │  │  │  Any questions?     │ │
│  │  │ 101     1      Std DB  Ready    │  │  │  ┌───────────────┐  │ │
│  │  │ 102     1      Std DB  Ready    │  │  │  │ Ask me...     │  │ │
│  │  │ 103     1      King    Ready    │  │  │  └───────────────┘  │ │
│  │  │ ... (87 rooms total)            │  │  └─────────────────────┘ │
│  │  └─────────────────────────────────┘  │                          │
│  │                                       │                          │
│  │  [← Back]                [Continue →] │                          │
│  └───────────────────────────────────────┘                          │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 10. AI Copilot Web Panel (Bottom-Right Overlay)

```
Collapsed state:
                          ┌─────────────────┐
                          │  🤖 AI Copilot  │
                          └─────────────────┘

Expanded state (300px wide, 450px tall, floating):
┌────────────────────────────────────────┐
│  🤖 PatelRep AI                    [✕] │
│  ──────────────────────────────────    │
│                                        │
│  [AI] Based on today's ops:            │
│  • 3 rooms at risk for 3PM check-in   │
│  • WO-1042 is overdue (HVAC 514)      │
│  • Maria is overloaded (8 rooms)      │
│                                        │
│  Suggested: Reassign rooms 312 and    │
│  408 from Maria to Carmen (4 left).   │
│  ┌─────────────────────────────────┐  │
│  │  Reassign Both to Carmen  →     │  │
│  └─────────────────────────────────┘  │
│                                        │
│  [You] Show me SLA compliance today    │
│                                        │
│  [AI] Today's SLA compliance:          │
│  • Housekeeping: 91% (10/11 on time)  │
│  • Engineering: 87% (7/8 on time)     │
│  • WO-1042 is the only active breach  │
│  Overall: 90% — slightly below your   │
│  weekly average of 94%.               │
│                                        │
│  ──────────────────────────────────    │
│  QUICK ACTIONS                         │
│  [At-Risk Rooms] [SLA Status] [Labor]  │
│  ──────────────────────────────────    │
│  ┌──────────────────────────────────┐  │
│  │ Ask anything about your hotel... │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

---

## 11. Notification Center (Mobile)

```
┌──────────────────────────────────────────────┐
│  ← Notifications             [Mark All Read] │
│  ────────────────────────────────────────    │
│                                              │
│  NOW                                         │
│  ┌────────────────────────────────────────┐  │
│  │ 🔴 SLA BREACH                   2m ago │  │
│  │ WO-1042 (AC Room 514) is 15 min overdue│  │
│  │ Carlos Rodriguez is assigned           │  │
│  │ [View Work Order]                      │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ ⚠ ROOM AT RISK                  5m ago │  │
│  │ Room 312 may miss 3PM check-in by 45min│  │
│  │ Maria Garcia has 8 rooms remaining     │  │
│  │ [View Room] [Reassign]                 │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  EARLIER TODAY                               │
│  ┌────────────────────────────────────────┐  │
│  │ ✅ Task Completed              47m ago │  │
│  │ Extra Towels - Room 412                │  │
│  │ Completed by Maria Garcia              │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ 📋 New Task Assigned           1h ago  │  │
│  │ VIP Turndown Setup - Room 412          │  │
│  │ Due by 2:30 PM today                   │  │
│  │ [View Task]                            │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```
