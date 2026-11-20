# Staging preview review: Agent Harness H7 P2, migration 262 (database-verified human identity)

This document reviews registry entry `h7-p2-verified-human-identity-262` in `supabase/staging-reviewed-migrations.json`.
The entry covers Agent Harness H7 Phase 2: database-verified human identity, the tenant-safe credential journal read
model, and the complete approval-transition audit.

- **Merging the entry applies nothing.** It only records the review.
- **Applying needs two more steps:**
  - a dispatch of the Staging Reviewed Migration Preview workflow that restates the digest;
  - a `staging-migration-approval` environment approval.
- **No contract change is needed in this PR.** `main`'s `scripts/schema-contracts.sql` already knows 262: #244 merged it
  byte-identical to the PR #245 copy (git blob `f715c9f85a48a5bdad2776c8620ae59c3e3532bc` on both). The contract
  sections for 262 are gated by migration name, so it passes at 261 and verifies the full P2 surface once 262 is
  recorded.
- **Do not dispatch until:**
  1. this PR is merged;
  2. a fresh staging backup at head 261 is taken and restore-verified (done 2026-11-20, `PatelRep-Staging-Backup-20261120-225938`; see [Recovery](#recovery));
  3. the staging-shaped rehearsal below is run and recorded (done 2026-11-20; see [Rehearsal](#rehearsal-measured-2026-11-20));
  4. a read-only preflight shows all 13 preconditions true on live staging.

Background: `docs/STAGING_REVIEWED_MIGRATION_PREVIEW.md`.
Implementation review: PR #245, `docs/agent-harness/h7-p2-verified-identity.md`.

| Field | Value |
|---|---|
| PR | #245 `security/h7-p2-verified-human-identity` → `main` (draft, open) |
| Pinned head SHA | `e2d657369dd53647e13f88b88eacc2ec031943e1` |
| Base of #245 | `main` @ `aed1852d89be2c9024a9940a6fece26aef384f6f` (#244 merged into the branch as `456e71d5`). Migrations 1–261 are byte-identical to `main`. |
| Expected staging history head | `261` (187 rows; Staging Candidate drift `CLEAN 187/261` on #244 @ `33949142`) |
| Approval window | 2026-11-20T00:00:00Z to 2026-11-27T00:00:00Z (7 days; the maximum is 14) |

## Approved files

| File | SHA-256 (registry, CRLF→LF) | Raw-bytes SHA-256 | Classifier verdict on `main` |
|---|---|---|---|
| `262_agent_verified_human_identity.sql` | `3ae6dbe599c0d04deac7802b615b732398f486ec5ab763891eaba945fa3aba9e` | same | security-sensitive: `auth_schema, privilege_grant, protected_object, security_definer` (not destructive) |

```bash
git show e2d657369dd53647e13f88b88eacc2ec031943e1:supabase/migrations/262_agent_verified_human_identity.sql | sha256sum
# 3ae6dbe599c0d04deac7802b615b732398f486ec5ab763891eaba945fa3aba9e
```

262 has been byte-identical since `00582689` (the first pushed head). Every later commit on #245 is a merge of `main`
or documentation only.

**The entry authorizes exactly one file.** The real `scripts/staging-reviewed-migrations.mjs` functions refuse a
restated extra file, a different digest, a moved/closed/fork PR head, a second file at version 262, staging not at 261,
and any time outside the window (the same unit-tested rules as earlier entries). After the apply, a later candidate
whose 262 differs from the approved bytes is refused (`verifyReviewedBindings`).

## Why a preview is needed

`main`'s Staging Candidate planner (`assertPendingPolicy`, #244) refuses 262 before any write:

```
Refusing to auto-apply security-sensitive pending migration(s) to persistent staging:
262_agent_verified_human_identity.sql (auth_schema, privilege_grant, protected_object, security_definer).
They change database authority and need a reviewed registry entry on main and the human-approved
Staging Reviewed Migration Preview.
```

Expected for PR #245: Staging Candidate refuses it (fails closed). That refusal must not be bypassed or retried by hand.

## Exact database changes (forward-only; no table, column, policy, row or table grant changes)

| # | Object | Change |
|---|---|---|
| 1 | `agent__verified_human_claims()` (new, SECURITY DEFINER, STABLE, `search_path=''`, owner postgres) | Gets the acting human from the PostgREST-verified JWT. Requires: role GUC `authenticated` on `authenticator`; `sub` = `auth.uid()`; unexpired; a live `auth.sessions` row of that user; an eligible `auth.users` row. Reads Auth rows without locks. EXECUTE: nobody. |
| 2 | `agent__verified_human(text[])` (new, DEFINER, VOLATILE) | (1) plus: the active profile hotel, an active hotel, exactly one active role across all hotels, and that role in the given set (`agent__human_authority`, FOR SHARE). EXECUTE: nobody. |
| 3 | `agent_verified_human_probe(text)` (new, DEFINER, VOLATILE) | Non-mutating proof of (2). **EXECUTE: `authenticated` only**, and this is the only new entry point. |
| 4 | `agent_tool_approval_decide_v2(uuid, text, text)` (new, DEFINER, VOLATILE) | The 243 decision, with the actor and hotel derived by the database and the API gates re-checked. **No grant. Inactive.** |
| 5 | `agent_control_center_events_page(uuid, bigint, integer, text[])` (CREATE OR REPLACE) | Same signature, SECURITY INVOKER, STABLE, `search_path=''`, ACL service_role only. Platform-scoped credential journal rows are shown only to the bound hotel, with `app_env` and `expires_at` only. Every other row is unchanged. |
| 6 | `agent__audit_approval_transition()` + constraint trigger `agent_tool_approvals_transition_audit` (new) | DEFERRABLE INITIALLY DEFERRED, AFTER UPDATE, `WHEN (OLD.state IS DISTINCT FROM NEW.state)`. A transition without its tool event gets one at commit, attributed `operator` / `unverified` (GHSA-xm55). |

- Not touched: the 243 legacy decide/revoke/grant paths, the 254 guards, the 256/260 journal, the 260 update guard, the
  261 worker functions, and the privilege detector and remover.
- `$pre$` refuses unless 261 is present, the nine reused or replaced bodies are the reviewed md5s, no 262 object
  exists, and the Auth schema and role separation are as reviewed.
- `$post$` re-checks function shape and ACL, the read model, the trigger, and violations 0/0.

## Security implications and privilege boundaries

- **No role gains any right on Auth tables.** SECURITY DEFINER is used only because `auth.sessions` / `auth.users` are
  owner-readable. Every new function has `search_path=''`, schema-qualified objects and no dynamic SQL.
- **Exactly one new executable entry point**, the read-only probe, for `authenticated`. `service_role`,
  `agent_worker`, `anon` and `PUBLIC` cannot execute any new function. `service_role` is also refused inside the
  helpers.
- **Default-off:** decide v2 has no grant, and the legacy H2 paths stay the only active ones. No switch, flag,
  credential, deployment stamp or entitlement is created. Agent execution, paid model calls, customer billing and the
  Control Center flag stay disabled.
- **Tenant isolation improves:** finding F (cross-hotel credential journal visibility) is closed in the read model.
- **Known residuals (characterized, not fixed by 262):** level-2 stops are not linearized with in-flight approved
  writes; the API holds the legacy HS256 secret that PostgREST accepts.

## Preconditions (13, read-only; the preview refuses unless all are true)

| Probe | Proves |
|---|---|
| `staging_history_ends_at_261` | Head names are 261, 260, 259; 255/256/261 recorded once; 262 absent |
| `p2_objects_absent` | None of the 5 new functions or the audit trigger exists |
| `p1_objects_262_builds_on_present` | 261 objects and the approvals/events tables exist |
| `replaced_and_reused_bodies_are_reviewed` | The 9 bodies 262's `$pre$` pins (events_page `46523c68…`, 243/241/254/256/260 bodies), one overload each |
| `events_page_is_service_role_only_invoker` | Read model shape and ACL before the replace |
| `auth_schema_as_reviewed` | The 7 Auth columns and types, `auth.uid()`, owner SELECT |
| `auth_tables_closed_to_api_and_worker_roles` | anon / authenticated / service_role / agent_worker have no SELECT/INSERT/UPDATE/DELETE on `auth.sessions` / `auth.users` |
| `role_separation_as_reviewed` | service_role, agent_worker and anon are not members of authenticated |
| `privilege_contracts_clean_and_no_delete` | Both violation detectors return 0 rows; no application role has DELETE |
| `delete_and_update_guards_intact` | 7 + 4 guard triggers enabled |
| `execution_paid_calls_billing_and_control_center_disabled` | Every switch is off |
| `deployment_identity_unstamped` | No stamp, so decide v2 could not approve even if granted |
| `no_live_agent_worker_or_running_run` | No live heartbeat and no running run |

## Postconditions (15, read-only; checked right after the apply)

| Probe | Proves |
|---|---|
| `p2_recorded_by_name_after_261` | 262 is recorded once, directly after 261 → 260 |
| `p2_functions_exact_definer_owner_search_path_body` | Each new function: one overload, DEFINER, volatility, owner postgres, `search_path=""`, body md5 |
| `only_the_probe_is_executable_and_only_by_authenticated` | No EXECUTE for public/anon/service_role/agent_worker; authenticated only on the probe |
| `decide_v2_inactive_no_grant` | Nobody, including `authenticator`, can execute decide v2 |
| `events_page_262_body_service_role_only_invoker` | New body `439a57ee…`, ACL and shape unchanged |
| `approval_transition_audit_trigger_deferred_exact` | Exactly one trigger: enabled, AFTER UPDATE ROW (tgtype 17), deferrable, initially deferred, constraint, exact function |
| `legacy_bodies_unchanged_after_apply` | The 8 reused bodies still have their reviewed md5s |
| `auth_schema_unchanged_after_apply`, `auth_tables_still_closed_to_api_and_worker_roles`, `role_separation_unchanged` | Auth boundary unchanged |
| `privilege_contracts_clean_and_no_delete_after_apply`, `delete_and_update_guards_intact_after_apply` | Violations 0/0, guards 7 + 4 |
| `execution_paid_calls_billing_and_control_center_still_disabled`, `deployment_identity_still_unstamped`, `no_live_agent_worker_or_running_run_after_apply` | Still default-off |

### How the digests were derived

Each body md5 is the md5 of the exact text between the `$function$` delimiters in the migration file (CR stripped),
which is what PostgreSQL stores in `pg_proc.prosrc`. The method reproduces all 9 md5s that 262's own `$pre$` pins from
migrations 241, 243, 254, 256 and 260, and the 262 values come from the approved file itself. The probes were then measured
against a restore of staging at 261: see the next section.

## Rehearsal (measured 2026-11-20)

Every result below was read from command output. None is inferred. Nothing here contacted staging except the read-only
backup in step 1. #245, 262 and this registry entry were not changed.

**1. Fresh recovery point at 261.** `PatelRep-Staging-Backup-20261120-225938` (local only, owner-only ACL, not uploaded):

- Both guards passed first: the local guard 8/8 and `scripts/staging-target-guard.mjs` exit 0.
- Live preflight inside `BEGIN READ ONLY` read `transaction_read_only=on`, 187 rows, head `261 agent_worker_tenant_binding`
  and no 262.
- Dump window 2026-11-20T22:59:58Z to 23:00:39Z, `pg_dump` 17.11 (`supabase/postgres:17.11.0.006`). Every stderr log is
  empty.
- The fingerprint before and after the dump is identical: 234 lines, 711 rows across the public, auth, storage, pgmq,
  supabase_migrations, cron and vault schemas.
- `staging-full.dump` sha256 `edeca08b9862d3944c73e5f528519ee171c2ec84d85eb6ec8dd6b07427198dde`.

**2. Restore-verify** in a `--network none` throwaway container (1.5 GB memory cap), removed afterwards:

- The roles load exits 0. `pg_restore --single-transaction --exit-on-error` exits 0 with 0 stderr lines.
- The `pgmq.meta` fix-up was applied.
- The restored fingerprint is **identical** to the staging fingerprint taken at dump time (234 lines).
- **Object signatures, all classified exactly.** The restore was compared with the staging signatures taken at dump
  time. Of 6,350 staging rows, 6,322 are byte-identical, covering every column, constraint, index, policy, trigger,
  event trigger, publication, sequence and type. The diff has 75 lines: 17 diff hunk markers and 58 signature rows. To
  classify each row, the raw catalog values behind it were read on the restore and checked for which value reproduces
  staging's md5:

  | Objects | Classification | Effect |
  |---|---|---|
  | 22 `auth.*` tables, `auth.jwt()`, `pgmq.q_/a_patelrep_agent_runs_v1` (25) | **Proven ordering-only.** A permutation of the restore's own aclitems reproduces staging's md5, so the grantee/privilege set, owner, relkind and RLS/force-RLS flags are identical; for `auth.jwt()` the full definition and SECURITY DEFINER flag are identical too | None. No Auth table grants anything to `anon`, `authenticated`, `service_role` or `agent_worker` on either side |
  | `realtime.schema_migrations` (1) | **Proven equivalent.** Staging stores the explicit owner-only ACL `{supabase_admin=arwdDxtm/supabase_admin}`; the restore stores NULL (the same default) | None |
  | `graphql`, `graphql_public` schemas (2) | **Proven real difference, in the restore only.** Staging is `{supabase_admin=UC, postgres=U*, anon=U, authenticated=U, service_role=U}` (grantor `supabase_admin`); the restore is owner-only, because pg_dump does not carry these managed schemas' grants | The restore is *stricter*: pg_graphql is unusable there until re-granted. Hosted staging is unaffected. No 262 probe or contract reads these schemas |
  | 2 restore-only `default_acl` rows `supabase_admin.pgmq.{r,S}` = `{pg_monitor=r/supabase_admin}` | **Restore artifact.** `CREATE EXTENSION pgmq` ran as `supabase_admin` during pg_restore, and pgmq's script runs `ALTER DEFAULT PRIVILEGES ... TO pg_monitor`. Staging's own `postgres.pgmq` rows are present and identical | Only future tables that `supabase_admin` creates in `pgmq` grant SELECT to `pg_monitor`. No existing object changes |

  Function owners, SECURITY DEFINER flags, bodies and EXECUTE ACLs match for all 351 non-extension functions in the
  compared schemas (296 in `public`). **Not compared:** the 145 extension-member functions in `public` (plus
  `extensions`, `pgmq`, `cron` and `vault` members), because the signature query excludes extension members. Their ACLs
  come from the dump's own ACL entries, which restored with no error, but they were not compared with live staging. A
  catalog-only read of live staging would close this gap; it needs its own approval.

**3. At 261**, as `postgres`, after the exact Staging Candidate fixture grant (extracted from `main` @ `aed1852d`'s
`staging-candidate.yml`, identical at `e2d65736`):

| Check | Result |
|---|---|
| `main`'s `scripts/schema-contracts.sql` @ `aed1852d` (blob `f715c9f8…`) | exit 0 |
| 13 preconditions (`BEGIN READ ONLY`, before and after the grant) | **13/13 true** both times |
| 15 postconditions, each in its own read-only transaction | The 9 invariant ones are true. The 6 specific to 262 fail: `p2_recorded_by_name_after_261` false, `p2_functions_exact_definer_owner_search_path_body` false, `events_page_262_body_service_role_only_invoker` false; `only_the_probe_is_executable_and_only_by_authenticated`, `decide_v2_inactive_no_grant` and `approval_transition_audit_trigger_deferred_exact` raise "function … does not exist" |

**4. Apply 262.** The file came from `e2d65736` with sha256 `3ae6dbe5…aba9e`, checked inside the container. It ran as
`begin; <file>; insert history ('262','agent_verified_human_identity'); commit;`.

This mirrors the bookkeeping in `scripts/remote-migration-apply.mjs`. It is **not** the preview's pinned-CLI `runApply`.

| Check | Result |
|---|---|
| Apply | exit 0. Its NOTICE: 0 historical approval transitions lack their tool event, and 0 platform-scoped credential journal rows changed visibility |
| History | 188 rows, head 262 |
| 15 postconditions | **15/15 true** |
| `main`'s contract @ `aed1852d` at 262 | exit 0 |
| Second fixture grant, then the 15 postconditions | **15/15 true** |
| `agent_audit_privilege_violations()` / `agent_worker_privilege_violations()` | 0 / 0 |

**5. Re-apply refused.** The whole wrapper ran again and exited 3: `$pre$` raised
`55000: migration 262 expects the reviewed bodies of: agent_control_center_events_page`. History stayed at 188/262.

**6. Mutations.** Each ran with all 15 postconditions in one transaction, then rolled back. Each one fails its target:

| Mutation | Failed postconditions |
|---|---|
| `GRANT EXECUTE` on decide v2 to `authenticated` | `only_the_probe_is_executable_and_only_by_authenticated`, `decide_v2_inactive_no_grant` |
| `GRANT EXECUTE` on `agent__verified_human(text[])` to `service_role` | `only_the_probe_is_executable_and_only_by_authenticated` |
| Audit trigger recreated `NOT DEFERRABLE` | `approval_transition_audit_trigger_deferred_exact` |
| Extra overload `agent_verified_human_probe(text, integer)` | `p2_functions_exact_definer_owner_search_path_body`, `only_the_probe_is_executable_and_only_by_authenticated`, `privilege_contracts_clean_and_no_delete_after_apply` |

After the rollbacks, the postconditions are 15/15 true again and `main`'s contract exits 0.

**7. Live staging after the evidence push** (read-only, 2026-11-20 ~23:40Z, after Staging Candidate `44835821390` on
`de90a64a`). The database job reported 187 mirrored versions, 0 pending and drift `CLEAN`, and the fixture seed
converged its 7 role users. The API deploy failed (`railway up`: "Deploy failed"), so that Staging Gate is red. A
read-only check (`BEGIN READ ONLY`, `transaction_read_only=on`) then found:

- 187 history rows, head `261 agent_worker_tenant_binding`, no 262;
- row counts identical to the backup except `auth.sessions`, `auth.refresh_tokens` and `auth.mfa_amr_claims`, each 5 → 0
  (the fixture seed revoked the old fixture sessions);
- per-table content hashes identical for 222 of the 228 tables. The other 6 are the three Auth session tables above,
  plus `auth.users`, `public.tenants` and `public.user_profiles`, whose row contents converged. The id sets of
  `auth.users`, `public.tenants`, `public.user_profiles` and `public.user_roles` are identical to the backup.

So the head-261 backup is still a valid recovery point: same schema, same fixture identities. Restoring it would bring
back 5 old synthetic fixture sessions, which the next fixture seed revokes again.

**Not covered here:**

- The hosted ACL and catalog state at dispatch time. Rollout step 4 re-measures the 13 preconditions read-only on live
  staging.
- The preview workflow's own CLI apply path.

Never edit a probe at dispatch. If a hosted difference makes a probe fail, stop and re-review.

PR #245's own evidence: the CI real-database integration suite on a clean 1–262 replay, the contract mutation
catalog, and the API and node suites.

## Staging rollout plan (each step needs its own explicit human request)

1. Independent review of this PR, then a human merges it (it applies nothing).
2. Confirm `main`'s Staging Candidate is still green at 261 after the merge (`CLEAN 187/261`).
3. Fresh backup at 261 plus the rehearsal above: done 2026-11-20 and recorded in this document. Repeat it if staging changes
   schema before dispatch.
4. Read-only preflight on live staging inside `BEGIN READ ONLY` (the pooler ignores `PGOPTIONS`). Check that:
   - all 13 preconditions are true;
   - #245 is open at `e2d65736…`;
   - the window is open;
   - nothing is running in `staging-release-candidate`.
5. Dispatch once, restating
   `262_agent_verified_human_identity.sql=3ae6dbe599c0d04deac7802b615b732398f486ec5ab763891eaba945fa3aba9e`. The dry
   run must propose exactly 262.
6. Environment approval by the required reviewer only after reviewing the dry run, and only on explicit request.
7. After the apply:
   - 15/15 postconditions;
   - `main`'s contract passes;
   - violations 0/0;
   - Staging Candidate for #245 succeeds with `0 pending` and `CLEAN 188/262`.
8. Out of scope here: granting decide v2, switching the API to verified paths, stamping identity, enabling execution,
   merging #245, and production.

## Recovery

- **Forward-only.** No row is changed. A defect is fixed by a NEW reviewed forward migration (REVOKE EXECUTE on the
  probe, or a reviewed CREATE OR REPLACE), never by editing 262.
- **Immediate containment:** `REVOKE EXECUTE ON FUNCTION public.agent_verified_human_probe(text) FROM authenticated`
  (decide v2 already has no grant).
- **Full restore:** the head-261 backup `PatelRep-Staging-Backup-20261120-225938` (dump sha256 `edeca08b…8dde`),
  restored per `RESTORE-RUNBOOK.md`.
- **Failure modes:**
  - a failing precondition means nothing was applied: stop and re-review;
  - a failing apply means the single transaction rolls back: staging stays at 261;
  - a failing postcondition means 262 is applied: diagnose read-only, then fix forward or restore.

## Reviewer checklist

- [ ] The digest and head SHA match `git show e2d65736…:supabase/migrations/262_agent_verified_human_identity.sql | sha256sum`.
- [ ] `main`'s `scripts/schema-contracts.sql` equals the #245 head copy (blob `f715c9f8…`).
- [ ] The entry approves only 262, with base 261 and a 7-day window; earlier entries are unchanged.
- [ ] Every probe is a single read-only SELECT (the registry validator passes).
- [ ] The rehearsal section is completed with measured results before dispatch.
- [ ] Nothing here dispatches, approves, merges #245, grants decide v2 or enables AI.
