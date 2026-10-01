# PatelRep release process

PatelRep production is driven by `main`. Treat `main` as a release branch, not a normal development branch.

## Normal workflow

1. Start from current `main`, then intentionally create a feature branch: `git checkout -b feat/<name>`.
2. Implement and verify the scoped change.
3. Run `npm run ship` from the feature branch to stage, commit, push, and create a pull request. The command refuses to operate on protected production branches.
4. Complete the pull-request template and wait for **CI Gate**, including the **Database Migration Gate**.
5. The trusted **Staging Candidate** workflow deploys the exact CI-passed SHA to isolated staging and reports **Staging Gate**.
6. Review the deployed staging candidate and perform relevant manual hotel-workflow verification.
7. Intentionally merge the approved PR into `main` in GitHub. This workflow never auto-merges. `main` is now *release-eligible*, not yet deployed.
8. Separately and deliberately, dispatch **Production Release** (`.github/workflows/production-release.yml`) and have the `production` Environment's required reviewer approve it. See "Production Release" below — it is the only path code reaches production; merging to `main` alone never deploys it. If the change introduced a new feature flag (see [FEATURE_FLAGS.md](FEATURE_FLAGS.md)), it is deployed **disabled** for every tenant.
9. Separately and deliberately, run **Feature Rollout** to enable the flag for a pilot tenant, verify, then expand. See [FEATURE_FLAGS.md](FEATURE_FLAGS.md).

The resulting path is:

`main` → feature branch → PR → CI Gate → Staging Candidate → Staging Gate → human QA → human merge → `main` (release-eligible) → **Production Release** (approved, DB → API → web → verify → tag/Release) → Feature Rollout (pilot → cohort → full)

The existing Deploy Health Check workflow (`deploy-check.yml`) continues to run independently on a schedule and on every push to `main`, as ongoing drift/regression monitoring — it is not the production deploy mechanism and does not gate releases.

Direct pushes to `main` are prohibited in normal operation. The local pre-push hook blocks direct updates, including refspecs such as `git push origin HEAD:main`, but hooks can be bypassed. GitHub ruleset enforcement is the authoritative control.

## Protected production branches

`npm run ship` and `.githooks/pre-push` protect `main` and `master` by default. To add another production branch locally, set `PROTECTED_PRODUCTION_BRANCHES` to a comma-separated list, for example:

```bash
PROTECTED_PRODUCTION_BRANCHES=main,master,production npm run ship
```

`SHIP_PR_BASE` may be set only when a feature branch intentionally targets a non-default PR base; it defaults to `main`.

## CI Gate

**CI Gate** is the single stable required check. It succeeds only if every job below concludes `success`; a failure, cancellation, or skip causes the gate to fail.

- `Lint / API`
- `Lint + Type-check / Web`
- `Build / Web`
- `Test / Web public smoke`
- `Test / API`
- `Database Migration Gate` (clean isolated Supabase rebuild, schema contracts, and focused API/database compatibility)
- `Test / Web unit`
- `Feature Flag Registry Gate` (backend/frontend feature-key registries agree; see [FEATURE_FLAGS.md](FEATURE_FLAGS.md))
- `Frozen-File Guard`
- `Dark-Mode Contrast Gate`
- `EN/ES i18n Parity`
- `Room-Board Pixel-Diff Regression`

`Security Scan` remains advisory in this phase. Its dependency-audit steps deliberately use `continue-on-error`, so including it in a required aggregate gate would make the gate’s security meaning misleading. Review its findings and decide on a separate security-policy change before making it blocking.

## GitHub main branch ruleset

The repository owner should enable the repository ruleset targeting `main` with these settings:

- Enforcement: **Active**; do not grant direct-push or ruleset-bypass actors for ordinary development.
- Target branches: include `main`.
- Require a pull request before merging. Do not require an arbitrary second approval for this solo-developer + AI-agent workflow; require the intentional PR merge itself.
- Require status checks to pass and require the branch to be up to date before merging where GitHub offers the option.
- Required status checks: **`CI Gate`** (from `CI`) and **`Staging Gate`** (from `Staging Candidate`).
- Require all conversations to be resolved before merging.
- Block force pushes.
- Block branch deletion.

This repository currently has a disabled `main` ruleset with obsolete required-status contexts. Enable it and replace those contexts with `CI Gate` and `Staging Gate` only after confirming the settings in GitHub’s ruleset UI/API. Fork PRs intentionally do not receive `Staging Gate`; maintainers should review and, if needed, recreate approved fork work on a same-repository branch before staging verification.

## Staging Candidate and Staging Gate

`.github/workflows/staging-candidate.yml` starts from a completed `CI` `workflow_run` (or controlled manual dispatch by open PR number). It verifies the PR is open, targets `main`, remains at the CI-passed SHA, is from this repository rather than a fork, and still has a successful `CI Gate`. The workflow definition is therefore trusted from the default branch; fork code never receives staging secrets.

Candidates are globally serialized with `staging-release-candidate` and are never cancelled mid-deploy. A stale SHA is skipped before any staging mutation. For an eligible candidate, the workflow creates a pending **Staging Gate** check, checks out that full SHA in every job, resets the disposable staging database from that candidate’s migrations, seeds only synthetic fixture data, deploys API then web through the staging Railway services, and verifies API/web/database SHA identity before and after the focused Playwright suite.

Failed candidates update the same PR comment and fail `Staging Gate`; artifacts are retained for 10 days. Push a new commit to rerun CI → staging. Manual dispatch accepts only an existing PR number—not arbitrary service IDs, URLs, database references, or commits.

Concurrency behavior is intentional: PRs #100 and #101 cannot reset/deploy shared staging concurrently; a queued SHA superseded by a newer PR push is skipped during fresh PR/SHA validation; an API-success/web-failure leaves `Staging Gate` failed and production untouched; mismatched web/API release metadata fails before functional smoke; an accidental production database URL is blocked before reset; fork PRs receive unprivileged CI only; and a rejected migration candidate is removed by the next candidate’s full disposable database rebuild.

## Emergency changes

Prefer the same controlled path for emergencies:

`fix/<name>` → PR → CI Gate → intentional merge → production health check.

An emergency does not create a routine bypass for review, CI, or deployment verification. If a temporary ruleset exception is ever unavoidable, make it an explicit, time-bounded repository-owner decision, record why it was needed, and restore enforcement immediately after the incident.

## Database release path

For any database change: create a new migration → run `npm run db:check` and clean reconstruction → pass the Database Migration Gate → merge to `main` → manually run **Staging Database Migrate** → verify staging `/ready` and drift `CLEAN` → make an intentional approved production release → run production drift/readiness verification.

Do not edit an applied migration, use a PR to mutate production, or treat a raw migration count as drift verification. See [DATABASE_MIGRATIONS.md](DATABASE_MIGRATIONS.md) for immutable-history, destructive-review, emergency, and expand/migrate/contract rules.

## Feature Rollout (post-deploy)

Merging to `main` and deploying to production never enables a feature flag — **deploy and release are separate actions.** A newly deployed flag defaults to OFF for every tenant until someone deliberately runs `.github/workflows/feature-rollout.yml` to enable it for a specific tenant slug, in a specific environment (`staging` or `production`). This is the only way a flag's value changes; there is no GM-facing toggle.

Rollout is admin-only (the `production` GitHub Environment requires reviewer approval), audited (every change is recorded in `feature_flag_events`), and reversible without a redeploy (disabling a flag is the same workflow run with `enabled: false`). See [FEATURE_FLAGS.md](FEATURE_FLAGS.md) for the full system, the standard new-feature lifecycle, and the kill-switch procedure.

## Production Release (Phase 6)

Merging a PR into `main` makes code *eligible* for production. It does not deploy it. `main`'s two production Railway services (`noble-cooperation` API, `PatelRep` web) are pinned to a fixed commit SHA — a plain push to `main` does not trigger a production deploy. The only way code reaches production is an intentional run of `.github/workflows/production-release.yml`, which a human dispatches (optionally pinning an explicit `release_sha`; it defaults to the current `main` tip) and the `production` GitHub Environment's required reviewer approves.

The full path is now:

`main` → **Production Release** workflow dispatched → eligibility + staging-identity verification → release content summary → production DB pre-flight → production migration (if pending) → API deploy → API health/readiness (hard gate) → web deploy → Web/API release-identity + deployment-drift verification → annotated tag + GitHub Release → (separately) **Feature Rollout** for any new flag

### Eligibility (never skipped)

Before touching production, the workflow refuses to proceed unless the target commit:

1. Is reachable from `main` (an explicit `release_sha` input must be an ancestor of `main`'s current tip — never an arbitrary branch, fork commit, or unrelated SHA).
2. Has a successful `CI Gate` check.
3. Has a merged PR associated with it (works across squash merges, which change the commit SHA) whose **pre-merge head commit** has a successful `Staging Gate` check.
4. Has a git **tree** identical to that staging-verified PR head's tree — proven via the GitHub API, not assumed from commit-SHA equality. This is what actually proves "the code being released is the code that passed staging," since a squash merge changes the commit SHA even when the file tree is unchanged.

If the operator starts a release for one SHA and `main` advances before approval, the workflow releases the explicitly resolved SHA chosen at start — it never silently re-resolves "latest main" mid-run.

### Database, API, Web ordering

For a compatible (expand-only) release: production DB drift pre-flight → apply pending migrations (only if any exist) → schema-contract verification → API deploy → hard-failing API health/readiness poll at the exact expected `release_sha`/`release_version` → web deploy → Web/API identity + deployment-drift verification. API always deploys before web. A destructive/CONTRACT migration still requires the `-- migration-safety: destructive-reviewed` marker from [DATABASE_MIGRATIONS.md](DATABASE_MIGRATIONS.md) — this workflow adds no new destructive-migration capability, only gates what already exists. Unknown drift on production (migrations present remotely but absent from the repository) stops the release before anything is touched; it is never auto-repaired.

### Release identity and versioning

Production releases use `vX.Y.Z` SemVer, continuing the existing tag sequence (the next production release is `v1.8.0`, the first produced by this workflow). **This is a different thing from the pre-existing `v1.0`–`v1.7` tags**, which are historical GSD milestone labels (e.g. "complete v1.7 milestone") created before this release pipeline existed and unrelated to any specific deployed artifact — do not treat them as prior production releases. The workflow's version-matching pattern (`v[0-9]*.[0-9]*.[0-9]*`, three numeric segments) deliberately does not match the two-segment milestone tags, so "previous release" detection starts clean at `v1.8.0`.

`/health` and `/ready` report `release_sha` and `release_version`; the web bundle carries the same two values in `<meta name="patelrep-release-sha">` / `<meta name="patelrep-release-version">`. `scripts/public-smoke.mjs` verifies API and web report the exact same values the workflow expects before any tag is created — a 200 response from both is not sufficient proof of a correct release.

A tag and GitHub Release are created **only after** every verification step above succeeds. A failed release leaves no tag, however far it got.

### Rollback

`.github/workflows/production-rollback.yml` redeploys a previously tagged, previously *successfully released* version (an existing `vX.Y.Z` tag with a real GitHub Release — never a branch, raw SHA, or arbitrary ref). It shares a GitHub Actions concurrency group with the release workflow so the two can never mutate production at the same time. It never reverses a database migration and never executes a migration's `-- ROLLBACK` comment; those are guidance for a human, not executable authorization. See [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) for the full recovery procedure, including when a feature-flag kill switch is the right first move instead of a full rollback.
