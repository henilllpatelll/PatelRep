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

- **Login controls must wait for hydration:** The login page is SSR-rendered before React handlers attach. Inputs/buttons should remain disabled until a client `useEffect` hydration flag flips, otherwise Playwright or a very fast user can type visible values while React state stays empty.
- **Do not run `next build` while `next dev` is serving the same app:** Next rewrites `.next` during build and can corrupt the dev server module cache (`__webpack_modules__[moduleId] is not a function`). Stop/restart dev before browser e2e after a build.
- **Railway API deploy must use `--path-as-root`:** For this monorepo, deploy API with `railway up apps/api --path-as-root --service api`; otherwise Railway can use the root `railway.toml` and build the web Dockerfile for the API service.
- **Production Railway URLs (new account, 2026-05-10):** Web is `https://patelrepweb-production.up.railway.app`; API is `https://api-production-130b.up.railway.app`; Playwright default should point at the web URL.
- **Production smoke auth (2026-05-10):** Authenticated web smoke uses the e2e GM test account from `e2e/auth.setup.ts`; production Supabase stores SSR auth in the `sb-oacnwalhcpqdabivweki-auth-token` cookie, not localStorage.
- **Production smoke findings (2026-05-10):** `/billing` currently throws a client `toLocaleString` null/undefined error; task and guest-request updates 500 if `notes` is sent because production tables lack `notes` columns. Status-only task/guest-request updates succeed.
- **Billing API can return sparse usage payloads:** `/v1/billing/credits` may return `{data: {message: "No billing period found"}}` with no numeric fields. Both `/billing` and `/settings/billing` must treat billing numeric fields as optional and format with safe defaults.
- **Billing verification (2026-05-10):** Current `/billing` renders successfully on both `https://patelrepweb-production.up.railway.app/billing` and local `http://localhost:3000/billing` after GM login; a Page Error screenshot is likely from an old/stale bundle or old Railway URL unless new console logs say otherwise.
- **Task/guest request notes live in `task_comments`:** The `tasks` and `guest_requests` tables do not have `notes`; update endpoints should never forward `notes` directly to Supabase table updates. Map non-empty notes to `task_comments` for the task or linked guest-request task.
- **Railway smoke fixes require deploying both services:** Billing UI fixes need `@patelrep/web` from repo root; API router fixes need `railway up apps/api --path-as-root --service api` so Railway uses `apps/api/Dockerfile`.
- **Production role-test setup (2026-05-10):** Existing production credentials support browser login for `gm`, `housekeeper`, and `engineer`. `front_desk` and `housekeeping_supervisor` users exist but no known working test credentials were found; no active `chief_engineer` user exists. Full browser/action RBAC coverage needs temporary `@patelrep-test.com` users or provided credentials.
- **Production RBAC findings (2026-05-10):** Sidebar filtering is not a route guard. Lower-privilege users can directly open hidden dashboard routes; backend may still 403 data calls. `/settings` is visible to every role, and `PATCH /v1/hotels/{hotel_id}` is currently guarded by `ALL_STAFF_ROLES`, so settings updates need a stricter backend role gate.
- **Production field dashboards (2026-05-10):** Housekeeper and engineer dashboards issue forbidden reports requests (`/reports/daily-summary`, `/reports/staff-performance`, `/reports/maintenance`). `/housekeeping` also calls `/staff` for roles that cannot access staff, producing console/API 403 noise.
- **RBAC fix pattern (2026-05-10):** Frontend route RBAC now lives in `apps/web/middleware.ts` using decoded Supabase JWT role claims after `getUser()` verification. Dashboard pages must render a loading skeleton while `useAuthStore.isLoading || !role` to avoid briefly mounting GM-only data components.

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

- [2026-05-09] **Authenticated e2e currently depends on unavailable external infra** — Railway reports latest web/API deployments as `REMOVED`, both public Railway URLs return 404, and the configured Supabase project host is NXDOMAIN. Use local unauthenticated e2e plus API/web checks until Railway deployment and Supabase DNS are restored.
- [2026-05-09] **Run Next checks sequentially around `.next/types`** — `tsc --noEmit` can fail with TS6053 if run while `next build` is deleting/regenerating `.next/types`. Run `next build` first, then `tsc --noEmit`, and do not run them in parallel.
- [2026-05-10] **Do not copy local `.env` values directly to Railway without checking environment-specific keys** — `apps/api/.env` had `APP_ENV=development`; set Railway API `APP_ENV=production` explicitly after copying secrets.
- [2026-05-10] **Quote PowerShell paths containing route-group parentheses** — paths like `apps/web/app/(dashboard)/billing/page.tsx` must be single-quoted in shell commands, or PowerShell treats `(dashboard)` as expression syntax and the command fails.
- [2026-05-10] **Railway CLI deployment log syntax changed/strict** — do not combine `railway logs --deployment` with `--build`; use `railway logs --deployment --lines N <deployment_id>` or the Railway MCP `get_logs` tool for build logs.

## Key Learnings

- **Load test results (2026-05-10, 30 workers 30s production):** 0% 5xx — API stable under concurrency. 4xx = 19.2% (all from `/housekeeping/my-rooms` with GM token — GM has no room assignments; real housekeeper tokens return 200). p50 ~400-900ms acceptable. p95 spikes: `/my-rooms` 5.8s, `/housekeeping/board` 4.3s, `/work-orders` 4.1s, `/guest-requests` 3.1s — classic Supabase connection pool / unindexed query degradation under concurrent load. Core bottleneck is Supabase, not FastAPI.
- **Load test lives at:** `apps/api/tests/load/load_test.py` — reads `apps/api/.env` + `apps/web/.env.local` automatically; no extra config needed. Run with `python apps/api/tests/load/load_test.py --workers 30 --duration 30`.

## Decision Log

<!-- Significant technical decisions with rationale. Why X was chosen over Y. -->

- [2026-05-10] **FrontDeskDashboard must NOT call reportsApi.getDailySummary()** — `/reports/daily-summary` requires `gm/housekeeping_supervisor/chief_engineer`; front_desk gets 403. Fixed by calling `housekeepingApi.getBoard(today, undefined, false)` (no role restriction) and computing breakdown locally.
- [2026-05-10] **PATCH /v1/hotels/{hotel_id} is already GM-only** via `require_role("gm")` — do not widen it.
- [2026-05-10] **Next.js middleware already has full ROLE_ROUTE_RULES** matching NAV_BY_ROLE — route-level RBAC is enforced at the edge.
- [2026-05-11] **Tenant isolation IDOR pattern in hotels.py** — `GET /hotels/{hotel_id}/departments` was missing the `if current_user.hotel_id != hotel_id: raise HTTPException(403)` guard. All path-parameterized hotel endpoints must do this explicit check because the supabase client uses the service role key (RLS bypassed). The fix pattern used by `get_hotel` and `update_hotel` is the authoritative template.
- [2026-05-11] **task_comments insert must pre-check task ownership** — `POST /tasks/{task_id}/comments` must verify `task_id` belongs to `current_user.hotel_id` before inserting. Without this, an attacker with a cross-tenant task UUID can inject comments visible to that tenant's users (get_task embeds task_comments by task_id).
- [2026-05-11] **500 on GET by nonexistent UUID** — GET endpoints that use `.maybe_single()` with joined selects (rooms, tasks, work-orders, lost-found, assets) return 500 instead of 404 when the resource ID doesn't exist. This is a supabase-py exception handling issue — inspect Railway logs to find exact exception type and add targeted try/except.
- [2026-05-11] **Correct API paths for testing** — `/sop-documents` → `/sop`? Actually both 404. `/logbook` → 404 but `/logbook/entries` → 200. `/scheduling/shifts` → 404 (check router prefix). `/integrations` → 404 (check router prefix). Need to verify correct paths before testing unauthenticated access on these domains.
- [2026-05-10] **HousekeeperBar staff fetch is already correctly gated** — component only mounts when `assignmentMode && canAssignRooms`; both gm and housekeeping_supervisor can call `GET /staff`.
