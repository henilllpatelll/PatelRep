"""H3 ledger crash recovery, uncertain outcomes, reconciliation, fencing, rollover and database guards (real DB)."""
from __future__ import annotations

from decimal import Decimal

import pytest

from agent_execution_support import requires_db
from agent_orchestrator_support import (
    X,
    attempt_state,
    claim,
    counter,
    events_of,
    expire_lease,
    ledger,
    make_hotel,
    planning_run,
    reserve,
    reset_spend_state,
    run_sql,
    set_budgets,
    sql_value,
    store,
)
from services.agent_orchestrator.budget_store import Settlement

pytestmark = requires_db


@pytest.fixture(autouse=True)
def _clean():
    reset_spend_state()
    yield


def dispatched(c, **kw):
    a = reserve(c, **kw).attempt
    assert ledger().dispatch(attempt_id=a.attempt_id, run_id=c.run_id, fencing_token=c.token, worker_id=c.worker).ok
    return a


def uncertain(a, token):
    return ledger().settle(attempt_id=a.attempt_id, fencing_token=token,
                           settlement=Settlement(outcome="uncertain", error_code="provider_timeout_after_dispatch"))


def test_crash_before_dispatch_is_released_by_recovery():
    hotel = make_hotel()
    set_budgets(hotel)
    c = planning_run(hotel)
    a = reserve(c).attempt
    ledger().recover(stale_seconds=0)
    assert attempt_state(a.attempt_id) == "reserved"  # its worker still holds a live lease: left alone
    expire_lease(c.run_id)
    counts = ledger().recover(stale_seconds=0)
    assert counts["released"] >= 1 and attempt_state(a.attempt_id) == "released"
    assert counter("hotel", hotel.tenant_id) == (0, 0)
    assert "released:recovered_never_dispatched" in events_of(c.run_id)


@pytest.mark.parametrize("label", ["crash_after_dispatch", "crash_after_response_before_settlement"])
def test_crash_after_dispatch_becomes_uncertain_never_released(label):
    # Both crashes look identical to the database: a dispatched attempt with no settlement. The provider may have charged.
    hotel = make_hotel()
    set_budgets(hotel)
    c = planning_run(hotel)
    a = dispatched(c)
    expire_lease(c.run_id)
    assert ledger().recover(stale_seconds=0)["uncertain"] >= 1
    assert attempt_state(a.attempt_id) == "uncertain"
    assert counter("hotel", hotel.tenant_id) == (X, 0)  # exposure retained
    assert ledger().recover(stale_seconds=0)  # repeated sweeps never release it
    assert attempt_state(a.attempt_id) == "uncertain"


def test_timeout_after_dispatch_keeps_exposure_until_reconciled():
    hotel = make_hotel()
    set_budgets(hotel, uncertain=2)
    c = planning_run(hotel)
    a = dispatched(c)
    assert uncertain(a, c.token).state == "uncertain"
    assert counter("hotel", hotel.tenant_id) == (X, 0)
    # a worker cannot "release" an uncertain attempt; only provider evidence or an operator may resolve it
    assert not ledger().settle(attempt_id=a.attempt_id, fencing_token=c.token,
                               settlement=Settlement(outcome="released")).ok
    led = ledger()
    assert led.reconcile(tenant_id=hotel.tenant_id, attempt_id=a.attempt_id, resolution="released", actual_usd=None,
                         operator="it-op", evidence_code="")["reason"] == "operator_and_evidence_required"
    released = led.reconcile(tenant_id=hotel.tenant_id, attempt_id=a.attempt_id, resolution="released",
                             actual_usd=None, operator="it-op", evidence_code="provider_usage_shows_no_charge")
    assert released["ok"] and attempt_state(a.attempt_id) == "released"
    assert counter("hotel", hotel.tenant_id) == (0, 0)
    b = dispatched(c)
    uncertain(b, c.token)
    settled = led.reconcile(tenant_id=hotel.tenant_id, attempt_id=b.attempt_id, resolution="settled",
                            actual_usd=Decimal("0.00150000"), operator="it-op", evidence_code="provider_usage_export")
    assert settled["ok"] and counter("hotel", hotel.tenant_id) == (0, Decimal("0.0015"))
    assert not led.reconcile(tenant_id=hotel.tenant_id, attempt_id=b.attempt_id, resolution="released",
                             actual_usd=None, operator="it-op", evidence_code="again")["ok"]  # no double resolution


def test_late_provider_response_may_settle_an_uncertain_attempt():
    hotel = make_hotel()
    set_budgets(hotel)
    c = planning_run(hotel)
    a = dispatched(c)
    uncertain(a, c.token)
    late = ledger().settle(attempt_id=a.attempt_id, fencing_token=c.token, settlement=Settlement(
        outcome="settled", cost_usd=Decimal("0.0002"), usage_status="reported", cost_status="costed"))
    assert late.ok and late.state == "settled"
    assert counter("hotel", hotel.tenant_id) == (0, Decimal("0.0002"))


def test_unreconciled_response_keeps_exposure():
    hotel = make_hotel()
    set_budgets(hotel)
    c = planning_run(hotel)
    a = dispatched(c)
    result = ledger().settle(attempt_id=a.attempt_id, fencing_token=c.token, settlement=Settlement(
        outcome="unreconciled", usage_status="unreported", cost_status="unreconciled", cost_cause="usage_unreported",
        reported_model="gpt-6-luna", provider_request_id="req_x"))
    assert result.ok and result.state == "unreconciled"
    assert counter("hotel", hotel.tenant_id) == (X, 0)


def test_repeated_uncertain_calls_are_capped_per_run():
    hotel = make_hotel()
    set_budgets(hotel, uncertain=1)
    c = planning_run(hotel)
    uncertain(dispatched(c), c.token)
    denied = reserve(c)
    assert not denied.ok and denied.reason == "uncertain_limit_reached"


def test_dispatch_marker_refuses_and_releases_after_cancel_or_lease_loss():
    hotel = make_hotel()
    set_budgets(hotel)
    c = planning_run(hotel)
    a = reserve(c).attempt
    store().request_cancel(tenant_id=hotel.tenant_id, run_id=c.run_id, requested_by="it")
    d = ledger().dispatch(attempt_id=a.attempt_id, run_id=c.run_id, fencing_token=c.token, worker_id=c.worker)
    assert not d.ok and d.released and d.reason == "run_cancel_requested"
    assert attempt_state(a.attempt_id) == "released" and counter("hotel", hotel.tenant_id) == (0, 0)

    c2 = planning_run(hotel, worker="it-h3-b")
    b = reserve(c2).attempt
    expire_lease(c2.run_id)
    d2 = ledger().dispatch(attempt_id=b.attempt_id, run_id=c2.run_id, fencing_token=c2.token, worker_id=c2.worker)
    assert not d2.ok and d2.reason == "lease_lost" and attempt_state(b.attempt_id) == "released"


def test_emergency_stop_between_reserve_and_dispatch_prevents_the_call():
    hotel = make_hotel()
    set_budgets(hotel)
    c = planning_run(hotel)
    a = reserve(c).attempt
    run_sql("INSERT INTO public.agent_runtime_controls (scope, cost_emergency_stop, updated_by) VALUES "
            "('platform', true, 'it') ON CONFLICT (scope, tenant_id, agent_id) DO UPDATE SET cost_emergency_stop = true;")
    d = ledger().dispatch(attempt_id=a.attempt_id, run_id=c.run_id, fencing_token=c.token, worker_id=c.worker)
    assert not d.ok and d.reason == "cost_emergency_stop" and attempt_state(a.attempt_id) == "released"


def test_lease_takeover_fences_new_spending_but_old_worker_still_records_money():
    hotel = make_hotel()
    set_budgets(hotel)
    c = planning_run(hotel, worker="it-h3-old")
    a = dispatched(c)
    expire_lease(c.run_id)
    new = claim("it-h3-new", run_id=c.run_id)
    assert new.token > c.token
    stale = reserve(c)  # old worker, old token
    assert not stale.ok and stale.reason == "lease_lost"
    # the provider already answered the old worker: that money is recorded even though its lease is gone
    late = ledger().settle(attempt_id=a.attempt_id, fencing_token=c.token, settlement=Settlement(
        outcome="settled", cost_usd=Decimal("0.0001"), usage_status="reported", cost_status="costed"))
    assert late.ok and counter("hotel", hotel.tenant_id) == (0, Decimal("0.0001"))
    assert reserve(new).ok  # the new owner can spend within budget


def test_period_rollover_counts_only_the_current_calendar_month():
    hotel = make_hotel()
    set_budgets(hotel, hotel_limit=X)
    run_sql(f"""INSERT INTO public.agent_model_budget_counters (scope, scope_key, tenant_id, period_start, committed_usd)
                VALUES ('hotel', '{hotel.tenant_id}', '{hotel.tenant_id}',
                        (public.agent__model_period(now()) - interval '1 month')::date, 999);""")
    c = planning_run(hotel)
    assert reserve(c).ok  # last month's spend does not count against this month
    assert sql_value("SELECT public.agent__model_period('2026-01-31T23:59:59Z') || ',' || "
                     "public.agent__model_period('2026-02-01T00:00:00Z') || ',' || "
                     "public.agent__model_period('2026-02-01T05:00:00+06:00');") == "2026-01-01,2026-02-01,2026-01-01"


def test_cross_tenant_access_is_refused():
    a_hotel, b_hotel = make_hotel(), make_hotel()
    set_budgets(a_hotel)
    c = planning_run(a_hotel)
    a = dispatched(c)
    uncertain(a, c.token)
    led = ledger()
    assert led.reconcile(tenant_id=b_hotel.tenant_id, attempt_id=a.attempt_id, resolution="released",
                         actual_usd=None, operator="it-op", evidence_code="x")["reason"] == "not_found"
    assert led.attempts_for_run(tenant_id=b_hotel.tenant_id, run_id=c.run_id) == []
    assert len(led.attempts_for_run(tenant_id=a_hotel.tenant_id, run_id=c.run_id)) == 1


def test_database_guards_refuse_tampering():
    hotel = make_hotel()
    set_budgets(hotel)
    c = planning_run(hotel)
    a = dispatched(c)
    for sql in (
        f"UPDATE public.agent_model_attempts SET state = 'reserved' WHERE id = '{a.attempt_id}';",
        f"UPDATE public.agent_model_attempts SET reserved_usd = 1 WHERE id = '{a.attempt_id}';",
        f"UPDATE public.agent_model_attempts SET tenant_id = gen_random_uuid() WHERE id = '{a.attempt_id}';",
        f"DELETE FROM public.agent_model_attempts WHERE id = '{a.attempt_id}';",
        "UPDATE public.agent_model_price_schedules SET output_per_mtok = 0 WHERE model = 'gpt-6-luna';",
        "DELETE FROM public.agent_model_price_schedules WHERE model = 'gpt-6-luna';",
        "INSERT INTO public.agent_model_price_schedules (provider, model, schedule_version, effective_from, input_per_mtok, "
        "output_per_mtok, source) VALUES ('openai', 'gpt-6-luna', 'openai-cheap', now(), 0, 0, 'forged');",
        "UPDATE public.agent_model_spend_events SET amount_usd = 0;",
        f"UPDATE public.agent_model_budget_counters SET reserved_usd = -1 WHERE scope = 'hotel' AND scope_key = '{hotel.tenant_id}';",
        f"UPDATE public.agent_model_budget_policies SET period_limit_usd = 99999 WHERE tenant_id = '{hotel.tenant_id}';",
    ):
        with pytest.raises(AssertionError):
            run_sql(sql)
    ledger().settle(attempt_id=a.attempt_id, fencing_token=c.token, settlement=Settlement(
        outcome="settled", cost_usd=Decimal("0.0001"), usage_status="reported", cost_status="costed"))
    with pytest.raises(AssertionError):  # committed spend never decreases, even by direct SQL
        run_sql(f"UPDATE public.agent_model_budget_counters SET committed_usd = 0 WHERE scope = 'hotel' "
                f"AND scope_key = '{hotel.tenant_id}';")


def test_end_users_hold_no_privilege_on_the_ledger():
    tables = ("agent_model_enablement", "agent_model_price_schedules", "agent_model_budget_policies",
              "agent_model_budget_counters", "agent_model_attempts", "agent_model_spend_events", "agent_planning_runs")
    names = ",".join(f"'{t}'" for t in tables)
    assert sql_value(f"""SELECT count(*) FROM pg_class c CROSS JOIN unnest(array['anon','authenticated']) r(role_name)
                          WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ({names})
                            AND (has_table_privilege(r.role_name, c.oid, 'SELECT')
                                 OR has_table_privilege(r.role_name, c.oid, 'INSERT')
                                 OR has_table_privilege(r.role_name, c.oid, 'UPDATE')
                                 OR has_table_privilege(r.role_name, c.oid, 'DELETE'));""") == "0"
    assert sql_value(f"SELECT bool_and(relrowsecurity) FROM pg_class WHERE relnamespace = 'public'::regnamespace "
                     f"AND relname IN ({names});") == "t"
    assert sql_value("""SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                         AND (p.proname LIKE 'agent_model%' OR p.proname LIKE 'agent__model%'
                              OR p.proname LIKE 'agent_planning%' OR p.proname LIKE 'agent__planning%')
                         AND (p.prosecdef OR has_function_privilege('anon', p.oid, 'EXECUTE')
                              OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                              OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c = 'search_path=""'));""") == "0"
