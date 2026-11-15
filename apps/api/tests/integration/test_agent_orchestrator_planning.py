"""H3 planning runs end to end on a real migrated database: admission, the real H1 worker, the real ledger RPCs and
fake provider transports plugged into the real SDK clients (no paid call is ever made)."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from agent_execution_support import requires_db
from agent_orchestrator_support import (
    QUEUE,
    attempts_of,
    counter,
    expire_lease,
    ledger,
    make_hotel,
    pstore,
    reset_spend_state,
    run_sql,
    set_budgets,
    sql_value,
    store,
)
from middleware.auth import CurrentUser
from services.agent_execution.config import WorkerSettings
from services.agent_execution.identity_authority import SupabaseIdentityAuthority
from services.agent_execution.worker import Worker
from services.agent_harness.provider_pricing import max_exposure
from services.agent_orchestrator.admission import PlanningRefused, admit_planning_run
from services.agent_orchestrator.config import OrchestratorSettings
from services.agent_orchestrator.pricebook import PRICE_SCHEDULES
from tests.smoke.agent_orchestrator_support import SECRET_CANARY, Transport, adapters, openai_ok, status

pytestmark = requires_db
ON = OrchestratorSettings(execution_enabled=True)


@pytest.fixture(autouse=True)
def _clean():
    reset_spend_state()
    yield


def now():
    return datetime.now(timezone.utc)


def plan_text(wo: str, engineer: str) -> str:
    return json.dumps({
        "plan_schema": "patelrep.plan/v1", "outcome": "propose", "agent_id": "engineering.dispatch_assistant",
        "agent_version": 1, "termination": "on_first_failure", "reason_codes": [],
        "steps": [
            {"step_number": 1, "purpose": "gather_context", "depends_on": [],
             "tool_call": {"tool_id": "engineering.work_orders.lookup", "tool_version": 2,
                           "arguments_json": json.dumps({"work_order_id": wo}), "expected_result": "record_summary"}},
            {"step_number": 2, "purpose": "propose_change", "depends_on": [1],
             "tool_call": {"tool_id": "engineering.work_orders.assign", "tool_version": 2,
                           "arguments_json": json.dumps({"work_order_id": wo, "assignee_user_id": engineer,
                                                         "expected_assigned_to": None, "note": None}),
                           "expected_result": "assignment_change"}}]})


def admit(hotel, *, user=None, role="chief_engineer", key=None, wo=None):
    return admit_planning_run(pstore(), CurrentUser(user_id=user or hotel.chief, hotel_id=hotel.tenant_id, role=role),
                              intent="engineering.work_order_dispatch_plan", intent_version=1,
                              work_order_id=wo or hotel.work_order, idempotency_key=key or f"plan-{uuid.uuid4().hex}",
                              app_env="test", settings=ON, clock=now)


def worker(transport, worker_id="it-h3-w1", lease_seconds=30):
    settings = WorkerSettings(enabled=True, synthetic_enabled=False, worker_id=worker_id, lease_seconds=lease_seconds,
                              blocked_retry_seconds=1)
    return Worker(settings, app_env="test", version="it", store_factory=store,
                  authority_factory=lambda client: SupabaseIdentityAuthority(client, clock=now), clock=now,
                  orchestrator_settings=ON, provider_factory=lambda: adapters(transport))


def process(w):
    s = store()
    return w.process_one(s, SupabaseIdentityAuthority(s.client, clock=now))


def run_of(hotel, run_id):
    return store().get_run(tenant_id=hotel.tenant_id, run_id=run_id)


# --- admission -----------------------------------------------------------------------------------------------------------

def test_admission_refusals_are_enforced_in_the_database():
    hotel, other = make_hotel(), make_hotel()
    with pytest.raises(PlanningRefused) as exc:
        admit(hotel, wo=other.work_order)
    assert exc.value.code == "resource_out_of_scope"
    with pytest.raises(PlanningRefused) as exc:
        admit(hotel, user=hotel.engineer_a, role="engineer")
    assert exc.value.code == "actor_not_authorized"  # refused in code before the RPC
    forged = pstore().admit(tenant_id=hotel.tenant_id, user_id=hotel.engineer_a,
                            intent="engineering.work_order_dispatch_plan", intent_version=1, resource_type="work_order",
                            resource_id=hotel.work_order, idempotency_key="forged-key-1", request_digest="b" * 64,
                            correlation_id="c", policy_version="p", deadline_seconds=60, max_attempts=1,
                            step_max_attempts=1)
    assert forged == {"admitted": False, "reason": "actor_not_authorized"}  # the database re-checks the CURRENT role
    no_flag = make_hotel(flag=False)
    with pytest.raises(PlanningRefused) as exc:
        admit(no_flag)
    assert exc.value.code == "tenant_capability_disabled"
    run_sql("UPDATE public.agent_model_enablement SET enabled = false;")
    with pytest.raises(PlanningRefused) as exc:
        admit(hotel)
    assert exc.value.code == "paid_calls_disabled"


def test_admission_is_idempotent_and_the_only_way_in():
    hotel = make_hotel()
    first, again = admit(hotel, key="plan-key-0001"), admit(hotel, key="plan-key-0001")
    assert first.created and not again.created and first.run_id == again.run_id
    planning = pstore().get(tenant_id=hotel.tenant_id, run_id=first.run_id)
    assert planning["intent"] == "engineering.work_order_dispatch_plan" and planning["plan_outcome"] is None
    with pytest.raises(AssertionError) as err:
        run_sql(f"""INSERT INTO public.agent_runs (tenant_id, agent_id, agent_version, principal_type, initiated_by_user_id,
                     trigger_type, idempotency_key, request_digest, correlation_id, policy_version, deadline_at, max_attempts)
                   VALUES ('{hotel.tenant_id}', 'harness.orchestrator', 1, 'human', '{hotel.chief}', 'user_request',
                           'raw-{uuid.uuid4().hex}', repeat('a', 64), 'c', 'p', now() + interval '1 minute', 1);""")
    assert "agent_planning_run_admit" in str(err.value)
    with pytest.raises(AssertionError):
        run_sql(f"UPDATE public.agent_planning_runs SET resource_id = gen_random_uuid() WHERE run_id = '{first.run_id}';")
    with pytest.raises(PlanningRefused) as exc:
        admit_planning_run(pstore(), CurrentUser(user_id=hotel.chief, hotel_id=hotel.tenant_id, role="chief_engineer"),
                           intent="engineering.work_order_dispatch_plan", intent_version=1,
                           work_order_id=hotel.work_order, idempotency_key="plan-key-0002", app_env="production",
                           settings=ON, clock=now)
    assert exc.value.code == "orchestration_disabled"


# --- end to end -------------------------------------------------------------------------------------------------------

def test_worker_plans_through_the_ledger_and_never_touches_operations():
    hotel = make_hotel()
    set_budgets(hotel)
    run_id = admit(hotel).run_id
    transport = Transport([openai_ok(text=plan_text(hotel.work_order, hotel.engineer_a))])
    assert process(worker(transport)) == "run_succeeded"
    assert len(transport.requests) == 1
    planning = pstore().get(tenant_id=hotel.tenant_id, run_id=run_id)
    assert planning["plan_outcome"] == "proposed" and planning["model_attempts"] == 1
    assert planning["plan"]["authorizes_execution"] is False
    assert planning["plan"]["steps"][1]["tool"]["requires_human_approval"] is True
    [attempt] = ledger().attempts_for_run(tenant_id=hotel.tenant_id, run_id=run_id)
    assert attempt["state"] == "settled" and Decimal(attempt["settled_usd"]) == Decimal("0.000177")
    assert attempt["provider_request_id"] == "req_openai_1" and attempt["usage"]["cache_read"] == 200
    assert counter("hotel", hotel.tenant_id) == (0, Decimal("0.000177"))
    run = run_of(hotel, run_id)
    assert run["run"]["state"] == "succeeded" and run["steps"][0]["result_meta"]["plan_digest"] == planning["plan_digest"]
    # proposal-only: no gateway invocation, approval or business change
    assert sql_value(f"SELECT count(*) FROM public.agent_tool_invocations WHERE tenant_id = '{hotel.tenant_id}';") == "0"
    assert sql_value(f"SELECT count(*) FROM public.agent_tool_approvals WHERE tenant_id = '{hotel.tenant_id}';") == "0"
    assert sql_value(f"SELECT COALESCE(assigned_to::text, '') FROM public.work_orders WHERE id = '{hotel.work_order}';") == ""
    assert sql_value(f"SELECT count(*) FROM pgmq.q_{QUEUE} WHERE message->>'run_id' = '{run_id}';") == "0"


def test_missing_budget_policy_fails_the_run_with_zero_provider_calls():
    hotel = make_hotel()
    run_id = admit(hotel).run_id
    transport = Transport([openai_ok(text=plan_text(hotel.work_order, hotel.engineer_a))])
    assert process(worker(transport)) == "run_failed"
    assert transport.requests == [] and attempts_of(run_id) == 0
    run = run_of(hotel, run_id)["run"]
    assert run["last_error_code"] == "budget_policy_missing_hotel"


def test_uncertain_outcome_keeps_exposure_and_leaks_nothing():
    hotel = make_hotel()
    set_budgets(hotel)
    run_id = admit(hotel).run_id
    transport = Transport([status(500), openai_ok(text=plan_text(hotel.work_order, hotel.engineer_a))])
    assert process(worker(transport)) == "run_failed"
    assert len(transport.requests) == 1
    [attempt] = ledger().attempts_for_run(tenant_id=hotel.tenant_id, run_id=run_id)
    assert attempt["state"] == "uncertain" and attempt["reconciliation_required"] is True
    reserved, committed = counter("hotel", hotel.tenant_id)
    assert reserved == Decimal(attempt["reserved_usd"]) and committed == 0
    assert run_of(hotel, run_id)["run"]["last_error_code"] == "provider_outcome_uncertain"
    dump = run_sql(f"""SELECT row_to_json(a)::text FROM public.agent_model_attempts a WHERE run_id = '{run_id}';
                      SELECT row_to_json(e)::text FROM public.agent_model_spend_events e WHERE run_id = '{run_id}';
                      SELECT row_to_json(e)::text FROM public.agent_run_events e WHERE run_id = '{run_id}';
                      SELECT row_to_json(r)::text FROM public.agent_runs r WHERE id = '{run_id}';""")
    assert SECRET_CANARY not in dump and "bad key" not in dump


def test_crash_after_recording_the_plan_replays_without_a_second_paid_call(monkeypatch):
    from services.agent_execution import worker as worker_mod

    hotel = make_hotel()
    set_budgets(hotel)
    run_id = admit(hotel).run_id
    transport = Transport([openai_ok(text=plan_text(hotel.work_order, hotel.engineer_a))])
    original = worker_mod.PlanningStore

    class CrashingStore(original):
        def record_plan(self, **kw):
            result = super().record_plan(**kw)
            expire_lease(run_id)  # the worker "dies" after the plan commit and before the step commit
            return result

    monkeypatch.setattr(worker_mod, "PlanningStore", CrashingStore)
    assert process(worker(transport, "it-h3-crash")) == "lease_lost"
    monkeypatch.setattr(worker_mod, "PlanningStore", original)
    assert process(worker(transport, "it-h3-takeover")) == "run_succeeded"
    assert len(transport.requests) == 1  # the recorded plan was replayed; no new reservation, no new provider call
    assert attempts_of(run_id) == 1
    meta = run_of(hotel, run_id)["steps"][0]["result_meta"]
    assert meta["replayed"] is True and meta["plan_outcome"] == "proposed"


def test_rejected_plans_are_recorded_without_content():
    hotel = make_hotel()
    set_budgets(hotel)
    run_id = admit(hotel).run_id
    other = make_hotel()
    transport = Transport([openai_ok(text=plan_text(other.work_order, hotel.engineer_a))])  # another hotel's record
    assert process(worker(transport)) == "run_succeeded"
    planning = pstore().get(tenant_id=hotel.tenant_id, run_id=run_id)
    assert planning["plan_outcome"] == "rejected" and planning["plan"] is None
    assert planning["reason_codes"] == ["resource_out_of_scope"]


def test_database_and_python_exposure_agree():
    for schedule in PRICE_SCHEDULES:
        for max_in, max_out in ((1, 1), (999, 77), (64_000, 4_096), (100_000, 8_192), (100_001, 1), (272_001, 3)):
            py = max_exposure(schedule, max_input_tokens=max_in, max_output_tokens=max_out)
            db = sql_value(f"SELECT round(public.agent__model_max_exposure(s, {max_in}, {max_out}), 8) "
                           f"FROM public.agent_model_price_schedules s WHERE model = '{schedule.model}' "
                           f"AND schedule_version = '{schedule.schedule_version}';")
            assert Decimal(db) == py, (schedule.model, max_in, max_out)
