"""H6 Stage 3/5: the AI Control Center service against the REAL migrated database (identity, tenancy, approvals,
controls, journal). Every decision is made by the real RPCs; raw SQL is used only to forge state or inspect."""
from __future__ import annotations

import threading
import uuid

import pytest

from agent_execution_support import admit as admit_synthetic, make_hotel, process, requires_db, reset_execution_state, store, worker
from agent_gateway_support import (
    ASSIGN,
    admit,
    approval_for,
    assign_args,
    drain_run,
    gateway_worker,
    make_gateway_hotel,
    reset_gateway_state,
    run_sql,
    sql_value,
)
from batch_support import new_client
from middleware.auth import CurrentUser
from services.agent_control_center import service
from services.agent_control_center.access import revalidate
from services.agent_control_center.errors import ControlCenterRefused
from services.agent_control_center.store import ControlCenterStore
from services.agent_execution.controls_store import set_control

pytestmark = requires_db
SWITCHES = ("SELECT coalesce((SELECT enabled::text FROM public.agent_execution_enablement WHERE id = 1), 'none') || '|' || "
            "coalesce((SELECT enabled::text FROM public.agent_model_enablement WHERE id = 1), 'none') || '|' || "
            "coalesce((SELECT customer_billing_mode FROM public.agent_customer_billing_controls WHERE id = 1), 'none');")


@pytest.fixture(autouse=True)
def _clean():
    reset_gateway_state()
    yield
    reset_gateway_state()


def cc() -> ControlCenterStore:
    return ControlCenterStore(new_client())


def viewer(hotel, user_id: str, role: str):
    return revalidate(new_client(), CurrentUser(user_id=user_id, hotel_id=hotel.tenant_id, role=role), clock=service.utcnow)


def refused(fn) -> str:
    with pytest.raises(ControlCenterRefused) as err:
        fn()
    return err.value.code


def waiting_approval(hotel):
    admitted = admit(hotel, ASSIGN, assign_args(hotel, note="control center"))
    assert drain_run(gateway_worker(), admitted.run_id) == ["awaiting_approval"]
    return admitted, approval_for(hotel, admitted.run_id)


def journal(tenant_id: str, event_type: str) -> int:
    return int(sql_value(f"SELECT count(*) FROM public.agent_control_center_events "
                         f"WHERE tenant_id = '{tenant_id}' AND event_type = '{event_type}';"))


# ---------------------------------------------------------------- identity is re-validated server-side every time
def test_identity_revalidation_refuses_stale_inactive_ambiguous_and_foreign_identities():
    hotel = make_gateway_hotel()
    other = make_gateway_hotel()
    assert viewer(hotel, hotel.gm, "gm").role == "gm"
    assert refused(lambda: viewer(hotel, hotel.engineer_a, "gm")) == "stale_role"       # JWT claims a higher role
    assert refused(lambda: viewer(hotel, other.gm, "gm")) in ("not_a_member", "tenant_mismatch")  # other hotel's GM
    assert refused(lambda: viewer(hotel, hotel.housekeeper, "housekeeper")) == "not_authorized"
    assert refused(lambda: viewer(hotel, str(uuid.uuid4()), "gm")) == "not_a_member"
    run_sql(f"UPDATE public.user_roles SET is_active = false WHERE user_id = '{hotel.supervisor}';")
    assert refused(lambda: viewer(hotel, hotel.supervisor, "housekeeping_supervisor")) == "inactive_member"
    new_client().table("user_roles").insert({"user_id": hotel.chief, "tenant_id": hotel.tenant_id,
                                             "role": "engineer"}).execute()
    assert refused(lambda: viewer(hotel, hotel.chief, "chief_engineer")) == "ambiguous_membership"
    run_sql(f"UPDATE public.user_profiles SET is_active = false WHERE id = '{hotel.engineer_b}';")
    assert refused(lambda: viewer(hotel, hotel.engineer_b, "engineer")) == "inactive_member"


# ---------------------------------------------------------------- tenancy: other hotels read as not found
def test_cross_hotel_runs_approvals_controls_and_audit_are_invisible():
    a, b = make_gateway_hotel(), make_gateway_hotel()
    admitted_b, approval_b = waiting_approval(b)
    gm_a = viewer(a, a.gm, "gm")
    assert refused(lambda: service.run_detail(cc(), gm_a, admitted_b.run_id)) == "not_found"
    assert refused(lambda: service.approval_detail(cc(), gm_a, approval_b["id"], approve_gate_open=True,
                                                   now=service.utcnow(), risk_of=service.risk_of)) == "not_found"
    assert refused(lambda: service.decide(new_client(), cc(), gm_a, approval_b["id"], decision="approve",
                                          reason_code=None, approve_gate_open=True)) == "not_found"
    assert refused(lambda: service.run_control(cc(), gm_a, admitted_b.run_id, "cancel")) == "not_found"
    assert service.runs(cc(), gm_a, state=None, cursor=None, limit=50)["runs"] == []
    lists = service.approvals_list(cc(), gm_a, view="history", cursor=None, limit=50, approve_gate_open=True,
                                   now=service.utcnow())
    assert all(item["id"] != approval_b["id"] for item in lists["approvals"])
    service.set_hotel_pause(cc(), viewer(b, b.gm, "gm"), paused=True, reason_code="incident_drill")
    events_a = service.audit(cc(), gm_a, before_id=None, limit=100, event_type=None)["events"]
    assert all(e["scope"] == "platform" or e["subject_ref"] != "hotel" for e in events_a)
    assert sql_value(f"SELECT count(*) FROM public.agent_control_center_events WHERE tenant_id = '{a.tenant_id}' "
                     f"AND event_type = 'runtime_control_changed';") == "0"
    assert service.overview(cc(), gm_a, approve_gate_open=True)["hotel"]["paused"] is False
    assert approval_for(b, admitted_b.run_id)["state"] == "requested"


# ---------------------------------------------------------------- approvals: inbox, facts, independent decisions
def test_inbox_facts_and_an_independent_approval_through_the_h2_service():
    hotel = make_gateway_hotel()
    admitted, approval = waiting_approval(hotel)
    gm, chief = viewer(hotel, hotel.gm, "gm"), viewer(hotel, hotel.chief, "chief_engineer")
    now = service.utcnow()
    inbox = service.approvals_list(cc(), gm, view="needs_my_review", cursor=None, limit=25, approve_gate_open=True, now=now)
    assert [a["id"] for a in inbox["approvals"]] == [approval["id"]] and inbox["approvals"][0]["can"]["approve"]
    mine = service.approvals_list(cc(), chief, view="submitted_by_me", cursor=None, limit=25, approve_gate_open=True,
                                  now=now)["approvals"]
    assert mine[0]["id"] == approval["id"] and mine[0]["can"] == {
        "approve": False, "reject": False, "withdraw": True, "reason": "self_approval_forbidden"}
    facts = service.approval_detail(cc(), gm, approval["id"], approve_gate_open=True, now=now, risk_of=service.risk_of)
    assert facts["risk"] == "medium" and facts["proposal"]["arguments"]["assignee_user_id"] == hotel.engineer_a
    assert facts["proposal"]["assignee_name"] == "H2 engineer_a" and facts["approval"]["initiated_by_name"] == "H2 chief"
    assert facts["resource"]["type"] == "work_order" and facts["resource_changed_since_proposal"] is False
    assert facts["assignee_evidence"] == "active_role_member_shift_unverified"
    text = str(facts)
    assert "Private Guest" not in text and "guest secret note" not in text and "description" not in text

    # the initiator cannot decide; the gate closed refuses approval; then a different current GM approves exactly once
    assert refused(lambda: service.decide(new_client(), cc(), chief, approval["id"], decision="approve",
                                          reason_code=None, approve_gate_open=True)) == "self_approval_forbidden"
    assert refused(lambda: service.decide(new_client(), cc(), gm, approval["id"], decision="approve",
                                          reason_code=None, approve_gate_open=False)) == "gateway_disabled"
    decided = service.decide(new_client(), cc(), gm, approval["id"], decision="approve", reason_code="reviewed_ok",
                             approve_gate_open=True)
    assert decided["state"] == "approved" and decided["run_state"] == "queued"
    assert refused(lambda: service.decide(new_client(), cc(), gm, approval["id"], decision="approve",
                                          reason_code=None, approve_gate_open=True)) == "not_pending"
    assert journal(hotel.tenant_id, "security_refusal") == 0  # the service layer records nothing; the router does


def test_concurrent_decisions_resolve_to_exactly_one_outcome():
    hotel = make_gateway_hotel()
    _, approval = waiting_approval(hotel)
    gm = viewer(hotel, hotel.gm, "gm")
    results: list[str] = []

    def act(decision: str) -> None:
        try:
            results.append(service.decide(new_client(), ControlCenterStore(new_client()), gm, approval["id"],
                                          decision=decision, reason_code=None, approve_gate_open=True)["state"])
        except ControlCenterRefused as exc:
            results.append(exc.code)

    threads = [threading.Thread(target=act, args=(d,)) for d in ("approve", "reject", "approve", "reject")]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(r for r in results if r in ("approved", "rejected")).__len__() == 1, results
    assert results.count("not_pending") == 3, results


def test_expired_and_stale_approvals_are_shown_as_such_and_refused():
    hotel = make_gateway_hotel()
    _, approval = waiting_approval(hotel)
    gm = viewer(hotel, hotel.gm, "gm")
    new_client().table("work_orders").update({"assigned_to": hotel.engineer_b}).eq("id", hotel.work_order).execute()
    facts = service.approval_detail(cc(), gm, approval["id"], approve_gate_open=True, now=service.utcnow(),
                                    risk_of=service.risk_of)
    assert facts["resource_changed_since_proposal"] is True and facts["resource"]["assigned_to_name"] == "H2 engineer_b"
    run_sql("ALTER TABLE public.agent_tool_approvals DISABLE TRIGGER agent_tool_approvals_guard_update;"
            f"UPDATE public.agent_tool_approvals SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' WHERE id = '{approval['id']}';"
            "ALTER TABLE public.agent_tool_approvals ENABLE TRIGGER agent_tool_approvals_guard_update;")
    facts = service.approval_detail(cc(), gm, approval["id"], approve_gate_open=True, now=service.utcnow(),
                                    risk_of=service.risk_of)
    assert facts["can"] == {"approve": False, "reject": False, "withdraw": False, "reason": "approval_expired"}
    code = refused(lambda: service.decide(new_client(), cc(), gm, approval["id"], decision="approve",
                                          reason_code=None, approve_gate_open=True))
    assert code in ("not_pending", "approval_expired", "expired")


# ---------------------------------------------------------------- controls: audited, restrictive, no activation
def test_hotel_pause_is_gm_only_audited_and_an_operator_pause_cannot_be_cleared_here():
    hotel = make_gateway_hotel()
    before = sql_value(SWITCHES)
    gm, chief = viewer(hotel, hotel.gm, "gm"), viewer(hotel, hotel.chief, "chief_engineer")
    assert refused(lambda: service.set_hotel_pause(cc(), chief, paused=True, reason_code="x_test")) == "not_authorized"
    assert service.set_hotel_pause(cc(), gm, paused=True, reason_code="guest_incident") == {"paused": True, "changed": True}
    assert service.overview(cc(), gm, approve_gate_open=True)["readiness"]["blocked_by"][:1] == ["hotel_paused"] or \
        "hotel_paused" in service.overview(cc(), gm, approve_gate_open=True)["readiness"]["blocked_by"]
    assert service.set_hotel_pause(cc(), gm, paused=False, reason_code="resolved") == {"paused": False, "changed": True}
    assert journal(hotel.tenant_id, "runtime_control_changed") == 2
    actor = sql_value(f"SELECT actor_kind || '|' || actor_user_id FROM public.agent_control_center_events "
                      f"WHERE tenant_id = '{hotel.tenant_id}' ORDER BY id DESC LIMIT 1;")
    assert actor == f"human|{hotel.gm}"
    # legacy operator path (CLI) is journaled in the same transaction, and its pause is locked against the UI
    set_control(new_client(), scope="hotel", tenant_id=hotel.tenant_id, paused=True, updated_by="ops-oncall",
                reason_code="incident")
    assert journal(hotel.tenant_id, "runtime_control_changed") == 3
    assert refused(lambda: service.set_hotel_pause(cc(), gm, paused=False, reason_code="override")) == "operator_pause_locked"
    assert service.controls(cc(), gm)["hotel"]["can_unpause"] is False
    assert sql_value(SWITCHES) == before  # no dashboard mutation touched an execution, paid-call or billing switch


def test_grant_revocation_is_audited_and_takes_effect_at_admission():
    hotel = make_gateway_hotel()
    gm = viewer(hotel, hotel.gm, "gm")
    assert refused(lambda: service.revoke_grant(cc(), gm, agent_id="engineering.dispatch_assistant", agent_version=1,
                                                tool_id="shell.exec", tool_version=1)) == "tool_not_allowed"
    assert refused(lambda: service.revoke_grant(cc(), viewer(hotel, hotel.chief, "chief_engineer"),
                                                agent_id="engineering.dispatch_assistant", agent_version=1,
                                                tool_id=ASSIGN[0], tool_version=ASSIGN[1])) == "not_authorized"
    assert service.revoke_grant(cc(), gm, agent_id="engineering.dispatch_assistant", agent_version=1,
                                tool_id=ASSIGN[0], tool_version=ASSIGN[1]) == {"revoked": True}
    grant = [g for g in service.controls(cc(), gm)["grants"] if g["tool_id"] == ASSIGN[0] and g["agent_version"] == 1][0]
    assert grant["effective"] is False and grant["revoked_by_name"] == "H2 gm"
    assert journal(hotel.tenant_id, "tool_grant_changed") >= 1
    with pytest.raises(Exception):
        admit(hotel, ASSIGN, assign_args(hotel))


def test_run_pause_resume_and_cancel_race_safely_with_queued_work():
    reset_execution_state()
    tenant_id, gm_id = make_hotel(new_client(), role="gm")
    new_client().table("tenant_feature_flags").insert({"tenant_id": tenant_id, "feature_key": "ai_control_center",
                                                       "enabled": True, "updated_by": "it"}).execute()
    hotel = type("H", (), {"tenant_id": tenant_id})
    gm = viewer(hotel, gm_id, "gm")
    s = store()
    queued = admit_synthetic(s, tenant_id, spec={"operation": "noop", "steps": 1})
    assert service.run_control(cc(), gm, queued["run_id"], "pause")["state"] == "paused"
    w = worker()
    assert process(w, s) == "empty"  # a paused run is never claimed
    assert service.run_detail(cc(), gm, queued["run_id"])["can"]["resume"] is True
    service.run_control(cc(), gm, queued["run_id"], "resume")
    assert "run_succeeded" in [process(w, s) for _ in range(3)]
    second = admit_synthetic(s, tenant_id, spec={"operation": "noop", "steps": 1})
    assert service.run_control(cc(), gm, second["run_id"], "cancel")["state"] == "cancelled"
    assert service.run_control(cc(), gm, second["run_id"], "cancel")["outcome"] == "already_terminal"
    assert process(w, s) == "empty"


# ---------------------------------------------------------------- the journal itself
def test_the_governance_journal_cannot_be_written_rewritten_or_erased_by_application_roles():
    hotel = make_gateway_hotel()
    service.set_hotel_pause(cc(), viewer(hotel, hotel.gm, "gm"), paused=True, reason_code="drill")
    for statement in ("INSERT INTO public.agent_control_center_events (tenant_id, event_type, actor_kind, subject_type) "
                      f"VALUES ('{hotel.tenant_id}', 'security_refusal', 'system', 'control')",
                      "UPDATE public.agent_control_center_events SET reason_code = 'forged'",
                      "DELETE FROM public.agent_control_center_events",
                      "TRUNCATE public.agent_control_center_events",
                      "SELECT public.agent__control_center_journal(NULL, 'security_refusal', 'system', 'control', NULL, NULL, '{}')"):
        with pytest.raises(AssertionError) as err:
            run_sql(f"BEGIN; SET LOCAL ROLE service_role; {statement}; ROLLBACK;")
        assert "permission denied" in str(err.value), statement
    for statement in ("UPDATE public.agent_control_center_events SET reason_code = 'forged'",
                      f"DELETE FROM public.agent_control_center_events WHERE tenant_id = '{hotel.tenant_id}'",
                      "TRUNCATE public.agent_control_center_events"):
        with pytest.raises(AssertionError):
            run_sql(statement)  # even the owner is refused by the row / statement guards
    assert sql_value("SELECT count(*) FROM public.agent_audit_privilege_violations();") == "0"
