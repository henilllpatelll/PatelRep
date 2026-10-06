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

## Automatic rollback request decision (Phase 3C)

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

## Automated Production Release request (Phase 2D)

A Production Release run may appear that was *requested by automation* (run name `Production Release <sha> (automated request from run <id>)`, dispatched by `patelrep-release-engineer[bot]`). It only exists for a low-risk recovery fix of a failed `Deploy Health Check` of the current production baseline, and only while the owner has set `PRODUCTION_AUTO_RELEASE_ENABLED=true`. **There is no separate Environment approval: once requested, the run proceeds on its own trusted gates.** To stop automatic requests, unset `PRODUCTION_AUTO_RELEASE_ENABLED`; review the recovery PR and release content summary afterwards. The run re-verifies its provenance and fails before touching production if anything changed (main moved, baseline changed, ruleset weakened, switch turned off).

- Automatic requests are declined when the live production identity (public `/health` + web meta) differs from the newest managed Release, e.g. after you roll back by hand, or when `Deploy Health Check` has since succeeded on the same commit. Either way a human decides.
- To stop automatic requests immediately: set `PRODUCTION_AUTO_RELEASE_ENABLED` to anything other than `true` (or delete it). Manual releases are unaffected.
- If a release fails or partially deploys, automatic rollback occurs only for the narrow Phase 3C/3D zero-migration, low-risk, exact-identity case. Every other failure stays manual: fix forward through a normal PR and deliberate release, or run Production Rollback by hand.
- `release version: ... exists without a completed production GitHub Release` means a `vX.Y.Z` tag exists with no completed GitHub Release (an interrupted or manually created tag). The workflow never skips or deletes tags: find out why the tag exists, then fix it deliberately (e.g. complete or remove the orphan tag by hand) before releasing again.
- The very first managed release is `v1.8.0` and must be dispatched manually; automated requests stay ineligible until a completed `vX.Y.Z` GitHub Release exists.

## Known release-safety risk (as of this phase)

The `staging` GitHub Environment currently has no configured variables or secrets (a pre-existing gap from Phases 4–5, not introduced here). Until an administrator configures it per [ENVIRONMENTS.md](ENVIRONMENTS.md), `Staging Candidate` cannot actually run, which means no commit can currently produce a real `Staging Gate` success — and Production Release's eligibility check will correctly refuse every release until that is fixed. This is the safe failure direction (refuse rather than skip verification), not a bug in this workflow.
