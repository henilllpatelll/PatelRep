# Roadmap: PatelRep Mobile (Milestone 2)

## Overview

The mobile app scaffold exists but is not functional on real devices — auth flashes, push tokens are hardcoded placeholders, and the sync queue silently accumulates failures. This roadmap delivers the app in four phases: first, fix the broken foundation so every subsequent test produces honest results; then wire the housekeeper workflow (the pilot's primary use case); then the engineer workflow with real push delivery and EAS build distribution; finally, activate the AI-sourced differentiators (ETA, risk badges, sync timestamp) that no competitor offers.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - Fix auth hydration, 401 recovery, push token wiring, and offline banner so every screen works correctly on a physical device
- [ ] **Phase 2: Housekeeper Workflow** - Wire real room data, status updates, offline sync hardening, issue reporting, and profile screen so housekeepers can run a full shift from the app
- [ ] **Phase 3: Engineer Workflow + Push + EAS** - Wire work orders, activate push notification delivery end-to-end, and produce APK/IPA builds for pilot distribution
- [ ] **Phase 4: Polish + Differentiators** - Enable AI-sourced ETA and risk badges, sync timestamp badge, and language auto-detect so the app's competitive edge is visible to the pilot hotel

## Phase Details

### Phase 1: Foundation
**Goal**: A staff member can open the app on a physical device, log in (password or magic link), background and return during a shift, and never see a spurious login screen or an API call fail silently due to an expired token
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, INFRA-01, INFRA-04
**Success Criteria** (what must be TRUE):
  1. User logs in with email/password on a physical Android or iOS device and reaches the home screen without error
  2. User taps a magic link email, the link opens the app (not the browser), and the session is established
  3. User backgrounds the app for 30+ minutes and returns mid-shift — the app resumes on the last screen without a login redirect
  4. App cold-opens to the home screen (no login flash) when a valid session exists in storage
  5. App shows a persistent "Offline" banner on all screens when the device has no internet connection
**Plans**: 4 plans

Plans:
- [x] 01-01-PLAN.md — Test infrastructure (jest-expo, jest.config.js, failing test scaffolds for INFRA-01 and INFRA-04)
- [x] 01-02-PLAN.md — Core fixes (appStore isLoading, AppState token refresh, 401 retry wrapper)
- [ ] 01-03-PLAN.md — Layout hydration guards and OfflineBanner (SplashScreen, redirect guards, offline banner)
- [ ] 01-04-PLAN.md — Magic link deep linking (+native-intent.ts, auth callback route)

### Phase 2: Housekeeper Workflow
**Goal**: A housekeeper can see only their assigned rooms, update each room through the full status cycle, report issues, and trust that status changes made offline will sync reliably when Wi-Fi returns
**Depends on**: Phase 1
**Requirements**: HK-01, HK-02, HK-03, HK-04, HK-05, HK-06, HK-07, PROF-01, PROF-02, L10N-01
**Success Criteria** (what must be TRUE):
  1. Housekeeper sees only rooms assigned to them — not all hotel rooms — with room number, floor, current status, and ETA displayed on each card
  2. Housekeeper updates a room from DIRTY to IN_PROGRESS to CLEAN in under 3 taps; the card reflects the new status immediately (optimistic UI)
  3. Housekeeper puts device in airplane mode, updates two room statuses, restores connectivity, and both updates appear on the web dashboard within 10 seconds
  4. Housekeeper taps "Report Issue" on a room detail screen, fills in a description, submits, and a work order appears on the engineering dashboard with the room pre-filled
  5. Profile screen shows the user's name, role, and hotel name; tapping "Sign Out" returns to the login screen
**Plans**: TBD

### Phase 3: Engineer Workflow + Push + EAS
**Goal**: An engineer can claim and resolve work orders from their phone; both engineers and housekeepers receive push notifications on assignment; and the pilot hotel can install the app via APK sideload (Android) or TestFlight (iOS)
**Depends on**: Phase 2
**Requirements**: ENG-01, ENG-02, ENG-03, ENG-04, ENG-05, ENG-06, ENG-07, INFRA-02, INFRA-03
**Success Criteria** (what must be TRUE):
  1. Engineer sees their assigned work orders plus all open/unclaimable orders; each card shows title, priority, status, and room number
  2. Engineer taps "Claim" on an open work order — status changes to IN_PROGRESS — then taps "Mark Done", adds a resolution note, and the web dashboard reflects DONE with the note
  3. Work order status updates made offline sync to the server when connectivity is restored, matching the offline-first behavior of room status updates
  4. Housekeeper receives a push notification (tap opens the correct room) when a room is assigned to them; engineer receives a push notification (tap opens the correct work order) when a WO is assigned to them — verified on physical devices
  5. EAS Build produces an installable APK for Android sideload and an IPA accepted by TestFlight internal distribution
**Plans**: TBD

### Phase 4: Polish + Differentiators
**Goal**: The pilot hotel staff can see AI-sourced ETAs and risk flags on room cards, trust the sync state via a visible timestamp, and use the app in their preferred language from first launch
**Depends on**: Phase 3
**Requirements**: (no new v1 requirements — this phase activates v1 data already flowing from the backend)
**Success Criteria** (what must be TRUE):
  1. Room cards show an AI-predicted ETA (e.g., "Ready by 2:15 PM") and a HIGH risk badge when the backend prediction payload contains them
  2. App displays a sync badge ("Saved 2 min ago") that updates after each successful sync flush
  3. On first launch on a Spanish-language device, the app opens in Spanish without manual toggle; the language preference persists across restarts
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/4 | In Progress|  |
| 2. Housekeeper Workflow | 0/TBD | Not started | - |
| 3. Engineer Workflow + Push + EAS | 0/TBD | Not started | - |
| 4. Polish + Differentiators | 0/TBD | Not started | - |
