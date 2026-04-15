# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: 2026-04-09

## User Preferences

<!-- How the user likes things done. Code style, tools, patterns, communication. -->

## Key Learnings

- **Project:** patelrep
- **Description:** AI Staff Copilot SaaS for independent Texas hotels. Quore-style simplicity with AI-powered predictions — built for housekeepers and engineers on the floor.
- **Role dashboards:** Each role has a dedicated dashboard component in `components/dashboard/`. The `dashboard/page.tsx` switches on `useRole().role`. Housekeeper uses `getMyRooms()` + `tasksApi.list({ assigned_to })`. Engineer uses `listWorkOrders({ assigned_to })`. Supervisor uses daily summary + AI alerts. Chief uses all WOs + PM schedules + failure predictions. Front Desk uses daily summary + guest requests.
- **BadgeVariant not exported:** `BadgeVariant` type in `Badge.tsx` is internal — define it locally in components that need it.

## Do-Not-Repeat

<!-- Mistakes made and corrected. Each entry prevents the same mistake recurring. -->
<!-- Format: [YYYY-MM-DD] Description of what went wrong and what to do instead. -->

- [2026-04-14] **Notes via updateRoomStatus silently fail** — `PATCH /rooms/{id}/status` validates transitions; same-to-same status (e.g. DIRTY→DIRTY) is not in ALLOWED_TRANSITIONS and throws 400. Always use `POST /rooms/{id}/notes` for note-only saves. Frontend: `housekeepingApi.addNote(roomId, text)`.
- [2026-04-14] **doneCount must be INSPECTED-only** — CLEAN means "awaiting inspection", not done. Both `housekeeping/page.tsx` and `HousekeeperDashboard.tsx` had this wrong. Filter only `status === 'INSPECTED'` for completion counts.
- [2026-04-14] **Framer Motion layoutId must be unique per DOM subtree** — Sharing `layoutId="sidebar-active"` between main nav and bottom links causes cross-subtree spring animations. Bottom links use `layoutId="sidebar-bottom-active"`.

## Decision Log

<!-- Significant technical decisions with rationale. Why X was chosen over Y. -->
