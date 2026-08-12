# Phase 18: Documentation Drift Fixes - Research

**Researched:** 2026-08-04
**Domain:** Internal documentation accuracy (CLAUDE.md) vs. actual codebase state
**Confidence:** HIGH — every claim below is a direct file read or grep against the current repo, no external sources needed.

## Summary

This is a pure documentation-correction phase — no code changes, no new dependencies. Three sections of `CLAUDE.md` (project root) have drifted from reality:

1. **Cron Jobs**: the doc describes `.github/workflows/cron-jobs.yml` hitting `/v1/internal/*` with `X-Cron-Secret`. That mechanism was **retired** — production now runs an in-process `AsyncIOScheduler` (`apps/api/core/scheduler.py`) built and started in `main.py`'s lifespan handler. The GitHub Actions workflow's own docstring in `scheduler.py` explains why: it "dropped/delayed the `*/30` runs by up to ~2.4h." The internal endpoints still exist (scheduler calls the same coroutines), but the trigger source is different and the doc's framing is backwards.
2. **Current Scope / local credentials**: the doc currently implies no credentials are available locally at all. `apps/api/.env` actually exists and is populated with 9 keys — Supabase service-role, Stripe (test-mode), and cron/app config are all present. Only the AI provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) plus Twilio (`TWILIO_*`) and Opera/OHIP (`OPERA_*`) keys are genuinely absent (present as empty-string defaults in `core/config.py`, not set in `.env`).
3. **Domain Map**: the table lists ~20 routers; `apps/api/routers/` actually contains 30 router files, all registered in `main.py`. Nine are missing from the table: `clean_sessions`, `cleaning_checklists`, `evidence`, `feedback`, `late_checkout`, `management_roi`, `programs`, `safety`, `shifts`.

**Primary recommendation:** Replace the three CLAUDE.md sections with the exact text below (see Code Examples) — this is a mechanical find-and-replace phase, not a design phase.

## Standard Stack

Not applicable — no new libraries. `apscheduler` (already a dependency, powering `core/scheduler.py`) is the only relevant library and it's already in use.

## Architecture Patterns

Not applicable — no code structure changes. This phase only edits Markdown.

## Don't Hand-Roll

Not applicable.

## Common Pitfalls

### Pitfall 1: Editing the wrong "Current Scope" wording
**What goes wrong:** The bullet currently reads "There is no `.env` with `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or Stripe keys locally" — this is factually wrong on two counts (a `.env` file does exist; Stripe keys are present).
**Why it happens:** Doc was written before `.env` was populated, or before an audit was done.
**How to avoid:** State precisely: `.env` exists at `apps/api/.env` with Supabase, Stripe (test-mode), and cron/app-config keys present; only `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` and Twilio/Opera(OHIP) keys are absent (empty strings).
**Warning signs:** None — this is a one-time verification, not an ongoing risk.

### Pitfall 2: Conflating "internal endpoints" with "trigger mechanism"
**What goes wrong:** The `/v1/internal/*` endpoints in `routers/internal.py` still exist and still work when hit manually or via `X-Cron-Secret` — so it's tempting to say "GitHub Actions still triggers cron." It doesn't anymore; the scheduler calls the same coroutines in-process.
**Why it happens:** The endpoints didn't move, only the caller did.
**How to avoid:** Be explicit that `.github/workflows/cron-jobs.yml` is retired/no longer the trigger; `core/scheduler.py`'s `AsyncIOScheduler` (started in `main.py` lifespan, gated by `should_run_scheduler()` which requires `app_env == "production"` and `cron_scheduler_enabled`) is the sole trigger now. The endpoints remain reachable via `X-Cron-Secret` for manual/ops use, but that's not how they normally fire.

### Pitfall 3: Table row grouping inconsistency
**What goes wrong:** The existing Domain Map groups some multi-router domains into one row (e.g. "Engineering | work_orders.py, assets.py | (dashboard)/engineering"). If the new 9 rows are added inconsistently (e.g. one-router-per-row for old entries but grouped for new), the table reads oddly.
**How to avoid:** Follow the existing grouping convention — group only when multiple routers clearly share one web surface (e.g. `hotels.py, onboarding.py` → onboarding); otherwise one row per router.

## Code Examples

### 1. Cron Jobs section replacement

Current CLAUDE.md text (to replace):
```
## Cron Jobs (GitHub Actions → FastAPI `/v1/internal/*`)

Triggered by `.github/workflows/cron-jobs.yml` (POST + `X-Cron-Secret` header). The internal
router mounts under `PREFIX="/v1"`, so paths are `/v1/internal/*` — NOT `/internal/*` (a bare
`/internal/*` returns 404). Railway's native cron scheduler is not used on the current account.

| Endpoint | Schedule | Purpose |
|---|---|---|
| `POST /v1/internal/predictions/run` | `*/30 * * * *` | Room readiness predictions |
| `POST /v1/internal/opera/sync-reservations` | `*/30 * * * *` | Opera reservation sync |
| `POST /v1/internal/escalations/check` | `*/30 * * * *` | WO/task SLA escalation ladder + DND welfare |
| `POST /v1/internal/pm/check-due` | `0 6 * * *` | PM schedule due check |
| `POST /v1/internal/evidence/reminders` | `0 6 * * *` | Controlled-doc acknowledgement reminders |
| `POST /v1/internal/safety/training-assignments` | `0 6 * * *` | Safety training assignment/reminders |
| `POST /v1/internal/safety/drill-follow-up` | `0 6 * * *` | Drill follow-up evidence escalation |
| `POST /v1/internal/ai/failure-predictions` | `0 0 * * *` | Asset failure predictions |
| `POST /v1/internal/logbook/shift-summary` | `0 7,15,23 * * *` | Shift end summaries |
| `POST /v1/internal/logbook/cleanup-expired` | `0 3 * * *` | Hard-delete expired logbook entries |
| `POST /v1/internal/billing/monthly-trueup` | `0 0 28-31 * *` | Stripe billing true-up |
| `POST /v1/internal/reports/daily-summary-email` | `0 6 * * *` | Daily GM summary (Resend) |
```

New text (verified from `apps/api/core/scheduler.py` and `apps/api/main.py` lifespan):
```
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
| `reports.daily-summary-email` | `0 6 * * *` | Daily GM summary (Resend) |
| `evidence.reminders` | `0 6 * * *` | Controlled-doc acknowledgement reminders |
| `safety.training-assignments` | `0 6 * * *` | Safety training assignment/reminders |
| `safety.drill-follow-up` | `0 6 * * *` | Drill follow-up evidence escalation |
| `lost-found.retention-check` | `0 6 * * *` | Lost & found retention check |
| `logbook.shift-summary` | `0 7,15,23 * * *` | Shift end summaries |
| `ai.failure-predictions` | `0 0 * * *` | Asset failure predictions |
| `logbook.cleanup-expired` | `0 3 * * *` | Hard-delete expired logbook entries |
| `billing.monthly-trueup` | `0 0 28-31 * *` | Stripe billing true-up |
```

Note: the new job list has **13 jobs** vs. the old table's 12 endpoints — `lost-found.retention-check` is a job that exists in `scheduler.py`/`main.py` (`CRON_TOLERANCE_MINUTES` and job handler map) but was never in the old CLAUDE.md table. Include it; it's real and currently undocumented (a 4th minor drift, not in the original 3 named claims, but should be captured since Success Criterion 1 says "describes the actual... mechanism").

### 2. Current Scope credential note replacement

Current text (to replace):
```
- **No live API credentials in the local environment.** There is no `.env` with `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, or Stripe keys locally. All AI-credit and billing paths cannot be exercised
  end-to-end. Testing relies entirely on manual interaction against the running dev servers
  (`npm run dev:api` + `npm run dev:web`) and the Supabase backend. Do not assume automated
  credential-gated flows can be verified — flag when a feature requires credentials that aren't
  present.
```

New text (verified: `apps/api/.env` exists; keys present vs. absent confirmed by grepping key names only, no secret values read):
```
- **Partial local credentials.** `apps/api/.env` exists and has Supabase (`SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`), Stripe test-mode (`STRIPE_SECRET_KEY` starts
  with `sk_test_`, `STRIPE_WEBHOOK_SECRET`), and cron/app config (`CRON_SECRET`, `APP_ENV`,
  `APP_URL`, `API_URL`) populated — billing and Supabase-backed paths CAN be exercised locally.
  `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` (AI credit paths) are absent, as are Twilio (SMS) and
  Opera/OHIP OAuth credentials — those paths cannot be exercised end-to-end locally. Flag when a
  feature requires one of these specific absent credentials.
```

### 3. Domain Map replacement

Current table has 20 routers listed (+ `internal.py` covered separately in Cron Jobs, not in this table). Full verified table for all 30 files in `apps/api/routers/` (registration order matches `main.py` import/`include_router` order):

```
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
```

That's 30 domains covering all 30 router files (`hotels`+`onboarding` share a row, `work_orders`+`assets` share a row, matching the existing table's grouping convention — everything else is one row per router).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| GitHub Actions cron → `/v1/internal/*` HTTP calls | In-process `AsyncIOScheduler` in `apps/api/core/scheduler.py` | Commit predates this phase (already in `main`, confirmed via docstring referencing the GH Actions delay problem) | Cron reliability fix already shipped in code; only the doc is stale |

## Open Questions

None. All three claims were directly verified against source files (`apps/api/core/scheduler.py`, `apps/api/main.py`, `apps/api/core/config.py`, `apps/api/.env` key names only, `apps/api/routers/*.py`, `apps/web/app/(dashboard)/**`).

## Sources

### Primary (HIGH confidence — direct file reads/greps against the live repo)
- `apps/api/core/scheduler.py` (full read) — job schedule dict `CRON_SCHEDULE`, handler map, `should_run_scheduler()` gate, module docstring explaining GH Actions retirement reason
- `apps/api/main.py` (full read) — lifespan handler starting the scheduler; `PREFIX = "/v1"`; all 28 `app.include_router(...)` calls (rooms + internal bring total registered routers to 30, since `auth`...`programs` list already enumerated 28 in imports, plus `rooms` and `internal` also included = confirmed 30 total router files, all imported in `main.py`)
- `apps/api/routers/` directory listing (Glob) — 30 `.py` files (29 domain routers + `__init__.py` excluded)
- `apps/api/core/config.py` (grep) — confirms field names `openai_api_key`, `anthropic_api_key`, `twilio_account_sid`/`twilio_auth_token`/`twilio_phone_number`/`twilio_status_callback_url`, `opera_oauth_client_id`/`opera_oauth_client_secret`/`opera_oauth_redirect_uri`/`opera_app_key`/`opera_enterprise_id`/`opera_credential_encryption_key` all default to `""` (i.e., these are the vars that are absent when not set in `.env`)
- `apps/api/.env` (grep key names only, no values) — present keys: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`, `APP_ENV`, `APP_URL`, `API_URL` (9 keys total); `STRIPE_SECRET_KEY` value prefix confirmed `sk_test_` (test-mode) without reading the full secret
- `apps/web/app/(dashboard)/*` directory listing (Bash `ls`) — confirms which of the 9 "missing" routers have a dedicated dashboard route (`evidence`, `safety`, `programs`, `management-roi` do; `clean_sessions`, `cleaning_checklists`, `feedback`, `late_checkout`, `shifts` do not)
- Grep for `lib/api/cleanSessions`, `lib/api/checklists`, `lib/api/lateCheckout` usages across `apps/web` — confirms `clean_sessions`/`late_checkout` are consumed inside Housekeeping/FrontDesk components (no dedicated route), `cleaning_checklists` inside `(dashboard)/settings/housekeeping/page.tsx` (via `CleaningChecklistEditor`), `shifts` consumed by `scheduling.ts`/`logbook.ts` API clients (no dedicated `shifts.ts` client file — folded into scheduling)
- Grep `feedback` usage — confirms dedicated route `(dashboard)/settings/feedback/page.tsx`

No WebSearch/Context7/external sources were needed — this phase is entirely about the local repo's own drift.

## Metadata

**Confidence breakdown:**
- Cron mechanism: HIGH — read the full scheduler module and the lifespan wiring, cross-checked job IDs against the handler map (code raises `RuntimeError` on any id mismatch, so the two are guaranteed in sync)
- Credential presence: HIGH — grepped `.env` key names directly (values not read/printed), cross-checked absent-key names against `config.py` field defaults
- Domain map: HIGH — enumerated all 30 router files via Glob, cross-checked against `main.py` imports/registrations, checked web route pairing via directory listings and import greps for each of the 9 previously-missing routers

**Research date:** 2026-08-04
**Valid until:** Indefinite for this snapshot (documentation-only phase; re-verify only if scheduler.py, .env, or routers/ change again before this phase executes)
