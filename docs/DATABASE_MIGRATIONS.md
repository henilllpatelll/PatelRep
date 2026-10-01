# Database migrations

Supabase is PatelRep's only database migration engine. A database change is not release-ready until it passes the **Database Migration Gate**, is applied to staging, passes `/ready`, and reports `Status: CLEAN` from the drift check.

## Current inventory and historical conditions

The immutable repository inventory is [`supabase/migration-manifest.json`](../supabase/migration-manifest.json). It records the exact filename and SHA-256 checksum of every 133 historical SQL migration (001 through 129, plus the historical `0201` workaround). The generated [migration inventory](MIGRATION_INVENTORY.md) captures every current filename, identifier, inferred purpose, ordering condition, and conservative static risk signal. The manifest is the audit record used by CI to prove no released file was edited or removed.

The audit found these grandfathered, immutable identifier collisions:

| Identifier | Files | Release consequence |
| --- | --- | --- |
| `039` | `039_drop_room_status_history_trigger.sql`, `039_drop_unused_indexes.sql` | Historical ambiguity; do not rename either file. |
| `042` | `042_guest_requests_priority.sql`, `042_lost_found_photos_bucket.sql`, `042_room_assignment_clean_type.sql` | Historical ambiguity; do not rename any file. |
| `110` | `110_room_unavailability_type.sql`, `110_work_order_console_features.sql` | Historical ambiguity; do not rename either file. |
| `0201` | `0201_logbook_expires.sql` | Historical collision workaround; its order is delegated to the pinned Supabase CLI. |

All pre-Phase-3 files are protected by the manifest, but their safety must be assessed as a chain: the clean rebuild gate applies the actual repository sequence from zero. The manifest intentionally does not hide these conditions. New migrations must use a unique numeric identifier greater than the highest released identifier. In the current baseline that means **greater than 201**, because Supabase parses historical `0201` as identifier 201.

The historical SQL includes data corrections, trigger/function replacements, and `DROP` operations (notably the `039` pair). They remain immutable because production may have recorded them already. If one blocks a fresh rebuild, repair it with a new forward migration or a documented, one-time clean-rebuild harness—never by casually renaming applied history.

## Real migration history vs. normalized replay history

These are two deliberately separate things. Do not confuse them, and never move an identifier from one into the other.

**REAL MIGRATION HISTORY** — `supabase/migrations/`, unmodified. This is the immutable, production/staging-deployed record. Remote drift checks (`check-db-drift.mjs`, `supabase migration list`), the immutable manifest, and every real deployment (`staging-db-migrate.yml`, the Staging Candidate workflow, any future production migration workflow) operate exclusively on these real, historical identifiers — including the grandfathered `039`/`042`/`110` collisions. Remote environments are never migrated or drift-compared using anything else.

**NORMALIZED REPLAY HISTORY** — an ephemeral, CI/local-only reconstruction mechanism, built fresh on every run by `scripts/build-migration-replay-workspace.mjs` and never committed. Supabase's local migration tracker (`supabase_migrations.schema_migrations`) rejects two files sharing one leading numeric identifier, so a clean `supabase db reset --local` replay of the real directory cannot get past the first grandfathered collision (`039`). The script copies every repository migration, byte-identical, into a temporary directory under a synthetic, unique, monotonically increasing 14-digit version prefix (`20000101000001`, `20000101000002`, ...) that preserves the exact repository execution order — it changes only the migration-tracking filename, never the SQL content. It also copies `config.toml` and `seed.sql` unchanged. The **Database Migration Gate** (`node scripts/build-migration-replay-workspace.test.mjs` invariant tests, then `supabase start`/`db reset --local` with `--workdir` pointed at the generated workspace) and `npm run db:rebuild` are the only consumers. Verified invariants on every build: every repository migration appears exactly once, none are omitted or duplicated, normalized versions are unique, normalized ordering equals repository ordering, and SQL content hashes are identical before and after the copy.

**Never deploy a normalized replay filename to a remote environment.** The grandfathered real identifiers (`039`/`042`/`110`/etc.) are what staging and production actually have recorded; the normalized versions exist only to let a from-scratch local/CI rebuild finish.

## Remote clean-rebuild harness

`scripts/remote-migration-apply.mjs` is the documented, one-time clean-rebuild harness referenced above, for the one case the normalized replay workspace can never be used for: building a brand-new remote database (first staging bootstrap, or disaster recovery) from zero using the real historical identifiers. `supabase db reset`/`db push` apply each file's SQL and its `schema_migrations` tracking insert in one transaction, so the second (and third) file in a grandfathered collision group fails the insert and silently rolls back its own SQL too — it is never actually applied. This script instead wipes the target to Supabase's blank baseline (via `supabase db reset` against an ephemeral, empty-migrations workspace), then replays every real migration file directly via `psql` in exact repository order: the first file to use a given version gets a tracking row (matching what `check-db-drift.mjs` already expects, since it dedupes by version), and every later file sharing that version still has its SQL executed but is not re-recorded. Used by the **Staging Candidate** workflow's database-rebuild step; see `scripts/remote-migration-apply.test.mjs` for the planning-logic unit tests.

## Required commands

```bash
npm run db:check       # immutable history, filename, ordering, and destructive-SQL guard
npm run db:test        # checker failure-mode tests
npm run db:rebuild     # Docker-backed local Supabase start + reset from zero
npm run db:contracts   # focused catalog/RLS/RPC contract verification
npm run db:drift:staging
npm run db:drift:production
```

`db:rebuild` uses pinned `supabase@2.76.8`, requires Docker Desktop, and runs `db:contracts` after reset. `db:contracts` requires PostgreSQL client tools (`psql`). Both commands operate only on the local Supabase ports unless an explicit drift environment variable is supplied.

## Immutable migration rule

Once a migration has reached production, do not edit, rename, or delete it. Make a new forward migration instead. `supabase/migration-manifest.json` is the repository-side checksum baseline that catches accidental mutation or deletion before Supabase is invoked. When a newly released migration becomes part of the protected production baseline, deliberately update the manifest in the release PR; never regenerate it casually to silence a mismatch.

## Naming and ordering

- Use `NNN_short_lowercase_description.sql`; start the next identifier above the current maximum.
- The checker blocks malformed names, new backdated identifiers, and any new duplicate identifier.
- Existing historical collisions are reported as `KNOWN HISTORICAL CONDITION`; they are not silently normalized.
- Never depend on a manually-run production SQL editor change. If emergency SQL is unavoidable, immediately capture the exact forward change in a repository migration and reconcile migration history before the next release.

## Expand → migrate → contract

Schema changes visible to the application must tolerate Railway rolling deploys, where old API instances and new API instances can overlap.

1. **Expand:** add nullable/default-safe tables or columns. Deploy code that can read old and new structures.
2. **Migrate:** backfill with an idempotent, tenant-scoped, set-based operation. Batch large work; avoid full-table application-memory loops and account for locks.
3. **Contract:** only after code no longer uses the old shape and the overlap period has elapsed, remove obsolete structures in a separate reviewed migration.

Never add `NOT NULL` columns to populated tables without a safe default/backfill path. Prefer `IF EXISTS`/`IF NOT EXISTS` where an operation is legitimately repeatable, but do not use it to suppress an unexpected schema mismatch.

## Destructive migration review

The checker treats `DROP`, `TRUNCATE`, `DELETE FROM`, and destructive `ALTER` patterns in **new** migrations as a blocking review condition. A deliberately reviewed migration must contain both:

```sql
-- migration-safety: destructive-reviewed
-- rollback-plan: forward fix or restore strategy, owner, and compatibility notes
```

The marker does not make the SQL safe; it makes the review explicit. Include the compatibility and rollback/forward-fix plan in the PR.

## Schema and API contracts

Migration `202_schema_readiness_contract.sql` introduces `public.app_schema_readiness()`. It checks the high-impact contract used by housekeeping, engineering, tasks, logbook, lost & found, extensions, and critical RPCs without reading hotel/guest rows. `/health` remains a process/liveness probe. `/ready` calls this lightweight, data-free database contract and returns `503` with precise missing contract names when the API and schema are incompatible.

The deeper `scripts/schema-contracts.sql` check runs only in the isolated migration gate or a deliberately targeted staging database. It verifies the readiness contract and RLS on the high-impact tenant-scoped tables.

## Drift and remote promotion

`check-db-drift.mjs` compares migration **identifiers**, not raw counts, through `supabase migration list`. It reports both migrations missing from the target and unknown migrations present on the target. Because pre-Phase-3 history contains duplicate identifiers, that baseline can only be reconciled at the identifier level; all new identifiers are required to be unambiguous.

The manual **Staging Database Migrate** workflow can run only from `main`, uses GitHub's `staging` environment, and accepts only `STAGING_SUPABASE_DB_URL`. It lists pending identifiers, applies them to staging, then requires drift `CLEAN` and schema contracts. It has no production project-ref or URL input.

For pull-request release candidates, the **Staging Candidate** workflow uses the stronger disposable-shared strategy: serialized execution, exact staging database/API hostname assertions, remote reset from the candidate SHA’s repository migrations, deterministic synthetic seed, schema contracts, then identifier-level drift verification. The reset is refused when either target host differs from the configured staging allowlist, matches the configured production host, or the staging/production allowlists overlap. This avoids leaving a rejected migration-bearing PR permanently ahead of `main` in staging.

There is intentionally no feature-PR production migration workflow. A future production workflow must be restricted to `main`, protected by a GitHub `production` environment requiring approval, pinned to an exact commit, and perform drift/readiness checks before and after the migration.

## Failure-mode coverage

| Condition | Proof |
| --- | --- |
| Invalid SQL or missing prior dependency | `supabase db reset --local` against the normalized replay workspace in Database Migration Gate fails. |
| Released migration changed or deleted | `check-migrations.test.mjs` and immutable manifest checks fail. |
| Duplicate/backdated new identifier | `check-migrations.test.mjs` fails (grandfathered historical collisions are reported as notices, not failures). |
| Destructive SQL without review marker | `check-migrations.test.mjs` fails. |
| Replay workspace omits/duplicates a migration, or rewrites SQL content | `build-migration-replay-workspace.test.mjs` fails. |
| Staging behind Git | `check-db-drift.test.mjs` reports precise missing identifiers; workflow allows this only before its apply step. |
| Staging fully migrated | `check-db-drift.test.mjs` verifies the clean comparison; workflow requires `Status: CLEAN` afterward. |
| API expects absent schema | API `/ready` unit coverage and migrated-Supabase integration test fail with the named contract. |
