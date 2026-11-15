"""Metadata-only structured logging for H3 (no external tracing vendor; SDK tracing is disabled in sdk_model.py).

Only ALLOWLISTED field names are emitted, only scalar values, every string is secret-redacted (the gateway's redaction
patterns) and length-capped. There is no field for prompts, completions, reasoning, tool arguments, provider error
messages or exception objects, so they cannot be logged by accident.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from services.agent_gateway.output import redact

logger = logging.getLogger("patelrep.agent_orchestrator")

ALLOWED_FIELDS = frozenset({
    "correlation_id", "run_id", "step_id", "tenant_id", "attempt_id", "attempt_number", "logical_call_key",
    "provider", "requested_model", "reported_model", "provider_request_id", "provider_response_id",
    "schedule_version", "catalog_version", "workload", "input_token_bound", "max_output_tokens",
    "uncached_input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens", "reasoning_tokens",
    "usage_status", "cost_status", "cost_cause", "reserved_usd", "cost_usd", "settlement", "dispatch_state",
    "latency_ms", "retry_count", "fallback_count", "error_code", "reason", "outcome", "plan_outcome",
    "proposal_count", "model_calls", "http_status",
})
MAX_STRING = 120


def _clean(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        return round(value, 3)
    text = redact(str(value))
    return text[:MAX_STRING] if isinstance(text, str) else None


def safe_fields(fields: dict[str, Any]) -> dict[str, Any]:
    return {k: _clean(v) for k, v in fields.items()
            if k in ALLOWED_FIELDS and (v is None or isinstance(v, (str, int, float, bool)) or _is_decimal(v))}


def _is_decimal(value: Any) -> bool:
    return type(value).__name__ == "Decimal"


def log_event(event: str, **fields: Any) -> dict[str, Any]:
    """Emit one JSON line; returns the exact payload (used by redaction tests)."""
    payload = {"event": event if event.replace("_", "").isalnum() else "invalid_event", **safe_fields(fields)}
    logger.info(json.dumps(payload, sort_keys=True, default=str))
    return payload
