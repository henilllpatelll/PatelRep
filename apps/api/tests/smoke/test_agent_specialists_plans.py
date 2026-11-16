"""Deterministic plan-schema-v2 validation against verified facts, the orchestrator's v2 path and handoff refusals
(no database, no model). ADR-0004."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest

from middleware.auth import CurrentUser
from services.agent_gateway.authorization import GatewaySettings
from services.agent_handoff.handoff import HandoffRefused, plan_digest_of, submit_proposal
from services.agent_handoff.notifier import notify_committed_write
from services.agent_orchestrator.errors import InvalidModelRequest
from services.agent_orchestrator.intents import (
    ENGINEERING_DISPATCH_RECOMMENDATION as DISPATCH,
    ENGINEERING_TRIAGE as TRIAGE,
    HOUSEKEEPING_ASSIGNMENT_RECOMMENDATION as HK_REC,
    HOUSEKEEPING_READINESS_REVIEW as REVIEW,
)
from services.agent_orchestrator.orchestrator import Orchestrator, PlanningRequest
from services.agent_orchestrator.plans import PlanRejected, validate_plan
from services.agent_orchestrator.plans_v2 import validate_plan_v2

NOW = datetime(2026, 11, 15, 15, 0, tzinfo=timezone.utc)
ROOM, WO = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
HK_A, HK_B = "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"
ENG_A, OUTSIDER = "55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666"
HK = ("housekeeping.room_readiness_assistant", 1)
ENG = ("engineering.dispatch_assistant", 2)
HK_ASSIGN = ("housekeeping.room_assignments.assign", 1)
WO_ASSIGN = ("engineering.work_orders.assign", 2)


def room_facts(*, blockers=(), owner=None, status="DIRTY", candidates=((HK_A, 1), (HK_B, 4))):
    return {
        "housekeeping.rooms.readiness_lookup@1": {
            "id": ROOM, "room_number": "204", "is_active": True, "status": status, "fo_status": "VAC",
            "clean_type": "DEP", "hotel_date": "2026-11-15", "current_assigned_to": owner,
            "assignment_source": "dated" if owner else "none", "assignable": not blockers, "blockers": list(blockers),
            "status_updated_at": None},
        "housekeeping.room_assignments.candidates@1": {
            "room_id": ROOM, "hotel_date": "2026-11-15", "truncated": False,
            "candidates": [{"staff_id": s, "position": "housekeeper", "rooms_assigned_today": n} for s, n in candidates]},
    }


def wo_facts(*, status="open", owner=None, due=None, priority="urgent"):
    return {
        "engineering.work_orders.lookup@2": {"id": WO, "work_order_number": 7, "title": "Leak", "status": status,
                                             "priority": priority, "assigned_to": owner, "room_number": "204",
                                             "due_at": due},
        "engineering.work_orders.assignment_candidates@1": {
            "work_order_id": WO, "truncated": False,
            "candidates": [{"staff_id": ENG_A, "position": "engineer", "open_work_orders": 0}]},
    }


def draft(agent, *, outcome="recommend", findings=(), steps=(), reasons=(), priority="normal"):
    return {"plan_schema": "patelrep.plan/v2", "outcome": outcome, "agent_id": agent[0], "agent_version": agent[1],
            "findings": list(findings), "priority": priority, "steps": list(steps), "reason_codes": list(reasons)}


def step(tool, args):
    return {"step_number": 1, "purpose": "propose_change", "depends_on": [],
            "tool_call": {"tool_id": tool[0], "tool_version": tool[1], "arguments_json": json.dumps(args),
                          "expected_result": "assignment_change"}}


def hk_args(**over):
    return {"room_id": ROOM, "assignee_user_id": HK_A, "expected_assigned_to": None, "assignment_date": "2026-11-15",
            **over}


def v2(raw, intent=HK_REC, facts=None, resource=ROOM):
    return validate_plan_v2(raw, intent=intent, resource_id=resource, facts=room_facts() if facts is None else facts,
                            context_digest="d" * 64, now=NOW)


def test_valid_proposal_is_a_labelled_proposal_with_a_stable_digest():
    raw = draft(HK, outcome="propose_change", findings=["room_unassigned", "assignee_has_lowest_workload"],
                steps=[step(HK_ASSIGN, hk_args())])
    first, second = v2(raw), v2(json.dumps(raw))
    assert first.outcome == "proposed" and first.digest == second.digest == plan_digest_of(first.plan)
    assert first.plan["proposal_only"] is True and first.plan["authorizes_execution"] is False
    assert first.plan["steps"][0]["tool"]["requires_human_approval"] is True
    assert first.plan["context_digest"] == "d" * 64


@pytest.mark.parametrize("raw, code", [
    (draft(HK, findings=["room_dnd"]), "finding_not_supported_by_facts"),
    (draft(HK, findings=["work_order_overdue"]), "finding_not_allowed_for_intent"),
    (draft(HK, outcome="propose_change", findings=["room_unassigned"],
           steps=[step(HK_ASSIGN, hk_args(assignee_user_id=OUTSIDER))]), "assignee_not_verified_eligible"),
    (draft(HK, outcome="propose_change", findings=["room_unassigned"],
           steps=[step(HK_ASSIGN, hk_args(assignee_user_id=HK_A, expected_assigned_to=HK_B))]), "expected_owner_mismatch"),
    (draft(HK, outcome="propose_change", findings=["room_unassigned"],
           steps=[step(HK_ASSIGN, hk_args(assignment_date="2026-11-16"))]), "date_not_hotel_today"),
    (draft(HK, outcome="propose_change", findings=["room_unassigned"],
           steps=[step(HK_ASSIGN, hk_args(approved=True))]), "untrusted_identity_claim"),
    (draft(HK, outcome="propose_change", findings=["room_unassigned"],
           steps=[step(WO_ASSIGN, {"work_order_id": WO, "assignee_user_id": ENG_A, "expected_assigned_to": None,
                                   "note": None})]), "tool_not_allowed"),
    (draft(ENG, findings=["room_unassigned"]), "agent_not_candidate"),
    (draft(HK, outcome="propose_change", findings=["room_unassigned"],
           steps=[step(HK_ASSIGN, hk_args()), {**step(HK_ASSIGN, hk_args()), "step_number": 2}]), "too_many_proposals"),
    (draft(HK, outcome="recommend"), "recommendation_requires_findings_and_no_steps"),
    (draft(HK, outcome="refuse"), "non_proposal_requires_reasons_and_no_steps"),
    ({**draft(HK), "hotel_id": "x"}, "draft_schema_violation"),
    ({**draft(HK), "plan_schema": "patelrep.plan/v1"}, "draft_schema_violation"),
])
def test_untrusted_drafts_are_rejected_with_stable_codes(raw, code):
    with pytest.raises(PlanRejected) as exc:
        v2(raw)
    assert exc.value.code == code


def test_blocked_or_owned_rooms_and_noops_cannot_be_proposed():
    raw = draft(HK, outcome="propose_change", findings=["room_dnd"], steps=[step(HK_ASSIGN, hk_args())])
    with pytest.raises(PlanRejected) as exc:
        v2(raw, facts=room_facts(blockers=["dnd"]))
    assert exc.value.code == "room_blocked"
    noop = draft(HK, outcome="propose_change", findings=["already_assigned"],
                 steps=[step(HK_ASSIGN, hk_args(expected_assigned_to=HK_A))])
    with pytest.raises(PlanRejected) as exc:
        v2(noop, facts=room_facts(owner=HK_A))
    assert exc.value.code == "proposal_is_noop"
    reassign = draft(HK, outcome="propose_change", findings=["already_assigned", "reassignment_suggested"],
                     steps=[step(HK_ASSIGN, hk_args(expected_assigned_to=HK_B))])
    assert v2(reassign, facts=room_facts(owner=HK_B)).outcome == "proposed"


def test_read_only_intents_never_carry_a_write():
    with pytest.raises(PlanRejected) as exc:
        v2(draft(HK, outcome="propose_change", findings=["room_unassigned"], steps=[step(HK_ASSIGN, hk_args())]),
           intent=REVIEW)
    assert exc.value.code == "proposal_not_allowed_for_intent"
    assert v2(draft(HK, findings=["room_unassigned"]), intent=REVIEW).outcome == "recommended"


def test_engineering_findings_and_closed_orders_follow_the_facts():
    overdue = (NOW - timedelta(hours=1)).isoformat()
    ok = validate_plan_v2(draft(ENG, findings=["work_order_overdue", "work_order_high_priority"]), intent=TRIAGE,
                          resource_id=WO, facts=wo_facts(due=overdue), context_digest="d" * 64, now=NOW)
    assert ok.outcome == "recommended"
    with pytest.raises(PlanRejected) as exc:
        validate_plan_v2(draft(ENG, findings=["work_order_overdue"]), intent=TRIAGE, resource_id=WO,
                         facts=wo_facts(due=(NOW + timedelta(days=3)).isoformat()), context_digest="d" * 64, now=NOW)
    assert exc.value.code == "finding_not_supported_by_facts"
    closed = draft(ENG, outcome="propose_change", findings=["work_order_closed"], steps=[step(
        WO_ASSIGN, {"work_order_id": WO, "assignee_user_id": ENG_A, "expected_assigned_to": None, "note": None})])
    with pytest.raises(PlanRejected) as exc:
        validate_plan_v2(closed, intent=DISPATCH, resource_id=WO, facts=wo_facts(status="completed"),
                         context_digest="d" * 64, now=NOW)
    assert exc.value.code == "resource_closed"


def test_v1_and_v2_validators_never_accept_each_others_intents():
    with pytest.raises(PlanRejected) as exc:
        validate_plan(draft(HK, findings=["room_unassigned"]), intent=REVIEW, resource_id=ROOM)
    assert exc.value.code == "plan_schema_mismatch"


def test_v2_planning_requires_verified_context():
    request = PlanningRequest(tenant_id="t", run_id="r", intent=REVIEW.intent, intent_version=1, resource_type="room",
                              resource_id=ROOM)
    with pytest.raises(InvalidModelRequest) as exc:
        asyncio.run(Orchestrator(planner=None).plan(request, caller=None))
    assert exc.value.code == "verified_context_required"


def test_handoff_is_refused_when_disabled_or_in_production():
    user = CurrentUser(user_id=HK_A, hotel_id="h", role="housekeeping_supervisor")
    for env, settings in (("test", GatewaySettings()), ("production", GatewaySettings(execution_enabled=True))):
        with pytest.raises(HandoffRefused) as exc:
            submit_proposal(object(), user, planning_run_id=ROOM, plan_digest="a" * 64, step_number=1, app_env=env,
                            settings=settings, clock=lambda: NOW)
        assert exc.value.code == "gateway_disabled"
    with pytest.raises(HandoffRefused) as exc:
        submit_proposal(object(), object(), planning_run_id=ROOM, plan_digest="a" * 64, step_number=1, app_env="test",
                        settings=GatewaySettings(execution_enabled=True), clock=lambda: NOW)
    assert exc.value.code == "unauthenticated"


def test_notifier_never_raises_and_ignores_unknown_tools():
    class Boom:
        def table(self, *_):
            raise RuntimeError("db down")

    notify_committed_write(Boom(), {"tool_id": "housekeeping.room_assignments.assign", "tool_version": 1,
                                    "hotel_id": "h", "result": {"room_id": ROOM, "assigned_to": HK_A}})
    notify_committed_write(Boom(), {"tool_id": "engineering.work_orders.lookup", "tool_version": 2, "hotel_id": "h"})
