"""PatelRep Agent Harness -- Phase H0: security and compatibility contracts only.

This package defines validated contracts (agent manifests, tool contracts, trusted identity, default-deny policy,
autonomy, metering) that H1+ will build durable execution, tool dispatch and orchestration on. It deliberately
contains NO executor, dispatcher, model call, queue, worker, scheduler hook, database access or route.

Blanket agent execution is disabled: ``controls.H0_EXECUTION_SUPPORTED`` stays False and every runtime-control
snapshot from this package defaults to platform execution off. Since H2 an ``AuthorizationDecision`` can authorize
execution ONLY for an ``allow`` on a tool version in the exact reviewed set ``controls.H2_EXECUTABLE_TOOLS``; the Tool
Gateway (services/agent_gateway) is the only executor and this package still contains no dispatcher.

Module map:
  vocabulary.py  closed enums, capability catalog, explicit capability->role grants (no numeric rank)
  tools.py       ToolSpec / ToolRef / ToolRegistry
  agents.py      AgentSpec / ExecutionLimits / AgentRegistry
  identity.py    TrustedExecutionContext and its trusted factories
  controls.py    H0 execution ceiling, runtime controls, tenant capability snapshot
  autonomy.py    autonomy levels, grants, approval policies, human-authority rules
  policy.py      evaluate(): allow / deny / requires_approval with stable reason codes
  metering.py    provider cost vs customer credits vs execution budgets (Decimal only)
  examples.py    non-executable example tools and a disabled example agent

See docs/agent-harness/ for architecture, security model, contracts and roadmap.
"""

HARNESS_PHASE = "H0"
