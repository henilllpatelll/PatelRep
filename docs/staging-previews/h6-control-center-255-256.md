# Staging preview review: Agent Harness H6, migrations 255 and 256

This document reviews registry entry `h6-control-center-255-256` in `supabase/staging-reviewed-migrations.json`
(Agent Harness H6: least-privileged worker database identity and AI Control Center governance journal).

- **Merging the entry applies nothing.** It only records the review.
- **Applying needs two more steps:** a dispatch of the Staging Reviewed Migration Preview workflow that restates both
  digests, and a `staging-migration-approval` environment approval.
- **Blocker B1 is resolved by merging this PR.** It now also carries the H6 gate in `scripts/schema-contracts.sql`,
  as the H5 and 254 registry PRs did for theirs (see B1).
- **Do not dispatch yet.** Dispatch stays prohibited until (1) this PR is merged, so `main`'s trusted contract has the
  H6 gate, and (2) a fresh staging backup is verified (see [Recovery](#recovery)). Dispatching before the merge would
  apply 255/256 and then fail the apply job's trusted schema-contract step, and every later Staging Candidate.
- **Before the approval,** a human must separately confirm the staging backup and recovery capability (see
  [Recovery](#recovery)).

Background: `docs/STAGING_REVIEWED_MIGRATION_PREVIEW.md`. Implementation review: PR #235's
`docs/agent-harness/adr-0005-h6-control-center.md`, `threat-model-h6.md` and `worker-identity.md`.

| Field | Value |
|---|---|
| PR | #235 `feat/agent-harness-h6-control-center` → `main` (draft, open) |
| Pinned head SHA | `3474416086431e776e3a2e8fef3ddb91fff70452` |
| PR evidence | CI run 44058148135 for that exact head: `success`, including the full Database Migration Gate. Staging Candidate run 44059378216 for the same head refused by design: `Refusing to auto-apply destructive pending migration(s) to persistent staging: 255_agent_worker_database_identity.sql, 256_agent_control_center.sql`. Staging was not touched. |
| Expected staging history head | `254`. Applied by preview run 44007435406 (`Applied 254_agent_audit_integrity_and_independent_approval.sql`, `Status: CLEAN`, 20/20 postconditions, 2026-11-17T03:48Z). Re-proven by Staging Candidate run 44020264237 (`main` @ `01646ed8`, 04:54Z): `180 mirrored history versions, 0 pending migration(s)`, `Pending on staging: <none>`, `Status: CLEAN`. Later Staging Candidate runs for `main` @ `028d8df2` (44033671797, 44050372835, 44055680379) also succeeded. |
| Base of #235 | `main` @ `028d8df2` (#233 merged). Every migration through 254 is byte-identical to `main`. |
| Approval window | 2026-11-17T00:00:00Z to 2026-11-24T00:00:00Z (7 days; the maximum is 14) |

## Approved files

Each digest is the registry's SHA-256: the file **with CRLF normalized to LF**, computed with
`scripts/check-migrations.mjs` `sha256`. This is what `verifyCandidateFiles` and `verifyReviewedBindings` compare.

| File | SHA-256 (registry, CRLF→LF) | Raw-bytes SHA-256 | Matches `DESTRUCTIVE_PATTERN` |
|---|---|---|---|
| `255_agent_worker_database_identity.sql` | `819e0306a4d187bab33df5cb14a4fc4ad88a6fd129ad83eb71ff363896d718fa` | `967f1fccd21982a4a52cc0940cec364721166773dd0eda157f40529def045456` (differs: mixed line endings, see F1) | yes (`TRUNCATE` keyword only) |
| `256_agent_control_center.sql` | `3b4b24c40cb6f6cc4a8bc329e3d6f95e89725072f07cc596018b67cbff1a9a78` | same (LF) | yes (`TRUNCATE` keyword only) |

**The dispatch must restate the normalized digests above, not a plain `sha256sum` of 255.** Verify them yourself:

```bash
git show 3474416086431e776e3a2e8fef3ddb91fff70452:supabase/migrations/255_agent_worker_database_identity.sql | tr -d '\r' | sha256sum
# 819e0306a4d187bab33df5cb14a4fc4ad88a6fd129ad83eb71ff363896d718fa  (only CRLF pairs exist; no bare CR in the file)
git show 3474416086431e776e3a2e8fef3ddb91fff70452:supabase/migrations/256_agent_control_center.sql | sha256sum
# 3b4b24c40cb6f6cc4a8bc329e3d6f95e89725072f07cc596018b67cbff1a9a78
```

These were computed independently three ways and agree:

- from the local git blob;
- from the GitHub contents API at the pinned SHA;
- with `check-migrations.mjs` over a `git archive` of the pinned SHA.

PR #235 changes nothing else under `supabase/`. Its only other control-plane file is `scripts/schema-contracts.sql`,
which this PR brings to `main` (see B1).

## Why a preview is needed

Both files match `DESTRUCTIVE_PATTERN` only because of the keyword `TRUNCATE`:

- 255 adds a `BEFORE TRUNCATE` refusal trigger on its new credential registry.
- 256 adds a refusal trigger on its new journal. Its enforce function also issues `REVOKE TRUNCATE`.

**Neither file drops, renames, deletes or rewrites anything.** No `DROP`, `DELETE`, `UPDATE`, `ALTER … DROP`, `RENAME`
or `TRUNCATE` statement runs against existing data.

256 replaces three function bodies with strict supersets: the migration-254 registry, violations and enforce functions.
Their signatures, `SECURITY INVOKER`, empty `search_path` and owner-only grants are unchanged.

## Exact database changes

### 255: worker database identity

| # | Change | Objects |
|---|---|---|
| 1 | New role | `agent_worker`: `NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, member of no role. The DO block fails closed (`42501`) if a pre-existing role has any other attribute or a membership. |
| 2 | Reachability | `GRANT agent_worker TO authenticator`, so PostgREST can switch to it for a JWT whose `role` claim is `agent_worker`. |
| 3 | Credential registry | Table `agent_worker_credentials`: one row per token `jti`. <br>• Lifetime: at most 31 days (CHECK). <br>• Mutability: immutable except a single revocation (`agent_worker_credentials_guard`, BEFORE UPDATE OR DELETE). <br>• TRUNCATE: refused (`agent_refuse_truncate`). <br>• Access: RLS on, no policy. `service_role` has SELECT, INSERT and UPDATE; `PUBLIC`, `anon`, `authenticated` and `agent_worker` have nothing. |
| 4 | Credential check | `agent__worker_credential_ok()` (DEFINER, STABLE): `request.jwt.claims` has `role = agent_worker` and a UUID `jti` that is registered, unrevoked and unexpired. <br>`agent__worker_assert()` (DEFINER) raises `agent_worker_credential_invalid` (`42501`). |
| 5 | Operator RPCs | `agent_worker_credential_register`, `agent_worker_credential_revoke` and `agent_worker_credentials_list`: INVOKER, `service_role` only. They issue nothing by themselves. |
| 6 | Worker wrappers (23) | `agent_worker_rpc__<rpc>`: `SECURITY DEFINER`, `search_path=''`, EXECUTE for `agent_worker` only. Each calls `agent__worker_assert()` first, then the **unchanged** H1–H5 function with the same named arguments. <br>• 22 wrap: run claim, heartbeat, step complete/fail, acknowledge, runs recover, worker heartbeat; tool authorization snapshot, step context, request approval, record outcome, execute work-order assign, execute room assignment, approvals expire; planning step context, record plan, record context; billing reserve, dispatch, release, settle; model attempts recover. <br>• 1 wraps the new INVOKER `agent_runtime_controls_snapshot()` (`service_role` only), which replaces the worker's direct table read. |
| 7 | Column reads | `GRANT USAGE ON SCHEMA public` and column SELECT on 44 columns of 8 domain tables: `tenants`, `user_profiles`, `user_roles`, `work_orders`, `rooms`, `room_status`, `room_assignments`, `room_occupancy_discrepancies`. <br>Each table gets the permissive SELECT policy `agent_worker_read`, `TO agent_worker USING ((SELECT agent__worker_credential_ok()))`. No INSERT, UPDATE or DELETE anywhere. |
| 8 | Contract as data | `agent__worker_allowed_rpcs()` (23 names), `agent__worker_read_columns()` (44 pairs) and `agent_worker_privilege_violations()` (empty = compliant), all `service_role` only. A final DO block fails the migration if any violation exists. |
| 9 | Reload | `NOTIFY pgrst, 'reload schema'` |

### 256: AI Control Center

| # | Change | Objects |
|---|---|---|
| 1 | Governance journal | Table `agent_control_center_events`: append-only and metadata-only (detail ≤ 2 KB). FK to `tenants` `ON DELETE CASCADE`; NULL tenant = platform row. <br>• Immutability: `agent_control_center_events_immutable` refuses UPDATE, and DELETE unless the tenant is already gone. <br>• TRUNCATE: refused. <br>• Access: RLS on, no policy. Only `service_role` may SELECT; nobody has INSERT. <br>• Index: `idx_agent_control_center_events_tenant`. |
| 2 | Single writer | `agent__control_center_journal(...)`: DEFINER, executable by no role. |
| 3 | Journal triggers | `agent_control_center_journal`: AFTER INSERT OR UPDATE ROW, calling `agent__journal_control_change()` (DEFINER, no EXECUTE for anyone). Installed on 7 control tables: <br>• `agent_runtime_controls`, `agent_tool_grants`; <br>• `agent_execution_enablement`, `agent_model_enablement`; <br>• `agent_tool_controls`, `agent_customer_billing_controls`; <br>• `agent_worker_credentials`. <br>A no-op update writes nothing. |
| 4 | Refusal recorder | `agent_control_center_record_refusal(...)`: DEFINER, `service_role` only. Validates its reason code and subject type, and ignores unknown tenants. |
| 5 | 254 registry extended | `agent__audit_protected_tables()` now lists 33 tables, 12 append-only (adds the two H6 tables). <br>`agent_audit_privilege_violations()` also reports: <br>• INSERT on the journal by any app role; <br>• any `agent_worker` right on a protected table; <br>• EXECUTE on the journal writer; <br>• every `agent_worker_privilege_violations()` row. <br>`agent_audit_privileges_enforce()` also: <br>• revokes ALL on the 33 tables from `agent_worker`, and journal INSERT from app roles; <br>• revokes the writer's EXECUTE; <br>• revokes wrapper EXECUTE from `PUBLIC`, `anon`, `authenticated` and `service_role`. <br>It is run once and returned 33. |
| 6 | Read models (`service_role` only, INVOKER, filtered by `p_tenant_id` in SQL, bounded ≤ 100/200 rows) | `agent_control_center_overview`, `_runs_page`, `_approvals_page`, `_approval_facts`, `_grants` and `_events_page`, plus helpers `agent__control_center_run_json` and `agent__try_uuid`. New index `idx_agent_tool_approvals_tenant_created`. |
| 7 | Human controls (`service_role` only, INVOKER) | `agent_control_center_hotel_pause_set`: GM only. An operator-placed pause is locked against clearing from here. <br>`agent_control_center_run_control`: cancel and pause by GM or the run's initiator; resume by GM. Both re-read the caller's current role through H5's `agent__human_authority` and reuse H1's control functions. <br>Neither can enable execution, paid calls, billing or autonomy. |

**Switches.** Neither migration changes a switch. Gateway execution, paid model calls and customer billing stay
disabled. No `ai_control_center` flag row is created. No credential is issued. No worker is deployed.

## Security implications and privilege boundaries

| Principal | After 255/256 |
|---|---|
| `anon`, `authenticated`, `PUBLIC` | No access to either H6 table or any H6 function. They also gain nothing on the 31 existing harness tables. |
| `service_role` (API) | The Control Center read models and controls, the credential operator RPCs and the refusal recorder. It can read the journal but never write it directly (the triggers do). It has SELECT, INSERT and UPDATE on credentials (DELETE is refused by trigger). **It cannot execute any `agent_worker_rpc__*` wrapper.** |
| `agent_worker` (PostgREST JWT role) | **Functions:** EXECUTE on the 23 wrappers and on `agent__worker_credential_ok()`, which the RLS policies use. <br>**Reads:** SELECT on the 44 reviewed columns only. <br>**Nothing else:** <br>• no table privilege anywhere in `public` or `graphql_public`; <br>• no right on any harness table; <br>• no CREATE on `public`; <br>• no EXECUTE on any other DEFINER, `agent%`, `billing%`, `work_order_assign_apply` or `publish_assignment_batch` function. <br>So it cannot decide or revoke approvals, change grants, controls or enablement, change pricing, budgets or overage, or call domain write RPCs directly. Every wrapper and every read requires a registered, unrevoked, unexpired `jti`. |
| `authenticator` | Member of `agent_worker` with SET only (no INHERIT, no ADMIN), so it does not inherit the worker's rights. |
| `postgres` (owner) | Implicit ADMIN grant on `agent_worker` (no INHERIT, no SET), recorded by PG16+ for the creating role. |

Write paths stay behind the H1–H5 functions, unchanged and pinned by md5 before and after. So every tenant check, lease
fence, approval-consumption rule and migration-254 trigger still applies to the worker's writes.

Findings. **B1 is resolved by merging this PR**; dispatch stays prohibited until it is merged and a fresh staging
backup is verified. The others do not block this staging preview.

| # | Severity | Finding |
|---|---|---|
| B1 | **resolved by merging this PR** (blocks dispatch until then) | **`main`'s `scripts/schema-contracts.sql` had no H6 gate.** <br>After the apply, main's copy raises `An Agent Harness function is SECURITY DEFINER` (reproduced). The preview's apply job runs main's trusted copy right after the push. So does every later Staging Candidate (all PRs, including `main`), Staging Database Migrate and Production Release run. Dispatching before this PR merges would apply the migrations, pass the postconditions, then fail the apply job, and staging verification would be red for every PR. <br>**Resolution (this PR, scope expanded with approval, as for the H5 and 254 registry PRs):** <br>• Commit 1 brings PR #235's H6 contract change **byte-identical** to the pinned SHA's blob (version-gated by migration NAME, like H5 and 254). <br>• Commit 2 only **tightens** it, closing two gaps found in review (B1-a, B1-b below). It relaxes nothing, and #235's schema passes it. <br>**B1-a, SECURITY DEFINER allowlist (fixed):** #235's allowlist exempted definers by **name** only, and its wrapper check counted only pinned wrappers. So an allowlisted definer with a mutable `search_path`, or a new SECURITY DEFINER overload under an allowlisted or wrapper name (even one executable by `agent_worker`), passed. Now: the exemption requires `search_path=''`, and exactly 23 wrappers and 5 helper definers exist across **all** overloads, each pinned. <br>**B1-b, unrecorded H6 objects (fixed):** the not-recorded check matched only `agent_worker_rpc__*` / `agent_control_center_*` functions and the two tables. An orphaned `agent_worker` role (cluster-wide, so it survives a database-only restore) with `authenticator` membership and column reads, an INVOKER H6 helper, or an H6 trigger passed. They are now all refused by exact name. <br>Verification: see Rehearsal item 9. **Consequence for #235:** its own copy is now weaker than `main`'s. #235 must not change before the preview applies (its head stays `34744160`). After the apply, when #235 is brought up to date with `main`, it must take `main`'s `scripts/schema-contracts.sql` and keep 255/256 byte-identical. |
| F1 | low (process) | **255 has mixed line endings:** 247 of its 626 lines end in CRLF, and it is the only migration in the repository with CR bytes. <br>Effects: the registry digest is the LF-normalized one (`819e0306…`), while a raw `sha256sum` gives `967f1fcc…`. Every H6 body pin uses `md5(replace(prosrc, chr(13), ''))`, so the postconditions do not depend on whether the CLI keeps the CRs. <br>Recommendation: normalize to LF only if #235's head changes for another reason. Any head change needs a new entry anyway. The normalized digest would not change. |
| F2 | low, by design | **Cross-tenant reads.** The worker credential is platform-wide: `agent_worker_read` checks only the credential, so the worker can read the 44 reviewed columns for **every** tenant. <br>Tenant scoping of writes stays in the wrapped RPCs. A leaked token exposes those columns (no guest PII, notes or free text) for at most 31 days, until revoked. Revocation takes effect on the next request. |
| F3 | low, residual | **Pre-existing `TO public` policies also apply to `agent_worker`.** Each of the 8 tables already has permissive policies keyed on the JWT `hotel_id` and `auth.uid()`, and those policies are ORed with `agent_worker_read`. <br>A worker token minted **with** a `hotel_id` claim would keep that hotel's reviewed columns readable even after its `jti` is revoked, until the JWT expires. Wrappers still refuse. #235's issuer and worker refuse such tokens (`worker-identity.md`), but the database does not. Follow-up: an `agent_worker_read` RESTRICTIVE policy, or a claim check, in a later migration. |
| F4 | low, residual | **The credential check binds the `jti`, not the token signature.** Any role that can `SET ROLE agent_worker` and set `request.jwt.claims` to an active `jti` acts as the worker. Who can: <br>• superusers; <br>• `postgres`, which is a member of `authenticator` with SET; <br>• members of `authenticator` with SET. On the local image that is `supabase_storage_admin`; staging membership was not queried (read-only probes only assert who is a **direct** member of `agent_worker`). <br>None of these is an application credential. Same trust class as 254's F1. |
| F5 | low, pre-existing class | **`service_role` regains TRIGGER and REFERENCES on the H6 tables.** After Staging Candidate's blanket `grant all privileges on all tables` + enforce, `service_role` again holds `REFERENCES` and `TRIGGER` on the journal and the credential table. It also holds `DELETE` on credentials, which the trigger refuses. These are the rights 254's F2 already tracks; `agent_audit_privileges_enforce()` does not revoke them. Postcondition `control_center_journal_append_only_and_empty` asserts SELECT-only **immediately after** the apply. Later runs are checked by the contract, which allows these. |
| F6 | info | **Hotel offboarding deletes the hotel's journal rows** (FK cascade; the guard allows it only once the tenant row is gone). Platform rows (`tenant_id` NULL) are never deletable. Retention after offboarding is out of scope here. |
| F7 | info | **Wrappers use late-bound named-argument calls (plpgsql),** so a signature drift would surface at runtime rather than at migration time. Pre- and postconditions pin all 29 wrapped and called H1–H5 functions by identity arguments, md5 and INVOKER status. 22 of those 29 pins were not already proven on staging by an earlier entry. A mismatch fails in the **plan** job, before approval, and nothing is applied. |
| F8 | info | **Server version.** The membership postcondition reads `pg_auth_members.set_option` and `inherit_option`, which need PG16+ (the repo pins `major_version = 17`). Precondition `authenticator_ready` reads the same columns, so an older server fails in the plan job, not after the apply. |
| F9 | info, residual | **The schema contract does not require the INVOKER Control Center read models to exist.** If one, e.g. `agent_control_center_overview`, is dropped after the apply, the contract still passes. This widens no privilege: the API call would fail closed. Postcondition `control_center_functions_exact` covers the applied state. Follow-up: pin the set in the contract when #235 next changes. |

## Preconditions (22, read-only; the preview refuses unless all are true)

| Name | Proves |
|---|---|
| `staging_history_ends_at_254` | 254 and all three H5 names are recorded, and the newest numeric version is `agent_audit_integrity_and_independent_approval`. 255 and 256 are absent by version and by name. `assertStagingBase` separately proves the head is exactly 254. |
| `h6_role_tables_policies_and_triggers_absent` | No `agent_worker` role. Neither H6 table nor either new index exists. No policy named `agent_worker_read`. No trigger named `agent_control_center_journal`, `agent_control_center_events_immutable` or `agent_worker_credentials_guard`. |
| `h6_functions_absent` | No `agent_worker_rpc__*`, no `agent_control_center_*`, and none of the 24 named H6 helpers. No `agent%` function is SECURITY DEFINER at all. |
| `hardening_functions_exact_at_254`, `protected_registry_is_exactly_31_at_254`, `truncate_refused_on_every_protected_table_at_254`, `append_only_and_approval_guards_enabled_at_254`, `no_forbidden_privilege_effective_at_254`, `harness_tables_owned_rls_on_no_policies_at_254`, `harness_tables_closed_to_end_users_at_254`, `service_role_backend_rights_at_254`, `app_roles_cannot_bypass_triggers`, `reviewed_function_bodies_at_254` | The **254 entry's own postconditions, verbatim.** They passed on staging in run 44007435406, and re-proving them shows the existing security contracts still hold: <br>• the 6 hardening functions match their md5 pins; <br>• the registry is 31/11; <br>• there are 31 TRUNCATE refusals; <br>• the append-only and independence guards are enabled; <br>• no forbidden privilege exists; <br>• RLS is on with no policies; <br>• end users are closed out; <br>• backend rights are intact; <br>• app roles cannot bypass triggers; <br>• 36 reviewed bodies are unchanged. |
| `wrapped_and_called_functions_exact_at_254` | Each of these exists exactly once, with the exact identity arguments the wrappers call by name, its md5 pin, and INVOKER: <br>• the 22 functions 255 wraps; <br>• the 7 functions 256 calls (`agent__approval_json`, `agent__human_authority`, `agent_runtime_control_set`, `agent_run_request_cancel`, `agent_run_request_pause`, `agent_run_resume`, `agent__billing_mode`). |
| `gateway_pins_and_write_risk_at_254`, `existing_approvals_executions_grants_fit` | H5's exact gateway allowlist, and that every write is medium or high risk. Existing approvals, executions and grants fit the rules (254's probes). |
| `worker_read_targets_ready` | The 8 tables exist, are owned by `postgres` and have RLS **enabled**, so the column grants cannot bypass row security. All 44 granted columns exist. |
| `authenticator_ready` | `authenticator` can log in and is NOINHERIT, not superuser and not BYPASSRLS. It inherits none of `anon`, `authenticated` or `service_role`, and holds SET-only grants of all three (PG16+ columns, see F8). |
| `public_reaches_nothing_255_forbids` | `PUBLIC` holds no table or column privilege on any relation in `public` or `graphql_public`. It has no EXECUTE on any non-trigger function in 255's forbidden class (DEFINER, `agent%`, `billing%`, `work_order_assign_apply`, `publish_assignment_batch`). This predicts that 255's own fail-closed verifier passes, because the new role implicitly inherits `PUBLIC`. |
| `execution_paid_calls_billing_and_control_center_disabled` | Execution is off, paid calls are off, H4 billing is `disabled` with true-up off, and no tenant has `ai_control_center` enabled. |
| `no_live_agent_worker_or_running_run`, `h1_queue_present_and_logged` | No live worker and no running run. The H1 queue is logged and is the only queue. |

## Postconditions (30, read-only; checked right after the apply)

| Name | Proves |
|---|---|
| `h6_recorded_by_name_after_254` | `agent_worker_database_identity` and `agent_control_center` are each recorded once, newest two in that order, directly after 254. |
| `agent_worker_role_restricted` | Every restricted attribute is set, `agent_worker` is a member of no role, it has USAGE but not CREATE on `public`. |
| `agent_worker_reachable_only_through_authenticator` | The direct grants of `agent_worker` are exactly `authenticator` (SET only) and at most `postgres` (ADMIN only). `authenticator` does not inherit it. `anon`, `authenticated` and `service_role` are not members. |
| `worker_wrappers_exactly_the_23_reviewed` | Exactly 23 `agent_worker_rpc__*` functions exist. Each one: <br>• has one overload, the reviewed identity arguments and its CR-insensitive md5 pin; <br>• is DEFINER with `search_path=""` and owned by `postgres`; <br>• is executable by `agent_worker` and by no one in `PUBLIC`, `anon`, `authenticated` or `service_role`; <br>• has no ACL grantee other than its owner and `agent_worker`. |
| `worker_helper_functions_exact` | The 10 worker helpers each match their pin, DEFINER flag and exact EXECUTE matrix: <br>• `credential_ok`: worker only; <br>• `assert` and the guard: nobody; <br>• the operator, list, snapshot and contract functions: `service_role` only. |
| `security_definer_set_is_exactly_reviewed` | Exactly 28 `agent%` functions are DEFINER: the 23 wrappers plus `agent__worker_credential_ok`, `agent__worker_assert`, `agent__control_center_journal`, `agent__journal_control_change` and `agent_control_center_record_refusal`. |
| `worker_holds_only_reviewed_column_reads` | The worker's readable columns in `public` are exactly the 44 reviewed pairs. They are written out independently, not taken from the migration's own list. There are no table privileges in `public` or `graphql_public`, and no column INSERT, UPDATE or REFERENCES. |
| `worker_privilege_contracts_empty` | `agent_worker_privilege_violations()` and `agent_audit_privilege_violations()` are empty. The contract lists hold 23 RPCs and 44 columns. |
| `worker_read_policies_exact` | Exactly 8 `agent_worker_read` policies exist. Each one: <br>• is on one of the 8 tables; <br>• is permissive and for SELECT; <br>• has roles exactly `{agent_worker}` and no WITH CHECK; <br>• has a qual that is exactly `(SELECT agent__worker_credential_ok())`. <br>No other policy targets the worker, and RLS is still on for all 8 tables. |
| `credential_registry_guarded` | The credential table: <br>• is owned by `postgres` with RLS on and no policy; <br>• has the guard trigger (`tgtype = 27`) enabled on the reviewed function; <br>• has both CHECK constraints validated; <br>• grants `service_role` SELECT, INSERT and UPDATE; <br>• grants `PUBLIC`, `anon`, `authenticated` and `agent_worker` nothing. |
| `no_worker_credential_issued` | **No credential row exists, and the journal has no issued or revoked event.** |
| `control_center_journal_append_only_and_empty` | The journal: <br>• is owned by `postgres` with RLS on and no policy; <br>• has the immutability trigger (`tgtype = 27`) enabled; <br>• gives `service_role` SELECT and nothing else, and every other app role and the worker nothing; <br>• has **zero rows** (no control changed during the apply). |
| `journal_triggers_on_exactly_the_7_control_tables` | 7 enabled AFTER INSERT OR UPDATE ROW triggers (`tgtype = 21`) on the reviewed function, on exactly the 7 control tables. No other trigger uses the three H6 trigger functions. |
| `control_center_functions_exact` | The 14 Control Center functions each match their pin, DEFINER flag and EXECUTE matrix: <br>• the writer, the journal trigger function and the guard: nobody; <br>• the refusal recorder, the read models and the controls: `service_role` only. |
| `hardening_functions_superseded_exactly` | All 6 hardening functions keep `SECURITY INVOKER` and owner-only grants. 3 match their 254 pins; the 3 superseded ones (registry, violations, enforce) match their 256 pins. |
| `protected_registry_is_exactly_33_with_12_append_only` | The registry returns exactly the reviewed 33 `(table, append_only)` pairs, and they are every harness table. |
| `truncate_refused_on_every_protected_table` | 33 enabled `agent_refuse_truncate` triggers on `agent__refuse_truncate()`, and nothing else uses that name or function. |
| `append_only_and_approval_guards_still_enabled` | 254's guards are unchanged. |
| `no_forbidden_privilege_effective` | On the 33 tables, no app role and not the worker has TRUNCATE. None of them has DELETE or column UPDATE on the 12 append-only tables, or INSERT on the journal. The violation report is empty. |
| `harness_tables_owned_rls_on_no_policies`, `harness_tables_closed_to_end_users_and_worker`, `service_role_backend_rights_preserved`, `app_roles_and_worker_cannot_bypass_triggers` | Across the 33 tables: owned by `postgres`, RLS on, no policies. `PUBLIC`, `anon`, `authenticated` and `agent_worker` hold nothing. The 31 existing tables keep their backend rights. Neither the app roles nor the worker is superuser, `CREATEROLE`, `REPLICATION` or a member of `postgres`, and the worker is not BYPASSRLS. |
| `reviewed_function_bodies_unchanged`, `wrapped_and_called_functions_unchanged`, `gateway_pins_and_write_risk_unchanged`, `existing_approvals_executions_grants_still_fit` | No reviewed H1–H5 body, signature, pin or risk changed, and existing rows are still valid. |
| `execution_paid_calls_billing_and_control_center_still_disabled`, `no_live_agent_worker_or_running_run_after_apply`, `h1_queue_still_logged` | **The default-off safety state is unchanged.** |

## Local rehearsal (throwaway local stacks only; never staging or production)

**Setup.** Run on 2026-11-17 with the PG18 `psql` client against local Supabase PG 17.6 database containers, where
`postgres` is not superuser, as on hosted. The pinned files came from `git archive 3474416…`. Only one stack ran at a
time. All were stopped with `docker stop`; volumes were kept.

1. **Registry and dispatch.**
   - `loadReviewedRegistry` validated 5 entries. Every probe passes the read-only filter (`assertReadOnlyProbe`).
   - `selectPreviewEntry` accepted the restated PR, SHA and both normalized digests.
   - `verifyCandidateFiles` hashed both files from the archive to the approved digests.
   - `check-migrations.mjs` from `main` passed the candidate (`DESTRUCTIVE MIGRATION REVIEWED — 255…`, `— 256…`).
2. **Planner.** With real version numbers, `planStagingMigrations`:
   - without an allowance, refuses both files as destructive;
   - with `reviewedAllowance(entry)`, plans exactly `["255_…", "256_…"]`;
   - refuses a tampered 256 and an extra pending file.
3. **Preconditions.** Run through `runProbes` with the workflow's exact runner flags
   (`SET default_transaction_read_only = on`): **22/22 PASS** on two independent 254 databases:
   - stack `secpreview` (the 254 rehearsal);
   - stack `h5preview`, migrated 253 → 254 by me for this review.

   On a third 254 database that still held test-suite data, three state probes correctly failed: approvals/executions
   fit, switches off, and no live worker.
4. **Apply.** Each file was applied in its own transaction from the archived bytes, and recorded by name. 255's
   verifier passed; 256's enforce returned 33.
5. **Postconditions.** **30/30 PASS** on both stacks.
6. **Replay refused.** The preconditions re-run on the applied state fail exactly the six H6-sensitive probes: history,
   role/tables, functions, the 254 function pins, the 31-table registry and the 31 TRUNCATE refusals. The 16 invariant
   probes still pass.
7. **Probe sensitivity.** 58 injected violations, each run as superuser in a rolled-back transaction, made the
   targeted probe false or errored. A clean re-run then shows all 30 postconditions true. The cases covered:
   - the history record removed;
   - the role made INHERIT, LOGIN or BYPASSRLS, given a membership, or given CREATE on `public`;
   - the worker granted to `authenticated` or another role, or its `authenticator` grant revoked;
   - a wrapper rewritten without the credential assert, granted to `service_role` or another role, or an extra wrapper;
   - helpers over-granted or given a `search_path`;
   - a Control Center function made DEFINER or granted to `authenticated`;
   - an extra or unreviewed column read, a whole-table SELECT, or a column UPDATE;
   - a direct harness-table grant to the worker, or EXECUTE on a domain write RPC;
   - a wide policy added, RLS disabled, or the policy replaced by `USING (true)` or `… OR true`;
   - credential-table grants, a disabled guard or a dropped CHECK;
   - a credential registered, a refusal journaled, journal INSERT granted, or the journal guard disabled;
   - a journal trigger dropped or disabled, or an extra harness table;
   - a TRUNCATE refusal dropped, TRUNCATE granted, or journal column UPDATE granted;
   - a policy on a harness table, or an end-user grant on the journal;
   - a wrapped H1 body or a called H1 body replaced, or one made DEFINER;
   - execution or paid calls enabled, `ai_control_center` enabled, or a live worker heartbeat;
   - a `PUBLIC` function, table or column grant, RLS disabled or a column renamed on a read target, or
     `authenticator` made INHERIT.
8. **Body pins.** The md5 of every one of the 50 function bodies defined in 255/256 was computed straight from the
   pinned file bytes (CRLF→LF) and equals `md5(replace(prosrc, chr(13), ''))` in the database. So the pins do not
   depend on the applier or its line-ending handling (F1).
9. **Schema contracts.** Re-run 2026-11-17 on a normalized replay workspace (`build-migration-replay-workspace.mjs`),
   running as `postgres` like CI:
   - **Pre-B1 `main` copy fails** on every H6 state with `An Agent Harness function is SECURITY DEFINER` (B1).
   - **The revised copy (this PR)** and #235's exact copy **both pass** on:
     - a clean 254 database without H6 (fresh `db reset`, no `agent_worker` role in the cluster);
     - a clean 256 database (fresh `db reset`);
     - 256 applied incrementally on 254 by `supabase migration up` (the preview path);
     - each of these after Staging Candidate's exact blanket-grant + `agent_audit_privileges_enforce()` command
       (committed and in-transaction) and after CI's blanket table + function grant step, with 0 violations (F5).
   - **The revised copy fails closed** on:
     - missing, partial and unrecorded H6 states: 255/256 SQL applied unrecorded (both, or 255 only); only 255 or only
       256 recorded; 255/256 recorded without their objects; 256 without 254 recorded;
     - unrecorded partial objects: an orphaned `agent_worker` role (alone, or with `authenticator` membership and a
       column grant), an INVOKER H6 helper, an H6 trigger name, an `agent_control_center_*` function;
     - 27 of 28 object mutations of an applied 256 (incremental and clean give identical results): a dropped, extra, unpinned or `service_role`-executable wrapper; dropped or
       disabled journal, immutability, credential-guard or TRUNCATE triggers; role attribute or membership changes;
       `authenticator` membership revoked; an unreviewed column or harness-table read; Control Center functions
       executable by `authenticated` or `agent_worker`, or made SECURITY DEFINER; the journal writer executable by, or
       journal INSERT granted to, `service_role`; TRUNCATE granted; an extra `agent_*` table; a dropped refusal
       recorder or violations function; and the 4 B1-a definer cases.
   - #235's exact copy misses the 4 B1-a cases, the 4 B1-b cases and the dropped refusal recorder; the revised copy
     catches all of them.
   - Remaining (F9): a dropped INVOKER Control Center read model, e.g. `agent_control_center_overview`, is not
     detected by either copy.
10. **Behaviour.** A single DO block, run as superuser and rolled back, checked 14 assertions:
    - Without token claims, the worker is refused (`agent_worker_credential_invalid`).
    - Registering a credential journals exactly one `worker_credential_issued` row, with actor kind `operator`.
    - With the registered `jti`, the wrapper returns.
    - The worker can read a reviewed column, but not an unreviewed column, `agent_runs`, the INVOKER snapshot, the
      journal writer or the register RPC.
    - After revocation, the next call is refused.
    - The journal refuses UPDATE and TRUNCATE (owner included), and the credential refuses DELETE.

    After the rollback, the database again had 0 credentials and 0 journal rows.

**No worker credential exists outside the database either.** No repository-level secret or variable, and none in the
`staging`, `production` or `staging-migration-approval` environments, has a name containing `worker`, `agent` or
`jwt` (names only, 2026-11-17). #235 deploys no worker.

### Not covered

- **Staging data.** The rehearsal databases had no agent rows, so the data-fit probes were trivially true there.
  Step 3's third database and the 254 entry's fault tests show they detect violating rows. On staging they check the
  real rows before anything is applied.
- **Hosted-only membership.** Who is a member of `authenticator` on staging (F4). The probes pin only direct members
  of `agent_worker`.
- **Pinned CLI.** The pinned CLI 2.112.0 push was not run locally. Its dry run in the plan job must propose exactly the
  two files, and the CR-insensitive pins make line-ending handling irrelevant.
- **End-to-end PostgREST.** JWT role switching through PostgREST is covered by PR #235's suites (CI run 44058148135),
  not by this rehearsal.

## Recovery

- **No backup is taken.** The workflow takes no backup and cannot restore one. Before approving the
  `staging-migration-approval` deployment, a human confirms a recent restorable **staging** backup taken at head 254,
  after preview run 44007435406. The last known verified backup (`…-20261114-220001`, head 243) predates H3–H6.
- **Behavioural rollback.** None is needed. Nothing is enabled, no credential exists, and no worker or Control Center
  API is deployed: staging runs `main`'s API, which has no H6 router.
- **Emergency cut-off (forward).** A single reviewed forward migration with `REVOKE agent_worker FROM authenticator;`
  disables every possible worker token at once. Revoking a credential row through `agent_worker_credential_revoke`
  disables one token. Neither touches history.
- **Schema rollback.** A new, separately reviewed forward migration. It is itself destructive and needs its own preview,
  and `main`'s contract must change with it. Sketch, not rehearsed:

  ```sql
  REVOKE agent_worker FROM authenticator;
  DROP POLICY agent_worker_read ON public.tenants;  -- and on the other 7 read tables
  DROP FUNCTION public.agent_worker_rpc__agent_run_claim(text, integer, integer, integer, integer);  -- and the other 22
  DROP TRIGGER agent_control_center_journal ON public.agent_runtime_controls;  -- and the other 6
  -- restore agent__audit_protected_tables / agent_audit_privilege_violations / agent_audit_privileges_enforce to their
  -- 254 bodies BEFORE dropping the H6 tables (the 256 bodies reference them)
  DROP TABLE public.agent_control_center_events, public.agent_worker_credentials;  -- after exporting them if needed
  DROP FUNCTION public.agent_control_center_overview(uuid);  -- and the remaining H6 helpers
  DROP INDEX public.idx_agent_tool_approvals_tenant_created;
  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM agent_worker; REVOKE USAGE ON SCHEMA public FROM agent_worker;
  DROP ROLE agent_worker;
  ```

- **Failed postcondition.** Treat it as a staging incident: inspect read-only, fix forward.
- **Push failure.** Each file is applied in its own transaction.
  - If 255 fails, nothing is recorded. Re-dispatch the same entry only if staging is still at 254 inside the window.
  - If 256 fails, 255 stays applied and recorded. The base has moved, so this entry is refused from then on. Review a
    new entry for 256 alone, based on 255.
- **If #235 is abandoned,** land these exact files on `main` (with a forward revert if unwanted), or staging stays
  ahead of `main` and every candidate is blocked.

## Reviewer checklist

- [ ] Read 255 and 256 in full at `3474416086431e776e3a2e8fef3ddb91fff70452`, and verify the normalized digests
      `819e0306a4d187bab33df5cb14a4fc4ad88a6fd129ad83eb71ff363896d718fa` and
      `3b4b24c40cb6f6cc4a8bc329e3d6f95e89725072f07cc596018b67cbff1a9a78`.
- [ ] Accept the new boundary:
  - a JWT-only `agent_worker` with 23 credential-checked wrappers and 44 credential-gated column reads;
  - an append-only journal written only by triggers;
  - `service_role`-only Control Center functions;
  - the 254 registry extended to 33/12.
- [ ] Accept F1–F9 as non-blocking for staging (follow-ups: F3, F9, and F5 together with 254's F2).
- [ ] **B1:** resolved by merging this PR, which carries #235's H6 contract plus the B1-a/B1-b tightening. Do not
      dispatch until this PR is merged and a fresh staging backup at head 254 is verified.
- [ ] PR #235's head must stay `34744160` until the preview applies. Once applied, 255 and 256 are frozen on staging,
      and #235 must merge with these exact files.
- [ ] Before approving the environment:
  - a fresh staging backup at head 254 is confirmed restorable;
  - no other PR needs staging for the next hours. After the apply, branches without 255/256 fail Staging Candidate
    until #235 merges and they rebase.
