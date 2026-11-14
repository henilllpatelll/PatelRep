# ADR-0001: Initial Agent Harness Stack

- **Status:** Accepted for planning (H0). Nothing in this ADR is deployed by H0.
- **Date:** 2026-11-13
- **Context:** PatelRep (FastAPI + Supabase Postgres + Railway; existing OpenAI/Anthropic usage with token-based credit
  metering) plans about 12 specialist agents over 28 capabilities across five product families. A small team runs it,
  and it serves 50–150-room hotels on a $99/mo plan. Any added infrastructure has to justify its operating cost.

## Decision

| Concern | Choice | Why |
|---|---|---|
| Agent runtime | **OpenAI Agents SDK (Python)** | Fits the FastAPI codebase. Gives handoffs, tool calling, guardrails and tracing without a separate service. Tools stay our own Python functions behind our policy, so the SDK never owns authorization. |
| State | **Supabase PostgreSQL** | Already the system of record with RLS, migrations and gates. Run/step/approval/budget rows sit next to the business data they reference, so they can be updated transactionally. |
| Queue | **pgmq (Supabase Queues)** | Lives inside the same Postgres: no new vendor, transactional enqueue with the run row, visibility timeouts for retries. Messages carry ids only. |
| Execution | **Dedicated Railway Python worker** | Isolates long-running agent work from API latency and from the APScheduler cron process. Same codebase, same deploy pipeline, and it scales independently. |
| Business logic | **Existing domain services/routers** | One authorized operation for UI and agents (see the AI-ready standard). No duplicated rules. |
| Model access | **Provider abstraction (OpenAI + Anthropic adapters)** | Keeps the existing model-routing split, makes usage reporting uniform for metering, and keeps credentials out of agent code. |

## Alternatives considered

- **Temporal:** excellent durable execution, but a new cluster (or a paid cloud) and a new programming model, which is
  too much operational weight at the current scale. pgmq plus explicit step records covers our needs: steps are
  short and mostly human-gated. We revisit if workflows become long-running, high-fan-out sagas.
- **LangGraph:** a capable graph orchestrator, but it overlaps with the Agents SDK and adds another abstraction over
  tool calling. Our safety comes from the Tool Gateway, not the orchestration framework, so a second framework adds
  surface without adding control.
- **Kubernetes:** no benefit over Railway services at this size, with significant operational cost.
- **APScheduler as the agent executor:** rejected. It's in-process, has no durable per-step state, has dropped and
  delayed runs before, and is reserved for existing crons.
- **Anthropic-only or OpenAI-only:** rejected. The existing routing deliberately uses both (latency vs reasoning
  quality).

## Consequences

- H1 adds migrations (runs, steps, approvals, idempotency, budget reservations) as forward-only, tenant-scoped files
  with RLS, plus one Railway service.
- The Agents SDK is a replaceable planner. Swapping it doesn't touch the registries, identity, policy or metering
  contracts.
- Tracing must be configured with sensitive payload capture **off** by default (security.md §8).
- **H0 adds none of this infrastructure.** No dependency, queue, worker or migration is introduced before the phase
  that uses it.
