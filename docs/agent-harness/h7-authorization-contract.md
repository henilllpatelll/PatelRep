# H7 authorization contract: evidence, manifest v2, grants, enforcement

Status: Phase 1 design. §1 describes what is **implemented** at `961a012b`; §2–§8 describe **future** H7 behaviour
that does not exist yet. Decision record: [ADR-0006](adr-0006-h7-bounded-autonomy.md).

## 1. H0–H6 evidence matrix (implemented, verified at file/symbol level)

"Py" = Python pre-check (advisory); "DB" = enforced inside PostgreSQL in the write transaction. A guarantee counts as
database-enforced only when a DB row is listed.

| # | Guarantee | Enforcement point(s) | Layer | Test evidence |
|---|---|---|---|---|
| E1 | Agent/tool manifests validated, frozen, exact (id, version) | `agent_harness/tools.py:ToolSpec._cross_field_rules`, `ToolRegistry.resolve_untrusted`; `agents.py:AgentSpec._self_consistent`, `AgentRegistry.register` | Py | `smoke/test_agent_harness_registry.py` |
| E2 | Manifest v1 cannot express an unapproved or low-risk write; system principals hold no writes | `tools.py:ToolSpec._cross_field_rules` (write ⇒ `human_approval`, `required_key`, `immutable_event`, risk ≥ medium) | Py | `smoke/test_agent_h7_autonomy_contracts.py` (H7 P1) |
| E3 | Default deny, stable reason codes, model tool name untrusted | `agent_harness/policy.py:evaluate` | Py | `smoke/test_agent_harness_policy.py` |
| E4 | Identity only from trusted context; identity keys in arguments refused (top level + nested) | `identity.py:TrustedExecutionContext`, `_mint`; `policy.py:evaluate` (`IDENTITY_CLAIM_KEYS`); `agent_gateway/schema.py:validate_arguments` | Py | `smoke/test_agent_harness_identity.py`, `smoke/test_agent_gateway_schema_output.py` |
| E5 | Writes capped at level 2; level 3/4 not evaluable | `autonomy.py:requires_human_authority`, `effective_autonomy`; `policy.py:POLICY_AUTONOMY_CEILING` | Py | H7 P1 contracts |
| E6 | Level 3/4 unrepresentable in persisted grants | `241: agent_tool_grants.max_level CHECK (1,2)`; `243: agent_tool_grant_set` (`invalid_level`) | DB | H7 P1 contracts (text pin), `integration/test_agent_gateway_reads_admission.py` |
| E7 | Exact executable tool set (three places agree) | `controls.py:H2_EXECUTABLE_TOOLS`; `agent_gateway/bindings.py:BindingRegistry.register`; `243/253: agent__gateway_tool_spec` | Py+DB | `smoke/test_agent_gateway_policy.py`, H7 P1 contracts |
| E8 | One reviewed atomic RPC per write tool | `bindings.py:WRITE_RPCS`; `243: agent_tool_execute_work_order_assign`; `253: agent_tool_execute_room_assignment` | Py+DB | `integration/test_agent_gateway_approvals_write.py` |
| E9 | Lease fencing before any write | `239: agent__owned_run` (run row `FOR UPDATE`, fencing token) called first in each execute RPC | DB | `integration/test_agent_gateway_concurrency_recovery.py` |
| E10 | Controls re-checked in the write txn (platform/hotel/agent pause, cost stop, enablement, tool pause) | `239: agent__control_block_reason`; `243: agent__tool_block_reason`, `agent__gateway_refusal` | DB (unlocked read, see R-E) | `integration/test_agent_execution_control.py` |
| E11 | Initiator and approver CURRENT single active role re-read in txn | `243: agent__human_authority` (`user_roles … FOR SHARE`) | DB | `integration/test_agent_approval_independence.py` |
| E12 | Approval bound to digest, tenant, initiator, agent+tool versions, resource; single use; unexpired | execute RPCs (approval row `FOR UPDATE`, binding checks, `consumed_at`) | DB | `integration/test_agent_gateway_approvals_write.py` |
| E13 | A succeeded write always carries a valid independent approval | `254: agent__guard_execution_approval` (BEFORE INSERT on `agent_tool_executions`) | DB | `integration/test_agent_audit_integrity.py` |
| E14 | Approval independence on insert/update | `254: agent__guard_approval_independence` | DB | `integration/test_agent_approval_independence.py` |
| E15 | Idempotency: one execution per (tenant, key); replay returns the committed outcome | execute RPCs + unique `(tenant_id, idempotency_key)` | DB | `integration/test_agent_gateway_concurrency_recovery.py` |
| E16 | Tenant scoping of every harness RPC | `p_tenant_id` predicates + tenant-consistent FKs (238/241) | DB | `integration/test_agent_execution_isolation_recovery.py`, `smoke/test_agent_gateway_isolation.py` |
| E17 | Worker is not `service_role`; 23 wrappers only; column-scoped reads | `255: agent__worker_assert`, `agent_worker_rpc__*`, `agent_worker_privilege_violations`; `agent_execution/worker_identity.py:RestrictedWorkerClient` | DB+Py | `integration/test_agent_worker_identity.py`, `smoke/test_agent_worker_identity.py` |
| E18 | Worker bound to exactly one hotel and the stamped environment; production grants nothing; ≤ 7-day tokens | `261: agent__worker_tenant`, `agent_worker_tenant_gate` (RESTRICTIVE), `agent_deployment_identity`, wrapper tenant checks | DB | `integration/test_agent_worker_tenant_binding.py`, `…_tenant_concurrency.py`, `smoke/test_agent_worker_target_allowlist.py` |
| E19 | Exact backend privilege matrix; no DELETE/TRUNCATE on harness tables for app roles | `254/258/259/261: agent_audit_privilege_violations`, `agent_audit_privileges_enforce`; `agent__refuse_truncate` | DB | `integration/test_agent_privilege_matrix.py`, `scripts/schema-contracts.sql` |
| E20 | Control rows: identity immutable, no DELETE, every change journaled | `259: agent__guard_control_delete`; `260: agent__guard_control_update`; `256/260: agent__journal_control_change` | DB | `integration/test_agent_control_delete_guard.py`, `…_update_guard.py` |
| E21 | Control Center re-validates membership/role on every request; hotel from JWT | `agent_control_center/access.py:revalidate`; `agent_execution/identity_authority.py:SupabaseIdentityAuthority` | Py (API trusted, R-A) | `integration/test_agent_control_center.py` |
| E22 | No Control Center path enables execution/autonomy | `routers/agent_control_center.py` (no such endpoint) | Py (static) | `smoke/test_agent_control_center_contracts.py` |
| E23 | Default-off process gates; production refused in code | `agent_gateway/authorization.py:process_allows_execution`; `agent_execution/config.py:WorkerSettings`; `agent_orchestrator/config.py`; `agent_billing/config.py` | Py | H7 P1 contracts, `smoke/test_agent_execution_contracts.py` |
| E24 | Model spend reserved before dispatch; customer hold bound to reservation | `245: agent_model_attempt_reserve`; `249: agent_billing_attempt_reserve`; `250: agent__guard_attempt_customer_hold` | DB | `integration/test_agent_orchestrator_ledger*.py`, `…customer_billing_dispatch_guard.py` |
| E25 | Proposals never execute; handoff re-checks fresh facts | `252: agent_proposal_handoff_admit` | DB | `integration/test_agent_specialists_handoff.py` |

## 2. What H7 adds (summary)

Manifest v2 (§3) → autonomy grants issued by a DB-verified human (§4) → one atomic enforcement RPC per level-3 tool
with fixed lock order (§5) → emergency controls that linearize with execution (§6) → reliability rules (§7) →
delegation depth 0 (§8).

## 3. Manifest v2 (code, validated deterministically)

Schema ids: `patelrep.agent-manifest/v2`, `patelrep.tool-contract/v2`. v1 classes and `SUPPORTED_MANIFEST_SCHEMAS`
for v1 stay unchanged; v2 lives in separate classes and a separate supported set. A v2 manifest is **inert**: it can
be registered without becoming executable (§5 still needs the code set, the binding, the DB spec and a grant).

| Field | Rule |
|---|---|
| `agent_id`/`tool_id` + integer `version` | existing patterns; exact pins; one version per tool per agent; never "latest" |
| `capability` | must exist in `CAPABILITY_CATALOG`; access and domain must match; forbidden domains refused |
| `effect_type` | closed enum: `observe`, `advisory_annotation`, `internal_review_record`, `operational_mutation`, `guest_communication`, `pms_mutation`, `financial`, `personnel`, `safety` |
| `risk` | must be ≥ the floor derived from (capability consequence, effect type) in risk-model-h7.md; may be raised, never lowered |
| `resource_scope` | `resource_type` + closed scope keys (e.g. `building`, `floor`, `work_order_category`); no free-form filters |
| `authorization_triggers` | closed enum (`user_request`, `schedule`, `event:<reviewed_event>`); level 3 requires a reviewed trigger list |
| `execution_limits` | v1 `ExecutionLimits` + `max_writes_per_run` (≤ 1 in H7) |
| `idempotency` | `required_key` for every write; key derivation declared (grant id + trigger event id + resource + action) |
| `audit` | `immutable_event` for every write |
| `approval` | `human_approval` or `bounded_grant`; `bounded_grant` only if effect ∈ {`advisory_annotation`, `internal_review_record`}, risk = low, consequence = operational, no system principal without a grant |
| `argument_schema` | closed object, no identity keys, **closed enums / ids only** for level-3 tools (no free text) |
| `manifest_digest`, `policy_digest` | SHA-256 of canonical JSON of the spec / of the policy inputs; the DB spec function returns the same digests and execution refuses on mismatch |
| `max_autonomy` | `bounded` only when every rule above holds; never `coordinated` in H7 |
| `delegation_depth` | must be 0 |

Model output can supply only arguments that pass the closed schema. It can never supply risk, effect, scope, trigger,
autonomy, approval mode, digests, tenant or actor.

## 4. Autonomy grants (future migration, Phase 3)

`agent_autonomy_grants` (one row per hotel × agent version × tool version; history kept by status, never deleted):
`id`, `tenant_id`, `agent_id`, `agent_version`, `tool_id`, `tool_version`, `manifest_digest`, `policy_digest`,
`risk` (copied from the DB spec, never from input), `resource_scope` (validated jsonb, closed keys),
`quota_per_hour`, `quota_per_day`, `quota_per_resource_per_day`, `issued_by_user_id`, `issuer_role`,
`issued_at`, `issuer_token_iat`, `expires_at` (required, ≤ 30 days), `status` (`active|revoked|expired|superseded`),
`revoked_at`, `revoked_by`, `revoke_reason_code`, `delegation_depth smallint CHECK (= 0)`,
`parent_grant_id CHECK (IS NULL)`. At most one `active` row per binding (partial unique index).

* **Issuance** `agent_autonomy_grant_issue(...)`: SECURITY DEFINER, EXECUTE **only** to `authenticated`; actor =
  `auth.uid()`, hotel = the verified token's hotel claim cross-checked with `user_profiles`; actor must be the current
  single-role GM (`agent__human_authority … FOR SHARE`); token `iat` within the step-up window; the binding must exist
  in the DB autonomy spec with `approval = bounded_grant`; the platform autonomy switch, the hotel's `ai_agents`
  entitlement and a level-2/observe grant are **not** created or changed by issuance. `service_role`/`agent_worker`:
  no EXECUTE. No role has INSERT/UPDATE on the table except through these functions (row guards for the owner, as 260).
* **Revocation** `agent_autonomy_grant_revoke(...)`: executable by `authenticated` (current GM / chief for own domain)
  and by `service_role` (operator, journaled with the asserted actor flagged `unverified`); monotonic (active →
  revoked only). Takes the locks in §5 order.
* **Consumption ledger** `agent_autonomy_consumptions` (append-only): `grant_id`, `execution_id`,
  `idempotency_key`, `action_digest`, `resource_id`, `consumed_at`; unique `(grant_id, idempotency_key)`.
* **Quota counters** `agent_autonomy_quota_counters (grant_id, window_start, used)`; checked and incremented under
  `FOR UPDATE` in the execution transaction.
* Every change journaled by the 256/260 trigger pattern; registry (254/261) extended; privilege matrix exact.

## 5. Final transactional enforcement point (future, Phase 5)

One SECURITY INVOKER RPC per level-3 tool version, reached by the worker only through its `agent_worker_rpc__`
wrapper (261 tenant check first). **Lock order** (every path that touches these rows uses a prefix of this order;
stop paths take step 2–4 locks in the same order, so no deadlock cycle exists):

1. `agent_runs` row `FOR UPDATE` via `agent__owned_run` (lease fence) → `lease_lost` before anything else.
2. `agent_autonomy_platform_state` (id = 1) `FOR SHARE` — must exist and be enabled; covers platform pause, cost stop
   and the autonomy switch (stop paths `UPDATE` it).
3. `agent_autonomy_tenant_state (tenant_id)` `FOR SHARE` — must exist; hotel pause, agent/tool pause projections and
   credential revocations bump `epoch` on this row via trigger.
4. `agent_autonomy_grants` row `FOR SHARE` where `status = 'active' AND expires_at > now()` and the binding/digests
   equal the invocation's.
5. `agent_autonomy_quota_counters` row `FOR UPDATE`; refuse when exhausted.
6. Domain resource row `FOR UPDATE` in the run's tenant; refuse `resource_changed` when the expected version/fact differs.
7. Idempotency lookup by `(tenant_id, idempotency_key)` → replay committed outcome (no second effect).
8. Domain operation (shared function used by the human route), `agent_tool_executions` insert (254 guard extended:
   approval **or** a consumption row for this execution in this transaction), consumption insert, quota increment,
   tool event, commit.

Each check that fails writes a refusal event and returns; nothing is consumed. The whole RPC runs under a bounded
`statement_timeout`/`lock_timeout`; a timeout aborts the transaction (no partial effect).

**Revocation linearization point:** the commit of the revoking `UPDATE` on the grant row (or on the platform/tenant
state row for stops). Under READ COMMITTED, a revoking `UPDATE` waits for any in-flight `FOR SHARE` holder to commit;
an executor that requests `FOR SHARE` after the revoke committed re-evaluates its `WHERE` on the latest row version and
finds no active grant. So every level-3 write either commits entirely before the revocation commits, or is refused.
(Today's level-2 RPCs read controls and grants **without** row locks — R-E in threat-model-h7.md; H7 must not copy that.)

Python `policy.evaluate` keeps returning `requires_approval` for every write until Phase 5 explicitly adds a
level-3 branch; even then an `allow` only lets the worker *call* the RPC above.

## 6. Emergency controls

| Stop arrives… | Effect |
|---|---|
| before admission | admission (`agent_tool_run_admit` successor) refuses; no run row |
| while queued | claim (`agent_run_claim`) refuses on block reason; run cancelled per H1 |
| between steps | step context re-reads controls; step not started |
| before the execute RPC takes lock 2/3/4 | RPC sees the committed stop and refuses |
| while the execute RPC holds locks | the stop's `UPDATE` waits; the in-flight write commits or aborts; the next one is refused |
| after commit | nothing to undo automatically; compensation is a separate human action (level-3 effects are internal and reversible by design) |

Preserved and unchanged: platform pause, cost emergency stop, hotel/agent/tool pause, `agent_execution_enablement`,
worker credential revocation, `REVOKE agent_worker FROM authenticator`, `AGENT_GATEWAY_EXECUTION_ENABLED`, `APP_ENV`
production refusal, the 261 production stamp. A grant cannot override any of them.

## 7. Reliability rules

| Situation | Rule |
|---|---|
| Duplicate trigger / redelivery | deterministic idempotency key; unique index; replay |
| Stale facts | action carries expected version; lock 6 re-checks; `resource_changed` → no write, escalate |
| Concurrent human update | lock 6 serialises; whichever commits second sees the change and refuses |
| Lease loss | lock 1 refuses before any other lock |
| Timeout | transaction aborts; retry with the same key is safe |
| Crash after commit | retry with the same key replays the committed outcome |
| Uncertain outcome (lost response) | same as crash after commit; never a new key for the same action |
| Repeated refusals / quota exhausted | create one internal review record (deduplicated per resource/day) for a human; the agent stops for that resource |

## 8. Delegation (H8 compatibility)

`delegation_depth` and `parent_grant_id` exist so H8 can add scoped delegation by forward migration, but H7 pins them
with `CHECK (delegation_depth = 0)` and `CHECK (parent_grant_id IS NULL)`; no H7 function reads or writes them, and
the worker can never call issuance.
