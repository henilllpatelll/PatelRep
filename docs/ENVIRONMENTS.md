# PatelRep environments

PatelRep has deliberately separate stacks. A staging API or web bundle must never use the production Supabase project.

| Environment | Web | API | Database | Purpose |
| --- | --- | --- | --- | --- |
| Development | localhost | localhost | local/dev or test Supabase | local work |
| Staging | `https://patelrep-web-staging-staging.up.railway.app` | `https://patelrep-api-staging-staging.up.railway.app` | **PatelRep Staging** Supabase project | pre-production verification |
| Production | `https://patelrep-production-6f35.up.railway.app` | `https://noble-cooperation-production.up.railway.app` | production Supabase project | real hotel users |

## Staging Railway setup

The Railway project `poetic-adventure` contains a dedicated `staging` environment with two empty, staging-only services: `PatelRep-API-Staging` and `PatelRep-Web-Staging`. Their Railway domains are listed in the matrix above. They were created without copying production variables or deployments.

Before the first staging deploy, create a separate Supabase project named **PatelRep Staging**. Do not clone production data or auth users. Apply the repository migrations in filename order, resolving and recording the historical duplicate prefixes (`0201` / `020`, duplicated `039`, and three `042` files) according to the Supabase migration tool's tracked history. The source of truth is `supabase/migrations/`; if a clean project cannot apply the complete history, stop and document the first failing migration rather than hand-building schema drift.

Set the following Railway variables in the `staging` environment only. Values are placeholders—never commit credentials.

| Service | Variables |
| --- | --- |
| API | `APP_ENV=staging`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `APP_URL`, `API_URL`, `STAGING_EXPECTED_SUPABASE_HOST`, `PRODUCTION_SUPABASE_HOST`, `CRON_SCHEDULER_ENABLED=false`, `STAGING_EXTERNAL_INTEGRATIONS_ENABLED=false`, `CRON_SECRET` |
| Web build | `NEXT_PUBLIC_APP_ENV=staging`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`, `STAGING_EXPECTED_API_HOST`, `STAGING_EXPECTED_SUPABASE_HOST`, `PRODUCTION_API_HOST`, `PRODUCTION_SUPABASE_HOST` |

`NEXT_PUBLIC_*` values are build-time values. Railway must pass them as Docker build arguments; the web Dockerfile does so explicitly. A staging web build fails unless its configured API and Supabase hostnames exactly match the staging allowlist. The API likewise refuses to start in staging unless its Supabase hostname matches `STAGING_EXPECTED_SUPABASE_HOST`.

## Integrations

| Integration | Staging policy |
| --- | --- |
| Stripe | Test-mode keys only; no production webhook destination. |
| Opera / OHIP / SFTP | Disabled unless a dedicated vendor sandbox is configured. |
| Scheduled jobs | Disabled with `CRON_SCHEDULER_ENABLED=false`; never attach production cron triggers. |
| Email / notifications | Use a test sink or explicit staging-only allowlist. |
| AI | Optional, limited test usage with a separate budgeted key. |

## Fixtures and verification

Use only synthetic users and hotel data in staging. `apps/web/e2e/fixtures/seed-staging-tenant.mjs` safely converges a marked `is_test=true` tenant, four rooms, housekeeping state, six explicit role users, an asset, work order, task, guest request, logbook entry, and lost-and-found item. It has no `.env` fallback, requires `APP_ENV=staging`, `SEED_STAGING_FIXTURES=confirm`, an exact staging Supabase host match, and a password supplied only through `STAGING_FIXTURE_PASSWORD`. Store credentials in Railway or a team password manager, never the repository.

After deploying the API and web candidate manually, run:

```bash
STAGING_WEB_URL=https://patelrep-web-staging-staging.up.railway.app \
STAGING_API_URL=https://patelrep-api-staging-staging.up.railway.app \
STAGING_EXPECTED_SUPABASE_HOST=your-staging-project.supabase.co \
cd apps/web && npm run check:staging-health
```

The API `/health` response includes `environment` and the non-secret `supabase_host`. The staging health command verifies the login page, API/database readiness, `environment=staging`, and the expected staged Supabase host. The persistent header shows `STAGING` only for staging builds.

## Automated staging candidates

Phase 4 uses the GitHub `staging` Environment for all candidate credentials. Configure only staging values there: `STAGING_SUPABASE_DB_URL`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`, `STAGING_FIXTURE_PASSWORD`, and `STAGING_RAILWAY_TOKEN`. Never copy a production secret into this environment.

Configure these non-secret Environment variables: `STAGING_SUPABASE_URL`, `STAGING_EXPECTED_SUPABASE_HOST`, `STAGING_EXPECTED_DATABASE_HOST`, `PRODUCTION_SUPABASE_HOST`, `PRODUCTION_DATABASE_HOST`, `STAGING_API_URL`, `STAGING_WEB_URL`, `STAGING_RAILWAY_ENVIRONMENT=staging`, `STAGING_RAILWAY_PROJECT_ID`, `STAGING_RAILWAY_API_SERVICE_ID`, `STAGING_RAILWAY_WEB_SERVICE_ID`, `PRODUCTION_RAILWAY_API_SERVICE_ID`, and `PRODUCTION_RAILWAY_WEB_SERVICE_ID`. The production values are deny-list assertions; staging service IDs must differ from them.

`Staging Candidate` rebuilds the disposable staging database for every eligible same-repository PR SHA, seeds the synthetic tenant, deploys API before web, and verifies that `/health`, `/ready`, and the web metadata all report the exact same SHA. It has no permanent staging branch and never deploys `main` as a candidate. Its Playwright suite uses the six synthetic role accounts and only creates synthetic data.

## Production deploy trigger (Phase 6)

The two production Railway services (`noble-cooperation` / API, `PatelRep` / web) are **pinned to a fixed commit SHA** rather than following `main`'s HEAD. This is deliberate: before Phase 6, Railway auto-deployed every push to `main` with no CI wait and no approval, racing ahead of staging verification and database migration ordering. With the source pinned, a push to `main` no longer deploys anything by itself. The only way production code changes is `.github/workflows/production-release.yml` (or `production-rollback.yml`), both of which deploy an exact, already-verified commit via `railway up --ci` against a detached-HEAD checkout — the same mechanism `staging-candidate.yml` already uses for staging. If a service's source is ever reconnected to just `main` (no `commitSha`) in the Railway dashboard, the auto-deploy race returns; don't do that without updating this doc and re-confirming the intended release model.

## `production` GitHub Environment (Phase 6)

Required reviewer: repository owner. Shared by `feature-rollout.yml` (environment input `production`) and both `production-release.yml`/`production-rollback.yml`. Variables (non-secret):

`SUPABASE_URL`, `EXPECTED_SUPABASE_HOST`, `OTHER_ENV_SUPABASE_HOST`, `API_URL`, `WEB_URL` (feature-rollout's own vars — see [FEATURE_FLAGS.md](FEATURE_FLAGS.md)), plus `PRODUCTION_SUPABASE_URL`, `PRODUCTION_SUPABASE_HOST`, `PRODUCTION_EXPECTED_DATABASE_HOST`, `PRODUCTION_API_URL`, `PRODUCTION_WEB_URL`, `PRODUCTION_RAILWAY_PROJECT_ID`, `PRODUCTION_RAILWAY_ENVIRONMENT`, `PRODUCTION_RAILWAY_API_SERVICE_ID`, `PRODUCTION_RAILWAY_WEB_SERVICE_ID`, `STAGING_DATABASE_HOST`, `STAGING_SUPABASE_HOST` (deny-list pair, mirroring the existing staging-side pattern).

Secrets: `SUPABASE_SERVICE_ROLE_KEY` (feature-rollout), `PRODUCTION_SUPABASE_DB_URL`, `PRODUCTION_RAILWAY_TOKEN`. These are set directly by a repository admin (`gh secret set NAME --env production`) — never typed into an AI assistant conversation, since Supabase's own tooling deliberately cannot return a service-role key and a Railway token is a high-blast-radius credential.

## Secret hygiene

Examples use placeholders only. If secret scanning identifies a genuine credential in tracked source or history, revoke and rotate it at the provider, remove it from tracked files, and use `git filter-repo` (with a coordinated force-push and downstream clone cleanup) for a history purge. Removing a secret from the latest commit alone is not remediation.

The existing CI dependency audit is not a replacement for an authenticated secret scanner. Enable GitHub secret scanning and push protection for this public repository before the next production release; do not add a repository-side scanner that silently exempts protected private material from review.
