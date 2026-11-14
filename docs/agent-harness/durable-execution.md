# Agent Harness H1: Durable Execution

Status: **H1 implemented, not deployed.** H1 can durably process *synthetic, non-operational* jobs. It executes no
agent, tool or model: `H0_EXECUTION_SUPPORTED` is still `False`, the database admits only the synthetic probe agent,
and no HTTP route exposes any of this. The operational runbook is in [runbook.md](runbook.md).

## 1. Architecture

```
admission (trusted ctx) ──► agent_run_admit()  ─┐  one transaction: run + step 1 + 'admitted' event + pgmq message
                                                 ▼
                         public.agent_runs  ◄── AUTHORITATIVE state (Postgres)
                         pgmq patelrep_agent_runs_v1 ◄── durable wake-up hint (logged queue)
                                                 │
worker slot ──► agent_run_claim() ── reads ONE message, locks the run row, decides, takes a fenced lease
     │          revalidate identity (user_roles/user_profiles/tenants) ─ re-read runtime controls
     │          execute ONE closed synthetic step, heartbeating at checkpoints
     └────────► agent_step_complete() / agent_step_fail() / agent_run_acknowledge()   (all fenced)
recovery ─────► agent_runs_recover()  (bounded sweep: lost dispatch, expired cancel, deadlines)
```

| Layer | Where | Notes |
|---|---|---|
| Schema, state machine, append-only history | `supabase/migrations/238_agent_harness_durable_execution_schema.sql` | Triggers enforce transitions for every writer, service role included. |
| Worker RPCs (admit, claim, heartbeat, complete, fail, acknowledge) | `239_agent_harness_durable_execution_rpcs.sql` | Each RPC is one transaction. |
| Tenant operations, recovery, diagnostics, controls | `240_agent_harness_operations_rpcs.sql` | Tenant-scoped functions match `(id, tenant_id)` in SQL. |
| Runtime package | `apps/api/services/agent_execution/` | Separate from the pure H0 contracts in `services/agent_harness/`. |

The H0 package was not changed (one H0 test now names `services/agent_execution/` as the single sanctioned consumer).

## 2. Schema

**`agent_runs`** — one logical run. Key columns: `tenant_id`, `agent_id`/`agent_version`, `principal_type`,
`initiated_by_user_id` *or* `system_principal_id` (shape CHECK), `trigger_type`, `state`, `idempotency_key` +
`request_digest`, `correlation_id`, `policy_version`, `synthetic_spec` (≤2 KB object), `deadline_at`,
`max_attempts`/`attempt_count`, `next_attempt_at`, `cancel_requested_at/_by`, `pause_requested_at/_by`,
`last_error_class/_code` (sanitized slugs), `lease_owner`, `lease_acquired_at`, `lease_expires_at`,
`last_heartbeat_at`, `fencing_token`, `current_step_number`, `queue_msg_id`.

Constraints: `UNIQUE (tenant_id, idempotency_key)` (the idempotency scope is the hotel); `UNIQUE (id, tenant_id)`
(target of child foreign keys); `agent_runs_h1_synthetic_only` (only `harness.synthetic` v1); lease shape (owner and
expiry together, only while `running`/`cancel_requested`); terminal rows need `completed_at`; `retry_wait` needs
`next_attempt_at`; `cancel_requested` needs `cancel_requested_at`. There is no FK to `auth.users`: a deleted user simply
fails identity revalidation.

**`agent_run_steps`** — `UNIQUE (run_id, step_number)` (a step exists once, so redelivery cannot duplicate it), FK
`(run_id, tenant_id) → agent_runs (id, tenant_id)`, attempts, `next_attempt_at`, lease mirror, `fencing_token`,
`result_meta` (≤2 KB object), `error_class/_code`.

**`agent_run_events`** — append-only, identity PK for pagination, FK `(run_id, tenant_id)` and `(step_id, run_id)`,
`event_type` (closed list), `from_state/to_state`, `attempt`, `fencing_token`, `actor_kind`
(`admission|worker|recovery|operator|service`), `actor_ref`, `reason_code`, `detail` (≤1 KB). Every run/step state
change is written by trigger, so no transition escapes the log. No prompts, payloads or personal data are stored.

**`agent_runtime_controls`** — platform / hotel / agent `paused`, platform `cost_emergency_stop`. There is no column that
enables execution. **`agent_worker_heartbeats`** — worker liveness (no tenant data).

Indexes: tenant + created (`tenant lookups`), partial active-state index (pending work / recovery), lease expiry,
deadline, dead letters, `(tenant_id, run_id, id)` for event paging, step tenant/run.

## 3. State machine

```
            ┌────────── pause ──────────┐
            ▼                           │
 queued ──claim──► running ──complete(last)──► succeeded
   │  ▲             │  │ ▲ │
   │  │ yield/      │  │ │ └─ takeover (expired lease, new fencing token)
   │  │ resume      │  │ └── claim when due ── retry_wait ◄── fail(retryable, attempts left)
   │  └── paused ◄──┘  │
   │                   ├──► cancel_requested ──ack / lease expiry──► cancelled
   │                   ├──► failed        (non-retryable, deadline)
   │                   └──► dead_letter   (retries/attempts exhausted, poison)
   └──► cancelled / failed / dead_letter
```

Legal transitions are the `agent_run_transition_allowed` / `agent_step_transition_allowed` SQL tables (mirrored in
`states.py`; an integration test asserts they are identical). Terminal states (`succeeded`, `failed`, `cancelled`,
`dead_letter`) accept **no** update at all. Identity columns are immutable and the fencing token can never decrease.
`created` from the original sketch is not a state: admission is atomic, so a run is born `queued` (a trigger refuses
any other initial state).

Rules that follow: a succeeded run cannot resume; a cancelled run cannot restart; a failed run cannot become successful
(a new attempt is a new run); a pause never erases a cancellation (`cancel_requested` cannot go to `paused`, and a pause
request on it is refused); a duplicate message cannot create a step or a second terminal transition.

## 4. Queue semantics

* Queue: `patelrep_agent_runs_v1`, created by migration with `pgmq.create` (logged; `pgmq.meta.is_unlogged = false` is
  asserted by `scripts/schema-contracts.sql`). Verified with pgmq 1.5.1 on Supabase Postgres 17.6 (CI image).
* Envelope v1 is exactly `{"v": 1, "run_id": "<uuid>"}` — no tokens, roles, prompts, guest data or arguments. Anything
  else is archived as poison.
* The run row is authoritative. `agent_runs.queue_msg_id` names the one message that may start work; any other message
  naming the run is deleted as a duplicate (`duplicate_delivery` event). Redelivery never grants permission to execute.
* Terminal transitions delete (or, for dead letters, archive) the message **inside the same transaction**, so "crash
  after success but before ack" cannot leave runnable work behind.
* Deliveries that end without starting work (lease busy, retry not due, control block, yield) replace the message with a
  fresh delayed one, so `read_ct` only grows across real claim/crash cycles (poison threshold: `read_ct > 10`).
* pgmq gives at-least-once delivery. It does **not** give exactly-once effects; see §11.

## 5. Worker

`python -m services.agent_execution worker` (see [runbook.md](runbook.md) for operator commands). Not started by
FastAPI, no APScheduler, no HTTP listener. A fixed number of slot threads (`AGENT_WORKER_CONCURRENCY`) each loop:
claim → execute → commit; idle slots back off exponentially to `AGENT_WORKER_MAX_IDLE_SECONDS`; slot 0 runs the
recovery sweep every `AGENT_WORKER_RECOVERY_INTERVAL_SECONDS`; the main thread writes liveness to
`agent_worker_heartbeats`. Logs are JSON lines of identifiers, outcomes and codes only. SIGTERM/SIGINT set a stop flag;
in-flight runs yield back to the queue at their next checkpoint without consuming an attempt.

## 6. Leases and fencing

A successful claim, in one transaction: increments `fencing_token`, sets `lease_owner` = worker id and
`lease_expires_at` = now + lease, increments run and step attempts, records `claimed` (or `lease_takeover`), and sets
the message's visibility to lease + margin. Every later worker write (`heartbeat`, `complete`, `fail`, `acknowledge`)
calls `agent__owned_run`, which locks the row and requires **same token, same owner and an unexpired lease**; otherwise
it returns `lease_lost` and changes nothing. A heartbeat extends both the lease and the message visibility together,
and can never revive an expired lease. Two workers can race freely: the row lock plus token make only one owner valid.

## 7. Identity revalidation

Before **every** step the worker calls `revalidate_principal`: for a human run it reads `tenants` (active hotel),
`user_profiles` (profile in this hotel, active) and `user_roles` (exactly one active canonical role in this hotel),
then H0's `reload_identity` (freshness ≤5 min), then requires the role to hold the run's operational permission (`gm`
for synthetic probes). Demotion, removal, deactivation of the role, the profile or the hotel → non-retryable
`authorization_denied`. Several active roles, a profile owned by another hotel or an unknown role → fail closed. No JWT
or queued role is consulted. System runs use `context_for_system`, i.e. only the H0 registry (`harness.scheduled_observer`).
Known H1 limitation: a person holding two active roles in one hotel cannot run probes (fail closed by design).

## 8. Cancellation and pause

* Cancel (tenant-scoped, persisted): `queued`/`retry_wait`/`paused` → `cancelled` immediately (message removed);
  `running` → `cancel_requested`. The worker sees it at its next checkpoint (heartbeat) or at the next commit and
  acknowledges → `cancelled`. If the worker died, the next claim or the recovery sweep completes the cancellation once
  the lease expires — so cancellation survives restarts.
* **In-progress work is not interrupted.** Cancellation is cooperative: an atomic database transaction already in flight
  commits or rolls back on its own. If a step finishes after the request, its result is recorded (it happened) and the
  run ends `cancelled` without starting another step.
* Pause: `queued`/`retry_wait` → `paused` immediately (no dispatch held); `running` → `pause_requested_at`, acknowledged
  at a checkpoint (attempt refunded). Resume re-dispatches; resume before acknowledgment withdraws the request.
* Runtime controls (platform/hotel/agent pause, cost emergency stop) block admission, block claims (`blocked`), and make
  running work yield at the next checkpoint. They are re-read from the database at every decision point.

## 9. Retries

`retry.py` classifies failures: `transient_infrastructure` (retry), `persistent_infrastructure` (unknown errors; retried,
then dead-lettered), `invalid_job`, `authorization_denied`, `invalid_agent` (incl. `agent_execution_disabled`),
`deadline_exceeded`, `permanent_failure` (never retried), `stale_identity` (retry). Lease loss is not a failure: the
worker stops and writes nothing. Paused/cancelled are acknowledgments, not failures. Backoff is full-jitter exponential
(base 2 s, cap 300 s, ≥1 s), persisted as `next_attempt_at` plus a delayed message. The database decides whether an
attempt remains (step cap, run cap, deadline) — exhausted → `dead_letter` with the sanitized class/code and the message
archived. Retries pass the same claim-time control and identity checks as first attempts.

## 10. Crash recovery

| Failure | Mechanism |
|---|---|
| Crash after dequeue / after claim / during retry scheduling | Each is one transaction; on crash it rolls back or the lease expires and the message reappears at lease + margin → takeover with a new token. |
| Crash after committing success | The ack is inside the commit; nothing remains to redeliver. |
| Visibility timeout while the worker is alive | Heartbeat extends visibility with the lease; an early redelivery sees a live lease (`busy`) and waits. |
| Expired lease | Claim takes over (`lease_takeover`); repeated crashes are bounded by `max_attempts` → `dead_letter`. |
| Committed run with no message | `agent_runs_recover` re-dispatches it (never a new run). |
| Duplicate delivery | Non-authoritative message deleted; terminal-run message deleted as stale. |
| Database unavailable | Worker logs, backs off; leases expire; recovery resumes. A commit RPC that fails mid-flight has an unknown outcome, which fencing makes safe. |
| Claim function itself raising | The transaction (and the read) rolls back; the worker backs off. Not detectable per message — watch `slot_error` logs. |

## 11. Exactly-once boundaries

Exactly-once *logical database effects* are established by the fenced commit RPCs: a step's success, a retry schedule
or a terminal state is written at most once per fencing token, and `UNIQUE (run_id, step_number)` prevents duplicate
steps. A step's *work* may run more than once (a worker can crash after doing it but before committing). Synthetic steps
are side-effect free, so this is harmless in H1. **H2 tool adapters must be idempotent** (idempotency key per tool call,
recorded in the same transaction as the step commit) and H5 external connectors must deduplicate on their side.

## 12. Tenant isolation and RLS

RLS is enabled on all five tables with no end-user policy; `PUBLIC`, `anon` and `authenticated` hold no table, queue or
function privilege (asserted in CI by `schema-contracts.sql` and integration tests). All functions are
`SECURITY INVOKER` with `search_path = ''` and fully qualified names, executable only by `service_role`. Because the
service role bypasses RLS, isolation is enforced *inside* the functions: tenant-scoped RPCs match `(id, tenant_id)`
and answer `not_found` across hotels; child rows reference `(run_id, tenant_id)`; tenant authority comes from a verified
`CurrentUser` or an explicit operator choice, never a request body. The worker is platform-level (it serves every
hotel) but each run executes under its own hotel's freshly reloaded identity.

## 13. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `AGENT_WORKER_ENABLED` | `false` | Master switch. |
| `AGENT_WORKER_SYNTHETIC_ENABLED` | `false` | Opt-in for synthetic processing/admission. |
| `APP_ENV` | — | `production` always refuses to process, whatever the flags. |
| `AGENT_WORKER_WORKER_ID` | host:pid:random | Lease owner id. |
| `AGENT_WORKER_CONCURRENCY` | 2 (1–16) | Slots. |
| `AGENT_WORKER_LEASE_SECONDS` | 60 (10–900) | Lease; heartbeat every lease/3. |
| `AGENT_WORKER_VT_MARGIN_SECONDS` | 15 | Visibility beyond the lease. |
| `AGENT_WORKER_POLL_INTERVAL_SECONDS` / `_MAX_IDLE_SECONDS` | 1 / 10 | Idle backoff. |
| `AGENT_WORKER_RECOVERY_INTERVAL_SECONDS` / `_RECOVERY_BATCH` | 30 / 100 | Recovery sweep. |
| `AGENT_WORKER_BLOCKED_RETRY_SECONDS` | 30 | Re-check delay while a control blocks a run. |
| `AGENT_WORKER_POISON_READ_CT` | 10 | Redelivery limit. |

The worker also needs the API's standard settings (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`,
`CRON_SECRET`, `APP_ENV`) because it reuses `core.config`.

## 14. Local and staging testing

* Unit: `cd apps/api && python -m pytest tests/smoke/test_agent_execution_*.py tests/smoke/test_agent_harness_*.py -q`.
* Real database: build the replay workspace (`node scripts/build-migration-replay-workspace.mjs --out <dir>`),
  `supabase start` + `supabase db reset --local` in it, grant `service_role` as the CI gate does, then run
  `MIGRATED_DATABASE_TEST=1 PSQL_DOCKER_CONTAINER=<db container> SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
  python -m pytest tests/integration/test_agent_execution_*.py`. CI runs them in *Database Migration Gate* (psql via
  `DB_URL`). Never point these tests at staging or production: they purge the queue.
* Staging: migrations reach the shared staging database only through the trusted Staging Candidate workflow. There is no
  authorized path to deploy a staging worker in H1; a staging probe would need a separately approved Railway service.

## 15. Deployment requirements (not done in H1)

A future, separately authorized Railway service would use the existing `apps/api/Dockerfile` image with start command
`python -m services.agent_execution worker`, **no** public domain or healthcheck path, `restartPolicyType = ON_FAILURE`,
its own `AGENT_WORKER_*` variables, and the same Supabase service credentials as the API (Railway-managed variables).
It must not change the API or web start commands. Stopping or crashing it affects no hotel workflow.

## 16. H2 handoff

H2 (Tool Gateway) builds on: fenced step commits (add the tool idempotency record to the same transaction), the per-step
identity/controls reload (feed `policy.evaluate`), and `require_execution_supported()` (the single gate H2 flips together
with the gateway, in a reviewed PR). H2 must also relax `agent_runs_h1_synthetic_only` in a reviewed forward migration
and add an admission path that is subject to `policy.evaluate` and the `ai_agents` entitlement.

**H2 status:** implemented in migrations 241-243 and `services/agent_gateway` -- see [tool-gateway.md](tool-gateway.md)
§11. `require_execution_supported()` was NOT flipped; the gateway uses the exact `H2_EXECUTABLE_TOOLS` boundary instead.
