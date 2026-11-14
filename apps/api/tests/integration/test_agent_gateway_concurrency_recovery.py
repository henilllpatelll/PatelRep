"""H2 write safety under concurrency, crashes, redelivery and stale workers -- REAL PostgreSQL only (no mocks).

Exactly-once boundary under test: the work-order mutation, its audit row, approval consumption and the ledger outcome
commit in ONE transaction, so every retry path either replays the committed outcome or finds nothing committed.
"""
from __future__ import annotations

import threading
import uuid

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
    expire_lease,
    gateway_worker,
    gstore,
    make_gateway_hotel,
    messages_for,
    reset_gateway_state,
    run_row,
    sql_value,
    store,
    tool_events,
)
from batch_support import new_client
from services.agent_gateway import approvals
from services.agent_gateway.store import GatewayStore

pytestmark = requires_db


@pytest.fixture(autouse=True)
def _clean():
    reset_gateway_state()
    yield
    reset_gateway_state()


def approved_run(hotel):
    admitted = admit(hotel, ASSIGN, assign_args(hotel))
    assert drain_run(gateway_worker(), admitted.run_id) == ["awaiting_approval"]
    approvals.approve(gstore(), hotel.user(hotel.gm, "gm"), approval_for(hotel, admitted.run_id)["id"])
    return admitted


def claim(worker_id: str) -> dict:
    result = store().claim(worker_id=worker_id, lease_seconds=30)
    assert result["outcome"] == "claimed", result
    return result


def digest_of(run_id: str) -> str:
    return sql_value(f"SELECT action_digest FROM public.agent_tool_invocations WHERE run_id = '{run_id}';")


def test_crash_after_domain_commit_replays_on_redelivery_without_a_second_effect():
    hotel = make_gateway_hotel()
    admitted = approved_run(hotel)
    claimed = claim("it-crashy")
    first = gstore().execute_work_order_assign(run_id=admitted.run_id, fencing_token=claimed["fencing_token"],
                                               worker_id="it-crashy", invocation_id=admitted.invocation_id,
                                               action_digest=digest_of(admitted.run_id))
    assert first["outcome"] == "succeeded"
    # the worker dies before completing the step: lease expires, the message is redelivered to another worker
    expire_lease(admitted.run_id)
    assert drain_run(gateway_worker("it-recovering"), admitted.run_id)[0] == "run_succeeded"
    assert audit_rows(hotel.work_order) == 1 and assigned_to(hotel.work_order) == hotel.engineer_a
    assert sql_value(f"SELECT count(*) FROM public.agent_tool_executions WHERE run_id = '{admitted.run_id}';") == "1"
    assert "execution_replayed" in [e["event_type"] for e in tool_events(hotel, admitted.run_id)]


def test_stale_fencing_token_cannot_execute_or_consume():
    hotel = make_gateway_hotel()
    admitted = approved_run(hotel)
    old = claim("it-old")
    expire_lease(admitted.run_id)
    new = claim("it-new")  # takeover with a higher token
    assert new["fencing_token"] > old["fencing_token"]
    stale = gstore().execute_work_order_assign(run_id=admitted.run_id, fencing_token=old["fencing_token"],
                                               worker_id="it-old", invocation_id=admitted.invocation_id,
                                               action_digest=digest_of(admitted.run_id))
    assert stale == {"outcome": "lease_lost"}
    assert assigned_to(hotel.work_order) == "" and approval_for(hotel, admitted.run_id)["consumed_at"] is None
    ok = gstore().execute_work_order_assign(run_id=admitted.run_id, fencing_token=new["fencing_token"],
                                            worker_id="it-new", invocation_id=admitted.invocation_id,
                                            action_digest=digest_of(admitted.run_id))
    assert ok["outcome"] == "succeeded" and audit_rows(hotel.work_order) == 1


def test_concurrent_duplicate_execution_applies_the_business_effect_once():
    hotel = make_gateway_hotel()
    admitted = approved_run(hotel)
    claimed = claim("it-dup")
    digest = digest_of(admitted.run_id)
    outcomes, barrier = [], threading.Barrier(6)

    def fire():
        s = GatewayStore(new_client())
        barrier.wait()
        outcomes.append(s.execute_work_order_assign(run_id=admitted.run_id, fencing_token=claimed["fencing_token"],
                                                    worker_id="it-dup", invocation_id=admitted.invocation_id,
                                                    action_digest=digest)["outcome"])

    threads = [threading.Thread(target=fire) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(outcomes) == ["replayed"] * 5 + ["succeeded"]
    assert audit_rows(hotel.work_order) == 1
    assert sql_value(f"SELECT count(*) FROM public.agent_tool_executions WHERE run_id = '{admitted.run_id}';") == "1"


def test_concurrent_workers_cannot_both_own_the_run():
    hotel = make_gateway_hotel()
    admitted = approved_run(hotel)
    outcomes, barrier = [], threading.Barrier(4)

    def work(i):
        barrier.wait()
        outcomes.append(drain_run(gateway_worker(f"it-race-{i}"), admitted.run_id, limit=3)[0])

    threads = [threading.Thread(target=work, args=(i,)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert outcomes.count("run_succeeded") == 1
    assert audit_rows(hotel.work_order) == 1 and run_row(hotel.tenant_id, admitted.run_id)["state"] == "succeeded"


def test_a_mismatched_digest_never_executes():
    hotel = make_gateway_hotel()
    admitted = approved_run(hotel)
    claimed = claim("it-digest")
    result = gstore().execute_work_order_assign(run_id=admitted.run_id, fencing_token=claimed["fencing_token"],
                                                worker_id="it-digest", invocation_id=admitted.invocation_id,
                                                action_digest="f" * 64)
    assert result == {"outcome": "invocation_invalid"} and assigned_to(hotel.work_order) == ""


def test_execution_without_approval_is_refused_by_the_database():
    hotel = make_gateway_hotel()
    admitted = admit(hotel, ASSIGN, assign_args(hotel))  # never reached the approval step
    claimed = claim("it-noapproval")
    result = gstore().execute_work_order_assign(run_id=admitted.run_id, fencing_token=claimed["fencing_token"],
                                                worker_id="it-noapproval", invocation_id=admitted.invocation_id,
                                                action_digest=digest_of(admitted.run_id))
    assert result == {"outcome": "refused", "reason": "approval_missing"} and assigned_to(hotel.work_order) == ""


def test_pause_after_approval_blocks_execution_until_resumed():
    hotel = make_gateway_hotel()
    admitted = approved_run(hotel)
    gstore().set_tool_control(tool_id=ASSIGN[0], paused=True, updated_by="it-operator")
    assert drain_run(gateway_worker(), admitted.run_id, limit=1) == ["run_yielded"]
    assert assigned_to(hotel.work_order) == "" and approval_for(hotel, admitted.run_id)["consumed_at"] is None
    gstore().set_tool_control(tool_id=ASSIGN[0], paused=False, updated_by="it-operator")
    from agent_gateway_support import run_sql
    run_sql(f"UPDATE pgmq.q_patelrep_agent_runs_v1 SET vt = now() WHERE message->>'run_id' = '{admitted.run_id}';")
    assert "run_succeeded" in drain_run(gateway_worker(), admitted.run_id)


def test_approval_wait_survives_a_worker_restart():
    hotel = make_gateway_hotel()
    admitted = admit(hotel, ASSIGN, assign_args(hotel))
    assert drain_run(gateway_worker("it-before-restart"), admitted.run_id) == ["awaiting_approval"]
    store().recover(limit=100)  # recovery sweeps never re-dispatch an approval wait
    assert messages_for(admitted.run_id) == 0
    assert run_row(hotel.tenant_id, admitted.run_id)["state"] == "awaiting_approval"
    approvals.approve(gstore(), hotel.user(hotel.gm, "gm"), approval_for(hotel, admitted.run_id)["id"])
    assert drain_run(gateway_worker("it-after-restart"), admitted.run_id)[0] == "run_succeeded"


def test_concurrent_approvals_resume_exactly_once():
    hotel = make_gateway_hotel()
    admitted = admit(hotel, ASSIGN, assign_args(hotel))
    drain_run(gateway_worker(), admitted.run_id)
    approval_id = approval_for(hotel, admitted.run_id)["id"]
    results, barrier = [], threading.Barrier(5)

    def decide():
        barrier.wait()
        try:
            approvals.approve(GatewayStore(new_client()), hotel.user(hotel.gm, "gm"), approval_id)
            results.append("ok")
        except Exception as exc:  # noqa: BLE001
            results.append(getattr(exc, "code", "error"))

    threads = [threading.Thread(target=decide) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == ["not_pending"] * 4 + ["ok"]
    assert messages_for(admitted.run_id) == 1


def test_a_stray_message_for_a_waiting_run_is_dropped_not_executed():
    hotel = make_gateway_hotel()
    admitted = admit(hotel, ASSIGN, assign_args(hotel))
    drain_run(gateway_worker(), admitted.run_id)
    from agent_execution_support import send_raw
    send_raw({"v": 1, "run_id": admitted.run_id})
    assert drain_run(gateway_worker(), admitted.run_id, limit=2)[0] == "awaiting_approval"
    assert run_row(hotel.tenant_id, admitted.run_id)["state"] == "awaiting_approval"
    assert messages_for(admitted.run_id) == 0 and assigned_to(hotel.work_order) == ""


# --- the shared domain operation (human route + gateway) --------------------------------------------------------

def test_shared_assign_operation_closes_the_check_then_write_race():
    hotel = make_gateway_hotel()
    results, barrier = [], threading.Barrier(2)

    def assign(target):
        barrier.wait()
        out = new_client().rpc("work_order_assign_apply", {
            "p_tenant_id": hotel.tenant_id, "p_work_order_id": hotel.work_order, "p_assignee_user_id": target,
            "p_expected_assigned_to": None, "p_actor_id": hotel.chief, "p_actor_role": "chief_engineer",
            "p_reason_note": None, "p_reason_code": None, "p_source": "api"}).execute().data
        results.append(out["outcome"])

    threads = [threading.Thread(target=assign, args=(t,)) for t in (hotel.engineer_a, hotel.engineer_b)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == ["assigned", "stale"] and audit_rows(hotel.work_order) == 1


@pytest.mark.parametrize("case, expected", [
    ("other_hotel", "not_found"), ("closed", "closed"), ("housekeeper", "assignee_not_eligible"),
    ("unchanged", "unchanged"), ("stale", "stale"), ("reassign", "reassigned"),
])
def test_shared_assign_operation_rules(case, expected):
    hotel, other = make_gateway_hotel(), make_gateway_hotel()
    from agent_gateway_support import run_sql
    target, expected_prev, tenant = hotel.engineer_a, None, hotel.tenant_id
    if case == "other_hotel":
        tenant = other.tenant_id
    elif case == "closed":
        run_sql(f"UPDATE public.work_orders SET status = 'completed' WHERE id = '{hotel.work_order}';")
    elif case == "housekeeper":
        target = hotel.housekeeper
    elif case in ("unchanged", "stale", "reassign"):
        run_sql(f"UPDATE public.work_orders SET assigned_to = '{hotel.engineer_a}' WHERE id = '{hotel.work_order}';")
        if case == "reassign":
            target, expected_prev = hotel.engineer_b, hotel.engineer_a
        elif case == "stale":
            target = hotel.engineer_b
    out = new_client().rpc("work_order_assign_apply", {
        "p_tenant_id": tenant, "p_work_order_id": hotel.work_order, "p_assignee_user_id": target,
        "p_expected_assigned_to": expected_prev, "p_actor_id": hotel.chief, "p_actor_role": "chief_engineer",
        "p_reason_note": None, "p_reason_code": None, "p_source": "api"}).execute().data
    assert out["outcome"] == expected
    assert audit_rows(hotel.work_order) == (1 if expected == "reassigned" else 0)


def test_end_users_cannot_call_gateway_or_assign_functions():
    for fn in ("work_order_assign_apply", "agent_tool_execute_work_order_assign", "agent_tool_approval_decide",
               "agent_tool_run_admit", "agent_tool_grant_set", "agent_execution_enablement_set"):
        for role in ("anon", "authenticated"):
            assert sql_value(f"SELECT bool_or(has_function_privilege('{role}', p.oid, 'EXECUTE')) FROM pg_proc p "
                             f"JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' "
                             f"AND p.proname = '{fn}';") == "f", (fn, role)
    for table in ("agent_tool_invocations", "agent_tool_approvals", "agent_tool_executions", "agent_tool_events",
                  "agent_tool_grants", "agent_tool_controls", "agent_execution_enablement"):
        assert sql_value(f"SELECT has_table_privilege('authenticated', 'public.{table}', 'SELECT,INSERT,UPDATE');") == "f"


def test_unique_idempotency_scope_is_per_hotel():
    a, b = make_gateway_hotel(), make_gateway_hotel()
    key = f"it-shared-{uuid.uuid4().hex}"
    first = admit(a, ASSIGN, assign_args(a), key=key)
    second = admit(b, ASSIGN, assign_args(b), key=key)
    assert first.created and second.created and first.run_id != second.run_id
