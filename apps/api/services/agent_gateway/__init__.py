"""PatelRep Agent Harness -- Phase H2: the Tool Gateway.

The ONLY path through which an agent may read or change PatelRep business data. A model-generated plan (H3+) never
holds a database client, a service-role credential, a router, an integration client, a callable, a shell, a URL or a
file path: it can only name an exact (tool_id, version) that this package binds to a reviewed server operation.

  schema.py         strict JSON-schema subset, canonical form, nested identity-claim refusal, size bounds
  catalog.py        the reviewed H2 ToolSpecs + the dispatch-assistant AgentSpec (frozen H0 registries)
  bindings.py       exact (tool_id, version) -> trusted operation; frozen; no dynamic import, no fallback
  adapters.py       tenant-filtered resource resolution and minimal, sanitized read operations
  output.py         redaction, output schema, byte and item limits; output is data, never instructions
  authorization.py  the layered execution boundary (code, APP_ENV, env switch, DB switch, controls) -> H0 inputs
  gateway.py        prepare (validate + resolve + digest) and decide (H0 policy.evaluate)
  admission.py      a verified user admits a one-invocation durable run
  approvals.py      human approval interface (verified CurrentUser; authority re-read in the database)
  grants.py         per-property agent x tool enablement (current GM only)
  steps.py          worker step executor (fenced; replay-safe; approval wait; atomic write RPC)
  store.py          typed wrapper over the agent_tool_* RPCs (migration 243)

Execution is OFF by default at every layer and refused in production in H2. See docs/agent-harness/tool-gateway.md.
"""

HARNESS_PHASE = "H2"
