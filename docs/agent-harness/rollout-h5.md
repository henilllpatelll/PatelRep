# H5 rollout and activation checklist

Nothing in this list is done by the H5 PR. Every item is a separate human decision.

## Default state after merge (verified by tests)

| Layer | Default | Where |
|---|---|---|
| `AGENT_GATEWAY_EXECUTION_ENABLED` | off | `services/agent_gateway/authorization.py` |
| `AGENT_ORCHESTRATOR_EXECUTION_ENABLED` / `_PAID_CALLS_ENABLED` | off | `services/agent_orchestrator/config.py` |
| Production | refused in code (gateway, orchestrator, handoff, routes) | `process_allows_*` |
| `agent_execution_enablement.enabled` / `agent_model_enablement.enabled` | false | migrations 241 / 244 |
| Customer billing mode | `disabled` | migration 248 |
| `ai_agents` tenant flag | off | `core/feature_registry.py` |
| Grants for dispatch v2 / room readiness v1 | none | `agent_tool_grants` |
| `/v1/agent-specialists/*` | 404 | `routers/agent_specialists.py` |
| Worker | not deployed | — |
| Autonomy 3–4 | unrepresentable | H0 + `agent_tool_grants.max_level IN (1, 2)` |

## Staging activation (needs explicit approval, in order)

1. Reviewed staging preview for migrations 251–253 applied (251 is destructive-reviewed; see
   `docs/staging-previews/h5-operations-specialists-251-253.md`).
2. Staging backup verified and restorable (`reference_staging_backup_restore`).
3. A synthetic staging hotel: `ai_agents` on; budget policies (H3) for `harness.orchestrator`; GM grants:
   dispatch v2 → lookup v2 (1), candidates v1 (1), assign v2 (2); room readiness v1 → status v1 (1),
   readiness v1 (1), candidates v1 (1), assign v1 (2).
4. Worker service deployed to staging only (separate authorization), with fake or test-mode provider keys.
5. `gateway-switch --on`, `agent_model_enablement` on, both process variables on, staging only.
6. Walk the golden paths with two humans per department (initiator + approver); verify audit rows, pushes and the
   refusal matrix in [handoff.md](handoff.md).
7. Turn everything off again; record evidence.

## Production activation (out of scope; requires all of)

A code change removing the production refusal (reviewed), a deployed and monitored worker, paid-provider approval and
budgets, a per-hotel opt-in by a GM, the H6 approval inbox and audit viewer, alerting on `agent_tool_events` /
`agent_planning_events`, and a rollback rehearsal.
