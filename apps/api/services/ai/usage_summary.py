"""Hotel-level AI usage summary, built only from the existing `ai_interactions` audit log.

No new ledger and no new table: every number comes from rows the AI routes already write (tokens and
credits from the provider's real usage, latency, success, and two markers — a refusal at the cap and an
answer served from a cache). Rows carry no message text, no guest data and no images, and this summary
carries no person identifiers either.

Honesty rules: dollars are derived ONLY from recorded tokens at the list rates in `middleware.credits`
and are labelled an estimate (the provider's invoice is authoritative); a request with no recorded tokens
is counted as `unmetered`, never as free.
"""

from __future__ import annotations

import math
from typing import Iterable

from middleware.credits import CACHE_HIT_MODEL, CREDIT_LIMIT_MARKER, INTERACTION_MODEL, MODEL_RATES

TIMEOUT_WORDS = ("timeout", "timed out")


def failure_kind(error_message: str | None) -> str:
    text = (error_message or "").lower()
    if text == CREDIT_LIMIT_MARKER:
        return "credit_limit"
    if any(word in text for word in TIMEOUT_WORDS):
        return "timeout"
    return "failed"


def _p95(values: list[int]) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(0.95 * len(ordered)) - 1)]


def _bucket() -> dict:
    return {
        "requests": 0, "succeeded": 0, "failed": 0, "timeouts": 0, "credit_limit_rejections": 0,
        "cache_hits": 0, "unmetered": 0, "prompt_tokens": 0, "completion_tokens": 0, "credits": 0.0,
        "_latencies": [],
    }


def _finish(bucket: dict) -> dict:
    latencies = bucket.pop("_latencies")
    bucket["credits"] = round(bucket["credits"], 4)
    bucket["avg_latency_ms"] = round(sum(latencies) / len(latencies)) if latencies else None
    bucket["p95_latency_ms"] = _p95(latencies)
    answered = bucket["requests"] - bucket["credit_limit_rejections"]
    bucket["cache_hit_rate"] = round(bucket["cache_hits"] / answered, 3) if answered > 0 else None
    return bucket


def estimated_usd(prompt_tokens: int, completion_tokens: int, model_key: str) -> float:
    rates = MODEL_RATES.get(model_key)
    if not rates:
        return 0.0
    return (prompt_tokens / 1_000_000) * rates["in"] + (completion_tokens / 1_000_000) * rates["out"]


def summarize(rows: Iterable[dict]) -> dict:
    by_feature: dict[str, dict] = {}
    by_model: dict[str, dict] = {}
    total = _bucket()
    estimated = 0.0
    for row in rows:
        feature = row.get("interaction_type") or "unknown"
        model = row.get("model_used") or "unknown"
        pt, ct = int(row.get("prompt_tokens") or 0), int(row.get("completion_tokens") or 0)
        succeeded = bool(row.get("success"))
        kind = None if succeeded else failure_kind(row.get("error_message"))
        cached = succeeded and model == CACHE_HIT_MODEL
        latency = row.get("latency_ms")

        for bucket in (total, by_feature.setdefault(feature, _bucket()), by_model.setdefault(model, _bucket())):
            bucket["requests"] += 1
            bucket["prompt_tokens"] += pt
            bucket["completion_tokens"] += ct
            bucket["credits"] += float(row.get("credits_charged") or 0)
            if succeeded:
                bucket["succeeded"] += 1
            else:
                bucket["failed"] += kind == "failed"
                bucket["timeouts"] += kind == "timeout"
                bucket["credit_limit_rejections"] += kind == "credit_limit"
            if cached:
                bucket["cache_hits"] += 1
            elif succeeded and pt == 0 and ct == 0 and model not in ("none", "rule_engine"):
                bucket["unmetered"] += 1  # a model name but no recorded usage: not counted as free
            if isinstance(latency, (int, float)) and latency >= 0 and kind != "credit_limit":
                bucket["_latencies"].append(int(latency))

        if succeeded and not cached:
            estimated += estimated_usd(pt, ct, INTERACTION_MODEL.get(feature, "gpt-4o-mini"))

    return {
        "totals": {**_finish(total), "estimated_provider_cost_usd": round(estimated, 4)},
        "by_feature": {key: _finish(value) for key, value in sorted(by_feature.items())},
        "by_model": {key: _finish(value) for key, value in sorted(by_model.items())},
    }
