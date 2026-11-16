"""H5 Engineering specialist on a real migrated database: verified dispatch recommendation -> submitted proposal ->
independent approval -> the shared work_order_assign_apply. Stale or closed work orders and ineligible technicians fail
closed; nothing changes without both humans."""
from __future__ import annotations

import pytest

from agent_execution_support import requires_db
from agent_specialists_support import (
    ENG,
    change,
    drain,
    draft,
    make_h5_hotel,
    plan_with,
    run_sql,
    sql_value,
    status,
    submit,
    worker,
)
from batch_support import new_client
from services.agent_handoff import handoff as handoffs
from services.agent_handoff.handoff import HandoffRefused
from tests.smoke.agent_orchestrator_support import Transport, openai_ok

pytestmark = requires_db
WO_ASSIGN = ("engineering.work_orders.assign", 2)
DISPATCH = "engineering.work_order_dispatch_recommendation"


@pytest.fixture(autouse=True)
def _clean():
    from agent_specialists_support import reset_all

    reset_all()
    yield


def _assigned(hotel) -> str:
    return sql_value(f"SELECT COALESCE(assigned_to::text, '') FROM public.work_orders WHERE id = '{hotel.work_order}';")


def _propose(hotel, to, *, expected=None, findings=("work_order_unassigned",)):
    args = {"work_order_id": hotel.work_order, "assignee_user_id": to, "expected_assigned_to": expected, "note": None}
    return plan_with(hotel, DISPATCH, hotel.work_order, draft(
        ENG, outcome="propose_change", findings=list(findings), steps=[change(WO_ASSIGN, args)]))


def _gw(calls=None):
    return worker(Transport([openai_ok()]), "it-h5-eng",
                  notifier=(lambda client, committed: calls.append(committed)) if calls is not None else None)


def _human_assign(hotel, to, expected=None):
    new_client().rpc("work_order_assign_apply", {
        "p_tenant_id": hotel.tenant_id, "p_work_order_id": hotel.work_order, "p_assignee_user_id": to,
        "p_expected_assigned_to": expected, "p_actor_id": hotel.gm, "p_actor_role": "gm", "p_reason_note": None,
        "p_reason_code": None, "p_source": "web"}).execute()


def test_dispatch_recommendation_executes_through_the_shared_assignment_after_approval():
    hotel, calls = make_h5_hotel(), []
    run_id, record, _ = _propose(hotel, hotel.engineer_a, findings=["work_order_unassigned", "work_order_high_priority",
                                                                    "assignee_has_lowest_workload"])
    assert record["plan_outcome"] == "proposed", record
    assert _assigned(hotel) == ""
    admission = submit(hotel, run_id)
    drain(_gw(calls), admission.gateway_run_id)
    with pytest.raises(HandoffRefused) as exc:
        handoffs.approve(new_client(), hotel.user(hotel.chief, "chief_engineer"), admission.handoff_id)
    assert exc.value.code == "self_approval_forbidden"
    assert handoffs.approve(new_client(), hotel.user(hotel.gm, "gm"), admission.handoff_id)["ok"]
    drain(_gw(calls), admission.gateway_run_id)
    assert _assigned(hotel) == hotel.engineer_a
    audit = sql_value(f"""SELECT actor_id || '|' || source || '|' || reason_code FROM public.operational_audit_events
                          WHERE resource_id = '{hotel.work_order}' ORDER BY created_at DESC LIMIT 1;""")
    assert audit == f"{hotel.gm}|automation|agent_harness_approved"
    assert [c["tool_id"] for c in calls] == [WO_ASSIGN[0]]
    final = status(hotel, admission.handoff_id, hotel.user(hotel.gm, "gm"))
    assert final["execution"]["state"] == "succeeded"


def test_ineligible_technician_and_closed_work_order_are_refused_before_any_human_sees_them():
    hotel = make_h5_hotel()
    _, record, _ = _propose(hotel, hotel.housekeeper)
    assert record["reason_codes"] == ["assignee_not_verified_eligible"]
    _, record, _ = _propose(hotel, hotel.chief)  # a chief engineer is not an assignable 'engineer'
    assert record["reason_codes"] == ["assignee_not_verified_eligible"]
    run_sql(f"UPDATE public.work_orders SET status = 'completed' WHERE id = '{hotel.work_order}';")
    _, record, _ = _propose(hotel, hotel.engineer_a, findings=["work_order_closed"])
    assert record["reason_codes"] == ["resource_closed"]


def test_stale_expected_assignee_needs_a_new_recommendation():
    hotel = make_h5_hotel()
    run_id, record, _ = _propose(hotel, hotel.engineer_a)
    assert record["plan_outcome"] == "proposed"
    _human_assign(hotel, hotel.engineer_b)  # a manager acted first
    with pytest.raises(HandoffRefused) as exc:
        submit(hotel, run_id)
    assert exc.value.code == "proposal_stale"
    assert _assigned(hotel) == hotel.engineer_b


@pytest.mark.parametrize("change_world, code", [
    (lambda h: _human_assign(h, h.engineer_b), "resource_changed"),
    (lambda h: run_sql(f"UPDATE public.work_orders SET status = 'completed' WHERE id = '{h.work_order}';"),
     "resource_closed"),
    (lambda h: run_sql(f"UPDATE public.user_roles SET is_active = false WHERE user_id = '{h.engineer_a}';"),
     "assignee_not_eligible"),
], ids=["concurrent_manager_change", "closed_after_approval", "technician_deactivated"])
def test_changes_after_approval_fail_closed(change_world, code):
    hotel = make_h5_hotel()
    run_id, _, _ = _propose(hotel, hotel.engineer_a)
    admission = submit(hotel, run_id)
    drain(_gw(), admission.gateway_run_id)
    assert handoffs.approve(new_client(), hotel.user(hotel.gm, "gm"), admission.handoff_id)["ok"]
    change_world(hotel)
    drain(_gw(), admission.gateway_run_id)
    final = status(hotel, admission.handoff_id, hotel.user(hotel.gm, "gm"))
    assert final["execution"]["state"] == "failed" and final["execution"]["error_code"] == code
    assert _assigned(hotel) != hotel.engineer_a


def test_handoff_is_invisible_to_other_hotels_and_unrelated_roles():
    hotel, other = make_h5_hotel(), make_h5_hotel()
    run_id, _, _ = _propose(hotel, hotel.engineer_a)
    admission = submit(hotel, run_id)
    for user in (other.user(other.gm, "gm"), hotel.user(hotel.engineer_b, "engineer"),
                 hotel.user(hotel.supervisor, "housekeeping_supervisor")):
        with pytest.raises(HandoffRefused) as exc:
            handoffs.handoff_status(new_client(), user, admission.handoff_id)
        assert exc.value.code == "not_found"
