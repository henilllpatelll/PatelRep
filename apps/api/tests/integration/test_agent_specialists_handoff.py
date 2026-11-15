"""H5 proposal handoff + the human-approved one-room Housekeeping assignment on a real migrated database.

A validated proposal executes ONLY after its verified initiator submits it AND a different, currently authorized
supervisor/GM approves it; the canonical publish_assignment_batch performs the change; every change in the world
between steps fails closed."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from agent_execution_support import requires_db
from agent_specialists_support import (
    ENABLED,
    HK,
    change,
    drain,
    draft,
    gstore,
    hotel_today,
    make_h5_hotel,
    plan_with,
    planning_events,
    room_audits,
    room_owner,
    room_stage,
    run_sql,
    sql_value,
    status,
    store,
    submit,
    worker,
)
from batch_support import new_client
from services.agent_handoff import handoff as handoffs
from services.agent_handoff.handoff import HandoffRefused
from tests.smoke.agent_orchestrator_support import Transport, openai_ok

pytestmark = requires_db
HK_ASSIGN = ("housekeeping.room_assignments.assign", 1)
HK_REC = "housekeeping.room_assignment_recommendation"


@pytest.fixture(autouse=True)
def _clean():
    from agent_specialists_support import reset_all

    reset_all()
    yield


def _proposal(hotel, *, to=None, expected=None):
    args = {"room_id": hotel.room, "assignee_user_id": to or hotel.housekeeper, "expected_assigned_to": expected,
            "assignment_date": hotel_today(hotel)}
    findings = ["reassignment_suggested", "already_assigned"] if expected else ["room_unassigned"]
    run_id, record, _ = plan_with(hotel, HK_REC, hotel.room, draft(
        HK, outcome="propose_change", findings=findings, steps=[change(HK_ASSIGN, args)]))
    assert record["plan_outcome"] == "proposed", record
    return run_id


def _gw_worker(calls=None):
    return worker(Transport([openai_ok()]), "it-h5-gw",
                  notifier=(lambda client, committed: calls.append(committed)) if calls is not None else None)


def _awaiting(hotel, calls=None):
    run_id = _proposal(hotel)
    admission = submit(hotel, run_id)
    drain(_gw_worker(calls), admission.gateway_run_id)
    assert sql_value(f"SELECT state FROM public.agent_runs WHERE id = '{admission.gateway_run_id}';") == "awaiting_approval"
    return run_id, admission


def _decide(hotel, handoff_id, user_id, role, decision="approve"):
    return getattr(handoffs, decision)(new_client(), hotel.user(user_id, role), handoff_id)


def _publish(hotel, room, to, *, expected=None, actor=None):
    """A supervisor's ordinary screen publication (the canonical path), used to change the world concurrently."""
    change_ = {"room_id": room, "kind": "reassign" if expected else "assign", "housekeeper_id": to}
    change_.update({"expected_assigned_to": expected} if expected else {"expect_unassigned": True})
    new_client().rpc("publish_assignment_batch", {
        "p_tenant_id": hotel.tenant_id, "p_actor_id": actor or hotel.supervisor_b, "p_operation_id": str(uuid.uuid4()),
        "p_date": hotel_today(hotel), "p_changes": [change_]}).execute()


def test_proposal_executes_only_after_submission_and_independent_approval():
    hotel, calls = make_h5_hotel(), []
    run_id = _proposal(hotel)
    gateway_runs = f"SELECT count(*) FROM public.agent_runs WHERE tenant_id = '{hotel.tenant_id}' AND agent_id = '{HK[0]}';"
    assert sql_value(gateway_runs) == "0" and room_owner(hotel) == ""  # a validated plan never runs by itself

    first = submit(hotel, run_id)
    again = submit(hotel, run_id)
    assert first.created and not again.created and first.handoff_id == again.handoff_id
    assert sql_value(gateway_runs) == "1"
    drain(_gw_worker(calls), first.gateway_run_id)
    run = store().get_run(tenant_id=hotel.tenant_id, run_id=first.gateway_run_id)["run"]
    assert run["state"] == "awaiting_approval" and run.get("lease_owner") is None  # no lease while waiting
    assert room_owner(hotel) == ""

    with pytest.raises(HandoffRefused) as exc:
        _decide(hotel, first.handoff_id, hotel.supervisor, "housekeeping_supervisor")
    assert exc.value.code == "self_approval_forbidden"
    with pytest.raises(HandoffRefused) as exc:
        _decide(hotel, first.handoff_id, hotel.housekeeper, "housekeeper")
    assert exc.value.code in ("not_found", "approver_not_authorized")
    with pytest.raises(HandoffRefused) as exc:
        _decide(hotel, first.handoff_id, hotel.chief, "chief_engineer")  # another department's manager
    assert exc.value.code in ("not_found", "approver_not_authorized")

    assert _decide(hotel, first.handoff_id, hotel.supervisor_b, "housekeeping_supervisor")["ok"]
    drain(_gw_worker(calls), first.gateway_run_id)
    assert room_owner(hotel) == hotel.housekeeper
    assert room_stage(hotel) == "DIRTY"  # never marked clean / inspected / ready
    assert room_audits(hotel) == [f"housekeeping.assignment.assigned|{hotel.supervisor_b}|true"]
    final = status(hotel, first.handoff_id, hotel.user(hotel.supervisor, "housekeeping_supervisor"))
    assert final["execution"]["state"] == "succeeded" and final["approval"]["consumed_at"]
    assert len(calls) == 1 and calls[0]["tool_id"] == HK_ASSIGN[0] and calls[0]["result"]["changed"] is True
    events = planning_events(hotel, run_id)
    assert "handoff_submitted" in events and "handoff_replayed" in events
    tool_events = [e["event_type"] for e in gstore().tool_events_page(tenant_id=hotel.tenant_id,
                                                                      run_id=first.gateway_run_id, limit=100)]
    for expected in ("invocation_admitted", "approval_requested", "approval_approved", "approval_resumed",
                     "execution_succeeded"):
        assert expected in tool_events


def test_submission_refusals_are_enforced_in_code_and_database():
    hotel, other = make_h5_hotel(), make_h5_hotel()
    run_id = _proposal(hotel)
    record = new_client().rpc("agent_planning_run_get", {"p_tenant_id": hotel.tenant_id, "p_run_id": run_id}).execute().data
    with pytest.raises(HandoffRefused) as exc:
        submit(hotel, run_id, user=hotel.user(hotel.supervisor_b, "housekeeping_supervisor"))
    assert exc.value.code == "not_initiator"
    with pytest.raises(HandoffRefused) as exc:
        submit(hotel, run_id, digest="0" * 64)
    assert exc.value.code == "plan_digest_mismatch"
    with pytest.raises(HandoffRefused) as exc:
        submit(hotel, run_id, step=2)
    assert exc.value.code == "proposal_not_found"
    with pytest.raises(HandoffRefused) as exc:
        handoffs.submit_proposal(new_client(), other.user(other.supervisor, "housekeeping_supervisor"),
                                 planning_run_id=run_id, plan_digest=record["plan_digest"], step_number=1,
                                 app_env="test", settings=ENABLED, clock=lambda: datetime.now(timezone.utc))  # other hotel
    assert exc.value.code == "not_found"

    step = record["plan"]["steps"][0]
    base = {"p_tenant_id": hotel.tenant_id, "p_user_id": hotel.supervisor, "p_planning_run_id": run_id,
            "p_plan_digest": record["plan_digest"], "p_step_number": 1, "p_proposal_ttl_seconds": 900,
            "p_agent_id": HK[0], "p_agent_version": HK[1], "p_idempotency_key": f"handoff:{run_id}:1",
            "p_request_digest": "a" * 64, "p_correlation_id": "it", "p_policy_version": "p", "p_tool_id": HK_ASSIGN[0],
            "p_tool_version": 1, "p_arguments": step["arguments"], "p_resource_type": "room", "p_resource_id": hotel.room,
            "p_action_digest": "b" * 64, "p_deadline_seconds": 600, "p_max_attempts": 3, "p_step_max_attempts": 2}

    def forged(**changes):
        return new_client().rpc("agent_proposal_handoff_admit", {**base, **changes}).execute().data

    assert forged(p_arguments={**step["arguments"], "assignee_user_id": hotel.housekeeper_b})["reason"] == "proposal_changed"
    assert forged(p_user_id=hotel.supervisor_b)["reason"] == "not_initiator"
    assert forged(p_tenant_id=other.tenant_id)["reason"] == "not_found"
    assert forged(p_idempotency_key=f"handoff:{run_id}:9")["reason"] == "invalid_idempotency_key"
    assert forged(p_agent_id="engineering.dispatch_assistant", p_agent_version=2)["reason"] == "proposal_changed"
    assert forged(p_resource_id=other.room)["reason"] == "resource_out_of_scope"
    assert sql_value(f"SELECT count(*) FROM public.agent_proposal_handoffs WHERE planning_run_id = '{run_id}';") == "0"

    recommended, _, _ = plan_with(hotel, "housekeeping.room_readiness_review", hotel.room,
                                  draft(HK, findings=["room_unassigned"]))
    with pytest.raises(HandoffRefused) as exc:
        submit(hotel, recommended)
    assert exc.value.code == "plan_not_proposed"


def test_stale_and_expired_proposals_need_a_fresh_review():
    hotel = make_h5_hotel()
    run_id = _proposal(hotel)
    _publish(hotel, hotel.room, hotel.housekeeper_b)  # a supervisor assigned the room meanwhile
    with pytest.raises(HandoffRefused) as exc:
        submit(hotel, run_id)
    assert exc.value.code == "proposal_stale"

    fresh = make_h5_hotel()
    run_id = _proposal(fresh)
    run_sql(f"""SET session_replication_role = replica;
               UPDATE public.agent_planning_runs SET recorded_at = now() - interval '20 minutes' WHERE run_id = '{run_id}';
               SET session_replication_role = origin;""")
    with pytest.raises(HandoffRefused) as exc:
        submit(fresh, run_id)
    assert exc.value.code == "proposal_expired"


def _dnd(h):
    run_sql(f"UPDATE public.room_status SET dnd_flag = true WHERE room_id = '{h.room}';")


def _started(h):
    run_sql(f"UPDATE public.room_status SET status = 'IN_PROGRESS' WHERE room_id = '{h.room}';")


def _discrepancy(h):
    run_sql(f"""INSERT INTO public.room_occupancy_discrepancies (tenant_id, room_id, housekeeping_observed, reported_by)
               VALUES ('{h.tenant_id}', '{h.room}', 'occupied', '{h.supervisor_b}');""")


def _deactivated(h):
    run_sql(f"UPDATE public.user_roles SET is_active = false WHERE user_id = '{h.housekeeper}';")


def _concurrent(h):
    _publish(h, h.room, h.housekeeper_b)


def _new_day(h):
    run_sql(f"""UPDATE public.tenants SET timezone = CASE
                  WHEN (now() AT TIME ZONE 'Pacific/Kiritimati')::date <> (now() AT TIME ZONE timezone)::date
                  THEN 'Pacific/Kiritimati' ELSE 'Etc/GMT+12' END WHERE id = '{h.tenant_id}';""")


@pytest.mark.parametrize("mutate, code", [
    (_dnd, "room_blocked"), (_started, "room_not_assignable"), (_discrepancy, "room_blocked"),
    (_deactivated, "assignee_not_eligible"), (_concurrent, "resource_changed"), (_new_day, "date_not_hotel_today"),
], ids=["dnd", "cleaning_started", "occupancy_discrepancy", "ineligible_housekeeper", "concurrent_supervisor",
        "hotel_day_changed"])
def test_world_changes_after_approval_fail_closed_and_consume_the_approval(mutate, code):
    hotel, calls = make_h5_hotel(), []
    _, admission = _awaiting(hotel, calls)
    assert _decide(hotel, admission.handoff_id, hotel.gm, "gm")["ok"]
    before = room_owner(hotel)
    mutate(hotel)
    expected_owner = room_owner(hotel)
    drain(_gw_worker(calls), admission.gateway_run_id)
    final = status(hotel, admission.handoff_id, hotel.user(hotel.supervisor, "housekeeping_supervisor"))
    assert final["execution"]["state"] == "failed" and final["execution"]["error_code"] == code, final["execution"]
    assert final["approval"]["consumed_at"]  # a changed world needs a NEW review, never a silent retry
    assert room_owner(hotel) == expected_owner and (before == "" or before == expected_owner)
    assert room_owner(hotel) != hotel.housekeeper or code == "resource_changed"
    assert calls == []


def test_approver_demotion_rejection_and_withdrawal_change_nothing():
    hotel = make_h5_hotel()
    _, admission = _awaiting(hotel)
    assert _decide(hotel, admission.handoff_id, hotel.supervisor_b, "housekeeping_supervisor")["ok"]
    run_sql(f"UPDATE public.user_roles SET role = 'housekeeper' WHERE user_id = '{hotel.supervisor_b}';")
    drain(_gw_worker(), admission.gateway_run_id)
    final = status(hotel, admission.handoff_id, hotel.user(hotel.supervisor, "housekeeping_supervisor"))
    assert final["execution"]["error_code"] == "approver_not_authorized" and room_owner(hotel) == ""

    rejected = make_h5_hotel()
    _, admission = _awaiting(rejected)
    assert _decide(rejected, admission.handoff_id, rejected.gm, "gm", "reject")["ok"]
    assert sql_value(f"SELECT state FROM public.agent_runs WHERE id = '{admission.gateway_run_id}';") == "failed"
    assert room_owner(rejected) == ""

    withdrawn = make_h5_hotel()
    _, admission = _awaiting(withdrawn)
    assert handoffs.cancel(new_client(), withdrawn.user(withdrawn.supervisor, "housekeeping_supervisor"),
                           admission.handoff_id)["ok"]
    assert sql_value(f"SELECT state FROM public.agent_runs WHERE id = '{admission.gateway_run_id}';") == "cancelled"
    with pytest.raises(HandoffRefused) as exc:
        _decide(withdrawn, admission.handoff_id, withdrawn.gm, "gm")
    assert exc.value.code == "not_pending"
    with pytest.raises(HandoffRefused) as exc:  # only the initiator may withdraw
        handoffs.cancel(new_client(), withdrawn.user(withdrawn.gm, "gm"), admission.handoff_id)
    assert exc.value.code == "not_authorized"
    assert room_owner(withdrawn) == ""


def test_committed_write_replays_and_a_stale_worker_writes_nothing():
    hotel = make_h5_hotel()
    _, admission = _awaiting(hotel)
    assert _decide(hotel, admission.handoff_id, hotel.gm, "gm")["ok"]
    s = store()
    claimed = None
    for _ in range(10):
        result = s.claim(worker_id="it-h5-replay", lease_seconds=30, vt_margin=5)
        if result.get("outcome") == "claimed" and result["run"]["id"] == admission.gateway_run_id:
            claimed = result
            break
    assert claimed, "could not claim the approved run"
    inv = sql_value(f"SELECT invocation_id FROM public.agent_proposal_handoffs WHERE id = '{admission.handoff_id}';")
    digest = sql_value(f"SELECT action_digest FROM public.agent_tool_invocations WHERE id = '{inv}';")
    call = dict(run_id=admission.gateway_run_id, worker_id="it-h5-replay", invocation_id=inv, action_digest=digest)
    stale = gstore().execute_write("agent_tool_execute_room_assignment", fencing_token=int(claimed["fencing_token"]) - 1,
                                   **call)
    assert stale["outcome"] == "lease_lost" and room_owner(hotel) == ""
    first = gstore().execute_write("agent_tool_execute_room_assignment", fencing_token=int(claimed["fencing_token"]), **call)
    second = gstore().execute_write("agent_tool_execute_room_assignment", fencing_token=int(claimed["fencing_token"]), **call)
    assert first["outcome"] == "succeeded" and second["outcome"] == "replayed"
    assert room_owner(hotel) == hotel.housekeeper and len(room_audits(hotel)) == 1
    assert sql_value(f"SELECT count(*) FROM public.assignment_batch_operations WHERE operation_id = '{inv}';") == "1"
