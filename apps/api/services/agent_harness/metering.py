"""AI spending and metering contracts (consumed by H3/H4; no database or Stripe code here).

Three separate ledgers that must never be conflated:
  1. Provider expense: what OpenAI/Anthropic actually charge PatelRep, from the provider's REPORTED usage, priced
     against an exact, versioned price schedule for the exact reported model.
  2. Customer billing: credits billed to the hotel under a versioned pricing policy, with an included allowance,
     overage opt-in (OFF by default), an authorized overage limit and a hard spending cap.
  3. Execution budgets: per-step / per-run / per-agent / per-hotel limits, enforced with explicit reservations that
     are later settled or released.

Rules: money and credits are ``Decimal`` (floats are rejected outright); counts are non-negative ints; a missing
provider usage report or an unknown model price yields an UNRECONCILED record with no cost and no customer charge --
never a guess and never a fallback to some other model's price.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import ROUND_CEILING, Decimal
from enum import Enum
from types import MappingProxyType
from typing import Annotated, Any, Mapping, Optional, Protocol

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StrictBool, StrictInt, StrictStr, model_validator

from services.agent_harness.errors import MeteringError

MICRO = Decimal("0.00000001")
CREDIT_QUANTUM = Decimal("0.0001")


def _exact_decimal(value: Any) -> Any:
    """Accept Decimal, int or a decimal string. Floats (and bools) are refused: they cannot represent money exactly."""
    if isinstance(value, bool) or isinstance(value, float):
        raise ValueError("monetary amounts must be Decimal, int or str -- never float")
    if isinstance(value, (Decimal, int, str)):
        try:
            result = Decimal(value)
        except Exception as exc:  # decimal.InvalidOperation
            raise ValueError("not a decimal amount") from exc
        if not result.is_finite():
            raise ValueError("monetary amounts must be finite")
        return result
    raise ValueError("monetary amounts must be Decimal, int or str")


Usd = Annotated[Decimal, BeforeValidator(_exact_decimal), Field(ge=0, max_digits=20, decimal_places=8)]
Credits = Annotated[Decimal, BeforeValidator(_exact_decimal), Field(ge=0, max_digits=16, decimal_places=4)]
TokenCount = Annotated[StrictInt, Field(ge=0)]

_FROZEN = ConfigDict(frozen=True, extra="forbid")


class Provider(str, Enum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    OLLAMA = "ollama"  # local development only; never billable


class UsageState(str, Enum):
    REPORTED = "reported"
    UNREPORTED = "unreported"  # the provider did not return usage; must be reconciled, never guessed


class ProviderUsage(BaseModel):
    model_config = _FROZEN

    provider: Provider
    requested_model: StrictStr = Field(min_length=1)
    reported_model: Optional[StrictStr] = None
    provider_request_id: Optional[StrictStr] = None
    state: UsageState
    input_tokens: Optional[TokenCount] = None
    output_tokens: Optional[TokenCount] = None
    cached_input_tokens: Optional[TokenCount] = None
    cache_write_tokens: Optional[TokenCount] = None
    other_units: Mapping[str, TokenCount] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _reported_means_reported(self) -> "ProviderUsage":
        counts = (self.input_tokens, self.output_tokens, self.cached_input_tokens, self.cache_write_tokens)
        if self.state is UsageState.REPORTED:
            if self.input_tokens is None or self.output_tokens is None or not self.reported_model:
                raise ValueError("reported usage needs the reported model and input/output token counts")
        elif any(c is not None for c in counts) or self.other_units:
            raise ValueError("unreported usage may not carry token counts (no invented zeros)")
        return self


class PriceSchedule(BaseModel):
    """USD per million units for one exact (provider, model), under one schedule version."""

    model_config = _FROZEN

    schedule_version: StrictStr = Field(min_length=1)
    provider: Provider
    model: StrictStr = Field(min_length=1)
    input_per_mtok: Usd
    output_per_mtok: Usd
    cached_input_per_mtok: Optional[Usd] = None
    cache_write_per_mtok: Optional[Usd] = None
    effective_from: date


class PriceBook:
    """Exact-match price lookup. There is no default model and no prefix/fuzzy match."""

    def __init__(self, schedules: tuple[PriceSchedule, ...]) -> None:
        index: dict[tuple[Provider, str], PriceSchedule] = {}
        for s in schedules:
            key = (s.provider, s.model)
            if key in index:
                raise MeteringError(f"duplicate price for {s.provider.value}/{s.model}", code="duplicate_price")
            index[key] = s
        self._index: Mapping[tuple[Provider, str], PriceSchedule] = MappingProxyType(index)

    def lookup(self, provider: Provider, model: Optional[str]) -> Optional[PriceSchedule]:
        if not model:
            return None
        return self._index.get((provider, model))


class CostStatus(str, Enum):
    COSTED = "costed"
    UNRECONCILED = "unreconciled"


class UnreconciledReason(str, Enum):
    USAGE_UNREPORTED = "usage_unreported"
    PRICE_UNKNOWN = "price_unknown"
    UNPRICED_USAGE_CATEGORY = "unpriced_usage_category"


class ProviderCostRecord(BaseModel):
    model_config = _FROZEN

    usage: ProviderUsage
    status: CostStatus
    cost_usd: Optional[Usd] = None
    schedule_version: Optional[StrictStr] = None
    unreconciled_reason: Optional[UnreconciledReason] = None

    @model_validator(mode="after")
    def _consistent(self) -> "ProviderCostRecord":
        if self.status is CostStatus.COSTED:
            if self.cost_usd is None or self.schedule_version is None or self.unreconciled_reason is not None:
                raise ValueError("a costed record has a cost and schedule and no unreconciled reason")
        elif self.cost_usd is not None or self.unreconciled_reason is None:
            raise ValueError("an unreconciled record has no cost and states why")
        return self


def compute_provider_cost(usage: ProviderUsage, prices: PriceBook) -> ProviderCostRecord:
    """Actual provider expense from reported usage. Anything unknown is UNRECONCILED, never estimated."""
    def unreconciled(reason: UnreconciledReason) -> ProviderCostRecord:
        return ProviderCostRecord(usage=usage, status=CostStatus.UNRECONCILED, unreconciled_reason=reason)

    if usage.state is UsageState.UNREPORTED:
        return unreconciled(UnreconciledReason.USAGE_UNREPORTED)
    schedule = prices.lookup(usage.provider, usage.reported_model)
    if schedule is None:
        return unreconciled(UnreconciledReason.PRICE_UNKNOWN)
    if usage.other_units:
        return unreconciled(UnreconciledReason.UNPRICED_USAGE_CATEGORY)
    parts = [(usage.input_tokens or 0, schedule.input_per_mtok), (usage.output_tokens or 0, schedule.output_per_mtok)]
    for count, rate in ((usage.cached_input_tokens, schedule.cached_input_per_mtok),
                        (usage.cache_write_tokens, schedule.cache_write_per_mtok)):
        if count:
            if rate is None:
                return unreconciled(UnreconciledReason.UNPRICED_USAGE_CATEGORY)
            parts.append((count, rate))
    total = sum((Decimal(count) * rate / Decimal(1_000_000) for count, rate in parts), Decimal(0))
    return ProviderCostRecord(
        usage=usage, status=CostStatus.COSTED, cost_usd=total.quantize(MICRO),
        schedule_version=schedule.schedule_version,
    )


class BillingPeriod(BaseModel):
    model_config = _FROZEN

    period_id: StrictStr = Field(min_length=1)
    hotel_id: StrictStr = Field(min_length=1)
    starts_on: date
    ends_on: date

    @model_validator(mode="after")
    def _ordered(self) -> "BillingPeriod":
        if self.ends_on < self.starts_on:
            raise ValueError("billing period ends before it starts")
        return self


class CustomerPricingPolicy(BaseModel):
    """How a hotel is billed for agent usage. Included allowance values are deliberately NOT chosen here."""

    model_config = _FROZEN

    pricing_policy_version: StrictStr = Field(min_length=1)
    period: BillingPeriod
    usd_per_credit: Usd
    markup_multiplier: Annotated[Decimal, BeforeValidator(_exact_decimal), Field(gt=0, le=100)]
    minimum_credits_per_charge: Credits
    included_credits: Credits
    overage_opt_in: StrictBool = False
    authorized_overage_limit_credits: Optional[Credits] = None
    hard_spending_cap_usd: Usd

    @model_validator(mode="after")
    def _caps(self) -> "CustomerPricingPolicy":
        if self.usd_per_credit <= 0:
            raise ValueError("usd_per_credit must be positive")
        if self.hard_spending_cap_usd <= 0:
            raise ValueError("a hard spending cap is required and must be positive")
        if self.overage_opt_in:
            if not self.authorized_overage_limit_credits or self.authorized_overage_limit_credits <= 0:
                raise ValueError("overage opt-in requires a positive authorized overage limit")
            if self.authorized_overage_limit_credits * self.usd_per_credit > self.hard_spending_cap_usd:
                raise ValueError("the authorized overage limit exceeds the hard spending cap")
        elif self.authorized_overage_limit_credits is not None:
            raise ValueError("an overage limit without overage opt-in is contradictory")
        return self


class ChargeStatus(str, Enum):
    QUOTED = "quoted"
    PENDING_RECONCILIATION = "pending_reconciliation"


class CustomerChargeQuote(BaseModel):
    model_config = _FROZEN

    status: ChargeStatus
    credits: Optional[Credits] = None
    pricing_policy_version: StrictStr
    provider_schedule_version: Optional[StrictStr] = None


def quote_customer_credits(cost: ProviderCostRecord, policy: CustomerPricingPolicy) -> CustomerChargeQuote:
    """Customer credits for one costed provider call. Credits are a priced product, not the provider expense."""
    if cost.status is not CostStatus.COSTED or cost.cost_usd is None:
        return CustomerChargeQuote(
            status=ChargeStatus.PENDING_RECONCILIATION, pricing_policy_version=policy.pricing_policy_version,
        )
    raw = (cost.cost_usd * policy.markup_multiplier / policy.usd_per_credit).quantize(CREDIT_QUANTUM, ROUND_CEILING)
    return CustomerChargeQuote(
        status=ChargeStatus.QUOTED,
        credits=max(raw, policy.minimum_credits_per_charge),
        pricing_policy_version=policy.pricing_policy_version,
        provider_schedule_version=cost.schedule_version,
    )


def may_bill_overage(policy: CustomerPricingPolicy, *, used_credits: Decimal, requested_credits: Decimal) -> bool:
    """Whether credits beyond the included allowance may be billed. False unless the hotel opted in."""
    if requested_credits < 0 or used_credits < 0:
        raise MeteringError("credit amounts cannot be negative", code="negative_amount")
    total = used_credits + requested_credits
    if total <= policy.included_credits:
        return True  # within the allowance: not an overage
    if not policy.overage_opt_in or policy.authorized_overage_limit_credits is None:
        return False
    overage = total - policy.included_credits
    if overage > policy.authorized_overage_limit_credits:
        return False
    return overage * policy.usd_per_credit <= policy.hard_spending_cap_usd


class ExecutionBudget(BaseModel):
    model_config = _FROZEN

    per_step_max_credits: Credits
    per_run_max_credits: Credits
    per_agent_period_max_credits: Credits
    hotel_period_max_credits: Credits

    @model_validator(mode="after")
    def _nested(self) -> "ExecutionBudget":
        chain = (self.per_step_max_credits, self.per_run_max_credits,
                 self.per_agent_period_max_credits, self.hotel_period_max_credits)
        if any(v <= 0 for v in chain):
            raise ValueError("every budget limit must be positive")
        if not (chain[0] <= chain[1] <= chain[2] <= chain[3]):
            raise ValueError("budgets must nest: step <= run <= agent period <= hotel period")
        return self


class ReservationState(str, Enum):
    RESERVED = "reserved"
    SETTLED = "settled"
    RELEASED = "released"


class BudgetReservation(BaseModel):
    model_config = _FROZEN

    reservation_id: StrictStr = Field(min_length=8)
    hotel_id: StrictStr = Field(min_length=1)
    agent_id: StrictStr = Field(min_length=1)
    run_id: StrictStr = Field(min_length=1)
    step_id: Optional[StrictStr] = None
    state: ReservationState
    reserved: Credits
    settled: Credits = Decimal(0)
    released: Credits = Decimal(0)
    created_at: datetime

    @model_validator(mode="after")
    def _balanced(self) -> "BudgetReservation":
        if self.reserved <= 0:
            raise ValueError("a reservation must reserve a positive amount")
        if self.state is ReservationState.RESERVED and (self.settled or self.released):
            raise ValueError("an open reservation has nothing settled or released")
        if self.state is not ReservationState.RESERVED and self.settled + self.released != self.reserved:
            raise ValueError("a closed reservation must account for the whole reserved amount")
        if self.state is ReservationState.RELEASED and self.settled:
            raise ValueError("a released reservation settles nothing")
        return self


def settle_reservation(res: BudgetReservation, actual: Decimal) -> BudgetReservation:
    """Close a reservation at its actual cost; the remainder is released. Overruns are refused, not absorbed."""
    if res.state is not ReservationState.RESERVED:
        raise MeteringError("reservation is already closed", code="reservation_closed")
    actual = _exact_decimal(actual)
    if actual < 0:
        raise MeteringError("actual cost cannot be negative", code="negative_amount")
    if actual > res.reserved:
        raise MeteringError("actual cost exceeds the reservation; reconcile explicitly", code="reservation_overrun")
    return _transition(res, state=ReservationState.SETTLED, settled=actual, released=res.reserved - actual)


def release_reservation(res: BudgetReservation) -> BudgetReservation:
    if res.state is not ReservationState.RESERVED:
        raise MeteringError("reservation is already closed", code="reservation_closed")
    return _transition(res, state=ReservationState.RELEASED, released=res.reserved)


def _transition(res: BudgetReservation, **changes: Any) -> BudgetReservation:
    # model_copy(update=...) would skip validation; rebuild so every invariant is re-checked.
    return BudgetReservation.model_validate({**res.model_dump(), **changes})


class BudgetLedgerPort(Protocol):
    """Contract for H3/H4's atomic database implementation (one statement per transition, like migration 217)."""

    def reserve(self, *, hotel_id: str, agent_id: str, run_id: str, step_id: Optional[str],
                amount: Decimal, budget: ExecutionBudget) -> Optional[BudgetReservation]:
        """Atomically reserve within every nested limit; ``None`` when any limit would be exceeded."""
        ...

    def settle(self, reservation_id: str, actual: Decimal) -> BudgetReservation: ...

    def release(self, reservation_id: str) -> BudgetReservation: ...
