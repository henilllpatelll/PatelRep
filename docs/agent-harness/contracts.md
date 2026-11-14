# PatelRep Agent Harness: Implemented Contracts (H0)

Code: `apps/api/services/agent_harness/`. All models are Pydantic v2, frozen, `extra="forbid"`. Integers and
booleans use strict types (no `"1"`→`1`, no `True`→`1`). Money and credits are `Decimal`, and floats are refused.

## 1. Agent Registry (`agents.py`)

`AgentSpec` fields: `manifest_schema` (must be `patelrep.agent-manifest/v1`), `agent_id` (dotted lowercase, e.g.
`examples.work_order_observer`), `agent_version` (int), `name`, `product_family` (operations | guest | growth |
owner | connect), `description`, `tools` (exact `ToolRef(tool_id, version)` pins), `capabilities`,
`autonomy_ceiling` (default `OBSERVE`), `required_feature_flags` (must include `ai_agents`), `resource_types`,
`triggers` (user_request | schedule | event), `limits` (`ExecutionLimits`: steps, tool calls, runtime,
`max_credits_per_run`), `model_purpose`, `approval_policies`, `enabled` (default **False**).

Validation fails on: unsupported schema; invalid id; unknown capability, flag or approval policy; a missing `ai_agents`
flag; duplicate tool pins or two versions of one tool; write capabilities without an approval policy or with a
ceiling below `HUMAN_APPROVED`; malformed limits.

`AgentRegistry(tool_registry)` requires a frozen tool registry. `register()` fails with a coded `RegistryError` on
`duplicate_agent`, `unknown_tool`, `incompatible_tool_version`, `undeclared_capability`, `missing_tool_flag` and
`resource_scope_mismatch`. `freeze()` makes it immutable. A registry entry grants nothing.

## 2. Tool Registry (`tools.py`)

`ToolSpec` fields, all security-relevant ones **required, with no defaults**: `tool_id`, `version`, `description`,
`input_schema`, `output_schema` (closed JSON objects: `additionalProperties: false`, no `$ref`, no identity keys),
`capability`, `access` (read | write), `risk` (low | medium | high | critical), `allowed_roles`,
`allowed_system_principals`, `resource_type`, `requires_resource_id`, `required_feature_flags`, `approval`,
`timeout_seconds` (≤120), `idempotency`, `audit`, `max_output_bytes` (≤256 KiB), `max_output_items` (≤500),
`owning_domain`, `owning_operation` (documentation pointer, never imported).

Cross-field rules:
- `access` matches the capability's access, and `owning_domain` matches the capability's domain.
- `allowed_roles` ⊆ the capability's canonical grant. A tool can't widen domain authority.
- Read tools: approval `none`, idempotency `not_applicable`.
- Write tools: `human_approval`, `required_key`, `immutable_event`, risk ≥ medium, no system principals.
- Financial, personnel and safety capabilities: risk ≥ high.
- Shell, python, sql, http, filesystem, repository and deploy domains are forbidden.

`ToolRegistry.resolve_untrusted(name, version)` returns a spec only for an exact registered `(str, int)` pair.
Otherwise it returns `None`, with no normalization or fuzzy matching.

## 3. Capability catalog (`vocabulary.py`)

| Capability | Access | Consequence | Granted roles | Mirrors |
|---|---|---|---|---|
| `engineering.work_orders.read` | read | operational | gm, engineer, chief_engineer, housekeeping_supervisor | `MODULE_ROLE_ACCESS['engineering']` |
| `engineering.work_orders.assign` | write | operational | chief_engineer, gm | `POST /work-orders/{id}/assign` |
| `housekeeping.rooms.read` | read | operational | gm, housekeeping_supervisor, housekeeper, front_desk | `MODULE_ROLE_ACCESS['housekeeping']` |
| `housekeeping.room_assignments.write` | write | personnel | housekeeping_supervisor, gm | `services/ai/authorization.ASSIGNMENT_ROLES` |
| `billing.credit_adjustment` | write | financial | gm | legacy `billing_credit` |

Drift tests compare the work-order and room-assignment grants against the live route and AI authorization
constants. There is no numeric role rank anywhere in the harness.

## 4. Identity (`identity.py`)

`TrustedExecutionContext`: `principal_type` (human | system), `hotel_id`, `agent_id`, `agent_version`, `trigger`,
`source` (verified_request_jwt | server_reload | system_registry), `authority_verified_at`, `user_id`/`role` (human
only, canonical role required), `system_principal_id` (system only), `run_id`, `correlation_id`, `policy_version`.

Factories: `context_from_verified_user(CurrentUser, ...)`, `reload_identity(IdentityAuthority, ...)` and
`context_for_system(principal_id, ...)`. `is_current(now)` is true only within 5 minutes. Error codes include
`untrusted_construction`, `unauthenticated`, `unknown_role`, `missing_hotel`, `principal_not_found`,
`principal_inactive`, `tenant_mismatch`, `stale_identity`, `unknown_system_principal` and `invalid_trigger`.

## 5. Authorization decision (`policy.py`)

`evaluate(ctx, request, *, agents, controls, tenant, now, resource=None, approval=None, grants=())` →
`AuthorizationDecision(outcome, reason, policy_version, agent_key, tool_key)`.

Outcomes: `allow`, `deny`, `requires_approval`. `authorizes_execution` is `False` in H0 for every outcome.

Evaluation order (first failure wins): context → request shape → identity freshness → controls freshness → platform
enabled → cost stop → request hotel → identity claims in arguments → tenant snapshot → hotel pause → `ai_agents`
flag → agent match/registered/enabled/paused/trigger/flags → tool resolved/allowlisted/paused/flags/capability →
actor authority → resource scope → (read) `allow` | (write) autonomy grant → approval → `write_execution_unavailable`.

Reason codes: `allowed`, `missing_context`, `malformed_request`, `stale_identity`, `controls_unavailable`,
`platform_execution_disabled`, `cost_emergency_stop`, `tenant_mismatch`, `untrusted_identity_claim`, `hotel_paused`,
`tenant_capability_disabled`, `agent_mismatch`, `agent_not_registered`, `agent_disabled`, `agent_paused`,
`trigger_not_supported`, `tool_not_registered`, `tool_not_allowed_for_agent`, `tool_paused`, `tool_feature_disabled`,
`capability_not_declared`, `actor_not_authorized`, `human_authority_required`, `resource_out_of_scope`,
`autonomy_insufficient`, `approval_required`, `approval_invalid`, `write_execution_unavailable`.

`ApprovalEvidence` binds approval id, policy, hotel, agent and version, tool and version, `action_digest` (SHA-256 of
tool, resource and canonical arguments), initiator, approver and role, and the approval window.

## 6. Autonomy (`autonomy.py`)

| Level | Meaning | H0 |
|---|---|---|
| 1 `OBSERVE` | read/recommend only | ceiling (`H0_EXECUTABLE_AUTONOMY`) |
| 2 `HUMAN_APPROVED` | writes with valid human approval | policy contract only, never executes |
| 3 `BOUNDED` | expressly granted low-risk writes without per-action approval | not evaluable; no v1 write qualifies |
| 4 `COORDINATED` | longer-running coordination | not evaluable |

`AutonomyGrant` names exactly one hotel, agent and tool version (no wildcards). Levels ≥3 are allowed only with
`max_risk=low`. `effective_autonomy = min(agent ceiling, matching unexpired grant (default OBSERVE), platform
ceiling)`, capped at `HUMAN_APPROVED` whenever `requires_human_authority(tool)` holds. Approval policies:
`human_approval.single_authorized_manager.v1` and `human_approval.independent_manager.v1`.

## 7. Cost, usage and budget (`metering.py`)

- **Provider expense:** `ProviderUsage` (provider, requested and reported model, request id, state
  reported|unreported, input/output/cached/cache-write tokens, other units) and `PriceSchedule` / `PriceBook`
  (exact `(provider, model)` lookup). `compute_provider_cost` returns a `ProviderCostRecord` that is `costed` or
  `unreconciled` (`usage_unreported`, `price_unknown`, `unpriced_usage_category`).
- **Customer billing:** `BillingPeriod` and `CustomerPricingPolicy` (version, usd_per_credit, markup, minimum,
  included credits, `overage_opt_in=False`, authorized overage limit, required positive hard cap).
  `quote_customer_credits` returns `pending_reconciliation` with no credits when the cost is unreconciled.
  `may_bill_overage` is false unless the hotel opted in and the request stays within the limit and cap.
- **Budgets:** `ExecutionBudget` (step ≤ run ≤ agent period ≤ hotel period, all positive). `BudgetReservation`
  (id, hotel, agent, run, step, state reserved|settled|released, reserved/settled/released, balanced invariants).
  `settle_reservation` refuses overruns. `BudgetLedgerPort` is the protocol H3/H4 implements atomically in SQL.

No allowance values for future pricing tiers are chosen anywhere.

## 8. Versioning and compatibility

- Manifest schema strings are versioned (`patelrep.agent-manifest/v1`). A new schema version is added to
  `SUPPORTED_MANIFEST_SCHEMAS` alongside a migration path, never by loosening v1.
- Tools and agents are versioned by integer. Agents pin exact tool versions. A changed tool contract is a new tool
  version, and the old version stays registered until no agent pins it.
- `POLICY_VERSION` (`agent-harness-policy/h0.1`) is stamped on every decision and context, so audit records say which
  rules produced them.
- Contracts only get stricter within a schema version. Relaxing a rule is a new schema version reviewed as
  control-plane work.
