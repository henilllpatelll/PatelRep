"""H0 financial contracts: exact money, provider cost separate from customer credits, no guessed charges."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from services.agent_harness.errors import MeteringError
from services.agent_harness.metering import (
    BillingPeriod,
    BudgetReservation,
    ChargeStatus,
    CostStatus,
    CustomerPricingPolicy,
    ExecutionBudget,
    PriceBook,
    PriceSchedule,
    Provider,
    ProviderUsage,
    ReservationState,
    UnreconciledReason,
    UsageState,
    compute_provider_cost,
    may_bill_overage,
    quote_customer_credits,
    release_reservation,
    settle_reservation,
)
from tests.smoke.agent_harness_support import HOTEL_A, NOW

PRICES = PriceBook((
    PriceSchedule(schedule_version="test-2026-11", provider=Provider.OPENAI, model="gpt-4o-mini",
                  input_per_mtok="0.15", output_per_mtok="0.60", cached_input_per_mtok="0.075", effective_from=date(2026, 11, 1)),
    PriceSchedule(schedule_version="test-2026-11", provider=Provider.ANTHROPIC, model="claude-sonnet-4-6",
                  input_per_mtok="3", output_per_mtok="15", effective_from=date(2026, 11, 1)),
))
PERIOD = BillingPeriod(period_id="p-2026-11", hotel_id=HOTEL_A, starts_on=date(2026, 11, 1), ends_on=date(2026, 11, 30))


def _usage(**changes) -> ProviderUsage:
    data = dict(provider=Provider.OPENAI, requested_model="gpt-4o-mini", reported_model="gpt-4o-mini",
                provider_request_id="req_1", state=UsageState.REPORTED, input_tokens=1_000_000, output_tokens=1_000_000)
    data.update(changes)
    return ProviderUsage(**data)


def _policy(**changes) -> CustomerPricingPolicy:
    data = dict(pricing_policy_version="pp-test-1", period=PERIOD, usd_per_credit="0.02", markup_multiplier="2",
                minimum_credits_per_charge="0.5", included_credits="100", hard_spending_cap_usd="50")
    data.update(changes)
    return CustomerPricingPolicy(**data)


def test_decimal_money_stays_exact():
    cost = compute_provider_cost(_usage(input_tokens=1, output_tokens=3), PRICES)
    # 1 * 0.15/1e6 + 3 * 0.60/1e6 = 0.00000195 exactly
    assert cost.cost_usd == Decimal("0.00000195")
    assert isinstance(cost.cost_usd, Decimal)


@pytest.mark.parametrize("amount", [0.1, 1.5, float("nan"), True])
def test_floats_and_bools_are_refused_as_money(amount):
    with pytest.raises(ValidationError):
        _policy(usd_per_credit=amount)


@pytest.mark.parametrize("value", ["-1", -1, "NaN", "Infinity"])
def test_negative_or_non_finite_money_is_refused(value):
    with pytest.raises(ValidationError):
        _policy(hard_spending_cap_usd=value)


@pytest.mark.parametrize("field", ["input_tokens", "output_tokens", "cached_input_tokens"])
def test_negative_token_counts_are_refused(field):
    with pytest.raises(ValidationError):
        _usage(**{field: -1})


def test_provider_cost_and_customer_credits_are_separate_quantities():
    cost = compute_provider_cost(_usage(), PRICES)
    assert cost.status is CostStatus.COSTED and cost.cost_usd == Decimal("0.75")
    quote = quote_customer_credits(cost, _policy())
    # 0.75 USD * markup 2 / 0.02 USD per credit = 75 credits: not the provider dollars and not a 1:1 mapping
    assert quote.status is ChargeStatus.QUOTED and quote.credits == Decimal("75")
    assert quote.provider_schedule_version == "test-2026-11"


def test_minimum_charge_applies_to_tiny_calls():
    quote = quote_customer_credits(compute_provider_cost(_usage(input_tokens=10, output_tokens=10), PRICES), _policy())
    assert quote.credits == Decimal("0.5")


@pytest.mark.parametrize("model", ["gpt-4o", "gpt-4o-mini-2026-01-01", "claude-sonnet", "GPT-4O-MINI"])
def test_unknown_model_pricing_never_falls_back(model):
    cost = compute_provider_cost(_usage(reported_model=model), PRICES)
    assert cost.status is CostStatus.UNRECONCILED and cost.cost_usd is None
    assert cost.unreconciled_reason is UnreconciledReason.PRICE_UNKNOWN


def test_price_is_keyed_by_reported_model_not_requested_model():
    usage = _usage(requested_model="gpt-4o-mini", reported_model="gpt-4o-2026-08-06")
    assert compute_provider_cost(usage, PRICES).status is CostStatus.UNRECONCILED


def test_missing_usage_cannot_produce_a_guessed_customer_charge():
    usage = ProviderUsage(provider=Provider.ANTHROPIC, requested_model="claude-sonnet-4-6", state=UsageState.UNREPORTED)
    cost = compute_provider_cost(usage, PRICES)
    assert cost.unreconciled_reason is UnreconciledReason.USAGE_UNREPORTED
    quote = quote_customer_credits(cost, _policy())
    assert quote.status is ChargeStatus.PENDING_RECONCILIATION and quote.credits is None


def test_unreported_usage_cannot_carry_invented_zero_counts():
    with pytest.raises(ValidationError, match="invented zeros"):
        ProviderUsage(provider=Provider.OPENAI, requested_model="gpt-4o-mini", state=UsageState.UNREPORTED,
                      input_tokens=0, output_tokens=0)
    with pytest.raises(ValidationError):
        _usage(output_tokens=None)
    for model in ("", None):
        with pytest.raises(ValidationError):
            _usage(reported_model=model)


def test_unpriced_usage_categories_are_unreconciled():
    cost = compute_provider_cost(_usage(provider=Provider.ANTHROPIC, requested_model="claude-sonnet-4-6",
                                        reported_model="claude-sonnet-4-6", cached_input_tokens=10), PRICES)
    assert cost.unreconciled_reason is UnreconciledReason.UNPRICED_USAGE_CATEGORY
    cost = compute_provider_cost(_usage(other_units={"web_search_requests": 2}), PRICES)
    assert cost.unreconciled_reason is UnreconciledReason.UNPRICED_USAGE_CATEGORY


def test_overages_default_to_disabled():
    policy = _policy()
    assert policy.overage_opt_in is False
    assert may_bill_overage(policy, used_credits=Decimal("99"), requested_credits=Decimal("1")) is True
    assert may_bill_overage(policy, used_credits=Decimal("100"), requested_credits=Decimal("0.0001")) is False


def test_opted_in_overage_is_bounded_by_the_authorized_limit():
    policy = _policy(overage_opt_in=True, authorized_overage_limit_credits="500")
    assert may_bill_overage(policy, used_credits=Decimal("100"), requested_credits=Decimal("500")) is True
    assert may_bill_overage(policy, used_credits=Decimal("100"), requested_credits=Decimal("500.0001")) is False


@pytest.mark.parametrize("changes", [
    {"hard_spending_cap_usd": "0"},
    {"overage_opt_in": True},
    {"overage_opt_in": True, "authorized_overage_limit_credits": "0"},
    {"overage_opt_in": True, "authorized_overage_limit_credits": "2501"},  # 2501 * 0.02 = 50.02 > 50 cap
    {"authorized_overage_limit_credits": "10"},
    {"usd_per_credit": "0"},
    {"markup_multiplier": "0"},
])
def test_invalid_spending_caps_fail_validation(changes):
    with pytest.raises(ValidationError):
        _policy(**changes)


def test_policy_does_not_hardcode_a_future_tier_allowance():
    with pytest.raises(ValidationError):
        CustomerPricingPolicy(pricing_policy_version="x", period=PERIOD, usd_per_credit="0.02", markup_multiplier="1",
                              minimum_credits_per_charge="0", hard_spending_cap_usd="1")  # included_credits required


def test_budgets_must_be_positive_and_nested():
    ExecutionBudget(per_step_max_credits="1", per_run_max_credits="5", per_agent_period_max_credits="50",
                    hotel_period_max_credits="100")
    with pytest.raises(ValidationError, match="nest"):
        ExecutionBudget(per_step_max_credits="10", per_run_max_credits="5", per_agent_period_max_credits="50",
                        hotel_period_max_credits="100")
    with pytest.raises(ValidationError, match="positive"):
        ExecutionBudget(per_step_max_credits="0", per_run_max_credits="5", per_agent_period_max_credits="50",
                        hotel_period_max_credits="100")


def _reservation(**changes) -> BudgetReservation:
    data = dict(reservation_id="res-00000001", hotel_id=HOTEL_A, agent_id="examples.work_order_observer",
                run_id="run-1", state=ReservationState.RESERVED, reserved="5", created_at=NOW)
    data.update(changes)
    return BudgetReservation(**data)


def test_reservation_settles_and_releases_explicitly():
    res = _reservation()
    settled = settle_reservation(res, Decimal("3.25"))
    assert (settled.state, settled.settled, settled.released) == (ReservationState.SETTLED, Decimal("3.25"), Decimal("1.75"))
    released = release_reservation(_reservation())
    assert (released.state, released.settled, released.released) == (ReservationState.RELEASED, 0, Decimal("5"))


@pytest.mark.parametrize("operation, code", [
    (lambda r: settle_reservation(r, Decimal("5.01")), "reservation_overrun"),
    (lambda r: settle_reservation(r, Decimal("-1")), "negative_amount"),
    (lambda r: settle_reservation(settle_reservation(r, Decimal("1")), Decimal("1")), "reservation_closed"),
    (lambda r: release_reservation(release_reservation(r)), "reservation_closed"),
])
def test_reservation_transitions_are_guarded(operation, code):
    with pytest.raises(MeteringError) as err:
        operation(_reservation())
    assert err.value.code == code


@pytest.mark.parametrize("changes", [
    {"reserved": "0"},
    {"reservation_id": "short"},
    {"settled": "1"},
    {"state": ReservationState.SETTLED, "settled": "1", "released": "1"},
    {"state": ReservationState.RELEASED, "settled": "1", "released": "4"},
])
def test_reservation_states_are_explicit_and_balanced(changes):
    with pytest.raises(ValidationError):
        _reservation(**changes)


def test_settling_with_a_float_is_refused():
    with pytest.raises(ValueError):
        settle_reservation(_reservation(), 1.5)  # type: ignore[arg-type]
