# OpenWolf

@.wolf/OPENWOLF.md

This project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.


# PatelRep — Claude Instructions

AI Staff Copilot SaaS for 50–150 room Texas hotels ($99/mo + $0.02/AI credit, cap $2.50/room/month).
**Code decision filter:** Every feature must save a housekeeper or engineer time on the floor — not add complexity to their phone.

---

## Commands

```bash
npm run dev:api                  # FastAPI on :8000 (uvicorn --reload)
npm run dev:web                  # Next.js on :3000

cd apps/api && pip install -r requirements.txt
cd apps/api && pytest tests/     # API tests

# Railway prod build (web)
npm run build --workspace=@patelrep/web \
  && cp -r apps/web/public apps/web/.next/standalone/ \
  && cp -r apps/web/.next/static apps/web/.next/standalone/.next/static
node apps/web/.next/standalone/server.js
```

---

## Directory Structure

```
PatelRep/
├── apps/
│   ├── api/              FastAPI Python 3.12 (Railway, Dockerfile)
│   │   ├── main.py       App factory + router registry (add new domains here)
│   │   ├── core/         config.py (Pydantic Settings), database.py (Supabase singleton)
│   │   ├── routers/      21 domain files — one per domain, most business logic lives here
│   │   ├── services/     ai/, opera/, policy.py — keep other logic in routers until shared 2+ domains
│   │   ├── models/       Pydantic request/response schemas only
│   │   └── middleware/   auth.py (JWT validation), credits.py (AI credit gate per-route)
│   ├── web/              Next.js 14 App Router (Railway, Dockerfile)
│   │   ├── app/(auth)/   Unauthenticated routes (login)
│   │   ├── app/(dashboard)/ 16 feature sections (authenticated)
│   │   ├── components/   ai/, dashboard/, engineering/, housekeeping/, shared/, ui/
│   │   │                 dashboard/ has role-specific views: HousekeeperDashboard, SupervisorDashboard,
│   │   │                 EngineerDashboard, ChiefEngineerDashboard, FrontDeskDashboard
│   │   ├── lib/api/      Typed API clients per domain (housekeepingApi, staffApi, …)
│   │   ├── lib/hooks/    useAuth, useRole, useCountUp, useModalFocusTrap
│   │   ├── lib/ai/       clientFastPath.ts — client-side AI fast-path helpers
│   │   ├── lib/supabase/ Supabase client helpers
│   │   ├── lib/utils/    Shared utilities (avatar, etc.)
│   │   ├── stores/       Zustand: authStore, hotelStore, housekeepingStore, engineeringStore
│   │   └── middleware.ts Route guard → /login (no session) or /onboarding (no hotel_id)
│   └── mobile/           Expo React Native (EAS build, iOS + Android)
│       ├── app/(auth)/   Login screen
│       ├── app/(app)/    Authenticated screens: copilot, my-rooms, profile, tasks, work-orders
│       ├── components/   housekeeping/, shared/
│       ├── lib/api/      client.ts, workOrders.ts
│       ├── stores/       appStore.ts
│       └── i18n/         Localization
├── supabase/migrations/  001–041 sequential SQL — schema source of truth
├── .planning/            GSD: STATE.md, ROADMAP.md, phases/
└── railway.toml          Two services: api + web (both Dockerfile)
```

---

## Domain Map

| Domain | API router | Web route |
|---|---|---|
| Auth | auth.py | (auth)/login |
| Hotels / Onboarding | hotels.py, onboarding.py | (dashboard)/onboarding |
| Rooms | rooms.py | — (internal API, no dedicated web route) |
| Housekeeping | housekeeping.py | (dashboard)/housekeeping |
| Engineering | work_orders.py, assets.py | (dashboard)/engineering |
| Tasks | tasks.py | (dashboard)/tasks |
| Scheduling | scheduling.py | (dashboard)/scheduling |
| Staff | staff.py | (dashboard)/staff |
| AI Copilot | ai_copilot.py | (dashboard)/ai |
| SOP Library | sop.py | (dashboard)/sop |
| Guest Requests | guest_requests.py | (dashboard)/guest-requests |
| Logbook | logbook.py | (dashboard)/logbook |
| Lost & Found | lost_found.py | (dashboard)/lost-found |
| Reports | reports.py | (dashboard)/reports |
| Billing | billing.py | (dashboard)/billing |
| Opera Integration | integrations.py | (dashboard)/settings |
| Notifications | notifications.py | — (push/in-app, no dedicated web route) |
| Webhooks | webhooks.py | — (Stripe webhook handler only) |

---

## Conventions

### Multi-tenancy (never skip)
Every Supabase query must scope to tenant: `.eq("hotel_id", user.hotel_id).execute()`.
RLS (migration 016) is a second safety layer — not a substitute for the query filter.

### No ORM
All queries use the Supabase Python SDK directly inside router handlers. No SQLAlchemy.

### Auth & RBAC
JWT custom claims (`hotel_id` + `role`) are baked in at login via migration 019 hook.
`get_current_user()` → `CurrentUser(hotel_id, user_id, role)`. Gate routes with `require_role(*roles)`.
Roles: `housekeeper` `engineer` `housekeeping_supervisor` `chief_engineer` `front_desk` `gm`

### AI routing split
- `gpt-4o-mini` → NL→task parsing, onboarding chat (latency-sensitive)
- `claude-sonnet-3.5` → RAG over SOPs, room readiness predictions (reasoning quality)
- pgvector RPC: call `match_sop_chunks()` with param `match_hotel_id` — NOT `hotel_id` (gotcha)

### API responses
- Success: `{ "data": ... }` — lists add `"meta": { "page", "per_page" }`
- New router: add file to `routers/`, import + `app.include_router(..., prefix="/v1/...")` in `main.py`
- Cron endpoints: `routers/internal.py`, guarded by `X-Cron-Secret` header

### Web state
Auth: Zustand `authStore` + `useAuth` hook. Server data: React Query. Real-time: Supabase Realtime subscriptions inside components (e.g., `RoomStatusBoard.tsx`).

### Realtime scope (A2)
Supabase Realtime subscriptions only on three surfaces: Housekeeping Breakout Board, Engineering Work Orders, AI Service Recovery alerts. Standard screens (Tasks, SOP Library) use pull-to-refresh — no WebSocket.

### Services layer depth (A1)
Keep business logic in domain routers. Only extract to `services/` when logic is shared across 2+ domains. Current exceptions: `services/ai/`, `services/opera/`, `services/policy.py`. Flat architecture preserves AI context window.

### AI credit accounting (A3)
Middleware must log **actual token usage** from API responses — never fixed costs. Dynamic routing between GPT-4o-mini and Claude models means fixed estimates will bleed money. Monthly Stripe true-up depends on this log.

### Opera Cloud (A4)
Opera Cloud integration is feature-flagged for pilot. App must function standalone first. Two-way sync hardening deferred.

---

## Database Schema Gotchas

- `match_sop_chunks` RPC param: `match_hotel_id` (NOT `hotel_id`) — migration 018
- `room_assignments`: `assigned_to` (housekeeper UUID), `assignment_date` (DATE)
- `room_status` join: `rooms!inner(id, room_number, floor, room_type_id, room_types(name, code, base_clean_minutes))`
- `housekeeper_profiles`: rolling avg clean time per housekeeper × room_type
- Key migrations: 016 = RLS policies, 017 = DB functions, 019 = JWT hook registration, 022 = JWT hook null-role fix, 023 = cascade FK deletes, 024 = room_status_history trigger fix, 025 = enable Realtime, 026 = front_desk_modules, 027 = staff_role_schedules, 028/029 = custom_roles, 030 = realtime_work_orders, 033 = realtime_room_status + lost_found_contact, 034 = opera_oauth_states, 035 = enable_rls_missing_tables, 038 = FK indexes, 041 = escalation_level
- Numbering collisions: `020_fix_credits_decimal.sql` / `0201_logbook_expires.sql` (note: second file uses `0201`, not `020`); two `039` files (`039_drop_room_status_history_trigger.sql` / `039_drop_unused_indexes.sql`)

---

## Cron Jobs (Railway → FastAPI `/internal/*`)

| Endpoint | Schedule | Purpose |
|---|---|---|
| `POST /internal/predictions/run` | `*/30 * * * *` | Room readiness predictions |
| `POST /internal/opera/sync-reservations` | `*/30 * * * *` | Opera reservation sync |
| `POST /internal/pm/check-due` | `0 6 * * *` | PM schedule due check |
| `POST /internal/ai/failure-predictions` | `0 0 * * *` | Asset failure predictions |
| `POST /internal/logbook/shift-summary` | `0 7,15,23 * * *` | Shift end summaries |
| `POST /internal/billing/monthly-trueup` | `0 0 28-31 * *` | Stripe billing true-up |
| `POST /internal/reports/daily-summary-email` | `0 6 * * *` | Daily GM summary (Resend) |

---

## Infrastructure

| Service | URL |
|---|---|
| API (Railway) | https://api-production-130b.up.railway.app |
| Web (Railway) | https://patelrepweb-production.up.railway.app |
| GitHub | https://github.com/henilllpatelll/PatelRep |

Railway project: `16d3d022-cf7e-4d4a-8ec0-6a97ddb74e93` · env: `1b702af9-fb05-4635-8121-4a1462d2c93b`
API service: `3d6e22bc-bc67-4a8e-b88e-5d983573922a` · web service: `8ed9664c-9257-4c01-820c-ba92be27e37b`

### Env vars (by tier)
**API (Railway):** `SUPABASE_URL` `SUPABASE_SERVICE_ROLE_KEY` `SUPABASE_JWT_SECRET` `OPENAI_API_KEY` `ANTHROPIC_API_KEY` `STRIPE_SECRET_KEY` `STRIPE_WEBHOOK_SECRET` `CRON_SECRET` `APP_ENV` `APP_URL`
**Web (Railway):** `NEXT_PUBLIC_SUPABASE_URL` `NEXT_PUBLIC_SUPABASE_ANON_KEY` `NEXT_PUBLIC_API_URL`

---

## GSD Workflow

- Current state: `.planning/STATE.md` — run `/gsd:progress` to check phase
- Phase plans: `.planning/phases/` — run `/gsd:execute-phase` to run next phase
- Remaining work: `REMAINING_WORK.md`

## Skills

Domain skills inject automatically by file path:
- `apps/api/**` → `patelrep-api` skill (FastAPI patterns)
- `apps/web/**` → `patelrep-web` skill (Next.js 14 patterns)
- `apps/mobile/**` → `patelrep-mobile` skill (Expo React Native patterns)

---

## Self-Verification Policy (MANDATORY)

After completing any implementation, fix, or feature:

1. Start the relevant dev server(s) if not already running (`npm run dev:web` on :3000, `npm run dev:api` on :8000).
2. Use the browser (Playwright or `playwright-cli` skill) to manually navigate to the affected route on `localhost`.
3. Exercise the golden path: click through the feature, submit forms, check that data loads correctly.
4. Verify no console errors, no broken UI, no failed API calls.
5. Only after confirming it works on localhost may you report the task as complete.

**Do NOT ask the user to test it themselves. Do NOT declare success after writing code alone. You must see it working yourself first.**
