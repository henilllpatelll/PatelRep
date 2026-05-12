# OpenWolf

@.wolf/OPENWOLF.md

This project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.


# PatelRep — Codex Instructions

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
│   │   ├── services/     ai/, opera/ only — keep other logic in routers until it clearly needs extraction
│   │   ├── models/       Pydantic request/response schemas only
│   │   └── middleware/   auth.py (JWT validation), credits.py (AI credit gate per-route)
│   ├── web/              Next.js 14 App Router (Railway, Dockerfile)
│   │   ├── app/(auth)/   Unauthenticated routes (login, magic link)
│   │   ├── app/(dashboard)/ 15 feature sections (authenticated)
│   │   ├── components/   ai/, dashboard/, engineering/, housekeeping/, shared/, ui/
│   │   ├── lib/api/      Typed API clients per domain (housekeepingApi, staffApi, …)
│   │   ├── lib/hooks/    React Query hooks
│   │   ├── stores/       Zustand: authStore, hotelStore, housekeepingStore, engineeringStore
│   │   └── middleware.ts Route guard → /login (no session) or /onboarding (no hotel_id)
├── supabase/migrations/  001–025 sequential SQL — schema source of truth
├── spec/                 14 markdown specs — requirements source of truth
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
- `Codex-sonnet-3.5` → RAG over SOPs, room readiness predictions (reasoning quality)
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
Keep business logic in domain routers. Only extract to `services/` when logic is shared across 2+ domains. Current exceptions: `services/ai/`, `services/opera/`. Flat architecture preserves AI context window.

### AI credit accounting (A3)
Middleware must log **actual token usage** from API responses — never fixed costs. Dynamic routing between GPT-4o-mini and Codex models means fixed estimates will bleed money. Monthly Stripe true-up depends on this log.

### Opera Cloud (A4)
Opera Cloud integration is feature-flagged for pilot. App must function standalone first. Two-way sync hardening deferred.

---

## Database Schema Gotchas

- `match_sop_chunks` RPC param: `match_hotel_id` (NOT `hotel_id`) — migration 018
- `room_assignments`: `assigned_to` (housekeeper UUID), `assignment_date` (DATE)
- `room_status` join: `rooms!inner(id, room_number, floor, room_type_id, room_types(name, code, base_clean_minutes))`
- `housekeeper_profiles`: rolling avg clean time per housekeeper × room_type
- Key migrations: 016 = RLS policies, 017 = DB functions, 019 = JWT hook registration, 022 = JWT hook null-role fix, 023 = cascade FK deletes, 024 = room_status_history trigger fix, 025 = enable Realtime on housekeeping/engineering tables
- Note: two files share the `020` prefix (`020_fix_credits_decimal.sql`, `020_logbook_expires.sql`) — numbering collision in the sequence

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
| API (Railway) | https://api-production-a914.up.railway.app |
| Web (Railway) | https://patelrepweb-production-869a.up.railway.app |
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
