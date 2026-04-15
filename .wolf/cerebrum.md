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
- [2026-04-15] **When a DB trigger is dropped, audit all callers for explicit writes** — Migration 024 dropped `handle_room_status_history` but both `rooms.py` and `housekeeping.py` still had comments saying "written automatically by trigger." Neither wrote explicitly. Result: empty history. After dropping any trigger, search for every endpoint that relied on it and add explicit writes.
- [2026-04-15] **`date` must be imported explicitly from `datetime`** — `from datetime import datetime, timezone` does NOT import `date`. Calling `date.today()` without it raises NameError at runtime. Always include `date` in the import when using `date.today()` or `date` type hints in FastAPI routers.
- [2026-04-15] **React Query keys must include user identity** — `queryKey: ['my-rooms']` without user ID serves cached data from a previous session. Any per-user query must include the user ID in the key (e.g. `['my-rooms', user?.id]`) and be guarded with `enabled: !!user?.id`.
- [2026-04-15] **`reset()` in a useEffect without a run-once guard causes form input loss** — React Query background refetches update query data silently, re-triggering any `useEffect` that depends on that data. If `reset()` is called inside, it wipes user's in-progress edits. Always use a `useRef(false)` hydration guard so `reset()` only runs once on initial load.
- [2026-04-15] **`/my-rooms` must query `room_assignments` for today, not filter `room_status` by status** — `room_status.assigned_to` persists across days and doesn't reset. Filtering `room_status` by `assigned_to + status` returns rooms from previous days that were never reassigned. Correct pattern: query `room_assignments` for `assignment_date = today`, then fetch `room_status` for those room_ids.

## Decision Log

<!-- Significant technical decisions with rationale. Why X was chosen over Y. -->
