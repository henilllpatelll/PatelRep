# PatelRep — Mobile App (Milestone 2)

## What This Is

PatelRep Mobile is the React Native (Expo SDK 51) companion app for hotel staff at independent Texas hotels. It gives housekeepers a fast way to manage their assigned rooms through the full status cycle and engineers a way to claim and update work orders — all from their phone, on the floor, without needing a laptop.

## Core Value

A housekeeper can open the app, see their rooms, mark them clean, and report issues — in under 30 seconds per room, even with spotty Wi-Fi.

## Requirements

### Validated

- ✓ Expo Router file-based navigation scaffolded — existing
- ✓ Supabase auth (magic link + password) wired — existing
- ✓ My Rooms screen with status colors and room cards — existing (stub)
- ✓ Work Orders screen with open/in_progress/completed tabs — existing (stub)
- ✓ Work Order detail screen — existing (stub)
- ✓ Room detail screen — existing (stub)
- ✓ Offline SQLite + sync queue scaffolded — existing
- ✓ Push notification lib scaffolded (Expo Push) — existing
- ✓ appStore Zustand with hotel/user context — existing
- ✓ i18n EN/ES wired — existing

### Active

- [ ] Housekeeper: view only rooms assigned to them (not all hotel rooms)
- [ ] Housekeeper: update room status through full cycle (DIRTY → IN_PROGRESS → CLEAN)
- [ ] Housekeeper: report an issue from a room (creates work order)
- [ ] Engineer: view work orders assigned to or claimable by them
- [ ] Engineer: claim open work order, update status (OPEN → IN_PROGRESS → DONE)
- [ ] Engineer: add notes/resolution to a work order
- [ ] Push notification when a room is assigned to a housekeeper
- [ ] Push notification when a work order is assigned to an engineer
- [ ] Show cached room/work order data when offline; sync on reconnect
- [ ] Login works end-to-end (magic link + password) on device
- [ ] Profile screen shows name, role, hotel

### Out of Scope

- Supervisor assignment UI (web dashboard handles this) — defer to v2
- Inspection workflow on mobile — web-only for pilot
- GM analytics / reports — web-only
- AI Copilot chat on mobile — defer to v2 (stub screen stays)
- Scheduling / shift management — web-only for pilot
- SOP library browsing on mobile — defer to v2

## Context

- App is scaffolded at `apps/mobile/` — screens exist but most are stubs with no real API calls
- API is live on Railway; auth middleware uses Supabase JWT with `hotel_id` + `role` claims
- Housekeeping board and work order endpoints already exist in the FastAPI backend
- Push uses Expo Push Notifications (APNs + FCM) — token registration needs to be wired to the backend
- Offline uses Expo SQLite (`lib/offline/db.ts`) + sync queue (`lib/offline/sync.ts`) — both exist but need room + work order tables confirmed
- The pilot hotel has ~80 rooms and ~6 housekeepers + 2 engineers

## Constraints

- **Tech stack**: React Native + Expo SDK 51 — no bare workflow, managed only
- **Distribution**: EAS Build for TestFlight (iOS) + APK sideload (Android) for pilot — no App Store submission yet
- **Backend**: All data goes through the existing FastAPI at Railway — no direct Supabase calls from mobile except auth
- **Timeline**: Pilot hotel needs this before end of free trial month

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Staff-only features in v1 | GMs use web dashboard; housekeepers need fast mobile UX, not full parity | — Pending |
| Managed Expo (no bare workflow) | Solo builder, OTA updates, no native module complexity needed for v1 | — Pending |
| API-first (no direct Supabase from mobile) | Auth + RLS already enforced at API layer; consistent with web | — Pending |
| EAS Build for distribution | TestFlight for pilot testing without App Store review delays | — Pending |

---
*Last updated: 2026-03-19 after initialization*
