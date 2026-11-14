# PatelRep Agent Harness: Roadmap (H0–H8)

Legend: ✅ implemented · 🧭 designed (contract or doc exists, nothing executes) · ⏳ future

| Phase | Scope | Depends on | Status |
|---|---|---|---|
| **H0** | Contracts: agent/tool registries, capability grants, trusted identity, default-deny policy, autonomy, metering, `ai_agents` entitlement, hard execution ceiling, docs, AI-ready standard. Legacy action policy fails closed. | — | ✅ |
| **H1** | Durable execution: `agent_runs`/`agent_run_steps` migrations (RLS, tenant-scoped), pgmq queue, dedicated Railway worker, `IdentityAuthority` over `user_roles`, server-side runtime-controls store, per-step identity/controls reload, cancellation. Still no operational writes. | H0 identity, controls | ⏳ |
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

## How H0 supports H1

H1 only has to implement the two protocols H0 defines (`IdentityAuthority`, plus a runtime-controls loader that
replaces `load_runtime_controls`) and persist the run/step records. Everything it executes still passes through
`policy.evaluate`. H1 must not flip `H0_EXECUTION_SUPPORTED`. That constant changes only in H2, together with the
Tool Gateway, in a reviewed PR.
