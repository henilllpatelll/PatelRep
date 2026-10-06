# Autonomous Release Engineer

Operating contract for the Claude agent run by `.github/workflows/claude-release-engineer.yml`.
`CLAUDE.md` remains the canonical project context; read it first, then this document.

**Current scope (Phase 5A):** diagnose failed workflows and publish repair PRs with a bounded
recovery lineage (at most 3 automatic Claude attempts per recovery root), safely auto-merge a
narrow class of those PRs after CI and Staging pass (see "Safe autonomous merge (Phase 2C)"), and
for one narrower case further REQUEST a production release (see "Controlled production release
request (Phase 2D)"). Claude itself never merges and never dispatches anything; the Phase 2D request
workflow can only dispatch the existing Production Release, which independently re-verifies provenance and
fails closed (there is no separate human Environment approval step).

## Separated authority

| Job | Holds | Does |
| --- | --- | --- |
| `resolve` | read-only workflow token | Runs the trusted resolver (checked out from `main`) to decide the exact failing code, recovery root and attempt number. |
| `repair` | read-only workflow token + Claude OAuth token | Claude diagnoses, edits and tests locally. It cannot `git push`, commit, create/edit/merge PRs, or dispatch workflows. A trusted step proves `HEAD` is still the repair SHA and hands over a net patch. |
| `publish` | the PatelRep GitHub App token (the only holder) | `scripts/publish-release-engineer-repair.mjs` (from `main`) creates exactly one commit per attempt, stamps the lineage trailers, pushes normally (never force) and creates or updates exactly one PR. |

## Trigger model

- Automatic: only when `CI`, `Staging Candidate`, `Production Migration Evidence Audit`,
  `Production Release`, or `Deploy Health Check` completes with conclusion `failure`, on a
  same-repository head. Successful runs and fork runs do not start the agent.
- Manual: `workflow_dispatch` with an optional failed run id and instructions. Manual runs may
  continue past the automatic attempt cap, are marked manual in the PR, and use the same trusted
  publishing; they never force push, push `main`, merge, or hold production credentials.
- Repair and publish are serialized by the **resolved recovery root**
  (`claude-recovery-root-<root>`), not the latest failing run id; running repairs are never
  cancelled and independent roots run in parallel. No polling; event-driven only.

## Safe autonomous merge (Phase 2C)

`.github/workflows/claude-release-engineer-auto-merge.yml` makes ONE deterministic merge decision per
successful `Staging Candidate` run (`workflow_run` completed, conclusion `success`). No polling and
no GitHub native "auto-merge later". It ends at merge-to-main: it never dispatches Production
Release/Rollback and holds no production credentials or environments.

| Job | Holds | Does |
| --- | --- | --- |
| `resolve` | read-only workflow token | Trusted scripts from `main`; freezes the 40-character control-plane SHA; decides eligibility. No write credential. |
| `merge` | PatelRep GitHub App token (only here, `contents`+`pull-requests` write) | Runs trusted code at the frozen SHA (never candidate code), serialized by `patelrep-release-engineer-auto-merge-main` (no cancel), re-validates everything from fresh GitHub state, then merges the exact head SHA. |

A PR is eligible only if ALL hold (re-checked independently immediately before merging):

1. Created by exactly `patelrep-release-engineer[bot]` (id 337493489, type Bot).
2. Head branch is `claude/recovery-<numeric-root>`. `claude/recovery-manual-*` and any `manual-` root
   never auto-merge. Ordinary, Dependabot and human PRs never auto-merge, even if Claude repaired them.
3. Publisher-only history: 1-3 commits, trailers valid (root equals the branch root, attempts exactly
   1..n, attempt 1 source run equals the root), authored and committed as the publisher, no extra commits.
4. PR open, non-draft, base `main`, same repository, head SHA and branch equal the staging artifact.
5. Exact successful `CI` run (same SHA, branch, `pull_request` event) and exact successful
   `Staging Candidate` run, plus completed successful `CI Gate` and `Staging Gate` check runs produced by
   GitHub Actions (app id 15368). The `Staging Gate` must have been reported by that staging run.
6. No `CHANGES_REQUESTED`, no unresolved review threads, none of the labels `do-not-merge`,
   `do not merge`, `hold`, `manual-review`, `needs-human`; mergeable state `clean`.
7. No changed (or renamed-from) file is high-risk. High-risk always requires a human merge:
   database/persistence (`supabase/**`, migrations, `*.sql`, `apps/api/core/**`, schema/drift/replay/
   reconciliation), billing (billing, Stripe, payment, subscription, checkout, invoice, webhook,
   credits), auth/security (auth, oauth, rbac, permission, credential, secret, session, token, jwt,
   `apps/api/middleware/**`, `apps/web/proxy.ts`), `.github/**` (including this workflow), `scripts/**`
   and production/release/rollback/deploy/staging-guard paths, and infrastructure/dependency/config files.

8. Recovery branches are provably publisher-only: a fresh read of the repository rulesets finds an ACTIVE
   branch ruleset for `refs/heads/claude/recovery-*` (no exclusions) with `creation`, `update` and
   `non_fast_forward` rules whose ONLY bypass actor is the PatelRep GitHub App: `actor_type: Integration`,
   `actor_id: 5179664` (pinned in `PUBLISHER_APP` in `scripts/release-engineer-auto-merge-policy.mjs`),
   `bypass_mode: always`. The id is a trusted constant read from the live ruleset, not discovered at runtime
   (the read-only workflow token cannot call `GET /apps/{slug}`). If the PatelRep App is ever recreated and
   gets a new Integration id, auto-merge fails closed until that constant is updated through a
   human-reviewed PR. Publisher commits are unsigned and their email/trailers are forgeable, so this
   ruleset (not the commit identity) is the provenance anchor. Without it auto-merge stays ineligible
   (fail-closed): `Auto-merge ineligible: dedicated recovery branches are not protected for
   publisher-only creation and updates.` This never triggers a repair.

After a fully verified merge the `merge` job also uploads the identifier-only `auto-merge-result`
artifact (see Phase 2D below). It exists only for a real, verified merge: never for a no-op,
ineligible candidate, failed merge or failed post-merge verification, and candidates cannot write it.

A refusal is reported in the job summary (`Auto-merge ineligible: human review required because changed
file <path> is classified as <risk>.`), leaves the PR open and does not start another Claude attempt.

Merge: `PUT /pulls/<n>/merge` with `sha=<validated head>` and `merge_method=merge` (GitHub rejects it if the
head moved). Afterwards the PR must report `merged` with the same head SHA. No force push, rebase, branch
update or branch deletion; the `main` ruleset (strict `CI Gate` + `Staging Gate`, thread resolution, no
bypass actors) stays the final backstop.

### One-time setup: publisher-only recovery-branch ruleset

Do this once in the GitHub UI (Settings -> Rules -> Rulesets -> New ruleset -> New branch ruleset). It is
never created or changed by a workflow, and it is separate from the `main` ruleset (id `17358515`, which keeps
strict `CI Gate` + `Staging Gate`, thread resolution, 0 approvals, NO bypass actors; do not edit it and do not
add the App to it).

- **Ruleset name:** `claude-recovery-branches` (any name works; the validator matches on content).
- **Enforcement status:** `Active` (not Disabled, not Evaluate).
- **Bypass list:** exactly one entry: the GitHub App `patelrep-release-engineer`, bypass mode `Always`
  (API shape: `actor_type: Integration`, `actor_id: 5179664`, `bypass_mode: always`). No repository roles, admins, users, teams,
  Dependabot or other Apps.
- **Target branches:** Add target -> Include by pattern -> `claude/recovery-*`
  (stored as `refs/heads/claude/recovery-*`). No exclusions.
- **Branch rules:** enable `Restrict creations` (`creation`), `Restrict updates` (`update`) and `Block force
  pushes` (`non_fast_forward`). Leave `Restrict deletions` off for now so test branches can still be cleaned up
  manually.

Until this ruleset exists and matches exactly, Phase 2C auto-merge remains ineligible. If the workflow
token cannot read ruleset bypass actors, auto-merge also stays ineligible (it never guesses).

## Controlled production release request (Phase 2D)

**Automatic request ≠ automatic production approval.** Phase 2D may only *request* a Production
Release. The `production` GitHub Environment no longer has a Required Reviewer (removed outside this
repository), so there is no manual "Review deployments → Approve and deploy" click: the `production`
Environment only scopes production secrets and variables, and the Production Release workflow itself
enforces eligibility and fails closed. The request path holds no production credentials, never uses that
Environment, never approves a deployment (never call GitHub's pending-deployment approval API) or changes
Environment protection. Phase 2D itself never dispatches Production Rollback; only the separately gated Phase 3C incident path may do so. The release request itself is gated by the
`PRODUCTION_AUTO_RELEASE_ENABLED` variable and the trusted checks below.

Final authority chain:

Deploy Health failure → Claude diagnosis → trusted publisher → recovery PR → CI → Staging → Phase 2C
merge → Phase 2D Production Release request → **Production Release provenance re-verification (fails
closed)** → DB preflight/migration if applicable → API → exact API verification → Web → strict production
verification → tag/GitHub Release → ongoing Deploy Health monitoring.

### The `auto-merge-result` artifact (Phase 2C output)

Written by the trusted merge script after the exact-SHA merge, the fresh re-fetch (`merged == true`,
head still the candidate) and a parent check that the merge commit's parents are exactly the
`base_main_sha` read from fresh GitHub state immediately before the merge and the candidate head.
Name `auto-merge-result`, one file `context.json`, 3 days retention, identifiers only (no PR text, no
credentials):

| Field | Meaning |
| --- | --- |
| `pr_number`, `candidate_branch` (`claude/recovery-<root>`), `candidate_sha` | the merged recovery PR |
| `merge_commit_sha`, `base_main_sha` | the merge commit and the main tip it was merged onto |
| `root_run_id`, `attempt` | numeric recovery root and attempt |
| `ci_run_id`, `staging_run_id` | the exact gate runs Phase 2C verified |

### Request workflow

`.github/workflows/claude-release-engineer-production-request.yml` triggers only on completed
`Claude Release Engineer Auto-Merge` runs (no polling, schedule, push, PR or manual trigger) and has two
jobs with separated authority:

| Job | Holds | Does |
| --- | --- | --- |
| `resolve` | read-only workflow token | Trusted scripts from `main`; freezes the control-plane SHA; decides eligibility. No App key, no production credentials, no environment, cannot dispatch. |
| `request-release` | PatelRep App token (only here, `actions: write` only, created after revalidation) | Serialized by `patelrep-production-release-request` (no cancel); checks out the exact frozen SHA (never candidate code); re-validates everything from fresh GitHub state; then dispatches `production-release.yml` with `release_sha=<merge commit>`, `version_bump=patch` and `automation_source_run_id=<auto-merge run>`. |

The App needs the repository permission **Actions: read and write** for that dispatch (the token is scoped
to exactly that). It never receives `contents` or any production secret.

### Request eligibility (ALL must hold; evaluated by resolve, request-release and again by Production Release)

0. Activation: repository variable `PRODUCTION_AUTO_RELEASE_ENABLED` equals exactly `true`; otherwise the
   workflow is a clean no-op. Workflows never create or change it. The owner enables it manually only
   after Phase 2D is merged and the first managed production release was done manually. With no Environment
   approval pause, enabling it means an eligible recovery merge proceeds to production without a human click;
   this variable is the activation switch (set it to anything other than `true` to stop automatic requests).
1. Source run is the exact successful `Claude Release Engineer Auto-Merge` run of this repository. A missing
   artifact is a clean no-op; a malformed, duplicate, expired or unreadable one is a hard failure.
2. The merged PR is re-fetched: merged, base `main`, created by `patelrep-release-engineer[bot]` (id
   337493489, type Bot), head `claude/recovery-<numeric-root>` (manual roots rejected), head SHA and merge
   commit equal the artifact, valid publisher trailers and history exactly as in Phase 2C, merge commit
   parents equal `base_main_sha` and the candidate head. The PR body is never trusted.
3. `main` is still exactly the recovery merge commit. If it moved even one commit, no automatic release;
   a human may still release an explicit older main ancestor.
4. A managed production baseline exists: the newest completed GitHub Release (not draft, not prerelease,
   tag exactly `vX.Y.Z`) whose tag resolves to a commit that is an ancestor of `main`. The historical
   two-segment milestone tags `v1.0`-`v1.7` are not releases. With none the request is ineligible:
   `Production release request ineligible: no managed production release baseline exists; seed the first
   release manually.` A broken newest release (missing/non-commit/non-ancestor tag) is a hard failure.
5. The deployed runtime equals the ledger: the GitHub Release is only the release ledger. A human Production
   Rollback redeploys an older tag and creates no new tag or Release, so the newest Release is not
   necessarily what runs. `scripts/production-runtime-identity.mjs` reads ONLY the public production
   endpoints (API `/health`, Web `/login` meta tags; no secret, Environment or credential) and must prove a
   modern, Web/API-agreeing identity with a 40-character SHA and a managed `vX.Y.Z` version, and that
   identity must equal the managed baseline tag AND SHA. Legacy, partial, unreachable, malformed or
   disagreeing identity, or any mismatch (e.g. Release `v1.8.1` but production rolled back to `v1.8.0`), is
   ineligible with "a manual production decision is required"; production is never "corrected" forward.
   This is an identity proof, not a health requirement: identity on an otherwise unhealthy response counts.
5b. No piggybacking: `base_main_sha` equals the baseline release commit, so the recovery merge is the only
   unreleased commit. Otherwise main contains unreleased work and a human must decide the release.
6. Root is a production-health failure: the `root_run_id` run is a completed, failed `Deploy Health Check`
   (schedule or push, not a manual dispatch) of this repository whose head SHA equals `base_main_sha`.
   Roots from CI, Staging Candidate, Production Release, the Evidence Audit or manual dispatch never
   request production automatically.
6b. Not stale: if a newer successful `Deploy Health Check` (workflow `deploy-check.yml`, same repository, schedule
   or push, completed) exists for the SAME `base_main_sha`, production recovered after the root failure and
   the request is ineligible. Manual dispatch runs never count as recovery proof; unprovable or malformed run
   history fails closed.
7. Low-risk paths: the same Phase 2C classifier over the PR's changed and renamed-from files. Any high-risk
   path (database, billing, auth/security, `.github/**`, `scripts/**`, release/deploy, infrastructure) is
   human-only.
8. Provenance rulesets are intact: the recovery ruleset exactly as Phase 2C requires (Integration id
   5179664, `always`, the only bypass actor, `creation`/`update`/`non_fast_forward`), and the main ruleset
   active with strict `CI Gate` + `Staging Gate`, thread resolution, `non_fast_forward`, `deletion` and NO
   bypass actors. Weakening either fails closed. Neither ruleset is modified by any workflow.

Not automatic, always a human release decision: feature PRs, human/Dependabot PRs, CI/Staging/Production
Release/Evidence-Audit recovery, manual roots, DB/billing/auth/infrastructure/control-plane changes,
stale merges and recoveries merged on top of unreleased main work. A repair whose root is a failed
Production Release can be diagnosed by Claude but never requests another production release, and
nothing automatically retries or rolls back a production release.

### Idempotency

A rerun does nothing if the baseline release already is the target commit. Production Release shares the
non-cancelling `production-deploy` concurrency group and a newer pending run *replaces* an older pending one,
so the request never dispatches while any Production Release or Rollback run is queued, running or waiting:
if the active run is this exact request (the run name carries the target SHA and source run) it is a
clean no-op, otherwise the request is declined and a human releases manually. If duplicate state cannot be
proven, the request fails closed.

All of rules 0-8 (including the runtime identity and health-recovery checks) run at all three stages: the
resolver, the request job right before the App token exists, and Production Release before any production
step. A rollback or recovery that happens between dispatch and the release run therefore fails
the release with production untouched.

### Production Release in automated mode

Production Release stays the only path to production and keeps every guard (SHA/main-ancestry, CI and Staging
Gate, tree identity, target guards, migration preflight and unknown-migration blocking, API before Web, exact
identity, `/health`, `/ready`, drift, tag and Release only after verification, shared concurrency). When
`automation_source_run_id` is blank it behaves exactly as a manual release. When present it additionally runs
`scripts/production-release-request.mjs release` as the first provenance step of the first `production` Environment job, i.e.
before any production step. It requires the dispatch actor to be the trusted
publisher bot (`patelrep-release-engineer[bot]`, id 337493489), `refs/heads/main`, `release_sha` equal to the
merge commit and to the workflow commit, `version_bump=patch`, and re-derives every eligibility rule above
(including the activation variable). If anything changed between request and release the release fails
before production is touched.

### Versioning and the first release

The previous version comes from completed GitHub Releases (`scripts/release-version.mjs`). With none, the next
release is the one-time bootstrap `v1.8.0` (`v1.7` is never read as `v1.7.0`). Afterwards: patch `v1.8.0` ->
`v1.8.1`, minor `v1.8.1` -> `v1.9.0`, major `v1.9.0` -> `v2.0.0`. Automated requests are always patch. If the
computed tag, or any three-segment tag at or above it, exists without a completed GitHub Release (or the
computed tag has a draft/prerelease), the release fails closed: tags are never skipped, deleted or rewritten
automatically and a human must investigate.

## Production Release evidence ledger (Phase 3A)

Phase 3A adds evidence, **not authority**. The final `production-release-evidence` job in
`.github/workflows/production-release.yml` waits for the entire release graph and uses `if: always()` so even a
failed or partial production release emits a sanitized record. The job has `contents: read` only, does not use the
`production` Environment, receives no production secret, and cannot migrate, deploy, tag, create a Release,
dispatch another workflow, or roll back.

Its `production-release-evidence/context.json` artifact records the exact workflow/run identity, candidate and
previous managed release identities when provable, each release-job result, database-pending state, final
production verification, and conservative mutation states. Failed or cancelled mutation jobs are recorded as
`unknown_after_attempt`; absence of a success is never converted into proof that production was untouched.
The artifact is retained for 90 days. Nothing in Phase 3A automatically acts on it; automatic rollback remains
out of scope until a later Phase 3 subphase adds a separately reviewed policy and provenance re-verification.

## Production Release stabilization and incident classification (Phase 3B)

Phase 3B consumes the trusted Phase 3A evidence after each completed Production Release, but still adds **no
production authority**. `.github/workflows/production-release-stabilization.yml` is a `workflow_run` consumer
of `Production Release` with read-only repository/Actions permissions. It never uses the `production`
Environment, never receives production credentials or the PatelRep App token, and never dispatches Production
Rollback.

The classifier verifies that the source is the exact completed `.github/workflows/production-release.yml` run
from this repository's `main`, that the evidence run id/attempt/control-plane SHA match, and that the source
control-plane SHA remains an ancestor of `main`. Successful releases must additionally have exactly one
completed GitHub Release whose tag resolves to the candidate SHA before stabilization begins.

Failed releases are incidents only when final production verification failed and the Phase 3A mutation states
prove or cannot exclude DB/API/Web mutation. A runtime that passed exact final verification but later failed
only while creating the tag/GitHub Release is explicitly **not** a rollback incident.

For a successful release, strict public Web/API/readiness + exact SHA/version checks run after a 30-second delay,
up to three times at 60-second intervals. Two consecutive failures are required to emit
`production-release-incident`; one/non-consecutive failure is recorded as `transient_unconfirmed`. Probe error
text stays in logs and is not copied into the trusted incident handoff.

Both the stabilization result and confirmed incident artifacts are sanitized and retained for 90 days. Phase 3B
only classifies; no automatic rollback, database reversal, feature-flag mutation, deployment, or release retry is
authorized.

## Trusted automatic rollback request (Phase 3C)

Phase 3C adds a new trusted workflow,
`.github/workflows/production-auto-rollback-request.yml`, triggered only after a successful
`Production Release Stabilization` run. Claude is not involved in this decision and receives no new authority.

The resolver has read-only `contents/actions/pull-requests` access and executes trusted `main` scripts. It
freezes one exact control-plane SHA. Only if the shared rollback policy says the incident is eligible does the
second job run. That job checks out the exact frozen SHA, revalidates all live state, and only then may create a
short-lived PatelRep App token with **Actions: write only**. The request job has no `production` Environment,
Supabase/Railway credentials, database access, deployment permission, or feature-flag authority.

Eligibility requires `PRODUCTION_AUTO_ROLLBACK_ENABLED=true`, exact same-repository Phase 3B provenance,
independent validation of the original Production Release evidence, `database = no_change`, the exact failing
runtime still live, a fresh failing strict smoke, a low-risk candidate PR, an exact completed previous release/tag,
and no active release/rollback. Anything ambiguous refuses.

The shared policy also exposes `rollback` validation mode. Phase 3D wires that mode into the trusted
`production-rollback.yml` before any production Environment job. Phase 3C continuously checks that this hook is
still present; removing it makes automatic rollback requests fail closed.

## Hardened automated rollback execution and circuit breaker (Phase 3D)

Production Rollback now accepts optional `automation_source_run_id`. Manual dispatch leaves it blank and keeps
the existing operator path. Automated mode must first pass `verify-automation-provenance`, an unprivileged job
that checks out the exact workflow SHA and runs the same Phase 3C policy in `rollback` mode. That means one
incident is independently evaluated three times: the read-only resolver, the request job immediately before the
App token, and Production Rollback itself immediately before any production access.

The rollback workflow receives no new write authority. Its existing `production` Environment, Supabase/Railway
secrets, exact known-good tag resolution, shared `production-deploy` lock, API-before-Web deployment, exact
identity checks and final smoke remain the execution boundary. Automated mode is *more restrictive* on database
compatibility: because policy requires `database = no_change`, drift at the previous release must be exactly
`CLEAN`. Manual rollback retains its existing human compatibility decision. No mode reverses migrations.

After exact rollback verification, a separate read-only job proves quarantine. A post-release regression must
leave the live runtime on the previous tag while the managed Release ledger still points to the failed newer
release, which causes Phase 2D's existing runtime-vs-managed-baseline guard to refuse automatic promotion. A
partial release failure must leave the failed candidate unmanaged and restore the existing baseline. Nothing
automatically re-tags, deletes a Release, retries the failed release, or starts an automatic fix-forward loop.

## Production rollback evidence ledger (Phase 4A)

Phase 4A adds no new production authority. Production Rollback now attempts a read-only public identity capture
before target resolution and, after the full graph finishes, runs a separate `production-rollback-evidence` job
with `if: always()`. The artifact schema is `patelrep.production-rollback-evidence.v1` and retention is 90 days.

The ledger records only sanitized categorical state and exact managed identifiers: run provenance, manual vs
automated source, before-runtime identity when provable, exact rollback target, job outcomes, conservative API/Web
mutation state, final verified target identity, and automated quarantine proof. Invalid free-form target/source
input is represented by validity flags instead of copied into the artifact.

Both the pre-runtime capture and terminal ledger run without the `production` Environment, production secrets,
write tokens, Supabase/Railway authority or workflow-dispatch capability. The ledger cannot initiate or retry a
rollback. Database evidence is permanently categorical as `not_mutated_by_workflow`: rollback may read migration
history for compatibility but never reverses or repairs it.

## Incident closeout and production re-entry gate (Phase 4B)

Phase 4B adds governance, not production authority. `Production Incident Re-entry` is manual and read-only. It
consumes the Phase 4A rollback ledger plus the original Phase 3 incident, re-runs the Phase 3D quarantine proof,
and authorizes exactly one current-main fix-forward SHA and version bump only after CI + Staging/tree identity are
already proven. It cannot deploy, migrate, tag, create a Release, roll back, dispatch another workflow, or create a
write-capable token.

Production Release now has a first, unprivileged `verify-production-reentry` job. It runs before the first
`production` Environment job on **every** release. When no automated rollback incident is open it is a no-op.
When one is open it refuses Phase 2D automated release requests and requires a successful
`production-incident-reentry` authorization matching the exact rollback run, incident, release SHA and bump.
The live rollback quarantine is re-proven at release time and a moved `main` invalidates the authorization.

The policy tracks the latest restored automated rollback from the trusted Phase 4A evidence rather than merely
comparing runtime to the newest GitHub Release. That preserves the gate for `partial_release_failure`, where
rollback correctly restores the same managed baseline and a simple runtime/baseline comparison would look normal.

The incident closes only after the authorized release itself succeeds **and** Production Release Stabilization
emits `patelrep.production-incident-closeout.v1` with a non-incident stabilization result. The closeout is tied
to the exact re-entry authorization, rollback run and released candidate. Before that artifact exists, a second
release still sees the prior rollback as open. A newly confirmed regression produces no closeout and may create a
new rollback incident instead.

The re-entry and closeout artifacts follow the existing 90-day trusted-evidence retention. Missing/expired
provenance fails closed and requires human investigation; no workflow reconstructs or guesses missing evidence.

## Production operations notifications (Phase 4C)

Phase 4C adds visibility, not release authority. `Production Operations Notify` consumes only completed
stabilization, rollback, and incident re-entry runs. A read-only resolver derives a sanitized intent; a separate
publisher with only `issues: write` revalidates that intent before creating, commenting on, reopening, or closing
a GitHub Issue.

The publisher has no production Environment, production secrets, deployment tokens, GitHub App token,
`actions: write`, `contents: write`, workflow dispatch, tag/Release mutation, database access, or merge
authority. Notification publishing is serialized with its own non-cancelling concurrency group and does not share
or acquire the production deployment lock.

Incident threading is derived from trusted evidence:
- a Phase 3B rollback-class incident opens key `incident:<stabilization-run-id>`;
- Phase 4A automated rollback evidence carries that same stabilization run id, so rollback results update the same thread;
- Phase 4B re-entry authorization carries the same incident id, so authorization updates that thread;
- Phase 4B closeout references the exact rollback run, whose trusted rollback evidence resolves back to the same incident id, and only then closes the thread.

Mutable issue content never becomes authority. The mapping from lifecycle key to issue number comes from prior
successful `patelrep.production-operations-notification.v1` artifacts. Exact source-event reruns are deduplicated
from the same trusted artifacts. Stable releases are explicit no-ops to avoid alert fatigue; release failures,
confirmed incidents, rollback failures, missing evidence, re-entry failures, and human-intervention states remain
visible.

## Periodic production release integrity audit (Phase 4D)

Phase 4D adds observation, not authority. `Production Release Audit` is scheduled every six hours, runs on main
pushes, and is manually dispatchable only from `main`. It uses read-only repository/Actions access, the exact
workflow SHA, a separate non-cancelling audit concurrency group, and never enters the `production` Environment.

The state machine intentionally treats verified rollback quarantine as **consistent**. It reuses
`resolveProductionBaseline`, `findLatestOpenAutomatedRollback`, and
`verifyAutoRollbackCircuitBreaker` rather than implementing parallel release semantics. This preserves both
Phase 3D quarantine shapes: managed-Release mismatch after a post-release regression and failed-candidate-unmanaged
after a partial-release failure.

The audit also checks the managed semver ledger for strict tags without completed Releases, proves public Web/API
identity, records whether re-entry is required/current/stale, and defers rather than alerting while Production
Release/Rollback is active. Every run emits `patelrep.production-release-audit.v1`; inconsistent state fails only
after the evidence artifact is uploaded.

Phase 4C listens to audit completion. The audit itself remains unable to write Issues. The existing separated
notification publisher opens/updates one `audit:production-integrity` issue on inconsistency and closes an
existing issue only after a later non-deferred audit fully proves a valid steady/quarantined state. Mutable Issue
state is never used as release authority.

## Synthetic release/recovery resilience drills (Phase 5A)

Phase 5A does not extend Claude or production authority. `Release Resilience Drill` executes only in-memory
fixtures through the actual trusted Phase 3/4 policy exports. The workflow has `contents: read` only and cannot
read production credentials, call live production endpoints, write GitHub state, dispatch workflows, deploy,
migrate, tag, release, merge, or roll back.

The purpose is composition testing: unit tests prove individual policies, while the resilience drill proves that
the outputs of one phase still satisfy the inputs/invariants of later phases. In particular, the full-cycle drill
chains stabilization → auto-rollback decision → circuit breaker → human re-entry → release re-entry → closeout →
audit recovery, and separate negative drills prove database-mutation blocking, partial-release quarantine,
unexpected runtime drift, stale re-entry rejection, and audit deferral during active production mutation.

Drill failures retain a sanitized `patelrep.release-resilience-drill.v1` artifact and fail the workflow after
upload. They do not trigger a production action or create a new repair authority.

## Bounded recovery lineage

`MAX_AUTOMATIC_REPAIR_ATTEMPTS = 3` (`scripts/recovery-lineage.mjs`): attempt 1 is the initial
repair, attempts 2 and 3 are automatic retries, and a failure of attempt 3 stops automation (no
Claude run, no push, no new PR; the repair PR stays open and the workflow summary says so).

The authoritative counter is **commit trailers** written only by the trusted publisher, never
commit counts, PR comments, run searches, timestamps or branch age:

```
PatelRep-Recovery-Root: <root run id | manual-<run id>>
PatelRep-Recovery-Attempt: <integer>
PatelRep-Recovery-Source-Run: <failed workflow run id>
```

- A failure with no managed lineage starts a new root: root = the exact failed run id, attempt 1.
- A failure of an open same-repository PR candidate head that carries valid trailers (authored by the
  publisher identity) keeps the same root and uses attempt + 1. Works for `claude/recovery-<root>`
  branches and for ordinary branches repaired in place (e.g. `feature/foo`).
- On a `claude/recovery-<root>` branch the root in the name must equal the root in the head
  commit; disagreement, malformed or partial trailers, forged trailers (wrong author), or a
  recovery head with no trailers all fail closed.
- Main-based failures (CI on `main`, Deploy Health Check, Evidence Audit, Production Release) always
  start a NEW root, even if a commit on `main` happens to contain old trailers.
- PR body text (`Autonomous attempt N/3`, history) is informational only.

## Publishing guarantees

Before and again immediately before the push the publisher re-fetches the PR and requires: open,
base `main`, same repository, same head branch, and head SHA equal to the `repair_sha` Claude started
from. If a human or bot moved the PR meanwhile it stops rather than overwriting. A new recovery
root uses `claude/recovery-<root>`; if that branch or an open PR for it already exists it is
refused, never reused or overwritten. A PR is created only after re-querying that none exists;
otherwise the existing one is updated, preserving its recovery history. Known gap: between the
`repair` and `publish` jobs another queued agent for the same root could start; its publish then
fails closed on the stale head check.

## Trusted control plane

The resolver is checked out from `main` once, in the `resolve` job, and its exact commit SHA is
captured and validated as `trusted_control_plane_sha`. The publisher is checked out at that **same
SHA** (never mutable `main`), so a moving `main` cannot make the two run different trusted code.
In the `publish` job the trusted publisher (`trusted-publisher/`, no persisted credentials) and the
repair worktree (`repair-worktree/`, the exact `repair_sha`, App-authenticated) are sibling
directories: the patch is only ever applied inside the worktree, so a Claude-produced patch cannot
replace the publisher or its lineage code before privileged execution. The repair SHA and the
control-plane SHA are distinct.

## Repair-context resolution (before checkout)

`scripts/resolve-release-engineer-context.mjs` runs from a trusted default-branch checkout and
outputs `repair_sha`, `repair_branch`, `repair_pr_number`, `root_failed_run_id`,
`failed_run_id`, `repair_attempt`, `automatic_retry_allowed`, `skip` and `upstream_workflow`. Claude is always checked out at `repair_sha`. Anything that cannot be proven
fails closed before Claude is invoked. `repair_branch` is the branch to push: the PR head branch
when an open PR owns the failure, otherwise `claude/recovery-<root_failed_run_id>`.

| Failed workflow | Repair target |
| --- | --- |
| `CI` | The run's exact `head_sha`. If it belongs to an open same-repository PR, that PR is re-fetched and must still be open, target `main`, and have the same head SHA/branch. |
| `Staging Candidate` | `workflow_run` reports `main` as `head_branch`/`head_sha` even for PR candidates, so it is **not trusted**. The `staging-candidate-context` artifact (identifiers only, 3-day retention) is downloaded from the exact failed run; the PR is re-fetched and must be open, same-repository, based on `main`, with head SHA and branch exactly equal to the artifact. |
| `Production Migration Evidence Audit` | The failed run's exact `head_sha` (never a newer `main`); fix on `claude/recovery-<run id>`. |
| `Deploy Health Check` | The failed run's exact `head_sha` (scheduled/push runs execute trusted `main` code, so that exact monitoring revision is repaired); fix on `claude/recovery-<run id>`. |
| `Production Release` | `release_sha` from the `production-release-context` artifact (identifiers only), because the `release_sha` input can differ from the run's `head_sha`; the commit must exist. Fix on `claude/recovery-<run id>`. |

GitHub Actions run ids are validated as decimal strings of up to 20 digits (current ids have 11);
PR numbers are validated separately. Unsafe or malformed ids fail closed.

## Production monitoring contract

`Deploy Health Check` runs `scripts/production-monitor-smoke.mjs`, which verifies what is actually
deployed. It classifies `/health` into an explicit contract family and logs which one it detected:

- **legacy** (predates `/ready`; `env` field, no release identity): requires healthy API/database and
  `env: production`; does not request `/ready`.
- **modern** (release-aware): requires `/ready` with a compatible database, a consistent 40-character
  release SHA and version across `/health`, `/ready` and the Web meta tags.
- Anything else (partial identity fields, mixed shapes, unknown shapes) fails closed. A `/ready` 404
  is never ignored: a modern deployment that loses `/ready` fails.

`scripts/public-smoke.mjs` is the separate strict release-verification contract used by Production
Release and always requires `/ready` and the exact expected release identity. Repairs must not add a
legacy/no-`/ready` fallback there. `check:floor-copy` stays a CI source gate and is not part of the
runtime monitor.

## Failure-repair procedure

1. Inspect the exact failed workflow run (id from the prompt), not a later or similar one.
2. Inspect its failed jobs, relevant logs, and artifacts (`gh run view`, `gh run download`).
3. Establish the actual root cause **before editing**.
4. Read the current implementation and its git history.
5. Prefer the smallest deterministic fix.
6. Add a regression test that reproduces the failure.
7. Run targeted tests locally before pushing (one diagnosis → one change → tests → one push).
8. If `repair_pr_number` is set, push to that existing same-repository PR branch instead of
   opening another PR.
9. Otherwise create branch `claude/recovery-<workflow-run-id>`.
10. The trusted publisher pushes the fix (Claude itself cannot push). Never push directly to `main`
    (no `git push origin main`, no `HEAD:main`, no force pushes); the `main` ruleset requiring `CI Gate` and `Staging Gate` (no bypass actors)
    is the hard backstop and must not be weakened.
11. Open a PR to `main` containing: root cause, changes, tests run, safety impact.
12. Let normal CI and Staging Candidate verify it.

Never make a failing test or check green by weakening, skipping, or deleting it. If the check is
genuinely wrong, say so in the PR with evidence and fix the check's logic, not its strictness.

## Database safety invariants (never violate)

Claude must never:

- run `supabase migration repair` against production
- directly mutate `supabase_migrations`
- guess migration aliases
- fabricate historical migration mappings
- rewrite production migration history
- weaken unknown-migration blocking
- weaken duplicate-file migration coverage
- bypass `production-target-guard`
- bypass `staging-target-guard`
- remove exact release identity verification

Historical migration reconciliation stays evidence-based. A failure caused by insufficient
evidence is resolved with more investigation or code that gathers evidence — never by guessing.

## Production authority model

This workflow holds no production credentials: no `PRODUCTION_SUPABASE_DB_URL`, no Railway
production tokens, no Supabase service-role keys, no Stripe keys. It never runs production SQL
or Railway commands itself. Production automation has only two bounded dispatch paths: the Phase 2D request of the existing
`Production Release` (patch, narrow recovery case only, with its own independent re-verification and no separate Environment
approval) and the Phase 3C request of `Production Rollback` for a confirmed zero-migration, low-risk incident. The Evidence Audit is never
dispatched by automation. Automated repairs must not change `production-release.yml` eligibility, target
guards, versioning, or rollback semantics (all control-plane paths are high-risk and need a human merge).

## Tooling and permissions

- Auth: `CLAUDE_CODE_OAUTH_TOKEN` (Claude subscription). `ANTHROPIC_API_KEY` is not used.
- Only the publisher job uses a short-lived token from the PatelRep GitHub App (`PATELREP_APP_CLIENT_ID`,
  `PATELREP_APP_PRIVATE_KEY`) for writes, never a PAT. Claude itself only gets the read-only workflow token.
- The PatelRep App already has `Workflows: Read & write`, so Claude **may** repair
  `.github/workflows/**`. Workflow changes follow the same path as any repair: a repair branch and
  PR, never a direct push to `main`, and they must pass the normal `CI Gate` and `Staging Gate`.
  Editing a workflow file does not grant the repair workflow any production secret: it has none,
  and GitHub Environment boundaries and target guards stay authoritative.
- Claude gets only the read-only workflow token. It cannot push, commit, edit PRs or dispatch
  workflows (its tool list allows read-only git and `gh` inspection only); `supabase`, `railway` and
  `psql` are denied.

## Cost control

Claude usage and Actions minutes are limited. Only react to failures, avoid speculative pushes,
and run targeted local tests before triggering another full CI cycle.
