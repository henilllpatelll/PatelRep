"""PatelRep Agent Harness -- Phase H3: orchestrator, provider adapters and the provider-spend ledger.

H3 plans; it never acts. A planning run asks a model (through the OpenAI Agents SDK) for a structured plan, validates
it deterministically against server-owned configuration and H2's frozen tool contracts, and records it. Tool proposals
are DATA: nothing here calls the Tool Gateway, an approval RPC or a business operation.

Every potentially paid provider request passes ONE boundary (``boundary.BudgetedCaller``): bounded request -> maximum
exposure from a versioned price schedule -> atomic reservation committed in PostgreSQL -> dispatch marker committed ->
native provider call (no SDK retries) -> settlement from the provider's reported usage. Unknown usage or prices stay
unreconciled with their exposure retained; timeouts after dispatch are uncertain, never "free".

  config.py             default-off process gates (production refused)
  pricebook.py          reviewed, versioned price schedules (sources recorded)
  catalog.py            model catalog, workload classes, routing and fallback rules
  errors.py             closed, sanitized error taxonomy
  providers.py          provider-neutral request/outcome types and dispatch-state classification
  provider_openai.py    native AsyncOpenAI Responses adapter
  provider_anthropic.py native AsyncAnthropic Messages adapter
  providers_factory.py  the ONLY module that reads provider credentials
  budget_store.py       typed wrapper over the agent_model_* ledger RPCs (migration 245)
  boundary.py           BudgetedCaller: the per-attempt reserve -> dispatch -> call -> settle boundary
  sdk_model.py          Agents SDK Model / ModelProvider integration, tracing disabled
  plans.py              strict planning schema + deterministic validation against H2
  planner.py            Planner interface and the Agents SDK planner
  orchestrator.py       agent selection, limits, deadline, validation
  store.py / admission.py / steps.py   H1 planning runs (migration 247) and the worker step
  observability.py      metadata-only structured logging with redaction

Execution is off by default at every layer and refused in production; no worker is deployed by this phase.
"""

HARNESS_PHASE = "H3"
ORCHESTRATOR_AGENT_ID = "harness.orchestrator"
ORCHESTRATOR_AGENT_VERSION = 1
PLANNING_STEP_TYPE = "model_planning"
