# PatelRep — Claude Instructions

## What This Project Is

**PatelRep** is an AI Staff Copilot SaaS for 50–150 room independent Texas hotels.
- Quore-style simplicity + Alice-level AI predictions
- Pricing: $99/mo base + $0.02/AI credit, cap $2.50/room/month
- Pilot: 1 committed Texas hotel, 1-month free trial
- Builder: solo founder + AI (Claude/Cursor)

**Elevator pitch for code decisions:** Every feature must save a housekeeper or engineer time on the floor — not add complexity to their phone.

---

## Monorepo Structure

```
PatelRep/
├── apps/
│   ├── api/          FastAPI Python 3.12 — backend (Railway)
│   ├── web/          Next.js 14 App Router — web dashboard (Railway)
│   └── mobile/       React Native + Expo SDK 51 — staff app (EAS)
├── supabase/
│   ├── migrations/   001–018.sql — full schema
│   └── seed.sql
├── spec/             14 spec files (source of truth for requirements)
├── .planning/        GSD workflow files (STATE.md, ROADMAP.md, phases/)
├── LAUNCH_GUIDE.md   Step-by-step deployment guide
└── REMAINING_WORK.md Remaining Week 11–12 items
```

---

## Tech Stack

| Layer | Tech | Location |
|---|---|---|
| Backend API | FastAPI Python 3.12 | `apps/api/` |
| Web frontend | Next.js 14 App Router | `apps/web/` |
| Mobile app | React Native + Expo SDK 51 | `apps/mobile/` |
| Database | PostgreSQL 15 + pgvector | Supabase |
| Auth | Supabase Auth (magic link + password) | |
| Real-time | Supabase Realtime (WebSocket) | |
| AI fast | OpenAI GPT-4o-mini | NL→task, onboarding |
| AI reasoning | Anthropic Claude Sonnet 3.5 | RAG, predictions, summaries |
| Billing | Stripe + internal credit ledger | |
| Push | Expo Push (APNs + FCM) | |
| i18n | react-i18next EN/ES | web + mobile |
| Offline | Expo SQLite + sync queue | mobile only |

---

## Deployed Infrastructure

| Service | Platform | URL |
|---|---|---|
| API (FastAPI) | Railway | https://api-production-18a4.up.railway.app |
| Web (Next.js) | Railway | https://patelrepweb-production.up.railway.app |
| Database | Supabase | — |
| GitHub repo | GitHub | https://github.com/henilllpatelll/PatelRep |

**Railway project ID:** `11334115-db5b-4bde-8978-84c0c36ad2f8`
**Railway environment ID:** `888dee35-b911-4266-9b37-73b9b9523436`
**Railway web service ID:** `b34edf7a-34a8-40ce-aa48-a486fb423cb5`
**Railway API service ID:** `6a88c728-3c90-45a2-b519-99a563e2395a`
**Railway mobile service ID:** `10f2f1a4-96e4-429c-8943-37b94c8dd87a`

**Railway web build command:**
```
npm run build --workspace=@patelrep/web && cp -r apps/web/public apps/web/.next/standalone/ && cp -r apps/web/.next/static apps/web/.next/standalone/.next/static
```
**Railway web start command:** `node apps/web/.next/standalone/server.js`
**Railway web watch path:** `/apps/web/**`

---

## Current Build Status

### COMPLETE (Sessions 1–8)
- Auth & Hotel Setup (magic link, JWT custom claims, onboarding wizard 6 steps)
- Room Management & Realtime (status transitions, Supabase Realtime, housekeeping board)
- Staff Management & Scheduling (shifts, assignments, clock-in/out, weekly calendar)
- Opera Cloud Integration (OAuth, webhooks, sync, OHIP)
- Room Assignment + Inspection Workflow (checklist modal, supervisor flow)
- SOP Library + AI Predictions (pgvector RAG, room readiness predictions)
- Engineering Work Orders (full CRUD, priorities, SLA, asset management)

### IN PROGRESS — Mobile App (Milestone 2)
GSD workflow state: `.planning/STATE.md`
- Phase 1 (Foundation): COMPLETE — auth, 401 recovery, offline banner
- Phase 2 (Housekeeper Workflow): COMPLETE — room cards, status updates, offline sync, issue reporting
- Phase 3 (Engineer Workflow + Push + EAS): IN PROGRESS — stopped at EAS init / google-services.json
- Phase 4 (Polish + Differentiators): NOT STARTED

**Current blocker:** Phase 3 Task 2 requires `google-services.json` from Firebase console + EAS project init. This is a human action.

### REMAINING (Week 11–12) — See REMAINING_WORK.md
1. Email delivery (Resend API — real send in `/internal/reports/daily-summary-email`)
2. EAS production builds (Android APK + iOS IPA)
3. Mobile UI polish pass
4. Mobile inspection screen (`apps/mobile/app/(app)/inspection/[roomId].tsx`)
5. Guest profile view from Opera (front desk)
6. Drag-and-drop room assignment (web)
7. Tablet-responsive web layout
8. PDF maintenance report
9. App Store / Play Store submission

---

## Key Architecture Decisions

| Decision | Rationale |
|---|---|
| Multi-tenancy via RLS | `tenant_id` on every table; no schema-per-tenant |
| JWT custom claims | `hotel_id` + `role` injected via Supabase Auth hook (migration 017) |
| Offline: SQLite + sync queue | Last-write-wins; server wins on conflict |
| AI routing split | GPT-4o-mini for speed (NL→task); Claude Sonnet for reasoning (RAG/predictions) |
| Opera Cloud hybrid | Webhooks for real-time + 30-min polling for reports |
| Background jobs | Railway Cron → FastAPI `/internal/*` endpoints (CRON_SECRET header) |
| No direct Supabase from mobile | All data goes through FastAPI — auth + RLS already enforced there |
| Managed Expo (no bare workflow) | Solo builder, OTA updates, no native module complexity needed for v1 |

---

## Roles

`housekeeper`, `engineer`, `housekeeping_supervisor`, `chief_engineer`, `front_desk`, `gm`

Role checks use `require_role(*roles)` FastAPI dependency.

---

## API Conventions

- All responses: `{ "data": ... }` for success, FastAPI auto-generates `{ "detail": "..." }` for errors
- List responses: `{ "data": [...], "meta": { "page": ..., "per_page": ... } }`
- Auth: `get_current_user` dependency extracts JWT, returns `CurrentUser(hotel_id, user_id, role)`
- Supabase queries: `.select(...).eq("hotel_id", user.hotel_id).execute()` — always scope to hotel
- New routers: add to `apps/api/main.py` with `app.include_router(..., prefix="/v1/...")`
- Cron endpoints live in `apps/api/routers/internal.py`, protected by `X-Cron-Secret` header

## Web Conventions

- Next.js 14 App Router — all pages under `apps/web/app/`
- Protected routes: `apps/web/middleware.ts` redirects unauthenticated → `/login`, no hotel_id → `/onboarding`
- Auth state: Zustand `authStore` (`stores/authStore.ts`) + `useAuth` hook
- API calls: typed clients in `apps/web/lib/api/` (e.g., `housekeepingApi`, `staffApi`)
- Data fetching: `useQuery` from React Query
- Real-time: Supabase Realtime subscriptions in components (see `RoomStatusBoard.tsx`)

## Mobile Conventions

- Expo Router file-based routing under `apps/mobile/app/`
- Auth: Supabase JS client for session; all data API calls through FastAPI
- Global state: Zustand `appStore` (`stores/appStore.ts`)
- Offline: `lib/offline/db.ts` (SQLite) + `lib/offline/sync.ts` (queue + flush)
- i18n: `lib/i18n.ts` + `locales/en.json` + `locales/es.json`
- Push: `lib/notifications.ts` — token registration, permission request
- Components: NativeWind for styling (Tailwind on React Native)

---

## Database Schema Notes

- `match_sop_chunks` RPC uses `match_hotel_id` param (NOT `hotel_id`) — see migration 017
- `room_assignments` columns: `assigned_to` (housekeeper UUID), `assignment_date` DATE
- `room_status` nested join: `rooms!inner(id, room_number, floor, room_type_id, room_types(name, code, base_clean_minutes))`
- `housekeeper_profiles` tracks rolling avg clean time per housekeeper×room_type

---

## Environment Variables

### Railway (API)
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`, `APP_ENV=production`, `APP_URL=https://app.patelrep.com`

### Railway (Web / Next.js)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL=https://api.patelrep.com/v1`

### Expo EAS (Mobile)
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_URL=https://api.patelrep.com/v1`

---

## Cron Jobs (Railway → FastAPI)

| Endpoint | Schedule | Purpose |
|---|---|---|
| `POST /internal/predictions/run` | `*/30 * * * *` | Room readiness predictions |
| `POST /internal/opera/sync-reservations` | `*/30 * * * *` | Opera reservation sync |
| `POST /internal/pm/check-due` | `0 6 * * *` | PM schedule due check |
| `POST /internal/ai/failure-predictions` | `0 0 * * *` | Asset failure predictions |
| `POST /internal/logbook/shift-summary` | `0 7,15,23 * * *` | Shift end summaries |
| `POST /internal/billing/monthly-trueup` | `0 0 28-31 * *` | Stripe billing true-up |
| `POST /internal/reports/daily-summary-email` | `0 6 * * *` | Daily GM summary |

---

## GSD Workflow

This project uses GSD (Get Stuff Done) to track implementation phases.
- State: `.planning/STATE.md`
- Roadmap: `.planning/ROADMAP.md`
- Phase plans: `.planning/phases/`
- Use `/gsd:progress` to check where we are
- Use `/gsd:execute-phase` to run the next phase

## Skills Available

Domain-specific skills inject context automatically when working on each layer:
- `.claude/skills/patelrep-api/` — FastAPI backend patterns (triggers on `apps/api/**`)
- `.claude/skills/patelrep-web/` — Next.js 14 web patterns (triggers on `apps/web/**`)
- `.claude/skills/patelrep-mobile/` — Expo mobile patterns (triggers on `apps/mobile/**`)
