# Agent Harness H2: Tool Gateway

The Tool Gateway is the **only** path through which an agent can read or change PatelRep business data. A future
model-generated plan (H3+) never holds a database client, a service-role key, a router, an integration client, a
Python callable, a shell, a URL or a file path. It can only *name* an exact `(tool_id, version)`, and this layer binds
that name to a reviewed server operation and then authorizes, executes and audits it.

Legend: ✅ implemented and tested · 🧪 implemented, tested only in isolated databases · ⏳ deferred

## 1. Architecture

```
verified CurrentUser ─► admission.admit_tool_run ─► agent_tool_run_admit (one tx: run + step + pgmq msg + invocation)
                                                            │
                         H1 worker claims (fenced lease) ◄──┘
                                   │
                   steps.execute_tool_step ── step context (fenced RPC) ──► replay committed outcome, or:
                                   │ identity reload · controls · re-validate args · re-resolve resource · digest
                                   │ H0 policy.evaluate (fresh inputs; approver role re-read)
              ┌────────────────────┼─────────────────────────────┐
         read │             write, no approval             write, approved
   adapter (tenant-filtered)   agent_tool_request_approval     agent_tool_execute_work_order_assign
   → output enforcement        (approval row + run →           (ONE tx: fencing, controls, initiator AND approver
   → ledger (fenced)            awaiting_approval, no lease,     authority, grant, approval consume, idempotency,
                                no queue message)                work_order_assign_apply + audit row, ledger, events)
```

| Module (`apps/api/services/agent_gateway/`) | Role |
|---|---|
| `schema.py` | strict JSON-schema subset, canonical form, nested identity-claim refusal, size/depth bounds |
| `catalog.py` | reviewed H2 `ToolSpec`s and the `engineering.dispatch_assistant` v1 `AgentSpec` (frozen H0 registries) |
| `bindings.py` | exact `(tool_id, version)` → trusted operation; frozen; no dynamic import, no fallback |
| `adapters.py` | tenant-filtered resource resolution; minimal sanitized reads |
| `output.py` | redaction → output schema → item/byte limits; output is data, never instructions |
| `authorization.py` | layered execution boundary; translates a fresh DB snapshot into H0 policy inputs |
| `gateway.py` | `prepare` (validate, resolve, digest) and `decide` (H0 `policy.evaluate`) |
| `admission.py` / `approvals.py` / `grants.py` | verified-user interfaces |
| `steps.py` | worker step executor |
| `store.py` | typed wrapper over the `agent_tool_*` RPCs |

Migrations: **241** (schema + reviewed H1 constraint changes), **242** (`work_order_assign_apply`, shared with the
human route), **243** (gateway RPCs + `agent_run_claim` redefinition).

## 2. Exact binding registry

* A binding holds direct references to functions in this package: never a module path, import string, `eval`-able
  text, URL, SQL or shell command. Write tools bind **no Python handler** — only the name of their one atomic RPC.
* Keyed by exact `(tool_id, version)`; `resolve_untrusted` accepts only an exact `str` + `int` (bools, strings,
  wildcards, case variants, padding all resolve to nothing). No fuzzy match, no "latest", no fallback tool.
* Frozen at import; no plugin discovery and no MCP servers. A binding is refused unless its spec is the one in the
  frozen gateway `ToolRegistry` **and** its key is in H0's `H2_EXECUTABLE_TOOLS`.
* Three independently reviewed places define the executable set and are pinned together by drift tests: H0
  `controls.H2_EXECUTABLE_TOOLS`, `bindings.GATEWAY_BINDINGS`, and the database allowlist `agent__gateway_tool_spec`.

| Tool | Version | Access / risk | Roles (initiator; approver for writes) | Operation |
|---|---|---|---|---|
| `engineering.work_orders.lookup` | 2 | read / low | gm, chief_engineer, engineer, housekeeping_supervisor | `adapters.read_work_order_summary` |
| `housekeeping.rooms.status_lookup` | 1 | read / low | gm, housekeeping_supervisor | `adapters.read_room_status` |
| `engineering.work_orders.assign` | 2 | write / medium | chief_engineer, gm (= `POST /work-orders/{id}/assign`) | `agent_tool_execute_work_order_assign` → `work_order_assign_apply` |

v1 of the two engineering tools is H0's non-executable example contract and stays non-executable. No tool names a
system principal: read-only does not mean available to automation.

## 3. Authorization sequence (every invocation, every attempt)

1. Exact binding + agent manifest pin. 2. Strict argument validation and canonicalisation. 3. Trusted identity:
request JWT at admission (`context_from_verified_user`), authoritative membership reload per step
(`revalidate_principal` with the tool's role set). 4. Tenant: hotel from the trusted context only; resource resolved
server-side with `.eq("tenant_id", hotel)`. 5. Feature access: `ai_agents` entitlement, agent enabled, per-property
grant for this agent version × tool version. 6. Runtime controls: platform/hotel/agent pause, cost emergency stop,
tool pause, platform execution switch, run cancellation, deadline, fencing token. 7. Autonomy: effective level from the
grant (1 observe for reads, 2 human-approved for writes; 3–4 unrepresentable). 8. Writes: a server-recorded approval
bound to the exact digest, initiator, agent and tool version, unexpired, unconsumed, approver's **current** role.
9. H0 `policy.evaluate`; act only on `allow` **and** `authorizes_execution`. 10. Writes repeat steps 3–8 inside the
database transaction that performs the side effect.

`requires_approval` is never permission. A cached decision is never reused: every attempt re-reads identity,
controls, entitlement, grants and approval.

## 4. Input and output security

* Input: closed objects at every depth; exact types (`True` is not an integer); NFC strings without control
  characters; lower-cased UUIDs; patterns/enums/lengths; ≤ 4 KiB encoded, depth ≤ 4; identity/authority keys
  (`hotel_id`, `role`, `approved`, `user_id`, `approval_id`, …) refused at **any** depth. Unsupported schema keywords
  are a definition-time error.
* Output: secret-shaped substrings redacted first (JWTs, provider/Stripe keys, credentialed URLs, bearer tokens,
  private keys); then the exact output schema (unknown fields refused); then `max_output_items` and
  `max_output_bytes`. Reads select explicit minimal columns (no guest names, notes, descriptions, photos, comments).
  Results are returned as `{"kind": "tool_result", "trusted_instructions": false, ...}`.
* Timeouts: reads run under `timeout_seconds` and are safely retryable. A write RPC that times out is **not** treated
  as "nothing happened": the retry reaches the ledger, which replays a committed outcome.

## 5. Resource ownership

`adapters.resolve_*` query by id **and** trusted hotel; zero or several rows fail closed. The database admission RPC
and the write RPC re-check ownership independently. Cross-tenant ids yield `resource_out_of_scope` / `not_found`.

## 6. Approval state machine

`requested → approved | rejected | expired | revoked`, `approved → expired | revoked`, plus single consumption
(`consumed_at`, `consumed_by_execution_id`). Terminal states and binding columns are immutable (trigger); approvals
cannot be inserted already decided. Policy `human_approval.independent_manager.v1`: the initiator can never approve
their own request (checked in the decision RPC, a table CHECK, H0 policy and the execution RPC).

Run states add `awaiting_approval` (`running → awaiting_approval`, `awaiting_approval → queued | cancelled | failed`).
While waiting the run holds no lease, no queue message and has not consumed an attempt; no worker thread or
transaction is held open. Approve flips it to `queued` with exactly one dispatch under a row lock; reject, revoke,
expiry (sweep `agent_tool_approvals_expire`, run by worker slot 0 and the `approvals-expire` command), deadline and
cancel end it. A stray/forged message for a waiting run is dropped by the redefined `agent_run_claim`.

## 7. Digest and single-use semantics

`action_digest` (H0) = sha256 of the canonical `{tool, version, verified resource, canonical arguments}`. The approval
row also binds tenant, initiator, agent version and tool version. Changing any of them means a different invocation
and a different approval. The invocation row is immutable; the write RPC compares the presented digest with it, and
the gateway recomputes it from re-validated arguments and the re-resolved resource each attempt.

## 8. Idempotency transaction design

The idempotency key is server-derived (`tool:<run_id>:<step>`), stable across restarts and redelivery, and unique per
`(tenant_id, idempotency_key)` (another hotel cannot collide). `agent_tool_execute_work_order_assign` runs as ONE
transaction: fenced run lock → existing ledger row? (replay; or `idempotency_conflict` on a different digest) →
controls / entitlement / initiator authority / grant → approval row `FOR UPDATE` (state, consumption, expiry,
binding, independence, approver's current authority) → `work_order_assign_apply` (row lock, rules, update, audit row)
→ ledger insert → approval consumed → tool events. Any error rolls everything back; nothing is consumed.

## 9. Write retry and crash recovery

| Failure | Result |
|---|---|
| crash after the business commit, before the step commit | lease expires; the next claim finds the ledger row and replays (audited `execution_replayed`); one audit row, one change |
| duplicate delivery / concurrent calls with the live token | serialized by the run row lock; one `succeeded`, the rest `replayed` |
| stale worker (expired lease / old token) | `lease_lost`; nothing written, approval not consumed |
| precondition changed after approval (`resource_changed`, `assignee_not_eligible`, `resource_closed`) | terminal `failed` ledger row; approval consumed; no change |
| control blocked (pause, cost stop, switch off) | worker yields without consuming an attempt |
| approver demoted / initiator deactivated | refused (`approver_not_authorized` / identity revoked); run failed |

## 10. Audit schema

`agent_tool_events` (append-only; identifiers, outcomes and reason codes, never arguments or results):
`invocation_admitted, approval_requested, approval_approved, approval_rejected, approval_revoked, approval_expired,
approval_resumed, execution_succeeded, execution_failed, execution_replayed, execution_refused, attempt_failed,
read_succeeded, policy_denied`. The business change additionally writes `operational_audit_events` in the same
transaction (`actor_id` = the approving human, `actor_role` = their current role, `source = automation`,
`reason_code = agent_harness_approved`). H1 run/step state changes stay in `agent_run_events`.

## 11. H1 integration

Reviewed changes only: `agent_runs_h1_synthetic_only` → `agent_runs_h2_agent_allowlist` (exactly the synthetic probe
and `engineering.dispatch_assistant` v1); gateway runs can be inserted only by `agent_tool_run_admit` (trigger);
`step_type` becomes an exact allowlist; one new run state. The worker dispatches the dispatch assistant's
`tool_invocation` steps only to `steps.execute_tool_step`; every other agent still hits `require_execution_supported()`.
Leases, fencing, pgmq delivery, retries, pause/cancel, recovery and append-only events are unchanged.

## 12. Local / isolated testing

```bash
node scripts/build-migration-replay-workspace.mjs --out <dir>
supabase start --workdir <dir> && supabase db reset --local --workdir <dir>
# grant service_role as the CI gate does, then:
MIGRATED_DATABASE_TEST=1 PSQL_DOCKER_CONTAINER=<db container> SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  python -m pytest tests/integration/test_agent_gateway_*.py
python -m pytest tests/smoke/test_agent_gateway_*.py tests/test_work_order_assign.py
```

The integration tests create their own hotels and purge the queue: never point them at staging or production.

## 13. Troubleshooting

| Symptom | Check |
|---|---|
| admission `gateway_disabled` | `APP_ENV` ∈ development/test/staging and `AGENT_GATEWAY_EXECUTION_ENABLED=true` |
| `platform_execution_disabled` | `python -m services.agent_execution gateway-switch --on --operator <name>` (non-production only) |
| `tenant_capability_disabled` / `tool_not_granted` / `autonomy_insufficient` | `ai_agents` flag and `agent_tool_grants` row (`grants.set_tool_grant`, current GM) |
| run stuck `awaiting_approval` | `agent_tool_approvals_list`; approve/reject via `approvals.*`; expiry sweep ends it |
| run keeps yielding | `agent_tool_controls`, `agent_runtime_controls`, worker `AGENT_GATEWAY_EXECUTION_ENABLED` |
| `approver_not_authorized` at execution | approver's current `user_roles`; approvals are re-validated, never trusted |

## 14. Production activation requirements (NOT done in H2)

Production execution is refused in code (`process_allows_execution`). Enabling it needs a separate, reviewed rollout
decision that at least: changes that code gate deliberately; deploys and authorizes a worker service; defines who may
flip `agent_execution_enablement`; adds the approval inbox UI (H6); adds operational monitoring/alerts on
`agent_tool_events`; and is verified in staging with a deployed worker.

## 15. H3 orchestrator contract

H3 proposes invocations as **untrusted** `(tool_id, version, arguments)` triples and submits them through the same
`prepare`/admission path (the model never sees a client or credential). It consumes results only as
`as_untrusted_tool_result` envelopes. Paid model calls need an atomic budget reservation before execution; the gateway
records deterministic tool execution separately (no credits are charged in H2) and honours the cost emergency stop.

## Implemented vs. deferred

| Item | Status |
|---|---|
| Exact bindings, strict schemas, output enforcement, layered boundary | ✅ |
| Two read tools (work order, room status) | ✅ 🧪 |
| Persistent approvals, independent approver, revocation, expiry sweep | ✅ 🧪 |
| Atomic approved work-order assignment, ledger, audit, replay | ✅ 🧪 (real PostgreSQL concurrency tests) |
| Human route on the same shared operation | ✅ |
| Staging verification with a deployed worker | ⏳ no authorized staging worker |
| Approval inbox / HTTP routes, AI Control Center | ⏳ H6 |
| Model orchestration, budgets, billing | ⏳ H3/H4 |
| Production activation | ⏳ separate decision |
