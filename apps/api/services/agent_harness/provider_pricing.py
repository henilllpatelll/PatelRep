"""Versioned provider price schedules, exact provider cost and conservative maximum exposure (H3). Pure.

* A ``TieredPriceSchedule`` prices ONE exact (provider, model, processing mode) for one effective window under one
  ``schedule_version``. Rates are Decimal USD per million tokens; a ``None`` rate means the category is NOT priced, and
  any non-zero usage in it makes the call unreconciled. An optional long-context tier replaces the whole rate card when
  the request's prompt (every input token, cached or not) exceeds ``long_context_threshold``.
* ``ProviderPriceBook`` looks schedules up exactly (model or a reviewed alias) at the call's timestamp. Windows for one
  key never overlap, so historical usage always resolves to the schedule that applied then. There is no default model,
  no prefix or fuzzy match and no "closest" price.
* ``price_usage`` -> costed only when usage is reported, the schedule exists, the processing mode matches and every
  non-zero category has a rate. ``max_exposure`` -> the most one bounded request could cost.

Money is Decimal throughout and rounded UP to 1e-8 USD. This module is separate from H0 customer credits
(metering.py): provider USD is never reinterpreted as credits here.
"""
from __future__ import annotations

from datetime import datetime
from decimal import ROUND_CEILING, Decimal
from enum import Enum
from types import MappingProxyType
from typing import Annotated, Mapping, Optional

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StrictInt, StrictStr, field_validator, model_validator

from services.agent_harness.errors import MeteringError
from services.agent_harness.metering import MICRO, CostStatus, Provider, Usd, _exact_decimal
from services.agent_harness.provider_usage import STANDARD_MODE, NormalizedUsage, UsageStatus

MTOK = Decimal(1_000_000)
_FROZEN = ConfigDict(frozen=True, extra="forbid")
PositiveUsd = Annotated[Decimal, BeforeValidator(_exact_decimal), Field(gt=0, max_digits=20, decimal_places=8)]


def ceil8(value: Decimal) -> Decimal:
    """Round a USD amount UP to the ledger's 1e-8 precision (never under-state cost or exposure)."""
    return value.quantize(MICRO, rounding=ROUND_CEILING)


class RateCard(BaseModel):
    """USD per million tokens for each disjoint ``NormalizedUsage`` category."""

    model_config = _FROZEN

    input: Usd
    cache_read: Optional[Usd] = None
    cache_write_short: Optional[Usd] = None
    cache_write_long: Optional[Usd] = None
    output: Usd

    def max_input_rate(self) -> Decimal:
        """The dearest way an input token can be billed (exposure must not assume a cheap cache outcome)."""
        rates = [r for r in (self.input, self.cache_read, self.cache_write_short, self.cache_write_long) if r is not None]
        return max(rates)


class TieredPriceSchedule(BaseModel):
    model_config = _FROZEN

    schedule_version: StrictStr = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9._-]*$")
    provider: Provider
    model: StrictStr = Field(min_length=1, max_length=100)
    reported_model_aliases: frozenset[str] = frozenset()
    processing_mode: StrictStr = STANDARD_MODE
    effective_from: datetime
    effective_to: Optional[datetime] = None
    base: RateCard
    long_context_threshold: Optional[StrictInt] = Field(default=None, ge=1)
    long_context: Optional[RateCard] = None
    source: StrictStr = Field(min_length=1, max_length=300)

    @field_validator("effective_from", "effective_to")
    @classmethod
    def _aware(cls, value: Optional[datetime]) -> Optional[datetime]:
        if value is not None and value.tzinfo is None:
            raise ValueError("schedule timestamps must be timezone-aware")
        return value

    @model_validator(mode="after")
    def _shape(self) -> "TieredPriceSchedule":
        if self.provider is Provider.OLLAMA:
            raise ValueError("local models are never billable")
        if (self.long_context_threshold is None) != (self.long_context is None):
            raise ValueError("a long-context tier needs both a threshold and a rate card")
        if self.effective_to is not None and self.effective_to <= self.effective_from:
            raise ValueError("a schedule must end after it starts")
        if self.model in self.reported_model_aliases:
            raise ValueError("aliases must differ from the model id")
        return self

    @property
    def key(self) -> tuple[Provider, str, str]:
        return (self.provider, self.model, self.processing_mode)

    def names(self) -> frozenset[str]:
        return frozenset({self.model}) | self.reported_model_aliases

    def active_at(self, at: datetime) -> bool:
        return self.effective_from <= at and (self.effective_to is None or at < self.effective_to)

    def card_for(self, prompt_tokens: int) -> tuple[str, RateCard]:
        if self.long_context_threshold is not None and prompt_tokens > self.long_context_threshold:
            return "long", self.long_context  # type: ignore[return-value]
        return "base", self.base


class ProviderPriceBook:
    """Exact, effective-dated lookup. Overlapping windows for one key are refused at construction."""

    def __init__(self, schedules: tuple[TieredPriceSchedule, ...]) -> None:
        by_name: dict[tuple[Provider, str, str], list[TieredPriceSchedule]] = {}
        versions: dict[tuple[Provider, str, str], TieredPriceSchedule] = {}
        for s in schedules:
            vkey = (s.provider, s.model, s.schedule_version)
            if vkey in versions:
                raise MeteringError(f"duplicate schedule version {s.schedule_version}", code="duplicate_price")
            versions[vkey] = s
            for name in s.names():
                bucket = by_name.setdefault((s.provider, name, s.processing_mode), [])
                for other in bucket:
                    if _overlaps(s, other):
                        raise MeteringError(f"overlapping price windows for {s.provider.value}/{name}",
                                            code="overlapping_price")
                bucket.append(s)
        self._by_name: Mapping[tuple[Provider, str, str], tuple[TieredPriceSchedule, ...]] = MappingProxyType(
            {k: tuple(v) for k, v in by_name.items()})
        self._versions = MappingProxyType(versions)

    def lookup(self, provider: Provider, model: Optional[str], *, at: datetime,
               processing_mode: str = STANDARD_MODE) -> Optional[TieredPriceSchedule]:
        if not isinstance(model, str) or not model or at.tzinfo is None:
            return None
        for schedule in self._by_name.get((provider, model, processing_mode), ()):
            if schedule.active_at(at):
                return schedule
        return None

    def version(self, provider: Provider, model: str, schedule_version: str) -> Optional[TieredPriceSchedule]:
        return self._versions.get((provider, model, schedule_version))

    def all(self) -> tuple[TieredPriceSchedule, ...]:
        return tuple(self._versions.values())


def _overlaps(a: TieredPriceSchedule, b: TieredPriceSchedule) -> bool:
    a_end, b_end = a.effective_to, b.effective_to
    return (b_end is None or a.effective_from < b_end) and (a_end is None or b.effective_from < a_end)


class CostCause(str, Enum):
    USAGE_UNREPORTED = "usage_unreported"
    USAGE_MALFORMED = "usage_malformed"
    PRICE_UNKNOWN = "price_unknown"
    PROCESSING_MODE_UNPRICED = "processing_mode_unpriced"
    UNPRICED_USAGE_CATEGORY = "unpriced_usage_category"
    PROVIDER_MISMATCH = "provider_mismatch"


class AttemptCost(BaseModel):
    model_config = _FROZEN

    status: CostStatus
    cost_usd: Optional[Usd] = None
    schedule_version: Optional[StrictStr] = None
    tier: Optional[StrictStr] = None
    cause: Optional[CostCause] = None

    @model_validator(mode="after")
    def _shape(self) -> "AttemptCost":
        if self.status is CostStatus.COSTED:
            if self.cost_usd is None or self.schedule_version is None or self.cause is not None:
                raise ValueError("a costed attempt has a cost and schedule and no cause")
        elif self.cost_usd is not None or self.cause is None:
            raise ValueError("an unreconciled attempt has no cost and states why")
        return self


def _unreconciled(cause: CostCause, schedule: Optional[TieredPriceSchedule] = None) -> AttemptCost:
    return AttemptCost(status=CostStatus.UNRECONCILED, cause=cause,
                       schedule_version=schedule.schedule_version if schedule else None)


def price_usage(usage: NormalizedUsage, book: ProviderPriceBook, *, provider: Provider, reported_model: Optional[str],
                at: datetime) -> AttemptCost:
    """Actual provider expense for one request. Every unknown makes it UNRECONCILED; nothing is estimated."""
    if usage.provider is not provider:
        return _unreconciled(CostCause.PROVIDER_MISMATCH)
    if usage.status is UsageStatus.UNREPORTED:
        return _unreconciled(CostCause.USAGE_UNREPORTED)
    if usage.status is UsageStatus.MALFORMED:
        return _unreconciled(CostCause.USAGE_MALFORMED)
    if usage.processing_mode != STANDARD_MODE:
        return _unreconciled(CostCause.PROCESSING_MODE_UNPRICED)
    schedule = book.lookup(provider, reported_model, at=at, processing_mode=usage.processing_mode)
    if schedule is None:
        return _unreconciled(CostCause.PRICE_UNKNOWN)
    if usage.unpriced:
        return _unreconciled(CostCause.UNPRICED_USAGE_CATEGORY, schedule)
    tier, card = schedule.card_for(usage.prompt_tokens or 0)
    total = Decimal(0)
    for count, rate in ((usage.uncached_input, card.input), (usage.cache_read, card.cache_read),
                        (usage.cache_write_short, card.cache_write_short),
                        (usage.cache_write_long, card.cache_write_long), (usage.output, card.output)):
        if not count:
            continue
        if rate is None:
            return _unreconciled(CostCause.UNPRICED_USAGE_CATEGORY, schedule)
        total += Decimal(count) * rate
    return AttemptCost(status=CostStatus.COSTED, cost_usd=ceil8(total / MTOK), schedule_version=schedule.schedule_version,
                       tier=tier)


def max_exposure(schedule: TieredPriceSchedule, *, max_input_tokens: int, max_output_tokens: int) -> Decimal:
    """The most one request bounded by these token limits can cost under ``schedule``.

    Every input token is priced at the dearest input category (a request could be billed as a cache write) and the tier
    is the one the MAXIMUM prompt reaches. Mirrors ``agent__model_max_exposure`` in migration 245.
    """
    for value in (max_input_tokens, max_output_tokens):
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise MeteringError("token bounds must be non-negative integers", code="invalid_bound")
    if max_output_tokens == 0:
        raise MeteringError("a request must allow output", code="invalid_bound")
    _, card = schedule.card_for(max_input_tokens)
    raw = Decimal(max_input_tokens) * card.max_input_rate() + Decimal(max_output_tokens) * card.output
    return ceil8(raw / MTOK)


class UsdAgentBudget(BaseModel):
    """USD provider-spend limits for one agent in one hotel. NOT customer credits (H0 ExecutionBudget is credits)."""

    model_config = _FROZEN

    call_limit_usd: PositiveUsd
    step_limit_usd: PositiveUsd
    run_limit_usd: PositiveUsd
    period_limit_usd: PositiveUsd

    @model_validator(mode="after")
    def _nested(self) -> "UsdAgentBudget":
        if not (self.call_limit_usd <= self.step_limit_usd <= self.run_limit_usd <= self.period_limit_usd):
            raise ValueError("USD budgets must nest: call <= step <= run <= agent period")
        return self
