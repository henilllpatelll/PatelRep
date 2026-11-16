# ADR-0004: H5 Operations specialists (Engineering + Housekeeping) and the H3 → H2 proposal handoff

Status: accepted for implementation (H5). Default-off everywhere; production refused in code; no worker deployed.
Base: `main` @ `ff88aff2` (H4 merged, migrations through 250).

## 1. Context

H0–H4 built contracts, durable runs, a Tool Gateway with human approvals, a proposal-only orchestrator with a
provider-spend ledger, and customer billing. Nothing turned a validated plan into a reviewed, human-approved action:
H3 records plans that nothing reads, H2 admits only `engineering.dispatch_assistant` v1, and there is no Housekeeping
write in the gateway. H5 adds the first two Operations specialists at autonomy levels 1 (observe) and 2 (human
approved) and the missing handoff.

## 2. Domain audit (H5.1)

### 2.1 Engineering

| Concern | Authoritative implementation | Agent exposure decided |
|---|---|---|
| Work-order lifecycle | `routers/work_orders.py`; statuses `open, escalated, in_progress, on_hold` are assignable, everything else is closed (`work_order_assign_apply`, migration 242) | status is read-only context |
| Priority / overdue | `work_orders.priority`, `due_at`; overdue = `due_at < now()` while assignable | computed **server-side** into verified context; never inferred by the model |
| Technician eligibility | `work_order_assign_apply`: assignee must hold an active `engineer` role in the hotel | new read tool `engineering.work_orders.assignment_candidates` v1 lists exactly that set (ids + open workload, no names) |
| Assignment / reassignment | `POST /work-orders/{id}/assign` (`chief_engineer`, `gm`) → `work_order_assign_apply` (row lock, expected-owner check, audit) | reuse `engineering.work_orders.assign` v2 unchanged (already human approved, atomic, idempotent) |
| Holds / blockers | `on_hold` is assignable; parts/vendor holds live in free text | not exposed (free text) |
| Assets / PM | `assets`, `pm_schedules` (OSS phase 1) | deferred: no verified need for H5 recommendations; adds personal-data-free but large surfaces |
| Audit / notifications | `operational_audit_events` written inside 242; the human route pushes the assignee after commit | H2 path writes the audit row (actor = approving human, `source = automation`); H5 adds the post-commit push for gateway writes (best effort, newly committed only) |

### 2.2 Housekeeping

| Concern | Authoritative implementation | Agent exposure decided |
|---|---|---|
| Operational status | `room_status.status` (`DIRTY, PICKUP, OCCUPIED` assignable; in-progress / clean / inspected / out of service are not) | read-only |
| Clean type / readiness | `room_status.clean_type`, `fo_status`; readiness decided by humans (clean → inspect) | read-only; **no tool can mark a room clean, inspected, vacant or sellable** |
| DND / do-not-service / return later | `dnd_flag`, `do_not_service`, `dnd_retry_at` | surfaced as verified blockers; the write refuses them (bulk publication never carries a supervisor acknowledgement) |
| Occupancy discrepancies | `room_occupancy_discrepancies.status = 'open'` | blocker (boolean only) |
| Assignments + eligibility | dated `room_assignments` else the `room_status.assigned_to` mirror; eligible receiver = active `housekeeper` / `housekeeping_supervisor` role. Attendance/roster is a client-side concept today | new reads `housekeeping.rooms.readiness_lookup` v1 and `housekeeping.room_assignments.candidates` v1 |
| Atomic publication | `publish_assignment_batch` (migrations 221/222): advisory lock per operation, `room_status` then `room_assignments` row locks, expected-owner check, blockers, stage check, audit rows, idempotency record, `is_ai_suggested` provenance | **reused for ONE room** by the new write `housekeeping.room_assignments.assign` v1 |
| Inspection requirement | inspection sampling decided at completion (services/inspection_rules.py) | not exposed as an AI decision; status only |
| Notifications | the route pushes each gaining housekeeper after a newly committed publication | same push after a newly committed gateway publication |

### 2.3 Chosen Housekeeping write

`housekeeping.room_assignments.assign` v1 (HIGH risk: personnel consequence) executes inside
`agent_tool_execute_room_assignment`, which runs the H2 fenced/approval/idempotency envelope and calls the canonical
`publish_assignment_batch(tenant, approver, operation_id = invocation id, hotel-today, [one change])` in a sub-block:

* `assign` when `expected_assigned_to` is null, else `reassign`; `remove` is not exposed.
* `is_ai_suggested = true` (the existing provenance flag for an untouched optimizer/AI recommendation).
* The date is part of the canonical arguments (and therefore of the approval digest); `publish_assignment_batch`
  refuses anything but the hotel's current day.
* A `P0409/P0422/P0403` refusal rolls back the sub-block and is recorded as a terminal `failed` ledger row with a
  stable code; the approval is consumed (a changed world needs a fresh review). Any other error rolls back everything.
* The approving human is the actor (their CURRENT role re-read under lock); the initiator can never approve.

`publish_assignment_batch` is reused unmodified (redefining it would also make the file destructive by the staging
guard because its body contains a removal statement). No second assignment writer exists.

## 3. Decisions

1. **Engineering specialist = `engineering.dispatch_assistant` v2** (a deliberate new version of the same agent
   identity, not a new id): pins `engineering.work_orders.lookup` v2, `engineering.work_orders.assignment_candidates`
   v1 and `engineering.work_orders.assign` v2. It drops v1's `housekeeping.rooms.status_lookup` pin (least privilege:
   no Housekeeping data in the Engineering specialist). v1 stays registered and executable, byte-identical.
2. **Housekeeping specialist = `housekeeping.room_readiness_assistant` v1**: pins `housekeeping.rooms.status_lookup`
   v1, `housekeeping.rooms.readiness_lookup` v1, `housekeeping.room_assignments.candidates` v1 and
   `housekeeping.room_assignments.assign` v1. It holds no Engineering capability.
3. **Manifest schema v1 is kept.** Nothing in H5 needs fields v1 lacks.
4. **Verified context, not model memory.** Before planning, the worker gathers a bounded snapshot through the
   gateway's own `prepare` → H0 `decide` → bound read → output enforcement sequence, under the initiator's freshly
   reloaded identity and the hotel's grants. The snapshot is server data; the model receives it as JSON marked
   untrusted. The deterministic validator checks every proposal against the same snapshot (assignee must be a
   verified candidate, expected owner must equal the verified owner, date must equal hotel-today, blockers refuse).
5. **Plan schema `patelrep.plan/v2`** for H5 intents: adds closed `findings` codes and an extended closed reason
   vocabulary. `patelrep.plan/v1` and the H3 intent are unchanged.
6. **Handoff = new immutable table + one RPC.** `agent_proposal_handoffs` binds planning run, plan digest, step,
   exact tool version, agent version, verified initiator, resource, canonical arguments, action digest, idempotency
   key, expiry and the resulting gateway run/invocation. `agent_proposal_handoff_admit` re-checks the recorded plan
   and calls `agent_tool_run_admit` in the same transaction. One handoff per proposal; replays return it.
7. **Only the initiator may submit**, only for a `proposed` plan, only within the proposal TTL (15 minutes), only after
   the Python gateway `prepare`/`decide` returns `requires_approval` and a freshness check passes. The model never
   reaches any of it.
8. **Worker routing by exact agent allowlist**: `GATEWAY_AGENT_KEYS` (dispatch v1, dispatch v2, room readiness v1).
   Write steps dispatch by the binding's single reviewed RPC name, via an exact RPC allowlist.
9. **Minimal UX = backend preview API** (`/v1/agent-specialists/...`), role-restricted, returning `404` when the
   process gates are off. No web/mobile UI in H5 (active-surface rule; H6 owns the control center).
10. **Destructive-reviewed constraint migration 251** (allowlist CHECK swaps only) + additive 252/253. Staging needs
    the reviewed preview (separate registry PR + human approval), exactly as H3.
11. **Orchestrator manifest v1 extended in place** with `room` resource scope and `housekeeping.rooms.read`
    capability: it pins no tools, so this widens no authority; the per-intent database function is the gate.

## 4. Rejected alternatives

* *New agent id for Engineering*: duplicates authority lineage; versioning the existing identity keeps grants,
  audit and pause controls attributable to one agent.
* *Auto-submitting validated proposals*: violates "proposal_only stays a proposal".
* *A Python assignment writer*: would bypass the row locks and idempotency of `publish_assignment_batch`.
* *Hotel-wide queue intents* (`maintenance_priority_review` over all open orders): needs hotel-scoped resource
  binding through H3 admission and plan validation; deferred (§5). H5 surfaces queue attention as verified,
  non-AI facts in the preview API instead.

## 5. Deferred

Hotel-wide intents, asset/PM context, web/mobile UI, approval inbox (H6), worker deployment, staging end-to-end with a
worker, production activation, paid model calls, autonomy ≥ 3.
