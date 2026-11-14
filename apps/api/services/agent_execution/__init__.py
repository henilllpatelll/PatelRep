"""PatelRep Agent Harness -- Phase H1: durable execution infrastructure.

PostgreSQL is the authoritative execution state (migrations 238-240); pgmq is durable delivery only. This package is
the runtime around those database functions and stays subordinate to the H0 contracts in ``services.agent_harness``:

  states.py              run/step lifecycle vocabulary (mirrors the database transition tables)
  retry.py               error classification and bounded exponential backoff with jitter
  synthetic.py           the CLOSED synthetic operation catalog -- the only work H1 can execute
  identity_authority.py  H0 ``IdentityAuthority`` over user_roles / user_profiles / tenants
  controls_store.py      runtime controls (pauses, cost emergency stop) loaded from the database
  store.py               typed wrapper over the agent_* RPCs (the only database access path)
  admission.py           synthetic run admission (environment-gated; normal agent admission stays disabled)
  operations.py          tenant-scoped status, events, cancel / pause / resume
  config.py              worker settings (disabled by default)
  worker.py              the dedicated worker process loop
  __main__.py            ``python -m services.agent_execution`` entry point (worker and operator commands)

H1 does NOT execute agents, tools or models: ``H0_EXECUTION_SUPPORTED`` stays False, every non-synthetic run is refused
through ``require_execution_supported()``, and the database admits only the synthetic probe agent.
"""

HARNESS_PHASE = "H1"
SYNTHETIC_AGENT_ID = "harness.synthetic"
SYNTHETIC_AGENT_VERSION = 1
