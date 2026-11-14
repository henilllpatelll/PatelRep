"""H2 human approval lifecycle and the approved work-order assignment, against the REAL database, pgmq and worker."""
from __future__ import annotations

import pytest

from agent_execution_support import requires_db
from agent_gateway_support import (
    ASSIGN,
    admit,
    approval_for,
    assign_args,
    assigned_to,
    audit_rows,
    drain_run,
    gateway_worker,
    gstore,
    make_gateway_hotel,
    messages_for,
    reset_gateway_state,
    run_row,
    run_sql,
    sql_value,
    tool_events,
)
from services.agent_gateway import approvals
from services.agent_gateway.errors import GatewayRefused

pytestmark = requires_db


@pytest.fixture(autouse=True)
def _clean():
    reset_gateway_state()
    yield
    reset_gateway_state()


def to_waiting(hotel, **args):
    admitted = admit(hotel, ASSIGN, assign_args(hotel, **args))
    assert admitted.requires_approval
    assert drain_run(gateway_worker(), admitted.run_id) == ["awaiting_approval"]
    return admitted, approval_for(hotel, admitted.run_id)


def refused(fn) -> str:
    with pytest.raises(GatewayRefused) as err:
        fn()
    return err.value.code


def test_approved_assignment_end_to_end():
    hotel = make_gateway_hotel()
    admitted, approval = to_waiting(hotel, note="closest to 2nd floor")
    run = run_row(hotel.tenant_id, admitted.run_id)
    # the wait holds no lease, no queue message, and consumed no attempt
    assert run["state"] == "awaiting_approval" and run["lease_owner"] is None and run["attempt_count"] == 0
    assert messages_for(admitted.run_id) == 0 and assigned_to(hotel.work_order) == ""
    assert approval["state"] == "requested" and approval["required_approver_roles"] == ["chief_engineer", "gm"]

    gm = hotel.user(hotel.gm, "gm")
    assert [a["id"] for a in approvals.list_pending(gstore(), gm)] == [approval["id"]]
    decided = approvals.approve(gstore(), gm, approval["id"])
    assert decided["state"] == "approved" and decided["run_state"] == "queued" and messages_for(admitted.run_id) == 1

    assert drain_run(gateway_worker(), admitted.run_id)[0] == "run_succeeded"
    assert assigned_to(hotel.work_order) == hotel.engineer_a
    audit = sql_value(f"SELECT actor_id || '|' || actor_role || '|' || source || '|' || reason_code || '|' || reason_note "
                      f"FROM public.operational_audit_events WHERE resource_id = '{hotel.work_order}';")
    assert audit == f"{hotel.gm}|gm|automation|agent_harness_approved|closest to 2nd floor"
    execution = sql_value(f"SELECT state || '|' || (approval_id = '{approval['id']}')::text FROM public.agent_tool_executions "
                          f"WHERE run_id = '{admitted.run_id}';")
    assert execution == "succeeded|true"
    assert approval_for(hotel, admitted.run_id)["consumed_at"] is not None
    assert [e["event_type"] for e in tool_events(hotel, admitted.run_id)] == [
        "invocation_admitted", "approval_requested", "approval_approved", "approval_resumed", "execution_succeeded"]


def test_initiator_cannot_self_approve_under_the_independent_policy():
    hotel = make_gateway_hotel()
    admitted, approval = to_waiting(hotel)
    assert refused(lambda: approvals.approve(gstore(), hotel.user(hotel.chief, "chief_engineer"), approval["id"])) \
        == "self_approval_forbidden"
    assert approval_for(hotel, admitted.run_id)["state"] == "requested"


@pytest.mark.parametrize("label, role", [("engineer_a", "engineer"), ("housekeeper", "housekeeper"),
                                         ("supervisor", "housekeeping_supervisor")])
def test_unauthorized_approvers_are_refused(label, role):
    hotel = make_gateway_hotel()
    _, approval = to_waiting(hotel)
    assert refused(lambda: approvals.approve(gstore(), hotel.user(getattr(hotel, label), role), approval["id"])) \
        == "approver_not_authorized"


def test_a_role_claimed_in_the_request_is_never_trusted_by_the_database():
    hotel = make_gateway_hotel()
    _, approval = to_waiting(hotel)
    forged = hotel.user(hotel.engineer_a, "gm")  # a stale/forged role on the in-process user object
    assert refused(lambda: approvals.approve(gstore(), forged, approval["id"])) == "approver_not_authorized"


def test_approval_from_another_hotel_is_not_found():
    hotel, other = make_gateway_hotel(), make_gateway_hotel()
    _, approval = to_waiting(hotel)
    assert refused(lambda: approvals.approve(gstore(), other.user(other.gm, "gm"), approval["id"])) == "not_found"


def test_rejection_ends_the_run_without_side_effects():
    hotel = make_gateway_hotel()
    admitted, approval = to_waiting(hotel)
    result = approvals.reject(gstore(), hotel.user(hotel.gm, "gm"), approval["id"], reason_code="wrong_engineer")
    assert result["run_state"] == "failed"
    run = run_row(hotel.tenant_id, admitted.run_id)
    assert run["last_error_code"] == "approval_rejected" and messages_for(admitted.run_id) == 0
    assert assigned_to(hotel.work_order) == "" and audit_rows(hotel.work_order) == 0


def test_an_approval_is_decided_once_and_resumes_the_run_once():
    hotel = make_gateway_hotel()
    admitted, approval = to_waiting(hotel)
    gm = hotel.user(hotel.gm, "gm")
    approvals.approve(gstore(), gm, approval["id"])
    assert refused(lambda: approvals.approve(gstore(), gm, approval["id"])) == "not_pending"
    assert refused(lambda: approvals.reject(gstore(), gm, approval["id"])) == "not_pending"
    assert messages_for(admitted.run_id) == 1


def test_revoked_approval_cannot_be_used():
    hotel = make_gateway_hotel()
    admitted, approval = to_waiting(hotel)
    gm = hotel.user(hotel.gm, "gm")
    approvals.approve(gstore(), gm, approval["id"])
    revoked = approvals.revoke(gstore(), gm, approval["id"], reason_code="changed_mind")
    assert revoked["run_state"] == "failed" and messages_for(admitted.run_id) == 0
    assert run_row(hotel.tenant_id, admitted.run_id)["last_error_code"] == "approval_revoked"
    assert assigned_to(hotel.work_order) == ""


def test_initiator_may_withdraw_a_pending_request():
    hotel = make_gateway_hotel()
    admitted, approval = to_waiting(hotel)
    approvals.revoke(gstore(), hotel.user(hotel.chief, "chief_engineer"), approval["id"])
    assert run_row(hotel.tenant_id, admitted.run_id)["state"] == "failed"


def test_expired_approval_is_swept_and_ends_the_waiting_run():
    hotel = make_gateway_hotel()
    admitted, approval = to_waiting(hotel)
    run_sql("ALTER TABLE public.agent_tool_approvals DISABLE TRIGGER agent_tool_approvals_guard_update;"
            f"UPDATE public.agent_tool_approvals SET created_at = now() - interval '2 hours', "
            f"expires_at = now() - interval '1 second' WHERE id = '{approval['id']}';"
            "ALTER TABLE public.agent_tool_approvals ENABLE TRIGGER agent_tool_approvals_guard_update;")
    assert refused(lambda: approvals.approve(gstore(), hotel.user(hotel.gm, "gm"), approval["id"])) == "expired"
    assert approval_for(hotel, admitted.run_id)["state"] == "expired"
    assert run_row(hotel.tenant_id, admitted.run_id)["last_error_code"] == "approval_expired"


def test_approver_demoted_after_approval_cannot_authorize_execution():
    hotel = make_gateway_hotel()
    admitted, approval = to_waiting(hotel)
    approvals.approve(gstore(), hotel.user(hotel.gm, "gm"), approval["id"])
    run_sql(f"UPDATE public.user_roles SET role = 'front_desk' WHERE user_id = '{hotel.gm}' "
            f"AND tenant_id = '{hotel.tenant_id}';")
    assert drain_run(gateway_worker(), admitted.run_id)[0] == "run_failed"
    assert run_row(hotel.tenant_id, admitted.run_id)["last_error_code"] == "approver_not_authorized"
    assert assigned_to(hotel.work_order) == "" and audit_rows(hotel.work_order) == 0


def test_initiator_deactivated_while_waiting_cannot_execute():
    hotel = make_gateway_hotel()
    admitted, approval = to_waiting(hotel)
    approvals.approve(gstore(), hotel.user(hotel.gm, "gm"), approval["id"])
    run_sql(f"UPDATE public.user_roles SET is_active = false WHERE user_id = '{hotel.chief}';")
    assert drain_run(gateway_worker(), admitted.run_id)[0] == "run_failed"
    assert assigned_to(hotel.work_order) == ""


def test_resource_changed_after_approval_fails_without_overwriting():
    hotel = make_gateway_hotel()
    admitted, approval = to_waiting(hotel)  # expected_assigned_to = None
    approvals.approve(gstore(), hotel.user(hotel.gm, "gm"), approval["id"])
    run_sql(f"UPDATE public.work_orders SET assigned_to = '{hotel.engineer_b}' WHERE id = '{hotel.work_order}';")
    assert drain_run(gateway_worker(), admitted.run_id)[0] == "run_failed"
    assert run_row(hotel.tenant_id, admitted.run_id)["last_error_code"] == "resource_changed"
    assert assigned_to(hotel.work_order) == hotel.engineer_b
    assert sql_value(f"SELECT state || '|' || error_code FROM public.agent_tool_executions "
                     f"WHERE run_id = '{admitted.run_id}';") == "failed|resource_changed"


def test_ineligible_assignee_is_refused_at_admission_time_resolution_and_execution():
    hotel = make_gateway_hotel()
    admitted, approval = to_waiting(hotel, to=None)
    approvals.approve(gstore(), hotel.user(hotel.gm, "gm"), approval["id"])
    run_sql(f"UPDATE public.user_roles SET is_active = false WHERE user_id = '{hotel.engineer_a}';")
    assert drain_run(gateway_worker(), admitted.run_id)[0] == "run_failed"
    assert run_row(hotel.tenant_id, admitted.run_id)["last_error_code"] == "assignee_not_eligible"


def test_forged_approval_rows_are_refused():
    hotel = make_gateway_hotel()
    admitted, approval = to_waiting(hotel)
    # an approval can never be created already approved
    with pytest.raises(AssertionError):
        run_sql(f"INSERT INTO public.agent_tool_approvals (tenant_id, run_id, invocation_id, agent_id, agent_version, "
                f"tool_id, tool_version, resource_type, resource_id, action_digest, initiated_by_user_id, "
                f"approval_policy_id, approver_may_be_initiator, required_approver_roles, expires_at, state, "
                f"decided_by_user_id, decided_role, decided_at) SELECT tenant_id, run_id, invocation_id, agent_id, "
                f"agent_version, tool_id, tool_version, resource_type, resource_id, action_digest, initiated_by_user_id, "
                f"approval_policy_id, approver_may_be_initiator, required_approver_roles, expires_at, 'approved', "
                f"'{hotel.gm}', 'gm', now() FROM public.agent_tool_approvals WHERE id = '{approval['id']}';")
    # a direct service-role UPDATE naming an unauthorized "approver" is caught by the execution-time authority check
    run_sql(f"UPDATE public.agent_tool_approvals SET state = 'approved', decided_by_user_id = '{hotel.engineer_b}', "
            f"decided_role = 'gm', decided_at = now() WHERE id = '{approval['id']}';")
    run_sql(f"UPDATE public.agent_runs SET state = 'queued' WHERE id = '{admitted.run_id}';"
            f"SELECT public.agent__dispatch('{admitted.run_id}', 0);")
    assert drain_run(gateway_worker(), admitted.run_id)[0] == "run_failed"
    assert assigned_to(hotel.work_order) == ""


def test_an_approval_binding_cannot_be_rewritten():
    hotel = make_gateway_hotel()
    _, approval = to_waiting(hotel)
    for column, value in (("action_digest", "'" + "e" * 64 + "'"), ("tool_version", "3"),
                          ("initiated_by_user_id", f"'{hotel.gm}'"), ("tenant_id", "gen_random_uuid()")):
        with pytest.raises(AssertionError):
            run_sql(f"UPDATE public.agent_tool_approvals SET {column} = {value} WHERE id = '{approval['id']}';")


def test_cancel_while_waiting_ends_the_run_and_closes_the_approval():
    hotel = make_gateway_hotel()
    admitted, approval = to_waiting(hotel)
    from agent_execution_support import store
    assert store().request_cancel(tenant_id=hotel.tenant_id, run_id=admitted.run_id, requested_by="user:x")["outcome"] \
        == "cancelled"
    assert refused(lambda: approvals.approve(gstore(), hotel.user(hotel.gm, "gm"), approval["id"])) == "run_terminal"
    assert approval_for(hotel, admitted.run_id)["state"] == "revoked"
