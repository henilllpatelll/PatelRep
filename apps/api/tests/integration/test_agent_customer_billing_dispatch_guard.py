"""H4 hardening (migration 250): no caller can dispatch a held attempt whose customer authorization stopped being valid.

Every test reserves through the H4 wrapper (so a live 'held' hold exists), invalidates the customer authorization in one
of the ways a GM or operator can, and then calls the BARE H3 dispatch RPC -- the path that only the database trigger can
stop -- as well as a raw table UPDATE. Migration 249's trigger only checked that a 'held' hold existed; these are the
regression tests for that bypass.
"""
from __future__ import annotations

import time
from decimal import Decimal

import pytest

from agent_billing_support import (
    approve_policy,
    authorize,
    bdispatch,
    breserve,
    bstore,
    hold_of,
    make_billing_hotel,
    set_mode,
)
from agent_execution_support import requires_db
from agent_orchestrator_support import attempt_state, ledger, planning_run, reset_spend_state, run_sql
from batch_support import start_sql

pytestmark = requires_db

GUARD = "customer_billing_authorization_invalid"


@pytest.fixture(autouse=True)
def billing():
    reset_spend_state()
    set_mode("enforced")
    try:
        yield
    finally:
        set_mode("disabled")


def bare_dispatch(c, attempt_id: str) -> str:
    """Call the H3 dispatch RPC directly. Returns 'dispatched', the H3 refusal reason, or the raised error text."""
    try:
        result = ledger().dispatch(attempt_id=attempt_id, run_id=c.run_id, fencing_token=c.token, worker_id=c.worker)
    except Exception as exc:  # noqa: BLE001 -- the trigger raises through PostgREST
        return str(exc)
    return "dispatched" if result.ok else str(result.reason)


def overage_hold(*, limit: int = 1):
    bh = make_billing_hotel(included=0)
    assert authorize(bh, limit)["ok"]
    c = planning_run(bh.hotel)
    r = breserve(c, exposure=Decimal("0.005"))  # 0.25 credits, all overage
    assert r.ok and Decimal(hold_of(r.attempt.attempt_id)["held_overage_credits"]) == Decimal("0.25")
    return bh, c, r.attempt.attempt_id


def assert_blocked(c, attempt_id: str) -> None:
    outcome = bare_dispatch(c, attempt_id)
    assert GUARD in outcome, outcome
    assert attempt_state(attempt_id) == "reserved"
    with pytest.raises(AssertionError) as exc:
        run_sql(f"UPDATE public.agent_model_attempts SET state = 'dispatched', dispatched_at = now() "
                f"WHERE id = '{attempt_id}';")
    assert GUARD in str(exc.value)
    assert attempt_state(attempt_id) == "reserved"


# ---- the three reported bypasses ----------------------------------------------------------------------------------

def test_bare_h3_dispatch_after_gm_revokes_overage_is_refused():
    bh, c, attempt_id = overage_hold()
    assert bstore().revoke_overage(tenant_id=bh.tenant_id, user_id=bh.gm)["ok"]
    assert_blocked(c, attempt_id)
    # The H4 wrapper still refuses cleanly and releases hold + provider reservation together.
    refused = bdispatch(c, attempt_id)
    assert not refused.ok and refused.reason == "customer_overage_authorization_revoked"
    assert hold_of(attempt_id)["state"] == "released" and attempt_state(attempt_id) == "released"


def test_bare_h3_dispatch_after_pricing_policy_change_is_refused():
    bh = make_billing_hotel(included=100)
    c = planning_run(bh.hotel)
    r = breserve(c)
    assert r.ok and hold_of(r.attempt.attempt_id)["held_overage_credits"] in (0, "0", "0.0000")
    approve_policy(bh, included="100", markup="3")
    assert_blocked(c, r.attempt.attempt_id)


def test_bare_h3_dispatch_after_pricing_policy_retired_is_refused():
    bh = make_billing_hotel(included=100)
    c = planning_run(bh.hotel)
    r = breserve(c)
    assert bstore().retire_policy(tenant_id=bh.tenant_id, operator="it-billing-ops-a", reason="pilot_ended")["ok"]
    assert_blocked(c, r.attempt.attempt_id)


def test_bare_h3_dispatch_after_authorization_lowered_below_held_overage_is_refused():
    bh = make_billing_hotel(included=0)
    assert authorize(bh, 2)["ok"]
    claims = [planning_run(bh.hotel, worker=f"it-h4-g{i}") for i in range(8)]
    attempts = [breserve(cl, exposure=Decimal("0.005")) for cl in claims]  # 8 x 0.25 = 2.0 overage credits held
    assert all(a.ok for a in attempts)
    assert authorize(bh, 1)["ok"]  # the GM narrows consent below what is already held
    assert_blocked(claims[0], attempts[0].attempt.attempt_id)


def test_bare_h3_dispatch_after_consent_bound_to_a_superseded_policy_is_refused():
    # The GM re-authorizes after a policy change, but the hold was priced under the old policy.
    bh, c, attempt_id = overage_hold()
    approve_policy(bh, included="0", markup="2")
    assert authorize(bh, 1)["ok"]
    assert_blocked(c, attempt_id)


# ---- still allowed --------------------------------------------------------------------------------------------------

def test_valid_hold_still_dispatches_through_the_bare_rpc_and_the_wrapper():
    bh, c, attempt_id = overage_hold()
    assert bare_dispatch(c, attempt_id) == "dispatched"
    bh2 = make_billing_hotel(included=100)
    c2 = planning_run(bh2.hotel)
    r2 = breserve(c2)
    assert bdispatch(c2, r2.attempt.attempt_id).ok


def test_included_only_hold_is_unaffected_by_overage_revocation():
    bh = make_billing_hotel(included=100)
    assert authorize(bh, 1)["ok"]
    c = planning_run(bh.hotel)
    r = breserve(c)
    assert bstore().revoke_overage(tenant_id=bh.tenant_id, user_id=bh.gm)["ok"]
    assert bare_dispatch(c, r.attempt.attempt_id) == "dispatched"


def test_disabled_mode_keeps_exact_h3_behaviour_even_with_a_stale_hold():
    bh, c, attempt_id = overage_hold()
    assert bstore().revoke_overage(tenant_id=bh.tenant_id, user_id=bh.gm)["ok"]
    set_mode("disabled")
    assert bare_dispatch(c, attempt_id) == "dispatched"


# ---- concurrency: the change commits while the dispatch is waiting -------------------------------------------------

def _wait_for_lock_holder(marker: str, timeout: float = 10.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        out = run_sql(f"SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%{marker}%' AND state <> 'idle' "
                      f"AND pid <> pg_backend_pid();")
        if any(line.strip() not in ("", "0", "count", "-------") and line.strip().isdigit() and int(line.strip()) > 0
               for line in out.splitlines()):
            return
        time.sleep(0.1)
    raise AssertionError("lock holder never started")


def test_revocation_committing_during_a_bare_dispatch_wins():
    bh, c, attempt_id = overage_hold()
    holder = start_sql(f"""BEGIN;
      SELECT public.agent_customer_overage_revoke('{bh.tenant_id}', '{bh.gm}');
      SELECT pg_sleep(2) /* it-h4-race-revoke */;
      COMMIT;""")
    try:
        _wait_for_lock_holder("it-h4-race-revoke")
        outcome = bare_dispatch(c, attempt_id)  # blocks on the ledger row until the revocation commits
    finally:
        holder.wait(timeout=30)
    assert GUARD in outcome, outcome
    assert attempt_state(attempt_id) == "reserved"


def test_policy_approval_committing_during_a_bare_dispatch_wins():
    bh = make_billing_hotel(included=100)
    c = planning_run(bh.hotel)
    r = breserve(c)
    s = bstore()
    proposed = s.propose_policy(tenant_id=bh.tenant_id, included_credits=Decimal(100), usd_per_credit=Decimal("0.02"),
                                markup_multiplier=Decimal(3), minimum_credits=Decimal(0),
                                hard_cap_usd=Decimal("100.00"), terms_version="h4-terms-test-1",
                                operator="it-billing-ops-a")
    holder = start_sql(f"""BEGIN;
      SELECT public.agent_customer_pricing_policy_approve('{bh.tenant_id}', '{proposed['policy_id']}',
                                                          'it-billing-ops-b', NULL);
      SELECT pg_sleep(2) /* it-h4-race-policy */;
      COMMIT;""")
    try:
        _wait_for_lock_holder("it-h4-race-policy")
        outcome = bare_dispatch(c, r.attempt.attempt_id)
    finally:
        holder.wait(timeout=30)
    assert GUARD in outcome, outcome
    assert attempt_state(r.attempt.attempt_id) == "reserved"


# ---- tenant isolation ------------------------------------------------------------------------------------------------

def test_another_hotels_revocation_does_not_block_this_hotels_dispatch():
    a, ca, attempt_a = overage_hold()
    b, cb, attempt_b = overage_hold()
    assert bstore().revoke_overage(tenant_id=b.tenant_id, user_id=b.gm)["ok"]
    assert bare_dispatch(ca, attempt_a) == "dispatched"
    assert GUARD in bare_dispatch(cb, attempt_b)
