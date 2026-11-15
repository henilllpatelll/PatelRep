"""H3 usage normalisation, versioned pricing and maximum exposure (pure; no provider, no database)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from pydantic import ValidationError

from services.agent_harness.errors import MeteringError
from services.agent_harness.metering import CostStatus, Provider
from services.agent_harness.provider_pricing import (
    CostCause,
    ProviderPriceBook,
    RateCard,
    TieredPriceSchedule,
    UsdAgentBudget,
    ceil8,
    max_exposure,
    price_usage,
)
from services.agent_harness.provider_usage import (
    NormalizedUsage,
    UsageStatus,
    normalize_anthropic_usage,
    normalize_openai_usage,
)
from services.agent_orchestrator.pricebook import PRICE_BOOK, PRICE_SCHEDULES, VERIFIED_AT

AT = VERIFIED_AT + timedelta(days=1)
D = Decimal


def oa(input_tokens, output_tokens, cached=0, written=0, ttl30=None, ttl12=None, reasoning=0, **extra):
    details = {"cached_tokens": cached, "cache_write_tokens": written}
    if ttl30 is not None or ttl12 is not None:
        details["cache_write_tokens_details"] = {"ttl_30m_tokens": ttl30 or 0, "ttl_12h_tokens": ttl12 or 0}
    usage = {"input_tokens": input_tokens, "output_tokens": output_tokens, "input_tokens_details": details,
             "output_tokens_details": {"reasoning_tokens": reasoning}, "total_tokens": input_tokens + output_tokens}
    usage.update(extra)
    return normalize_openai_usage(usage, service_tier="default", requested_service_tier="default")


def an(input_tokens, output_tokens, read=0, created=0, m5=None, h1=None, **extra):
    usage = {"input_tokens": input_tokens, "output_tokens": output_tokens, "cache_read_input_tokens": read,
             "cache_creation_input_tokens": created, "service_tier": "standard"}
    if m5 is not None or h1 is not None:
        usage["cache_creation"] = {"ephemeral_5m_input_tokens": m5 or 0, "ephemeral_1h_input_tokens": h1 or 0}
    usage.update(extra)
    return normalize_anthropic_usage(usage, requested_standard_only=True)


def cost(usage, model, at=AT):
    return price_usage(usage, PRICE_BOOK, provider=usage.provider, reported_model=model, at=at)


# --- normalisation: cache accounting ------------------------------------------------------------------------------

def test_openai_cached_tokens_are_inside_input_and_never_double_counted():
    u = oa(1_000, 200, cached=400)
    assert (u.uncached_input, u.cache_read, u.prompt_tokens) == (600, 400, 1_000)
    # 600 * 0.10 + 400 * 0.01 + 200 * 0.50 = 60 + 4 + 100 = 164 per MTok-units -> 0.000164 USD
    assert cost(u, "gpt-6-luna").cost_usd == D("0.000164")


def test_openai_cache_writes_are_inside_input_and_split_by_retention():
    u = oa(1_000, 0 + 1, cached=100, written=300, ttl30=200, ttl12=100)
    assert (u.uncached_input, u.cache_read, u.cache_write_short, u.cache_write_long) == (600, 100, 200, 100)
    expected = (600 * D("0.10") + 100 * D("0.01") + 200 * D("0.125") + 100 * D("0.25") + 1 * D("0.50")) / 1_000_000
    assert cost(u, "gpt-6-luna").cost_usd == ceil8(expected)


def test_openai_cache_write_without_a_matching_split_is_ambiguous_not_guessed():
    for usage in (oa(1_000, 10, written=300), oa(1_000, 10, written=300, ttl30=100, ttl12=100)):
        assert usage.status is UsageStatus.MALFORMED and usage.malformed_reason == "ambiguous_cache_write_ttl"
        assert cost(usage, "gpt-6-luna").cause is CostCause.USAGE_MALFORMED


def test_anthropic_cache_categories_are_outside_input_and_added():
    u = an(600, 50, read=400, created=100, m5=100)
    assert (u.uncached_input, u.cache_read, u.cache_write_short, u.prompt_tokens) == (600, 400, 100, 1_100)
    expected = (600 * D("0.10") + 400 * D("0.01") + 100 * D("0.125") + 50 * D("0.50")) / 1_000_000
    assert cost(u, "claude-haiku-5-5").cost_usd == ceil8(expected)


def test_reasoning_is_a_subset_of_output_and_not_priced_twice():
    u = oa(100, 1_000, reasoning=800)
    assert (u.output, u.reasoning) == (1_000, 800)
    assert cost(u, "gpt-6-luna").cost_usd == ceil8((100 * D("0.10") + 1_000 * D("0.50")) / 1_000_000)
    assert oa(100, 10, reasoning=11).malformed_reason == "reasoning_exceeds_output"


def test_inconsistent_openai_usage_is_malformed():
    assert oa(100, 10, cached=200).malformed_reason == "cache_tokens_exceed_input"
    bad_total = normalize_openai_usage({"input_tokens": 10, "output_tokens": 5, "total_tokens": 99},
                                       service_tier="default", requested_service_tier="default")
    assert bad_total.malformed_reason == "total_mismatch"
    for raw in ({"input_tokens": 1.5, "output_tokens": 1}, {"input_tokens": True, "output_tokens": 1},
                {"input_tokens": "10", "output_tokens": 1}, {"output_tokens": 1}, [1, 2]):
        assert normalize_openai_usage(raw, service_tier="default", requested_service_tier="default").status \
            is UsageStatus.MALFORMED


# --- missing / unknown usage ---------------------------------------------------------------------------------------

@pytest.mark.parametrize("normalize", [
    lambda: normalize_openai_usage(None, service_tier="default", requested_service_tier="default"),
    lambda: normalize_anthropic_usage(None, requested_standard_only=True),
])
def test_missing_usage_is_unreported_never_zero(normalize):
    u = normalize()
    assert u.status is UsageStatus.UNREPORTED and u.prompt_tokens is None and u.output is None
    record = cost(u, "gpt-6-luna" if u.provider is Provider.OPENAI else "claude-haiku-5-5")
    assert record.status is CostStatus.UNRECONCILED and record.cost_usd is None
    assert record.cause is CostCause.USAGE_UNREPORTED


def test_unreported_usage_cannot_carry_invented_counts():
    with pytest.raises(ValidationError):
        NormalizedUsage(provider=Provider.OPENAI, status=UsageStatus.UNREPORTED, output=0)


def test_unknown_billable_categories_make_the_call_unreconciled():
    u = oa(100, 10, image_tokens=5)
    assert u.unpriced == {"openai.image_tokens": 5}
    assert cost(u, "gpt-6-luna").cause is CostCause.UNPRICED_USAGE_CATEGORY
    nested = oa(100, 10, future_breakdown={"audio_tokens": 3})
    assert nested.unpriced == {"openai.future_breakdown.audio_tokens": 3}
    tools = an(100, 10, server_tool_use={"web_search_requests": 2, "web_fetch_requests": 0})
    assert tools.unpriced == {"anthropic.server_tool_use.web_search_requests": 2}
    assert cost(tools, "claude-haiku-5-5").cause is CostCause.UNPRICED_USAGE_CATEGORY
    assert oa(100, 10, image_tokens=0).unpriced == {}


@pytest.mark.parametrize("usage", [
    lambda: normalize_openai_usage({"input_tokens": 1, "output_tokens": 1}, service_tier="priority",
                                   requested_service_tier="default"),
    lambda: normalize_openai_usage({"input_tokens": 1, "output_tokens": 1}, service_tier="flex",
                                   requested_service_tier="default"),
    lambda: an(10, 10, service_tier="priority"),
    lambda: an(10, 10, inference_geo="us"),
    lambda: an(10, 10, speed="fast"),
    lambda: normalize_anthropic_usage({"input_tokens": 1, "output_tokens": 1}, requested_standard_only=False),
])
def test_non_standard_processing_modes_are_never_priced_at_standard_rates(usage):
    u = usage()
    model = "gpt-6-luna" if u.provider is Provider.OPENAI else "claude-haiku-5-5"
    assert u.processing_mode != "standard"
    assert cost(u, model).cause is CostCause.PROCESSING_MODE_UNPRICED


def test_requested_standard_tier_is_assumed_only_when_the_provider_omits_it():
    u = normalize_openai_usage({"input_tokens": 1, "output_tokens": 1}, service_tier=None,
                               requested_service_tier="default")
    assert u.processing_mode == "standard"
    assert an(1, 1, service_tier=None).processing_mode == "standard"
    assert an(1, 1, inference_geo="global").processing_mode == "standard"


# --- price book -----------------------------------------------------------------------------------------------------

def test_unknown_or_similarly_named_models_are_never_priced():
    u = oa(10, 10)
    for model in ("gpt-6-luna-2026-11-01", "GPT-6-LUNA", "gpt-6", " gpt-6-luna", "", None):
        assert cost(u, model).cause is CostCause.PRICE_UNKNOWN
    assert cost(an(10, 10), "claude-haiku-5").cause is CostCause.PRICE_UNKNOWN


def test_provider_mismatch_is_unreconciled():
    record = price_usage(oa(10, 10), PRICE_BOOK, provider=Provider.ANTHROPIC, reported_model="claude-haiku-5-5", at=AT)
    assert record.cause is CostCause.PROVIDER_MISMATCH


def _schedule(version, start, end=None, rate="1.00", model="m-1", aliases=frozenset()):
    return TieredPriceSchedule(schedule_version=version, provider=Provider.OPENAI, model=model,
                               reported_model_aliases=aliases, effective_from=start, effective_to=end,
                               base=RateCard(input=D(rate), output=D(rate)), source="test")


def test_price_versions_resolve_historically_and_never_overlap():
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    t1 = datetime(2026, 6, 1, tzinfo=timezone.utc)
    book = ProviderPriceBook((_schedule("v1", t0, t1, "1.00"), _schedule("v2", t1, None, "2.00")))
    u = normalize_openai_usage({"input_tokens": 1_000_000, "output_tokens": 0}, service_tier="default",
                               requested_service_tier="default")
    old = price_usage(u, book, provider=Provider.OPENAI, reported_model="m-1", at=t1 - timedelta(seconds=1))
    new = price_usage(u, book, provider=Provider.OPENAI, reported_model="m-1", at=t1)
    assert (old.schedule_version, old.cost_usd) == ("v1", D("1.00000000"))
    assert (new.schedule_version, new.cost_usd) == ("v2", D("2.00000000"))
    assert price_usage(u, book, provider=Provider.OPENAI, reported_model="m-1",
                       at=t0 - timedelta(days=1)).cause is CostCause.PRICE_UNKNOWN
    with pytest.raises(MeteringError) as exc:
        ProviderPriceBook((_schedule("v1", t0, None), _schedule("v2", t1, None)))
    assert exc.value.code == "overlapping_price"
    with pytest.raises(MeteringError):
        ProviderPriceBook((_schedule("v1", t0, None), _schedule("v1", t1, None)))
    with pytest.raises(MeteringError):  # an alias may not overlap another schedule's model name either
        ProviderPriceBook((_schedule("v1", t0, None), _schedule("v2", t0, None, model="m-2", aliases=frozenset({"m-1"}))))


def test_reviewed_aliases_resolve_exactly():
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    book = ProviderPriceBook((_schedule("v1", t0, aliases=frozenset({"m-1-snap"})),))
    assert book.lookup(Provider.OPENAI, "m-1-snap", at=t0).schedule_version == "v1"
    assert book.lookup(Provider.OPENAI, "m-1-snap2", at=t0) is None
    assert book.lookup(Provider.OPENAI, "m-1", at=datetime(2026, 2, 1)) is None  # naive timestamps refused


def test_haiku_tier_boundary_counts_cached_prompt_tokens():
    at_limit = an(99_000, 10, read=1_000)  # prompt exactly 100,000 -> base
    over = an(99_000, 10, read=1_001)  # 100,001 -> long-context rates for the whole request
    base, long_ = cost(at_limit, "claude-haiku-5-5"), cost(over, "claude-haiku-5-5")
    assert (base.tier, long_.tier) == ("base", "long")
    assert base.cost_usd == ceil8((99_000 * D("0.10") + 1_000 * D("0.01") + 10 * D("0.50")) / 1_000_000)
    assert long_.cost_usd == ceil8((99_000 * D("0.50") + 1_001 * D("0.05") + 10 * D("2.50")) / 1_000_000)


def test_openai_long_context_rule_doubles_input_and_cache_and_1_5x_output():
    luna = PRICE_BOOK.lookup(Provider.OPENAI, "gpt-6-luna", at=AT)
    assert luna.long_context.input == D("0.20") and luna.long_context.cache_read == D("0.02")
    assert luna.long_context.output == D("0.75")
    assert cost(oa(272_000, 1), "gpt-6-luna").tier == "base"
    assert cost(oa(272_001, 1), "gpt-6-luna").tier == "long"


# --- decimal precision ----------------------------------------------------------------------------------------------

def test_money_is_decimal_and_rounded_up():
    with pytest.raises(ValidationError):
        RateCard(input=0.1, output=D("1"))  # floats refused
    assert ceil8(D("0.000000001")) == D("0.00000001")
    assert ceil8(D("0.00000001")) == D("0.00000001")
    one_token = cost(oa(1, 1), "gpt-6-luna")  # 0.0000001 + 0.0000005 = 6e-7 exactly
    assert one_token.cost_usd == D("0.00000060") and isinstance(one_token.cost_usd, Decimal)
    tiny = cost(oa(1, 1, cached=1), "gpt-6-luna")  # 1 * 0.01 / 1e6 = 1e-8, + 5e-7
    assert tiny.cost_usd == D("0.00000051")


# --- maximum exposure ------------------------------------------------------------------------------------------------

def test_max_exposure_prices_every_input_token_at_the_dearest_category():
    luna = PRICE_BOOK.lookup(Provider.OPENAI, "gpt-6-luna", at=AT)
    # dearest input category for luna is the 12h cache write (0.25)
    assert max_exposure(luna, max_input_tokens=10_000, max_output_tokens=1_000) == ceil8(
        (10_000 * D("0.25") + 1_000 * D("0.50")) / 1_000_000)
    haiku = PRICE_BOOK.lookup(Provider.ANTHROPIC, "claude-haiku-5-5", at=AT)
    long_exposure = max_exposure(haiku, max_input_tokens=100_001, max_output_tokens=10)
    assert long_exposure == ceil8((100_001 * D("1.00") + 10 * D("2.50")) / 1_000_000)


def test_actual_cost_never_exceeds_exposure_for_any_split_within_bounds():
    for schedule in PRICE_SCHEDULES:
        bound = max_exposure(schedule, max_input_tokens=5_000, max_output_tokens=500)
        for split in ((5_000, 0, 0, 0), (0, 5_000, 0, 0), (0, 0, 5_000, 0), (0, 0, 0, 5_000), (1_000, 1_000, 1_500, 1_500)):
            u = NormalizedUsage(provider=schedule.provider, status=UsageStatus.REPORTED, uncached_input=split[0],
                                cache_read=split[1], cache_write_short=split[2], cache_write_long=split[3], output=500,
                                reasoning=0)
            actual = price_usage(u, PRICE_BOOK, provider=schedule.provider, reported_model=schedule.model, at=AT)
            assert actual.status is CostStatus.COSTED and actual.cost_usd <= bound, (schedule.model, split)


@pytest.mark.parametrize("bounds", [(0, 0), (-1, 10), (10, -1), (True, 10), (10, 1.5)])
def test_max_exposure_refuses_unbounded_or_invalid_requests(bounds):
    luna = PRICE_BOOK.lookup(Provider.OPENAI, "gpt-6-luna", at=AT)
    with pytest.raises(MeteringError):
        max_exposure(luna, max_input_tokens=bounds[0], max_output_tokens=bounds[1])


# --- schedule and budget validation ----------------------------------------------------------------------------------

def test_schedule_shape_rules():
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    card = RateCard(input=D("1"), output=D("1"))
    with pytest.raises(ValidationError):  # tier needs both threshold and card
        TieredPriceSchedule(schedule_version="v", provider=Provider.OPENAI, model="m", effective_from=t0, base=card,
                            long_context_threshold=10, source="s")
    with pytest.raises(ValidationError):  # naive time
        TieredPriceSchedule(schedule_version="v", provider=Provider.OPENAI, model="m",
                            effective_from=datetime(2026, 1, 1), base=card, source="s")
    with pytest.raises(ValidationError):  # local models are never billable
        TieredPriceSchedule(schedule_version="v", provider=Provider.OLLAMA, model="m", effective_from=t0, base=card,
                            source="s")
    with pytest.raises(ValidationError):  # ends before it starts
        TieredPriceSchedule(schedule_version="v", provider=Provider.OPENAI, model="m", effective_from=t0,
                            effective_to=t0, base=card, source="s")


def test_usd_agent_budget_is_usd_and_must_nest():
    UsdAgentBudget(call_limit_usd="0.05", step_limit_usd="0.10", run_limit_usd="0.25", period_limit_usd="10")
    with pytest.raises(ValidationError):
        UsdAgentBudget(call_limit_usd="0.50", step_limit_usd="0.10", run_limit_usd="0.25", period_limit_usd="10")
    with pytest.raises(ValidationError):
        UsdAgentBudget(call_limit_usd=0.05, step_limit_usd="0.10", run_limit_usd="0.25", period_limit_usd="10")
    with pytest.raises(ValidationError):
        UsdAgentBudget(call_limit_usd="0", step_limit_usd="0.10", run_limit_usd="0.25", period_limit_usd="10")


def test_reviewed_price_book_covers_exactly_the_catalog_models():
    assert {(s.provider, s.model) for s in PRICE_SCHEDULES} == {
        (Provider.OPENAI, "gpt-6-luna"), (Provider.OPENAI, "gpt-6.1-terra"),
        (Provider.ANTHROPIC, "claude-haiku-5-5"), (Provider.ANTHROPIC, "claude-sonnet-5-5")}
    assert all(s.processing_mode == "standard" and s.effective_to is None for s in PRICE_SCHEDULES)
