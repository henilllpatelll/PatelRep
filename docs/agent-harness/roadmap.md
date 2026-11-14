# PatelRep Agent Harness: Roadmap (H0–H8)

Legend: ✅ implemented · 🧭 designed (contract or doc exists, nothing executes) · ⏳ future

| Phase | Scope | Depends on | Status |
|---|---|---|---|
| **H0** | Contracts: agent/tool registries, capability grants, trusted identity, default-deny policy, autonomy, metering, `ai_agents` entitlement, hard execution ceiling, docs, AI-ready standard. Legacy action policy fails closed. | — | ✅ |
| **H1** | Durable execution: `agent_runs`/`agent_run_steps`/`agent_run_events` migrations (RLS, tenant-scoped), pgmq queue, dedicated worker, `IdentityAuthority` over `user_roles`/`user_profiles`/`tenants`, server-side runtime-controls store, per-step identity/controls reload, leases + fencing, retries, cancellation/pause, recovery. Synthetic jobs only; no operational writes. | H0 identity, controls | ✅ (worker not deployed) |
| **H2** | Tool Gateway: bind `ToolSpec` to extracted shared business operations; read tools first; approval records + action digest; idempotency store; immutable audit events; timeouts/output limits. First human-approved write tool. | H1 | ⏳ |
| **H3** | Orchestrator + provider abstraction: OpenAI Agents SDK planner, OpenAI/Anthropic adapters, metered calls producing `ProviderUsage`, price book, budget reservations (atomic SQL), tracing with sensitive payloads off. | H2 | ⏳ |
| **H4** | Customer billing: `CustomerPricingPolicy` persistence, credit quotes from reconciled cost, reconciliation job for `unreconciled` usage, overage opt-in UX + Stripe true-up (no automatic overage by default). | H3 | ⏳ |
| **H5** | First specialist agents for Operations (Engineering, Housekeeping) at observe / human-approved autonomy. | H2–H4 | ⏳ |
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
| Tool dispatch, idempotent tool adapters, `H0_EXECUTION_SUPPORTED = True` | ⏳ H2 |
| Model calls, orchestration, budget reservations | ⏳ H3 |
| Multi-role human principals (currently fail closed) | ⏳ H2 |

See [durable-execution.md](durable-execution.md) and [runbook.md](runbook.md).

## How H0 supports H1

H1 only has to implement the two protocols H0 defines (`IdentityAuthority`, plus a runtime-controls loader that
replaces `load_runtime_controls`) and persist the run/step records. Everything it executes still passes through
`policy.evaluate`. H1 must not flip `H0_EXECUTION_SUPPORTED`. That constant changes only in H2, together with the
Tool Gateway, in a reviewed PR.
