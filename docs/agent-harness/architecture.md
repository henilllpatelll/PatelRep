# PatelRep Agent Harness: Architecture

Status: **H0 contracts + H1 durable execution infrastructure (synthetic jobs only)**. Agent execution is disabled in
code. This document describes the target system and marks exactly which parts exist today. The implemented H1 design
is in [durable-execution.md](durable-execution.md) and supersedes §4 and §8 where they differ.

## 1. System boundaries

```
Trusted user request / domain event / schedule
        |
        v
[Admission]  verified identity (JWT or server reload) + tenant entitlement + runtime controls   <- H0 contracts, H1 wiring
        |
        v
[Durable Agent Harness]  run records, steps, retries, cancellation (Postgres + pgmq)              <- H1
        |
        v
[Central Orchestrator]  plans with a model, picks a specialist agent, never holds authority       <- H3
        |
        v
[Specialist agents]  versioned manifests from the Agent Registry                                 <- H0 contract, H3+ agents
        |
        v
[Tool Gateway]  default-deny policy -> approval -> budget reservation -> dispatch -> audit        <- H0 policy, H2 gateway
        |
        v
[Shared PatelRep business operations]  the SAME functions the UI routes call                      <- existing domain code
        |
        v
[External connector boundary]  OPERA, Stripe, Twilio, model providers, behind adapters            <- existing + H5+
```

Everything above the Tool Gateway can be wrong. A model can hallucinate a tool, an orchestrator can pick the wrong
agent, and a retrieved SOP can contain hostile instructions. The Tool Gateway's deterministic policy is what stops
any of that from becoming a side effect.

## 2. Components

| Component | Responsibility | H0 status |
|---|---|---|
| Agent Registry (`services/agent_harness/agents.py`) | Validated, versioned agent manifests. A manifest declares what an agent may *ask for* and grants nothing. Agents are disabled by default. | **Implemented** as an in-process, freezable registry. |
| Tool Registry (`tools.py`) | Versioned tool contracts: schemas, capability, risk, roles, scope, approval, idempotency, audit, limits. No callables. | **Implemented**. |
| Capability catalog (`vocabulary.py`) | Closed list of business capabilities, each with an explicit canonical-role grant mirroring the domain route. | **Implemented** (5 capabilities). |
| Trusted identity (`identity.py`) | Context minted only from a verified `CurrentUser`, a server reload, or a registered system principal. | **Implemented**. |
| Policy evaluator (`policy.py`) | Pure default-deny decision: `allow` / `deny` / `requires_approval` plus a reason code. | **Implemented**. |
| Autonomy (`autonomy.py`) | Four levels, per-(hotel, agent, tool) grants, approval-policy catalog, human-authority rules. | **Implemented** as contracts. Nothing above observe is executable. |
| Metering (`metering.py`) | Provider cost vs customer credits vs execution budgets, all in `Decimal`. | **Implemented** as contracts. No DB or Stripe. |
| Runtime controls (`controls.py`) | Hard H0 execution ceiling, pause and emergency-stop snapshot shape, tenant snapshot. | **Implemented**. Always off. |
| Durable execution (`services/agent_execution/`, migrations 238-240) | Run/step tables, pgmq queue, dedicated worker, leases/fencing, retries, cancellation, recovery. | **Implemented in H1** for synthetic jobs; worker not deployed. |
| Tool Gateway dispatch | Binds a `ToolSpec` to a shared business operation, enforces timeouts and output limits. | H2 |
| Orchestrator + model adapters | OpenAI Agents SDK planner, provider abstraction, metered calls. | H3 |

## 3. Request-to-execution flow (target, H2+)

1. A route handler gets `CurrentUser` from `get_current_user` (verified JWT). It calls
   `context_from_verified_user(...)` to mint a `TrustedExecutionContext`. Nothing from the request body enters it.
2. The model proposes `{tool_id, tool_version, arguments}`. That proposal is an untrusted `AuthorizationRequest`.
3. The server resolves any referenced resource itself and produces a `VerifiedResource`, so a model never states which
   hotel a record belongs to.
4. The server loads fresh `RuntimeControls` and `TenantAgentState` (at most 30 s old) and any recorded
   `ApprovalEvidence`.
5. `policy.evaluate(...)` decides. `requires_approval` creates an approval request; it never runs anything.
6. (H2+) Only `allow` reaches dispatch. Writes need valid approval evidence bound to the exact action digest, an
   idempotency key, a budget reservation, and an immutable audit event.

In H0, steps 1–5 exist as tested pure functions. Step 6 does not exist, and
`AuthorizationDecision.authorizes_execution` is `False` for every decision.

## 4. Future durable execution flow (H1)

A run is a Postgres row (`agent_runs`) with steps (`agent_run_steps`). A pgmq message holds only `run_id`/`step_id`,
never identity or arguments. A dedicated Railway worker dequeues a message and then, on every step:

1. Reloads identity via `reload_identity(IdentityAuthority, ...)` from `user_roles`. It never reuses a JWT captured
   at enqueue time, so a demoted or deactivated user's job loses that authority.
2. Reloads runtime controls and tenant flags (pause, cost stop, entitlement).
3. Evaluates policy, then executes the step through the Tool Gateway.

The in-process APScheduler (`core/scheduler.py`) is **not** the harness execution layer. It stays dedicated to the
existing cron jobs.

## 5. Central orchestrator

The orchestrator (H3) is a planner. It chooses which approved specialist agent handles a request and sequences
steps. It holds no authority of its own: every tool use, including one the orchestrator itself proposes, goes through
the same policy as a specialist's. Agent-to-agent communication goes through the harness (run steps), never
directly.

## 6. Domain service integration

Agents and human-facing screens must call the **same** authorized business operation (see
[ai-ready-feature-standard.md](ai-ready-feature-standard.md)). H2 extracts those operations from routers into
callable functions only when a tool needs them, per the project's A1 rule: `services/` only when shared by 2+
consumers. A tool never re-implements business rules and never touches tables directly.

## 7. External connector boundary

OPERA, Stripe, Twilio and model providers sit behind adapters that own their credentials. Credentials never enter
model context, tool arguments, traces or audit metadata. Integration payloads (an OPERA reservation, a guest SMS) are
untrusted input, the same as user prompts.

## 8. Database responsibilities (H1+)

| Concern | Where |
|---|---|
| Run/step state, idempotency keys, approvals, budget reservations | New forward-only migrations, tenant-scoped with RLS, written only by the API/worker service role. |
| Atomic budget reserve/settle | One SQL statement per transition (the pattern from migration 217's `deduct_ai_credits`). |
| Audit | Append-only event tables (the pattern from `ai_recommendation_events` in migration 073). |
| Tenant entitlement | `tenant_feature_flags` row `ai_agents` via `core/feature_flags.py` (fail-closed). |

H0 adds **no migrations**.

## 9. Why H0 intentionally does not execute agents

Execution needs things H0 doesn't have: a durable approval-to-execution path, idempotent tool dispatch, atomic budget
reservations, server-side pause controls, and per-step identity revalidation. Executing anything without them would
create authority the system can't audit or stop. H0 therefore ships the contracts those pieces must satisfy, with
tests that prove the contracts deny by default, and a hard code-level ceiling (`H0_EXECUTION_SUPPORTED = False`) that
no flag, setting or environment variable overrides.

See also: [security.md](security.md), [contracts.md](contracts.md), [roadmap.md](roadmap.md),
[adr-0001-initial-agent-stack.md](adr-0001-initial-agent-stack.md).
