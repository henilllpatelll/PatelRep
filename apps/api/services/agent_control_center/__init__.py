"""Agent Harness H6: the AI Control Center service layer (ADR-0005). The ONLY agent package ``routers/agent_control_center.py`` imports.

It adds visibility and human governance on top of H0-H5 and re-implements none of them:

  access.py    who is asking: the session's user + hotel, re-validated against CURRENT membership and role on every
               request (H1 ``SupabaseIdentityAuthority``), and which sections that role may see
  catalog.py   the reviewed agent / tool directory, straight from the H2/H5 registries (exact versions)
  store.py     the migration-256 read models and controls, plus the H1/H2/H3 RPCs it reuses
  service.py   overview, agents, activity, approvals (H2 ``approvals`` service for every decision), controls (H1 hotel
               pause, H2 grant revocation), audit

Nothing here can enable execution, paid calls, customer billing or an autonomy level: there is no code path that
writes ``agent_execution_enablement``, ``agent_model_enablement``, ``agent_customer_billing_controls``, a grant with
``p_revoke = false`` or a hotel/platform switch to "on". Approving an action additionally requires the gateway's own
process gate (``AGENT_GATEWAY_EXECUTION_ENABLED`` + a non-production ``APP_ENV``); reject, withdraw, pause, cancel
and revoke only ever restrict.
"""
