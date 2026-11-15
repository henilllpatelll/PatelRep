# Agent Harness H3: Orchestrator, Provider Adapters and Provider-Spend Ledger

Status: **H3 implemented, not activated.** Nothing in H3 calls a paid model unless several independent, default-off
layers are switched on, production is refused in code, and no worker is deployed. Model output is data: H3 produces
validated **plans with tool proposals** and never executes a business operation.

Legend: ✅ implemented and tested · 🧪 tested only against an isolated database · ⏳ deferred

## 1. Repository audit (H3 handoff, main `6e12d69f`)

| Area | Implemented (code + tests) | Documented intention only | Contradictions resolved |
|---|---|---|---|
| H0 contracts (`services/agent_harness`) | registries, identity, default-deny policy, autonomy, `metering.py` (Decimal `ProviderUsage`, exact `PriceBook`, `ExecutionBudget` in **credits**) | "budget reservations (atomic SQL)" as a `BudgetLedgerPort` protocol | `PriceBook` is keyed by `(provider, model)` only: no versions, effective dates, tiers or processing modes. `ProviderUsage` has one `cached_input_tokens` field with no statement of whether it is inside `input_tokens` (it is for OpenAI, it is not for Anthropic). H3 adds explicit contracts instead of overloading these. |
| H1 durable execution (`services/agent_execution`, 238–240) | runs/steps/events, pgmq, fenced leases, retries, cancel/pause, recovery, threaded worker | Railway worker | — |
| H2 Tool Gateway (`services/agent_gateway`, 241–243) | exact bindings, strict schemas, approvals, idempotent assign, audit | "H3 proposes … through the same `prepare`/admission path" (tool-gateway.md §15) | H3 is proposal-only: proposals are validated against the same frozen bindings and schemas but **not** submitted to admission (deferred to H5). |
| Legacy AI (`services/ai`, `middleware/credits.py`, 013/014/217) | synchronous `OpenAI`/`Anthropic` clients (default retries), `MODEL_RATES` floats for **customer credits**, `deduct_ai_credits` atomic credit deduction, `ai_model_routes` per-hotel model overrides | — | Untouched by H3. The provider-expense ledger is separate; H3 writes nothing to `ai_interactions` or `credit_ledger`, so a hotel is never charged twice. |
| Config | `openai_api_key`, `anthropic_api_key` in `core.config.settings` | — | H3 reads keys only in `providers_factory.py`, never in prompts, logs, ledger rows or errors. |
| CI | `Test / API` (smoke), `Database Migration Gate` (replay + `schema-contracts.sql` + real-DB integration tests) | — | H3 tests ride the same two jobs; no paid provider credentials needed. |
| Staging | Staging Candidate auto-applies non-destructive pending migrations; destructive SQL needs the reviewed preview registry on main | — | Migration 246 (H1 allowlist swap) is destructive by the guard's definition, so H3 staging needs the reviewed preview (§13). |

Dependency research (2026-11-14): `openai-agents==0.24.0` (2026-10-15) requires `openai>=3,<4` and is compatible with
the pinned `openai==3.46.0`; `pip check` is clean with `requirements.txt`. Model identifiers were checked against the
pinned SDKs' model literals and the providers' model/pricing pages (see `pricebook.py` for sources).

## 2. Architecture

```
H1 worker slot ──claim (fenced)──► agent_execution.worker
                                     │ harness.orchestrator v1 / step model_planning only
                                     ▼
                         agent_orchestrator.steps.execute_planning_step
                           │ fenced planning context (247) · identity reload · runtime controls
                           ▼
                         Orchestrator.plan()  ── intent catalog → candidate registered agents + tool subset
                           │                   ── catalog.route(workload) → reviewed primary + fallbacks
                           ▼
                         AgentsSdkPlanner  (Runner.run, output_type=PlanDraft, no tools, no handoffs, tracing off)
                           │ every model request
                           ▼
                         BudgetedModel.get_response ──► BudgetedCaller.call  ◄── THE paid-call boundary
                           │ 1 bound input/output → max exposure (price book)
                           │ 2 agent_model_attempt_reserve  (commit; locks run → counters in fixed order)
                           │ 3 agent_model_attempt_dispatch (commit; re-checks lease, cancel, controls)
                           │ 4 native provider adapter (max_retries=0, timeout)   ← only network egress
                           │ 5 agent_model_attempt_settle (settled / released / uncertain / unreconciled)
                           ▼
                         plans.validate_plan (deterministic; H2 bindings + schemas) → agent_planning_record_plan
```

| Module (`apps/api/services/agent_orchestrator/`) | Responsibility |
|---|---|
| `config.py` | default-off process gates (`AGENT_ORCHESTRATOR_*`); production refused |
| `catalog.py` | versioned model catalog, workload classes, capability-aware routing, overrides, fallback rules |
| `pricebook.py` | reviewed, versioned price schedules (sources recorded); mirror of the migration 244 seed |
| `providers.py` | provider-neutral request/outcome types, error taxonomy, dispatch-state classification |
| `provider_openai.py` / `provider_anthropic.py` | native async adapters; usage normalisation inputs; sanitized errors |
| `providers_factory.py` | the only place provider credentials are read |
| `budget_store.py` | typed wrapper over the `agent_model_*` RPCs (the ledger) |
| `boundary.py` | `BudgetedCaller`: per-attempt reservation, retry/fallback policy, settlement |
| `sdk_model.py` | Agents SDK `Model`/`ModelProvider` integration and tracing configuration |
| `plans.py` | strict planning schema and deterministic validator |
| `planner.py` | `Planner` interface and the Agents SDK implementation |
| `orchestrator.py` | agent selection, limits, deadline, validation |
| `store.py` / `admission.py` / `steps.py` | H1 planning admission, fenced context, step executor |
| `observability.py` | metadata-only structured logs with redaction |

Pure H0 additions (no I/O): `agent_harness/provider_usage.py` (normalised usage) and
`agent_harness/provider_pricing.py` (versioned tiered schedules, pricing, maximum exposure, USD budget contracts).

## 3. Authority boundaries

| Layer | Owns | H3 change |
|---|---|---|
| H0 | identity, registries, policy, autonomy, entitlement | adds pure usage/pricing/USD-budget contracts; `H0_EXECUTION_SUPPORTED` stays `False`; `H2_EXECUTABLE_TOOLS` unchanged |
| H1 | run/step state, leases, fencing, retries, cancel/pause, recovery | `harness.orchestrator` v1 + `model_planning` added to the exact allowlists; planning runs admitted only by `agent_planning_run_admit` |
| H2 | operational tool execution | none. The orchestrator agent has **no tool pins** and is not in the gateway registry; any gateway call naming it is `agent_not_registered` |
| H3 | planning, routing, provider calls, provider spend | new |
| H4 | customer credits, overage, Stripe | none (§9) |

## 4. Model catalog and routing

Workload classes: `fast_classification`, `routine_reasoning`, `structured_tool_proposals`, `multistep_planning`,
`complex_analysis`. Each reviewed route names a primary model and an ordered fallback list. Routing checks, for the
primary, every fallback and any override: exact catalog membership, required capabilities (structured output
mechanism, reasoning), input and output bounds within the model's reviewed caps, an effective price schedule, and
(fallbacks/overrides) **maximum exposure no higher than the primary's** — there is no silent upgrade to a more expensive
model and no fallback outside the reviewed list. The cheapest adequate models are the defaults; the higher-priced
`claude-sonnet-5-5` / `gpt-6.1-terra` serve only `complex_analysis` and `multistep_planning`.

Initial catalog (catalog version `h3.1`):

| Provider | Model | Structured output | Reviewed input cap | Max output | Used for |
|---|---|---|---|---|---|
| openai | `gpt-6-luna` | Responses `text.format` json_schema strict | 64,000 | 4,096 | fast classification, routine reasoning, tool proposals (primary) |
| anthropic | `claude-haiku-5-5` | Messages `output_config.format` json_schema | 64,000 | 4,096 | fallback for the above |
| openai | `gpt-6.1-terra` | json_schema strict | 64,000 | 8,192 | multistep planning (primary, no fallback: every alternative costs more), complex-analysis fallback |
| anthropic | `claude-sonnet-5-5` | json_schema | 64,000 | 8,192 | complex analysis (primary) |

Input caps sit below every long-context tier threshold (OpenAI >272K, Haiku 5.5 >100K), so the base tier always
applies; the price book still models the tiers so exposure stays correct if a cap is ever raised.

## 5. Usage normalisation (`provider_usage.py`)

`NormalizedUsage` has disjoint categories: `uncached_input`, `cache_read`, `cache_write_short`, `cache_write_long`,
`output` (reasoning **included**), `reasoning` (informational subset), plus `unpriced` (any other non-zero billable
category). `prompt_tokens = uncached_input + cache_read + cache_write_*` drives tier selection.

| Provider | Raw fields | Mapping |
|---|---|---|
| OpenAI Responses | `input_tokens` ⊇ `cached_tokens` + `cache_write_tokens` (`ttl_30m_tokens`, `ttl_12h_tokens`); `output_tokens` ⊇ `reasoning_tokens` | `uncached = input − cached − write`; writes split by TTL; a write total without a matching TTL split is **ambiguous** → unreconciled |
| Anthropic Messages | `input_tokens` (uncached only), `cache_read_input_tokens`, `cache_creation_input_tokens` (`ephemeral_5m`, `ephemeral_1h`), `output_tokens`; `service_tier`, `inference_geo`, `speed`, `server_tool_use` | categories added, never subtracted; non-standard tier, US geo (1.1×), fast mode or server-tool usage → unpriced → unreconciled |

Missing usage → `usage_status = unreported` → cost **unreconciled** and the whole reservation is retained. Negative
derived values, reasoning > output, or non-integer counts → `malformed` → unreconciled. Token counts are never
invented.

## 6. Price books (`provider_pricing.py`, `pricebook.py`, migration 244)

A schedule is `(provider, model, processing_mode, schedule_version, effective_from, effective_to)` with a base rate
card and an optional long-context tier (`threshold_prompt_tokens` + full rate card). Rates are `Decimal` USD per
million tokens for input, cache read, short/long cache write and output; a `None` rate means "not priced" and any
non-zero usage in that category makes the call unreconciled. Lookup is exact on provider, processing mode and the
reported model (or a reviewed alias list) at the call's timestamp; schedules for one key may not overlap. New prices
are a **new schedule version** with a new effective date, added by migration; existing rows are immutable except for
closing `effective_to` once. Costs are computed in `Decimal` and rounded **up** to 1e-8 USD.

**Maximum exposure** for one attempt = `ceil8((max_input × max(input, cache-read, cache-write rates) + max_output ×
output_rate) / 1e6)` using the tier the *maximum* prompt could reach. `max_input` = UTF-8 bytes of everything sent
(system, messages, JSON schema) + per-message overhead + the model's reviewed hidden-overhead allowance; byte-level BPE
tokenizers never emit more text tokens than bytes. The database recomputes the same bound from the stored schedule
and refuses a reservation below it.

## 7. Provider-spend ledger (migrations 244–245)

Tables (all RLS-enabled, service role only, `numeric(20,8)` money, no negative amounts):

| Table | Purpose |
|---|---|
| `agent_model_price_schedules` | immutable, versioned price rows (seeded by 244) |
| `agent_model_budget_policies` | versioned USD limits by scope: `platform`, `provider`, `hotel`, `agent` (period/run/step/call); a new version retires the previous one |
| `agent_model_budget_counters` | running `reserved_usd` / `committed_usd` per scope × period (calendar month, UTC; run/step use a fixed sentinel period) |
| `agent_model_attempts` | one row per network attempt: logical call key + attempt number (idempotent), schedule, bounds, state, amounts, provider ids, normalised usage counts, error code |
| `agent_model_spend_events` | append-only financial history (reserved, denied, dispatched, settled, released, uncertain, unreconciled, overrun, reconciled, recovered) |
| `agent_model_enablement` | single-row paid-call switch, default **off** |

Attempt states: `reserved → dispatched | released`; `dispatched → settled | released | uncertain | unreconciled`;
`uncertain | unreconciled → settled | released` (operator reconciliation only). `settled` and `released` are terminal.

**Reservation** (`agent_model_attempt_reserve`, one transaction): fenced run lock → idempotent replay by
`(tenant, logical_call_key, attempt_number)` → paid-call switch, pauses, cost emergency stop, run cancel/pause/deadline
→ exact effective schedule → database exposure ≤ presented exposure → required policies (platform, hotel, agent;
provider if configured) → per-run uncertain cap → counters locked in the fixed order platform → provider → hotel →
agent → run → step, each checked as `reserved + committed + exposure ≤ limit` → insert attempt + increment
`reserved_usd` + event. Any failure writes only a `reservation_denied` event.

**Dispatch marker** (`agent_model_attempt_dispatch`): re-checks lease ownership, cancellation, pause, controls and the
switch. If anything changed it releases the attempt in the same transaction and the worker never calls the provider.
The worker opens the network connection only after this commit.

**Settlement** (`agent_model_attempt_settle`): from `dispatched` only, bound to the attempt's fencing token (not the
lease: a worker that lost its lease must still record money it spent). `settled` moves the reservation to
`committed_usd` at the actual cost; an actual cost above the reservation is recorded in full, flagged
`reconciliation_required`, emits `overrun_detected`, and fails the step. `released` (provider rejected the request
before processing) returns the exposure. `uncertain` and `unreconciled` keep the whole exposure reserved.
A second settlement is refused (`already_settled`); nothing is applied twice.

**Recovery** (`agent_model_attempts_recover`): `reserved` attempts whose dispatch marker never committed and whose run
no longer holds that fencing token are released (the provider was never called). `dispatched` attempts older than the
stale threshold become `uncertain` — never released. Only `agent_model_attempt_reconcile` (tenant-scoped, operator
name and evidence code required) can release or settle an uncertain/unreconciled attempt.

## 8. Retries, fallback, cancellation

| Error | Dispatch state | Settlement | Automatic retry |
|---|---|---|---|
| connection refused / DNS / connect timeout | not dispatched | released | yes (bounded, backoff with jitter) |
| HTTP 429, 529/503 overloaded | rejected, no charge | released | yes, or next fallback |
| HTTP 400/404/422 invalid request, unsupported model | rejected, no charge | released | no |
| HTTP 401/403 | rejected, no charge | released | no (`provider_auth_failed`) |
| HTTP 500/502/504, read timeout, disconnect, task cancelled mid-flight | **uncertain** | uncertain (exposure kept) | **no** |
| response without usage / unknown model price | completed | unreconciled (exposure kept) | no new call needed |
| response not matching the schema | completed | settled at actual cost | no (`invalid_structured_output`) |

Each retry or fallback is a new attempt number with its own reservation. Total attempts per step
(`max_model_calls_per_step`), attempts per logical call, the step deadline and the per-run uncertain cap bound
everything. Nothing starts after cancellation, pause, emergency stop or budget exhaustion; the dispatch marker re-checks
all of them immediately before each network call. A cancelled in-flight call is cancelled at the HTTP layer and
recorded `uncertain`.

## 9. Relationship to customer billing (H4)

H3 records what providers charge PatelRep (USD) and enforces spending limits. It does **not** convert cost into credits,
touch `credit_ledger`, call `deduct_ai_credits`, write `ai_interactions` or call Stripe. H4 will read settled
attempts (`agent_model_attempts.state = 'settled'`, not `reconciliation_required`) and apply a
`CustomerPricingPolicy` (H0) to produce customer credits, with included allowances, overage opt-in and Stripe true-up.
Unreconciled/uncertain attempts stay `pending_reconciliation` (H0 `quote_customer_credits`). Existing AI features keep
their current credit flow unchanged, so nothing is billed twice.

## 10. H1 / H2 integration

Migration 246 (reviewed, destructive by the guard's definition) replaces `agent_runs_h2_agent_allowlist` with
`agent_runs_h3_agent_allowlist` (adds exactly `harness.orchestrator` v1 with an empty `synthetic_spec`) and adds
`model_planning` to the step-type allowlist. The insert guard now requires the planning admission marker for the
orchestrator and still requires the gateway marker for the dispatch assistant. Migration 247 adds
`agent_planning_runs` (one immutable request + at most one recorded plan per run) and the fenced planning RPCs.

The worker runs a planning step only when the orchestrator process gate is on. Lease loss cannot undo a dispatched
provider request; the attempt row (not the H1 step) is the financial record, and settlement does not require the
lease. Queue messages stay `{"v": 1, "run_id": …}`.

Plans contain at most `max_tool_proposals` proposals, each an exact `(tool_id, version)` pinned by a candidate agent
and bound in H2's frozen registry, with arguments validated by H2's strict schema (identity/approval keys refused at any
depth) and confined to the run's verified resource. A write proposal is labelled `requires_human_approval` and is
data only. Nothing in H3 calls `prepare`, `admit_tool_run`, an approval RPC or an adapter.

## 11. Tracing, logging and redaction

SDK tracing is disabled globally and per run, sensitive-data capture is off, and the default OpenAI trace processor is
removed. `observability.py` logs only allowlisted scalar fields (ids, provider, models, schedule version, token counts,
cost/status, latency, retry/fallback counts, sanitized codes) after secret redaction and length caps. Prompts,
completions, reasoning, provider error messages and exception objects are never logged or stored. Tests inject secret
canaries into provider errors and responses and assert they never reach logs, ledger payloads or raised exceptions.

## 12. Configuration and activation

| Variable | Default | Meaning |
|---|---|---|
| `AGENT_ORCHESTRATOR_EXECUTION_ENABLED` | `false` | worker may process planning steps (also needs `AGENT_WORKER_ENABLED`) |
| `AGENT_ORCHESTRATOR_PAID_CALLS_ENABLED` | `false` | live provider adapters may be built |
| `APP_ENV` | — | `production` always refuses planning execution and admission |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | — | existing API settings, read only by `providers_factory.py` |

Database layers: `agent_model_enablement.enabled` (default false), budget policies (none seeded = every reservation
denied), runtime controls, `ai_agents` entitlement, and the initiator's current role. Activation of any paid call
needs all of them and is **not** done by this PR.

## 13. Staging and migrations

Migrations 244, 245 and 247 are additive. 246 drops and recreates two CHECK constraints, which the staging guard
classifies as destructive; the Staging Candidate therefore refuses the whole pending set and **nothing is applied to
shared staging**. Applying H3 to staging needs a reviewed-preview registry entry on `main` (control-plane PR) pinning
the four files' digests, a dispatch restating them, and an environment approval — see
`docs/staging-previews/h3-orchestrator-244-247.md`. Until then H3 is verified only in the isolated replay database.

## 14. Implemented vs deferred

| Item | Status |
|---|---|
| Usage normalisation, versioned tiered pricing, exposure | ✅ |
| Model catalog, routing, overrides, fallback rules | ✅ |
| OpenAI / Anthropic adapters (fake transports through the real SDK clients) | ✅ |
| Spend ledger, reservations, settlement, recovery, reconciliation | ✅ 🧪 |
| Agents SDK planner behind `BudgetedModel`; tracing off | ✅ |
| Plan schema and deterministic validation against H2 | ✅ |
| H1 planning runs (admission, fenced context, worker step) | ✅ 🧪 |
| Live paid provider calls | ⏳ never enabled in H3 |
| Staging application of 244–247 | ⏳ reviewed preview needs approval |
| Submitting proposals to the Tool Gateway | ⏳ H5 |
| Customer credits from provider cost | ⏳ H4 |
| Per-hotel model override storage, control-center UI | ⏳ H6 |
| Worker deployment, production activation | ⏳ separate authorization |
