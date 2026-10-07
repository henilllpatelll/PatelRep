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

### Release stabilization and incident classification (Phase 3B)

`.github/workflows/production-release-stabilization.yml` runs only after a completed **Production Release**.
It is deliberately read-only: `contents: read` + `actions: read`, no `production` Environment, no production
secrets, no App token and no dispatch/deploy/migrate/tag/rollback capability. It checks out trusted `main`
control-plane code, verifies the exact source run and Phase 3A evidence artifact, and refuses malformed or
cross-repository provenance.

A failed release is a **partial release incident** only when final production verification did not succeed and
the evidence proves or cannot exclude a production mutation (migration applied/attempted, API deploy
applied/attempted, or Web deploy applied/attempted). A failure before any production mutation is recorded as
`pre_production_failure_no_incident`. If exact final production verification passed and only tag/GitHub Release
bookkeeping later failed, it is `release_record_failure_no_runtime_incident` rather than a rollback signal.

A successfully released version receives a short release-specific stabilization window against the public
production endpoints using the same strict exact-release smoke contract as Production Release. The policy waits
30 seconds, then performs up to three probes 60 seconds apart. **Two consecutive failures** are required to
confirm `post_release_regression`; a single or non-consecutive failure is `transient_unconfirmed` and does not
create an incident.

Every run retains a sanitized `production-release-stabilization/context.json` result for 90 days. Confirmed
partial-release or post-release-regression incidents additionally emit
`production-release-incident/context.json`. These artifacts contain categorical identifiers/states only; remote
probe error text is left in human-readable Actions logs and is never put in the trusted handoff.

Phase 3B still **does not dispatch Production Rollback**. It only proves and classifies incident state for a later
separately reviewed Phase 3 decision/request layer.

### Trusted automatic rollback decision/request (Phase 3C)

Phase 3C adds a **request layer only**. `.github/workflows/production-auto-rollback-request.yml` listens for a
successful `Production Release Stabilization` run, reads the trusted Phase 3B incident artifact, and decides
whether a rollback request is safe enough to consider. It has two separated jobs: a read-only resolver and a
request job that revalidates everything before it can create the PatelRep App token. That App token is scoped to
`actions: write` only and may only dispatch the existing `Production Rollback` workflow.

The owner-controlled activation switch is `PRODUCTION_AUTO_ROLLBACK_ENABLED=true`. No workflow creates or
changes it. Eligibility is deliberately narrow and fail-closed: the incident must still be current, the live
runtime must still be the exact failing SHA/version, a fresh strict production smoke must still fail, the
candidate PR must be low-risk under the existing Phase 2C classifier, the previous completed release/tag must be
exact and reachable, there must be no active Production Release/Rollback, and the failing release's database
mutation state must be **exactly `no_change`**. `verified_applied`, `unknown_after_attempt`, or
`not_proven` are all human-only.

Phase 3C independently re-reads the original Production Release evidence and cross-checks it against the Phase 3B
incident; the incident artifact alone is not treated as sufficient authority. Partial-release incidents are only
eligible when Web/API public identity can still prove the exact failing candidate. Ambiguous partial identity is
human-only.

Before dispatching, the policy reads the trusted `production-rollback.yml` from the exact current
control-plane SHA and requires the Phase 3D rollback-side contract: an `automation_source_run_id` input,
automation-aware run identity, and a call to `scripts/production-auto-rollback-request.mjs rollback` before
production access. If that contract is ever removed or weakened, Phase 3C immediately becomes inert again.

### Hardened automated rollback execution & circuit breaker (Phase 3D)

`.github/workflows/production-rollback.yml` keeps its manual `target_version` dispatch and adds one optional
`automation_source_run_id`. Blank means the original manual behavior. Non-blank means automated mode and is
accepted only after a new **unprivileged** `verify-automation-provenance` job checks out the exact workflow SHA
and runs `production-auto-rollback-request.mjs rollback`. That is the third independent evaluation of the same
Phase 3C policy (resolve → request → rollback). The production jobs depend on this preflight, so an automated run
cannot reach the `production` Environment, Supabase, or Railway before fresh provenance revalidation succeeds.

Automated database compatibility is stricter than manual rollback. Phase 3C already requires the failed release's
database state to be exactly `no_change`; Phase 3D then requires the previous release checkout's production drift
result to be exactly `Status: CLEAN`. Any missing, unknown, pending, or otherwise ambiguous migration state fails
the automated rollback. Manual rollback keeps the existing operator-reviewed compatibility behavior. Neither mode
runs a reverse migration, changes migration history, or uses `supabase migration repair`.

The deployment path itself is unchanged: resolve exact completed previous Release/tag → database compatibility →
API repo-root Railway upload → exact API health/readiness identity → Web `apps/web --path-as-root` → exact
Web/API public smoke + deployment-drift verification. API must still verify before Web starts. Rollback still
creates **no tag and no GitHub Release**.

After a successful automated rollback, a separate read-only circuit-breaker job proves the automatic loop is
quarantined. For `post_release_regression`, live runtime must now equal the previous release while the newest
managed GitHub Release remains the failed candidate; the existing Phase 2D release-request policy therefore sees
runtime != managed baseline and refuses automatic promotion. For `partial_release_failure`, the failed candidate
must still have no completed GitHub Release and runtime must be restored to the prior/current managed baseline;
the original incident cannot be replayed through Phase 2D because that path only accepts Deploy Health recovery
roots. Failure to prove either quarantine state makes the rollback workflow fail after restoration so a human must
decide how to re-enter the release line.

### Production rollback evidence ledger (Phase 4A)

Every `Production Rollback` run now carries its own sanitized evidence trail. Before target resolution, a
read-only public-runtime capture records the exact Web/API release identity when it can be proven; an unreachable,
legacy, malformed, or contradictory runtime is recorded only as `unproven` and no endpoint error text enters the
artifact. This capture has no `production` Environment and no production credentials.

After the entire rollback graph finishes, `production-rollback-evidence` runs with `if: always()` and writes
`production-rollback-evidence/context.json` (90-day retention). The ledger records the rollback run id/attempt and
control-plane SHA, manual vs automated source, sanitized request validity, before-runtime identity state, exact
resolved target tag/SHA, every rollback job result, fail-closed API/Web mutation states, final verified target
identity when rollback smoke passed, and the automated circuit-breaker result when applicable.

The ledger is evidence-only: `contents: read`, no `production` Environment, no production secrets, no Railway
or Supabase command, no workflow dispatch and no tag/Release mutation. Database state is recorded as
`not_mutated_by_workflow` because Production Rollback performs compatibility reads only and never reverses or
repairs migration history. Failed/cancelled deploy attempts remain `unknown_after_attempt`; they are never
guessed safe.

### Incident closeout and production re-entry gate (Phase 4B)

A verified automated rollback intentionally places the release line in **quarantine**. Phase 4B turns that
quarantine into an explicit production-release gate rather than relying only on convention. The new
`.github/workflows/production-incident-reentry.yml` is manually dispatched and read-only: it has no
`production` Environment, no production secrets, no deployment/database authority, and cannot dispatch a release
or rollback.

To authorize re-entry, the operator supplies the exact **Production Rollback run id**, the exact current
`main` SHA, and the intended version bump. Trusted code independently re-reads the Phase 4A rollback evidence,
re-runs the Phase 3D quarantine proof, requires no active production operation, refuses the original failed
candidate SHA, requires the new SHA to descend from that failed candidate, and proves its `CI Gate`, staged PR
`Staging Gate`, and merged/staged tree identity. The resulting
`production-incident-reentry/context.json` artifact authorizes only that one SHA + bump.

`Production Release` now starts with an **unprivileged** `verify-production-reentry` job before any
`production` Environment access. With no unresolved automated rollback, normal manual and eligible Phase 2D
release behavior is unchanged. With an unresolved rollback, automatic release requests are refused; a human must
use an exact `release_sha` plus the successful `reentry_source_run_id`, and the policy revalidates the live
quarantine and exact authorization. If `main` moved, the rollback/incident changed, or any provenance is stale,
the release fails before production access.

A successful re-entry deployment does **not** immediately close the incident. Production Release evidence records
the authorization run id and rollback run id, and Production Release Stabilization must finish without a confirmed
new incident. Only `stable` or `transient_unconfirmed` stabilization emits
`production-incident-closeout/context.json`. Until that closeout exists, the old rollback remains open and any
next release still requires explicit re-entry authorization. A new `post_release_regression` emits no closeout
and can enter the normal Phase 3 rollback path again.

Both post-release-regression rollback (runtime behind the newest managed Release) and partial-release rollback
(runtime restored to the still-current managed baseline) are covered; the latter is why runtime-vs-Release
comparison alone is not sufficient. Trusted incident artifacts retain for 90 days; if required provenance has
expired before closeout, re-entry fails closed for human investigation rather than inferring that the incident was
resolved.

### Production release & incident notifications (Phase 4C)

Phase 4C adds a GitHub-native notification layer with **no production authority**. The
`.github/workflows/production-operations-notify.yml` workflow listens only for completed
`Production Release Stabilization`, `Production Rollback`, and `Production Incident Re-entry` runs.

The notification path is split into two jobs. `resolve` is read-only and derives a sanitized notification
intent from trusted evidence. `publish` runs only when an alert is actually needed, checks out the exact frozen
control-plane SHA, recomputes the same intent, requires the SHA-256 digest to match, and receives only
`issues: write` in addition to read permissions. It cannot deploy, migrate, tag, release, dispatch workflows,
change repository variables/secrets, or use a production Environment.

GitHub Issues are the durable notification surface. The issue is assigned to the repository owner so an actionable
production event generates a direct GitHub notification. Lifecycle behavior is intentionally low-noise:

- normal `stable` and `transient_unconfirmed` releases create no issue;
- confirmed `post_release_regression` and `partial_release_failure` create a critical incident issue;
- non-rollback release failures/refusals create a release-attention issue;
- automatic rollback results update the original incident thread;
- successful automatic rollback explicitly says **re-entry is still required**;
- rollback failure, missing evidence, or unproven quarantine keeps the issue critical/open;
- successful re-entry authorization updates the original incident and records the exact SHA/bump to release;
- verified Phase 4B closeout closes that original incident issue;
- successful manual rollback creates a standalone notification and closes it after recording the restored target;
- failed manual rollback stays open for human investigation.

Notification reruns are idempotent. Each event has a deterministic source-run event id, and successful notification
runs retain a sanitized `production-operations-notification/context.json` artifact for 90 days. Later lifecycle
events discover the trusted prior issue number from those artifacts instead of trusting mutable issue titles or
bodies. Exact reruns are recorded as `deduplicated` without writing another comment.

### Periodic production release audit (Phase 4D)

`.github/workflows/production-release-audit.yml` is a read-only integrity audit that runs on every push to
`main`, every six hours, and by manual dispatch. It has only `contents: read` + `actions: read`, no
`production` Environment, no production secrets, no Railway/Supabase/database access, no write token, and no
workflow-dispatch authority.

The audit does **not** equate "runtime != newest Release" with failure. It recognizes three valid production
states:

- `consistent_managed_release`: live Web/API identity exactly equals the newest completed managed GitHub
  Release/tag.
- `quarantined_post_release_regression`: Phase 4A/4B prove an unresolved automatic rollback where runtime is
  intentionally on the previous known-good release while the newest managed Release remains the failed candidate.
- `quarantined_partial_release_failure`: Phase 4A/4B prove an unresolved partial-release rollback where runtime
  correctly equals the current managed baseline and the failed candidate was never completed as a managed Release.

If a Production Release or Production Rollback is active, the audit records
`deferred_active_production_operation` rather than judging transient deployment state.

The audit reuses the canonical `resolveProductionBaseline`, Phase 4B open-incident resolver, and Phase 3D
circuit-breaker proof. It also checks for strict `vX.Y.Z` tags at/above the managed baseline that do not have a
completed GitHub Release, and reports the current re-entry state as required, authorized for current `main`, or
authorization-stale-after-main-moved.

Every run uploads `production-release-audit/context.json` with schema
`patelrep.production-release-audit.v1` before an inconsistent run is failed. The artifact contains only
sanitized identifiers and categorical state. Unprovable baseline/runtime/incident/quarantine/re-entry state fails
closed with stable reason codes instead of copying remote error text.

Phase 4C now consumes Production Release Audit completions. Inconsistency updates one critical
`audit:production-integrity` GitHub Issue. A later fully proven normal/quarantined audit closes that issue if it
exists; healthy audits do not create a new issue. Deferred audits do not close a prior integrity alert because
they did not re-prove steady state.

### Synthetic end-to-end resilience drills (Phase 5A)

Phase 5A begins final production-readiness validation without adding authority. The
`.github/workflows/release-resilience-drill.yml` workflow runs synthetic-only failure scenarios every Monday
and by manual dispatch from `main`. It has only `contents: read`, no `production` Environment, no secrets,
no GitHub write token, no network/runtime access, and no deployment/database/workflow-dispatch capability.

The drill composes the same exported policy functions used by the live control plane rather than duplicating their
rules. Its current scenarios prove:

- successful release → two-failure stabilization → `post_release_regression` → eligible zero-migration
  automatic rollback → verified rollback quarantine → exact human re-entry authorization → release-time re-entry
  verification → stable closeout → healthy managed-baseline audit;
- any proven production DB migration blocks automatic rollback;
- partial-release failure restores the managed baseline while the failed candidate remains unmanaged;
- runtime/managed-Release drift with no trusted rollback is detected by Phase 4D and classified as a critical
  Phase 4C audit notification intent;
- moving `main` after re-entry authorization invalidates that authorization;
- an active Production Release/Rollback makes the audit defer instead of producing false drift.

Every drill writes `release-resilience-drill/context.json` using schema
`patelrep.release-resilience-drill.v1`. The workflow captures scenario failures, uploads the artifact, then
fails the run. A drill failure does not automatically dispatch release/rollback or grant Claude any new authority;
it is evidence that the control-plane composition needs human review/fix through the normal PR gates.

### Live read-only recovery readiness drill (Phase 5B)

Phase 5B asks a different question from the Phase 4D integrity audit: **could the trusted recovery path be used
safely right now, based only on live read-only evidence?**

`.github/workflows/production-recovery-readiness.yml` runs on `main` pushes, daily, and by manual dispatch. It
has only `contents: read` + `actions: read`, no `production` Environment, no secrets, no database/Railway
credentials, no GitHub write permission, and no workflow-dispatch/deployment authority.

The drill reuses the real Phase 4D production audit and Phase 3/4 policy helpers. When no production mutation is
active it re-proves:

- exact public Web/API runtime identity and the newest completed managed GitHub Release baseline;
- strict public production smoke at that exact SHA/version;
- the Phase 3D automated rollback execution contract from the exact trusted control-plane SHA;
- current open automated rollback/quarantine state and exact incident rollback target when one exists;
- otherwise, the immediately previous completed managed Release/tag as the recoverable rollback target;
- exact tag → commit resolution and ancestry of the rollback target on `main`.

Database rollback compatibility is intentionally recorded as
`not_exercised_read_only_no_secret`; Phase 5B does not borrow production DB credentials just to make a drill
look stronger.

The readiness state is one of:

- `ready` — current runtime/baseline is healthy and a prior managed rollback target is exactly proven;
- `ready_quarantined_post_release_regression` or `ready_quarantined_partial_release_failure` — the already
  active trusted quarantine and its exact rollback target are re-proven;
- `limited_bootstrap_no_previous_release` — production is healthy but this is still the first managed Release,
  so there is no earlier managed version the rollback workflow is allowed to target;
- `deferred_active_production_operation` or `deferred_main_moved_during_drill` — transient state was not judged;
- `failed` — one or more recovery invariants could not be proven.

Every run uploads `production-recovery-readiness/context.json` with schema
`patelrep.production-recovery-readiness.v1` before an intentional failure. The artifact contains categorical
proof state and exact trusted identifiers only.

The current v1.8.0 production baseline is expected to report
`limited_bootstrap_no_previous_release` until a later managed Release exists. That limitation is real: historical
two-segment milestone tags are deliberately not treated as production rollback targets.

### Production automation watchdog (Phase 5C)

Phase 5C adds observation and alerting only. `.github/workflows/production-automation-watchdog.yml` runs on
`main` pushes, every 15 minutes (offset from Deploy Health Check), and by manual dispatch with only
`contents: read` + `actions: read`, no `production` Environment, no secrets, and its own non-cancelling
`production-automation-watchdog` concurrency group. It executes the exact trusted `main` SHA and records it.

Policy lives in `scripts/production-automation-watchdog.mjs` (read-only GitHub access in
`production-automation-watchdog-deps.mjs`) and is deterministic: `now` is injected into the classifier. Budgets are
constants in code, not workflow inputs:

| Check | Budget | Reason |
| --- | --- | --- |
| Production Release/Rollback `in_progress` | 45 min | conservative observation threshold; Production Release has no explicit job timeout, so a hung job could otherwise run for hours |
| Production Release/Rollback queued/waiting/requested/pending | 30 min | unanswered approval or blocked queue |
| Control-plane run active (stabilization, auto-rollback request, re-entry, notify, audit, readiness) | 20 min | conservative observation threshold above every explicit timeout (10 min stabilization/auto-rollback request/re-entry; 15 min audit/readiness; none on Notify) |
| Deploy Health Check last completed run | 45 min | scheduled every 15 min |
| Production Release Audit last completed run | 7 h | scheduled every 6 h |
| Production Recovery Readiness last completed run | 26 h | scheduled daily |
| Release Resilience Drill last completed run | 8 days | scheduled weekly |

Boundaries are exclusive (exactly at the budget is still within budget). Workflow identity is the exact workflow
file path plus repository, run id, attempt and head SHA; `run.name` / display title is never read or stored.
Malformed timestamps, wrong repository/path, or unreadable GitHub state yield `unproven`, never healthy.

Run lookup is by workflow identity, not by filtered listing: the watchdog reads current workflow metadata, requires
exactly one *active* record for each monitored exact path (zero, inactive-only, or ambiguous records are `unproven`),
then reads one bounded unfiltered newest-first page per workflow id and filters locally, re-validating every run's
path, workflow id, repository, head repository, run id, attempt and SHA. GitHub's `status`/`branch` filtered listings
were observed returning stale snapshots (an older `total_count` and runs weeks old), so they are not used. Because a
stale read can only hide runs, a stale-looking heartbeat is corroborated by a created-window read before it is reported.

States: `healthy`, `active_within_budget`, `degraded`, `critical`, `unproven`. Findings use stable codes:
`production_operation_stuck`, `production_operation_waiting_too_long`, `control_plane_run_stuck`,
`deploy_health_heartbeat_stale`, `release_audit_heartbeat_stale`, `recovery_readiness_heartbeat_stale`,
`resilience_drill_heartbeat_stale`, `github_actions_state_unproven`.

Every run uploads `production-automation-watchdog/context.json` (schema `patelrep.production-automation-watchdog.v1`,
90 days) before an unhealthy run fails. `Production Operations Notify` now also listens for this workflow, selects
it by exact workflow path, strictly validates the artifact (schema, run id/attempt, control-plane SHA, finding
codes/severity), and publishes through the existing `issues: write`-only publisher on one lifecycle key,
`watchdog:production-automation`. A finding fingerprint taken from trusted prior notification artifacts suppresses
repeat comments for an unchanged condition. That history lookup is artifact-first: it lists only non-expired
`production-operations-notification` artifacts inside the 90-day retention window, independently re-fetches and
re-validates each candidate's source run (exact path, repository, event, status, conclusion, main, SHA, attempt), and
stops once the latest state and issue mapping are known, so its cost scales with published evidence rather than with
the four-times-hourly count of no-op notification runs. Issue content is never authority. Phase 4D semantics are
unchanged.

The watchdog does not cancel, rerun, dispatch, approve, merge, push, tag, or touch migration history, and it cannot
self-heal. The Phase 5A drill gains `stuck_production_operation_is_detected_without_mutation` (in-memory only).

### Production readiness certification (Phase 5D)

Phase 5D is the final, **read-only** attestation that the release/recovery control plane built in Phases 1-5C is
ready. It adds **zero production authority**: it composes evidence that already exists and never deploys, rolls
back, migrates, tags, creates a Release, approves an Environment, cancels/reruns/dispatches a workflow, merges a PR,
or repairs anything. `.github/workflows/production-readiness-certification.yml` is `workflow_dispatch` only (an
explicit, human-requested attestation; it never runs on push or a schedule), has only `contents: read` +
`actions: read`, no `production` Environment, no secrets, and its own non-cancelling
`production-readiness-certification` concurrency group. Policy is deterministic code in
`scripts/production-readiness-certification.mjs` (read-only GETs in `production-readiness-certification-deps.mjs`)
with an injected `now`.

**Current-main provenance: merge SHA vs. candidate tree.** A GitHub merge commit has a different SHA than the staged PR
head even when the resulting content is identical, so the certification does not compare SHAs. The merge commit SHA
proves *which commit main is*; exact **tree SHA equality** between current `main` and the merged PR's candidate head
proves the merged content is byte-for-byte what CI and Staging verified. The PR is resolved from GitHub's own
commit-to-PR association (never commit-message parsing) and must be the single merged, same-repository PR targeting
`main` whose `merge_commit_sha` is main. Ancestry, changed-file comparison, or "close enough" never substitute.

| Evidence | Requirement |
| --- | --- |
| Current main | equals the workflow's exact checked-out SHA at the start **and again immediately before finalizing**; a move is `unproven` / `main_moved_during_certification` |
| Candidate CI | successful `ci.yml` `pull_request` run for the exact candidate SHA, bound through the `CI Gate` check |
| Staging | `Staging Gate` check (GitHub Actions) successful for the exact PR + candidate SHA with all four stages green, **and** a refetched successful `staging-candidate.yml` run whose `staging-candidate-context` names the exact PR, candidate SHA, branch and CI run id |
| Current-main CI | successful `ci.yml` `push` run on `main` for the exact SHA, `CI Gate` green |
| Deploy Health | successful `deploy-check.yml` run on main for the exact SHA, <= 45 min old, API health / Web health / Deployment API-URL drift check / Public smoke verification jobs all green |
| Production Release Audit | `consistent_managed_release`, no active operation, no open incident or quarantine, no unmanaged strict tag, re-entry `not_required`, runtime == managed Release; <= 7 h |
| Production Recovery Readiness | only `ready` or `limited_bootstrap_no_previous_release`; <= 26 h; see below |
| Release Resilience Drill | exactly the seven expected scenarios, in order, all passed, `synthetic_only`, `authority_added == false`; <= 8 days |
| Production Automation Watchdog | exactly `healthy`, severity `none`, zero findings, zero active operations; <= 30 min |

Every evidence run is refetched and validated by exact workflow **file path**, repository/head repository, `main`,
the exact certification SHA and completed/success; embedded run id/attempt/SHA must match the source run (the drill
artifact embeds no run block, so it is bound through its source run alone). Display names, `run.name`, and Issue
contents are never authority. Artifact evidence is looked up artifact-first (one bounded, name-filtered page, at most
10 same-SHA candidates, newest completed run wins), never by enumerating history; a run still in progress is skipped,
but a newer completed *failure* is not hidden. Run-only evidence (Deploy Health) uses the workflow id resolved from the
exact path and one unfiltered newest-first page, because GitHub's status/branch filtered listings were observed
returning stale snapshots.

**States.** `certified` (no limitations), `certified_with_limitations`, `not_certified` (evidence is known-bad: stale,
failed, inconsistent, wrong state), `unproven` (evidence is missing, malformed, mismatched, or unreadable; main moved).
Only the first two succeed the workflow. The `production-readiness-certification/context.json` artifact (schema
`patelrep.production-readiness-certification.v1`, 90 days) is uploaded **before** a non-certified result fails the
run, carries a stable `reason_code`, and contains no URLs, remote error bodies, secrets, or Issue content. Final
certification is a **quiescent-system** attestation: `active_within_budget` watchdogs, deferred readiness states,
quarantine states, and an active production operation are never certifiable even though they are healthy for
monitoring.

**Bootstrap limitation.** While only one managed Release exists, recovery readiness truthfully reports
`limited_bootstrap_no_previous_release` with limitation `no_previous_managed_release`. The certification maps that to
`certified_with_limitations` and records the limitation; it is neither failure nor hidden. Do **not** cut a second
production release merely to remove it: it disappears when a real previous managed Release exists. The readiness
limitation list must be *exactly* that one entry; any other limitation is `not_certified`.
`staging-candidate-context` is retained only 3 days; if the Staging Gate check is older than that and the artifact has
expired, staging is bound by the gate check alone and the additional limitation `staging_context_artifact_expired` is
declared. Before that window an absent or mismatched context fails closed.

**Control-plane SHA is not the production runtime SHA.** Certification explicitly separates the current `main`
(control-plane) SHA from the managed production Release SHA. Production may legitimately remain on `v1.8.0` while
release-engineering code on main is newer; the runtime SHA is required to equal the managed Release, never main.

**What certification does NOT prove:** production database compatibility with the next release (readiness
is `not_exercised_read_only_no_secret`), that a rollback would succeed (only that the execution contract and, when one
exists, a rollback target are proven), the correctness of application behavior, or anything about a later main
commit. It never authorizes deployment, rollback, re-entry, or any production action.

**Re-certifying.** Any new `main` commit invalidates the certification. After it lands, let push-triggered CI, Deploy
Health, Production Release Audit, Production Recovery Readiness and the Watchdog finish on the new main, manually run
`Release Resilience Drill` on it (it is not push-triggered), require 7/7, then dispatch `Production Readiness
Certification` on `main`. Re-dispatch if it reports a stale heartbeat (> 45 min Deploy Health, > 30 min Watchdog).

### Automated release requests (Phase 2D)

**Automatic request ≠ automatic production approval.** For one narrow case the Claude Release Engineer may *request* a release: a low-risk Phase 2C recovery PR that repaired a failed `Deploy Health Check` of the exact current production baseline, merged as the only commit after the last release. The `Claude Release Engineer Production Request` workflow then dispatches this workflow with `version_bump=patch` and `automation_source_run_id=<auto-merge run id>`. The `production` Environment has no Required Reviewer, so there is no manual approval pause; the workflow re-verifies the whole provenance (trusted dispatcher, exact merge commit still `main`, baseline unchanged, failed Deploy Health root, low-risk files, rulesets, activation switch) before touching production. If anything changed, the release fails with production untouched. Manual dispatches leave `automation_source_run_id` blank and are unchanged.

The feature is inert until the repository owner manually sets the repository variable `PRODUCTION_AUTO_RELEASE_ENABLED=true` — only after Phase 2D is merged, the first managed release (`v1.8.0`) was completed manually, and understood that, with no Environment approval pause, enabling it lets an eligible recovery merge proceed to production without a human click. No workflow ever sets or changes it. Everything else — feature merges, unreleased work on `main`, database/billing/auth/infrastructure/control-plane changes, CI/Staging/Production-Release/Evidence-Audit recovery, and production incidents that do not satisfy the narrow Phase 3C/3D rollback policy — stays a manual release decision. Full contract: [AUTONOMOUS_RELEASE_ENGINEER.md](AUTONOMOUS_RELEASE_ENGINEER.md).

### Rollback

`.github/workflows/production-rollback.yml` redeploys a previously tagged, previously *successfully released* version (an existing `vX.Y.Z` tag with a real GitHub Release — never a branch, raw SHA, or arbitrary ref). It shares a GitHub Actions concurrency group with the release workflow so the two can never mutate production at the same time. It never reverses a database migration and never executes a migration's `-- ROLLBACK` comment; those are guidance for a human, not executable authorization. See [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) for the full recovery procedure, including when a feature-flag kill switch is the right first move instead of a full rollback.
