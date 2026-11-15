# Staging preview review: H5 Operations specialists, migrations 251–253

This document reviews registry entry `h5-operations-specialists-251-253` in `supabase/staging-reviewed-migrations.json`.

- **Merging the entry applies nothing.** It only records the review.
- **Applying needs two more steps:** a dispatch of the Staging Reviewed Migration Preview workflow that restates every
  digest, and a `staging-migration-approval` environment approval.
- **Before that approval,** a human must separately confirm the staging backup and recovery capability (see
  [Recovery](#recovery)).

Background: `docs/STAGING_REVIEWED_MIGRATION_PREVIEW.md`.

| Field | Value |
|---|---|
| PR | #223 `feat/agent-harness-h5-operations-specialists` → `main` |
| Pinned head SHA | `caa3d75f9a91d1e90dea4e584afdb5afd2698728` |
| Expected staging history head | `250` (H4 hardening). Applied by Staging Candidate run 43699456011 (`Applied 250_billing_dispatch_guard_and_legacy_trueup_outbox.sql`, `Status: CLEAN`). |
| Approval window | 2026-11-15T17:00:00Z to 2026-11-22T17:00:00Z (7 days) |

## Approved files

Each digest is the SHA-256 of the file with CRLF normalized to LF, computed with `scripts/check-migrations.mjs` `sha256`.

| File | SHA-256 | Matches `DESTRUCTIVE_PATTERN` |
|---|---|---|
| `251_agent_h5_specialist_allowlists.sql` | `1a2d4ed28ec014d168b6502d176e63c832480a6e01e49ad9fe475115dcae4698` | yes (5 × `ALTER TABLE … DROP CONSTRAINT`) |
| `252_agent_h5_planning_and_handoff.sql` | `5faa8fc4a2483c897d005e450967be3bcf480e1ad79a10a3e9d0b1efbcd81cb0` | no |
| `253_agent_h5_gateway_tools.sql` | `835b4d7d3c64839b170a07393bf5a09503b22c29de0bbe287eda7d399f0a533c` | no |

The files are LF in git, so a plain hash matches. Verify the digests yourself before approving:

```bash
for f in 251_agent_h5_specialist_allowlists 252_agent_h5_planning_and_handoff 253_agent_h5_gateway_tools; do
  git show caa3d75f9a91d1e90dea4e584afdb5afd2698728:supabase/migrations/$f.sql | sha256sum
done
```

PR #223 changes nothing else under `supabase/`. Every migration through 250 is byte-identical to `main`.

## Why a preview is needed

Staging Candidate run 43734378103 (PR #223) failed at *Prepare persistent staging database* with:

> `Refusing to auto-apply destructive pending migration(s) to persistent staging: 251_agent_h5_specialist_allowlists.sql`

The planner refuses the whole pending set (251–253) by design.

## Exact effect of 251: five CHECK replacements, each a widening by an enumerated set

| # | Before (H3, 246/247) | After (251) | Widens by |
|---|---|---|---|
| 1 | `agent_runs_h3_agent_allowlist` admits three agents: `harness.synthetic` v1; `engineering.dispatch_assistant` v1 with `synthetic_spec = '{}'`; `harness.orchestrator` v1 with `synthetic_spec = '{}'`. | `agent_runs_h5_agent_allowlist` admits the same three plus two more. | `engineering.dispatch_assistant` **v2** and `housekeeping.room_readiness_assistant` **v1**, both with `synthetic_spec = '{}'` |
| 2 | `agent_planning_runs_intent_check`: `engineering.work_order_dispatch_plan` | `agent_planning_runs_intent_allowlist`: the same plus four intents | `engineering.work_order_triage`, `engineering.work_order_dispatch_recommendation`, `housekeeping.room_readiness_review`, `housekeeping.room_assignment_recommendation` |
| 3 | `agent_planning_runs_resource_type_check`: `work_order` | `agent_planning_runs_resource_type_allowlist` | `room` |
| 4 | `agent_planning_runs_plan_outcome_check`: proposed, refused, escalated, rejected | `agent_planning_runs_plan_outcome_allowlist` | `recommended` |
| 5 | `agent_planning_runs_record_shape` | `agent_planning_runs_record_shape_v2` | `recommended` must carry a plan; no other rule changes |

**Verified:** every H0–H4 agent and state is preserved.

- All three H3 agent clauses appear verbatim in the new constraint. `agent_runs_state_check` (H2) and
  `agent_runs_guard_gateway_insert` (246) are untouched.
- Every H3 intent, resource type and outcome is still allowed.
- `agent_planning_runs_intent_version_check` (`= 1`) is untouched.
- Nothing else is dropped: no table, column, row, index, policy, function or trigger.

**Gotcha:** 251 uses `DROP CONSTRAINT IF EXISTS`. If a name differed, the old, stricter check would silently remain.

- The exact auto-generated names were confirmed on a database built from `main`.
- Precondition `h3_planning_checks_present_by_exact_name` refuses the apply if they differ on staging.

## 252 and 253 (additive)

**252: planning audit and proposal handoff**

- **New tables.** Two append-only tables: `agent_planning_events` and `agent_proposal_handoffs`.
  - RLS on, no policies.
  - Revoked from `PUBLIC`/`anon`/`authenticated`.
  - `BEFORE UPDATE OR DELETE` immutability trigger.
- **New functions.** Eleven, all `SECURITY INVOKER`, `search_path = ''`, `service_role` only.
- **Redefined H3 functions.** `CREATE OR REPLACE` of three with identical signatures.

Each change below was diffed against 247:

- `agent__planning_intent_roles`: adds the four intents.
  - `engineering.work_order_dispatch_plan` stays `{chief_engineer, gm}`.
  - Housekeeping intents are `{gm, housekeeping_supervisor}`.
  - Engineering intents never include `housekeeping_supervisor`.
- `agent_planning_run_admit`: the resource type now comes from the intent catalog. A `room` resource must belong to the
  tenant (`rooms.tenant_id`), exactly as `work_order` already must. Every other gate is unchanged: paid-call switch,
  orchestrator controls, `ai_agents` flag, current human authority, planning marker.
- `agent_planning_record_plan`: adds one audit-event insert after the recorded plan. Nothing else changes.

**The handoff** (`agent_proposal_handoff_admit`) is the only path from a plan to the Tool Gateway. It runs under a row
lock and requires all of the following:

- the caller is the plan's initiator;
- the outcome is `proposed` (so a `recommended` read-only plan can never hand off);
- the digest matches;
- the proposal is within its TTL;
- the intent has a write;
- the agent, tool, version, arguments and resource equal the recorded step exactly;
- the idempotency key is server-derived.

It then calls the unchanged H2 `agent_tool_run_admit`. That call re-checks the allowlist, resource ownership, controls,
entitlement, the initiator's **current** authority and the per-property grant. **The handoff approves nothing.**

**Cancel and dismiss** require the submitter or initiator to still hold the intent's roles.

**253: gateway allowlist and the one Housekeeping write**

- **`agent__gateway_tool_spec`.**
  - The three H2 v1 entries are byte-identical.
  - It adds exactly seven pins (table below).
- **`agent_tool_execute_room_assignment`.** This is the approved Housekeeping write. It mirrors H2's
  `agent_tool_execute_work_order_assign` step for step:
  1. fenced run lock, then idempotent replay;
  2. `agent__gateway_refusal`;
  3. approval `FOR UPDATE`, checking state, consumption, expiry, exact binding, independence and the approver's current
     role.
- **The publish call.** It then calls the unmodified `publish_assignment_batch` (222) for one room, with the approving
  human as actor and `is_ai_suggested = true`.
- **Refusals.** A domain refusal (`P0409`/`P0422`/`P0403`) is caught and recorded as a failed ledger row, and the
  approval is consumed.
- **Untouched.** Room status is never changed.

The seven pins:

| Agent | Tool (version) | Access / risk / roles |
|---|---|---|
| `engineering.dispatch_assistant` v2 | `engineering.work_orders.lookup` (2) | read / low / chief_engineer, engineer, gm, housekeeping_supervisor (same as v1) |
| | `engineering.work_orders.assignment_candidates` (1) | read / low / chief_engineer, gm |
| | `engineering.work_orders.assign` (2) | write / medium / chief_engineer, gm (same as v1) |
| `housekeeping.room_readiness_assistant` v1 | `housekeeping.rooms.status_lookup` (1) | read / low / gm, housekeeping_supervisor |
| | `housekeeping.rooms.readiness_lookup` (1) | read / low / gm, housekeeping_supervisor |
| | `housekeeping.room_assignments.candidates` (1) | read / low / gm, housekeeping_supervisor |
| | `housekeeping.room_assignments.assign` (1) | **write / high** / gm, housekeeping_supervisor |

**Cross-department isolation.** Neither specialist can reach the other department's write:

- The housekeeping agent has no engineering pin.
- `engineering.dispatch_assistant` v2 has no housekeeping pin. It drops v1's room status read.

Postcondition `gateway_allowlist_is_exactly_reviewed_pins` enumerates 252 combinations (4 agents × 3 versions × 7 tools ×
3 versions) and requires exactly these ten to resolve.

## Security review

| Area | Result |
|---|---|
| Privilege widening | **Agents:** only the two enumerated agents and their reviewed pins. **Roles:** no role gains write authority. The engineering write keeps `{chief_engineer, gm}`, and the housekeeping write is `{gm, housekeeping_supervisor}`, which is that department's canonical assigners. |
| Tenant isolation | Every new read and write is scoped by `tenant_id`. Room ownership is checked at planning admission and again at gateway admission. Composite `(id, tenant_id)` FKs on both new tables tie each row to a same-tenant run, invocation and plan. |
| Write authorization | A write needs three things: an H2 grant at `human_approved` level with `max_risk ≥ high`, an approved, unconsumed, unexpired and exactly bound approval, and an approver who currently holds the tool's role. Staging has no H5 grant; this is a precondition and a postcondition. |
| Approval bypass | None found. The handoff creates an invocation only. Approval still goes through the unchanged `agent_tool_request_approval` and `agent_tool_approval_decide`. Both are pinned by body hash, before and after. |
| End-user access | Both new tables are RLS on with no policies and no `anon`/`authenticated` privilege. No `agent*`, `work_order_assign_apply` or `publish_assignment_batch` function is `SECURITY DEFINER` or executable by `anon`/`authenticated`. |
| Default off | Five switches stay off: `agent_execution_enablement`, `agent_model_enablement` (planning admission refuses `paid_calls_disabled`), H4 customer billing (`disabled`, true-up off), `AGENT_GATEWAY_EXECUTION_ENABLED` and `AGENT_ORCHESTRATOR_EXECUTION_ENABLED`. No worker is deployed. The migrations insert no rows. |

Findings. None blocks this staging preview; F1 and F5 are recommended follow-ups.

| # | Severity | Finding |
|---|---|---|
| F1 | low, pre-existing pattern | `service_role` holds UPDATE/DELETE/TRUNCATE on the two new tables through platform default privileges, as on every H1–H4 agent table. The row triggers stop UPDATE/DELETE. `TRUNCATE` bypasses row triggers, but only the trusted backend role could issue it. Follow-up: a forward migration that revokes TRUNCATE (and UPDATE/DELETE) on append-only agent tables, or adds `BEFORE TRUNCATE` triggers, across H1–H5. |
| F2 | info | `agent_planning_record_plan` calls `jsonb_array_length(plan->'steps')`. If `steps` is not an array, the call raises and the whole transaction rolls back, so it fails closed with no partial record. The worker validates plan schema v2 first. |
| F3 | info | `agent_tool_execute_room_assignment` casts `assignee_user_id`/`assignment_date`. Malformed arguments raise and roll back: no side effect, and the approval is not consumed. Arguments are digest-bound at admission. |
| F4 | info | 251's `DROP CONSTRAINT IF EXISTS` relies on exact names. This is mitigated by the exact-name precondition and postcondition. |
| F5 | low, pre-existing H2 design | Approver independence (`approver_may_be_initiator`) is supplied by the worker when it requests approval; the database does not force it from risk. H5's catalog pins `human_approval.independent_manager.v1` (false) for both writes. Follow-up: force `false` in SQL for `medium`/`high` specs. |

## Preconditions (12, read-only; the preview refuses unless all are true)

| Name | Proves |
|---|---|
| `staging_history_ends_at_h4_250` | 250 is recorded; none of 251–253 is recorded by version or by name. `assertStagingBase` separately proves the head is exactly 250. |
| `h3_agent_allowlist_present_without_h5` | The H3 allowlist is validated, admits the three H3 agents and nothing housekeeping or v2. The H5 constraint is absent. |
| `h3_planning_checks_present_by_exact_name` | The four constraints 251 drops exist, validated, under the exact names it uses. None of the new names exists. |
| `h5_objects_absent` | No H5 table, none of the 11 new functions, and no H5 gateway pin. |
| `existing_runs_fit_h5_agent_allowlist` | Every existing run satisfies the new agent allowlist. |
| `existing_planning_rows_fit_h5_checks` | Every existing planning row satisfies all four new planning checks. |
| `reviewed_function_bodies_at_h4` | There are 21 security-relevant functions. Each exists once (no overload), and its body md5 equals the reviewed `main` bytes. They are the gateway admission, refusal, grant level, approval request/decide/revoke, the work-order execute, the insert guard, human authority, `agent_run_admit`, `publish_assignment_batch`, `work_order_assign_apply`, H4 dispatch and hold guards, and the four bodies 252/253 replace. |
| `existing_grants_resolve_and_no_h5_grants` | Every existing tool grant resolves to a reviewed pin. No grant exists for an H5 specialist. |
| `execution_paid_calls_and_billing_disabled` | Gateway execution is off, paid calls are off, and H4 billing is `disabled` with true-up off (single rows). |
| `no_live_agent_worker` | No worker heartbeat in `starting`/`running`/`draining` within the last hour. |
| `h1_queue_present_and_logged` | The H1 queue is logged and is the only queue. |
| `domain_objects_present` | `rooms.tenant_id`, `room_assignments`, `user_roles`, `tenant_feature_flags`, H2/H3 tables and the immutability guard function all exist. |

## Postconditions (18, read-only; checked right after the apply)

| Name | Proves |
|---|---|
| `h5_migrations_recorded_by_name` | All three are recorded under their approved names. |
| `h5_agent_allowlist_replaces_h3_exactly` | The H5 allowlist is validated with exactly five `agent_id =` clauses (two for engineering, versions 1 and 2). The H3 constraint is gone. |
| `h5_planning_checks_replace_h3_exactly` | Four new checks plus the untouched version check are validated. The old four are gone. The intent check has exactly 5 values, resource type 2, outcome 5. |
| `h5_tables_rls_enabled_without_policies` | Both tables have RLS on and no policy. |
| `h5_tables_closed_to_end_users` | `anon`/`authenticated` have none of the seven table privileges. |
| `h5_tables_append_only` | Both immutability triggers are enabled, BEFORE, ROW, on UPDATE and DELETE, using `agent__guard_tool_immutable`. |
| `agent_functions_backend_only` | No agent, `work_order_assign_apply` or `publish_assignment_batch` function is SECURITY DEFINER or callable by end users. |
| `h5_functions_invoker_service_role_only` | All 15 new or redefined functions are INVOKER, use `search_path=""`, are executable by `service_role`, and have no PUBLIC grant. |
| `gateway_allowlist_is_exactly_reviewed_pins` | Exactly the ten reviewed pins resolve across 252 combinations. |
| `gateway_specs_exact_and_department_scoped` | The exact JSON specs for both writes and every read, including H2's v1 entries. |
| `intent_catalog_department_scoped` | Exact roles per intent. Only the two recommendation intents carry a write, each to its own department's tool. Unknown intents or versions resolve to nothing. |
| `reviewed_function_bodies_after_h5` | Body md5 pins for 32 functions: the 17 unchanged ones (approval logic intact), the 4 redefined and the 11 new, so exactly the reviewed bodies are installed. |
| `room_assignment_requires_independent_approval` | Both write executors still contain the full approval-refusal chain. |
| `existing_grants_still_resolve_and_no_h5_grants` | Existing permissions are preserved, and no H5 grant exists. |
| `no_h5_runs_plans_handoffs_or_events` | There is no H5 run, H5 planning row, `recommended` plan, handoff, planning event, or H5 invocation. |
| `execution_paid_calls_and_billing_still_disabled` | All switches are still off. |
| `no_live_agent_worker_after_apply` | The migration activated no worker. |
| `h1_queue_still_logged` | The queue is unchanged. |

## Schema contracts on `main` (`scripts/schema-contracts.sql`)

The preview's apply job runs `main`'s copy against staging after the apply. So do Staging Candidate and Staging Database
Migrate for every later candidate. That copy previously required `agent_runs_h3_agent_allowlist`, which 251 removes.

The contract now reads the H5 schema version from migration history **by name**:

| History | Required |
|---|---|
| None of the three H5 names recorded (H4) | Everything as before, including the H3 allowlist. Additionally, the four H3 planning checks are present and **no** H5 object exists. |
| All three recorded (H5) | All six H5 markers. No H3 constraint that 251 replaces. The exact five-agent allowlist. The five validated planning checks. Both tables RLS-on, policy-free, closed to end users and append-only. All 15 functions INVOKER, `search_path=""`, `service_role`, no PUBLIC. The exact gateway pin set and write specs. The department-scoped intent catalog. |
| One or two recorded, or history missing | **Fails closed.** |

Names are used because CI and local replays record synthetic version numbers; the names are identical everywhere.

**Merge order:** PR #223 also edits this file. Once this PR merges, take `main`'s version when #223 is brought up to date.

## Local rehearsal (throwaway local Supabase stack only; never staging or production)

Run on 2026-11-15 in an isolated stack `supabase_db_h5preview`, with ports 5582x and CLI 2.75.0 (the workflow pins
2.112.0). The stack was built from `main` `ff88aff2` with `scripts/build-migration-replay-workspace.mjs`: 180
migrations, last `billing_dispatch_guard_and_legacy_trueup_outbox` (250).

1. The registry validated with `loadReviewedRegistry`: 3 entries, no file approved twice, every probe passes the
   read-only filter.
2. Preconditions ran through `runProbes` with the workflow's runner flags (`SET default_transaction_read_only = on`):
   **12/12 PASS**.
3. The new contract passed on H4.
4. In rolled-back transactions, the contract **failed closed** in 19 cases:
   - partial-apply states: 1 or 2 recorded; all applied but unrecorded; only 251 or only 253 applied; all recorded with
     253 or everything missing; no history table;
   - tampering: handoffs granted to `authenticated`; an RLS policy added; the immutability trigger disabled; a handoff
     RPC granted to `authenticated`; the room executor made SECURITY DEFINER or granted to PUBLIC; housekeeping write
     risk lowered to medium; an engineering v2 → housekeeping write pin added; intent roles widened; the allowlist
     widened by one agent or made `NOT VALID`; the H3 allowlist or a planning check dropped on H4.
5. `supabase db push --dry-run` proposed exactly the three files. The push applied them, recorded them by name, and the
   copied files hashed to the approved digests.
6. Postconditions: **18/18 PASS**. Both `main`'s new contract and PR #223's contract pass on the migrated database.
7. Preconditions re-run after the apply: 5 FAIL (history, H3 allowlist, H3 checks, H5 absent, H4 bodies), so a replay
   is refused.
8. Every pinned md5 was recomputed independently from the dollar-quoted bodies in the migration files.

**Not covered:** the rehearsal database had no agent runs, planning rows or grants, so the data-fit probes were
trivially true. On staging they check the real rows before anything is applied. Behaviour on a migrated database is
covered by PR #223's CI (Database Migration Gate, real-DB integration suites).

## Recovery

- **No backup is taken.** The workflow takes no backup and cannot restore one. Before approving the
  `staging-migration-approval` deployment, a human confirms a recent restorable **staging** backup.
  - The last known one is `PatelRep-Staging-Backup-20261114-220001`, taken at head 243, so it predates H3 and H4.
  - Take a fresh one at head 250 first.
- **Behavioural rollback.** Leave every switch off. No H5 run can then be admitted or processed.
- **Schema rollback.** A new, separately reviewed forward migration. Restore the three H3 CHECKs only while no row uses
  an H5 value, and `CREATE OR REPLACE` the four redefined functions to their 243/247 bodies. History is never rewritten.
- **Failed postcondition.** Treat it as a staging incident: inspect read-only, fix forward.
- **Partial push failure.** The base moves, this entry is refused from then on, and a new entry is needed.
- **If #223 is abandoned,** land these exact files on `main` (with a forward revert) or staging stays ahead.

## Reviewer checklist

- [ ] Read 251, 252 and 253 in full at `caa3d75f9a91d1e90dea4e584afdb5afd2698728` and verify the three digests.
- [ ] Accept the five enumerated widenings in 251, the two new agents, and the high-risk Housekeeping write.
- [ ] Accept findings F1–F5 as non-blocking for staging (follow-ups for F1 and F5).
- [ ] Review the `scripts/schema-contracts.sql` change: H4 and H5 schemas both enforced, partial state fails closed.
- [ ] PR #223's head must stay `caa3d75f` until the preview applies. Once applied, 251–253 are frozen on staging, and
      #223 must merge with these exact files.
- [ ] Before approving the environment: a fresh staging backup at head 250 is confirmed restorable. No other PR needs
      staging for the next hours.
