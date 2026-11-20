"""H7 P2: the database-authenticated approval decision (agent_tool_approval_decide_v2, migration 262).

262 ships v2 INACTIVE (no role may execute it). These tests prove that, then exercise its logic over REAL PostgREST with
REAL GoTrue sessions under a test-only grant in the throwaway database (``V2Granted``). The H2 decision path (243) is
untouched and remains the only active one; its own suites (test_agent_gateway_approvals_write.py,
test_agent_approval_independence.py) run unchanged.
"""
from __future__ import annotations

import pytest

from agent_execution_support import requires_db, sql_value
from agent_gateway_support import (
    ASSIGN,
    admit,
    approval_for,
    assign_args,
    drain_run,
    gateway_worker,
    make_gateway_hotel,
    messages_for,
    reset_gateway_state,
    run_row,
    set_platform,
    tool_events,
)
from agent_verified_identity_support import (
    DECIDE_V2,
    Person,
    V2Granted,
    claims_of,
    create_person,
    forged_human,
    refused,
    rpc,
    sign_in,
    sign_out,
)
from batch_support import new_client, run_sql
from core.config import settings

pytestmark = requires_db


@pytest.fixture(autouse=True)
def _clean():
    reset_gateway_state()
    yield
    reset_gateway_state()


def _pending(hotel) -> tuple[str, str]:
    """A chief-engineer-initiated assignment waiting for an independent approver. Returns (run_id, approval_id)."""
    admitted = admit(hotel, ASSIGN, assign_args(hotel))
    assert drain_run(gateway_worker(), admitted.run_id) == ["awaiting_approval"]
    return admitted.run_id, approval_for(hotel, admitted.run_id)["id"]


def _hotel():
    hotel = make_gateway_hotel()
    new_client().table("tenant_feature_flags").insert({"tenant_id": hotel.tenant_id, "feature_key": "ai_control_center",
                                                       "enabled": True, "updated_by": "it"}).execute()
    return hotel


def _signed_in(hotel, role: str, label: str) -> tuple[str, str]:
    person = create_person(hotel.tenant_id, role, label=label)
    return person.user_id, sign_in(person)["access_token"]


def _decide(token, approval_id, decision="approve", **kw):
    return rpc(DECIDE_V2, {"p_approval_id": approval_id, "p_decision": decision, "p_reason_code": None},
               token=token, **kw)


def _state(approval_id: str) -> str:
    return sql_value(f"SELECT state FROM public.agent_tool_approvals WHERE id = '{approval_id}';")


def _ensure_stamp() -> None:
    run_sql("INSERT INTO public.agent_deployment_identity (id, environment, stamped_by) "
            "VALUES (1, 'test', 'it-fixture') ON CONFLICT (id) DO NOTHING;")
    assert sql_value("SELECT environment FROM public.agent_deployment_identity WHERE id = 1;") == "test"


# ---------------------------------------------------------------- inactive as shipped
def test_v2_is_inactive_no_end_user_role_can_execute_it():
    hotel = _hotel()
    _, approval = _pending(hotel)
    _, gm_token = _signed_in(hotel, "gm", "gm-v2-inactive")
    status, body = _decide(gm_token, approval)
    assert status in (401, 403, 404) and refused(status, body), (status, body)
    assert _state(approval) == "requested"
    for role in ("authenticated", "anon", "agent_worker", "public"):
        assert sql_value(f"SELECT has_function_privilege('{role}', "
                         f"'public.agent_tool_approval_decide_v2(uuid,text,text)', 'EXECUTE')::text;") == "false", role


def test_service_role_cannot_decide_through_v2_even_when_it_can_execute_it():
    hotel = _hotel()
    _, approval = _pending(hotel)
    key = settings.supabase_service_role_key
    status, body = _decide(key, approval, api_key=key)
    assert refused(status, body), (status, body)
    if status == 200:  # the CI blanket function grant reaches service_role; the body refuses
        assert body == {"ok": False, "reason": "not_authenticated_role"}
    assert _state(approval) == "requested"


# ---------------------------------------------------------------- the logic, under a test-only grant
def test_a_verified_independent_gm_approves_and_the_run_resumes_once():
    _ensure_stamp()
    hotel = _hotel()
    run_id, approval = _pending(hotel)
    gm_id, gm_token = _signed_in(hotel, "gm", "gm-v2")
    with V2Granted():
        status, body = _decide(gm_token, approval)
    assert status == 200 and body["ok"] is True and body["state"] == "approved" and body["run_state"] == "queued", body
    row = sql_value(f"SELECT decided_by_user_id || '|' || decided_role FROM public.agent_tool_approvals WHERE id = '{approval}';")
    assert row == f"{gm_id}|gm"
    events = [e for e in tool_events(hotel, run_id) if e["event_type"] in ("approval_approved", "approval_resumed")]
    assert [e["event_type"] for e in events] == ["approval_approved", "approval_resumed"]  # no duplicate audit row
    assert all(e["actor_kind"] == "human" and e["actor_ref"] == f"user:{gm_id}" for e in events)
    assert sql_value(f"SELECT detail->>'identity' FROM public.agent_tool_events WHERE approval_id = '{approval}' "
                     "AND event_type = 'approval_approved';") == "database_verified"
    assert messages_for(run_id) == 1
    assert drain_run(gateway_worker(), run_id)[0] == "run_succeeded"  # the unchanged 254 guard accepted it


def test_reject_through_v2_fails_the_run():
    hotel = _hotel()
    run_id, approval = _pending(hotel)
    _, gm_token = _signed_in(hotel, "gm", "gm-v2-reject")
    with V2Granted():
        status, body = _decide(gm_token, approval, "reject")
    assert body["ok"] is True and body["state"] == "rejected" and run_row(hotel.tenant_id, run_id)["state"] == "failed"


def test_the_initiator_can_never_approve_their_own_request():
    _ensure_stamp()
    hotel = _hotel()
    _, approval = _pending(hotel)  # initiated by hotel.chief (chief_engineer, an approver role for this tool)
    # Give the initiator a password we control (admin API) and sign them in for real.
    email = sql_value(f"SELECT email FROM auth.users WHERE id = '{hotel.chief}';")
    new_client().auth.admin.update_user_by_id(hotel.chief, {"password": "Pw-chief-initiator-1a"})
    token = sign_in(Person(user_id=hotel.chief, email=email, password="Pw-chief-initiator-1a"))["access_token"]
    with V2Granted():
        status, body = _decide(token, approval)
    assert body == {"ok": False, "reason": "self_approval_forbidden"}, body
    assert _state(approval) == "requested"


def test_a_role_without_approver_authority_is_refused_and_audited():
    _ensure_stamp()
    hotel = _hotel()
    run_id, approval = _pending(hotel)
    _, hk_token = _signed_in(hotel, "housekeeper", "hk-v2")
    with V2Granted():
        status, body = _decide(hk_token, approval)
    assert body == {"ok": False, "reason": "approver_not_authorized"}
    assert _state(approval) == "requested"
    denied = [e for e in tool_events(hotel, run_id) if e["event_type"] == "policy_denied"]
    assert denied and denied[-1]["reason_code"] == "approver_not_authorized"


def test_a_gm_of_another_hotel_cannot_see_or_decide_the_approval():
    _ensure_stamp()
    hotel, other = _hotel(), _hotel()
    _, approval = _pending(hotel)
    _, other_gm = _signed_in(other, "gm", "gm-v2-other")
    with V2Granted():
        status, body = _decide(other_gm, approval)
    assert body == {"ok": False, "reason": "not_found"}
    assert _state(approval) == "requested"


def test_a_signed_out_or_forged_session_cannot_decide():
    _ensure_stamp()
    hotel = _hotel()
    _, approval = _pending(hotel)
    gm_id, gm_token = _signed_in(hotel, "gm", "gm-v2-out")
    sign_out(gm_token)
    with V2Granted():
        assert _decide(gm_token, approval)[1] == {"ok": False, "reason": "session_not_live"}
        assert _decide(forged_human(gm_id, session_id=None), approval)[1] == {"ok": False, "reason": "session_missing"}
    assert _state(approval) == "requested"


def test_database_gates_hold_even_if_the_api_gate_is_bypassed():
    _ensure_stamp()
    hotel = _hotel()
    _, approval = _pending(hotel)
    _, gm_token = _signed_in(hotel, "gm", "gm-v2-gates")
    with V2Granted():
        set_platform(False)
        try:
            assert _decide(gm_token, approval)[1] == {"ok": False, "reason": "gateway_disabled"}
        finally:
            set_platform(True)
        run_sql(f"UPDATE public.tenant_feature_flags SET enabled = false WHERE tenant_id = '{hotel.tenant_id}' "
                "AND feature_key = 'ai_control_center';")
        assert _decide(gm_token, approval)[1] == {"ok": False, "reason": "feature_disabled"}
        assert _decide(gm_token, approval, "reject")[1] == {"ok": False, "reason": "feature_disabled"}
    assert _state(approval) == "requested"


def test_a_demotion_between_sign_in_and_decision_is_honoured():
    _ensure_stamp()
    hotel = _hotel()
    _, approval = _pending(hotel)
    gm_id, gm_token = _signed_in(hotel, "gm", "gm-v2-demoted")
    run_sql(f"UPDATE public.user_roles SET role = 'engineer' WHERE user_id = '{gm_id}';")
    with V2Granted():
        assert _decide(gm_token, approval)[1] == {"ok": False, "reason": "approver_not_authorized"}
    assert _state(approval) == "requested"
    assert claims_of(gm_token)["role"] == "authenticated"
