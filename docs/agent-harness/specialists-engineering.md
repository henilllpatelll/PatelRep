# Engineering specialist: `engineering.dispatch_assistant` v2 (H5)

Status: implemented, default-off. Autonomy ceiling: **2 (human approved)**. Design: [ADR-0004](adr-0004-h5-operations-specialists.md).

## Identity and manifest

| Field | Value |
|---|---|
| Agent / version | `engineering.dispatch_assistant` **v2** (a deliberate new version of the H2 agent; v1 unchanged and still executable) |
| Manifest schema | `patelrep.agent-manifest/v1` |
| Product family | Operations |
| Tool pins (exact) | `engineering.work_orders.lookup` v2 (read) · `engineering.work_orders.assignment_candidates` v1 (read) · `engineering.work_orders.assign` v2 (write, human approved) |
| Capabilities | `engineering.work_orders.read`, `engineering.work_orders.assign` |
| Resource types | `work_order` only (v1's `housekeeping.rooms.status_lookup` pin was dropped: least privilege) |
| Triggers | `user_request` only (no schedule, no event) |
| Required flags | `ai_agents` |
| Limits | ≤ 4 steps, ≤ 4 tool calls, ≤ 3,600 s runtime, ≤ 1 credit/run (contract) |
| Model purpose | `engineering_dispatch` (planning budgets: H3 `PlanningLimits`, ≤ 4 model calls per step, ≤ 2,048 output tokens) |
| Approval policy | `human_approval.independent_manager.v1` (initiator can never approve) |
| Activation | `enabled=true` in code; every runtime layer is default-off (see [rollout checklist](rollout-h5.md)) |

## Supported workflows

| Intent | Who may ask | What the specialist may do |
|---|---|---|
| `engineering.work_order_triage` v1 | chief_engineer, engineer, gm | Read verified facts for ONE work order and return closed findings (`work_order_overdue`, `work_order_unassigned`, `work_order_high_priority`, `work_order_on_hold`, `work_order_escalated`, `work_order_closed`, `work_order_due_soon`) plus an AI priority assessment. **No change may be proposed.** |
| `engineering.work_order_dispatch_recommendation` v1 | chief_engineer, gm | Everything above plus at most ONE `engineering.work_orders.assign` v2 proposal to a verified eligible engineer. |

The H3 intent `engineering.work_order_dispatch_plan` v1 (dispatch assistant v1, plan schema v1) is unchanged.

## Verified facts the specialist plans over

Gathered by the worker before any paid call, through the gateway, under the initiator's freshly reloaded identity and
the hotel's observe-level grants:

* `engineering.work_orders.lookup` v2: id, number, title (≤ 120 chars, untrusted text), status, priority, assignee,
  room number, due time.
* `engineering.work_orders.assignment_candidates` v1: up to 25 `{staff_id, position: engineer, open_work_orders}`,
  ranked by workload. Eligibility = `work_order_assign_apply`'s rule (active `engineer` role in the hotel). No names.

## Deterministic checks on every proposal

assignee ∈ verified candidates · `expected_assigned_to` = verified current assignee · not a no-op · work order still
assignable (`open | escalated | in_progress | on_hold`) · `work_order_id` = the planning resource · identity/approval
keys refused at any depth · exactly one write. Every finding must be true of the facts (overdue = `due_at` < now while
assignable; high priority = `emergency | urgent`).

## Execution

Unchanged H2 path: `agent_tool_execute_work_order_assign` → `work_order_assign_apply` (row lock, eligibility,
expected-owner check, audit row with actor = approving manager, `source = automation`,
`reason_code = agent_harness_approved`). H5 adds the engineer's push notification after a newly committed change.

## Refusals you will see

`assignee_not_verified_eligible`, `expected_owner_mismatch`, `resource_closed`, `proposal_is_noop`,
`finding_not_supported_by_facts`, `tool_not_allowed`; at submission `proposal_stale`; at execution
`resource_changed`, `resource_closed`, `assignee_not_eligible`, `approver_not_authorized`.

## Not in H5

Hotel-wide queue review, asset / PM context, vendor contact, notes, photos, autonomous assignment.
