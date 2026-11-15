"""Provider usage normalisation (H3). Pure: plain mappings in, a validated ``NormalizedUsage`` out.

Providers disagree on what ``input_tokens`` means, and pricing depends on getting it right:

* **OpenAI Responses**: ``input_tokens`` INCLUDES cache reads (``input_tokens_details.cached_tokens``) and cache writes
  (``input_tokens_details.cache_write_tokens``, split by ``cache_write_tokens_details.ttl_30m_tokens`` /
  ``ttl_12h_tokens``). Ordinary input = input - cached - written. ``output_tokens`` INCLUDES ``reasoning_tokens``.
* **Anthropic Messages**: ``input_tokens`` is the UNCACHED remainder only. ``cache_read_input_tokens`` and
  ``cache_creation_input_tokens`` (split by ``cache_creation.ephemeral_5m_input_tokens`` / ``ephemeral_1h_input_tokens``)
  are separate and are ADDED. ``output_tokens`` includes thinking.

``NormalizedUsage`` holds disjoint categories, so a price can be applied to each exactly once. Missing usage is
``unreported`` (never zero). Anything inconsistent, ambiguous or unknown is ``malformed`` or lands in ``unpriced`` --
both make the call unreconciled downstream instead of guessing. No I/O, no provider SDK imports.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Mapping, Optional

from pydantic import BaseModel, ConfigDict, Field, StrictStr, model_validator

from services.agent_harness.metering import Provider, TokenCount

STANDARD_MODE = "standard"

_OPENAI_TOP = frozenset({"input_tokens", "input_tokens_details", "output_tokens", "output_tokens_details",
                         "total_tokens"})
_OPENAI_INPUT_DETAILS = frozenset({"cached_tokens", "cache_write_tokens", "cache_write_tokens_details"})
_OPENAI_OUTPUT_DETAILS = frozenset({"reasoning_tokens"})
_OPENAI_STANDARD_TIERS = frozenset({"default"})
_ANTHROPIC_TOP = frozenset({"input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens",
                            "cache_creation", "service_tier", "inference_geo", "speed", "server_tool_use",
                            "output_tokens_details"})
_ANTHROPIC_GLOBAL_GEOS = frozenset({None, "global", "not_available"})


class UsageStatus(str, Enum):
    REPORTED = "reported"
    UNREPORTED = "unreported"  # the provider returned no usage: cost unknown, exposure must be retained
    MALFORMED = "malformed"  # usage present but inconsistent/ambiguous: never priced by guesswork


class NormalizedUsage(BaseModel):
    """Disjoint, provider-neutral token categories for one provider request."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    provider: Provider
    status: UsageStatus
    uncached_input: Optional[TokenCount] = None
    cache_read: Optional[TokenCount] = None
    cache_write_short: Optional[TokenCount] = None  # OpenAI 30m / Anthropic 5m retention
    cache_write_long: Optional[TokenCount] = None  # OpenAI 12h / Anthropic 1h retention
    output: Optional[TokenCount] = None  # includes reasoning/thinking tokens
    reasoning: Optional[TokenCount] = None  # informational subset of ``output``; never priced separately
    unpriced: Mapping[str, TokenCount] = Field(default_factory=dict)  # non-zero categories with no known price
    processing_mode: StrictStr = STANDARD_MODE
    malformed_reason: Optional[StrictStr] = None

    @model_validator(mode="after")
    def _consistent(self) -> "NormalizedUsage":
        counts = list(self.counts().values())
        if self.status is UsageStatus.REPORTED:
            if any(c is None for c in counts) or self.malformed_reason is not None:
                raise ValueError("reported usage carries every category and no malformed reason")
            if self.reasoning > self.output:
                raise ValueError("reasoning tokens are a subset of output tokens")
        else:
            if any(c is not None for c in counts) or self.unpriced:
                raise ValueError("unreported/malformed usage carries no token counts (no invented zeros)")
            if (self.status is UsageStatus.MALFORMED) != (self.malformed_reason is not None):
                raise ValueError("only malformed usage states a malformed reason")
        return self

    @property
    def prompt_tokens(self) -> Optional[int]:
        """Every input token the provider counted (drives long-context tier selection)."""
        if self.status is not UsageStatus.REPORTED:
            return None
        return self.uncached_input + self.cache_read + self.cache_write_short + self.cache_write_long

    def counts(self) -> dict[str, Optional[int]]:
        return {"uncached_input": self.uncached_input, "cache_read": self.cache_read,
                "cache_write_short": self.cache_write_short, "cache_write_long": self.cache_write_long,
                "output": self.output, "reasoning": self.reasoning}


def _unreported(provider: Provider) -> NormalizedUsage:
    return NormalizedUsage(provider=provider, status=UsageStatus.UNREPORTED)


def _malformed(provider: Provider, reason: str) -> NormalizedUsage:
    return NormalizedUsage(provider=provider, status=UsageStatus.MALFORMED, malformed_reason=reason)


def _int(value: Any) -> Optional[int]:
    """A non-negative exact int, or None. Bools, floats and strings are not token counts."""
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _mapping(value: Any) -> Optional[Mapping[str, Any]]:
    return value if isinstance(value, Mapping) else None


def _unknown_counts(source: Mapping[str, Any], known: frozenset[str], prefix: str) -> Optional[dict[str, int]]:
    """Non-zero integer fields we do not know how to price. None = a non-integer unknown field (malformed)."""
    found: dict[str, int] = {}
    for key, value in source.items():
        if key in known or value is None or value == 0:
            continue
        if isinstance(value, Mapping):  # an unknown breakdown may still hold billable counts
            for sub_key, sub_value in value.items():
                sub_count = _int(sub_value)
                if sub_count:
                    found[f"{prefix}{key}.{sub_key}"] = sub_count
            continue
        if isinstance(value, (list, str)):
            continue  # descriptive metadata, not a billable count
        count = _int(value)
        if count is None:
            return None
        found[f"{prefix}{key}"] = count
    return found


def normalize_openai_usage(usage: Optional[Mapping[str, Any]], *, service_tier: Optional[str],
                           requested_service_tier: str) -> NormalizedUsage:
    """Normalise a Responses API ``usage`` object (as a plain mapping) and the response's ``service_tier``."""
    provider = Provider.OPENAI
    if usage is None:
        return _unreported(provider)
    if not isinstance(usage, Mapping):
        return _malformed(provider, "usage_not_an_object")
    total_in, total_out = _int(usage.get("input_tokens")), _int(usage.get("output_tokens"))
    in_details = _mapping(usage.get("input_tokens_details")) or {}
    out_details = _mapping(usage.get("output_tokens_details")) or {}
    if total_in is None or total_out is None:
        return _malformed(provider, "missing_input_or_output_tokens")
    cached = _int(in_details.get("cached_tokens", 0))
    written = _int(in_details.get("cache_write_tokens", 0))
    reasoning = _int(out_details.get("reasoning_tokens", 0))
    if cached is None or written is None or reasoning is None:
        return _malformed(provider, "invalid_detail_counts")
    uncached = total_in - cached - written
    if uncached < 0:
        return _malformed(provider, "cache_tokens_exceed_input")
    if reasoning > total_out:
        return _malformed(provider, "reasoning_exceeds_output")
    total = usage.get("total_tokens")
    if total is not None and _int(total) != total_in + total_out:
        return _malformed(provider, "total_mismatch")
    short = long_ = 0
    if written:
        split = _mapping(in_details.get("cache_write_tokens_details"))
        short_v = _int((split or {}).get("ttl_30m_tokens", 0))
        long_v = _int((split or {}).get("ttl_12h_tokens", 0))
        if split is None or short_v is None or long_v is None or short_v + long_v != written:
            return _malformed(provider, "ambiguous_cache_write_ttl")
        short, long_ = short_v, long_v
    unpriced: dict[str, int] = {}
    for source, known, prefix in ((usage, _OPENAI_TOP, "openai."),
                                  (in_details, _OPENAI_INPUT_DETAILS, "openai.input_tokens_details."),
                                  (out_details, _OPENAI_OUTPUT_DETAILS, "openai.output_tokens_details.")):
        extra = _unknown_counts(source, known, prefix)
        if extra is None:
            return _malformed(provider, "unknown_non_integer_category")
        unpriced.update(extra)
    tier = service_tier if service_tier is not None else requested_service_tier
    mode = STANDARD_MODE if tier in _OPENAI_STANDARD_TIERS else f"openai:{tier}"
    return NormalizedUsage(provider=provider, status=UsageStatus.REPORTED, uncached_input=uncached, cache_read=cached,
                           cache_write_short=short, cache_write_long=long_, output=total_out, reasoning=reasoning,
                           unpriced=unpriced, processing_mode=mode)


def normalize_anthropic_usage(usage: Optional[Mapping[str, Any]], *, requested_standard_only: bool) -> NormalizedUsage:
    """Normalise a Messages API ``usage`` object (as a plain mapping)."""
    provider = Provider.ANTHROPIC
    if usage is None:
        return _unreported(provider)
    if not isinstance(usage, Mapping):
        return _malformed(provider, "usage_not_an_object")
    uncached, output = _int(usage.get("input_tokens")), _int(usage.get("output_tokens"))
    if uncached is None or output is None:
        return _malformed(provider, "missing_input_or_output_tokens")
    read = _int(usage.get("cache_read_input_tokens") or 0)
    written = _int(usage.get("cache_creation_input_tokens") or 0)
    if read is None or written is None:
        return _malformed(provider, "invalid_cache_counts")
    short = long_ = 0
    if written:
        split = _mapping(usage.get("cache_creation"))
        short_v = _int((split or {}).get("ephemeral_5m_input_tokens", 0))
        long_v = _int((split or {}).get("ephemeral_1h_input_tokens", 0))
        if split is None or short_v is None or long_v is None or short_v + long_v != written:
            return _malformed(provider, "ambiguous_cache_write_ttl")
        short, long_ = short_v, long_v
    thinking = 0
    details = _mapping(usage.get("output_tokens_details"))
    if details is not None:
        thinking_v = _int(details.get("thinking_tokens", 0))
        if thinking_v is None or thinking_v > output:
            return _malformed(provider, "reasoning_exceeds_output")
        thinking = thinking_v
    unpriced: dict[str, int] = {}
    extra = _unknown_counts(usage, _ANTHROPIC_TOP, "anthropic.")
    if extra is None:
        return _malformed(provider, "unknown_non_integer_category")
    unpriced.update(extra)
    server_tools = _mapping(usage.get("server_tool_use")) or {}
    for key, value in server_tools.items():
        count = _int(value)
        if count is None and value is not None:
            return _malformed(provider, "invalid_server_tool_usage")
        if count:
            unpriced[f"anthropic.server_tool_use.{key}"] = count  # web search/fetch are billed per request
    tier = usage.get("service_tier")
    geo = usage.get("inference_geo")
    speed = usage.get("speed")
    if tier is None and not requested_standard_only:
        mode = "anthropic:unknown_tier"
    elif tier not in (None, "standard"):
        mode = f"anthropic:{tier}"
    elif geo not in _ANTHROPIC_GLOBAL_GEOS:
        mode = f"anthropic:geo_{geo}"  # US-only inference is billed at 1.1x
    elif speed not in (None, "standard"):
        mode = f"anthropic:speed_{speed}"
    else:
        mode = STANDARD_MODE
    return NormalizedUsage(provider=provider, status=UsageStatus.REPORTED, uncached_input=uncached, cache_read=read,
                           cache_write_short=short, cache_write_long=long_, output=output, reasoning=thinking,
                           unpriced=unpriced, processing_mode=mode)
