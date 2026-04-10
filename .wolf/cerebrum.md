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

## Decision Log

<!-- Significant technical decisions with rationale. Why X was chosen over Y. -->
