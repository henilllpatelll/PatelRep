# Pre-H6 security hardening: append-only audit integrity (#230) and independent approval (#231)

Status: implemented, not merged. Migration `254_agent_audit_integrity_and_independent_approval.sql` (destructive-reviewed
because it contains the `TRUNCATE` keyword) plus a separate control-plane PR for the two workflows that issue blanket
grants. Agent execution, paid model calls, billing and autonomous writes stay disabled; nothing here changes a switch.

## 1. Findings being fixed

| Ref | Finding | Proven on a real PostgreSQL 17 Supabase stack at migration 253 |
|---|---|---|
| #230 / H5 F1 | Row triggers (`BEFORE UPDATE OR DELETE`) do not fire for `TRUNCATE`. `service_role` holds `TRUNCATE`, `UPDATE`, `DELETE` on every H1–H5 table through platform default privileges, and CI Gate and Staging Candidate re-run `GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role` after every migration. | `SET ROLE service_role; TRUNCATE public.agent_tool_events;` and `TRUNCATE public.agent_run_events CASCADE;` both **succeeded** (rolled back). |
| #231 / H5 F5 | `agent_tool_request_approval` stores the worker's `p_approver_may_be_initiator` verbatim; `agent_tool_approval_decide` and both execute RPCs honour the stored flag. Nothing in SQL derives independence from the reviewed tool risk, and a direct `service_role` insert into the approval or ledger tables is checked only by shape. | A worker passing `true` for the medium-risk work-order assign would have produced an approval its initiator could decide. |

Correction recorded during review: 241's `agent__guard_approval_update` already freezes every binding column
(including `approver_may_be_initiator`, `required_approver_roles`, `expires_at`), so the flag cannot be flipped after
the request. The gap is the flag's origin and the absence of a risk-derived rule at decision, consumption and ledger
time.

## 2. Inventory (31 tables, `public`, owner `postgres`, RLS on, no end-user policy)

`append_only` = every UPDATE and every DELETE is refused by an enabled row trigger (tenant-deletion cascade excepted).

| Milestone | Append-only (11): backend keeps SELECT, INSERT | Mutable (20): backend keeps SELECT, INSERT, UPDATE |
|---|---|---|
| H1 (238) | `agent_run_events` | `agent_runs`, `agent_run_steps`, `agent_runtime_controls`, `agent_worker_heartbeats` |
| H2 (241) | `agent_tool_invocations`, `agent_tool_executions`, `agent_tool_events` | `agent_execution_enablement`, `agent_tool_controls`, `agent_tool_grants`, `agent_tool_approvals` |
| H3 (244, 247) | `agent_model_spend_events` | `agent_model_enablement`, `agent_model_price_schedules`*, `agent_model_budget_policies`*, `agent_model_budget_counters`*, `agent_model_attempts`, `agent_planning_runs` |
| H4 (248, 250) | `agent_customer_overage_authorizations`, `agent_customer_billing_events`, `agent_billing_operation_events`, `billing_trueup_operation_events` | `agent_customer_billing_controls`, `agent_customer_pricing_policies`, `agent_customer_credit_holds`, `agent_billing_operations`, `agent_customer_credit_charges`, `billing_trueup_operations` |
| H5 (252) | `agent_planning_events`, `agent_proposal_handoffs` | — |

\* guarded mutable: their row triggers allow exactly one transition (close / retire) or monotonic counters, so they keep UPDATE.

Effective privileges before 254: `anon`/`authenticated`/`PUBLIC` none (238–252 revoke them). `service_role` ALL via
default privileges, re-granted by CI and Staging Candidate. `service_role` is not a superuser, not a member of
`postgres`, does not own the tables, cannot `SET session_replication_role`, and has `BYPASSRLS` (it is the trusted
backend; isolation for it is by explicit `tenant_id` predicates in every RPC).

Legitimate access patterns verified before revoking: no H1–H5 RPC or Python path issues `UPDATE`, `DELETE`,
`SELECT … FOR UPDATE/SHARE` or `INSERT … ON CONFLICT DO UPDATE` against an append-only table (all `DO UPDATE` upserts
target mutable control tables). Foreign-key checks and `ON DELETE CASCADE` run as the table owner, so revoking
DELETE does not block hotel off-boarding. No repository script, fixture or workflow truncates any table.

## 3. Design

### #230 append-only integrity

1. **Primary, privilege-independent:** `agent__refuse_truncate()` as an enabled `BEFORE TRUNCATE … FOR EACH STATEMENT`
   trigger on all 31 tables. It also fires for tables reached through `TRUNCATE … CASCADE` (including `TRUNCATE
   tenants CASCADE`). Together with the existing row triggers, a blanket re-grant cannot reopen deletion.
2. **Least privilege, re-assertable:** `agent_audit_privileges_enforce()` revokes `TRUNCATE` (31 tables) and
   `UPDATE, DELETE` (11 append-only) from `PUBLIC, anon, authenticated, service_role`, then calls
   `agent_audit_privilege_violations()` and **raises** if any right remains (column-level UPDATE and inherited rights
   are detected). The migration calls it once.
3. **Workflows cannot silently undo it:** the control-plane PR makes CI Gate and Staging Candidate call the function
   in the same transaction as their blanket grant (skipped only while the function does not exist) and adds a
   repository contract that every blanket table grant in any workflow must do so.
4. **One registry:** `agent__audit_protected_tables()` drives enforcement, verification, schema contracts and tests; a
   contract fails if any `agent_*`/`billing_trueup_*` table is missing from it.

### #231 independent approval

`agent__gateway_tool_spec` (reviewed allowlist, last defined in 253) is the trust anchor. New triggers:

* `agent_tool_approvals_independence` (BEFORE INSERT OR UPDATE):
  * INSERT: spec must exist and be a write with risk `low|medium|high`; medium/high refuse
    `approver_may_be_initiator = true`; `required_approver_roles` must equal the spec roles; every binding column must
    equal the invocation's.
  * Transition to `approved`: refused if the tool left the allowlist, or (medium/high, or flag false) the decider is
    the initiator.
  * Consumption: refused unless approved, unexpired, independent, and consumed by an execution row of the same
    approval and invocation.
* `agent_tool_executions_approval_guard` (BEFORE INSERT): the row must bind its invocation exactly; any approval must
  belong to the invocation; a **succeeded write** requires an approved, unconsumed, unexpired, independent approval.

Because the ledger insert and the domain mutation share one transaction in both execute RPCs, a refused ledger row
rolls back the work-order / room-assignment change and its audit row. Low-risk behaviour is unchanged (the stored
flag is honoured); no low-risk write exists, and a schema contract fails if a reviewed write stops being medium/high.

Approval lifecycle audited (all SECURITY INVOKER, `service_role` only): `agent_tool_run_admit`,
`agent_proposal_handoff_admit` (H5 → gateway), `agent_tool_request_approval`, `agent_tool_approval_decide`,
`agent_tool_approval_revoke`, `agent_tool_approvals_expire`, `agent_proposal_handoff_cancel`,
`agent_tool_execute_work_order_assign`, `agent_tool_execute_room_assignment`, `agent_tool_record_outcome`
(writes may only record `failed`). Every path that writes an approval or a ledger row now passes the new triggers;
tenant scope, current-role re-reads (`agent__human_authority … FOR SHARE`), revocation, expiry, single use,
idempotency and stale-world checks are unchanged.

Existing rows: not rewritten. The migration prints (NOTICE) how many rows carry a self-approval flag on a
medium/high/unknown tool and how many approved rows were decided by their initiator; neither can be approved or
consumed by the initiator afterwards. Local base: 0 and 0. The staging preview must record both counts as
preconditions.

## 4. Residual powers (cannot be removed by a migration)

* The table owner (`postgres`) and superusers (`supabase_admin`) can disable or drop triggers, re-grant privileges,
  set `session_replication_role = replica`, or run DDL. These are the migration/administrator identities; their use
  is governed by the reviewed-migration process, not by the database.
* `service_role` is shared by the API and the worker. The database proves an approver is a **different, current,
  authorized member** of the hotel, but `p_actor_user_id` is asserted by the caller: a party holding the
  `service_role` key could name another manager as the decider. Recommended H6 follow-up: a separate worker database
  role without EXECUTE on the human decision RPCs (`agent_tool_approval_decide`, `…_revoke`, `agent_tool_grant_set`,
  enablement setters).
* `service_role` can call domain RPCs (for example `work_order_assign_apply`) directly, as the API does for
  human-initiated changes; the approval rule governs the agent gateway, not ordinary human writes.

## 5. Evidence (local, sequential, one Supabase stack, 1 pytest process)

* Baseline at 253: `service_role` TRUNCATE succeeded (finding reproduced).
* 254 applied in one transaction to the 253 stack (as the reviewed preview will), then re-applied (idempotent);
  31 triggers, 0 violations.
* `tests/integration/test_agent_audit_integrity.py` (11) and `test_agent_approval_independence.py` (11): TRUNCATE
  under least privilege and under a blanket re-grant, cascade, owner; UPDATE/DELETE; column-level and inherited grants;
  trigger disable/drop and replica-mode bypass; hotel off-boarding cascade through the API; worker self-approval
  request (Engineering medium, Housekeeping high); forged inserts; initiator decision via RPC and direct UPDATE;
  legacy self-approvable and self-approved rows (decision and execution refused, domain change rolled back); forged
  consumption and forged success rows; single-use replay; wrong tenant; role demotion; concurrent self/approve/reject.
* Full integration suite (all H1–H5 workflows) and `tests/smoke/test_agent_hardening_contracts.py` (6) — see the PR.

## 6. Migration plan and merge order

1. **Control-plane PR** (`infra/agent-audit-privileges-reassert`): workflow re-assertion + contracts. Safe alone
   (no-op until 254 exists). Merge first.
2. **This PR** (stacked on 1): migration 254, schema contracts, tests, this document. Staging Candidate refuses the
   destructive pending 254 by design until step 3.
3. **Reviewed-preview registry PR** pinning this PR's number and exact head SHA, base 253, digest of 254,
   preconditions (H5 recorded, 254 absent, existing-approval counts, grantor of `service_role` rights = `postgres`) and
   postconditions (31 triggers, 0 violations, guards enabled). Merge to main.
4. Human: confirm a fresh, restore-verified staging backup at head 253, then dispatch the preview from main and
   approve `staging-migration-approval`.
5. Merge main into this PR (no rebase), re-run CI Gate / Staging Candidate on the exact head; human review; human
   merge. Production is a separate, explicit release decision.
