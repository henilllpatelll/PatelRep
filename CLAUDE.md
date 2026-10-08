# PatelRep — Claude Instructions

AI Staff Copilot SaaS for 50–150 room Texas hotels ($99/mo + $0.02/AI credit, cap $2.50/room/month).
**Code decision filter:** Every feature must save a housekeeper or engineer time on the floor — not add complexity to their phone.

---

## Development Routing & Authority Boundaries (MANDATORY)

Trusted automated path (optional, only on explicit request; the default for normal features is session-built PRs, see "Normal product features"):
`User request → Claude Feature Orchestrator → Autonomous Feature Builder → coding agent → trusted publisher → PR → CI Gate → Staging Gate → human review → human merge`

Production is separate:
`Merged main → human release decision → Production Release → verification → stabilization → monitoring`

### Critical safety rules
Never: alter Supabase migration history, use `supabase migration repair`, add fake/placeholder migrations, modify historical migrations to force deployment, weaken CI/Staging Gates or SHA/tree provenance or production target guards, deploy Web if API verification failed, expose production or publisher credentials to coding agents, or create alternate publishing/deployment paths. Fail closed when trusted state cannot be proven. Schema changes: new forward-only migrations only, preserving RLS and tenant isolation.

### Human merge & production boundaries
Never automatically: merge PRs, enable auto-merge, bypass branch protection, treat green CI/Staging as approval, dispatch Production Release/Rollback, deploy Railway/Vercel/Supabase manually, mutate production, create production tags/releases outside the trusted workflow, or approve production environments. `merged`, `approved`, `done`, `looks good` do not authorize production — it needs an explicit separate request. When the user says `merged`, verify the merge and `main` state live first.

### GitHub is the source of truth
Never claim a run started, PR exists, gate passed, merge occurred, repair succeeded, or production released unless current GitHub state proves it. Prefer exact workflow paths, run IDs, PR numbers, SHAs, and check runs. Never accept CI/Staging evidence from an older PR head.

### Direct git
Dedicated branch only; never push to protected `main`; never force push unless a trusted recovery design requires it; run relevant checks first; verify the push and triggered CI; a PR isn't ready until required gates pass.

### Normal product features
**Default (as of 2026-10-07, user decision): build in the session.** When asked to build, add, implement, redesign, improve, or fix normal PatelRep product functionality, implement it directly in the Claude Code session, then open a PR and let GitHub (CI Gate, Staging) handle the rest:

1. Understand the outcome; inspect the repo; read `.wolf/cerebrum.md` and `.wolf/anatomy.md`.
2. Create a dedicated branch from the latest `origin/main` (e.g. `feature/<slug>`; never `main`, never reuse `feature/ai-*`). Large multi-phase features ship as ONE branch/PR with a commit per phase.
3. Implement per the Non-Regression and Self-Verification policies, add tests, run relevant lint/type-check/tests/build (`git diff --check`).
4. Push the branch and open a PR targeting `main` (use `gh`). Do not merge, enable auto-merge, or deploy.
5. Follow the PR through CI Gate and Staging with live GitHub state. Staging eligibility of a non-`feature/ai-*` branch is NOT assumed: verify it live and report exactly what ran; if Staging does not run for the branch, say so (state `blocked`/`unproven`) instead of claiming readiness, and do not change gates to make it run without an explicit control-plane request.
6. Stop at `ready_for_human_review` (or the honest blocked state).

**Optional:** the Feature Orchestrator path (`.github/workflows/claude-feature-orchestrator.yml`, passing only `feature_name` and `requirements`, requirements ≤12,000 chars, builder limited to `--max-turns 80`) is used only when the user explicitly asks for it. Do not dispatch it on your own.

### Control-plane work (not normal features)
`.github/workflows/**`, Feature Orchestrator, Autonomous Feature Builder, trusted publisher, CI/Staging gates, Release Engineer, production release/rollback/recovery, watchdog/audit/readiness, provenance or migration safeguards, branch protections/rulesets, GitHub App permissions. Procedure: inspect current architecture → preserve safeguards → dedicated branch from trusted `main` → smallest coherent change → add/update contract tests → run relevant + release/workflow contract tests → `git diff --check` → inspect for privilege escalation → open PR → do not merge.

### Release Engineer
The existing Claude Release Engineer is the only repair system for eligible CI/Staging failures — do not create a competing path. If it changes the PR head: resolve the new SHA, discard old CI/Staging evidence, require fresh CI Gate, Staging provenance, and Staging Gate.

### `ready_for_human_review` — only when ALL hold
Feature Builder succeeded and lineage valid (orchestrator path only; for session-authored PRs: PR authored from a dedicated branch off `main` with all checks run) · PR open and targets `main` · repo/branch provenance valid · current head SHA proven · CI Gate passed for that exact head · Staging Candidate matches exact PR/branch/SHA · Staging Gate passed · head stable during resolution.
It is NOT permission to merge. Tell the user: `Ready for human review. Test the feature in staging. If it looks correct, manually merge the PR.`

### `check`
When the user says `check` (in this project), inspect GitHub live and report the exact state and next action. States: `building`, `ci_running`, `ci_failed`, `staging_running`, `staging_failed`, `ready_for_human_review`, `blocked`, `unproven`. Track: orchestrator run, Feature Builder run, base SHA, `feature/ai-*` branch, PR, current head SHA, CI Gate, Staging Candidate provenance, Staging Gate, Release Engineer repair lineage.

---

## Current Scope (MANDATORY — read before every session)

- **Active surface: web app only.** All feature work targets `apps/web/` and `apps/api/`. Do not touch `apps/mobile/` unless explicitly asked.
- **Partial local credentials.** `apps/api/.env` exists and has Supabase (`SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`), Stripe test-mode (`STRIPE_SECRET_KEY` starts
  with `sk_test_`, `STRIPE_WEBHOOK_SECRET`), and cron/app config (`CRON_SECRET`, `APP_ENV`,
  `APP_URL`, `API_URL`) populated — billing and Supabase-backed paths CAN be exercised locally.
  `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` (AI credit paths) are absent, as are Twilio (SMS) and
  Opera/OHIP OAuth credentials — those paths cannot be exercised end-to-end locally. Flag when a
  feature requires one of these specific absent credentials.

---

## Non-Regression Policy (MANDATORY)

**When implementing or configuring any new feature, Claude MUST:**

1. Before making changes, identify all existing features that share code paths, components, routes, or data with the new feature.
2. Make changes in a targeted way — avoid modifying shared logic unless the task explicitly requires it.
3. After implementing, verify that existing features adjacent to the change still work correctly (navigate to them, test their golden paths).
4. If a change unavoidably touches shared code, explicitly test every feature that depends on it.
5. Never declare a task complete if any previously working feature is now broken — fix regressions before finishing.

---

## Self-Verification Policy (MANDATORY)

After completing any **direct** implementation (control-plane work or trivial edits per Development Routing above). Features built by the orchestrator are verified in the Feature Builder context and in Staging instead:

1. Start the relevant dev server(s) if not already running (`npm run dev:web` on :3000, `npm run dev:api` on :8000).
2. Use the browser (Playwright or `playwright-cli` skill) to manually navigate to the affected route on `localhost`.
3. Exercise the golden path: click through the feature, submit forms, check that data loads correctly.
4. Verify no console errors, no broken UI, no failed API calls.
5. Only after confirming it works on localhost may you report the task as complete.

**Do NOT ask the user to test it themselves. Do NOT declare success after writing code alone. You must see it working yourself first.**

---

# OpenWolf

@.wolf/OPENWOLF.md

This project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.

---

## Conventions

### Multi-tenancy (never skip)
Every Supabase query must scope to tenant: `.eq("hotel_id", user.hotel_id).execute()`.
RLS (migration 016) is a second safety layer — not a substitute for the query filter.

### Auth & RBAC
JWT custom claims (`hotel_id` + `role`) are baked in at login via migration 019 hook.
`get_current_user()` → `CurrentUser(hotel_id, user_id, role)`. Gate routes with `require_role(*roles)`.
Roles: `housekeeper` `engineer` `housekeeping_supervisor` `chief_engineer` `front_desk` `gm`

### AI credit accounting (A3)
Middleware must log **actual token usage** from API responses — never fixed costs. Dynamic routing between GPT-4o-mini and Claude models means fixed estimates will bleed money. Monthly Stripe true-up depends on this log.

### No ORM
All queries use the Supabase Python SDK directly inside router handlers. No SQLAlchemy.

### AI routing split
- `gpt-4o-mini` → NL→task parsing, onboarding chat (latency-sensitive)
- `claude-sonnet-3.5` → RAG over SOPs, room readiness predictions (reasoning quality)
- pgvector RPC: call `match_sop_chunks()` with param `match_hotel_id` — NOT `hotel_id` (gotcha)

### Opera Cloud (A4)
Opera Cloud integration is feature-flagged for pilot. App must function standalone first. Two-way sync hardening deferred.

### API responses
- Success: `{ "data": ... }` — lists add `"meta": { "page", "per_page" }`
- New router: add file to `routers/`, import + `app.include_router(..., prefix="/v1/...")` in `main.py`
- Cron endpoints: `routers/internal.py`, guarded by `X-Cron-Secret` header

### Services layer depth (A1)
Keep business logic in domain routers. Only extract to `services/` when logic is shared across 2+ domains. Current exceptions: `services/ai/`, `services/opera/`, `services/policy.py`. Flat architecture preserves AI context window.

### Realtime scope (A2)
Supabase Realtime subscriptions only on three surfaces: Housekeeping Breakout Board, Engineering Work Orders, AI Service Recovery alerts. Standard screens (Tasks, SOP Library) use pull-to-refresh — no WebSocket.

### Web state
Auth: Zustand `authStore` + `useAuth` hook. Server data: React Query. Real-time: Supabase Realtime subscriptions inside components (e.g., `RoomStatusBoard.tsx`).

---

## Database Schema Gotchas

- `match_sop_chunks` RPC param: `match_hotel_id` (NOT `hotel_id`) — migration 018
- `room_assignments`: `assigned_to` (housekeeper UUID), `assignment_date` (DATE)
- `room_status` join: `rooms!inner(id, room_number, floor, room_type_id, room_types(name, code, base_clean_minutes))`
- `housekeeper_profiles`: rolling avg clean time per housekeeper × room_type
- Key migrations: 016 = RLS policies, 017 = DB functions, 019 = JWT hook registration, 022 = JWT hook null-role fix, 023 = cascade FK deletes, 024 = room_status_history trigger fix, 025 = enable Realtime, 026 = front_desk_modules, 027 = staff_role_schedules, 028/029 = custom_roles, 030 = realtime_work_orders, 033 = realtime_room_status + lost_found_contact, 034 = opera_oauth_states, 035 = enable_rls_missing_tables, 038 = FK indexes, 041 = escalation_level
- Numbering collisions: `020_fix_credits_decimal.sql` / `0201_logbook_expires.sql` (note: second file uses `0201`, not `020`); two `039` files (`039_drop_room_status_history_trigger.sql` / `039_drop_unused_indexes.sql`)

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

## Domain Map

| Domain | API router | Web route |
|---|---|---|
| Auth | auth.py | (auth)/login |
| Hotels / Onboarding | hotels.py, onboarding.py | (dashboard)/onboarding |
| Rooms | rooms.py | — (internal API, no dedicated web route) |
| Housekeeping | housekeeping.py | (dashboard)/housekeeping |
| Cleaning Checklists | cleaning_checklists.py | (dashboard)/settings/housekeeping |
| Clean Sessions | clean_sessions.py | (dashboard)/housekeeping (RoomStatusBoard / RoomDetailDrawer) |
| Shifts | shifts.py | (dashboard)/scheduling |
| Tasks | tasks.py | (dashboard)/tasks |
| Engineering | work_orders.py, assets.py | (dashboard)/engineering |
| AI Copilot | ai_copilot.py | (dashboard)/ai |
| SOP Library | sop.py | (dashboard)/sop |
| Billing | billing.py | (dashboard)/settings/billing |
| Webhooks | webhooks.py | — (Stripe webhook handler only) |
| Opera Integration | integrations.py | (dashboard)/settings/integrations |
| Internal (cron) | internal.py | — (internal only; see Cron Jobs section) |
| Notifications | notifications.py | — (push/in-app, no dedicated web route) |
| Scheduling | scheduling.py | (dashboard)/scheduling |
| Guest Requests | guest_requests.py | (dashboard)/guest-requests |
| Logbook | logbook.py | (dashboard)/logbook |
| Management ROI | management_roi.py | (dashboard)/management-roi |
| Reports | reports.py | (dashboard)/reports |
| Staff | staff.py | (dashboard)/staff |
| Lost & Found | lost_found.py | (dashboard)/lost-found |
| Guest Feedback | feedback.py | (dashboard)/settings/feedback |
| Late Checkout | late_checkout.py | (dashboard)/housekeeping (FrontDeskDashboard, lib/utils/lateCheckoutRequests.ts) |
| Evidence | evidence.py | (dashboard)/evidence |
| Safety | safety.py | (dashboard)/safety |
| Programs | programs.py | (dashboard)/programs |

---

## Directory Structure

```
PatelRep/
├── apps/
│   ├── api/              FastAPI Python 3.13 (Railway, Dockerfile)
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

## Cron Jobs (in-process APScheduler → FastAPI internal coroutines)

Production runs a single in-process `AsyncIOScheduler` (`apps/api/core/scheduler.py`), started in
`main.py`'s `lifespan()` handler and gated by `should_run_scheduler()` (requires `app_env ==
"production"` and the `cron_scheduler_enabled` kill-switch). Each scheduled job calls the same
`routers.internal` coroutine an HTTP cron would have hit, so behavior and `cron_health` recording
are unchanged — only the trigger source changed. The previous mechanism
(`.github/workflows/cron-jobs.yml` POSTing to `/v1/internal/*` with `X-Cron-Secret`) is retired: it
was dropping/delaying `*/30` runs by up to ~2.4h. The `/v1/internal/*` endpoints (prefix `PREFIX="/v1"`,
so paths are `/v1/internal/*`, not `/internal/*`) still exist and remain reachable with the
`X-Cron-Secret` header for manual/ops use. Railway's native cron scheduler is not used on the current
account.

| Job ID | Schedule (UTC) | Purpose |
|---|---|---|
| `predictions.run` | `*/30 * * * *` | Room readiness predictions |
| `opera.sync-reservations` | `*/30 * * * *` | Opera reservation sync |
| `escalations.check` | `*/30 * * * *` | WO/task SLA escalation ladder + DND welfare |
| `pm.check-due` | `0 6 * * *` | PM schedule due check |
| `tasks.generate-recurring` | `0 6 * * *` | Recurring Internal Task generation |
| `reports.daily-summary-email` | `0 6 * * *` | Daily GM summary (Resend) |
| `evidence.reminders` | `0 6 * * *` | Controlled-doc acknowledgement reminders |
| `safety.training-assignments` | `0 6 * * *` | Safety training assignment/reminders |
| `safety.drill-follow-up` | `0 6 * * *` | Drill follow-up evidence escalation |
| `lost-found.retention-check` | `0 6 * * *` | Lost & found retention check |
| `logbook.shift-summary` | `0 7,15,23 * * *` | Shift end summaries |
| `ai.failure-predictions` | `0 0 * * *` | Asset failure predictions |
| `logbook.cleanup-expired` | `0 3 * * *` | Hard-delete expired logbook entries |
| `billing.monthly-trueup` | `0 0 28-31 * *` | Stripe billing true-up |

---

## Infrastructure

| Service | URL |
|---|---|
| API (Railway) | https://noble-cooperation-production.up.railway.app |
| Web (Railway) | https://patelrep-production-6f35.up.railway.app |
| Web (Vercel, second deployment target) | https://patelrep-web.vercel.app |
| SFTP receiver (Railway, Opera Cloud report ingestion) | https://opera-sftp-production.up.railway.app (WebAdmin) / SFTP on a separate TCP proxy port — see reference_railway memory |
| GitHub | https://github.com/henilllpatelll/PatelRep |

Railway project: `8df4a541-5d84-4b2a-b180-049e3fbe2ed1` (`poetic-adventure`) · env: `d82c64bc-2885-4ec7-a735-97a21667c8cf`
API service (`noble-cooperation`): `e1e98ec8-4389-4f24-897d-afdcc41fa090` · web service (`PatelRep`): `8962e543-ec7d-4bcf-9cc6-b3da2f68ba43` · SFTP service (`opera-sftp`): `ce1a6334-7966-4740-83a6-3de11f8c69c9`
Railway account: chintudad@yahoo.com — migrated to this (4th) account 2026-09-17 after the prior account's trial expired; note the non-obvious service name `noble-cooperation` for the API (Railway-generated, not renamed).
Vercel project: `patelrep-web` (`prj_Gk4AXTlZlv32UmVoo7NCwO1sBOj8`), team `henilllpatellls-projects` (`team_ewW3xDsO7FTFL36ze0IDKnrn`). Deploys the same `apps/web` app as Railway's `PatelRep` service, against the same Railway API — **if the Railway API URL ever changes, update `NEXT_PUBLIC_API_URL` on both Railway and Vercel**, or `.github/workflows/deploy-check.yml`'s `deployment-drift-check` job will fail within 15 minutes. As of 2026-09-19 there is no available credential (MCP tool or authenticated CLI) to update Vercel's env var directly, so `apps/web/lib/api/client.ts`'s `RETIRED_API_URLS`/`LIVE_API_URL` runtime fallback is the safety net when Vercel drifts — keep it in sync with the live Railway API URL until Vercel access is restored.

### Env vars (by tier)
**API (Railway):** `SUPABASE_URL` `SUPABASE_SERVICE_ROLE_KEY` `SUPABASE_JWT_SECRET` `OPENAI_API_KEY` `ANTHROPIC_API_KEY` `STRIPE_SECRET_KEY` `STRIPE_WEBHOOK_SECRET` `CRON_SECRET` `APP_ENV` `APP_URL`
**Web (Railway + Vercel):** `NEXT_PUBLIC_SUPABASE_URL` `NEXT_PUBLIC_SUPABASE_ANON_KEY` `NEXT_PUBLIC_API_URL` — set independently on each platform, must be kept in sync manually

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
