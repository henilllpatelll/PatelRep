# Production runbook

Concise operational procedures for releasing, recovering, and verifying PatelRep production. See [RELEASE_PROCESS.md](RELEASE_PROCESS.md) for the full pipeline design and [FEATURE_FLAGS.md](FEATURE_FLAGS.md) for the flag system this runbook leans on as first-line recovery.

## Normal release

1. Confirm the target PR shows a green **CI Gate** and a green **Staging Gate**, and has been merged to `main`.
2. Dispatch **Production Release** (`.github/workflows/production-release.yml`) from the Actions tab. Leave `release_sha` blank to release current `main`, or pin an explicit commit if `main` has moved on since the PR you intend to ship. Choose `version_bump` (`patch` for the common case).
3. There is no manual Environment approval: the run proceeds on its own trusted gates and fails closed if any refuse.
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
3. There is no manual Environment approval, so confirm schema compatibility (see "Database failure" below) BEFORE dispatching.
4. The workflow redeploys both API and web at the known-good commit and re-verifies release identity — it does not reverse any database migration.
5. Once stable, investigate the regression on a branch and ship the fix through the normal path.

## API failure (deploy failed, or unhealthy after deploy)

- **If `deploy-api` failed before web deployed:** production Web is untouched (the release workflow never starts `deploy-web` unless `deploy-api` succeeded). Investigate the Railway deploy logs and the API health/readiness response; fix forward via a new PR, or roll back to the last known-good tag with **Production Rollback**.
- **If the API is unhealthy after a release completed:** assess compatibility with the current database schema, then either redeploy the previous tag with **Production Rollback** or forward-fix via a new PR. Never attempt to reverse the database first.

## Database failure

- **Pre-flight found unexpected ("unknown") migrations on production:** STOP. Do not run `production-db-migrate`. This means production has drifted from the repository's migration history in a way the tooling cannot explain — investigate manually before any further release action. The only permitted historical reconciliation is an explicitly evidenced entry in `supabase/production-migration-aliases.json`; never infer an alias, run `supabase migration repair`, or otherwise rewrite production migration bookkeeping.
- **A migration failed to apply:** the release workflow does not continue to `deploy-api`. Investigate the failure in Supabase directly; most schema changes are additive (expand-only) and safe to leave half-applied while you fix the migration file (as a *new* forward migration — never edit an already-released one, see [DATABASE_MIGRATIONS.md](DATABASE_MIGRATIONS.md)).
- **General rule:** database rollback is **not** the default recovery path. Prefer, in order: (1) disable the related feature flag, (2) redeploy a previous compatible application version, (3) forward-fix the schema with a new migration. Reverse a migration only when it was explicitly designed and tested for reversal, data loss is impossible or accepted, and the operator has explicitly accepted it. A migration's `-- ROLLBACK` SQL comment is guidance for a human, never something a workflow executes automatically.

## Full outage

1. Identify the last-known-good release: the GitHub Release immediately preceding the one that broke production, or confirmed-stable runtime identity from before the incident.
2. Confirm that version's migrations are still compatible with the current production schema (an expand-only gap is normal and safe; a destructive/contract change since then needs a deliberate decision, not an automatic rollback).
3. Dispatch **Production Rollback** with that version and verify health completes successfully.
4. Once stable, write up what happened and fix forward through the normal PR path before attempting to re-release the version that caused the outage.

## Release evidence after failures (Phase 3A)

Every Production Release now uploads a `production-release-evidence` artifact even when the release fails. Use
that record before deciding whether a rollback is safe. In particular, `unknown_after_attempt` for database, API,
or Web means the workflow cannot prove whether the failed job partially mutated production; treat that as requiring
human investigation. `no_change` is the only database state that proves the release had no migration to apply,
and `verified_applied` proves the migration job completed and post-apply verification passed.

Phase 3A does **not** automatically dispatch Production Rollback and does not alter this runbook's manual recovery
order. Never interpret a failed job as evidence that nothing changed.

## Release stabilization and incident classification (Phase 3B)

After each completed Production Release, **Production Release Stabilization** reads the Phase 3A evidence and
classifies the result without production credentials or write authority.

- `partial_release_failure`: final production verification failed and DB/API/Web was applied, attempted, or
  cannot be proven untouched. Treat this as a real production incident requiring containment analysis.
- `post_release_regression`: a successfully released exact SHA/version failed the strict public production
  smoke twice consecutively during the short stabilization window.
- `transient_unconfirmed`: one/non-consecutive probe failure only. Do not treat this as confirmed rollback
  evidence; normal Deploy Health monitoring continues.
- `pre_production_failure_no_incident`: the release failed before any production mutation.
- `release_record_failure_no_runtime_incident`: production passed exact final verification but tag/Release
  bookkeeping failed afterwards; repair the release ledger deliberately rather than rolling back a verified
  runtime.

A confirmed incident creates the sanitized `production-release-incident` artifact. **Nothing consumes that
artifact to roll back production in Phase 3B.** Production Rollback remains manual, and database reverse
migration remains prohibited. If the evidence says `unknown_after_attempt`, keep treating the mutation as
possibly applied until proven otherwise.

### Release verification waits for Web propagation

`railway up --ci` can return before the new Web container is serving, so the previous release may answer the
first public check (run 37958771273: Web still reported the prior SHA ten seconds after the deploy job ended).
The Production Release verification step therefore polls (`SMOKE_WAIT_TIMEOUT_SECONDS=600`, every 15s; capped by
`scripts/public-smoke.mjs`). Only a stale or unreachable Web/API **identity** is retried; a pass still requires one
complete snapshot with the exact SHA, version, environment, Supabase host, healthy database and compatible schema.
Wrong environment/host, unhealthy database or incompatible schema fail on the first attempt, and a timeout fails the
release with the last observed identities. Stabilization, Rollback, Staging and Deploy Health stay single-shot.
A timeout means the new deployment never activated: check the Railway deployment status before anything else.

### Partial release with a healthy runtime and no release record

If production verifiably serves the exact candidate (API `/health` + `/ready`, Web `patelrep-release-*` meta) but the
release has no tag/Release and a `partial_release_failure` incident is open, there is **no rollback to close**:
incident closeout (`production-incident-closeout`) only exists for an automated Production Rollback + re-entry.
Never hand-create the tag or Release: `computeNextVersion` fails closed on an existing tag without a completed Release.
The supported record path is a deliberate human dispatch of Production Release for the same `release_sha` with the
same `version_bump`; the incident issue is a separate, human-authorized closure.

Phase 3C adds the owner-controlled rollback request path. The repository variable
`PRODUCTION_AUTO_ROLLBACK_ENABLED` must equal exactly `true`; otherwise confirmed incidents are only recorded.
Phase 3D now supplies the required rollback-side provenance hook, so an incident that passes every 3C gate may be
dispatched automatically. Unsetting or changing the variable from exactly `true` stops new automatic rollback
requests; manual rollback remains available.

The automatic request is limited to confirmed Phase 3B incidents where all of the following remain provable:
the failing release applied **zero production migrations** (`database = no_change`), the live Web/API identity is
still the exact failing release, a fresh strict production smoke still fails, the candidate change set is
low-risk, the previous completed GitHub Release/tag resolves to the exact recorded known-good commit, and no
Production Release or Rollback is already active. Any migration apply/attempt/unknown state, high-risk change,
stale incident, recovered runtime, partial/unprovable identity, changed tag, or active production operation stays
manual.

The request workflow also re-reads the original Production Release evidence rather than trusting the incident
artifact by itself. It passes only the previous `target_version` plus the Phase 3B
`automation_source_run_id`. Production Rollback independently re-runs the same policy before production access.
Automated mode additionally requires **CLEAN** migration drift at the exact previous release; manual mode retains
the existing operator-reviewed compatibility behavior.

After exact rollback smoke succeeds, the read-only circuit-breaker check proves either (a) a post-release rollback
is intentionally behind the newest managed Release, which blocks Phase 2D automatic promotion, or (b) a partial
failed release never became a managed Release and production is back on the prior baseline. Do not manually change
tags/Releases to defeat this quarantine. Fix forward through the normal PR → CI → Staging path, then make a
deliberate release decision.

## Rollback evidence after recovery attempts (Phase 4A)

Every Production Rollback now attempts a public Web/API identity capture **before** target resolution and keeps the
result as either an exact managed SHA/version or the sanitized state `unproven`. Failure to prove the pre-state
does not invent an identity.

At the end of the rollback graph, including failures and partial deploys, the read-only
`production-rollback-evidence` job uploads `production-rollback-evidence/context.json` for 90 days. Use it for
incident review before any fix-forward/re-entry decision. In particular:

- `api/web = unknown_after_attempt` means a failed/cancelled deployment may have changed production.
- `after_runtime.state = verified_target` means final rollback smoke proved both Web and API at the exact known-good tag/SHA.
- `restored_quarantine_unproven` means production was restored but the automated circuit-breaker proof failed; keep re-entry manual.
- `database = not_mutated_by_workflow` records the rollback design contract: compatibility is read-only and no reverse migration/history repair ran.

The evidence job itself has no production Environment or credentials and cannot deploy, migrate, tag, release or
dispatch another workflow.

## Re-entering production after an automated rollback (Phase 4B)

Do not immediately release the failed line again after an automated rollback. The rollback remains an open
production incident until a staged fix-forward is explicitly authorized and its release stabilizes.

1. Fix forward through the normal PR → **CI Gate** → **Staging Gate** → merge path.
2. Record the successful automated **Production Rollback run id** that restored production.
3. Run **Production Incident Re-entry** with that rollback run id, the exact current `main` SHA to release, and
   the intended version bump. This workflow does not deploy anything.
4. If it succeeds, note its workflow run id.
5. Manually dispatch **Production Release** with the exact same `release_sha` and version bump, and set
   `reentry_source_run_id` to the successful Production Incident Re-entry run id.
6. Let **Production Release Stabilization** finish. The incident is closed only when it emits the
   `production-incident-closeout` artifact. `stable` and `transient_unconfirmed` may close the prior
   incident; a confirmed new regression does not.

The authorization becomes stale if `main` moves. Re-run Production Incident Re-entry for the new exact main SHA;
never edit an artifact or reuse authorization for another commit/bump. The original failed candidate cannot
authorize itself for re-entry, and an automatic Production Release request can never consume a re-entry
authorization.

This gate also covers an automated rollback of a **partial release**, where production may equal the current
managed Release even though the failed candidate was never tagged. Do not infer "no incident" from
runtime==managed-release alone.

If the required 90-day evidence artifacts expired before closeout, or the gate cannot independently re-prove
quarantine, stop and investigate manually. Do not recreate or guess the missing incident provenance.

## Production notification issues (Phase 4C)

Production release/incident alerts now appear as GitHub Issues created by **Production Operations Notify**.
These issues are operational evidence and coordination threads; they do not grant deployment authority.

Use the issue state as follows:

- **Open critical incident** — production regression, partial release, failed rollback, missing rollback evidence,
  or unproven rollback quarantine. Investigate immediately and do not infer production state.
- **Open warning after successful automatic rollback** — production was restored, but the incident is still open.
  Fix forward through PR → CI Gate → Staging Gate, then follow the Phase 4B re-entry procedure.
- **Open re-entry update** — the exact fix-forward SHA and bump were authorized. Manually run Production Release
  with that exact `release_sha`, bump, and `reentry_source_run_id`.
- **Closed incident** — only the trusted Phase 4B stabilization closeout closes the automatic-rollback incident.
- **Closed manual rollback notification** — manual rollback completed and final exact runtime verification passed.

Normal stable releases do not create issues, and transient-unconfirmed stabilization does not alert by itself, to
avoid alert fatigue. A failed/refused release before a rollback-class incident still opens a separate
release-attention issue so it is not silently lost.

Every issue update links back to the trusted Actions run. If the notification workflow itself fails, inspect its
Actions run; never work around it by weakening production gates. The notifier has only `issues: write` and cannot
release or roll back production.

## Production Release Audit (Phase 4D)

**Production Release Audit** runs automatically every six hours and on each `main` push. It is read-only.
Use its artifact and GitHub Issue notification to distinguish real release-ledger drift from an intentional
rollback quarantine.

Healthy states:
- `consistent_managed_release` — runtime exactly matches newest completed managed Release.
- `quarantined_post_release_regression` — automatic rollback is proven and runtime intentionally trails the
  failed managed Release; follow the Phase 4B fix-forward/re-entry process.
- `quarantined_partial_release_failure` — automatic rollback restored the managed baseline while the failed
  candidate stayed unmanaged; follow the same Phase 4B re-entry process.
- `deferred_active_production_operation` — a release/rollback was actively mutating production, so the audit
  intentionally deferred judgment. The next scheduled audit should re-prove steady state.

An `inconsistent` result fails the audit after uploading evidence and opens/updates the
`audit:production-integrity` notification issue. Common reason codes include:
`runtime_managed_release_mismatch`, `runtime_identity_unproven`, `managed_release_unproven`,
`managed_release_missing`, `unmanaged_release_tag_conflict`, `incident_state_unproven`,
`rollback_quarantine_unproven`, and `reentry_state_unproven`.

Do not "fix" an audit by retagging, deleting Releases, repairing migration history, or redeploying blindly.
First establish which identity/evidence invariant is broken. The audit cannot mutate production and its issue
notifier has only `issues: write`.

A later fully proven healthy/quarantined audit closes an existing production-integrity issue. A deferred audit
does not close it because transient state was not evaluated.

## Release Resilience Drill (Phase 5A)

**Release Resilience Drill** is a synthetic control-plane exercise. It never injects faults into live production.
It runs weekly and can be manually dispatched from `main`.

A green drill means all currently encoded scenarios still agree across the real Phase 3/4 policy functions:
stabilization classification, auto-rollback eligibility, rollback quarantine, re-entry authorization, release
re-entry verification, closeout, production audit, and notification classification.

A red drill means at least one cross-phase invariant no longer composes correctly. Inspect the
`release-resilience-drill` artifact and the named failed scenario. Fix the policy/contract through a normal PR;
do **not** bypass CI/Staging, mutate production to make the drill green, or dispatch a real rollback/release as a
test.

Current scenario names:
`post_release_regression_full_cycle`, `database_change_blocks_auto_rollback`,
`partial_release_quarantine`, `runtime_drift_is_detected_and_notified`,
`stale_reentry_authorization_is_refused`, and `active_production_operation_defers_audit`.

## Production Recovery Readiness (Phase 5B)

**Production Recovery Readiness** is the live read-only recovery drill. It does not roll production back; it proves
whether the evidence and control plane needed for a safe recovery are currently available.

A result of `ready` means the current production identity is healthy, the managed Release baseline is exact, the
current rollback workflow still carries the trusted Phase 3D execution contract, and the immediately previous
managed Release/tag is an exact reachable rollback target.

A valid `ready_quarantined_*` result means a real automated rollback incident is already open and its existing
Phase 3D quarantine/target was re-proven. Follow the Phase 4B re-entry process; do not attempt another automatic
promotion around it.

`limited_bootstrap_no_previous_release` is expected while v1.8.0 remains the only managed production Release.
There is no safe earlier managed version for `Production Rollback` to select. Do not substitute old milestone
tags or an arbitrary SHA. Once a later managed production Release is created, the live drill will require its
previous managed Release to resolve exactly and sit on the `main` lineage.

`deferred_*` states are non-failures: an active production mutation or a moving `main` made the snapshot
transient. A later push/scheduled run re-evaluates the state.

Any `failed` result means recovery readiness is not proven. Inspect the
`production-recovery-readiness/context.json` artifact and repair the broken invariant through the normal PR
path. The drill never uses production DB credentials; database compatibility remains an execution-time rollback
gate, not a read-only drill claim.

## Production Automation Watchdog (Phase 5C)

**Production Automation Watchdog** is a read-only observer. Every 15 minutes (and on `main` pushes / manual
dispatch) it looks for production automation that is stuck or has silently stopped running. It never cancels,
reruns, dispatches, approves, deploys, migrates, or rolls back anything, and it holds no production credentials.
A watchdog Issue is only a pointer to a human decision.

Watchdog issues use the single thread `watchdog:production-automation` and carry the Phase 4C severity:

- **active_within_budget** (no issue) — a Production Release/Rollback or control-plane run is active but younger
  than its budget. Normal; nothing to do. A healthy/active result closes an existing watchdog issue.
- **degraded** (warning) — a production operation has been queued/waiting/pending longer than **30 minutes**
  (often an unanswered Environment approval or a blocked concurrency slot), or a scheduled safety heartbeat is
  stale: Deploy Health Check **45 min**, Production Release Audit **7 h**, Production Recovery Readiness **26 h**,
  Release Resilience Drill **8 days**. A stale heartbeat means the scheduler or workflow stopped running; a recent
  completed *failure* still counts as alive because failures are handled by their own notifications.
- **critical** — a Production Release/Rollback has been `in_progress` longer than **45 minutes**, or a
  control-plane workflow (stabilization, auto-rollback request, re-entry, notify, audit, readiness) has been
  active longer than **20 minutes**. This is a conservative observation threshold: explicit job timeouts are 10 minutes (stabilization, auto-rollback request, re-entry) and 15 minutes (audit, recovery readiness), and Production Operations Notify sets none.
- **unproven** (critical) — GitHub state was missing, malformed, from the wrong repository/path, or unreadable.
  Absence of proof is never treated as healthy.

Repeated identical conditions do not add comments: the notifier compares a fingerprint of the finding set against
the latest *trusted notification artifact* (never the Issue text). A new stuck run, changed finding set, severity
change, or recovery produces an update.

Human response to a stuck Production Release or Rollback:

1. **First determine whether production mutation has begun** — open the run, read which steps completed
   (Railway deploys, migration step, verification), and check live runtime identity.
2. **Do not blindly cancel or re-run it.** A run that may have partially mutated production can leave API, Web
   and database out of step; cancelling or retrying can make that worse.
3. Database mutation ambiguity is human-only. Never use `supabase migration repair`, edit migration history, or
   run reverse migrations to "unstick" a run.
4. The existing evidence, quarantine, and Phase 4B re-entry procedures remain authoritative. If a rollback is
   warranted, use the trusted Production Rollback path, not a workaround.
5. For a stale heartbeat, check Actions for a disabled workflow, a GitHub scheduler delay, or a broken workflow
   file, and fix it through a normal PR.

The Phase 4D audit still reports `deferred_active_production_operation` while a production operation is active;
the watchdog is what tells you when that deferral has lasted too long. Evidence is the
`production-automation-watchdog/context.json` artifact (schema `patelrep.production-automation-watchdog.v1`,
90-day retention), uploaded before an unhealthy run is failed.

## Production Readiness Certification (Phase 5D)

**Production Readiness Certification** is a read-only, manually dispatched attestation. It holds no production
credentials and adds no authority: it cannot deploy, roll back, tag, release, approve, cancel, rerun, dispatch, or merge,
and its result never authorizes any of those. Run it from `main` after a control-plane merge once Deploy Health, Release
Audit, Recovery Readiness and the Watchdog have completed on the new main and the Release Resilience Drill has been
dispatched on it (7/7).

Read the `production-readiness-certification/context.json` artifact (or the step summary) for the state and `reason_code`:

- **certified / certified_with_limitations** - workflow succeeds. For the current single-release bootstrap the only
  expected limitation is `no_previous_managed_release`: there is no previous managed Release to roll back to yet. This is
  real, not an error. Do not manufacture a release to remove it.
- **unproven / main_moved_during_certification** - a new commit landed mid-run. Wait for the new main's checks and
  re-dispatch; the old SHA is never certified.
- **unproven / `*_evidence_missing`, `*_evidence_incomplete`, `*_artifact_unavailable`** - the named workflow has not
  completed on this exact main SHA yet (or its artifact expired). Wait for/dispatch that workflow, then re-dispatch.
- **not_certified / `*_evidence_stale`** - Deploy Health > 45 min, Watchdog > 30 min, Audit > 7 h, Readiness > 26 h,
  or Drill > 8 days. Let the scheduled/push run refresh (or dispatch the drill), then re-dispatch.
- **not_certified / `watchdog_not_healthy`, `watchdog_active_operations_present`** - a production operation is active or
  automation is unhealthy. Resolve through the Watchdog runbook above; certification only passes while quiescent.
- **not_certified / `release_audit_*`, `recovery_readiness_*`** - follow the Phase 4D audit / Phase 5B readiness
  procedures; a quarantine, open incident, or required re-entry must be resolved by the existing human procedures.
- **unproven / `staging_candidate_context_missing`** - the trusted `staging-candidate-context` artifact for this exact
  candidate is absent or expired (3-day retention). It is mandatory and cannot be reconstructed from the Staging Gate
  summary, so certification fails closed; it cannot be fixed by re-dispatching. Only `[]` and
  `["no_previous_managed_release"]` can ever certify.
- **not_certified / `candidate_tree_mismatch`** - current main's content is not exactly what was staged. Treat as a
  release-integrity problem and investigate how main was changed; never override.

A failed certification is not an incident by itself and creates no Issue. Never use `supabase migration repair`, edit
migration history, cancel or rerun a production run, or dispatch Production Release/Rollback/Re-entry to "fix" a
certification result.

## Automated Production Release request (Phase 2D)

A Production Release run may appear that was *requested by automation* (run name `Production Release <sha> (automated request from run <id>)`, dispatched by `patelrep-release-engineer[bot]`). It only exists for a low-risk recovery fix of a failed `Deploy Health Check` of the current production baseline, and only while the owner has set `PRODUCTION_AUTO_RELEASE_ENABLED=true`. **There is no separate Environment approval: once requested, the run proceeds on its own trusted gates.** To stop automatic requests, unset `PRODUCTION_AUTO_RELEASE_ENABLED`; review the recovery PR and release content summary afterwards. The run re-verifies its provenance and fails before touching production if anything changed (main moved, baseline changed, ruleset weakened, switch turned off).

- Automatic requests are declined when the live production identity (public `/health` + web meta) differs from the newest managed Release, e.g. after you roll back by hand, or when `Deploy Health Check` has since succeeded on the same commit. Either way a human decides.
- To stop automatic requests immediately: set `PRODUCTION_AUTO_RELEASE_ENABLED` to anything other than `true` (or delete it). Manual releases are unaffected.
- If a release fails or partially deploys, automatic rollback occurs only for the narrow Phase 3C/3D zero-migration, low-risk, exact-identity case. Every other failure stays manual: fix forward through a normal PR and deliberate release, or run Production Rollback by hand.
- `release version: ... exists without a completed production GitHub Release` means a `vX.Y.Z` tag exists with no completed GitHub Release (an interrupted or manually created tag). The workflow never skips or deletes tags: find out why the tag exists, then fix it deliberately (e.g. complete or remove the orphan tag by hand) before releasing again.
- The very first managed release is `v1.8.0` and must be dispatched manually; automated requests stay ineligible until a completed `vX.Y.Z` GitHub Release exists.

## Known release-safety risk (as of this phase)

The `staging` GitHub Environment currently has no configured variables or secrets (a pre-existing gap from Phases 4–5, not introduced here). Until an administrator configures it per [ENVIRONMENTS.md](ENVIRONMENTS.md), `Staging Candidate` cannot actually run, which means no commit can currently produce a real `Staging Gate` success — and Production Release's eligibility check will correctly refuse every release until that is fixed. This is the safe failure direction (refuse rather than skip verification), not a bug in this workflow.
