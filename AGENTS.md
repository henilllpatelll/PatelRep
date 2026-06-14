# PatelRep Codex Instructions

These instructions apply to every Codex session in this repository.

## OpenWolf

- This project uses OpenWolf for context management.
- Read and follow `.wolf/OPENWOLF.md` every session.
- Check `.wolf/anatomy.md` before reading files.
- Check `.wolf/cerebrum.md` before generating code.
- Prefer anatomy summaries when they are sufficient; read full files only when needed.
- After significant actions, append a one-line entry to `.wolf/memory.md`.
- When creating, deleting, or renaming files, update `.wolf/anatomy.md`.
- When a useful project convention, preference, gotcha, or decision is learned, update `.wolf/cerebrum.md`.

## Always Use Skills

- At the start of every task, inspect the available skills and use all skills that clearly apply.
- If the user explicitly says "use skills" or names a skill, treat that as mandatory for the turn.
- If more than one skill applies, use the smallest useful set and state the order briefly.
- If a relevant skill is unavailable, blocked, or missing, say so clearly and continue with the best fallback.

## Git Workflow

- Default stable branch: `main`.
- Long-lived integration branch: `pivot/hk-maint-opera-execution`.
- Create focused feature branches from `pivot/hk-maint-opera-execution`.
- Open PRs from feature branches into `pivot/hk-maint-opera-execution`, not directly into `main`.
- Only merge `pivot/hk-maint-opera-execution` into `main` after the full pivot is working.
- Keep feature branches focused on one coherent change.
- Do not rewrite or discard user work unless the user explicitly asks.

## Product Direction

- PatelRep is pivoting into a housekeeping and maintenance command center with supervised OPERA Cloud execution.
- Web app = manager command center.
- Mobile app = housekeeping and maintenance execution app.
- PatelRep backend/task engine = source of truth.
- OPERA Cloud computer-use worker = supervised PMS context/execution layer.
- Slack = optional later only for urgent escalations and AI failure alerts.
- PMS APIs = not an MVP dependency.
- Shift4/payment automation = out of scope.
- Preserve the current color palette.
- Reuse the current web and mobile apps as the foundation.
- Do not create a separate project.
- Keep existing API/Slack code dormant behind provider/config flags where possible.

## MVP Boundaries

Do not implement, automate, or expose MVP flows that perform:

- Payments
- Refunds
- Charges
- Check-ins
- Checkouts
- Room moves
- Reservation cancellations
- Rate changes
- Inventory edits
- Night audit close
- Guest compensation

If a requested feature appears to require one of these actions, stop and clarify the safest supervised/non-executing alternative.

## Code Decision Filter

Every feature must save a housekeeper, engineer, or manager time on the floor without adding phone complexity.

Prefer:

- Fast execution workflows over broad admin surfaces.
- Clear supervisor review before risky PMS execution.
- Deterministic task state in PatelRep before external execution.
- Existing app surfaces over new projects or parallel prototypes.

Avoid:

- Adding Slack as a primary workflow.
- Making OPERA or PMS APIs required for the MVP.
- Adding payment, billing automation, or guest-compensation surfaces to MVP scope.
- Building complex mobile interactions that slow floor staff down.

## Test, Fix, Verify Loop

- Work in small increments.
- Before changing implementation code, identify expected behavior and add or update focused tests whenever practical.
- For every new implementation, create or refine tests when the project has a reasonable test setup.
- If tests are not added for an implementation, explain why in the final response.
- After each meaningful implementation increment, run the narrowest useful verification.
- If a check fails, stop new implementation work, fix the failure, and rerun the check.
- Clean up temporary files, debug code, unused imports, dead code, stale comments, and accidental artifacts before moving on.
- Format touched files using the project's normal formatter when available.

## Final Verification

- Before finishing any coding task, run the best available project checks: tests, typecheck, lint, build, security scan, or the narrowest valid equivalent.
- For local apps or services, start the project on localhost and manually verify the relevant workflow when practical.
- If browser verification is needed, open the localhost URL and confirm the screen or workflow works.
- If verification cannot be completed, report the blocker, what was tried, and the closest verification that did run.

## Task Completion Requirements

Every final response for a code or repo change must summarize:

- Changed files.
- Tests, typecheck, lint, build, or manual verification results.
- Remaining risks or known follow-up work.

## Project Shape

PatelRep is a hotel operations SaaS for Texas hotels, now focused on housekeeping, maintenance, and supervised OPERA execution.

```
PatelRep/
  apps/
    api/       FastAPI Python backend
    web/       Next.js manager command center
    mobile/    Expo execution app for housekeeping and maintenance
  supabase/    SQL migrations and database source of truth
  spec/        Product and workflow specs
  .planning/   GSD state, roadmap, and phase plans
```

## Commands

```bash
npm run dev:api
npm run dev:web

cd apps/api && pip install -r requirements.txt
cd apps/api && pytest tests/

npm run build --workspace=@patelrep/web
```

Known web command fallback: if root workspaces are unavailable, run app-local commands from `apps/web`.

```bash
npm run type-check
npm run lint
npm run build
```

## Architecture Conventions

### Multi-tenancy

- Every Supabase query must scope to the current tenant.
- Use `.eq("hotel_id", user.hotel_id)` or the equivalent tenant key on every tenant-owned query.
- RLS is a second safety layer, not a substitute for application-level tenant filters.

### Backend

- FastAPI lives in `apps/api`.
- Add new API domains as routers under `apps/api/routers/` and include them from `apps/api/main.py`.
- Keep business logic in domain routers until it is clearly shared across multiple domains.
- Current service-layer exceptions are `apps/api/services/ai/` and `apps/api/services/opera/`.
- Use the Supabase Python SDK directly; do not add an ORM.
- Success responses use `{ "data": ... }`; paginated lists also include `{ "meta": { "page", "per_page" } }`.
- Cron endpoints live in `routers/internal.py` and must be guarded by `X-Cron-Secret`.

### Auth and RBAC

- JWT custom claims include `hotel_id` and app role.
- Use `get_current_user()` for tenant-scoped routes.
- Gate role-specific routes with `require_role(*roles)`.
- Supported app roles: `housekeeper`, `engineer`, `housekeeping_supervisor`, `chief_engineer`, `front_desk`, `gm`.

### Web

- Next.js manager command center lives in `apps/web`.
- Auth state uses Zustand plus the `useAuth` hook.
- Server data uses React Query.
- Preserve the current Warm Operational Hospitality visual system and color palette.
- Do not replace the current web app foundation or create a separate manager app.

### Mobile

- Expo floor execution app lives in `apps/mobile`.
- Preserve the current mobile foundation and palette.
- Mobile workflows should optimize for quick housekeeping and maintenance execution on the floor.
- Avoid dense manager/admin flows in the mobile app unless explicitly scoped for a supervisor workflow.

### Realtime

- Realtime should stay limited to high-value operational surfaces.
- Standard screens should prefer pull-to-refresh unless realtime is clearly needed.

### AI and Credits

- AI credit accounting must log actual token usage from provider responses, never fixed estimates.
- Use cheaper/latency-sensitive models for parsing and routing when appropriate.
- Use higher-reasoning models only where quality materially affects operations.
- SOP pgvector RPC uses `match_sop_chunks()` with parameter `match_hotel_id`, not `hotel_id`.

### OPERA Cloud

- PatelRep must function standalone first.
- OPERA Cloud is a supervised PMS context/execution layer, not PatelRep's source of truth.
- PMS APIs are not required for MVP.
- Any OPERA execution must respect the forbidden MVP action list.
- Prefer provider/config flags so OPERA-related code can remain dormant unless enabled.

### Slack

- Slack is optional later only for urgent escalations and AI failure alerts.
- Do not make Slack the primary task, housekeeping, or maintenance workflow.
- Keep Slack-related code dormant behind provider/config flags where possible.
