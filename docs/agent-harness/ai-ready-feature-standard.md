# AI-Ready Operations Feature Standard

For every future PatelRep Operations feature that might become agent-accessible. **A new screen does not
automatically need an AI tool.** Add one only when an agent doing the work saves a housekeeper or engineer real time.

## Core rule: one operation, two callers

Agents and human-facing UI call the **same** authorized business operation. A tool is a thin, versioned contract
around that operation, never a second implementation. If the operation lives inline in a router today, extract it
into a function the router and the tool both call (and put it under `services/` only when 2+ domains share it,
per the A1 convention).

## Required specification (fill in for each agent-accessible capability)

| # | Item | What to specify |
|---|---|---|
| 1 | Business capability id | Dotted id in `services/agent_harness/vocabulary.py`, e.g. `engineering.work_orders.assign` |
| 2 | Stable backend operation | The function or route both the UI and the tool call |
| 3 | Versioned tool contract | `ToolSpec` (id, integer version). A change in behavior means a new version |
| 4 | Input/output validation | Closed JSON schemas (`additionalProperties: false`), with no identity fields (hotel, user, role, approval) |
| 5 | Canonical role permissions | An explicit role set from `core/roles.py`, equal to the domain route's gate. Never a rank |
| 6 | Tenant/resource scoping | Resource type, how the server resolves ownership (`VerifiedResource`), the hotel filter |
| 7 | Read/write classification | `read` or `write`. A read never implies the write |
| 8 | Operational risk | low/medium/high/critical. Financial, personnel and safety are ≥ high |
| 9 | Human approval | Writes: human approval + approval policy id. Who may approve |
| 10 | Idempotency | Writes: caller idempotency key. What a replay returns |
| 11 | Audit/events | Writes: append-only event per attempt. Which fields are recorded, which are redacted |
| 12 | Cost | Model usage per call, if any. Which budget it draws from |
| 13 | Feature flags/entitlements | `ai_agents` plus any feature flag (registered in both registries) |
| 14 | Failure, retry, timeout | Timeout (≤120 s), retry safety, the error shown to staff |
| 15 | Tests | Security (role matrix ×6, cross-hotel, forged identity), domain golden path, regression of the UI path |

## Example A: read-only work-order lookup (NON-EXECUTABLE design example)

Implemented as `WORK_ORDER_LOOKUP_V1` in `services/agent_harness/examples.py`. Not wired to anything.

1. Capability: `engineering.work_orders.read`
2. Operation: the shared read behind `GET /work-orders/{wo_id}` (to be extracted in H2)
3. Tool: `engineering.work_orders.lookup` v1
4. Input `{work_order_id: uuid}`. Output `{id, status, priority, room_number, assigned_to, due_at}`, both closed
5. Roles: gm, chief_engineer, engineer, housekeeping_supervisor. Housekeeper and front_desk are denied
6. Scope: `work_order`. Server resolves ownership, and another hotel's work order → `resource_out_of_scope`
7. Read
8. Risk: low
9. Approval: none
10. Idempotency: not applicable
11. Audit: metadata (decision, ids, reason code). No payload
12. Cost: none (no model call inside the tool)
13. Flags: `ai_agents`
14. Timeout 5 s. Safe to retry. Max 4 KiB / 1 item
15. Tests: `test_work_order_read_follows_explicit_grants` (6 roles), cross-hotel, forged hotel claim

## Example B: human-approval-required work-order assignment (NON-EXECUTABLE design example)

Implemented as `WORK_ORDER_ASSIGN_V1`. In H0 it can never execute, even with a valid approval.

1. Capability: `engineering.work_orders.assign`
2. Operation: the shared assignment behind `POST /work-orders/{wo_id}/assign`, keeping its rules (active engineer in
   the same hotel, events, notification)
3. Tool: `engineering.work_orders.assign` v1
4. Input `{work_order_id, assignee_user_id, idempotency_key, note?}`. Output `{id, assigned_to, status}`
5. Roles: chief_engineer, gm (equal to the route's `require_role`, guarded by a drift test)
6. Scope: `work_order`, with server-resolved ownership. The assignee is validated by the operation, not the model
7. Write
8. Risk: medium
9. Approval: `human_approval.single_authorized_manager.v1`. The approver must hold chief_engineer or gm. The approval
   is bound to the action digest, so changing the assignee voids it
10. Idempotency: required key. A replay returns the original result
11. Audit: immutable event per attempt (requested, approved, executed or refused)
12. Cost: none inside the tool. The proposing model call is metered separately
13. Flags: `ai_agents`
14. Timeout 10 s. Retries only with the same idempotency key
15. Tests: `test_work_order_assignment_follows_explicit_grants`, approval binding, `write_execution_unavailable` in H0

## Out of scope for H0

No agent interfaces are built for existing Operations screens. This standard governs features from H2 onward.
