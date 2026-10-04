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

`check-db-drift.mjs` compares migration **identifiers**, not raw counts, through a read-only `psql` query. It reports both migrations missing from the target and unknown migrations present on the target. Because pre-Phase-3 history contains duplicate identifiers, that baseline can only be reconciled at the identifier level; all new identifiers are required to be unambiguous.

### Production timestamp-history aliases

Production has a documented historical condition: older repository migrations were applied through Supabase tooling that recorded auto-generated timestamp identifiers instead of this repository's deterministic numeric filename identifiers. The production preflight may reconcile this history only through [`supabase/production-migration-aliases.json`](../supabase/production-migration-aliases.json).

Each alias is an explicit, production-only, one-to-one `remote_id` (14-digit timestamp) to `repository_id` mapping with an evidence reference. The drift checker validates that every target exists in the repository, that no remote ID or canonical target is repeated, and that an alias cannot hide a second remote ID for the same canonical migration. Staging never loads this file.

Do not infer aliases from timestamps, ordering, counts, or nearby filenames. Add one only when a repository record proves the precise mapping, and cite that record in `evidence`. An unmapped timestamp remains an unknown production migration and stops the release exactly like any other unknown ID. This registry reconciles history for comparison only: it neither changes schema nor rewrites Supabase migration metadata. Never use `supabase migration repair` as a substitute.

### Production-only known history (attestations, not aliases)

Three production rows exist only in production history and match no repository SQL (Production Migration Evidence Audit run `37212200992`). They are recorded in [`supabase/production-known-history.json`](../supabase/production-known-history.json). This is **not** an alias registry: an attested row never maps to a repository migration, never becomes an effective local version and is never proof that a repository migration ran (nearby files such as `038_add_fk_indexes.sql` are not identity).

An entry is accepted only when live production matches ALL of: `remote_id`, stored `name`, statement count and the normalized statement SHA-256 (the same `scripts/migration-statement-fingerprint.mjs` the audit uses). Any mismatch, an unreadable `statements` column, a malformed or duplicate entry, or an entry that collides with an alias or repository migration name is a hard failure; every other unknown row still blocks the release. Staging never loads the file, and no raw SQL is stored or printed (only counts, names and fingerprints).

### Grandfathered duplicate forward repairs

Numeric history cannot prove which duplicate file a numeric row represents. [`supabase/production-duplicate-forward-repairs.json`](../supabase/production-duplicate-forward-repairs.json) maps each unprovable duplicate to one unique, later forward migration pinned by content hash: `042_room_assignment_clean_type.sql` -> `204_reconcile_room_assignment_clean_type.sql` (idempotent re-assertion of the clean_type contract) and `110_room_unavailability_type.sql` -> `205_reconcile_room_unavailability_type.sql` (the canonical function and service-role-only privileges, whose effects were absent). The historical files are never edited. A repair satisfies duplicate coverage only when it is already recorded on production, or (`--allow-pending`) is pending in that same controlled release; otherwise the duplicate group stays incomplete. It is not a generic bypass, and unrelated incomplete duplicate groups still block.

The read-only **Production Migration Evidence Audit** now also reports the same drift evaluation (`migration_preflight` in its sanitized report): known rows verified, unknown rows, aliases, duplicate coverage, forward repair status and pending repository migrations. Run it after this reconciliation merges and before another Production Release. Nothing here runs `supabase migration repair`, writes `supabase_migrations`, or applies 204/205; the controlled release does that.

### Production apply: ephemeral verified workspace

The pinned Supabase CLI (`2.76.8`) refuses to `db push` from the normal repository directory because the three attested production-only rows have no local file ("Remote migration versions not found in local migrations directory"); `--include-all` does not change that, and rewriting production history is forbidden. [`scripts/production-migration-apply-workspace.mjs`](../scripts/production-migration-apply-workspace.mjs) therefore applies through a throwaway, release-scoped workspace under `$RUNNER_TEMP` that is never committed, uploaded, printed or reused:

1. **Revalidate**: the production target guard, the exact pinned CLI version, and the attestation-aware drift evaluation (all attestations exact; zero unknown or unresolved rows; duplicate coverage complete only through applied/pending forward repairs).
2. **Mirror**: copy only `supabase/config.toml`, then `supabase migration fetch` (read-only against the database) to mirror the real remote history.
3. **Verify**: re-read the live history independently and require the mirror's version set to equal it exactly (and the attestations to still verify).
4. **Overlay**: copy only the exact repository files for the versions the evaluator proved pending. Each pending version must match exactly one repository file; grandfathered duplicate sources (`042_*`, `110_*`) are never copied — their gaps close through `204`/`205`.
5. **Dry run**: `db push --dry-run --include-all` from the workspace must propose exactly the pending set (no extras, omissions, duplicates, or repair/missing-local hints) or the run hard-fails before any mutation.
6. **Apply**: the production-release `production-db-migrate` job (protected `production` Environment) repeats 1-5 from scratch immediately before mutating (the time-of-check boundary), then the CLI applies and records the migrations itself; the applied list must equal the verified plan. The preflight job runs the same steps as `plan` (no apply). After apply, `check-db-drift.mjs` must report `Status: CLEAN`, `verify-applied` re-proves the attestations, forward-repair recording and duplicate coverage, then the schema contracts run.

The mirror files are only a CLI synchronization aid; they are not repository migrations, aliases or repository-file proof. No script here writes `supabase_migrations` or uses the CLI's history-rewriting or history-pulling commands. The required **Supabase CLI Apply Contract** CI job (`scripts/production-migration-apply-cli-contract.test.mjs`) runs the actual pinned CLI against a disposable production-shaped database (remote-only 14-digit rows, pending numerics sorting before them, unique forward repairs) and proves the normal workspace is rejected, the ephemeral workspace dry-runs and applies exactly the pending set, and the original history rows are byte-identical (including `xmin`) afterwards.

The current unproven production timestamp set and evidence review are tracked in [`PRODUCTION_MIGRATION_ALIAS_EVIDENCE.md`](PRODUCTION_MIGRATION_ALIAS_EVIDENCE.md). Future migrations continue to use the repository's deterministic numeric numbering rules.

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
