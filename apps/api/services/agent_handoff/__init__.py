"""PatelRep Agent Harness -- Phase H5: the bridge between H3 plans and the H2 Tool Gateway (ADR-0004).

This is the ONLY package allowed to import both the orchestrator and the gateway. It holds no authority of its own:

  store.py             typed wrapper over the handoff / planning-review RPCs (migration 252)
  handoff.py           a VERIFIED initiator submits ONE validated proposal; it is re-checked against fresh facts,
                       re-authorized by the gateway and persisted atomically with its gateway invocation
  context_provider.py  adapts the gateway's verified-context gatherer to the planning step (worker only)
  notifier.py          best-effort post-commit staff push for a newly committed approved write (worker only)
  preview.py           the role-restricted recommendation preview the API returns

A model never reaches this package: plans are read from the database, every identity comes from a verified
``CurrentUser`` (or the worker's authoritative reload), and approval stays with the H2 approval state machine.
"""

HARNESS_PHASE = "H5"
PROPOSAL_TTL_SECONDS = 900
