"""H6 Stage 2: the worker's least-privileged database identity, proven with the ACTUAL restricted principal.

Every request below that is made through ``worker_client`` / ``raw_worker_client`` travels Kong -> PostgREST ->
PostgreSQL as the role ``agent_worker`` with a real, registered (or deliberately unregistered/revoked) JWT. Raw SQL
(``SET LOCAL ROLE agent_worker``) is used only for statements PostgREST cannot express (TRUNCATE, direct DML), always
inside a transaction that rolls back.
"""
from __future__ import annotations

import uuid

import pytest

from agent_execution_support import admit, make_hotel, requires_db, reset_execution_state, store
from agent_gateway_support import (
    ASSIGN,
    admit as admit_tool,
    approval_for,
    assign_args,
    assigned_to,
    gstore,
    make_gateway_hotel,
    messages_for,
    reset_gateway_state,
    run_row,
    run_sql,
    sql_value,
    tool_events,
)
from agent_worker_identity_support import (
    default_tenant,
    denied,
    issue_token,
    raw_worker_client,
    restricted_process,
    restricted_worker,
    revoke,
    unregistered_token,
    worker_client,
)
from batch_support import new_client
from services.agent_execution.worker_identity import WORKER_READ_COLUMNS, WORKER_RPCS, WorkerIdentityError, bound_worker_id
from services.agent_gateway import approvals

pytestmark = requires_db
INSUFFICIENT_PRIVILEGE = "42501"
X = str(uuid.UUID(int=1))


@pytest.fixture(autouse=True)
def _clean():
    reset_gateway_state()
    yield
    reset_gateway_state()


def _sql_as_worker(statement: str) -> str:
    """Run one statement as agent_worker in a rolled-back transaction; return psql's error text ('' = it ran)."""
    try:
        run_sql(f"BEGIN; SET LOCAL ROLE agent_worker; {statement}; ROLLBACK;")
    except AssertionError as exc:
        return str(exc)
    return ""


# ---------------------------------------------------------------- the reviewed contract, verified in the database
def test_the_database_reports_no_privilege_beyond_the_reviewed_contract():
    assert sql_value("SELECT count(*) FROM public.agent_worker_privilege_violations();") == "0"
    attrs = sql_value("SELECT rolcanlogin || '|' || rolinherit || '|' || rolbypassrls || '|' || rolsuper "
                      "FROM pg_roles WHERE rolname = 'agent_worker';")
    assert attrs == "false|false|false|false"
    assert sql_value("SELECT count(*) FROM pg_auth_members WHERE member = 'agent_worker'::regrole;") == "0"
    assert sql_value("SELECT pg_has_role('agent_worker', 'service_role', 'MEMBER')::text;") == "false"
    assert sql_value("SELECT count(*) FROM pg_class c WHERE c.relname LIKE 'agent%' AND c.relkind = 'r' "
                     "AND pg_get_userbyid(c.relowner) = 'agent_worker';") == "0"
    rpcs = sql_value("SELECT string_agg(r, ',' ORDER BY r) FROM public.agent__worker_allowed_rpcs() r;")
    assert set(rpcs.split(",")) == set(WORKER_RPCS)
    cols = run_sql("\\pset tuples_only on\n\\pset format unaligned\n"
                   "SELECT table_name || '.' || column_name FROM public.agent__worker_read_columns();").split()
    assert set(cols) == {f"{t}.{c}" for t, cs in WORKER_READ_COLUMNS.items() for c in cs}


# ---------------------------------------------------------------- legitimate paths still work under the restricted role
def test_a_synthetic_run_completes_under_the_restricted_principal():
    reset_execution_state()
    tenant_id, _ = make_hotel(new_client())
    admitted = admit(store(), tenant_id, spec={"operation": "noop", "steps": 2})
    w, s = restricted_worker("it-h6-synth", tenant_id=tenant_id, synthetic=True)
    outcomes = [restricted_process(w, s) for _ in range(4)]
    assert "run_succeeded" in outcomes, outcomes
    assert store().get_run(tenant_id=tenant_id, run_id=admitted["run_id"])["run"]["state"] == "succeeded"


def test_an_approved_assignment_runs_end_to_end_under_the_restricted_principal():
    hotel = make_gateway_hotel()
    admitted = admit_tool(hotel, ASSIGN, assign_args(hotel, note="h6 restricted worker"))
    w, s = restricted_worker("it-h6-gw", tenant_id=hotel.tenant_id, gateway=True)
    assert restricted_process(w, s) == "awaiting_approval"
    approval = approval_for(hotel, admitted.run_id)
    # The worker requested the approval but can never decide it; a different, current GM decides through the API path.
    decided = approvals.approve(gstore(), hotel.user(hotel.gm, "gm"), approval["id"])
    assert decided["state"] == "approved" and messages_for(admitted.run_id) == 1
    assert restricted_process(w, s) == "run_succeeded"
    assert assigned_to(hotel.work_order) == hotel.engineer_a
    assert [e["event_type"] for e in tool_events(hotel, admitted.run_id)] == [
        "invocation_admitted", "approval_requested", "approval_approved", "approval_resumed", "execution_succeeded"]
    # the worker's heartbeat / liveness rows were written through the wrappers, never by direct DML
    assert run_row(hotel.tenant_id, admitted.run_id)["state"] == "succeeded"


# ---------------------------------------------------------------- human decisions, controls and admissions are denied
DENIED_RPCS = {
    "agent_tool_approval_decide": {"p_tenant_id": X, "p_approval_id": X, "p_actor_user_id": X, "p_decision": "approve",
                                   "p_reason_code": None},
    "agent_tool_approval_revoke": {"p_tenant_id": X, "p_approval_id": X, "p_actor_user_id": X, "p_reason_code": None},
    "agent_tool_grant_set": {"p_tenant_id": X, "p_actor_user_id": X, "p_agent_id": "a", "p_agent_version": 1,
                             "p_tool_id": "t", "p_tool_version": 1, "p_max_level": 1},
    "agent_execution_enablement_set": {"p_enabled": True, "p_updated_by": "w", "p_reason_code": None},
    "agent_tool_control_set": {"p_tool_id": "t", "p_paused": False, "p_updated_by": "w", "p_reason_code": None},
    "agent_model_enablement_set": {"p_enabled": True, "p_updated_by": "w", "p_reason": None},
    "agent_runtime_control_set": {"p_scope": "platform", "p_tenant_id": None, "p_agent_id": None, "p_paused": False,
                                  "p_cost_emergency_stop": False, "p_updated_by": "w", "p_reason_code": None},
    "agent_run_request_cancel": {"p_tenant_id": X, "p_run_id": X, "p_requested_by": "w"},
    "agent_run_resume": {"p_tenant_id": X, "p_run_id": X, "p_requested_by": "w"},
    "agent_run_claim": {"p_worker": "w"},  # even an ALLOWED operation is refused when called without its wrapper
    "agent_worker_credential_register": {"p_id": X, "p_label": "self", "p_app_env": "test",
                                         "p_expires_at": "2030-01-01T00:00:00Z", "p_issued_by": "w"},
    "agent_worker_credential_register_v2": {"p_id": X, "p_label": "self", "p_app_env": "test",
                                            "p_expires_at": "2030-01-01T00:00:00Z", "p_issued_by": "w", "p_tenant_id": X},
    "agent_audit_privileges_enforce": {},
    "work_order_assign_apply": {"p_tenant_id": X, "p_work_order_id": X, "p_assignee_user_id": X,
                                "p_expected_assigned_to": None, "p_actor_id": X, "p_actor_role": "gm",
                                "p_reason_note": None, "p_reason_code": None, "p_source": "automation"},
    "publish_assignment_batch": {"p_tenant_id": X, "p_actor_id": X, "p_operation_id": X, "p_date": "2026-01-01",
                                 "p_changes": []},
}


@pytest.mark.parametrize("rpc", sorted(DENIED_RPCS))
def test_the_database_refuses_every_unreviewed_rpc_for_the_worker(rpc):
    raw = raw_worker_client()
    code = denied(lambda: raw.rpc(rpc, DENIED_RPCS[rpc]).execute())
    assert code == INSUFFICIENT_PRIVILEGE, (rpc, code)  # PostgreSQL itself refuses EXECUTE
    if rpc not in WORKER_RPCS:  # allowed operations are reachable only through their wrapper (proven above)
        with pytest.raises(WorkerIdentityError):
            worker_client().rpc(rpc, DENIED_RPCS[rpc])  # and the in-process allowlist refuses before any request


def test_a_real_pending_approval_cannot_be_decided_with_worker_credentials():
    hotel = make_gateway_hotel()
    admitted = admit_tool(hotel, ASSIGN, assign_args(hotel))
    w, s = restricted_worker("it-h6-decide", tenant_id=hotel.tenant_id, gateway=True)
    assert restricted_process(w, s) == "awaiting_approval"
    approval = approval_for(hotel, admitted.run_id)
    raw = raw_worker_client(tenant_id=hotel.tenant_id)
    for name in ("agent_worker_rpc__agent_tool_approval_decide", "agent_tool_approval_decide"):
        code = denied(lambda n=name: raw.rpc(n, {"p_tenant_id": hotel.tenant_id, "p_approval_id": approval["id"],
                                                 "p_actor_user_id": hotel.gm, "p_decision": "approve",
                                                 "p_reason_code": None}).execute())
        assert code in (INSUFFICIENT_PRIVILEGE, "PGRST202")
    assert approval_for(hotel, admitted.run_id)["state"] == "requested"


def test_fabricated_success_and_unapproved_execution_are_refused_for_the_worker():
    hotel = make_gateway_hotel()
    admitted = admit_tool(hotel, ASSIGN, assign_args(hotel))
    w, s = restricted_worker("it-h6-forge", tenant_id=hotel.tenant_id, gateway=True)
    assert restricted_process(w, s) == "awaiting_approval"
    approval = approval_for(hotel, admitted.run_id)
    run = run_row(hotel.tenant_id, admitted.run_id)
    client = worker_client(tenant_id=hotel.tenant_id)
    common = {"p_run_id": admitted.run_id, "p_fencing_token": run["fencing_token"] or 0,
              "p_worker": bound_worker_id(hotel.tenant_id, "it-h6-forge"),
              "p_invocation_id": approval["invocation_id"]}
    executed = client.rpc("agent_tool_execute_work_order_assign",
                          {**common, "p_action_digest": approval["action_digest"]}).execute().data
    assert executed.get("ok") is not True
    recorded = client.rpc("agent_tool_record_outcome", {**common, "p_state": "succeeded", "p_result": {}}).execute().data
    assert recorded.get("ok") is not True
    assert assigned_to(hotel.work_order) == ""
    assert sql_value(f"SELECT count(*) FROM public.agent_tool_executions WHERE run_id = '{admitted.run_id}';") == "0"


# ---------------------------------------------------------------- no direct writes, no audit tampering
DIRECT_WRITES = [
    ("agent_tool_approvals", "insert", {"tenant_id": X, "state": "approved"}),
    ("agent_tool_executions", "insert", {"tenant_id": X, "state": "succeeded"}),
    ("agent_tool_events", "insert", {"tenant_id": X, "event_type": "execution_succeeded"}),
    ("agent_run_events", "insert", {"tenant_id": X, "event_type": "succeeded"}),
    ("agent_control_center_events", "insert", {"tenant_id": X, "event_type": "hotel_paused"}),
    ("agent_runtime_controls", "update", {"paused": False}),
    ("agent_worker_credentials", "insert", {"id": X, "label": "self-issued"}),
    ("agent_worker_credential_scopes", "insert", {"credential_id": X, "tenant_id": X}),
    ("agent_deployment_identity", "insert", {"id": 1, "environment": "staging"}),
    ("operational_audit_events", "insert", {"tenant_id": X}),
    ("work_orders", "update", {"assigned_to": X}),
    ("room_assignments", "insert", {"tenant_id": X}),
    ("tenant_feature_flags", "insert", {"tenant_id": X, "feature_key": "ai_agents", "enabled": True}),
]


@pytest.mark.parametrize("table,verb,row", DIRECT_WRITES, ids=[f"{t}-{v}" for t, v, _ in DIRECT_WRITES])
def test_the_worker_cannot_write_any_table_directly(table, verb, row):
    raw = raw_worker_client()
    query = raw.table(table).insert(row) if verb == "insert" else raw.table(table).update(row).eq("tenant_id", X)
    assert denied(lambda: query.execute()) == INSUFFICIENT_PRIVILEGE


@pytest.mark.parametrize("statement", [
    "TRUNCATE public.agent_tool_events",
    "TRUNCATE public.agent_run_events CASCADE",
    "TRUNCATE public.agent_control_center_events",
    "DELETE FROM public.agent_tool_approvals",
    "UPDATE public.agent_tool_approvals SET state = 'approved'",
    "INSERT INTO public.agent_tool_events (tenant_id, event_type) VALUES ('00000000-0000-0000-0000-000000000001', 'x')",
    "UPDATE public.work_orders SET assigned_to = NULL",
    "SELECT public.agent_tool_approval_decide('00000000-0000-0000-0000-000000000001', "
    "'00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'approve', NULL)",
    "SELECT public.agent_audit_privileges_enforce()",
])
def test_sql_as_the_worker_role_cannot_tamper_with_audit_or_business_state(statement):
    assert "permission denied" in _sql_as_worker(statement)


def test_the_worker_reads_only_reviewed_columns():
    raw = raw_worker_client()
    assert raw.table("tenants").select("id, is_active, timezone").limit(1).execute().data is not None
    for table, columns in (("room_status", "guest_name"), ("work_orders", "description"), ("user_profiles", "full_name"),
                           ("tenants", "name"), ("agent_tool_approvals", "id"), ("agent_runs", "id"),
                           ("stripe_customers", "id")):
        assert denied(lambda t=table, c=columns: raw.table(t).select(c).limit(1).execute()) in (
            INSUFFICIENT_PRIVILEGE, "42P01", "PGRST205")


# ---------------------------------------------------------------- credential lifecycle
def test_unregistered_revoked_and_foreign_role_tokens_are_refused():
    snapshot = "agent_worker_rpc__agent_runtime_controls_snapshot"
    credential, token = issue_token("it-lifecycle")
    raw = raw_worker_client(token)
    assert isinstance(raw.rpc(snapshot, {}).execute().data, list)
    assert raw.table("tenants").select("id").limit(1).execute().data  # policy satisfied while active

    revoke(credential)
    assert "agent_worker_credential_invalid" in str(pytest.raises(Exception, raw.rpc(snapshot, {}).execute).value)
    assert raw.table("tenants").select("id").limit(1).execute().data == []  # rows hidden once revoked

    unregistered = worker_client(unregistered_token())._inner  # noqa: SLF001
    assert "agent_worker_credential_invalid" in str(pytest.raises(Exception, unregistered.rpc(snapshot, {}).execute).value)
    with pytest.raises(WorkerIdentityError):
        worker_client(unregistered_token(role="service_role"))
    with pytest.raises(WorkerIdentityError):
        worker_client(unregistered_token(hours=24 * 40))


def test_a_revoked_credential_cannot_be_reactivated_or_deleted():
    credential, _ = issue_token("it-final")
    revoke(credential)
    assert revoke(credential)["ok"] is False
    for statement in (f"UPDATE public.agent_worker_credentials SET revoked_at = NULL, revoked_by = NULL WHERE id = '{credential}'",
                      f"DELETE FROM public.agent_worker_credentials WHERE id = '{credential}'",
                      f"UPDATE public.agent_worker_credentials SET expires_at = expires_at + interval '1 day' WHERE id = '{credential}'"):
        with pytest.raises(AssertionError):
            run_sql(statement)
    # 257 fixture change: the unbound 255 path now refuses outright; the P1 7-day ceiling is enforced on the bound path
    # (the registration RPC refuses before inserting; the 255 31-day CHECK and the 257 insert trigger stay underneath).
    legacy = new_client().rpc("agent_worker_credential_register", {
        "p_id": str(uuid.uuid4()), "p_label": "unbound", "p_app_env": "test",
        "p_expires_at": "2030-01-01T00:00:00Z", "p_issued_by": "it"}).execute().data
    assert legacy == {"ok": False, "reason": "tenant_binding_required"}
    over = new_client().rpc("agent_worker_credential_register_v2", {
        "p_id": str(uuid.uuid4()), "p_label": "too-long", "p_app_env": "test",
        "p_expires_at": "2099-01-01T00:00:00Z", "p_issued_by": "it", "p_tenant_id": default_tenant()})
    assert over.execute().data == {"ok": False, "reason": "lifetime_out_of_range"}
