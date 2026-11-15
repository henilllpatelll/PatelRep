# Housekeeping specialist: `housekeeping.room_readiness_assistant` v1 (H5)

Status: implemented, default-off. Autonomy ceiling: **2 (human approved)**. Design: [ADR-0004](adr-0004-h5-operations-specialists.md).

## Identity and manifest

| Field | Value |
|---|---|
| Agent / version | `housekeeping.room_readiness_assistant` v1 |
| Manifest schema | `patelrep.agent-manifest/v1` |
| Product family | Operations |
| Tool pins (exact) | `housekeeping.rooms.status_lookup` v1 · `housekeeping.rooms.readiness_lookup` v1 · `housekeeping.room_assignments.candidates` v1 (reads) · `housekeeping.room_assignments.assign` v1 (write, HIGH risk, human approved) |
| Capabilities | `housekeeping.rooms.read`, `housekeeping.room_assignments.read` (new, H5), `housekeeping.room_assignments.write` |
| Resource types | `room` only. No Engineering capability, tool or resource. |
| Triggers | `user_request` only |
| Required flags | `ai_agents` |
| Limits | ≤ 4 steps, ≤ 4 tool calls, ≤ 3,600 s runtime, ≤ 1 credit/run (contract) |
| Model purpose | `housekeeping_room_readiness` |
| Approval policy | `human_approval.independent_manager.v1` |

## Supported workflows

| Intent | Who may ask | What the specialist may do |
|---|---|---|
| `housekeeping.room_readiness_review` v1 | housekeeping_supervisor, gm | Explain ONE room's verified blockers and cleaning priority with closed findings (`room_unassigned`, `room_dnd`, `room_service_declined`, `room_return_later`, `room_occupancy_discrepancy`, `room_not_assignable`, `cleaning_started`, `room_occupied_dirty`, `room_vacant_dirty`, `room_inactive`). Read-only. |
| `housekeeping.room_assignment_recommendation` v1 | housekeeping_supervisor, gm | Everything above plus at most ONE proposal to assign / reassign that room **for the hotel's current day** to a verified eligible housekeeper. |

**The specialist can never mark a room clean, inspected, vacant, ready or sellable.** No tool takes a status argument;
the write never updates `room_status.status`; findings describe verified state, they do not set it.

## Verified facts

* `housekeeping.rooms.readiness_lookup` v1: stage, front-office status, clean type, hotel date, current owner (dated
  `room_assignments` row for today, else the status mirror) and blockers: `dnd`, `service_declined`, `return_later`,
  `occupancy_discrepancy`, `room_not_assignable`, `cleaning_started`, `room_inactive` — the same rules
  `publish_assignment_batch` applies.
* `housekeeping.room_assignments.candidates` v1: up to 40 `{staff_id, position, rooms_assigned_today}` (active
  `housekeeper` / `housekeeping_supervisor` roles, the publication's eligibility rule). No names.
* `housekeeping.rooms.status_lookup` v1 (review intent only).

Never returned: guest names, stay details, room notes, photos, staff names or contact details. Attendance/roster
eligibility is a client-side concept today; the server rule is the canonical role rule (documented gap, ADR-0004 §2.2).

## The approved write

`housekeeping.room_assignments.assign` v1, arguments `{room_id, assignee_user_id, expected_assigned_to,
assignment_date}`. Executes in `agent_tool_execute_room_assignment` (migration 253): the H2 approval/idempotency
envelope, the receiver's role row held `FOR SHARE`, then the canonical `publish_assignment_batch` for one room with
`operation_id` = invocation id, actor = the approving supervisor/GM, `is_ai_suggested = true` (existing provenance).
Its audit row, room locks, stage check, blockers, expected-owner check and hotel-day rule are the human screen's.
The gaining housekeeper gets the same push as from the screen, after commit, never on replay.

| Execution-time refusal (terminal; approval consumed) | Cause |
|---|---|
| `room_blocked` | DND / do-not-service / return-later / open discrepancy appeared |
| `room_not_assignable` | cleaning started, room cleaned/inspected/out of order |
| `resource_changed` | someone else assigned the room |
| `assignee_not_eligible` | the housekeeper lost the role |
| `date_not_hotel_today` | the hotel's day rolled over |
| `approver_not_authorized` | the approver lost authority |
| `proposal_is_noop` | assignee equals the expected owner |

## Not in H5

Removal of an assignment, multi-room plans, smart-balance via the agent, inspection decisions, roster-aware
eligibility, any PMS write.
