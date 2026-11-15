# ADR-0002: H3 orchestration, provider access and provider-spend ledger

- **Status:** Accepted for H3 (implemented, not activated). Refines ADR-0001; it does not withdraw it.
- **Date:** 2026-11-14
- **Supersedes in part:** ADR-0001 "Model access" and "Agent runtime" rows, only where noted below.

## Context

ADR-0001 chose the OpenAI Agents SDK as the agent runtime and a provider abstraction with OpenAI and Anthropic
adapters. Implementing H3 against the current releases (Agents SDK `openai-agents` 0.24.0, `openai` 3.46.0,
`anthropic` 2.6.0) surfaced facts ADR-0001 could not know:

1. The SDK's built-in model path (`MultiProvider` / `OpenAIResponsesModel`) makes the network call itself. A budget
   check before `Runner.run()` cannot see the individual paid requests the runner makes (one per turn, plus any
   runner-managed retry).
2. The SDK's `Usage` object normalises missing provider usage to zero. "Missing usage is not zero usage" cannot be
   honoured from SDK `Usage`.
3. `RunConfig.trace_include_sensitive_data` defaults to `True` (env `OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA`,
   default `"true"`), and tracing exports to OpenAI by default.
4. Both provider SDKs retry 408/409/429/5xx and connection errors twice by default (`max_retries=2`), so one
   logical call can silently become three paid requests.
5. OpenAI reports cached reads and cache writes *inside* `input_tokens`; Anthropic reports them *outside*
   `input_tokens`. Both now bill cache writes at a premium, and both have long-context price tiers on some models.

## Decision

| Concern | Decision |
|---|---|
| Agent runtime | Keep the Agents SDK as the **planner runtime** only: `Agent(output_type=<strict plan schema>, tools=[], handoffs=[])` driven by `Runner.run(max_turns=…)`. No SDK function tools, handoffs, MCP servers, sessions, guardrail tool calls or hosted tools. |
| Model access inside the SDK | A PatelRep `agents.Model` subclass (`BudgetedModel`). Every `get_response` call goes through the H3 budget boundary (reserve → commit → dispatch marker → network → settle). `stream_response` is refused. `RunConfig.model_provider` is a provider that refuses every lookup, so the SDK can never construct its own OpenAI client. |
| Provider calls | **Native** async SDK clients: OpenAI **Responses API** (`AsyncOpenAI.responses.create`) and Anthropic **Messages API** (`AsyncAnthropic.messages.create`), each with `max_retries=0`, an explicit timeout, an explicit standard service tier, and caching configured so no cache write is requested. Retries happen only in the H3 boundary, each with its own reservation. |
| Metering source of truth | The native provider response object (usage, reported model, request id, response id, service tier). SDK `Usage` is never used for money. |
| Tracing | `set_tracing_disabled(True)`, `set_trace_processors([])`, `RunConfig(tracing_disabled=True, trace_include_sensitive_data=False)`. PatelRep's own metadata-only JSON logs and the spend ledger replace SDK traces. |
| Spending control | A USD **provider-expense** ledger in PostgreSQL (migrations 244–245), separate from customer credits (`credit_ledger`, `deduct_ai_credits`). Atomic reservation per network attempt with deterministic lock order. |
| Pricing | Versioned, effective-dated price schedules held in code *and* in the database (immutable rows); the database recomputes maximum exposure independently and refuses an under-estimate. |
| H1 integration | One new agent (`harness.orchestrator` v1) and one new step type (`model_planning`) added to the exact H1/H2 allowlists in a reviewed forward migration (246). |
| H2 relationship | Plans are data. Tool proposals are validated against H2's frozen bindings and schemas but are never submitted to the gateway in H3. |

## Rejected alternatives

- **SDK `OpenAIResponsesModel` / `MultiProvider` for paid calls:** cannot guarantee a committed reservation before
  each network attempt, and its usage normalisation loses "unreported".
- **LiteLLM (or the SDK's LiteLLM extension) for Anthropic:** adds a dependency and another usage-normalisation layer
  between the provider and the ledger; the native Anthropic SDK reports the cache categories and request ids we need.
- **Reserving once per `Runner.run()`:** the runner can make several paid requests; a single reservation would either
  under-reserve or reserve the worst case for every turn without per-attempt settlement.
- **Holding a database transaction across the provider call:** blocks counters for seconds and still cannot make the
  network call transactional. Replaced by the two-phase reserve/dispatch marker plus explicit uncertain outcomes.
- **Reinterpreting H0 `ExecutionBudget` credits as USD:** rejected; credits are a customer product (H4). H3 adds
  explicit USD contracts.
- **Temporal / Redis / a second queue:** unchanged from ADR-0001; H1's pgmq and run records are reused.

## Consequences

- One extra database round trip per model attempt (reserve, dispatch marker, settle). Acceptable for planning calls
  measured in seconds.
- A provider timeout after dispatch leaves an **uncertain** exposure that only an operator reconciliation can release.
  Spending capacity is consumed conservatively until then.
- The platform budget row is a global serialisation point for reservations (short transactions only).
- Model or price changes are reviewed data changes (catalog/price book + migration), not algorithm changes.
