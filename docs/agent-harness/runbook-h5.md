# H5 recovery and incident runbook (Operations specialists)

Applies in non-production only until a separate production decision. Every step below uses existing H1–H4 operator
tools; nothing here approves anything on a human's behalf.

## Stop everything (any incident)

1. `python -m services.agent_execution gateway-switch --off --operator <name>` (database execution switch).
2. Unset `AGENT_GATEWAY_EXECUTION_ENABLED` / `AGENT_ORCHESTRATOR_EXECUTION_ENABLED` on the worker and API: the
   `/v1/agent-specialists/*` routes start answering 404 and the worker yields every gateway and planning step.
3. Narrower: pause one hotel or agent (`python -m services.agent_execution control ...`), or one tool
   (`python -m services.agent_execution tool-pause ...`, e.g. `housekeeping.room_assignments.assign`). Paused work
   yields without consuming attempts.

## Symptoms

| Symptom | Check | Action |
|---|---|---|
| Recommendation never appears | `agent_run_get` state; `agent_planning_events_page` | `context_gathered` missing → read grants / entitlement; `plan_rejected:<code>` → see codes below |
| `plan_rejected:tool_not_granted` | `agent_tool_grants` for the specialist version | a current GM grants observe (1) on each read tool and human-approved (2) on the write |
| `proposal_stale` on submit | the room / work order changed after planning | request a new recommendation; never re-use the old plan |
| `proposal_expired` | plan older than 15 min | new recommendation |
| Run stuck `awaiting_approval` | `agent_tool_approvals_list` | approve/reject via the handoff routes; the expiry sweep ends it after 1 h |
| Execution failed `room_blocked` / `room_not_assignable` / `resource_changed` / `date_not_hotel_today` | `agent_proposal_handoff_get` | expected fail-closed behaviour; the approval is consumed; supervisor decides manually |
| `approver_not_authorized` at execution | approver's current `user_roles` | expected if demoted; ask another authorized manager after a new recommendation |
| Worker crashed mid-write | `agent_tool_executions` row for the invocation | if present the change committed: the next claim replays it (`execution_replayed`); never re-run by hand |
| Duplicate assignment suspected | `assignment_batch_operations` by `operation_id` = invocation id; `operational_audit_events` | exactly one row each is the invariant; anything else is a P1 (stop everything, preserve rows) |
| Push not received | worker logs `write_notify_failed` | best effort by design; the assignment is committed and visible in-app |

## Evidence to preserve (metadata only)

`agent_runs` / `agent_run_events`, `agent_planning_runs`, `agent_planning_events`, `agent_proposal_handoffs`,
`agent_tool_invocations` / `approvals` / `executions` / `events`, `operational_audit_events`,
`assignment_batch_operations`, `agent_model_attempts`. These tables are append-only or immutable; never edit them.

## Recovery sweeps

`python -m services.agent_execution recover` (expired leases, stuck dispatches), `approvals-expire` (approval TTL),
`spend-recover` (H3 provider attempts). All are idempotent.
