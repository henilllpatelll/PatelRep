"""Exact customer-credit arithmetic for H4. Mirrors the SQL in migration 249 (drift-tested both ways).

* credits for a provider cost: ``ceil(cost_usd * markup / usd_per_credit)`` to 0.0001 credits, never below the policy
  minimum (identical to H0 ``metering.quote_customer_credits`` for a costed record);
* charged credits never exceed the pre-dispatch hold (the customer's authorization); any excess is PatelRep's expense;
* the overage share of a charge is the part not covered by the hold's included portion;
* Stripe amounts are rounded once, on the period total, half away from zero to whole cents.

Floats are refused everywhere (``_dec``).
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal
from typing import Any

CREDIT_QUANTUM = Decimal("0.0001")  # == the H0 metering contract quantum (drift-tested)

CENT = Decimal("0.01")
LEGACY_USD_PER_CREDIT = Decimal("0.02")  # credit_ledger.overage_cost_cents prices a credit at 2 cents (migration 020)


def _dec(value: Any) -> Decimal:
    if isinstance(value, (bool, float)):
        raise TypeError("money must be Decimal, int or str -- never float")
    result = Decimal(value) if not isinstance(value, Decimal) else value
    if not result.is_finite():
        raise ValueError("money must be finite")
    return result


@dataclass(frozen=True)
class PolicyRates:
    usd_per_credit: Decimal
    markup_multiplier: Decimal
    minimum_credits_per_operation: Decimal

    def __post_init__(self) -> None:
        for name in ("usd_per_credit", "markup_multiplier", "minimum_credits_per_operation"):
            object.__setattr__(self, name, _dec(getattr(self, name)))
        if self.usd_per_credit <= 0 or self.markup_multiplier <= 0 or self.minimum_credits_per_operation < 0:
            raise ValueError("invalid policy rates")


def quote_credits(cost_usd: Any, rates: PolicyRates) -> Decimal:
    cost = _dec(cost_usd)
    if cost < 0:
        raise ValueError("cost cannot be negative")
    raw = (cost * rates.markup_multiplier / rates.usd_per_credit).quantize(CREDIT_QUANTUM, ROUND_CEILING)
    return max(raw, rates.minimum_credits_per_operation)


@dataclass(frozen=True)
class ChargeSplit:
    charged: Decimal
    included: Decimal
    overage: Decimal
    overage_usd: Decimal
    uncharged_overrun: Decimal


def split_charge(*, cost_usd: Any, rates: PolicyRates, held_credits: Any, held_overage_credits: Any) -> ChargeSplit:
    credits = quote_credits(cost_usd, rates)
    held, held_over = _dec(held_credits), _dec(held_overage_credits)
    charged = min(credits, held)
    included = min(charged, held - held_over)
    overage = charged - included
    return ChargeSplit(charged=charged, included=included, overage=overage, overage_usd=overage * rates.usd_per_credit,
                       uncharged_overrun=credits - charged)


def period_amount_cents(overage_usd_values: list[Any]) -> int:
    total = sum((_dec(v) for v in overage_usd_values), Decimal(0))
    return int((total / CENT).quantize(Decimal(1), ROUND_HALF_UP))


def max_exposure_usd(limit_credits: Any, usd_per_credit: Any) -> Decimal:
    return (_dec(limit_credits) * _dec(usd_per_credit)).quantize(CENT, ROUND_CEILING)


def legacy_overage_cents(*, overage_cost_cents: Any, agent_overage_credits: Any, cap_cents: int | None,
                         base_fee_cents: int) -> int:
    """Legacy true-up amount: all overage minus the consented agent overage H4 bills itself, legacy cap applied,
    rounded half up to whole cents (Stripe takes integers; migration 020 documents rounding at invoice time)."""
    total = _dec(overage_cost_cents)
    agent_cents = min(_dec(agent_overage_credits) * LEGACY_USD_PER_CREDIT * 100, total)
    cents = max(Decimal(0), total - agent_cents)
    if cap_cents:
        # The cap bounds the whole monthly bill: base fee + agent overage (billed by H4) + legacy overage.
        cents = max(Decimal(0), min(cents, Decimal(cap_cents - base_fee_cents) - agent_cents))
    return int(cents.quantize(Decimal(1), ROUND_HALF_UP))
