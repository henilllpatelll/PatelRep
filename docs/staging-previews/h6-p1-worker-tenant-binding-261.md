# Staging preview review: Agent Harness H6 P1, migration 261 (worker tenant binding)

This document reviews registry entry `h6-p1-worker-tenant-binding-261` in `supabase/staging-reviewed-migrations.json`.
The entry covers Agent Harness H6 P1: per-hotel worker credentials, the database's own environment identity, and RESTRICTIVE tenant gates.

- **Merging the entry applies nothing.** It only records the review.
- **Applying needs two more steps:**
  - a dispatch of the Staging Reviewed Migration Preview workflow that restates the digest;
  - a `staging-migration-approval` environment approval.
- **This PR also carries the 261-aware `scripts/schema-contracts.sql`.** As in #236 (H6) and #234 (254), `main`'s contract must know 261 before 261 reaches staging. Otherwise the apply job's trusted schema-contract step, and every later Staging Candidate, fails with `An Agent Harness function is SECURITY DEFINER`.
- **Do not dispatch until:**
  1. this PR is merged;
  2. a fresh staging backup at head 260 is taken and restore-verified (see [Recovery](#recovery));
  3. a read-only preflight shows all 13 preconditions true on live staging.

Background: `docs/STAGING_REVIEWED_MIGRATION_PREVIEW.md`.
Implementation review: PR #241 (supersedes #239), `docs/agent-harness/worker-identity.md`.

| Field | Value |
|---|---|
| PR | #241 `security/h6-p1-worker-tenant-binding-261` → `main` (draft, open). Supersedes #239 (closed, head `3e8f24d64c4c9a15a7e83f0ea17b2873b5eddeae`, review history kept there). |
| Pinned head SHA | `4ae45630420869154cf92db18f56e2d6a432b1ba` |
| Commits on `main` @ `df3a8d05` | `9b20d744` port of #239 (257 → 261) · `b8caf486` reconcile with 258–260 (independently source-reviewed: CONDITIONAL GO) · `c55f2510` + `4ae45630` **test-only** (deterministic SKIP LOCKED lock holder; POSIX-safe release) |
| Expected staging history head | `260` (186 rows). 259 and 260 were applied by Staging Candidate run 44582170353 (PR #235 @ `bf6c4db7`, drift `CLEAN 186/260`). |
| Base of #241 | `main` @ `df3a8d05545df70a7ad7d627347323c62845c49d`. Migrations 255–260 are byte-identical to `main`. |
| Approval window | 2026-11-19T00:00:00Z to 2026-11-26T00:00:00Z (7 days; the maximum is 14) |

## Approved files

| File | SHA-256 (registry, CRLF→LF) | Raw-bytes SHA-256 | Matches `DESTRUCTIVE_PATTERN` |
|---|---|---|---|
| `261_agent_worker_tenant_binding.sql` | `664c967259860ee474c068c55c39f0ea150f1d648957dcc3e85dfaf5709c0a1c` | same (LF only, 0 CR bytes) | yes, `TRUNCATE` keyword only (13 occurrences, all in `BEFORE TRUNCATE` refusal triggers and comments) |

```bash
git show 4ae45630420869154cf92db18f56e2d6a432b1ba:supabase/migrations/261_agent_worker_tenant_binding.sql | sha256sum
# 664c967259860ee474c068c55c39f0ea150f1d648957dcc3e85dfaf5709c0a1c
```

`scripts/schema-contracts.sql` in this PR is byte-identical to the PR head's copy: sha256 `dd93531d5016eec6ebbe8e40dedfa4a79084d0c203b64af618cb2697debb48a8`.

**The entry authorizes exactly one file.** The following were checked against the real `scripts/staging-reviewed-migrations.mjs` functions, and each is refused:
- restating an extra file (`262_*`);
- a different digest, or a different filename at 261;
- PR #239 or its head;
- a moved PR head, a closed PR, or a fork head;
- a tampered 261, or a second file at version 261;
- a second registry entry approving 261;
- staging at 259 or 261;
- any time outside the window.

After the apply, any later candidate whose 261 differs from the approved bytes is refused (`verifyReviewedBindings`). Result: 24/24.

## Why a preview is needed

- 261 matches `DESTRUCTIVE_PATTERN` only because of the keyword `TRUNCATE`: the two new registry tables get `BEFORE TRUNCATE` refusal triggers. `staging-migration-plan.mjs` therefore refuses to auto-apply it before any write.
- Staging Candidate verifies against `main`'s trusted contract. That contract fails on a 261 schema, because 261 adds the SECURITY DEFINER tenant source `agent__worker_tenant()`.

Expected and observed: Staging Candidate refuses PR #241 (fails closed). That refusal must not be bypassed or retried by hand.

## Exact database changes (forward-only; nothing dropped, renamed, deleted or rewritten)

| # | Object | Change |
|---|---|---|
| 1 | `agent_deployment_identity` (new) | One row max (`id = 1`), environment ∈ development/test/staging/production. RLS on, no policies. `service_role`: SELECT only. Written once by the table **owner** only, through the `agent_deployment_identity_guard` trigger. Immutable, and it cannot be truncated. **261 does not stamp it.** |
| 2 | `agent_worker_credential_scopes` (new) | Immutable credential → (hotel, environment) binding. FK to `agent_worker_credentials` `ON DELETE RESTRICT`; index on `tenant_id`. RLS on, no policies. `service_role`: SELECT, INSERT. It can only be created in the credential's own registration transaction (guard compares `xmin`). It cannot be re-bound, deleted or truncated. |
| 3 | `agent_worker_credentials_environment_guard` (new trigger) | New credentials live at most 7 days (the 255 31-day CHECK stays as the outer bound). |
| 4 | `agent__worker_tenant()` (new, SECURITY DEFINER, `search_path=''`) | The only source of worker tenancy. It returns a hotel only when all of these hold: `role = agent_worker`; the jti is registered, active, unexpired, with a lifetime ≤ 7 days; the credential is bound; the environment equals the stamp; the hotel is active; the stamp is not production; and there are no person/hotel claims. EXECUTE: `agent_worker` only. |
| 5 | `agent__worker_credential_ok()` (redefined) | Now means exactly `agent__worker_tenant() IS NOT NULL`. As a result, every 255 policy and every wrapper's `agent__worker_assert()` requires a bound credential. |
| 6 | `agent_worker_tenant_gate` (8 new RESTRICTIVE policies) | `TO agent_worker`, `USING (<tenant column> = (SELECT agent__worker_tenant()))`, `WITH CHECK (false)`, on `tenants`, `user_profiles`, `user_roles`, `work_orders`, `rooms`, `room_status`, `room_assignments` and `room_occupancy_discrepancies`. Other roles are unaffected. |
| 7 | 23 `agent_worker_rpc__*` wrappers (re-created, same signatures) | Each refuses a run, invocation, step, attempt or tenant argument outside the bound hotel (`agent_worker_tenant_mismatch`). EXECUTE: `agent_worker` only. |
| 8 | 4 scoped copies (new, owner-only) | `agent__run_claim_scoped`, `agent__runs_recover_scoped`, `agent__tool_approvals_expire_scoped` and `agent__model_attempts_recover_scoped`: the original body plus pinned tenant substitutions. The originals are **unchanged** for service_role. |
| 9 | `agent_worker_credential_register_v2` (new) | Register and bind atomically (service_role). The 255 unbound `agent_worker_credential_register` now refuses. |
| 10 | `agent_worker_privilege_violations()`, `agent__audit_protected_tables()` | Strict supersets. The registry goes from 33/12 to **35/14** (append-only). |
| 11 | `agent_audit_privilege_violations()` / `agent_audit_privileges_enforce()` | The 259 / 258 bodies plus the P1 matrix rows and helper revokes. 258's universe-wide allowlist, the structural TRIGGER/REFERENCES/MAINTAIN check and 259's "no DELETE for any application role" are kept. |

- Not touched: 255–260 files and the 259 DELETE guards / 260 UPDATE guards and journal.
- `$require$` refuses unless the detector, remover and journal are exactly the 259 / 258 / 260 bodies. A second apply is refused.
- `$post$` re-checks the 35-table minimum before and after the remover, with violations 0/0, no DELETE, and guards 7 + 4.

## Security implications and privilege boundaries

- **Tenant isolation.** A worker token reads only its bound hotel. The RESTRICTIVE gates are ANDed with every permissive policy, including the legacy `TO public` hotel_id policies. A revoked, expired, unregistered or unbound token reads nothing. No JWT claim can steer tenancy, because claims other than role/jti are refused.
- **No production worker in P1.** A stamp of `production` never grants tenancy. Unstamped means no worker access. The stamp is an owner-only, reviewed runbook step; it is **not** part of this preview.
- **Least privilege.** The new helpers are owner-only, and the tenant source is executable only by `agent_worker`. `service_role` gains SELECT on the identity and SELECT/INSERT on scopes, and nothing else. No role gains DELETE, UPDATE, TRUNCATE, REFERENCES or TRIGGER on either table.
- **Unaffected:** `service_role` and authenticated hotel users (the policies name only `agent_worker`).
- **Kill switch unchanged:** `REVOKE agent_worker FROM authenticator`.
- **Default-off:** no credential, binding, stamp, switch or worker deployment is created. Agent execution, paid model calls, customer billing and the Control Center flag stay disabled.
- **Inherited and unchanged:** the residual H6 findings tracked privately (actor attribution, SQL approval audit, non-agent TRUNCATE). 261 neither fixes nor widens them.

## Preconditions (13, read-only; the preview refuses unless all are true)

| Probe | Proves |
|---|---|
| `staging_history_ends_at_260` | Head names are 260, 259, 258; 255–260 are each recorded once; 261 is absent |
| `p1_objects_absent` | No P1 table, index, function, gate policy or trigger exists |
| `replaced_detector_remover_and_journal_are_reviewed_258_259_260` | 261 will replace exactly `9b368df4…` / `37248313…` / `30071c96…`, and the 259/260 guard functions exist |
| `reviewed_function_set_at_260_exact` | The 44 existing functions under the 55 reviewed names match digest `d4a322f1…`. The digest covers identity args, CR-stripped body md5, definer flag, config, owner and **ACL**, over every overload. |
| `delete_and_update_guards_intact` | 7 `agent_control_delete_guard` + 4 `agent_control_update_guard` triggers are enabled |
| `protected_registry_is_exactly_33_with_12_append_only` | The exact registry, and no unregistered `agent_*` table |
| `privilege_contracts_clean_and_no_delete` | Both violation detectors return 0 rows; no application role has DELETE |
| `gate_tables_and_tenant_columns_present` | All 8 gate tables have the uuid tenant column, and no gate exists yet |
| `agent_worker_role_restricted` | NOLOGIN/NOINHERIT/no attributes, member of nothing, USAGE but not CREATE on `public` |
| `agent_worker_reachable_only_through_authenticator` | SET-only membership; no API role can become `agent_worker` |
| `no_worker_credential_issued` | Empty credential registry and journal events |
| `execution_paid_calls_billing_and_control_center_disabled` | Every switch is off |
| `no_live_agent_worker_or_running_run` | No live heartbeat and no running run |

## Postconditions (17, read-only; checked right after the apply)

| Probe | Proves |
|---|---|
| `p1_recorded_by_name_after_260` | 261 is recorded once, directly after 260 → 259 |
| `deployment_identity_unstamped_and_owner_only` | Owner postgres, RLS on, no policies, **0 rows**, service_role SELECT only, nothing for public/anon/authenticated/agent_worker |
| `credential_scopes_empty_append_only` | Same, with SELECT/INSERT only, 0 rows, tenant index present |
| `p1_guard_triggers_exact` | 5 triggers (identity guard, 2 × refuse_truncate, scope guard, credential environment guard): exact type, function, enabled |
| `tenant_gates_exactly_8_restrictive` | 8 RESTRICTIVE `FOR ALL TO agent_worker` gates with the exact USING expression and `WITH CHECK (false)`, and no others |
| `reviewed_function_set_after_261_exact` | All 55 reviewed functions match digest `db094698…` (same fields as above, including ACL). An extra overload or EXECUTE grant fails it. |
| `detector_remover_261_and_journal_260_bodies` | `2dfcdf8e…` / `d0f41069…` / `30071c96…` |
| `tenant_source_and_helpers_not_callable_by_api_roles` | Tenant source executable only by agent_worker; helpers by nobody |
| `worker_wrappers_23_worker_only` | 23 wrappers, EXECUTE agent_worker only |
| `protected_registry_is_exactly_35_with_14_append_only` | Registry 35/14 |
| `privilege_contracts_clean_and_no_delete_after_apply` | Violations 0/0, no DELETE |
| `delete_and_update_guards_intact_after_apply` | 7 + 4 guards |
| `agent_worker_role_still_restricted`, `agent_worker_still_reachable_only_through_authenticator` | Role boundary unchanged |
| `no_worker_credential_binding_or_stamp_issued` | 0 credentials, 0 bindings, no stamp |
| `execution_paid_calls_billing_and_control_center_still_disabled`, `no_live_agent_worker_or_running_run_after_apply` | Still default-off |

## Local rehearsal (throwaway containers only; never staging or production)

Staging-shaped database built in a `--network none`, 900 MB `supabase/postgres:17.11.0.006` container:
- source: the verified head-258 staging backup `PatelRep-Staging-Backup-20261119-174130` (30/30 checksums OK);
- then `main`'s 259 and 260;
- then the exact Staging Candidate fixture grant (read from `staging-candidate.yml`);
- result: head 260, 186 rows, which equals live staging.

| Step | Result |
|---|---|
| Contract at 260: `main`'s / this PR's | exit 0 / **exit 0** (the proposed contract is safe to merge before 261 is applied) |
| Preconditions at 260 | **13/13** |
| Postconditions at 260 | Only the 7 invariants pass; every 261-specific probe fails (correct) |
| Apply 261 (single transaction + history row, as the preview does) | exit 0, head 261, 187 rows |
| Postconditions at 261 / after a second Staging Candidate fixture grant | **17/17** / **17/17** |
| Preconditions at 261 | 7/13 (all 261-sensitive probes flip) |
| Contract at 261: `main`'s / this PR's (also after the fixture grant) | exit 3 `An Agent Harness function is SECURITY DEFINER` / **exit 0** |
| Re-apply 261 | refused: `migration 261 requires the reviewed migrations 258, 259 and 260` |
| Mutations (rolled back) | Helper EXECUTE to service_role, extra `agent_run_claim` overload, permissive gate, UPDATE on scopes, scope guard disabled: **all five fail their postcondition** |

PR #241's own test evidence:
- integration suite on the CI-identical pristine replay;
- 31-fault contract catalog;
- API and node suites;
- the 258 → 261 staging-shaped upgrade (from the #239 restack review).

### Not covered
- The live staging ACLs are compared through the precondition digests. A hosted ACL difference (for example a grantor) makes `reviewed_function_set_at_260_exact` fail closed. The fix is to re-measure in the read-only preflight and re-review, never to edit the probe at dispatch.
- The HTTP path (PostgREST/GoTrue) is not exercised on the staging-shaped restore. It is covered on the pristine stack by the integration suite.

## Staging rollout plan (each step needs its own explicit human request)

1. Independent review of this PR. A human merges it (it applies nothing; `main`'s contract becomes 261-aware and passes at 260).
2. Confirm that `main`'s Staging Candidate is still green at 260 after the merge (contract exit 0, `CLEAN 186/260`).
3. Take a fresh staging backup at 260 and restore-verify it: checksums, a contract run on the restore, and a fingerprint.
4. Read-only preflight on live staging, inside an explicit `BEGIN READ ONLY` (the pooler ignores `PGOPTIONS`). Check that:
   - all 13 preconditions are true;
   - #241 is open at `4ae45630…`;
   - the window is open;
   - nothing is running in `staging-release-candidate`.
5. Dispatch once, restating `261_agent_worker_tenant_binding.sql=664c967259860ee474c068c55c39f0ea150f1d648957dcc3e85dfaf5709c0a1c`. The dry run must propose exactly 261.
6. Environment approval by the required reviewer only after reviewing the dry run, and only on explicit request.
7. After the apply:
   - 17/17 postconditions;
   - `main`'s contract passes;
   - violations 0/0;
   - Staging Candidate for #241 succeeds with `0 pending` and `CLEAN 187/261`.
8. Out of scope here: stamping the staging identity, issuing worker credentials, enabling execution, merging #241, and production.

## Recovery

- **Forward-only.** No row is changed or deleted, and the new tables are empty. A defect is fixed by a NEW reviewed forward migration, never by editing 261 (`verifyReviewedBindings` refuses a changed copy).
- **Immediate containment:** `REVOKE agent_worker FROM authenticator` (no worker credential exists anyway).
- **Full restore:** the fresh head-260 backup from rollout step 3, restored per `RESTORE-RUNBOOK.md` (fresh DB from template0, roles first, `pgmq.meta` row re-insert).
- **Failure modes:**
  - a failing precondition means nothing was applied: stop and re-review;
  - a failing apply means the single transaction rolls back: staging stays at 260;
  - a failing postcondition means 261 is applied: diagnose read-only, then fix forward or restore.

## Reviewer checklist

- [ ] The digest and head SHA match `git show 4ae45630…:supabase/migrations/261_agent_worker_tenant_binding.sql | sha256sum`.
- [ ] `scripts/schema-contracts.sql` equals the #241 head copy (`dd93531d…`) and passes at 260.
- [ ] The entry approves only 261, with base 260 and a 7-day window; the earlier entries are unchanged.
- [ ] Every probe is a single read-only SELECT (the registry validator passes).
- [ ] The precondition and postcondition digests were measured on a staging-shaped DB, not hand-edited.
- [ ] Nothing here dispatches, approves, merges #241, stamps an identity, issues credentials or enables AI.
