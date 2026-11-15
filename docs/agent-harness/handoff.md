# H5 proposal handoff: H3 plan → H2 Tool Gateway

The ONLY path from a model-generated plan to an operational change. Code: `services/agent_handoff/`; database:
migration 252 (`agent_proposal_handoffs`, `agent_proposal_handoff_admit`, `agent_planning_events`).

```
verified user ──POST /recommendations──► agent_planning_run_admit (intent roles, resource ownership, switches)
                                          │
H1 worker (model_planning) ── verified context via gateway prepare/decide/read (initiator identity, grants)
                           ── BudgetedCaller → model (fake transport in tests) → validate_plan_v2 (facts)
                           ── agent_planning_record_plan (immutable, digest)          [plan_proposed event]
                                          │   nothing runs by itself
initiator ──POST .../proposals/1/submit {plan_digest}──► handoff.submit_proposal
   1 process gates   2 initiator   3 outcome=proposed, stored digest == recomputed == reviewed   4 intent's write
   5 FRESH facts re-gathered now + check_proposal_against_facts (else proposal_stale)
   6 gateway prepare/decide → requires_approval
   7 agent_proposal_handoff_admit (ONE tx, planning row FOR UPDATE): re-checks 2-4, TTL, exact step/tool/agent/
     arguments/resource, server-derived idempotency key → agent_tool_run_admit (allowlist, ownership, controls,
     entitlement, CURRENT authority, grant) → handoff row                              [handoff_submitted event]
                                          │
H1 worker (tool_invocation) ── approval requested → run awaiting_approval (no lease, no message)
different manager ──POST /handoffs/{id}/approve──► agent_tool_approval_decide (current role, not the initiator)
H1 worker ── approved write RPC (one tx: fencing, controls, grants, approval FOR UPDATE, domain op, ledger, consume)
```

## Bindings

A handoff row is immutable and binds: planning run · plan digest · step number · intent/version · specialist agent
version · exact tool version · resource type/id · canonical arguments · action digest · verified submitter · gateway
run · invocation · `handoff:<run>:<step>` idempotency key · `proposal_expires_at` (recorded_at + 15 min).
`UNIQUE (planning_run_id, step_number)`, `UNIQUE (invocation_id)`, `UNIQUE (tenant_id, idempotency_key)`.

## Guarantees

| Property | Mechanism |
|---|---|
| A validated plan is never executed automatically | no code path submits; `proposal_only` is checked, never reinterpreted; tests assert zero gateway runs before submission |
| Only the verified initiator can submit | Python check + database check under the planning-row lock |
| Changed proposal fails | stored digest recomputed; reviewed digest must match; arguments / tool / agent compared to the stored step in SQL |
| Stale world fails | fresh verified facts before admission (`proposal_stale`); the write RPC re-checks under row locks |
| Expired proposal fails | `proposal_expired` after 15 minutes; approvals expire after 1 hour |
| Duplicate submission | replays the same handoff (`created: false`, `handoff_replayed` event); one gateway run |
| Approval is independent | initiator refused (`self_approval_forbidden`) in Python, the decide RPC, a table CHECK and the write RPC |
| Approver demotion / revocation | approver's current role re-read at decision AND at execution; revoked/withdrawn approvals end the run |
| Tenant identity cannot be overridden | every RPC is keyed by the verified user's hotel; cross-hotel ids read as `not_found` |
| Commit then crash | ledger row replays (`execution_replayed`); the publication's own operation id replays too |

## Lifecycle states (preview `proposals[].status`)

`proposed` → `submitted` → `awaiting_approval` → `approved` → `committed` | `failed`; side exits `rejected`,
`expired`, `withdrawn`. `actions.submit / approve / reject / withdraw` are true only when the backend would accept that
action now for this viewer.

## HTTP (hidden unless both process gates are on)

| Route | Who |
|---|---|
| `POST /v1/agent-specialists/recommendations` | intent initiator roles (DB re-checks) |
| `GET /v1/agent-specialists/recommendations/{run_id}` | intent initiator roles in the same hotel |
| `POST .../recommendations/{run_id}/dismiss` | initiator |
| `POST .../recommendations/{run_id}/proposals/{n}/submit` | initiator |
| `GET /v1/agent-specialists/handoffs/{id}` | initiator or a role that can approve it |
| `POST .../handoffs/{id}/approve` · `/reject` | a different, currently authorized manager |
| `POST .../handoffs/{id}/withdraw` | initiator, before execution |
