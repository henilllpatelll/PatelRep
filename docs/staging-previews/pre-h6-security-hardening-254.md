# Staging preview review: pre-H6 security hardening, migration 254

This document reviews registry entry `pre-h6-security-hardening-254` in `supabase/staging-reviewed-migrations.json`
(issues #230 and #231).

- **Merging the entry applies nothing.** It only records the review.
- **Applying needs two more steps:** a dispatch of the Staging Reviewed Migration Preview workflow that restates the
  digest, and a `staging-migration-approval` environment approval.
- **Before that approval,** a human must separately confirm the staging backup and recovery capability (see
  [Recovery](#recovery)).

Background: `docs/STAGING_REVIEWED_MIGRATION_PREVIEW.md`. Implementation review: PR #233's
`docs/agent-harness/pre-h6-security-hardening-230-231.md`.

| Field | Value |
|---|---|
| PR | #233 `security/agent-harness-audit-approval-hardening` → `main` |
| Pinned head SHA | `d2b6b7ea702b41e76aebe6d1708ae5d031d19ee7` |
| Expected staging history head | `253` (H5). Applied by preview run 43743361369 (`Applied 251…`, `252…`, `253_agent_h5_gateway_tools.sql`, `Status: CLEAN`, 18/18 postconditions). Re-proven by Staging Candidate run 43991581020 (PR #232 @ `941cbc13`, migrations through 253): `179 mirrored history versions, 0 pending migration(s)`, `Status: CLEAN`. |
| Control-plane prerequisite | PR #232 merged as `28d64352` (2026-11-17T01:30:44Z). CI and Staging Candidate now call `agent_audit_privileges_enforce()` in the same transaction as their blanket table grant, guarded by `to_regprocedure`, so they keep working before and after 254. |
| Approval window | 2026-11-17T00:00:00Z to 2026-11-24T00:00:00Z (7 days) |

## Approved file

The digest is the SHA-256 of the file with CRLF normalized to LF, computed with `scripts/check-migrations.mjs` `sha256`.

| File | SHA-256 | Matches `DESTRUCTIVE_PATTERN` |
|---|---|---|
| `254_agent_audit_integrity_and_independent_approval.sql` | `e0adbfd24a0ebc5623fc379f97dc5a8b69ba80a14ee3606754a01445838c4362` | yes (`TRUNCATE` keyword only) |

The file is LF in git, so a plain hash matches. Verify it yourself before approving:

```bash
git show d2b6b7ea702b41e76aebe6d1708ae5d031d19ee7:supabase/migrations/254_agent_audit_integrity_and_independent_approval.sql | sha256sum
```

PR #233 changes nothing else under `supabase/`. Every migration through 253 is byte-identical to `main`.

## Why a preview is needed

Staging Candidate run 43995557128 (PR #233 @ `d2b6b7ea`) failed at *Prepare persistent staging database* with:

> `Refusing to auto-apply destructive pending migration(s) to persistent staging: 254_agent_audit_integrity_and_independent_approval.sql`

The pattern matches only because the file contains `BEFORE TRUNCATE` triggers and `REVOKE TRUNCATE`.

**254 drops, renames or deletes nothing.** It drops no table, column, row, index, constraint, policy or existing function
body. `DROP TRIGGER IF EXISTS` is used only on its own new trigger names, which do not exist at 253 (precondition
`hardening_objects_absent`). It only adds restrictions.

## Exact effect

| # | Change | Objects |
|---|---|---|
| 1 | A reviewed registry of the protected harness tables | `agent__audit_protected_tables()`: 31 rows, 11 with `append_only = true` |
| 2 | Privilege-independent TRUNCATE refusal | `agent__refuse_truncate()` plus one `BEFORE TRUNCATE … FOR EACH STATEMENT` trigger `agent_refuse_truncate` on each of the 31 tables |
| 3 | Least privilege, re-assertable after any blanket grant | `agent_audit_privilege_violations()` and `agent_audit_privileges_enforce()`. The migration runs the enforce function once. |
| 4 | DB-enforced independent approval | `agent__guard_approval_independence()` (`BEFORE INSERT OR UPDATE` on `agent_tool_approvals`) and `agent__guard_execution_approval()` (`BEFORE INSERT` on `agent_tool_executions`) |
| 5 | Function privileges | All six new functions: `SECURITY INVOKER`, `search_path = ''`, and `REVOKE ALL` from `PUBLIC`, `anon`, `authenticated` and `service_role` (owner-only) |
| 6 | Read-only report | A `DO` block that only counts and prints a `NOTICE` about legacy approval rows. It rewrites nothing. |

### The 31 protected tables

**A** marks the 11 append-only tables: every UPDATE and DELETE is already refused by a row trigger (a tenant-deletion
cascade excepted), so the backend needs only SELECT and INSERT on them.

| Phase | Tables |
|---|---|
| H1 (238) | `agent_runs`, `agent_run_steps`, `agent_run_events` **A**, `agent_runtime_controls`, `agent_worker_heartbeats` |
| H2 (241) | `agent_execution_enablement`, `agent_tool_controls`, `agent_tool_grants`, `agent_tool_invocations` **A**, `agent_tool_approvals`, `agent_tool_executions` **A**, `agent_tool_events` **A** |
| H3 (244, 247) | `agent_model_enablement`, `agent_model_price_schedules`, `agent_model_budget_policies`, `agent_model_budget_counters`, `agent_model_attempts`, `agent_model_spend_events` **A**, `agent_planning_runs` |
| H4 (248, 250) | `agent_customer_billing_controls`, `agent_customer_pricing_policies`, `agent_customer_overage_authorizations` **A**, `agent_customer_credit_holds`, `agent_billing_operations`, `agent_customer_credit_charges`, `agent_customer_billing_events` **A**, `agent_billing_operation_events` **A**, `billing_trueup_operations`, `billing_trueup_operation_events` **A** |
| H5 (252) | `agent_planning_events` **A**, `agent_proposal_handoffs` **A** |

These are exactly the `public` tables named `agent_*` or `billing_trueup_*`. A precondition and a postcondition check
this, and so does the schema contract.

The 11 append-only tables keep their existing guards, which are pinned by body hash before and after:

- `agent__guard_event_immutable`: `agent_run_events`
- `agent__guard_overage_authorization`: `agent_customer_overage_authorizations`
- `agent__guard_tool_immutable`: the other nine

### Effective privileges

| Role | At 253 (Supabase default privileges) | After 254 |
|---|---|---|
| `service_role`, 20 mutable tables | ALL (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`) | the same **minus `TRUNCATE`** |
| `service_role`, 11 append-only tables | ALL | the same **minus `TRUNCATE`, `UPDATE` (including column-level) and `DELETE`** |
| `anon`, `authenticated`, `PUBLIC` | none (revoked by H1–H5) | none |
| `postgres` (owner, migration runner) | owner | owner. Triggers still fire for the owner: TRUNCATE is refused for everyone, the owner included. |

Two kinds of DELETE still work:

- **Tenant-deletion cascades** through the append-only tables. PostgreSQL runs FK cascade actions as the table owner,
  and the existing guards already allow them.
- **The service-role API's hotel offboarding.** PR #233's real-DB tests cover both
  (`test_normal_writes_reads_and_tenant_deletion_cascade_still_work_under_least_privilege` and
  `test_hotel_offboarding_through_the_service_role_api_still_cascades_append_only_history`).

### TRUNCATE refusal

**Why a trigger.** Row triggers never fire for `TRUNCATE`. CI and Staging Candidate also re-run
`GRANT ALL ON ALL TABLES … TO service_role` on every run. So privileges alone cannot be the control.

**What the trigger does.** `agent_refuse_truncate` is a statement-level `BEFORE TRUNCATE` trigger (`tgtype = 34`)
that raises `P0001`.

- It fires for every role, the owner included.
- It also fires for tables reached through `TRUNCATE … CASCADE`. Rehearsed: `TRUNCATE public.tenants CASCADE` is
  refused at `agent_runs`.

**Compatibility.** No CI, staging or fixture tooling uses `TRUNCATE`.

- `staging-candidate-workflow.test.mjs`, `staging-migration-apply-workspace.test.mjs` and
  `staging-reviewed-migration-preview-workflow.test.mjs` already forbid it.
- `apps/web/e2e/fixtures/seed-staging-tenant.mjs` never touches agent tables.

### Independent approval enforcement

**Before 254.** `approver_may_be_initiator` was supplied by the worker. The database enforced only:

- 241's CHECK `agent_tool_approvals_independent`:
  `approver_may_be_initiator OR state <> 'approved' OR decided_by_user_id IS DISTINCT FROM initiated_by_user_id`
- 241's `agent__guard_approval_update`, which freezes the binding columns (the flag, roles and expiry included).

**After 254.** Independence is derived from the reviewed `agent__gateway_tool_spec` risk (253). Unknown risk counts as
not low, so the rule fails closed.

| Write | Rule |
|---|---|
| Approval INSERT | Every condition must hold, or the insert is refused: <br>• the spec exists, has `access = write`, and its risk is `low`, `medium` or `high`; <br>• for `medium`/`high`, `approver_may_be_initiator` is false; <br>• `required_approver_roles` equals the spec roles; <br>• every binding column equals the invocation's (same tenant). |
| Approval UPDATE to `approved` | The decider is not null. For `medium`/`high` it is not the initiator. A tool that left the allowlist cannot be approved. |
| Approval consumption | The approval is approved, unexpired and independent, and the consuming ledger row is this approval's own execution (same tenant and invocation). |
| Execution INSERT | The row must bind its invocation exactly. A `succeeded` write needs an approved, unconsumed, unexpired, exactly bound and independent approval. `failed` rows are unchanged, because they cause no side effect. |

Every reviewed write is `medium` or `high`:

- `engineering.work_orders.assign` v2: medium
- `housekeeping.room_assignments.assign` v1: high

So no write in the allowlist can be self-approved. The existing `agent_tool_request_approval` and
`agent_tool_approval_decide` bodies are pinned unchanged (md5), before and after.

## Security review

| Area | Result |
|---|---|
| Privilege widening | **None.** 254 only revokes rights and adds refusal triggers. No GRANT, no new role, no SECURITY DEFINER function. The six new functions are owner-only. |
| Tenant isolation | Unchanged and strengthened. Both guards look up invocations, approvals and executions by `(id, tenant_id)`. All 31 tables keep RLS on with no policy, and stay closed to `anon`, `authenticated` and `PUBLIC`. Composite tenant FKs are untouched. |
| Data | No existing row is rewritten. The new rules apply to the next write. At 253 the preconditions require that no approval is self-approvable, pending, or approved-but-unconsumed. |
| Default off | 254 changes no switch. `agent_execution_enablement`, `agent_model_enablement` and H4 billing (`disabled`, true-up off) are probed off before and after. `AGENT_GATEWAY_EXECUTION_ENABLED` and `AGENT_ORCHESTRATOR_EXECUTION_ENABLED` stay unset. No worker is deployed. |
| Workflow interaction | Safe after 254, with no workflow change. Staging Candidate's grant step calls `agent_audit_privileges_enforce()` in the same statement batch (#232). Rehearsed: blanket grant + enforce leaves no violation, and a blanket grant without enforce is detected. |

Findings. None blocks this staging preview.

| # | Severity | Finding |
|---|---|---|
| F1 | low, residual by design | The table owner (`postgres`) and superusers can still do all of these: <br>• disable or drop the triggers; <br>• re-grant privileges; <br>• set `session_replication_role = replica`. <br>Application roles can do none of these. `app_roles_cannot_bypass_triggers` proves that `anon`, `authenticated` and `service_role` are not superuser, `CREATEROLE`, `REPLICATION` or members of `postgres`. Mitigation: the schema contract re-checks every trigger and privilege on each Staging Candidate, Staging Database Migrate and Production Release run. |
| F2 | low, pre-existing, follow-up | `service_role` keeps `TRIGGER` and `REFERENCES` on the 31 tables, from the platform default privileges. <br>• A compromised backend key could add (not disable) a trigger on an audit table. <br>• It could not remove rows or bypass the refusal triggers. <br>Recommended follow-up: a forward migration that also revokes `TRIGGER` (and `REFERENCES`) on the registry tables, plus a matching `agent_audit_privilege_violations()` rule. <br>This finding is derived from the default privileges recorded in the H5 review. It was not re-queried in this rehearsal (see [Not covered](#not-covered)). |
| F3 | info | `service_role` has `BYPASSRLS` on Supabase. This is unchanged and does not affect triggers or table privileges. |
| F4 | info | Low-risk policy still honours the stored flag. No low-risk write exists. Precondition and postcondition `reviewed_writes_*_medium_or_high_risk` fail if one appears. |
| F5 | info | `agent_audit_privileges_enforce()` fails closed (`42501`) when a forbidden right remains through another grantor or an inherited role. In that case 254 itself rolls back. Precondition `forbidden_rights_revocable_by_owner` refuses the apply first: every such ACL entry must have the owner as grantor, no column UPDATE grant may exist on an append-only table, and the app roles must have no role memberships. |

## Preconditions (18, read-only; the preview refuses unless all are true)

| Name | Proves |
|---|---|
| `staging_history_ends_at_h5_253` | All three H5 names are recorded, the newest numeric version is `agent_h5_gateway_tools`, and 254 is absent by version and by name. `assertStagingBase` separately proves the head is exactly 253. |
| `hardening_objects_absent` | None of the six functions or three trigger names exists. No statement-level TRUNCATE trigger exists on any of the 31 tables. |
| `harness_tables_are_exactly_the_31_reviewed` | All 31 exist, and they are the only `agent_*` or `billing_trueup_*` tables. |
| `harness_tables_owned_rls_on_no_policies` | All 31 are owned by `postgres`, have RLS enabled, and have no policy. |
| `harness_tables_closed_to_end_users` | `PUBLIC`, `anon` and `authenticated` hold none of the seven table privileges and no column privilege. |
| `service_role_backend_rights_present` | `service_role` has SELECT and INSERT on all 31, and UPDATE and DELETE on the 20 mutable tables. These are exactly the rights 254 keeps. |
| `forbidden_rights_revocable_by_owner` | Every TRUNCATE, UPDATE or DELETE ACL entry on the 31 tables was granted by the owner. No column-level UPDATE grant exists on an append-only table. `anon`, `authenticated` and `service_role` belong to no role, so nothing is inherited. |
| `app_roles_cannot_bypass_triggers` | The app roles are not superuser, `CREATEROLE` or `REPLICATION`, and are not members of `postgres`. |
| `append_only_row_guards_and_approval_guard_enabled` | All 11 append-only tables have an enabled `BEFORE ROW UPDATE OR DELETE` guard using one of the three reviewed functions. 241's `agent_tool_approvals_guard_update` is enabled. |
| `existing_approvals_fit_independence_rules` | No approval row breaks the new rules. Specifically, none is: <br>• flagged self-approvable; <br>• `requested`; <br>• approved but unconsumed; <br>• decided by its initiator; <br>• for a tool outside the reviewed allowlist; <br>• unbound to a same-tenant write invocation. <br>So no approval is in flight. |
| `existing_executions_fit_approval_rules` | Every execution has a same-tenant invocation. Every succeeded write has an approved, independent approval bound to it. |
| `reviewed_function_bodies_at_h5` | 36 functions, each with exactly one overload and an md5 equal to the reviewed bytes: H5's 32 post-apply pins plus the four guards 254 relies on. |
| `gateway_allowlist_is_exactly_reviewed_pins` | Exactly H5's ten pins resolve (H5's own probe, verbatim). |
| `reviewed_writes_are_medium_or_high_risk` | Exactly three agent/tool write combinations resolve, all `medium` or `high`. None is low. |
| `existing_grants_resolve_to_reviewed_pins` | Every tool grant resolves to a reviewed pin. |
| `execution_paid_calls_and_billing_disabled` | Gateway execution is off, paid calls are off, and H4 billing is `disabled` with true-up off (single rows). |
| `no_live_agent_worker_or_running_run` | No worker heartbeat is `starting`, `running` or `draining` within the last hour, and no run is `running` or `cancel_requested`. |
| `h1_queue_present_and_logged` | The H1 queue is logged and is the only queue. |

## Postconditions (20, read-only; checked right after the apply)

| Name | Proves |
|---|---|
| `hardening_recorded_by_name_after_h5` | 254 is recorded once under its approved name, it is the newest version, and all three H5 names are still recorded. |
| `hardening_functions_exact_and_owner_only` | The six functions match their md5 pins. Each has one overload and is INVOKER with `search_path=""`. None has a PUBLIC grant or EXECUTE for `anon`, `authenticated` or `service_role`. |
| `protected_registry_is_exactly_31_with_11_append_only` | The registry returns exactly the reviewed 31 `(table, append_only)` pairs, and they are still every harness table. |
| `truncate_refused_on_every_protected_table` | Each of the 31 tables has one enabled `agent_refuse_truncate` trigger with `tgtype = 34` on `agent__refuse_truncate()`. No other trigger uses either. |
| `append_only_row_guards_and_approval_guard_enabled` | Unchanged from the precondition. |
| `approval_independence_triggers_enabled` | Both new triggers are enabled with the exact `tgtype` (23 and 7) and function, and are used nowhere else. |
| `no_forbidden_privilege_effective` | `PUBLIC`, `anon`, `authenticated` and `service_role` cannot TRUNCATE any of the 31 tables. They cannot DELETE from, or UPDATE any column of, the 11 append-only tables. These checks use `has_table_privilege` and `has_any_column_privilege`, which follow role membership. `agent_audit_privilege_violations()` is empty. |
| `service_role_backend_rights_preserved` | Every legitimate backend write path still has its rights. |
| `harness_tables_owned_rls_on_no_policies`, `harness_tables_still_closed_to_end_users`, `app_roles_still_cannot_bypass_triggers` | Tenant isolation and role posture are unchanged. |
| `reviewed_function_bodies_unchanged`, `gateway_allowlist_still_exactly_reviewed_pins`, `reviewed_writes_still_medium_or_high_risk` | No reviewed body, pin or risk changed. |
| `existing_approvals_still_fit_independence_rules`, `existing_executions_still_fit_approval_rules`, `existing_grants_still_resolve_to_reviewed_pins` | Existing rows are unchanged and still valid. |
| `execution_paid_calls_and_billing_still_disabled`, `no_live_agent_worker_or_running_run_after_apply`, `h1_queue_still_logged` | Everything stays off. |

## Schema contracts on `main` (`scripts/schema-contracts.sql`)

The preview's apply job runs `main`'s copy against staging after the apply. So do Staging Candidate, Staging Database
Migrate and Production Release for every later candidate. This PR adds the 254 section, version-gated by migration
**name** (`agent_audit_integrity_and_independent_approval`) exactly like H5. CI and local replays record synthetic
version numbers; the names are identical everywhere.

| History | Required |
|---|---|
| 254 not recorded | Every earlier contract, H5 included, and **no** hardening function or trigger. |
| 254 recorded | Everything below: <br>• all three H5 migrations recorded; <br>• the six functions INVOKER, `search_path=""`, one overload each, not executable by `PUBLIC`, `anon`, `authenticated` or `service_role`; <br>• the registry exactly the 31 harness tables, 11 append-only; <br>• 31 enabled statement-level TRUNCATE refusals on the reviewed function; <br>• 11 enabled append-only row guards; <br>• both independence triggers with exact `tgtype` and function, and 241's update guard enabled; <br>• no forbidden privilege; <br>• every reviewed write still `medium` or `high`. |
| 254 recorded with incomplete H5, or history missing | **Fails closed.** |

**Difference from PR #233's copy.** This is PR #233's contract plus one line:
`NOT has_function_privilege('service_role', procs.oid, 'EXECUTE')`.

- **Why.** The rehearsal found that #233's copy accepted a hardening function re-granted to `service_role`. 254 revokes
  that right, and postcondition `hardening_functions_exact_and_owner_only` already pins it.
- **Why it is safe.** CI runs the contract *before* its blanket `GRANT EXECUTE ON ALL FUNCTIONS`, and no staging or
  production workflow grants functions.
- **Merge order.** When #233 is brought up to date after the preview applies, take `main`'s version of this file.

## Local rehearsal (throwaway local Supabase stack only; never staging or production)

**Setup.** Run on 2026-11-17 in an isolated stack `supabase_db_secpreview`, with project id `secpreview` and ports
5612x.

- **Services.** Only `db` and `auth`; every other service was excluded to bound memory.
- **CLI and psql.** CLI 2.75.0 (the workflow pins 2.112.0) and the PG18 `psql` client.
- **Source.** Built from `main` `28d64352` with `scripts/build-migration-replay-workspace.mjs`: 183 migrations, last
  `agent_h5_gateway_tools` (253).
- **Memory.** Available Windows RAM was 3.2 GB before start; the rule was not to start below 3 GB.

**Steps.**

1. **Registry and dispatch.**
   - `loadReviewedRegistry` validated four entries, with no file approved twice, and every probe passes the read-only
     filter.
   - `selectPreviewEntry` accepted the restated PR, SHA and digest.
   - `verifyCandidateFiles` hashed 254 from `git archive d2b6b7ea` to the approved digest.
2. **Preconditions.** Ran through `runProbes` with the workflow's exact runner flags
   (`SET default_transaction_read_only = on`): **18/18 PASS**.
3. **Probe sensitivity.** 30 injected violations, each in a rolled-back transaction, made the probes false or refused.
   The cases covered:
   - approval data: self-approvable, pending, approved-unconsumed, and succeeded executions without an approval or
     with a rejected one. A valid, independent, consumed approval still passes.
   - unresolvable grants; switches on; a live worker or running run;
   - a stray TRUNCATE trigger or hardening function; an extra harness table;
   - a policy added or RLS disabled; end-user table or column grants; backend rights removed;
   - a column UPDATE grant or a role membership for `service_role`;
   - a guard disabled or a body changed; an overload added; history at 254 or later; an extra queue.

   Two cases were already blocked by existing guards:
   - 241's CHECK `agent_tool_approvals_independent` refuses an approval decided by its initiator;
   - `postgres` cannot grant itself to `service_role`.
4. **Contract on the pre-254 state.** The new contract passed. It **failed closed** in 12 rolled-back cases:
   - 254 recorded without its objects, or with partial objects;
   - every 254 object applied but unrecorded;
   - only the TRUNCATE refusal, only the enforce function, or only a trigger name present;
   - 254 recorded with partial H5; no history table.

   Each case was tested once with the injected objects locked down, to prove the 254-specific gate catches it.
5. **Apply.**
   - `supabase db push --dry-run` proposed exactly `…_agent_audit_integrity_and_independent_approval.sql`.
   - The push applied it and recorded it by name. Its `NOTICE` reported 0 flagged and 0 self-decided approvals.
   - The copied file hashed to `e0adbfd2…4362`.
6. **Postconditions.** **20/20 PASS.** `main`'s new contract and PR #233's contract both pass on the migrated database.
7. **Contract on the post-254 state.** It **failed closed** in 22 rolled-back tampering cases:
   - TRUNCATE trigger: dropped on one table, disabled, or pointed at another function;
   - grants: TRUNCATE re-granted to `service_role`, to an inherited role or to `PUBLIC`; column UPDATE or DELETE on an
     append-only table;
   - triggers: the independence, execution or 241 update guard dropped or disabled; an append-only guard dropped;
   - functions: made `SECURITY DEFINER`, given a `search_path`, granted to `PUBLIC` or `service_role`, or overloaded;
   - registry: shrunk, or a new unregistered harness table;
   - history: the 254 record removed, or an H5 record removed.

   The `service_role` grant case is what found the gap fixed above.
8. **Behaviour** (rolled back):
   - **TRUNCATE.** Refused for `postgres` on append-only and mutable tables, and through `TRUNCATE tenants CASCADE`.
     For `service_role` it is denied by privilege.
   - **service_role on append-only tables.** UPDATE and DELETE are denied. SELECT and mutable-table UPDATE still work.
   - **Blanket grants.** The Staging Candidate grant + enforce sequence and the CI sequence (tables, sequences and
     functions + enforce) both leave no violation. A blanket grant without enforce is detected.
   - **Approvals.** A medium-risk self-approvable request is refused, and so are wrong roles and an initiator approving
     their own request. A valid request and an independent decision succeed.
   - **Executions.** A succeeded write without an approval is refused. A failed write row is still accepted.
9. **Planner.** `planStagingMigrations` with real version numbers:
   - without the allowance it refuses 254 as destructive;
   - with `reviewedAllowance` it plans exactly `["254_…"]`;
   - it refuses a tampered digest and an extra pending file.
10. **Replay refused.** Preconditions re-run after the apply: `staging_history_ends_at_h5_253` and
    `hardening_objects_absent` FAIL.
11. **Body pins.** The six new md5 pins and the four guard pins were computed from the dollar-quoted bodies in the
    migration files, independently of the database, and match the installed bodies. The extractor reproduces H5's
    reviewed pins exactly.
12. **Shutdown.** The stack was stopped with `docker stop`. All containers and volumes, and every other fixture stack's
    volumes, were preserved.

### Not covered

- **Staging data.** The rehearsal database had no agent rows, so the data-fit probes were trivially true there. Step 3
  showed they detect violating rows. On staging they check the real rows before anything is applied.
- **F2 privileges.** After the stack was stopped, available RAM was 1.8 GB, below the 3 GB rule. So the platform
  default privileges behind F2 (`TRIGGER` and `REFERENCES` on `service_role`) were not re-queried.
- **Inherited-grantor failure.** Behaviour on a fully migrated database with real writes is covered by PR #233's
  real-DB suites, including enforcement failing closed for an inherited right
  (`test_agent_audit_integrity.py`, `test_agent_approval_independence.py`).

## Recovery

- **No backup is taken.** The workflow takes no backup and cannot restore one. Before approving the
  `staging-migration-approval` deployment, a human confirms a recent restorable **staging** backup.
  - The last known one is `PatelRep-Staging-Backup-20261114-220001`, taken at head 243, so it predates H3, H4 and H5.
  - Take a fresh one at head 253 first.
- **Behavioural rollback.** None is needed. 254 only restricts, and every switch stays off.
- **Schema rollback.** A new, separately reviewed forward migration that drops a specific trigger or re-grants a
  specific privilege. Never reset or repair history.
- **Failed postcondition.** Treat it as a staging incident: inspect read-only, fix forward.
- **Push failure.** 254 is a single file, so a failure rolls back whole and records nothing. Re-dispatch the same entry
  only if staging still sits at 253 inside the window. Otherwise review a new entry.
- **If #233 is abandoned,** land this exact file on `main` (with a forward revert if unwanted), or staging stays ahead.

## Reviewer checklist

- [ ] Read 254 in full at `d2b6b7ea702b41e76aebe6d1708ae5d031d19ee7` and verify the digest
      `e0adbfd24a0ebc5623fc379f97dc5a8b69ba80a14ee3606754a01445838c4362`.
- [ ] Accept the restrictions: TRUNCATE refused on 31 tables; UPDATE/DELETE revoked on 11; risk-derived approval
      independence.
- [ ] Accept findings F1–F5 as non-blocking for staging (follow-up for F2).
- [ ] Review the `scripts/schema-contracts.sql` change: pre- and post-254 schemas both enforced, partial or
      inconsistent state fails closed, and the one line added to #233's copy.
- [ ] PR #233's head must stay `d2b6b7ea` until the preview applies. Once applied, 254 is frozen on staging, and #233
      must merge with this exact file.
- [ ] Before approving the environment: a fresh staging backup at head 253 is confirmed restorable. No other PR needs
      staging for the next hours.
