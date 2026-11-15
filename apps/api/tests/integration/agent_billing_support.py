"""Helpers for the Agent Harness H4 real-database tests (isolated migrated Supabase; never staging).

Every test builds its OWN hotel (tenant + subscription + users). The customer-billing mode is a single global row, so
the ``billing`` fixture enables it for the test and ALWAYS restores 'disabled' afterwards -- the H3 suites that run
later depend on the default. Raw SQL is used only for inspection and for fault injection (simulating a month ending or
a crash between two committed steps); every decision under test is made by the real RPCs.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from agent_execution_support import run_sql, sql_value
from agent_orchestrator_support import (
    BIG,
    Claimed,
    ledger,
    make_hotel,
    planning_run,
    reserve,
    reset_spend_state,
    set_budgets,
)
from batch_support import new_client
from services.agent_billing.store import CustomerBillingStore
from services.agent_orchestrator.budget_store import Settlement
from services.agent_orchestrator.customer_billing_ledger import CustomerBilledSpendLedger

OP_A = "it-billing-ops-a"
OP_B = "it-billing-ops-b"
TERMS = "h4-terms-test-1"


def bstore() -> CustomerBillingStore:
    return CustomerBillingStore(new_client())


def bledger() -> CustomerBilledSpendLedger:
    return CustomerBilledSpendLedger(new_client())


def set_mode(mode: str, *, trueup: bool = False) -> None:
    result = bstore().set_controls(mode=mode, stripe_trueup_enabled=trueup, operator=OP_A, reason="integration_test")
    assert result.get("ok"), result


@dataclass
class BillingHotel:
    hotel: object
    tenant_id: str
    gm: str
    customer: str
    subscription: str
    policy_id: Optional[str] = None


def make_billing_hotel(*, included: int = 0, cap_cents: Optional[int] = None, plan_status: str = "active",
                       markup: str = "1", minimum: str = "0", hard_cap: str = "100.00",
                       policy: bool = True) -> BillingHotel:
    hotel = make_hotel()
    set_budgets(hotel, uncertain=5)
    customer = "cus_it" + uuid.uuid4().hex[:16]
    subscription = "sub_it" + uuid.uuid4().hex[:16]
    new_client().table("subscriptions").insert({
        "tenant_id": hotel.tenant_id, "stripe_customer_id": customer, "stripe_subscription_id": subscription,
        "plan_status": plan_status, "credits_included": included, "cap_cents": cap_cents,
        "base_fee_cents": 9900}).execute()
    bh = BillingHotel(hotel=hotel, tenant_id=hotel.tenant_id, gm=hotel.gm, customer=customer, subscription=subscription)
    if policy:
        bh.policy_id = approve_policy(bh, included=str(included), markup=markup, minimum=minimum, hard_cap=hard_cap)
    return bh


def approve_policy(bh: BillingHotel, *, included: str, markup: str = "1", minimum: str = "0",
                   hard_cap: str = "100.00", terms: str = TERMS) -> str:
    s = bstore()
    proposed = s.propose_policy(tenant_id=bh.tenant_id, included_credits=Decimal(included),
                                usd_per_credit=Decimal("0.02"), markup_multiplier=Decimal(markup),
                                minimum_credits=Decimal(minimum), hard_cap_usd=Decimal(hard_cap), terms_version=terms,
                                operator=OP_A)
    assert proposed.get("ok"), proposed
    approved = s.approve_policy(tenant_id=bh.tenant_id, policy_id=proposed["policy_id"], approver=OP_B)
    assert approved.get("ok"), approved
    bh.policy_id = proposed["policy_id"]
    return bh.policy_id


def authorize(bh: BillingHotel, limit: int, *, user: Optional[str] = None, exposure: Optional[str] = None,
              policy_id: Optional[str] = None) -> dict:
    return bstore().authorize_overage(tenant_id=bh.tenant_id, user_id=user or bh.gm, limit_credits=Decimal(limit),
                                      expected_policy_id=policy_id or bh.policy_id, terms_version=TERMS,
                                      expected_max_exposure_usd=Decimal(exposure) if exposure else
                                      (Decimal(limit) * Decimal("0.02")).quantize(Decimal("0.01")))


def breserve(c: Claimed, *, exposure: Decimal = Decimal("0.005"), key: Optional[str] = None, attempt: int = 1):
    """Reserve through the H4 wrapper (same parameters as the H3 helper)."""
    return bledger().reserve(run_id=c.run_id, fencing_token=c.token, worker_id=c.worker, step_id=c.step_id,
                             logical_call_key=key or f"model:{c.run_id}:{uuid.uuid4().hex[:8]}", attempt_number=attempt,
                             provider="openai", model="gpt-6-luna", schedule_version="openai-2026-11-14",
                             max_input_tokens=10_000, max_output_tokens=1_000, exposure_usd=exposure)


def bdispatch(c: Claimed, attempt_id: str):
    return bledger().dispatch(attempt_id=attempt_id, run_id=c.run_id, fencing_token=c.token, worker_id=c.worker)


def settled(cost: str) -> Settlement:
    return Settlement(outcome="settled", cost_usd=Decimal(cost), usage_status="reported",
                      usage={"uncached_input": 100, "output": 10}, cost_status="costed", cost_tier="base",
                      reported_model="gpt-6-luna", provider_request_id="req_it", provider_response_id="resp_it")


def bsettle(c: Claimed, attempt_id: str, settlement: Settlement):
    return bledger().settle(attempt_id=attempt_id, fencing_token=c.token, settlement=settlement)


def ledger_row(tenant_id: str) -> dict:
    out = sql_value(f"""SELECT row_to_json(l)::text FROM public.credit_ledger l WHERE tenant_id = '{tenant_id}'
                         AND period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE;""")
    import json
    return json.loads(out) if out else {}


def hold_of(attempt_id: str) -> dict:
    import json
    out = sql_value(f"SELECT row_to_json(h)::text FROM public.agent_customer_credit_holds h WHERE attempt_id = '{attempt_id}';")
    return json.loads(out) if out else {}


def charges_of(attempt_id: str) -> list[dict]:
    import json
    out = sql_value(f"""SELECT COALESCE(json_agg(row_to_json(c)), '[]')::text FROM public.agent_customer_credit_charges c
                         WHERE attempt_id = '{attempt_id}';""")
    return json.loads(out or "[]")


def D(value) -> Decimal:
    return Decimal(str(value))


__all__ = ["BIG", "Claimed", "ledger", "planning_run", "reserve", "reset_spend_state", "run_sql", "sql_value"]
