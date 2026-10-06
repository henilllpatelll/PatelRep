# PatelRep release process

PatelRep production is driven by `main`. Treat `main` as a release branch, not a normal development branch.

This pipeline (CI Gate + Staging Gate required on `main`) was verified end-to-end on 2026-10-01.

## Normal workflow

1. Start from current `main`, then intentionally create a feature branch: `git checkout -b feat/<name>`.
2. Implement and verify the scoped change.
3. Run `npm run ship` from the feature branch to stage, commit, push, and create a pull request. The command refuses to operate on protected production branches.
4. Complete the pull-request template and wait for **CI Gate**, including the **Database Migration Gate**.
5. The trusted **Staging Candidate** workflow deploys the exact CI-passed SHA to isolated staging and reports **Staging Gate**.
6. Review the deployed staging candidate and perform relevant manual hotel-workflow verification.
7. Intentionally merge the approved PR into `main` in GitHub. This workflow never auto-merges. `main` is now *release-eligible*, not yet deployed.
8. Separately and deliberately, dispatch **Production Release** (`.github/workflows/production-release.yml`). The `production` Environment scopes production secrets and variables but has no Required Reviewer: there is no manual "Approve and deploy" click, and the workflow's own trusted gates decide eligibility and fail closed. See "Production Release" below — it is the only path code reaches production; merging to `main` alone never deploys it. If the change introduced a new feature flag (see [FEATURE_FLAGS.md](FEATURE_FLAGS.md)), it is deployed **disabled** for every tenant.
9. Separately and deliberately, run **Feature Rollout** to enable the flag for a pilot tenant, verify, then expand. See [FEATURE_FLAGS.md](FEATURE_FLAGS.md).

The resulting path is:

`main` → feature branch → PR → CI Gate → Staging Candidate → Staging Gate → human QA → human merge → `main` (release-eligible) → **Production Release** (gated by the workflow's trusted checks, DB → API → web → verify → tag/Release) → Feature Rollout (pilot → cohort → full)

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

This ruleset is active with `CI Gate` and `Staging Gate` as its only required status contexts (Phase 6). Fork PRs intentionally do not receive `Staging Gate`; maintainers should review and, if needed, recreate approved fork work on a same-repository branch before staging verification.

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

For any database change: create a new migration → run `npm run db:check` and clean reconstruction → pass the Database Migration Gate → merge to `main` → manually run **Staging Database Migrate** → verify staging `/ready` and drift `CLEAN` → make an intentional production release → run production drift/readiness verification.

Do not edit an applied migration, use a PR to mutate production, or treat a raw migration count as drift verification. See [DATABASE_MIGRATIONS.md](DATABASE_MIGRATIONS.md) for immutable-history, destructive-review, emergency, and expand/migrate/contract rules.

## Feature Rollout (post-deploy)

Merging to `main` and deploying to production never enables a feature flag — **deploy and release are separate actions.** A newly deployed flag defaults to OFF for every tenant until someone deliberately runs `.github/workflows/feature-rollout.yml` to enable it for a specific tenant slug, in a specific environment (`staging` or `production`). This is the only way a flag's value changes; there is no GM-facing toggle.

Rollout is admin-only (dispatching requires repo write access; the `production` GitHub Environment scopes secrets and has no Required Reviewer), audited (every change is recorded in `feature_flag_events`), and reversible without a redeploy (disabling a flag is the same workflow run with `enabled: false`). See [FEATURE_FLAGS.md](FEATURE_FLAGS.md) for the full system, the standard new-feature lifecycle, and the kill-switch procedure.

## Production Release (Phase 6)

Merging a PR into `main` makes code *eligible* for production. It does not deploy it. `main`'s two production Railway services (`noble-cooperation` API, `PatelRep` web) are pinned to a fixed commit SHA — a plain push to `main` does not trigger a production deploy. The only way code reaches production is an intentional run of `.github/workflows/production-release.yml`, which a human dispatches (optionally pinning an explicit `release_sha`; it defaults to the current `main` tip) and which then proceeds without a separate Environment approval, failing closed on any trusted-gate refusal.

The full path is now:

`main` → **Production Release** workflow dispatched → eligibility + staging-identity verification → release content summary → production DB pre-flight → production migration (if pending) → API deploy → API health/readiness (hard gate) → web deploy → Web/API release-identity + deployment-drift verification → annotated tag + GitHub Release → (separately) **Feature Rollout** for any new flag

### Eligibility (never skipped)

Before touching production, the workflow refuses to proceed unless the target commit:

1. Is reachable from `main` (an explicit `release_sha` input must be an ancestor of `main`'s current tip — never an arbitrary branch, fork commit, or unrelated SHA).
2. Has a successful `CI Gate` check.
3. Has a merged PR associated with it (works across squash merges, which change the commit SHA) whose **pre-merge head commit** has a successful `Staging Gate` check.
4. Has a git **tree** identical to that staging-verified PR head's tree — proven via the GitHub API, not assumed from commit-SHA equality. This is what actually proves "the code being released is the code that passed staging," since a squash merge changes the commit SHA even when the file tree is unchanged.

If the operator starts a release for one SHA and `main` advances before the run starts, the workflow releases the explicitly resolved SHA chosen at start — it never silently re-resolves "latest main" mid-run.

### Database, API, Web ordering

For a compatible (expand-only) release: production DB drift pre-flight → apply pending migrations (only if any exist) → schema-contract verification → API deploy → hard-failing API health/readiness poll at the exact expected `release_sha`/`release_version` → web deploy → Web/API identity + deployment-drift verification. API always deploys before web. A destructive/CONTRACT migration still requires the `-- migration-safety: destructive-reviewed` marker from [DATABASE_MIGRATIONS.md](DATABASE_MIGRATIONS.md) — this workflow adds no new destructive-migration capability, only gates what already exists. Unknown drift on production (migrations present remotely but absent from the repository) stops the release before anything is touched; it is never auto-repaired.

### Release identity and versioning

Production releases use `vX.Y.Z` SemVer. **The first production release is `v1.8.0`**, a deliberate one-time bootstrap: with no completed production GitHub Release the next version is `v1.8.0` whatever the bump input. **This is a different thing from the pre-existing `v1.0`–`v1.7` tags**, which are historical GSD milestone labels (e.g. "complete v1.7 milestone") created before this release pipeline existed and unrelated to any specific deployed artifact — they are never read as `v1.7.0` or as prior production releases.

The previous version is derived by `scripts/release-version.mjs` from **completed GitHub Releases** (not draft, not prerelease, tag exactly three numeric segments), not from arbitrary tags. After a real release: patch `v1.8.0` → `v1.8.1`, minor `v1.8.1` → `v1.9.0`, major `v1.9.0` → `v2.0.0`. If the computed tag — or any three-segment tag at or above it — already exists without a completed GitHub Release (an orphan tag, or a draft/prerelease with that tag), the workflow **fails closed**: it never skips a version and never deletes or rewrites tags. A human must investigate (why was the tag created without a Release? was a release interrupted?) and resolve it deliberately before releasing again.

`/health` and `/ready` report `release_sha` and `release_version`; the web bundle carries the same two values in `<meta name="patelrep-release-sha">` / `<meta name="patelrep-release-version">`. `scripts/public-smoke.mjs` verifies API and web report the exact same values the workflow expects before any tag is created — a 200 response from both is not sufficient proof of a correct release.

A tag and GitHub Release are created **only after** every verification step above succeeds. A failed release leaves no tag, however far it got.

### Production release evidence ledger (Phase 3A)

Every `Production Release` run now ends with a separate **Production release evidence ledger** job. It runs with
`if: always()` only so failures and partial releases still leave evidence; it has **no `production` Environment,
no production secrets, and no deployment or rollback authority**. It checks out the workflow's exact control-plane
SHA and writes one sanitized `production-release-evidence/context.json` artifact (90-day retention).

The evidence records identifiers and GitHub job outcomes only: release run id/attempt and control-plane SHA,
manual vs automated-request source, candidate SHA/PR/version when known, the previous completed managed release
tag **and the commit that tag resolves to**, whether database preflight found pending migrations, every release-job
result, final verification state, and a conservative mutation classification.

Mutation state is deliberately fail-closed. A skipped deploy means `not_started`; a successful deploy means
`deployed_and_verified`; a failed or cancelled deploy is `unknown_after_attempt`, because the job may have
changed Railway before failing. Likewise, a successful migration job is `verified_applied`, a clean preflight
with no pending migration is `no_change`, and a failed/cancelled migration attempt is
`unknown_after_attempt`—never inferred to mean "nothing changed." Phase 3A **does not consume this artifact to
roll back anything**; it only establishes trustworthy evidence for later Phase 3 incident-containment work.

### Automated release requests (Phase 2D)

**Automatic request ≠ automatic production approval.** For one narrow case the Claude Release Engineer may *request* a release: a low-risk Phase 2C recovery PR that repaired a failed `Deploy Health Check` of the exact current production baseline, merged as the only commit after the last release. The `Claude Release Engineer Production Request` workflow then dispatches this workflow with `version_bump=patch` and `automation_source_run_id=<auto-merge run id>`. The `production` Environment has no Required Reviewer, so there is no manual approval pause; the workflow re-verifies the whole provenance (trusted dispatcher, exact merge commit still `main`, baseline unchanged, failed Deploy Health root, low-risk files, rulesets, activation switch) before touching production. If anything changed, the release fails with production untouched. Manual dispatches leave `automation_source_run_id` blank and are unchanged.

The feature is inert until the repository owner manually sets the repository variable `PRODUCTION_AUTO_RELEASE_ENABLED=true` — only after Phase 2D is merged, the first managed release (`v1.8.0`) was completed manually, and understood that, with no Environment approval pause, enabling it lets an eligible recovery merge proceed to production without a human click. No workflow ever sets or changes it. Everything else — feature merges, unreleased work on `main`, database/billing/auth/infrastructure/control-plane changes, CI/Staging/Production-Release/Evidence-Audit recovery, and any retry after a failed or partial production release — stays a manual release decision. Rollback is never automated. Full contract: [AUTONOMOUS_RELEASE_ENGINEER.md](AUTONOMOUS_RELEASE_ENGINEER.md).

### Rollback

`.github/workflows/production-rollback.yml` redeploys a previously tagged, previously *successfully released* version (an existing `vX.Y.Z` tag with a real GitHub Release — never a branch, raw SHA, or arbitrary ref). It shares a GitHub Actions concurrency group with the release workflow so the two can never mutate production at the same time. It never reverses a database migration and never executes a migration's `-- ROLLBACK` comment; those are guidance for a human, not executable authorization. See [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) for the full recovery procedure, including when a feature-flag kill switch is the right first move instead of a full rollback.
