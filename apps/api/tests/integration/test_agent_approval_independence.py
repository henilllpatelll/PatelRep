"""#231 independent human approval enforced at the DATABASE boundary (migration 254), on a REAL migrated database.

The caller here is deliberately hostile: a buggy or malicious worker holding the backend's service role calls the RPCs
directly with permissive arguments, or writes the approval and ledger tables directly. Independence must still be
derived from the reviewed tool risk (agent__gateway_tool_spec), never from the caller's approver_may_be_initiator.
Engineering (medium-risk work-order assignment) and Housekeeping (high-risk room assignment) are both covered.
"""
from __future__ import annotations

import threading

import pytest
from postgrest.exceptions import APIError

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
    reset_gateway_state,
    run_row,
    run_sql,
    sql_value,
    store,
)
from batch_support import new_client

pytestmark = requires_db

SELF_POLICY = "human_approval.single_authorized_manager.v1"  # the H0 policy whose approver_may_be_initiator is true
INDEPENDENT_FLAG_ONLY = "agent_tool_approvals_independence"


@pytest.fixture(autouse=True)
def _clean():
    reset_gateway_state()
    yield
    reset_gateway_state()


def rpc(name: str, params: dict):
    return new_client().rpc(name, params).execute().data


def decide(hotel, approval_id: str, actor: str, decision: str = "approve", tenant_id=None) -> dict:
    return rpc("agent_tool_approval_decide", {"p_tenant_id": tenant_id or hotel.tenant_id, "p_approval_id": approval_id,
                                              "p_actor_user_id": actor, "p_decision": decision})


def db_refusal(fn) -> str:
    with pytest.raises(APIError) as err:
        fn()
    return str(err.value)


def sql_refusal(sql: str) -> str:
    with pytest.raises(AssertionError) as err:
        run_sql(f"BEGIN;\nSET LOCAL ROLE service_role;\n{sql}\nROLLBACK;")
    return str(err.value)


def claimed(run_id: str, worker_id: str = "it-hostile-worker") -> int:
    result = store().claim(worker_id=worker_id, lease_seconds=30)
    assert result["outcome"] == "claimed" and str(result["run"]["id"]) == run_id, result
    return result["fencing_token"]


def to_waiting(hotel):
    admitted = admit(hotel, ASSIGN, assign_args(hotel))
    assert drain_run(gateway_worker(), admitted.run_id) == ["awaiting_approval"]
    return admitted, approval_for(hotel, admitted.run_id)


def approvals_of(run_id: str) -> str:
    return sql_value(f"SELECT count(*) FROM public.agent_tool_approvals WHERE run_id = '{run_id}';")


def inject_as_owner(sql: str) -> None:
    """Fault injection ONLY: forge a pre-254 ("legacy") row by suspending the new guard as the table owner."""
    # One transaction: if the forged write fails, no guard can be left disabled for later tests. Both the H2 binding
    # guard (which freezes the stored flag) and the 254 guard are suspended to model a row written before 254.
    # A pre-254 row is also pre-262: the 262 deferred transition-audit trigger is suspended too (a queued deferred event
    # would otherwise refuse the re-enabling ALTER TABLE with "pending trigger events"). Assertions are unchanged.
    guards = ("agent_tool_approvals_guard_update", INDEPENDENT_FLAG_ONLY, "agent_tool_approvals_transition_audit")
    off = "".join(f"ALTER TABLE public.agent_tool_approvals DISABLE TRIGGER {g};\n" for g in guards)
    on = "".join(f"ALTER TABLE public.agent_tool_approvals ENABLE TRIGGER {g};\n" for g in guards)
    run_sql(f"BEGIN;\n{off}{sql}\n{on}COMMIT;")


# --- requesting --------------------------------------------------------------------------------------------------------

def test_worker_requesting_a_self_approvable_medium_risk_approval_is_refused():
    hotel = make_gateway_hotel()
    admitted = admit(hotel, ASSIGN, assign_args(hotel))
    token = claimed(admitted.run_id)
    err = db_refusal(lambda: gstore().request_approval(
        run_id=admitted.run_id, fencing_token=token, worker_id="it-hostile-worker", invocation_id=admitted.invocation_id,
        approval_policy_id=SELF_POLICY, approver_may_be_initiator=True, ttl_seconds=600))
    assert "medium risk tool write requires an approver other than its initiator" in err
    assert approvals_of(admitted.run_id) == "0"  # nothing was created; the whole RPC rolled back


def test_direct_approval_inserts_must_match_the_reviewed_spec_and_invocation():
    hotel = make_gateway_hotel()
    admitted = admit(hotel, ASSIGN, assign_args(hotel))
    inv = f"(SELECT i FROM public.agent_tool_invocations i WHERE i.id = '{admitted.invocation_id}')"

    def insert(flag="false", roles="ARRAY['chief_engineer','gm']", resource="(x.i).resource_id", tool_version="(x.i).tool_version"):
        return (f"INSERT INTO public.agent_tool_approvals (tenant_id, run_id, invocation_id, agent_id, agent_version, "
                f"tool_id, tool_version, resource_type, resource_id, action_digest, initiated_by_user_id, "
                f"approval_policy_id, approver_may_be_initiator, required_approver_roles, expires_at) "
                f"SELECT (x.i).tenant_id, (x.i).run_id, (x.i).id, (x.i).agent_id, (x.i).agent_version, (x.i).tool_id, "
                f"{tool_version}, (x.i).resource_type, {resource}, (x.i).action_digest, (x.i).initiated_by_user_id, "
                f"'{SELF_POLICY}', {flag}, {roles}, now() + interval '10 minutes' FROM (SELECT {inv} AS i) x;")

    assert "requires an approver other than its initiator" in sql_refusal(insert(flag="true"))
    assert "approver roles must equal the reviewed tool roles" in sql_refusal(insert(roles="ARRAY['engineer']"))
    assert "must bind exactly its write invocation" in sql_refusal(insert(resource="gen_random_uuid()"))
    assert "only for reviewed gateway writes" in sql_refusal(insert(tool_version="99"))
    run_sql(f"BEGIN; SET LOCAL ROLE service_role; {insert()} ROLLBACK;")  # the exact reviewed shape is accepted


# --- the request can never be rewritten ----------------------------------------------------------------------------

def test_a_requested_approval_cannot_be_made_self_approvable_widened_or_extended():
    # regression guard: 241's binding guard keeps freezing the stored flag, roles, initiator and expiry after 254
    hotel = make_gateway_hotel()
    _, approval = to_waiting(hotel)
    where = f"WHERE id = '{approval['id']}';"
    for assignment in ("approver_may_be_initiator = true", "required_approver_roles = ARRAY['engineer']",
                       f"initiated_by_user_id = '{hotel.gm}'", "expires_at = expires_at + interval '1 hour'"):
        assert "binding columns are immutable" in sql_refusal(
            f"UPDATE public.agent_tool_approvals SET {assignment} {where}"), assignment


# --- deciding --------------------------------------------------------------------------------------------------------

def test_the_initiator_cannot_approve_through_the_rpc_or_a_direct_update():
    hotel = make_gateway_hotel()
    admitted, approval = to_waiting(hotel)
    assert decide(hotel, approval["id"], hotel.chief) == {"ok": False, "reason": "self_approval_forbidden"}
    assert "cannot be approved by its initiator" in sql_refusal(
        f"UPDATE public.agent_tool_approvals SET state = 'approved', decided_by_user_id = '{hotel.chief}', "
        f"decided_role = 'chief_engineer', decided_at = now() WHERE id = '{approval['id']}';")
    assert approval_for(hotel, admitted.run_id)["state"] == "requested"
    # the independent manager still can, and the write executes exactly once
    assert decide(hotel, approval["id"], hotel.gm)["ok"] is True
    assert drain_run(gateway_worker(), admitted.run_id)[0] == "run_succeeded"
    assert assigned_to(hotel.work_order) == hotel.engineer_a and audit_rows(hotel.work_order) == 1


def test_a_legacy_self_approvable_flag_no_longer_lets_the_initiator_approve():
    hotel = make_gateway_hotel()
    admitted, approval = to_waiting(hotel)
    inject_as_owner(f"UPDATE public.agent_tool_approvals SET approver_may_be_initiator = true "
                    f"WHERE id = '{approval['id']}';")
    # the 243 RPC trusts the stored flag, so it reaches the UPDATE -- and the database refuses it
    assert "cannot be approved by its initiator" in db_refusal(lambda: decide(hotel, approval["id"], hotel.chief))
    assert approval_for(hotel, admitted.run_id)["state"] == "requested"
    assert run_row(hotel.tenant_id, admitted.run_id)["state"] == "awaiting_approval"


def test_a_legacy_self_approved_write_cannot_execute_or_be_consumed():
    hotel = make_gateway_hotel()
    admitted, approval = to_waiting(hotel)
    inject_as_owner(f"UPDATE public.agent_tool_approvals SET approver_may_be_initiator = true, state = 'approved', "
                    f"decided_by_user_id = '{hotel.chief}', decided_role = 'chief_engineer', decided_at = now() "
                    f"WHERE id = '{approval['id']}';")
    run_sql(f"UPDATE public.agent_runs SET state = 'queued' WHERE id = '{admitted.run_id}';"
            f"SELECT public.agent__dispatch('{admitted.run_id}', 0);")
    token = claimed(admitted.run_id)
    digest = sql_value(f"SELECT action_digest FROM public.agent_tool_invocations WHERE id = '{admitted.invocation_id}';")
    err = db_refusal(lambda: gstore().execute_work_order_assign(
        run_id=admitted.run_id, fencing_token=token, worker_id="it-hostile-worker",
        invocation_id=admitted.invocation_id, action_digest=digest))
    assert "requires a valid independent approval" in err
    # the domain mutation, its audit row, the ledger row and the consumption all rolled back together
    assert assigned_to(hotel.work_order) == "" and audit_rows(hotel.work_order) == 0
    assert sql_value(f"SELECT count(*) FROM public.agent_tool_executions WHERE run_id = '{admitted.run_id}';") == "0"
    assert sql_value(f"SELECT consumed_at IS NULL FROM public.agent_tool_approvals WHERE id = '{approval['id']}';") == "t"


# --- consumption, ledger and replay ---------------------------------------------------------------------------------

def test_forged_consumption_and_forged_success_rows_are_refused_and_replay_is_single_use():
    hotel = make_gateway_hotel()
    admitted, approval = to_waiting(hotel)
    assert decide(hotel, approval["id"], hotel.gm)["ok"] is True
    assert "consumed only by its own execution" in sql_refusal(
        f"UPDATE public.agent_tool_approvals SET consumed_at = now(), consumed_by_execution_id = gen_random_uuid() "
        f"WHERE id = '{approval['id']}';")
    forged = (f"INSERT INTO public.agent_tool_executions (tenant_id, run_id, invocation_id, tool_id, tool_version, "
              f"action_digest, idempotency_key, approval_id, fencing_token, worker_id, state) "
              f"SELECT tenant_id, run_id, id, tool_id, tool_version, action_digest, idempotency_key, {{appr}}, 1, "
              f"'it-hostile-worker', 'succeeded' FROM public.agent_tool_invocations WHERE id = '{admitted.invocation_id}';")
    assert "requires a valid independent approval" in sql_refusal(forged.format(appr="NULL"))
    assert "must belong to its invocation" in sql_refusal(forged.format(appr="gen_random_uuid()"))
    # the genuine path is untouched and single-use
    assert drain_run(gateway_worker(), admitted.run_id)[0] == "run_succeeded"
    assert sql_value(f"SELECT count(*) FROM public.agent_tool_executions WHERE run_id = '{admitted.run_id}';") == "1"
    assert "already consumed" in sql_refusal(
        f"UPDATE public.agent_tool_approvals SET consumed_at = now() WHERE id = '{approval['id']}';")
    assert "requires a valid independent approval" in sql_refusal(forged.format(appr=f"'{approval['id']}'"))


# --- authority, tenancy, concurrency ---------------------------------------------------------------------------------

def test_wrong_tenant_and_demoted_approvers_are_refused():
    a, b = make_gateway_hotel(), make_gateway_hotel()
    _, approval = to_waiting(a)
    assert decide(a, approval["id"], b.gm, tenant_id=b.tenant_id) == {"ok": False, "reason": "not_found"}
    assert decide(a, approval["id"], b.gm)["reason"] == "approver_not_authorized"  # not a member of hotel A
    run_sql(f"UPDATE public.user_roles SET role = 'engineer' WHERE user_id = '{a.gm}' AND tenant_id = '{a.tenant_id}';")
    assert decide(a, approval["id"], a.gm)["reason"] == "approver_not_authorized"  # current role re-read, not cached


def test_concurrent_decisions_resolve_to_exactly_one_independent_outcome():
    from agent_specialists_support import _person

    hotel = make_gateway_hotel()
    chief_b = _person(new_client(), hotel.tenant_id, "chief-b", "chief_engineer")
    for _ in range(3):
        admitted, approval = to_waiting(hotel)
        results, barrier = {}, threading.Barrier(3)

        def attempt(label, actor, decision):
            barrier.wait()
            try:
                results[label] = decide(hotel, approval["id"], actor, decision)
            except APIError as err:  # pragma: no cover - a refusal raised by the database is also acceptable
                results[label] = {"ok": False, "reason": str(err)}

        threads = [threading.Thread(target=attempt, args=args) for args in (
            ("self", hotel.chief, "approve"), ("gm", hotel.gm, "approve"), ("chief_b", chief_b, "reject"))]
        [t.start() for t in threads]
        [t.join(timeout=60) for t in threads]
        assert results["self"]["ok"] is False
        assert [label for label, r in results.items() if r.get("ok")] in (["gm"], ["chief_b"]), results
        final = approval_for(hotel, admitted.run_id)
        assert final["state"] in ("approved", "rejected") and final["decided_by_user_id"] != hotel.chief
        reset_gateway_state()


# --- Housekeeping (high risk, H5 handoff path) ---------------------------------------------------------------------

def test_housekeeping_high_risk_assignment_enforces_independence_at_the_database():
    from test_agent_specialists_handoff import _proposal

    from agent_specialists_support import make_h5_hotel, reset_all, submit

    reset_all()
    hotel = make_h5_hotel()
    admission = submit(hotel, _proposal(hotel))  # initiator: hotel.supervisor
    token = claimed(admission.gateway_run_id)
    err = db_refusal(lambda: gstore().request_approval(
        run_id=admission.gateway_run_id, fencing_token=token, worker_id="it-hostile-worker",
        invocation_id=admission.invocation_id, approval_policy_id=SELF_POLICY, approver_may_be_initiator=True,
        ttl_seconds=600))
    assert "high risk tool write requires an approver other than its initiator" in err
    # the honest request (independent policy) goes through on the same claim
    result = gstore().request_approval(
        run_id=admission.gateway_run_id, fencing_token=token, worker_id="it-hostile-worker",
        invocation_id=admission.invocation_id, approval_policy_id="human_approval.independent_manager.v1",
        approver_may_be_initiator=False, ttl_seconds=600)
    assert result["outcome"] == "awaiting_approval"
    approval_id = str(result["approval_id"])
    assert "cannot be approved by its initiator" in sql_refusal(
        f"UPDATE public.agent_tool_approvals SET state = 'approved', decided_by_user_id = '{hotel.supervisor}', "
        f"decided_role = 'housekeeping_supervisor', decided_at = now() WHERE id = '{approval_id}';")
    assert decide(hotel, approval_id, hotel.supervisor) == {"ok": False, "reason": "self_approval_forbidden"}
    assert decide(hotel, approval_id, hotel.supervisor_b)["ok"] is True
    assert sql_value(f"SELECT decided_by_user_id::text FROM public.agent_tool_approvals WHERE id = '{approval_id}';") \
        == hotel.supervisor_b
    reset_all()


def test_every_reviewed_write_is_medium_or_high_risk_so_none_may_be_self_approved():
    out = sql_value("""
      SELECT string_agg(DISTINCT s->>'risk', ',' ORDER BY s->>'risk') FROM (
        SELECT public.agent__gateway_tool_spec(a, av, t, tv) AS s
          FROM unnest(ARRAY['engineering.dispatch_assistant', 'housekeeping.room_readiness_assistant',
                            'harness.synthetic', 'harness.orchestrator']) a,
               generate_series(1, 3) av,
               unnest(ARRAY['engineering.work_orders.assign', 'housekeeping.room_assignments.assign']) t,
               generate_series(1, 3) tv) x
       WHERE s->>'access' = 'write';""")
    assert out == "high,medium"
