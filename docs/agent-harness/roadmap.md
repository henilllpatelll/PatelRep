# PatelRep Agent Harness: Roadmap (H0–H8)

Legend: ✅ implemented · 🧭 designed (contract or doc exists, nothing executes) · ⏳ future

| Phase | Scope | Depends on | Status |
|---|---|---|---|
| **H0** | Contracts: agent/tool registries, capability grants, trusted identity, default-deny policy, autonomy, metering, `ai_agents` entitlement, hard execution ceiling, docs, AI-ready standard. Legacy action policy fails closed. | — | ✅ |
| **H1** | Durable execution: `agent_runs`/`agent_run_steps`/`agent_run_events` migrations (RLS, tenant-scoped), pgmq queue, dedicated worker, `IdentityAuthority` over `user_roles`/`user_profiles`/`tenants`, server-side runtime-controls store, per-step identity/controls reload, leases + fencing, retries, cancellation/pause, recovery. Synthetic jobs only; no operational writes. | H0 identity, controls | ✅ (worker not deployed) |
| **H2** | Tool Gateway: exact `(tool, version)` bindings; strict input/output enforcement; two read tools; persistent approvals bound to the action digest (independent approver, single use, revocable, expiring); `awaiting_approval` run state; atomic idempotent approved work-order assignment on the operation shared with the human route; immutable tool audit. | H1 | ✅ (isolated DB only; no worker deployed; production refused in code) |
| **H3** | Orchestrator + provider abstraction: OpenAI Agents SDK planner, OpenAI/Anthropic adapters, metered calls producing `ProviderUsage`, price book, budget reservations (atomic SQL), tracing with sensitive payloads off. | H2 | ✅ (isolated DB only; paid calls never enabled; no worker deployed; production refused in code) |
| **H4** | Customer billing: versioned two-person pricing policies, pre-dispatch customer-credit holds bound to the H3 reservation, one immutable charge per settled attempt, reconciliation (dry-run, metadata-only), GM-only overage consent (off by default) with caps, durable Stripe true-up outbox, Billing & Usage UX. | H3 | ✅ (default disabled; Stripe test mode only; nothing scheduled; production refused in code) |
| **H5** | First Operations specialists (Engineering `engineering.dispatch_assistant` v2, Housekeeping `housekeeping.room_readiness_assistant` v1) at observe / human-approved autonomy; verified planning context; plan schema v2; the H3 → H2 proposal handoff; human-approved one-room Housekeeping assignment on `publish_assignment_batch`; backend recommendation preview. | H2–H4 | ✅ (default disabled; isolated DB only until the reviewed staging preview; no worker deployed; production refused in code) |
| **H6** | AI Control Center: per-hotel enablement, autonomy grants, pauses/emergency stops, approval inbox, audit viewer. | H1–H5 | ⏳ |
| **H7** | Bounded autonomy (level 3) for expressly granted low-risk operational tools; requires a new manifest schema version and a reviewed risk model. | H6 | ⏳ |
| **H8** | Coordinated autonomy (level 4), cross-product agents (Guest, Growth, Owner, Connect), persistent memory with trust boundaries. | H7 | ⏳ |

## H0: implemented vs. designed

| Item | Status |
|---|---|
| Agent/tool manifest validation and registries (in-process) | ✅ |
| Capability catalog with explicit role grants + drift tests | ✅ |
| Trusted context factories, refusal of forged/stale/unknown identity | ✅ |
| Default-deny `evaluate()` with reason codes | ✅ |
| Autonomy grants + human-authority rules | ✅ contract · level ≥2 not executable |
| Metering/billing/budget types and pure functions | ✅ contract · no DB/Stripe |
| `ai_agents` tenant entitlement registered (default off) | ✅ |
| Hard execution ceiling (`H0_EXECUTION_SUPPORTED = False`) | ✅ |
| Persistent registry, run storage, queue, worker | 🧭 (architecture.md §4) |
| Emergency-stop store and cancellation | 🧭 (security.md §10) |
| Tool dispatch, approvals storage, idempotency store | 🧭 |
| Model calls, orchestration, tracing | 🧭 |

## H1: implemented vs. deferred

| Item | Status |
|---|---|
| Run / step / append-only event tables, DB-enforced state machine, tenant-consistent FKs, RLS (migration 238) | ✅ |
| Logged pgmq queue `patelrep_agent_runs_v1`; atomic admit + enqueue; idempotent admission (239) | ✅ |
| Fenced leases, heartbeats, takeover, bounded retries with persisted backoff, dead letter (239) | ✅ |
| Tenant-scoped cancel / pause / resume, recovery sweep, diagnostics, runtime controls (240) | ✅ |
| Dedicated worker process + operator CLI (`python -m services.agent_execution`) | ✅ code · not deployed |
| `IdentityAuthority` implementation and per-step revalidation | ✅ |
| Closed synthetic operation catalog (the only executable work) | ✅ non-production only |
| Real-database concurrency / crash / recovery tests (CI Database Migration Gate) | ✅ |
| Railway worker service (staging or production) | ⏳ needs separate authorization |
| Customer-facing run APIs / AI Control Center | ⏳ H6 |
| Tool dispatch, idempotent tool adapters | ✅ H2 (exact `H2_EXECUTABLE_TOOLS`; `H0_EXECUTION_SUPPORTED` stays False) |
| Model calls, orchestration, budget reservations | ⏳ H3 |
| Multi-role human principals (currently fail closed) | ⏳ still fail closed in H2 (deliberate) |

See [durable-execution.md](durable-execution.md) and [runbook.md](runbook.md).

## How H0 supports H1

H1 only has to implement the two protocols H0 defines (`IdentityAuthority`, plus a runtime-controls loader that
replaces `load_runtime_controls`) and persist the run/step records. Everything it executes still passes through
`policy.evaluate`. H1 must not flip `H0_EXECUTION_SUPPORTED`. That constant changes only in H2, together with the
Tool Gateway, in a reviewed PR.

## H2: implemented vs. deferred

| Item | Status |
|---|---|
| Binding registry, strict schemas, output limits/redaction, layered execution boundary | ✅ |
| `engineering.work_orders.lookup` v2, `housekeeping.rooms.status_lookup` v1 | ✅ real-DB tested |
| Approvals (migration 241/243), `awaiting_approval`, expiry sweep | ✅ real-DB tested |
| `engineering.work_orders.assign` v2: atomic, idempotent, human-approved | ✅ real-DB concurrency/crash tested |
| `POST /work-orders/{id}/assign` moved onto the shared `work_order_assign_apply` | ✅ |
| Staging worker / staging end-to-end run | ⏳ needs separate authorization |
| Approval inbox routes / UI | ⏳ H6 |
| Production activation | ⏳ separate decision (refused in code) |

See [tool-gateway.md](tool-gateway.md).

## H3: implemented vs. deferred

| Item | Status |
|---|---|
| Usage normalisation (OpenAI cached/written inside input, Anthropic outside), versioned tiered price book | ✅ |
| USD provider-spend ledger: atomic reservations, dispatch marker, settlement, uncertain/unreconciled, reconciliation, recovery (244-245) | ✅ real-DB concurrency/crash tested |
| Native OpenAI Responses / Anthropic Messages adapters, no SDK retries, sanitized errors | ✅ fake transports through the real SDK clients |
| Model catalog and capability-aware routing; fallback/override never more expensive | ✅ |
| Agents SDK planner behind `BudgetedModel` (every SDK request reserved), tracing off | ✅ |
| Deterministic plan validation against H2 contracts; proposals never execute | ✅ |
| H1 planning runs: `harness.orchestrator` v1 / `model_planning` (246-247) | ✅ real-DB tested |
| Live paid provider calls | ⏳ never enabled in H3 |
| Staging application of 244-247 | ⏳ needs the reviewed staging preview (246 is destructive by the guard's definition) |
| Proposal handoff to the Tool Gateway | ✅ H5 |
| Customer credits from settled provider cost | ✅ H4 |

See [orchestrator.md](orchestrator.md) and [ADR-0002](adr-0002-h3-orchestration-and-spend.md).

## H4: implemented vs. deferred

| Item | Status |
|---|---|
| Financial audit + 4 legacy fixes (invoice item vs invoice id, whole cents, last-day drop, payment_failed shape) | ✅ ADR-0003 |
| Versioned two-person pricing policies, consent history, holds, charge journal, adjustments (248) | ✅ real-DB tested |
| Hold/dispatch/settle wrappers + dispatch guard trigger, reconciler, Stripe outbox RPCs (249) | ✅ real-DB concurrency/crash tested |
| Planning worker routed through the H4 wrappers (pass-through while disabled) | ✅ |
| GM API: `/billing/ai-usage`, `/billing/overage/{quote,authorize,revoke}`, `/billing/history` | ✅ |
| Stripe true-up processor + invoice webhooks (fake transport; test mode only) | ✅ |
| Billing & Usage UX: usage breakdown, overage controls, AI billing history | ✅ browser-verified (hermetic) |
| Any pricing policy for a real hotel; customer billing mode `enforced` anywhere | ⏳ human/product decision |
| Scheduling reconciliation or true-up; live Stripe | ⏳ separate authorization (code + migration change for live) |
| Legacy true-up on a durable outbox (250) + full dispatch-authorization trigger (250) | ✅ real-DB tested |
| Cancellation billing policy (held in manual review until decided) | ⏳ product decision (ADR-0003 F5) |

See [customer-billing.md](customer-billing.md) and [ADR-0003](adr-0003-h4-customer-billing.md).

## H5: implemented vs. deferred

| Item | Status |
|---|---|
| Engineering specialist (dispatch assistant v2) + `engineering.work_orders.assignment_candidates` v1 | ✅ real-DB tested |
| Housekeeping specialist (room readiness v1) + readiness / candidates reads + `housekeeping.room_assignments.assign` v1 | ✅ real-DB tested |
| Four reviewed intents, plan schema v2 with fact-checked findings (251-252) | ✅ |
| Verified context gathered through the gateway before any paid call | ✅ |
| H3 → H2 proposal handoff (immutable handoff rows, fresh-fact re-check, atomic admission) (252) | ✅ real-DB tested |
| Human-approved one-room assignment through `publish_assignment_batch` (253) | ✅ real-DB concurrency/staleness tested |
| Planning audit events (specialist selected, context, plan, dismissal, handoff) | ✅ |
| Post-commit staff push for gateway writes (both writes) | ✅ best effort, never on replay |
| Backend recommendation preview + decision routes (404 unless gates on) | ✅ |
| Web / mobile UI | ⏳ H6 (active-surface rule; no button offered while the backend cannot act) |
| Hotel-wide queue intents, asset/PM context, assignment removal, multi-room plans | ⏳ deferred (ADR-0004 §5) |
| Staging application of 251-253 | ⏳ reviewed preview (251 is destructive by the guard's definition) + approval |
| Worker deployment, paid calls, production | ⏳ separate authorization |

See [ADR-0004](adr-0004-h5-operations-specialists.md), [handoff.md](handoff.md),
[tool-intent-matrix.md](tool-intent-matrix.md), [threat-model-h5.md](threat-model-h5.md),
[runbook-h5.md](runbook-h5.md) and [rollout-h5.md](rollout-h5.md).
