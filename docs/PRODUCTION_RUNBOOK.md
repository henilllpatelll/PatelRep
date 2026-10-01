# Production runbook

Concise operational procedures for releasing, recovering, and verifying PatelRep production. See [RELEASE_PROCESS.md](RELEASE_PROCESS.md) for the full pipeline design and [FEATURE_FLAGS.md](FEATURE_FLAGS.md) for the flag system this runbook leans on as first-line recovery.

## Normal release

1. Confirm the target PR shows a green **CI Gate** and a green **Staging Gate**, and has been merged to `main`.
2. Dispatch **Production Release** (`.github/workflows/production-release.yml`) from the Actions tab. Leave `release_sha` blank to release current `main`, or pin an explicit commit if `main` has moved on since the PR you intend to ship. Choose `version_bump` (`patch` for the common case).
3. Approve the `production` Environment's reviewer gate when prompted.
4. Watch the job summary for the release content report (PRs, migrations, feature keys).
5. If any job fails, the workflow stops — no tag or GitHub Release is created. See the failure sections below for the specific stage that failed.
6. On success, confirm the new `vX.Y.Z` tag and GitHub Release exist, and that the release content summary matches what you expected to ship.
7. If the release included a new feature flag, it is deployed **disabled**. Separately run **Feature Rollout** to enable it for a pilot tenant — see [FEATURE_FLAGS.md](FEATURE_FLAGS.md).

## Feature problem (pilot or cohort tenant misbehaving)

1. Identify the feature key and affected tenant(s).
2. Run **Feature Rollout** with `enabled: false` for those tenants. No redeploy, no Railway build — takes effect within ~15 seconds (the backend's in-process flag cache TTL).
3. Confirm via `feature-flag-status.mjs` that the flag now reads `enabled: false`, and confirm with the affected hotel (or a staging fixture) that prior behavior is restored.
4. Investigate and fix on a branch through the normal PR → CI Gate → Staging Gate → Production Release path.
5. Re-enable via Feature Rollout once the fix has gone through the same pilot → cohort rollout again.

**This does not help if the change made an incompatible shared-schema change** (violated expand/contract). In that case, use a code rollback and/or a corrective migration instead — see "Database failure" below.

## Web failure (shared app regression, not behind a flag)

1. Identify the last known-good `vX.Y.Z` tag (the GitHub Release immediately before the current one).
2. Dispatch **Production Rollback** (`.github/workflows/production-rollback.yml`) with that `target_version`.
3. Approve the `production` Environment's reviewer gate.
4. The workflow redeploys both API and web at the known-good commit and re-verifies release identity — it does not reverse any database migration.
5. Once stable, investigate the regression on a branch and ship the fix through the normal path.

## API failure (deploy failed, or unhealthy after deploy)

- **If `deploy-api` failed before web deployed:** production Web is untouched (the release workflow never starts `deploy-web` unless `deploy-api` succeeded). Investigate the Railway deploy logs and the API health/readiness response; fix forward via a new PR, or roll back to the last known-good tag with **Production Rollback**.
- **If the API is unhealthy after a release completed:** assess compatibility with the current database schema, then either redeploy the previous tag with **Production Rollback** or forward-fix via a new PR. Never attempt to reverse the database first.

## Database failure

- **Pre-flight found unexpected ("unknown") migrations on production:** STOP. Do not run `production-db-migrate`. This means production has drifted from the repository's migration history in a way the tooling cannot explain — investigate manually before any further release action. Never auto-repair drift.
- **A migration failed to apply:** the release workflow does not continue to `deploy-api`. Investigate the failure in Supabase directly; most schema changes are additive (expand-only) and safe to leave half-applied while you fix the migration file (as a *new* forward migration — never edit an already-released one, see [DATABASE_MIGRATIONS.md](DATABASE_MIGRATIONS.md)).
- **General rule:** database rollback is **not** the default recovery path. Prefer, in order: (1) disable the related feature flag, (2) redeploy a previous compatible application version, (3) forward-fix the schema with a new migration. Reverse a migration only when it was explicitly designed and tested for reversal, data loss is impossible or accepted, and production approval exists. A migration's `-- ROLLBACK` SQL comment is guidance for a human, never something a workflow executes automatically.

## Full outage

1. Identify the last-known-good release: the GitHub Release immediately preceding the one that broke production, or confirmed-stable runtime identity from before the incident.
2. Confirm that version's migrations are still compatible with the current production schema (an expand-only gap is normal and safe; a destructive/contract change since then needs a deliberate decision, not an automatic rollback).
3. Dispatch **Production Rollback** with that version, approve it, and verify health completes successfully.
4. Once stable, write up what happened and fix forward through the normal PR path before attempting to re-release the version that caused the outage.

## Known release-safety risk (as of this phase)

The `staging` GitHub Environment currently has no configured variables or secrets (a pre-existing gap from Phases 4–5, not introduced here). Until an administrator configures it per [ENVIRONMENTS.md](ENVIRONMENTS.md), `Staging Candidate` cannot actually run, which means no commit can currently produce a real `Staging Gate` success — and Production Release's eligibility check will correctly refuse every release until that is fixed. This is the safe failure direction (refuse rather than skip verification), not a bug in this workflow.
