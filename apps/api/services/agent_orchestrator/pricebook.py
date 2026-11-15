"""Reviewed provider price schedules (H3). Changing a price = a NEW schedule version + a migration seeding the same row.

Sources, all checked 2026-11-14 against the providers' official pages (standard tier, global processing, USD/MTok):
  * OpenAI ``gpt-6-luna``: developers.openai.com/api/docs/models/gpt-6-luna and /api/docs/pricing -- input 0.10, cached
    input 0.01, cache write 0.125 (30m) / 0.25 (12h), output 0.50. ``gpt-6.1-terra``: /api/docs/models/gpt-6.1-terra --
    1.00 / 0.05 / 1.25 / 2.50 / 5.00. Both: "Prompts with more than 272K input tokens are priced at 2x input and cache
    rates and 1.5x output for the full request." 272K is read as 272,000 (the lower reading, so exposure is never
    under-stated); H3's reviewed input caps (64,000) keep every request in the base tier anyway.
  * Anthropic: platform.claude.com/docs/en/about-claude/pricing -- ``claude-haiku-5-5`` prompts up to 100,000 tokens:
    0.10 input, 0.125 5m write, 0.20 1h write, 0.01 cache hit, 0.50 output; over 100,000 (counting cache reads and
    writes): 0.50 / 0.625 / 1.00 / 0.05 / 2.50. ``claude-sonnet-5-5``: 2.00 / 2.50 / 4.00 / 0.10 / 10.00, full 1M context
    at standard price. US-only inference (1.1x), fast mode, priority and batch are NOT priced here: usage reporting any
    of them is unreconciled.

Rate-card mapping: ``cache_write_short`` = OpenAI 30m / Anthropic 5m; ``cache_write_long`` = OpenAI 12h / Anthropic 1h.
``effective_from`` is the verification date: usage before it has no schedule and is unreconciled, never back-priced.
The database copy (migration 244 seed, ``agent_model_price_schedules``) must equal this file -- a drift test checks it.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from services.agent_harness.metering import Provider
from services.agent_harness.provider_pricing import ProviderPriceBook, RateCard, TieredPriceSchedule

D = Decimal
VERIFIED_AT = datetime(2026, 11, 14, tzinfo=timezone.utc)
OPENAI_VERSION = "openai-2026-11-14"
ANTHROPIC_VERSION = "anthropic-2026-11-14"
OPENAI_LONG_CONTEXT_THRESHOLD = 272_000
HAIKU_LONG_CONTEXT_THRESHOLD = 100_000


def _openai_long(base: RateCard) -> RateCard:
    """OpenAI's documented long-context rule: 2x input and cache rates, 1.5x output."""
    return RateCard(input=base.input * 2, cache_read=base.cache_read * 2, cache_write_short=base.cache_write_short * 2,
                    cache_write_long=base.cache_write_long * 2, output=base.output * D("1.5"))


_LUNA = RateCard(input=D("0.10"), cache_read=D("0.01"), cache_write_short=D("0.125"), cache_write_long=D("0.25"),
                 output=D("0.50"))
_TERRA = RateCard(input=D("1.00"), cache_read=D("0.05"), cache_write_short=D("1.25"), cache_write_long=D("2.50"),
                  output=D("5.00"))

PRICE_SCHEDULES: tuple[TieredPriceSchedule, ...] = (
    TieredPriceSchedule(
        schedule_version=OPENAI_VERSION, provider=Provider.OPENAI, model="gpt-6-luna", effective_from=VERIFIED_AT,
        base=_LUNA, long_context_threshold=OPENAI_LONG_CONTEXT_THRESHOLD, long_context=_openai_long(_LUNA),
        source="developers.openai.com/api/docs/models/gpt-6-luna (checked 2026-11-14)"),
    TieredPriceSchedule(
        schedule_version=OPENAI_VERSION, provider=Provider.OPENAI, model="gpt-6.1-terra", effective_from=VERIFIED_AT,
        base=_TERRA, long_context_threshold=OPENAI_LONG_CONTEXT_THRESHOLD, long_context=_openai_long(_TERRA),
        source="developers.openai.com/api/docs/models/gpt-6.1-terra (checked 2026-11-14)"),
    TieredPriceSchedule(
        schedule_version=ANTHROPIC_VERSION, provider=Provider.ANTHROPIC, model="claude-haiku-5-5",
        effective_from=VERIFIED_AT,
        base=RateCard(input=D("0.10"), cache_read=D("0.01"), cache_write_short=D("0.125"), cache_write_long=D("0.20"),
                      output=D("0.50")),
        long_context_threshold=HAIKU_LONG_CONTEXT_THRESHOLD,
        long_context=RateCard(input=D("0.50"), cache_read=D("0.05"), cache_write_short=D("0.625"),
                              cache_write_long=D("1.00"), output=D("2.50")),
        source="platform.claude.com/docs/en/about-claude/pricing (checked 2026-11-14)"),
    TieredPriceSchedule(
        schedule_version=ANTHROPIC_VERSION, provider=Provider.ANTHROPIC, model="claude-sonnet-5-5",
        effective_from=VERIFIED_AT,
        base=RateCard(input=D("2.00"), cache_read=D("0.10"), cache_write_short=D("2.50"), cache_write_long=D("4.00"),
                      output=D("10.00")),
        source="platform.claude.com/docs/en/about-claude/pricing (checked 2026-11-14)"),
)

PRICE_BOOK = ProviderPriceBook(PRICE_SCHEDULES)
