"""H2 Tool Gateway against the REAL migrated database: admission, read tools, tenant isolation, layered enablement."""
from __future__ import annotations

import pytest
from postgrest.exceptions import APIError

from agent_execution_support import requires_db
from agent_gateway_support import (
    LOOKUP,
    ROOM_LOOKUP,
    admit,
    drain_run,
    gateway_worker,
    gstore,
    make_gateway_hotel,
    messages_for,
    reset_gateway_state,
    run_row,
    run_sql,
    set_platform,
    sql_value,
    store,
    tool_events,
)
from services.agent_gateway.errors import GatewayRefused

pytestmark = requires_db


@pytest.fixture(autouse=True)
def _clean():
    reset_gateway_state()
    yield
    reset_gateway_state()


def refused(fn) -> str:
    with pytest.raises(GatewayRefused) as err:
        fn()
    return err.value.code


def test_read_tool_end_to_end_returns_a_minimal_sanitized_summary():
    hotel = make_gateway_hotel()
    admitted = admit(hotel, LOOKUP, {"work_order_id": hotel.work_order.upper()})
    assert admitted.created and not admitted.requires_approval and messages_for(admitted.run_id) == 1
    assert drain_run(gateway_worker(), admitted.run_id)[0] == "run_succeeded"
    assert run_row(hotel.tenant_id, admitted.run_id)["state"] == "succeeded"
    result = sql_value(f"SELECT result::text FROM public.agent_tool_executions WHERE run_id = '{admitted.run_id}';")
    assert '"title": "Sink leaking in 204"' in result and '"status": "open"' in result
    assert "Private Guest" not in result and "description" not in result
    assert [e["event_type"] for e in tool_events(hotel, admitted.run_id)] == ["invocation_admitted", "read_succeeded"]


def test_room_read_never_returns_guest_data_and_is_role_scoped():
    hotel = make_gateway_hotel()
    admitted = admit(hotel, ROOM_LOOKUP, {"room_id": hotel.room}, as_user=hotel.user(hotel.gm, "gm"))
    assert drain_run(gateway_worker(), admitted.run_id)[0] == "run_succeeded"
    result = sql_value(f"SELECT result::text FROM public.agent_tool_executions WHERE run_id = '{admitted.run_id}';")
    assert '"status": "DIRTY"' in result and "Private Guest" not in result and "secret" not in result
    # chief engineers hold no housekeeping room capability: refused in Python AND in the database
    assert refused(lambda: admit(hotel, ROOM_LOOKUP, {"room_id": hotel.room})) == "actor_not_authorized"


@pytest.mark.parametrize("label, role", [("housekeeper", "housekeeper")])
def test_unauthorized_role_cannot_admit_a_read(label, role):
    hotel = make_gateway_hotel()
    as_user = hotel.user(getattr(hotel, label), role)
    assert refused(lambda: admit(hotel, LOOKUP, {"work_order_id": hotel.work_order}, as_user=as_user)) \
        == "actor_not_authorized"


def test_cross_tenant_resource_is_out_of_scope():
    hotel_a, hotel_b = make_gateway_hotel(), make_gateway_hotel()
    assert refused(lambda: admit(hotel_a, LOOKUP, {"work_order_id": hotel_b.work_order})) == "resource_out_of_scope"
    # the database refuses it independently of the Python resolver
    out = gstore().run_admit(
        tenant_id=hotel_a.tenant_id, agent_id="engineering.dispatch_assistant", agent_version=1, user_id=hotel_a.chief,
        idempotency_key="it-cross-tenant-direct", request_digest="b" * 64, correlation_id="it", policy_version="p",
        tool_id=LOOKUP[0], tool_version=LOOKUP[1], arguments={"work_order_id": hotel_b.work_order},
        resource_type="work_order", resource_id=hotel_b.work_order, action_digest="c" * 64, deadline_seconds=600,
        max_attempts=3, step_max_attempts=3)
    assert out == {"admitted": False, "reason": "resource_out_of_scope"}


def test_missing_resource_and_forged_authority_arguments_are_refused():
    hotel = make_gateway_hotel()
    assert refused(lambda: admit(hotel, LOOKUP, {"work_order_id": "88888888-8888-4888-8888-888888888888"})) \
        == "resource_out_of_scope"
    assert refused(lambda: admit(hotel, LOOKUP, {"work_order_id": hotel.work_order, "hotel_id": "x"})) \
        == "untrusted_identity_claim"
    assert refused(lambda: admit(hotel, ("engineering.work_orders.assign", 1), {})) == "tool_not_registered"


@pytest.mark.parametrize("change, reason", [
    ("flag", "tenant_capability_disabled"),
    ("grant", "autonomy_insufficient"),
])
def test_entitlement_and_grant_are_both_required(change, reason):
    hotel = make_gateway_hotel(flag=change != "flag", grant=change != "grant")
    code = refused(lambda: admit(hotel, LOOKUP, {"work_order_id": hotel.work_order}))
    assert code in {reason, "tool_not_granted"}


def test_platform_switch_off_blocks_admission_and_execution():
    hotel = make_gateway_hotel()
    admitted = admit(hotel, LOOKUP, {"work_order_id": hotel.work_order})
    set_platform(False)
    assert refused(lambda: admit(hotel, LOOKUP, {"work_order_id": hotel.work_order})) == "platform_execution_disabled"
    assert drain_run(gateway_worker(), admitted.run_id, limit=1) == ["run_yielded"]
    assert run_row(hotel.tenant_id, admitted.run_id)["state"] == "queued"  # yielded, no attempt consumed
    set_platform(True)


def test_tool_pause_blocks_and_unpause_resumes():
    hotel = make_gateway_hotel()
    admitted = admit(hotel, LOOKUP, {"work_order_id": hotel.work_order})
    gstore().set_tool_control(tool_id=LOOKUP[0], paused=True, updated_by="it-operator")
    assert drain_run(gateway_worker(), admitted.run_id, limit=1) == ["run_yielded"]
    gstore().set_tool_control(tool_id=LOOKUP[0], paused=False, updated_by="it-operator")
    run_sql(f"UPDATE pgmq.q_patelrep_agent_runs_v1 SET vt = now() WHERE message->>'run_id' = '{admitted.run_id}';")
    assert "run_succeeded" in drain_run(gateway_worker(), admitted.run_id)


def test_a_worker_without_the_gateway_switch_never_executes_a_tool():
    from services.agent_execution.config import WorkerSettings
    from agent_gateway_support import process
    from services.agent_execution.worker import Worker
    from services.agent_execution.identity_authority import SupabaseIdentityAuthority
    from agent_execution_support import now

    hotel = make_gateway_hotel()
    admitted = admit(hotel, LOOKUP, {"work_order_id": hotel.work_order})
    synthetic_only = Worker(WorkerSettings(enabled=True, synthetic_enabled=True, worker_id="it-syn", lease_seconds=10,
                                           blocked_retry_seconds=1), app_env="test", version="it",
                            store_factory=store, authority_factory=lambda c: SupabaseIdentityAuthority(c, clock=now),
                            clock=now)
    assert process(synthetic_only) == "run_yielded"
    assert sql_value(f"SELECT count(*) FROM public.agent_tool_executions WHERE run_id = '{admitted.run_id}';") == "0"


def test_gateway_runs_cannot_be_inserted_outside_gateway_admission():
    hotel = make_gateway_hotel()
    with pytest.raises(APIError):
        store().admit(tenant_id=hotel.tenant_id, agent_id="engineering.dispatch_assistant", agent_version=1,
                      principal_type="human", user_id=hotel.chief, system_principal_id=None,
                      trigger_type="user_request", idempotency_key="it-direct-gateway", request_digest="d" * 64,
                      correlation_id="it", policy_version="p", synthetic_spec={}, first_step_type="tool_invocation",
                      deadline_seconds=600, max_attempts=3, step_max_attempts=3)
    with pytest.raises(APIError):  # unknown agents remain impossible
        store().admit(tenant_id=hotel.tenant_id, agent_id="engineering.rogue_agent", agent_version=1,
                      principal_type="human", user_id=hotel.chief, system_principal_id=None,
                      trigger_type="user_request", idempotency_key="it-rogue-agent", request_digest="d" * 64,
                      correlation_id="it", policy_version="p", synthetic_spec={}, first_step_type="tool_invocation",
                      deadline_seconds=600, max_attempts=3, step_max_attempts=3)


def test_admission_is_idempotent_and_refuses_a_conflicting_replay():
    hotel = make_gateway_hotel()
    first = admit(hotel, LOOKUP, {"work_order_id": hotel.work_order}, key="it-same-key-1")
    again = admit(hotel, LOOKUP, {"work_order_id": hotel.work_order}, key="it-same-key-1")
    assert (again.run_id, again.invocation_id, again.created) == (first.run_id, first.invocation_id, False)
    assert messages_for(first.run_id) == 1
    other_wo = admit(hotel, ROOM_LOOKUP, {"room_id": hotel.room}, as_user=hotel.user(hotel.gm, "gm"), key="it-same-key-2")
    assert other_wo.created
    with pytest.raises(GatewayRefused) as err:
        admit(hotel, ROOM_LOOKUP, {"room_id": hotel.room}, key="it-same-key-1", as_user=hotel.user(hotel.gm, "gm"))
    assert err.value.code == "idempotency_conflict"


def test_invocations_executions_and_tool_events_are_immutable():
    hotel = make_gateway_hotel()
    admitted = admit(hotel, LOOKUP, {"work_order_id": hotel.work_order})
    drain_run(gateway_worker(), admitted.run_id)
    for statement in (
        f"UPDATE public.agent_tool_invocations SET arguments = '{{}}' WHERE run_id = '{admitted.run_id}';",
        f"UPDATE public.agent_tool_executions SET state = 'failed', error_code = 'x' WHERE run_id = '{admitted.run_id}';",
        f"DELETE FROM public.agent_tool_events WHERE run_id = '{admitted.run_id}';",
    ):
        with pytest.raises(AssertionError):
            run_sql(statement)
