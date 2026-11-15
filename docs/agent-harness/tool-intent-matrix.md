# H5 tool/version matrix and intent/routing matrix

The executable set is defined in three independently reviewed places that drift tests pin together:
H0 `controls.H2_EXECUTABLE_TOOLS`, `services/agent_gateway/bindings.GATEWAY_BINDINGS`, and the database allowlist
`agent__gateway_tool_spec` (latest definition: migration 253). Historical versions are never removed.

## Tool versions

| Tool | Ver | Access / risk | Roles (initiator; approver for writes) | Operation | Since | Pinned by |
|---|---|---|---|---|---|---|
| `engineering.work_orders.lookup` | 1 | write example | — | none (H0 example, **never executable**) | H0 | — |
| `engineering.work_orders.assign` | 1 | write example | — | none (H0 example, **never executable**) | H0 | — |
| `engineering.work_orders.lookup` | 2 | read / low | gm, chief_engineer, engineer, housekeeping_supervisor | `adapters.read_work_order_summary` | H2 | dispatch v1, dispatch v2 |
| `housekeeping.rooms.status_lookup` | 1 | read / low | gm, housekeeping_supervisor | `adapters.read_room_status` | H2 | dispatch v1, room readiness v1 |
| `engineering.work_orders.assign` | 2 | write / medium | chief_engineer, gm | `agent_tool_execute_work_order_assign` → `work_order_assign_apply` | H2 | dispatch v1, dispatch v2 |
| `engineering.work_orders.assignment_candidates` | 1 | read / low | chief_engineer, gm | `adapters_h5.read_assignment_candidates` | **H5** | dispatch v2 |
| `housekeeping.rooms.readiness_lookup` | 1 | read / low | gm, housekeeping_supervisor | `adapters_h5.read_room_readiness` | **H5** | room readiness v1 |
| `housekeeping.room_assignments.candidates` | 1 | read / low | gm, housekeeping_supervisor | `adapters_h5.read_housekeeping_candidates` | **H5** | room readiness v1 |
| `housekeeping.room_assignments.assign` | 1 | write / **high** | gm, housekeeping_supervisor | `agent_tool_execute_room_assignment` → `publish_assignment_batch` | **H5** | room readiness v1 |

Database allowlist rows are keyed by **(agent, agent version, tool, tool version)**: 3 (dispatch v1) + 3 (dispatch v2)
+ 4 (room readiness v1) = 10. A tool pinned by one agent is unreachable through another agent's key.

## Agents

| Agent | Ver | Ceiling | Tools | Admitted to `agent_runs` by |
|---|---|---|---|---|
| `harness.synthetic` | 1 | — | none | H1 synthetic admission (non-production) |
| `engineering.dispatch_assistant` | 1 | 2 | lookup v2, room status v1, assign v2 | `agent_tool_run_admit` |
| `harness.orchestrator` | 1 | — | **none** | `agent_planning_run_admit` |
| `engineering.dispatch_assistant` | 2 | 2 | lookup v2, candidates v1, assign v2 | `agent_tool_run_admit` (via handoff) |
| `housekeeping.room_readiness_assistant` | 1 | 2 | status v1, readiness v1, hk candidates v1, hk assign v1 | `agent_tool_run_admit` (via handoff) |

## Intents

| Intent (v1) | Plan schema | Resource | Specialist | Allowed tools | Context reads (before planning) | Write it may propose | Initiator roles | Workload |
|---|---|---|---|---|---|---|---|---|
| `engineering.work_order_dispatch_plan` | v1 | work_order | dispatch v1 | lookup v2, assign v2 | none | assign v2 (proposal only, no handoff) | chief_engineer, gm | structured_tool_proposals |
| `engineering.work_order_triage` | v2 | work_order | dispatch v2 | lookup v2 | lookup v2 | none | chief_engineer, engineer, gm | routine_reasoning |
| `engineering.work_order_dispatch_recommendation` | v2 | work_order | dispatch v2 | lookup v2, candidates v1, assign v2 | lookup v2, candidates v1 | assign v2 | chief_engineer, gm | structured_tool_proposals |
| `housekeeping.room_readiness_review` | v2 | room | room readiness v1 | status v1, readiness v1 | status v1, readiness v1 | none | gm, housekeeping_supervisor | routine_reasoning |
| `housekeeping.room_assignment_recommendation` | v2 | room | room readiness v1 | readiness v1, hk candidates v1, hk assign v1 | readiness v1, hk candidates v1 | hk assign v1 | gm, housekeeping_supervisor | structured_tool_proposals |

Mirrors: `agent__planning_intent_roles` and `agent__planning_intent_spec` (migration 252), and the
`agent_planning_runs` CHECK allowlists (migration 251).

## Planning limits (all intents)

Delegation depth 0 · ≤ 1 proposal per plan (v2) · ≤ 4 context reads · ≤ 2 planning turns · ≤ 4 model calls per step
· ≤ 2,048 output tokens · ≤ 24,000 input bytes · 30 s per call · 150 s per step · plan ≤ 16 KiB draft / 8 KiB stored ·
findings ≤ 6, reason codes ≤ 4.

## Routing rules

The request names an exact (intent, version) and a resource id; the server derives the specialist, the tools and the
roles. A plan naming any other agent (`agent_not_candidate`), an unregistered agent, a tool outside the intent or the
agent's pins (`tool_not_allowed`), a wrong version, or a write in a read-only intent
(`proposal_not_allowed_for_intent`) is rejected deterministically. There is no fallback agent and no "latest" version.
