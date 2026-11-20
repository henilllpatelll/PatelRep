"""H6 P1 (migration 257): the reviewed textual relation between each global H1-H3 sweep/claim RPC and its tenant-scoped
copy that the agent_worker wrappers call. Each scoped copy is the original body with exactly these substitutions (each
must occur exactly once), so the fencing, lease, approval and spend logic is provably the original code. The originals
are NOT modified: service_role (API, operators, CI) keeps the exact pre-257 behaviour.

Used by tests/integration/test_agent_worker_tenant_binding.py against the live database (pg_proc.prosrc).
"""
from __future__ import annotations

_UUID_RE = r"'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'"

_TENANT_REQUIRED = """  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'agent_worker_tenant_required' USING ERRCODE = '42501';
  END IF;
"""

# original regprocedure -> (scoped function name, [(old, new), ...])
SCOPED_COPIES: dict[str, tuple[str, list[tuple[str, str]]]] = {
    "public.agent_run_claim(text,integer,integer,integer,integer)": ("agent__run_claim_scoped", [(
        "  SELECT * INTO v_msg FROM pgmq.read('patelrep_agent_runs_v1', v_lease + v_margin, 1) LIMIT 1;\n",
        _TENANT_REQUIRED
        + "  -- 257: pgmq.read (1.5) restricted to messages naming a run of the bound hotel: same CTE, FIFO order, SKIP\n"
        + "  -- LOCKED, vt and read_ct semantics. A foreign or unattributable message is never read, locked or delayed.\n"
        + "  WITH cte AS (\n"
        + "    SELECT q.msg_id FROM pgmq.q_patelrep_agent_runs_v1 q\n"
        + "      JOIN public.agent_runs r\n"
        + "        ON r.id = CASE WHEN (q.message->>'run_id') ~ " + _UUID_RE + "\n"
        + "                       THEN (q.message->>'run_id')::uuid END\n"
        + "     WHERE q.vt <= clock_timestamp() AND r.tenant_id = p_tenant_id\n"
        + "     ORDER BY q.msg_id ASC LIMIT 1\n"
        + "     FOR UPDATE OF q SKIP LOCKED)\n"
        + "  UPDATE pgmq.q_patelrep_agent_runs_v1 m\n"
        + "     SET vt = clock_timestamp() + make_interval(secs => v_lease + v_margin), read_ct = m.read_ct + 1\n"
        + "    FROM cte WHERE m.msg_id = cte.msg_id\n"
        + "  RETURNING m.msg_id, m.read_ct, m.enqueued_at, m.vt, m.message, m.headers INTO v_msg;\n",
    )]),
    "public.agent_runs_recover(integer)": ("agent__runs_recover_scoped", [
        ("     WHERE state = 'cancel_requested' AND (lease_expires_at IS NULL OR lease_expires_at <= now())\n",
         "     WHERE tenant_id = p_tenant_id AND state = 'cancel_requested' AND (lease_expires_at IS NULL OR lease_expires_at <= now())\n"),
        ("     WHERE state IN ('queued', 'retry_wait', 'paused', 'running') AND deadline_at <= now()\n",
         "     WHERE tenant_id = p_tenant_id AND state IN ('queued', 'retry_wait', 'paused', 'running') AND deadline_at <= now()\n"),
        ("     WHERE (r.state IN ('queued', 'retry_wait')\n",
         "     WHERE r.tenant_id = p_tenant_id AND (r.state IN ('queued', 'retry_wait')\n"),
        ("BEGIN\n", "BEGIN\n" + _TENANT_REQUIRED),
    ]),
    "public.agent_tool_approvals_expire(integer)": ("agent__tool_approvals_expire_scoped", [
        ("     WHERE a.state IN ('requested', 'approved') AND a.consumed_at IS NULL AND a.expires_at <= now()\n",
         "     WHERE a.tenant_id = p_tenant_id AND a.state IN ('requested', 'approved') AND a.consumed_at IS NULL AND a.expires_at <= now()\n"),
        ("     WHERE a.state IN ('requested', 'approved') AND a.consumed_at IS NULL\n       AND r.state",
         "     WHERE a.tenant_id = p_tenant_id AND a.state IN ('requested', 'approved') AND a.consumed_at IS NULL\n       AND r.state"),
        ("    SELECT * FROM public.agent_runs WHERE state = 'awaiting_approval' AND deadline_at <= now()\n",
         "    SELECT * FROM public.agent_runs WHERE tenant_id = p_tenant_id AND state = 'awaiting_approval' AND deadline_at <= now()\n"),
        ("BEGIN\n", "BEGIN\n" + _TENANT_REQUIRED),
    ]),
    "public.agent_model_attempts_recover(integer,integer)": ("agent__model_attempts_recover_scoped", [
        ("              WHERE state IN ('reserved', 'dispatched') AND reserved_at < now() - v_stale\n",
         "              WHERE tenant_id = p_tenant_id AND state IN ('reserved', 'dispatched') AND reserved_at < now() - v_stale\n"),
        ("BEGIN\n", "BEGIN\n" + _TENANT_REQUIRED),
    ]),
}


def scoped_source(original_src: str, substitutions: list[tuple[str, str]]) -> str:
    """Apply the reviewed substitutions; each `old` must occur exactly once (fails loudly on drift)."""
    out = original_src.replace("\r\n", "\n")
    for old, new in substitutions:
        count = out.count(old)
        if count != 1:
            raise AssertionError(f"substitution anchor occurs {count} times (expected 1): {old[:80]!r}")
        out = out.replace(old, new)
    return out
