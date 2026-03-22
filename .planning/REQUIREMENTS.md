# Requirements: PatelRep Mobile (Milestone 2)

**Defined:** 2026-03-20
**Core Value:** A housekeeper opens the app, sees their rooms, marks them clean, and reports issues — in under 30 seconds per room, even with spotty Wi-Fi.

## v1 Requirements

### Authentication

- [x] **AUTH-01**: User can log in with email/password on a physical device
- [x] **AUTH-02**: User can log in via magic link (deep link opens app, not browser)
- [x] **AUTH-03**: Auth session persists across app restarts without re-login
- [x] **AUTH-04**: App does not flash login screen on cold open for authenticated users (hydration guard)
- [x] **AUTH-05**: Auth session auto-refreshes during an 8-hour shift without logging user out

### Infrastructure

- [x] **INFRA-01**: API client retries with fresh token on 401 instead of hard logout
- [x] **INFRA-02**: Push notification token is registered with the backend on each login (via API, not direct Supabase)
- [x] **INFRA-03**: EAS Build produces APK (Android sideload) and IPA (TestFlight) for pilot distribution
- [x] **INFRA-04**: App shows "offline" banner when device has no internet connection

### Housekeeping

- [x] **HK-01**: Housekeeper sees only rooms assigned to them (not all hotel rooms)
- [x] **HK-02**: Room list shows room number, floor, status, and ETA (from predictions)
- [x] **HK-03**: Housekeeper can update room status through full cycle (DIRTY → IN_PROGRESS → CLEAN)
- [x] **HK-04**: Status update works offline and syncs when back online
- [x] **HK-05**: Housekeeper receives push notification when a room is assigned to them
- [x] **HK-06**: Housekeeper can report an issue from a room detail screen (creates work order)
- [x] **HK-07**: Room detail shows VIP flag and checkin time when relevant

### Engineering

- [x] **ENG-01**: Engineer sees work orders assigned to them + open/unassigned work orders
- [x] **ENG-02**: Work order list shows title, priority, status, and room number
- [x] **ENG-03**: Engineer can claim an open work order
- [x] **ENG-04**: Engineer can update work order status (OPEN → IN_PROGRESS → DONE)
- [x] **ENG-05**: Engineer can add resolution notes to a work order
- [x] **ENG-06**: Engineer receives push notification when a work order is assigned to them
- [x] **ENG-07**: Work order status updates work offline and sync when back online

### Profile

- [x] **PROF-01**: Profile screen shows user's name, role, and hotel name
- [x] **PROF-02**: User can sign out from profile screen

### Localisation

- [x] **L10N-01**: All new UI strings have EN and ES translations

## v2 Requirements

### Supervisor Mobile

- **SUP-01**: Supervisor can view full room board (all rooms, not just assigned)
- **SUP-02**: Supervisor can reassign a room to a different housekeeper
- **SUP-03**: Supervisor can approve/reject an inspection from mobile

### Inspections

- **INSP-01**: Supervisor can run an inspection checklist from mobile
- **INSP-02**: Housekeeper sees pass/fail result of their inspections

### AI Copilot

- **AI-01**: Staff can ask AI questions about SOPs from mobile chat screen
- **AI-02**: AI suggests next action based on current room status

### Photos

- **PHOTO-01**: Housekeeper can attach a photo when reporting an issue
- **PHOTO-02**: Engineer can attach a photo to work order resolution

## Out of Scope

| Feature | Reason |
|---------|--------|
| Scheduling on mobile | Web-only for pilot — GM manages shifts via dashboard |
| SOP library browsing | Web-only for pilot — too much content for v1 mobile |
| Reports / analytics | GM use case — web dashboard |
| Multi-hotel switching | Single hotel per account in pilot |
| Biometric login | Adds native module complexity — defer |
| In-app chat between staff | Out of scope for pilot — not core workflow |

## Traceability

*Updated after roadmap creation — 2026-03-20*

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Complete |
| AUTH-02 | Phase 1 | Complete |
| AUTH-03 | Phase 1 | Complete |
| AUTH-04 | Phase 1 | Complete |
| AUTH-05 | Phase 1 | Complete |
| INFRA-01 | Phase 1 | Complete |
| INFRA-04 | Phase 1 | Complete |
| HK-01 | Phase 2 | Complete |
| HK-02 | Phase 2 | Complete |
| HK-03 | Phase 2 | Complete |
| HK-04 | Phase 2 | Complete |
| HK-05 | Phase 2 | Complete |
| HK-06 | Phase 2 | Complete |
| HK-07 | Phase 2 | Complete |
| PROF-01 | Phase 2 | Complete |
| PROF-02 | Phase 2 | Complete |
| L10N-01 | Phase 2 | Complete |
| ENG-01 | Phase 3 | Complete |
| ENG-02 | Phase 3 | Complete |
| ENG-03 | Phase 3 | Complete |
| ENG-04 | Phase 3 | Complete |
| ENG-05 | Phase 3 | Complete |
| ENG-06 | Phase 3 | Complete |
| ENG-07 | Phase 3 | Complete |
| INFRA-02 | Phase 3 | Complete |
| INFRA-03 | Phase 3 | Complete |

**Coverage:**
- v1 requirements: 26 total
- Mapped to phases: 26
- Unmapped: 0 ✓

**Phase 4 note:** Phase 4 (Polish + Differentiators) delivers ETA display, sync badge, and locale auto-detect — these surface data from requirements already mapped above (HK-02 covers ETA display; Phase 4 is activation/polish work, not additional v1 requirements).

---
*Requirements defined: 2026-03-20*
*Last updated: 2026-03-20 after roadmap creation*
