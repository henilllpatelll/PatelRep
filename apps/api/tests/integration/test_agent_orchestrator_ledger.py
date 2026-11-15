"""H3 provider-spend ledger against a real migrated database: reservations, limits, idempotency, settlement, races."""
from __future__ import annotations

import threading
import uuid
from decimal import Decimal

import pytest

from agent_execution_support import requires_db
from agent_orchestrator_support import (
    BIG,
    MODEL,
    X,
    attempt_state,
    attempts_of,
    claim,
    counter,
    events_of,
    ledger,
    make_hotel,
    planning_run,
    reserve,
    reset_spend_state,
    run_sql,
    set_budgets,
)
from services.agent_orchestrator.budget_store import Settlement

pytestmark = requires_db


@pytest.fixture(autouse=True)
def _clean():
    reset_spend_state()
    yield


def settle_ok(attempt_id, token, cost, **kw):
    return ledger().settle(attempt_id=attempt_id, fencing_token=token, settlement=Settlement(
        outcome="settled", cost_usd=Decimal(cost), usage_status="reported", cost_status="costed",
        usage={"uncached_input": 100, "output": 10}, reported_model="gpt-6-luna", provider_request_id="req_1",
        provider_response_id="resp_1", **kw))


def test_reserve_dispatch_settle_moves_exposure_to_committed_cost():
    hotel = make_hotel()
    set_budgets(hotel)
    c = planning_run(hotel)
    res = reserve(c)
    assert res.ok and res.attempt.state == "reserved" and res.attempt.reserved_usd == X
    assert counter("hotel", hotel.tenant_id) == (X, 0)
    assert counter("step", c.step_id) == (X, 0)
    d = ledger().dispatch(attempt_id=res.attempt.attempt_id, run_id=c.run_id, fencing_token=c.token, worker_id=c.worker)
    assert d.ok and attempt_state(res.attempt.attempt_id) == "dispatched"
    s = settle_ok(res.attempt.attempt_id, c.token, "0.00012345")
    assert s.ok and s.state == "settled" and not s.overrun
    assert counter("hotel", hotel.tenant_id) == (0, Decimal("0.00012345"))
    assert counter("run", c.run_id) == (0, Decimal("0.00012345"))
    assert events_of(c.run_id) == ["reserved:", "dispatched:", "settled:"]


@pytest.mark.parametrize("setup, reason", [
    (lambda h: None, "budget_policy_missing_hotel"),
    (lambda h: ledger().set_policy(scope="hotel", tenant_id=h.tenant_id, operator="it", period_limit_usd=BIG),
     "budget_policy_missing_agent"),
])
def test_missing_budget_policies_deny_with_no_attempt(setup, reason):
    hotel = make_hotel()
    setup(hotel)
    c = planning_run(hotel)
    res = reserve(c)
    assert not res.ok and res.reason == reason
    assert attempts_of(c.run_id) == 0 and counter("hotel", hotel.tenant_id) == (0, 0)
    assert events_of(c.run_id) == [f"reservation_denied:{reason}"]


@pytest.mark.parametrize("block, reason", [
    ("UPDATE public.agent_model_enablement SET enabled = false", "paid_calls_disabled"),
    ("INSERT INTO public.agent_runtime_controls (scope, cost_emergency_stop, updated_by) VALUES ('platform', true, 'it') "
     "ON CONFLICT (scope, tenant_id, agent_id) DO UPDATE SET cost_emergency_stop = true", "cost_emergency_stop"),
    ("INSERT INTO public.agent_runtime_controls (scope, agent_id, paused, updated_by) "
     "VALUES ('agent', 'harness.orchestrator', true, 'it') "
     "ON CONFLICT (scope, tenant_id, agent_id) DO UPDATE SET paused = true", "agent_paused"),
])
def test_switch_and_emergency_stops_refuse_new_reservations(block, reason):
    hotel = make_hotel()
    set_budgets(hotel)
    c = planning_run(hotel)
    run_sql(block + ";")
    res = reserve(c)
    assert not res.ok and res.reason == reason and attempts_of(c.run_id) == 0


def test_tenant_entitlement_is_rechecked_at_every_reservation():
    hotel = make_hotel()
    set_budgets(hotel)
    c = planning_run(hotel)
    run_sql(f"UPDATE public.tenant_feature_flags SET enabled = false WHERE tenant_id = '{hotel.tenant_id}';")
    assert reserve(c).reason == "tenant_capability_disabled"


def test_unknown_schedule_and_understated_exposure_are_refused():
    hotel = make_hotel()
    set_budgets(hotel)
    c = planning_run(hotel)
    assert reserve(c, model=("openai", "gpt-6-luna", "openai-1999-01-01")).reason == "price_schedule_unavailable"
    assert reserve(c, model=("openai", "gpt-6", "openai-2026-11-14")).reason == "price_schedule_unavailable"
    assert reserve(c, exposure=X - Decimal("0.00000001")).reason == "exposure_understated"
    assert reserve(c, exposure=Decimal("0.000000001")).reason == "invalid_request"  # beyond 1e-8 precision
    assert attempts_of(c.run_id) == 0


def test_reservation_is_idempotent_per_logical_call_and_attempt():
    hotel = make_hotel()
    set_budgets(hotel)
    c = planning_run(hotel)
    key = f"model:{c.run_id}:{c.step_id}:1:1"
    first, again = reserve(c, key=key), reserve(c, key=key)
    assert first.ok and again.ok and again.attempt.replayed
    assert first.attempt.attempt_id == again.attempt.attempt_id
    assert counter("hotel", hotel.tenant_id) == (X, 0)  # reserved once
    conflict = reserve(c, key=key, exposure=X * 2)
    assert not conflict.ok and conflict.reason == "idempotency_conflict"
    second = reserve(c, key=key, attempt=2)  # a retry is a NEW attempt with its own reservation
    assert second.ok and second.attempt.attempt_id != first.attempt.attempt_id
    assert counter("hotel", hotel.tenant_id) == (X * 2, 0)


def test_nested_limits_each_deny_with_their_scope():
    hotel = make_hotel()
    set_budgets(hotel, call=X * 2, step=X * 2, run=X * 2, period=X * 3, hotel_limit=X * 10)
    c = planning_run(hotel)
    assert reserve(c, exposure=X * 3).reason == "call_budget_exceeded"
    assert reserve(c).ok and reserve(c).ok
    assert reserve(c).reason == "run_budget_exceeded"  # run is checked before step in the fixed order
    c2 = planning_run(hotel, worker="it-h3-b")
    assert reserve(c2).ok
    assert reserve(c2).reason == "agent_budget_exceeded"  # agent period: 3 X across both runs
    hotel_b = make_hotel()
    set_budgets(hotel_b, hotel_limit=X, period=X * 5, run=X * 5, step=X * 5, call=X * 5)
    c3 = planning_run(hotel_b, worker="it-h3-c")
    assert reserve(c3).ok and reserve(c3).reason == "hotel_budget_exceeded"


def test_step_limit_is_enforced_independently_of_the_run():
    hotel = make_hotel()
    set_budgets(hotel, call=X, step=X * 2, run=X * 5, period=X * 5)
    c = planning_run(hotel)
    assert reserve(c).ok and reserve(c).ok
    assert reserve(c).reason == "step_budget_exceeded"


def test_platform_limit_applies_across_hotels():
    reserved, committed = counter("platform", "platform")
    assert ledger().set_policy(scope="platform", operator="it", period_limit_usd=reserved + committed + X)["ok"]
    hotel_a, hotel_b = make_hotel(), make_hotel()
    set_budgets(hotel_a)
    set_budgets(hotel_b)
    a, b = planning_run(hotel_a), planning_run(hotel_b, worker="it-h3-b")
    assert reserve(a).ok
    assert reserve(b).reason == "platform_budget_exceeded"


def test_release_returns_exposure_and_double_settlement_is_refused():
    hotel = make_hotel()
    set_budgets(hotel)
    c = planning_run(hotel)
    led = ledger()
    rejected = reserve(c).attempt
    assert led.dispatch(attempt_id=rejected.attempt_id, run_id=c.run_id, fencing_token=c.token, worker_id=c.worker).ok
    released = led.settle(attempt_id=rejected.attempt_id, fencing_token=c.token,
                          settlement=Settlement(outcome="released", error_code="provider_rate_limited"))
    assert released.ok and released.state == "released"
    assert counter("hotel", hotel.tenant_id) == (0, 0)
    ok = reserve(c).attempt
    led.dispatch(attempt_id=ok.attempt_id, run_id=c.run_id, fencing_token=c.token, worker_id=c.worker)
    assert settle_ok(ok.attempt_id, c.token, "0.001").ok
    again = settle_ok(ok.attempt_id, c.token, "0.002")
    assert not again.ok and again.reason == "already_settled"
    late_release = led.settle(attempt_id=ok.attempt_id, fencing_token=c.token, settlement=Settlement(outcome="released"))
    assert not late_release.ok
    assert counter("hotel", hotel.tenant_id) == (0, Decimal("0.001"))


def test_settlement_requires_a_dispatched_attempt_and_its_own_token():
    hotel = make_hotel()
    set_budgets(hotel)
    c = planning_run(hotel)
    a = reserve(c).attempt
    assert settle_ok(a.attempt_id, c.token, "0.001").reason == "not_dispatched"
    ledger().dispatch(attempt_id=a.attempt_id, run_id=c.run_id, fencing_token=c.token, worker_id=c.worker)
    assert settle_ok(a.attempt_id, c.token + 1, "0.001").reason == "not_found"
    bad = ledger().settle(attempt_id=a.attempt_id, fencing_token=c.token,
                          settlement=Settlement(outcome="settled", cost_usd=Decimal("-1"), usage_status="reported",
                                                cost_status="costed"))
    assert bad.reason == "invalid_outcome"


def test_overrun_is_recorded_in_full_and_flagged_never_discarded():
    hotel = make_hotel()
    set_budgets(hotel)
    c = planning_run(hotel)
    a = reserve(c).attempt
    ledger().dispatch(attempt_id=a.attempt_id, run_id=c.run_id, fencing_token=c.token, worker_id=c.worker)
    result = settle_ok(a.attempt_id, c.token, "0.01")  # > 0.003 reserved
    assert result.ok and result.overrun
    assert counter("hotel", hotel.tenant_id) == (0, Decimal("0.01"))
    assert events_of(c.run_id)[-2:] == ["settled:", "overrun_detected:actual_exceeded_reservation"]
    led = ledger()
    assert not led.reconcile(tenant_id=hotel.tenant_id, attempt_id=a.attempt_id, resolution="acknowledged",
                             actual_usd=None, operator="it-op", evidence_code="")["ok"]  # evidence required
    ack = led.reconcile(tenant_id=hotel.tenant_id, attempt_id=a.attempt_id, resolution="acknowledged", actual_usd=None,
                        operator="it-op", evidence_code="provider_invoice_checked")
    assert ack["ok"] and ack["attempt"]["overrun_usd"] == "0.00700000"
    assert ack["attempt"]["reconciliation_required"] is False


def test_concurrent_reservations_never_exceed_the_hotel_limit():
    hotel = make_hotel()
    set_budgets(hotel, hotel_limit=X * 5)
    runs = [planning_run(hotel, worker=f"it-h3-race-{i}") for i in range(8)]
    results, barrier = [], threading.Barrier(16)

    def worker(c, n):
        barrier.wait()
        results.append(reserve(c, key=f"model:{c.run_id}:race:{n}"))

    threads = [threading.Thread(target=worker, args=(runs[i % 8], i)) for i in range(16)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    ok = [r for r in results if r.ok]
    assert len(results) == 16 and len(ok) == 5
    assert {r.reason for r in results if not r.ok} == {"hotel_budget_exceeded"}
    reserved, committed = counter("hotel", hotel.tenant_id)
    assert reserved + committed == X * 5


def test_concurrent_hotels_are_isolated_from_each_other():
    hotels = [make_hotel(), make_hotel()]
    for h in hotels:
        set_budgets(h, hotel_limit=X * 3)
    runs = {h.tenant_id: [planning_run(h, worker=f"it-h3-{h.tenant_id[:6]}-{i}") for i in range(4)] for h in hotels}
    results: dict[str, list] = {h.tenant_id: [] for h in hotels}
    barrier = threading.Barrier(16)

    def worker(tenant, c, n):
        barrier.wait()
        results[tenant].append(reserve(c, key=f"model:{c.run_id}:iso:{n}"))

    threads = [threading.Thread(target=worker, args=(h.tenant_id, runs[h.tenant_id][i % 4], i))
               for h in hotels for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    for h in hotels:
        assert sum(r.ok for r in results[h.tenant_id]) == 3
        assert counter("hotel", h.tenant_id) == (X * 3, 0)


def test_reservations_belong_only_to_the_orchestrator_agent():
    from agent_execution_support import admit as admit_synthetic
    from agent_execution_support import store as h1_store

    hotel = make_hotel()
    set_budgets(hotel)
    admitted = admit_synthetic(h1_store(), hotel.tenant_id, user_id=hotel.gm)
    c = claim("it-h3-syn", run_id=admitted["run_id"])
    assert reserve(c).reason == "agent_not_metered"
    assert MODEL[1] == "gpt-6-luna" and uuid.UUID(c.run_id)
