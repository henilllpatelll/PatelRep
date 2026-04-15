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
- [2026-04-15] **Never use toISOString() for local-date strings** — `new Date().toISOString().split('T')[0]` returns a UTC date. For a Texas hotel (CDT = UTC−5), this shows the *next* day after ~7 PM local time. Always use `format(new Date(), 'yyyy-MM-dd')` from date-fns for local-timezone date strings. Bug found in `housekeepingStore.ts:todayISO()`.
- [2026-04-15] **Time-based greetings in SSR cause hydration errors** — Calling `new Date().getHours()` inside a component that renders on the server produces a different string than the client (different clock instant + different timezone). Wrap time-dependent text in `useEffect`+`useState` to make it client-only, or add `suppressHydrationWarning` on the element.
- [2026-04-15] **Raw DB enum values must be formatted before display** — Status keys from API responses (`IN_PROGRESS`, `INSPECTED`, `UNCLAIMED`) are PostgreSQL enum values. Always apply `.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())` or use a STATUS_LABELS map before rendering in UI. Reports, Guest Requests, and Lost & Found stat cards showed raw enums.

## Decision Log

<!-- Significant technical decisions with rationale. Why X was chosen over Y. -->
