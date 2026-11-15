"""H4 customer billing against a real migrated database: holds, dispatch guard, charges, consent, races, immutability."""
from __future__ import annotations

import threading
import uuid
from decimal import Decimal

import pytest

from agent_billing_support import (
    D,
    OP_A,
    OP_B,
    approve_policy,
    authorize,
    bdispatch,
    breserve,
    bsettle,
    bstore,
    charges_of,
    hold_of,
    ledger_row,
    make_billing_hotel,
    set_mode,
    settled,
)
from agent_execution_support import requires_db
from agent_orchestrator_support import attempt_state, ledger, planning_run, reserve, reset_spend_state, run_sql, sql_value
from services.agent_billing.pricing import PolicyRates, quote_credits
from services.agent_orchestrator.budget_store import Settlement

pytestmark = requires_db


@pytest.fixture(autouse=True)
def billing():
    reset_spend_state()
    set_mode("enforced")
    try:
        yield
    finally:
        set_mode("disabled")


# ---- mode / pass-through ------------------------------------------------------------------------------------------

def test_disabled_mode_is_exactly_h3_no_hold_no_charge():
    set_mode("disabled")
    bh = make_billing_hotel(included=100)
    c = planning_run(bh.hotel)
    r = breserve(c)
    assert r.ok and r.attempt.state == "reserved"
    assert bdispatch(c, r.attempt.attempt_id).ok
    assert bsettle(c, r.attempt.attempt_id, settled("0.001")).ok
    assert hold_of(r.attempt.attempt_id) == {}
    assert charges_of(r.attempt.attempt_id) == []
    assert D(ledger_row(bh.tenant_id).get("agent_credits_used", 0)) == 0


def test_missing_policy_fails_closed_and_releases_the_provider_reservation():
    bh = make_billing_hotel(included=100, policy=False)
    c = planning_run(bh.hotel)
    r = breserve(c)
    assert not r.ok and r.reason == "customer_pricing_policy_missing"
    state = sql_value(f"SELECT state || ':' || error_code FROM public.agent_model_attempts WHERE run_id = '{c.run_id}';")
    assert state == "released:customer_pricing_policy_missing"


def test_policy_ledger_mismatch_and_inactive_subscription_fail_closed():
    bh = make_billing_hotel(included=100)
    approve_policy(bh, included="50")  # contradicts the subscription allowance of 100
    c = planning_run(bh.hotel)
    assert breserve(c).reason == "customer_pricing_policy_ledger_mismatch"
    bh2 = make_billing_hotel(included=100, plan_status="cancelled")
    assert breserve(planning_run(bh2.hotel)).reason == "customer_subscription_not_billable"


# ---- the happy path and exact arithmetic ------------------------------------------------------------------------

def test_hold_dispatch_settle_charges_exactly_once_with_exact_rounding():
    bh = make_billing_hotel(included=100, markup="2.5", minimum="0.01")
    c = planning_run(bh.hotel)
    r = breserve(c, exposure=Decimal("0.005"))
    assert r.ok
    hold = hold_of(r.attempt.attempt_id)
    assert D(hold["held_credits"]) == Decimal("0.6250") and D(hold["held_overage_credits"]) == 0
    assert D(ledger_row(bh.tenant_id)["agent_held_credits"]) == Decimal("0.6250")
    assert bdispatch(c, r.attempt.attempt_id).ok
    assert bsettle(c, r.attempt.attempt_id, settled("0.00123457")).ok
    expected = quote_credits(Decimal("0.00123457"), PolicyRates(Decimal("0.02"), Decimal("2.5"), Decimal("0.01")))
    assert expected == Decimal("0.1544")  # 0.00123457 * 2.5 / 0.02 = 0.15432125 -> ceil to 0.1544
    (charge,) = charges_of(r.attempt.attempt_id)
    assert D(charge["credits"]) == expected and D(charge["included_credits"]) == expected
    assert charge["ledger_applied"] is True and D(charge["provider_cost_usd"]) == Decimal("0.00123457")
    row = ledger_row(bh.tenant_id)
    assert D(row["credits_used"]) == expected and D(row["agent_credits_used"]) == expected
    assert D(row["agent_held_credits"]) == 0
    # A replayed settlement (retry after a lost response) never charges twice.
    again = bsettle(c, r.attempt.attempt_id, settled("0.00123457"))
    assert not again.ok and again.reason == "already_settled"
    assert len(charges_of(r.attempt.attempt_id)) == 1


def test_minimum_credits_and_overrun_never_charge_above_the_hold():
    bh = make_billing_hotel(included=100, minimum="0.05")
    c = planning_run(bh.hotel)
    r = breserve(c, exposure=Decimal("0.003"))  # hold 0.15 credits
    assert bdispatch(c, r.attempt.attempt_id).ok
    bsettle(c, r.attempt.attempt_id, settled("0.004"))  # provider overran: 0.20 credits
    (charge,) = charges_of(r.attempt.attempt_id)
    assert D(charge["credits"]) == Decimal("0.15") and D(charge["uncharged_overrun_credits"]) == Decimal("0.05")
    c2 = planning_run(bh.hotel)
    r2 = breserve(c2)
    bdispatch(c2, r2.attempt.attempt_id)
    bsettle(c2, r2.attempt.attempt_id, settled("0"))
    assert D(charges_of(r2.attempt.attempt_id)[0]["credits"]) == Decimal("0.05")


def test_provider_rejection_releases_the_hold_without_charge():
    bh = make_billing_hotel(included=100)
    c = planning_run(bh.hotel)
    r = breserve(c)
    bdispatch(c, r.attempt.attempt_id)
    bsettle(c, r.attempt.attempt_id, Settlement(outcome="released", error_code="rate_limited"))
    assert hold_of(r.attempt.attempt_id)["state"] == "released"
    assert charges_of(r.attempt.attempt_id) == []
    assert D(ledger_row(bh.tenant_id)["agent_held_credits"]) == 0


# ---- the dispatch guard ------------------------------------------------------------------------------------------

def test_direct_h3_dispatch_cannot_bypass_customer_billing():
    bh = make_billing_hotel(included=100)
    c = planning_run(bh.hotel)
    plain = reserve(c, exposure=Decimal("0.005"))  # bare H3 RPC: no hold
    assert plain.ok
    with pytest.raises(Exception) as exc:
        ledger().dispatch(attempt_id=plain.attempt.attempt_id, run_id=c.run_id, fencing_token=c.token,
                          worker_id=c.worker)
    assert "customer_billing_hold_required" in str(exc.value)
    assert attempt_state(plain.attempt.attempt_id) == "reserved"
    # The H4 dispatch refuses it cleanly and releases the provider reservation.
    refused = bdispatch(c, plain.attempt.attempt_id)
    assert not refused.ok and refused.released and refused.reason == "customer_hold_missing"
    assert attempt_state(plain.attempt.attempt_id) == "released"


def test_policy_change_between_reserve_and_dispatch_releases_both():
    bh = make_billing_hotel(included=100)
    c = planning_run(bh.hotel)
    r = breserve(c)
    approve_policy(bh, included="100", markup="3")
    refused = bdispatch(c, r.attempt.attempt_id)
    assert not refused.ok and refused.reason == "customer_pricing_policy_changed"
    assert hold_of(r.attempt.attempt_id)["state"] == "released"
    assert attempt_state(r.attempt.attempt_id) == "released"


# ---- overage consent ---------------------------------------------------------------------------------------------

def test_overage_is_off_by_default_and_a_spend_cap_is_not_consent():
    bh = make_billing_hotel(included=0, cap_cents=50_000)
    r = breserve(planning_run(bh.hotel))
    assert not r.ok and r.reason == "customer_overage_not_authorized"


def test_only_the_hotels_active_gm_can_authorize_with_acknowledged_terms():
    bh = make_billing_hotel(included=0, hard_cap="0.10")
    other = make_billing_hotel(included=0)
    assert authorize(bh, 1, user=bh.hotel.chief)["reason"] == "not_authorized"
    assert authorize(bh, 1, user=other.gm)["reason"] == "not_authorized"          # a GM of another hotel
    assert authorize(bh, 1, exposure="0.01")["reason"] == "exposure_not_acknowledged"
    assert authorize(bh, 1, policy_id=other.policy_id)["reason"] == "terms_changed"
    assert authorize(bh, 6)["reason"] == "exceeds_hard_cap"                       # 6 credits = $0.12 > $0.10
    ok = authorize(bh, 5)
    assert ok["ok"] and ok["max_exposure_usd"] == "0.10" and ok["version"] == 1
    events = sql_value(f"SELECT string_agg(event_type, ',' ORDER BY id) FROM public.agent_customer_billing_events "
                       f"WHERE tenant_id = '{bh.tenant_id}' AND event_type LIKE 'overage%';")
    assert events == "overage_authorized"


def test_authorized_limit_is_exact_at_the_boundary_and_revocation_is_immediate():
    bh = make_billing_hotel(included=0)
    assert authorize(bh, 1)["ok"]
    claims = [planning_run(bh.hotel, worker=f"it-h4-b{i}") for i in range(5)]
    results = [breserve(c, exposure=Decimal("0.005")) for c in claims]  # 0.25 credits each
    assert [r.ok for r in results] == [True, True, True, True, False]
    assert results[4].reason == "customer_overage_limit_reached"
    row = ledger_row(bh.tenant_id)
    assert D(row["agent_held_overage_credits"]) == Decimal("1.0000")
    # Opt-out: an undispatched overage hold can no longer reach the network.
    assert bstore().revoke_overage(tenant_id=bh.tenant_id, user_id=bh.gm)["ok"]
    refused = bdispatch(claims[0], results[0].attempt.attempt_id)
    assert not refused.ok and refused.reason == "customer_overage_authorization_revoked"
    assert hold_of(results[0].attempt.attempt_id)["state"] == "released"
    assert not breserve(planning_run(bh.hotel, worker="it-h4-b9")).ok


def test_accrued_overage_survives_revocation_and_is_recorded_exactly():
    bh = make_billing_hotel(included=0)
    authorize(bh, 2)
    c = planning_run(bh.hotel)
    r = breserve(c, exposure=Decimal("0.005"))
    bdispatch(c, r.attempt.attempt_id)
    bstore().revoke_overage(tenant_id=bh.tenant_id, user_id=bh.gm)  # after dispatch: the call already ran
    bsettle(c, r.attempt.attempt_id, settled("0.004"))
    (charge,) = charges_of(r.attempt.attempt_id)
    assert D(charge["overage_credits"]) == Decimal("0.2") and D(charge["overage_usd"]) == Decimal("0.004")
    row = ledger_row(bh.tenant_id)
    assert D(row["agent_overage_credits"]) == Decimal("0.2") and D(row["agent_overage_usd"]) == Decimal("0.004")


def test_hard_cap_and_subscription_cap_bound_overage():
    bh = make_billing_hotel(included=0, hard_cap="0.01")
    assert authorize(bh, 1)["reason"] == "exceeds_hard_cap"
    bh2 = make_billing_hotel(included=0, cap_cents=9901)  # 1 cent of room above the base fee
    assert authorize(bh2, 1)["ok"]
    results = [breserve(planning_run(bh2.hotel, worker=f"it-h4-c{i}"), exposure=Decimal("0.005")) for i in range(3)]
    assert [r.ok for r in results] == [True, True, False]  # 0.5 + 0.5 cents fit; the third would exceed the cap
    assert results[2].reason == "customer_subscription_spend_cap_reached"


def test_concurrent_reservations_never_exceed_the_authorized_limit():
    bh = make_billing_hotel(included=0)
    authorize(bh, 1)
    claims = [planning_run(bh.hotel, worker=f"it-h4-r{i}") for i in range(8)]
    out: list = [None] * 8
    gate = threading.Barrier(8)

    def go(i):
        gate.wait()
        out[i] = breserve(claims[i], exposure=Decimal("0.005"))

    threads = [threading.Thread(target=go, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sum(1 for r in out if r.ok) == 4
    assert all(r.reason == "customer_overage_limit_reached" for r in out if not r.ok)
    assert D(ledger_row(bh.tenant_id)["agent_held_overage_credits"]) == Decimal("1.0000")


def test_concurrent_settlement_and_reconciliation_charge_once():
    bh = make_billing_hotel(included=100)
    c = planning_run(bh.hotel)
    r = breserve(c)
    bdispatch(c, r.attempt.attempt_id)
    # Crash between H3 settle and the H4 charge: the bare H3 settle commits, the hold stays open.
    assert ledger().settle(attempt_id=r.attempt.attempt_id, fencing_token=c.token, settlement=settled("0.002")).ok
    assert hold_of(r.attempt.attempt_id)["state"] == "held"
    results = []
    gate = threading.Barrier(4)

    def go(apply):
        gate.wait()
        if apply:
            results.append(bstore().reconcile(dry_run=False, limit=50, actor="it-rec"))
        else:
            results.append(bsettle(c, r.attempt.attempt_id, settled("0.002")))

    threads = [threading.Thread(target=go, args=(i % 2 == 0,)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(charges_of(r.attempt.attempt_id)) == 1
    assert hold_of(r.attempt.attempt_id)["state"] == "converted"
    assert D(ledger_row(bh.tenant_id)["agent_credits_used"]) == Decimal("0.1")


# ---- reconciliation ----------------------------------------------------------------------------------------------

def test_uncertain_and_unreconciled_usage_is_never_charged_until_evidence_exists():
    bh = make_billing_hotel(included=100)
    c = planning_run(bh.hotel)
    r = breserve(c)
    bdispatch(c, r.attempt.attempt_id)
    bsettle(c, r.attempt.attempt_id, Settlement(outcome="uncertain", error_code="timeout_after_dispatch"))
    assert hold_of(r.attempt.attempt_id)["state"] == "awaiting_reconciliation"
    dry = bstore().reconcile(dry_run=True)
    assert int(dry["operator_action_required"]["awaiting_provider_reconciliation"]["count"]) >= 1
    bstore().reconcile(dry_run=False, actor="it-rec")
    assert charges_of(r.attempt.attempt_id) == []
    summary = bstore().summary(tenant_id=bh.tenant_id)
    assert D(summary["pending_reconciliation_credits"]) == Decimal("0.25")
    # Operator reconciles the provider expense with evidence (H3) -> the reconciler charges from that evidence.
    done = ledger().reconcile(tenant_id=bh.tenant_id, attempt_id=r.attempt.attempt_id, resolution="settled",
                              actual_usd=Decimal("0.001"), operator=OP_A, evidence_code="provider_dashboard")
    assert done["ok"]
    out = bstore().reconcile(dry_run=False, actor="it-rec")
    assert out["outcomes"].get("charged", 0) >= 1
    assert D(charges_of(r.attempt.attempt_id)[0]["credits"]) == Decimal("0.05")
    again = bstore().reconcile(dry_run=False, actor="it-rec")
    assert len(charges_of(r.attempt.attempt_id)) == 1 and again["ok"]


def test_missing_provider_usage_stays_pending():
    bh = make_billing_hotel(included=100)
    c = planning_run(bh.hotel)
    r = breserve(c)
    bdispatch(c, r.attempt.attempt_id)
    bsettle(c, r.attempt.attempt_id, Settlement(outcome="unreconciled", usage_status="unreported",
                                                cost_status="unreconciled", cost_cause="usage_unreported"))
    assert hold_of(r.attempt.attempt_id)["state"] == "awaiting_reconciliation"
    assert charges_of(r.attempt.attempt_id) == []


def test_dry_run_changes_nothing_and_reports_metadata_only():
    bh = make_billing_hotel(included=100)
    c = planning_run(bh.hotel)
    r = breserve(c)
    bdispatch(c, r.attempt.attempt_id)
    ledger().settle(attempt_id=r.attempt.attempt_id, fencing_token=c.token, settlement=settled("0.002"))
    dry = bstore().reconcile(dry_run=True, limit=500)
    assert dry["dry_run"] is True and dry["outcomes"].get("would_charge", 0) >= 1
    assert hold_of(r.attempt.attempt_id)["state"] == "held" and charges_of(r.attempt.attempt_id) == []
    assert dry["operator_action_required"]["aggregate_drift"] == []


def test_charge_after_the_period_is_finalized_is_late_and_does_not_rewrite_history():
    bh = make_billing_hotel(included=100)
    c = planning_run(bh.hotel)
    r = breserve(c)
    bdispatch(c, r.attempt.attempt_id)
    run_sql(f"UPDATE public.credit_ledger SET is_finalized = true, finalized_at = now() WHERE tenant_id = '{bh.tenant_id}';")
    bsettle(c, r.attempt.attempt_id, settled("0.002"))
    (charge,) = charges_of(r.attempt.attempt_id)
    assert charge["late"] is True and charge["ledger_applied"] is False
    row = ledger_row(bh.tenant_id)
    assert D(row["credits_used"]) == 0 and D(row["agent_held_credits"]) == 0


# ---- adjustments, immutability, tenancy, privileges ---------------------------------------------------------------

def test_adjustments_are_two_person_compensating_and_bounded():
    bh = make_billing_hotel(included=0)
    authorize(bh, 2)
    c = planning_run(bh.hotel)
    r = breserve(c)
    bdispatch(c, r.attempt.attempt_id)
    bsettle(c, r.attempt.attempt_id, settled("0.005"))
    (charge,) = charges_of(r.attempt.attempt_id)
    s = bstore()
    assert s.adjust_charge(tenant_id=bh.tenant_id, charge_id=charge["id"], reduce_credits=Decimal("0.1"), operator=OP_A,
                           approver=OP_A, reason="goodwill")["reason"] == "two_person_approval_required"
    other = make_billing_hotel(included=0)
    assert s.adjust_charge(tenant_id=other.tenant_id, charge_id=charge["id"], reduce_credits=Decimal("0.1"),
                           operator=OP_A, approver=OP_B, reason="goodwill")["reason"] == "not_found"
    ok = s.adjust_charge(tenant_id=bh.tenant_id, charge_id=charge["id"], reduce_credits=Decimal("0.1"), operator=OP_A,
                         approver=OP_B, reason="goodwill")
    assert ok["ok"] and D(ok["overage_credits"]) == Decimal("-0.1")
    assert s.adjust_charge(tenant_id=bh.tenant_id, charge_id=charge["id"], reduce_credits=Decimal("0.2"), operator=OP_A,
                           approver=OP_B, reason="goodwill")["reason"] == "exceeds_original_charge"
    row = ledger_row(bh.tenant_id)
    assert D(row["agent_overage_credits"]) == Decimal("0.15") and D(row["credits_used"]) == Decimal("0.15")
    assert D(charges_of(r.attempt.attempt_id)[0]["credits"]) == Decimal("0.25")  # the original is untouched


def test_financial_records_are_immutable_for_every_writer():
    bh = make_billing_hotel(included=100)
    assert authorize(bh, 1)["ok"]
    c = planning_run(bh.hotel)
    r = breserve(c)
    bdispatch(c, r.attempt.attempt_id)
    bsettle(c, r.attempt.attempt_id, settled("0.002"))
    for stmt in (
        f"UPDATE public.agent_customer_credit_charges SET credits = 0 WHERE attempt_id = '{r.attempt.attempt_id}'",
        f"DELETE FROM public.agent_customer_credit_charges WHERE attempt_id = '{r.attempt.attempt_id}'",
        f"UPDATE public.agent_customer_credit_holds SET held_credits = 9 WHERE attempt_id = '{r.attempt.attempt_id}'",
        f"UPDATE public.agent_customer_pricing_policies SET markup_multiplier = 9 WHERE id = '{bh.policy_id}'",
        f"DELETE FROM public.agent_customer_pricing_policies WHERE id = '{bh.policy_id}'",
        f"UPDATE public.agent_customer_billing_events SET reason_code = 'x' WHERE tenant_id = '{bh.tenant_id}'",
        f"UPDATE public.agent_customer_overage_authorizations SET state = 'revoked' WHERE tenant_id = '{bh.tenant_id}'",
    ):
        with pytest.raises(AssertionError):
            run_sql(stmt + ";")


def test_summaries_are_tenant_scoped():
    a = make_billing_hotel(included=0)
    b = make_billing_hotel(included=0)
    authorize(a, 1)
    assert bstore().summary(tenant_id=b.tenant_id)["authorization"] is None
    assert bstore().summary(tenant_id=a.tenant_id)["authorization"]["state"] == "authorized"


def test_end_users_cannot_reach_any_h4_table_or_function():
    tables = sql_value("""SELECT string_agg(c.relname, ',') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND (c.relname LIKE 'agent_customer_%' OR c.relname LIKE 'agent_billing_%')
        AND c.relkind = 'r'
        AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT')
             OR NOT c.relrowsecurity);""")
    assert not tables, tables
    leaky = sql_value("""SELECT string_agg(p.proname, ',') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND (p.proname LIKE 'agent_customer_%' OR p.proname LIKE 'agent_billing_%'
            OR p.proname LIKE 'agent\\_\\_customer%' OR p.proname LIKE 'agent\\_\\_billing%')
        AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
             OR p.prosecdef OR NOT COALESCE('search_path=""' = ANY (p.proconfig), false));""")
    assert not leaky, leaky


def test_policy_proposals_are_versioned_two_person_and_refuse_non_legacy_credit_price():
    bh = make_billing_hotel(included=10, policy=False)
    s = bstore()
    bad = s.propose_policy(tenant_id=bh.tenant_id, included_credits=Decimal(10), usd_per_credit=Decimal("0.03"),
                           markup_multiplier=Decimal(1), minimum_credits=Decimal(0), hard_cap_usd=Decimal(5),
                           terms_version="t1", operator=OP_A)
    assert bad["reason"] == "usd_per_credit_must_match_legacy_credit_price"
    p = s.propose_policy(tenant_id=bh.tenant_id, included_credits=Decimal(10), usd_per_credit=Decimal("0.02"),
                         markup_multiplier=Decimal(1), minimum_credits=Decimal(0), hard_cap_usd=Decimal(5),
                         terms_version="t1", operator=OP_A)
    assert s.approve_policy(tenant_id=bh.tenant_id, policy_id=p["policy_id"], approver=OP_A)["reason"] == \
        "approver_must_differ_from_proposer"
    assert s.approve_policy(tenant_id=bh.tenant_id, policy_id=p["policy_id"], approver=OP_B)["ok"]
    p2 = s.propose_policy(tenant_id=bh.tenant_id, included_credits=Decimal(10), usd_per_credit=Decimal("0.02"),
                          markup_multiplier=Decimal(2), minimum_credits=Decimal(0), hard_cap_usd=Decimal(5),
                          terms_version="t2", operator=OP_A)
    assert p2["policy_version"] == 2
    s.approve_policy(tenant_id=bh.tenant_id, policy_id=p2["policy_id"], approver=OP_B)
    closed = sql_value(f"SELECT (effective_to IS NOT NULL)::text FROM public.agent_customer_pricing_policies "
                       f"WHERE id = '{p['policy_id']}';")
    assert closed == "true"
    assert s.retire_policy(tenant_id=bh.tenant_id, operator=OP_A, reason="pilot_ended")["closed"] == 1
    assert breserve(planning_run(bh.hotel)).reason == "customer_pricing_policy_missing"


def test_stale_consent_after_a_policy_change_requires_reconfirmation():
    bh = make_billing_hotel(included=0)
    authorize(bh, 1)
    approve_policy(bh, included="0", markup="2")
    summary = bstore().summary(tenant_id=bh.tenant_id)
    assert summary["authorization"]["current_policy"] is False
    assert breserve(planning_run(bh.hotel)).reason == "customer_overage_authorization_stale_policy"


def test_period_rollover_creates_the_new_ledger_from_the_subscription():
    bh = make_billing_hotel(included=7)
    run_sql(f"""UPDATE public.subscriptions SET credits_included = 7 WHERE tenant_id = '{bh.tenant_id}';""")
    assert ledger_row(bh.tenant_id) == {}  # nothing yet this month
    c = planning_run(bh.hotel)
    assert breserve(c).ok
    row = ledger_row(bh.tenant_id)
    assert row["credits_included"] == 7 and row["period_start"].endswith("-01")
    assert uuid.UUID(row["id"])
