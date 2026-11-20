"""H7 P2 / GHSA-xm55: an approval state transition can never commit without its tool event (migration 262).

Before 262 a service_role UPDATE of agent_tool_approvals outside the reviewed RPCs passed the 260 guard (the named
decider currently held an approver role) and left no tool event. 262 adds a DEFERRED constraint trigger: at commit, a
transition without its event gets one, attributed to the database role as UNVERIFIED (never as a human). Reviewed RPCs
write their own event in the same transaction, so they get no duplicate. Real PostgREST + PostgreSQL only.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from agent_execution_support import requires_db, sql_value
from agent_gateway_support import (
    ASSIGN,
    admit,
    approval_for,
    assign_args,
    drain_run,
    gateway_worker,
    gstore,
    make_gateway_hotel,
    reset_gateway_state,
)
from batch_support import new_client, run_sql
from services.agent_gateway import approvals

pytestmark = requires_db


@pytest.fixture(autouse=True)
def _clean():
    reset_gateway_state()
    yield
    reset_gateway_state()


def _pending(hotel) -> tuple[str, str]:
    admitted = admit(hotel, ASSIGN, assign_args(hotel))
    assert drain_run(gateway_worker(), admitted.run_id) == ["awaiting_approval"]
    return admitted.run_id, approval_for(hotel, admitted.run_id)["id"]


def _events(approval_id: str, event_type: str) -> list[dict]:
    out = sql_value(
        "SELECT coalesce(jsonb_agg(jsonb_build_object('tenant_id', tenant_id, 'actor_kind', actor_kind, "
        "'actor_ref', actor_ref, 'reason_code', reason_code, 'detail', detail) ORDER BY id), '[]'::jsonb) "
        f"FROM public.agent_tool_events WHERE approval_id = '{approval_id}' AND event_type = '{event_type}';")
    import json

    return json.loads(out)


def test_a_direct_service_role_decision_is_journaled_as_an_unverified_operator_change():
    hotel = make_gateway_hotel()
    _, approval = _pending(hotel)
    new_client().table("agent_tool_approvals").update({
        "state": "approved", "decided_by_user_id": hotel.gm, "decided_role": "gm",
        "decided_at": datetime.now(timezone.utc).isoformat()}).eq("id", approval).execute()
    assert sql_value(f"SELECT state FROM public.agent_tool_approvals WHERE id = '{approval}';") == "approved"
    events = _events(approval, "approval_approved")
    assert len(events) == 1, events
    event = events[0]
    assert event["tenant_id"] == hotel.tenant_id
    assert event["actor_kind"] == "operator" and event["actor_ref"] == "db_role:service_role"  # never 'human'
    assert event["reason_code"] == "out_of_band_change"
    assert event["detail"] == {"provenance": "unverified", "asserted_decided_by_user_id": hotel.gm,
                               "asserted_decided_role": "gm"}


def test_a_direct_revocation_is_journaled_too():
    hotel = make_gateway_hotel()
    _, approval = _pending(hotel)
    new_client().table("agent_tool_approvals").update({"state": "revoked", "ended_by": "ops:manual",
                                                       "ended_at": datetime.now(timezone.utc).isoformat()}
                                                      ).eq("id", approval).execute()
    events = _events(approval, "approval_revoked")
    assert len(events) == 1 and events[0]["actor_kind"] == "operator" and events[0]["reason_code"] == "out_of_band_change"


def test_the_reviewed_rpc_paths_get_no_duplicate_event():
    # All three wait first (one shared dispatch queue: an approved run would be drained by the next _pending).
    hotel, hotel2, hotel3 = make_gateway_hotel(), make_gateway_hotel(), make_gateway_hotel()
    _, approval = _pending(hotel)
    _, second = _pending(hotel2)
    _, third = _pending(hotel3)
    approvals.approve(gstore(), hotel.user(hotel.gm, "gm"), approval)
    approved = _events(approval, "approval_approved")
    assert len(approved) == 1 and approved[0]["actor_kind"] == "human" and approved[0]["actor_ref"] == f"user:{hotel.gm}"
    approvals.reject(gstore(), hotel2.user(hotel2.gm, "gm"), second)
    assert [e["actor_kind"] for e in _events(second, "approval_rejected")] == ["human"]
    approvals.revoke(gstore(), hotel3.user(hotel3.chief, "chief_engineer"), third)
    assert [e["actor_kind"] for e in _events(third, "approval_revoked")] == ["human"]


def test_every_transition_in_one_transaction_is_journaled_and_immediate_mode_cannot_silence_it():
    hotel = make_gateway_hotel()
    _, approval = _pending(hotel)
    run_sql(f"""
      BEGIN;
      SET LOCAL ROLE service_role;
      SET CONSTRAINTS ALL IMMEDIATE;
      UPDATE public.agent_tool_approvals SET state = 'approved', decided_by_user_id = '{hotel.gm}', decided_role = 'gm',
             decided_at = now() WHERE id = '{approval}';
      UPDATE public.agent_tool_approvals SET state = 'revoked', ended_by = 'ops:manual', ended_at = now()
       WHERE id = '{approval}';
      COMMIT;
    """)
    assert len(_events(approval, "approval_approved")) == 1
    assert len(_events(approval, "approval_revoked")) == 1


def test_the_audit_trigger_is_one_enabled_deferred_constraint_trigger():
    shape = sql_value("SELECT string_agg(tgenabled::text || ':' || tgdeferrable || ':' || tginitdeferred || ':' || tgtype, ',') "
                      "FROM pg_trigger WHERE tgname = 'agent_tool_approvals_transition_audit';")
    assert shape == "O:true:true:17"


def test_another_hotel_never_sees_the_out_of_band_event():
    hotel, other = make_gateway_hotel(), make_gateway_hotel()
    run_id, approval = _pending(hotel)
    new_client().table("agent_tool_approvals").update({"state": "revoked", "ended_by": "ops:manual",
                                                       "ended_at": datetime.now(timezone.utc).isoformat()}
                                                      ).eq("id", approval).execute()
    assert gstore().tool_events_page(tenant_id=other.tenant_id, run_id=run_id, after_id=0, limit=500) == []
    own = gstore().tool_events_page(tenant_id=hotel.tenant_id, run_id=run_id, after_id=0, limit=500)
    assert "out_of_band_change" in [e.get("reason_code") for e in own]
