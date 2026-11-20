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

Manifest v2 (§3) → autonomy grants issued by a DB-verified human (§4; step-up deferred, §4.1) → one atomic enforcement RPC
per level-3 tool with consumption binding, replay and quotas (§5) → emergency controls that linearize with execution (§6) → reliability rules (§7) →
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
| `idempotency` | `required_key` for every write; the run key is server-derived from (binding, trigger event id, resource, action) at admission and the invocation key keeps the H2 `tool:<run_id>:<step>` format (§5.3) |
| `audit` | `immutable_event` for every write |
| `approval` | `human_approval` or `bounded_grant` (a code-side declaration; the database authority is the SQL spec function, §5.1.1); `bounded_grant` only if effect ∈ {`advisory_annotation`, `internal_review_record`}, risk = low, consequence = operational, no system principal without a grant |
| `argument_schema` | closed object, no identity keys, **closed enums / ids only** for level-3 tools (no free text) |
| `manifest_digest`, `policy_digest` | SHA-256 of canonical JSON of the spec / of the policy inputs; the DB spec function returns the same digests and execution refuses on mismatch |
| `max_autonomy` | `bounded` only when every rule above holds; never `coordinated` in H7 |
| `delegation_depth` | must be 0 |

Model output can supply only arguments that pass the closed schema. It can never supply risk, effect, scope, trigger,
autonomy, approval mode, digests, tenant or actor.

## 4. Autonomy grants (future migration, Phase 3)

`agent_autonomy_grants` (one row per issuance; history kept by status, never deleted or resurrected):
`id`, `tenant_id`, `agent_id`, `agent_version`, `tool_id`, `tool_version`, `manifest_digest`, `policy_digest`,
`risk` (copied from the DB spec, never from input), `resource_scope` (validated jsonb, closed keys),
`quota_per_hour`, `quota_per_day`, `quota_per_resource_per_day` (all `> 0`), `issued_by_user_id`, `issuer_role`,
`issuer_session_id`, `step_up_evidence` (`none` or a reviewed method, §4.1), `issued_at`, `expires_at` (required,
≤ 30 days), `status` (`active|revoked|expired|superseded`), `revoked_at`, `revoked_by`, `revoke_reason_code`,
`delegation_depth smallint CHECK (= 0)`, `parent_grant_id CHECK (IS NULL)`. `UNIQUE (id, tenant_id)` (target of
composite FKs). At most one `active` row per binding (partial unique index on
`(tenant_id, agent_id, agent_version, tool_id, tool_version) WHERE status = 'active'`).

* **Issuance** `agent_autonomy_grant_issue(...)`: SECURITY DEFINER, `search_path = ''`, EXECUTE **only** to
  `authenticated`. The database itself establishes, in this order, and refuses on any failure:
  1. **Identity**: actor = `auth.uid()` (from the PostgREST-verified JWT; never a parameter); the token's
     `session_id` names a row in `auth.sessions` for that user that exists and has not ended (`not_after` unset or in
     the future), so a signed-out or revoked session cannot issue even with an unexpired token.
  2. **Current authority**: the token's hotel claim equals the actor's `user_profiles.tenant_id`; the actor holds
     exactly one active role there and it is `gm` (`agent__human_authority … FOR SHARE`); the hotel is active.
  3. **Step-up**: §4.1. This is a separate check from 1–2 and never replaces them.
  4. **Binding**: the exact binding exists in the DB autonomy spec with `approval = bounded_grant` and its digests.

  Issuance changes no platform switch, entitlement, level-2 grant, worker credential or quota counter.
  `service_role`/`agent_worker`: no EXECUTE. No role has INSERT/UPDATE on the table except through these functions
  (row guards for the owner, as 260).
* **Revocation** `agent_autonomy_grant_revoke(...)`: executable by `authenticated` (current GM; identity checks 1–2)
  and by `service_role` (operator CLI; the asserted actor is journaled with `actor_verified = false`). Monotonic
  (`active → revoked` only). Revocation never requires step-up: it only removes authority. Takes locks in §5.2 order.
* Every change journaled by the 256/260 trigger pattern; registry (254/261) extended; privilege matrix exact.

### 4.1 Token freshness is not step-up

A recent `iat` only shows that a token was **minted or refreshed** recently. Supabase refresh tokens re-mint access
tokens without the person re-entering anything, so `iat` proves neither re-authentication nor MFA. H7 keeps these
properties separate:

| Property | Evidence | DB check | Status |
|---|---|---|---|
| Identity | verified JWT `sub` | `auth.uid()` | required (Phase 2) |
| Live session | JWT `session_id` | `auth.sessions` row exists for `auth.uid()` and has not ended | required (Phase 2) |
| Token freshness | `iat`, `exp` | bounded age, recorded as metadata only | informational; **not** a security control |
| Step-up (fresh re-authentication or MFA) | to be designed | to be designed | **deferred** |

Step-up is **deferred** until a mechanism is designed and reviewed. Candidates to evaluate in Phase 2 (none is assumed
sufficient yet): Supabase MFA with `aal = 'aal2'` in the token **and** in the matching `auth.sessions` row, plus a
verified factor in `auth.mfa_factors` and an `amr` entry whose method is an MFA factor with a recent timestamp; or a
server-recorded, single-use re-authentication challenge consumed by the issuance RPC. The chosen design must be
verified against the deployed GoTrue version and checked by the database, not by the API.

Until then the issuance RPC uses the 261 database stamp (`agent_deployment_identity`): a database stamped `production`
**refuses** issuance with `step_up_required` (no production grant can exist); `development`/`test`/`staging` may issue
on identity + live session + current role alone and record `step_up_evidence = 'none'`, which the Control Center
shows. An unstamped database refuses.

## 5. Final transactional enforcement point (future, Phase 5)

One SECURITY INVOKER RPC per level-3 tool version, reached by the worker only through its `agent_worker_rpc__`
wrapper (261 tenant check first).

### 5.1 Schema that makes the binding enforceable

* `agent_autonomy_consumptions` (append-only): `id`, `tenant_id`, `grant_id`, `run_id`, `invocation_id`,
  `agent_id`, `agent_version`, `tool_id`, `tool_version`, `action_digest`, `idempotency_key`, `resource_id`,
  `manifest_digest`, `consumed_at`.
  * FKs: `(grant_id, tenant_id) → agent_autonomy_grants (id, tenant_id)`;
    `(invocation_id, tenant_id) → agent_tool_invocations (id, tenant_id)`; `(run_id, tenant_id) → agent_runs`.
  * `UNIQUE (invocation_id)`, `UNIQUE (tenant_id, idempotency_key)`, `UNIQUE (id, tenant_id)`.
  * BEFORE INSERT guard: the grant is `active`, unexpired, same tenant, and its binding and digests equal the
    invocation's; the invocation's agent, tool, digest, idempotency key, resource and run equal the row's; and the
    invocation is a **bounded-grant invocation** as proven by §5.1.1 (never by a stored or caller-supplied flag).
  * Row guard refusing UPDATE/DELETE for every role including the owner; BEFORE TRUNCATE refusal; in the 254/261
    registry as append-only.
  * **Deferred constraint trigger** (`CREATE CONSTRAINT TRIGGER … AFTER INSERT … DEFERRABLE INITIALLY DEFERRED`): at
    commit, exactly one `agent_tool_executions` row with `state = 'succeeded'` must reference this consumption. A
    consumption with no execution, or with a failed one, aborts the whole transaction. `SET CONSTRAINTS … IMMEDIATE`
    only makes it fire earlier (and fail, because the execution does not exist yet); it cannot skip it.
* `agent_tool_executions` gains one nullable column by forward migration: `autonomy_consumption_id uuid`, with
  `FOREIGN KEY (autonomy_consumption_id, tenant_id) → agent_autonomy_consumptions (id, tenant_id)` and
  `UNIQUE (autonomy_consumption_id)`. So a consumption can be attached to at most one execution, and only to one in
  the same tenant. The table stays immutable (existing guards).
* The 254 BEFORE INSERT guard is replaced by a new forward function (same trigger name, swapped in the same migration
  transaction). For `access = 'write' AND state = 'succeeded'` it requires **exactly one** of:
  * **approval path**: `approval_id IS NOT NULL AND autonomy_consumption_id IS NULL`, plus the unchanged 254 approval
    conditions (approved, unconsumed, unexpired, decider set, independence rule); or
  * **bounded path**: `autonomy_consumption_id IS NOT NULL AND approval_id IS NULL`; the consumption row exists; its
    `(tenant_id, run_id, invocation_id, tool_id, tool_version, action_digest, idempotency_key)` equal the
    execution's; and its grant is still `active` and unexpired (that grant row is already held FOR SHARE from step 5
    of §5.2, so the read is stable).

  Neither or both → refuse. A failed execution must have `autonomy_consumption_id IS NULL`. The approval branch keeps
  254's exact predicate; Phase 5 re-runs the existing 254 integration tests unchanged against the new function.

#### 5.1.1 Approval-mode authority (no `approval_mode` column)

`agent_tool_invocations` (241) has no approval-mode column, and H7 does **not** add one. The authorization mode of an
invocation is a pure function of its exact `(agent_id, agent_version, tool_id, tool_version)`, read from
database-authoritative specifications reviewed in migrations:

* `agent__gateway_tool_spec(agent, version, tool, version)` (243/253, unchanged): the **human-approved** set.
* `agent__autonomy_tool_spec(agent, version, tool, version)` (new, Phase 5; `IMMUTABLE`, `search_path = ''`, owner
  only, no EXECUTE for any application role): the **bounded-grant** set. It returns `approval = 'bounded_grant'`,
  `risk = 'low'`, the effect type, resource type, argument shape and the `manifest_digest` / `policy_digest`, or NULL.
* **Disjointness:** no binding may be returned by both functions. A Phase 5 postcondition, the schema contract and a
  smoke contract (Python registry vs. both SQL specs) enforce it; each later migration that edits either function
  re-asserts it.

The consumption guard and the bounded execute RPC therefore prove a bounded-grant invocation by:
`agent__autonomy_tool_spec(inv.agent_id, inv.agent_version, inv.tool_id, inv.tool_version) IS NOT NULL`, **and**
`agent__gateway_tool_spec(…same…) IS NULL`, **and** the spec's `manifest_digest` / `policy_digest` equal the grant's,
**and** `inv.access = 'write'` and `inv.resource_type` equal the spec's. NULL from the autonomy spec (unknown version,
partial migration) refuses. Consequences, all fail closed: a bounded tool version can never be approved through H2
(`agent__gateway_refusal` already returns `tool_not_allowed` for a binding the gateway spec does not know), and an
approved tool version can never be consumed under a grant.

Alternative considered: a separately reviewed schema extension adding
`agent_tool_invocations.authorization_mode text NOT NULL DEFAULT 'human_approval' CHECK (… IN ('human_approval',
'bounded_grant'))`. Not chosen: it duplicates what the spec already determines, gives a second source of truth that
could disagree with the spec, and alters a reviewed H2 table. If ever adopted it would need its own migration review,
a BEFORE INSERT guard requiring the column to equal the spec-derived mode, and an immutability guard, and the spec
check above would still be required.

Why this ordering works: the **consumption is inserted before the execution** in the same transaction, so the
execution's BEFORE INSERT guard can see it. The deferred trigger covers the reverse direction (no orphan
consumption). The FKs and `UNIQUE (autonomy_consumption_id)` stop a consumption being attached to an unrelated or a
second execution. Any failure raises and rolls back the domain effect, the consumption, the quota increments and the
execution together.

### 5.2 Algorithm and lock order

Every path that touches these rows takes locks in a prefix of this order. Stop paths take the step-5 locks in the same
order, so no deadlock cycle exists.

1. Wrapper: 261 credential and tenant check.
2. `agent_runs` row `FOR UPDATE` via `agent__owned_run` (lease fence); `lease_lost` before anything else.
3. Load the invocation for this run and step (`tenant_id`, `run_id`, `step_number`) and prove it is a bounded-grant
   invocation (§5.1.1); otherwise `invocation_invalid`.
4. **Replay lookup** (§5.3) on `agent_tool_executions (tenant_id, idempotency_key)` using the invocation's key. A
   committed outcome returns here. The run row lock from step 2 already serialises every execute call for this
   invocation (an invocation belongs to exactly one run), so no extra lock is needed.
5. `agent_autonomy_platform_state` (id = 1) `FOR SHARE` (must exist and be enabled; platform pause, cost stop and the
   autonomy switch are written to this row), then `agent_autonomy_tenant_state (tenant_id)` `FOR SHARE` (must exist;
   hotel pause, agent/tool pause projections and credential revocations bump `epoch` on it via trigger), then the
   `agent_autonomy_grants` row `FOR SHARE` where `status = 'active' AND expires_at > now()` and binding/digests equal
   the invocation's.
6. Quota rows (§5.4): create if missing and lock, in the fixed order hour → day → resource-day; refuse if any is
   exhausted.
7. Domain resource row `FOR UPDATE` in the run's tenant; refuse `resource_changed` when the expected version differs.
8. Domain operation (the shared function the human route uses).
9. If the domain outcome is a change: insert consumption → increment the three counters → insert execution
   (`succeeded`, `autonomy_consumption_id` set) → outbox row (§7.1) → tool event. If the domain refused
   (`not_found`, `resource_changed`, …): insert a `failed` execution with no consumption, and a tool event; no quota
   is used.
10. Commit (the deferred trigger runs here).

A refusal at steps 5–7 writes a refusal event and returns without consumption, counter change or execution. The RPC
runs under bounded `statement_timeout` and `lock_timeout`; a timeout aborts everything.

**Revocation linearization point:** the commit of the revoking `UPDATE` on the grant row (or on the platform/tenant
state row for stops). Under READ COMMITTED a revoking `UPDATE` waits for any in-flight `FOR SHARE` holder to commit;
an executor that requests `FOR SHARE` after the revoke committed re-evaluates its `WHERE` on the latest row version and
finds no active grant. So every **new** level-3 effect either commits entirely before the revocation commits, or is
refused. (Today's level-2 RPCs read controls and grants **without** row locks; that is R-E in threat-model-h7.md, and
H7 must not copy it.)

### 5.3 Idempotency and replay

Idempotency is enforced in **two layers**, both on existing H1/H2 structures, and the H2 baseline is unchanged:
`agent_runs UNIQUE (tenant_id, idempotency_key)` (238), `agent_tool_invocations UNIQUE (tenant_id, idempotency_key)`
and `UNIQUE (run_id, step_number)` (241), and `agent_tool_executions UNIQUE (tenant_id, idempotency_key)` and
`UNIQUE (invocation_id)` (241).

**Layer A — one action, one run (admission).** Duplicate triggers for the same action are collapsed **before any
invocation exists**:

* The future bounded admission RPC (Phase 5; the bounded counterpart of `agent_tool_run_admit`) derives the **run**
  idempotency key on the server: `autonomy:` ‖ `sha256(canonical(binding, trigger event id, resource id, canonical
  action))`, and a `request_digest` over the same canonical body. The model and the caller cannot choose either.
* It admits through the unchanged `agent_run_admit`, which already inserts with `ON CONFLICT (tenant_id,
  idempotency_key) DO NOTHING`: a concurrent or repeated admission of the same action returns the **existing** run
  (`created = false`); a different digest under the same key returns `idempotency_conflict`.
* Only the admission that created the run inserts its single invocation, with the unchanged H2 key format
  `tool:<run_id>:<step_number>` (as `agent_tool_run_admit` does in 243). A non-creating admission re-reads that
  invocation and refuses `idempotency_conflict` if its digest differs.
* A run admitted for an action is never re-admitted: if it ended `failed`, `dead_letter` or `cancelled`, a duplicate
  trigger gets the terminal run back and no new attempt starts. A genuinely new attempt needs a new trigger event
  (new key), which then faces full authorization, quota and `resource_changed` checks.

**Layer B — one invocation, one execution (execute RPC).** The execution's key is copied from its invocation, so each
execution key belongs to exactly one invocation and one run.

* Replay lookup runs **after** the lease fence (step 2) and the invocation proof (step 3), and **before** controls,
  grant and quota. If an execution exists for `(tenant_id, idempotency_key)`:
  * its `invocation_id` and `action_digest` equal the current invocation's → return the committed outcome
    (`replayed`). No domain call, no consumption, no quota change, no new execution; only a replay event;
  * anything else → `idempotency_conflict`, refuse and write a refusal event. Under the unique constraints this
    cannot happen through any reviewed path; the check is defence in depth and fails closed.
* A replay is returned **even if the grant has since been revoked or a pause is active**: it reports an effect that
  committed before the revocation's linearization point and causes no new effect. It still requires the 261 tenant
  check and a valid lease.
* No execution found → full authorization from step 5; a revoked grant now refuses.
* Concurrent execute calls for the same invocation (e.g. a lease takeover after a stalled worker) are serialised by
  the run row lock in step 2: the stale holder gets `lease_lost`; the current holder either performs the action once
  or, after a committed attempt, replays it.
* Backstops: `UNIQUE (tenant_id, idempotency_key)` on executions and on consumptions, `UNIQUE (invocation_id)` on
  both, and the invocation-level unique key make any bypass a unique violation and a full rollback.

### 5.4 Quota counters

`agent_autonomy_quota_counters`:

| Column | Meaning |
|---|---|
| `tenant_id`, `agent_id`, `agent_version`, `tool_id`, `tool_version` | the binding (not the grant id, so revoking and re-issuing a grant cannot reset usage inside a window) |
| `window_kind` | `hour`, `day` or `resource_day` |
| `window_start` | `hour`: `date_trunc('hour', now())` in UTC. `day` / `resource_day`: start of the hotel-local calendar day from `tenants.timezone` (missing or invalid timezone → refuse) |
| `resource_key` | the resource id for `resource_day`; the nil UUID for `hour` / `day` (NOT NULL, so the key is total) |
| `used` | `integer NOT NULL CHECK (used >= 0)` |

Primary key `(tenant_id, agent_id, agent_version, tool_id, tool_version, window_kind, window_start, resource_key)`;
`CHECK ((window_kind = 'resource_day') = (resource_key <> '00000000-0000-0000-0000-000000000000'))`; FK on
`tenant_id`. `now()` is the transaction timestamp, so all three windows use the same instant. Rows are kept as
evidence, and no role except the RPC writes them.

Step 6, for each key in the order hour → day → resource-day:

```sql
INSERT INTO agent_autonomy_quota_counters (<key columns>, used) VALUES (<key>, 0)
ON CONFLICT (<primary key>) DO NOTHING;            -- atomic first use: concurrent creators cannot duplicate
SELECT used FROM agent_autonomy_quota_counters WHERE <primary key> = <key> FOR UPDATE;  -- serialises the window
-- refuse 'quota_exhausted' if used >= the active grant's limit for this window kind
```

Step 9, only after a successful domain change: `UPDATE … SET used = used + 1` on the three locked rows. The limit is
the active grant's value read under the step-5 lock, not a stored copy. Failed domain outcomes, refusals and replays
never increment.

### 5.5 Required tests (Phases 3 and 5, real database)

1. A succeeded bounded write without a consumption → guard refuses; with both an approval and a consumption → refuses.
2. A consumption without an execution → commit fails (deferred trigger); with only a failed execution → commit fails.
3. A consumption referenced by a second execution → unique violation; by an execution of another tenant, invocation
   or digest → guard refuses or FK fails.
4. UPDATE/DELETE/TRUNCATE on consumptions by every role, owner included → refused.
5. Domain error after the consumption insert → no consumption, counter change, execution or business change persists.
6. Idempotency, both layers:
   a. N concurrent bounded admissions of the same action (same trigger event, resource, action) → exactly one run and
      one invocation (`tool:<run_id>:1`); the others return that run with `created = false`. Same run key with a
      different request digest → `idempotency_conflict`, no run.
   b. A duplicate admission after the run ended `failed`/`dead_letter`/`cancelled` → the terminal run is returned; no
      new invocation, execution, consumption or quota change.
   c. Two concurrent execute calls for one invocation (lease takeover) → the stale lease gets `lease_lost`; exactly
      one effect, one consumption, quota +1; a later call `replayed` with counters unchanged.
   d. A forged execution or consumption whose key belongs to a different invocation, and a direct second invocation
      insert with an existing key → unique violation / `idempotency_conflict`; nothing persists.
   e. The unchanged H2 admission and execution idempotency integration tests pass.
7. Replay after revocation and during a hotel pause → `replayed`, counters unchanged, no domain call.
8. New key after revocation → refused. A revoke concurrent with an in-flight execution → the revoke waits; the
   execution either commits before it or is refused after it.
9. Concurrent first use of an empty hour/day/resource-day window → exactly one counter row each; N concurrent
   attempts against limit L → exactly L succeed.
10. Revoke and re-issue within a window → usage is not reset.
11. Day boundary in the hotel's timezone (including a DST change) → correct window; missing timezone → refuse.
12. The unchanged 254 approval-path integration tests pass against the replaced guard.
13. Approval-mode authority (§5.1.1): a binding present in both spec functions fails the migration postcondition and
    the schema contract; a bounded tool version cannot be admitted or approved through H2 (`tool_not_allowed`); an
    approved tool version cannot be consumed under a grant; an autonomy-spec digest that differs from the grant's
    refuses; a missing `agent__autonomy_tool_spec` (partial migration) refuses.

## 6. Emergency controls

The rows below marked H1 describe the implemented functions (239/240, and the tenant-scoped copies in 261).

| Stop arrives… | Effect |
|---|---|
| before admission (H1) | admission refuses on the block reason; no run row |
| while queued: platform/hotel/agent pause or cost stop (H1) | `agent_run_claim` returns `blocked`, **redispatches** the message after `p_blocked_retry` seconds (1–3600, default 30), records `control_blocked` and leaves the run `queued`. A crashed worker's expired `running` lease is handed back to `queued`. The run is **not** cancelled: it continues once the control is lifted, or fails with `deadline_exceeded` when its deadline passes |
| between steps (H1) | `agent_step_complete` sees the block, creates the next step as `pending` and returns the run to `queued`; no new step starts |
| run-level pause or cancel by a human (H1) | `agent_run_pause` → `paused` (needs resume); `agent_run_cancel` → `cancelled`. These are explicit actions, never a side effect of a control |
| before the execute RPC takes the step-5 locks (H7) | the RPC sees the committed stop and refuses; the run then follows the blocked path above |
| while the execute RPC holds the step-5 locks (H7) | the stop's `UPDATE` waits; the in-flight write commits or aborts; the next one is refused |
| after commit (H7) | nothing is undone automatically; compensation is a separate human action (level-3 effects are internal and reversible by design) |

Preserved and unchanged: platform pause, cost emergency stop, hotel/agent/tool pause, `agent_execution_enablement`,
worker credential revocation, `REVOKE agent_worker FROM authenticator`, `AGENT_GATEWAY_EXECUTION_ENABLED`, `APP_ENV`
production refusal, the 261 production stamp. A grant cannot override any of them.

## 7. Reliability rules

| Situation | Rule |
|---|---|
| Duplicate trigger / redelivery | layer A: server-derived run key collapses duplicates at admission into one run and one invocation; layer B: execution replay for that invocation (§5.3) |
| Stale facts | the action carries the expected version; step 7 re-checks; `resource_changed` → failed execution, no quota, escalate |
| Concurrent human update | step 7 serialises; whichever commits second sees the change and refuses |
| Lease loss | step 2 refuses before any other lock |
| Timeout | the transaction aborts; a retry with the same key is safe |
| Crash after commit | a retry with the same key replays the committed outcome |
| Uncertain outcome (lost response) | same as crash after commit; never a new key for the same action |
| Repeated refusals / quota exhausted | create one internal review record (deduplicated per resource and day) for a human; the agent stops for that resource |
| Staff notification | durable transactional outbox (§7.1); never a correctness dependency |

### 7.1 Notifications: transactional outbox, at-least-once

External push delivery cannot be exactly-once: a provider can accept a message and the acknowledgement can be lost.
The design:

* The execute RPC inserts an `agent_notification_outbox` row **in the same transaction** as the effect, so a
  notification exists if and only if the effect committed. A replay inserts nothing (`UNIQUE (execution_id, kind)`).
* An API-side dispatcher claims rows with `FOR UPDATE SKIP LOCKED` and a lease (`claimed_until`), sends, then marks
  the row `delivered`. If it crashes before marking, the lease expires and the row is retried. Delivery is
  therefore **at-least-once** and a recipient may occasionally get a duplicate. Retries are bounded with backoff;
  after N attempts the row becomes `dead_letter`, visible in the Control Center.
* Each send carries the outbox row id as a collapse/idempotency key where the push provider supports one, and the
  mobile app de-duplicates by that id. Neither is relied on for correctness.
* The worker never sends and has no device-token access (ADR-0005 L3 stays true).

## 8. Delegation (H8 compatibility)

`delegation_depth` and `parent_grant_id` exist so H8 can add scoped delegation by forward migration, but H7 pins them
with `CHECK (delegation_depth = 0)` and `CHECK (parent_grant_id IS NULL)`; no H7 function reads or writes them, and
the worker can never call issuance.
