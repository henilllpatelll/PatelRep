"""Tool output enforcement: redaction, strict schema, byte and item limits.

Output is DATA. It is returned to the run (and, from H3, to a model) wrapped as untrusted tool output; nothing in it --
including text that looks like "system instructions" -- is ever interpreted as a policy input or an instruction.
Order matters: redact first (a secret must never reach storage), then validate the exact declared shape, then measure.
"""
from __future__ import annotations

import re
from typing import Any

from services.agent_gateway.errors import OutputRejected
from services.agent_gateway.schema import SchemaViolation, canonical_json, canonicalize
from services.agent_harness.tools import ToolSpec

REDACTED = "[redacted]"
_SECRET_PATTERNS = (
    re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"),  # JWTs (incl. Supabase keys)
    re.compile(r"\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}"),                # Stripe-style keys
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}"),                                      # provider API keys
    re.compile(r"\b[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@\S+", re.I),            # credentials in URLs
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{12,}", re.I),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
)


def redact(value: Any) -> Any:
    """Return a copy with secret-shaped substrings replaced. Never mutates the input."""
    if isinstance(value, str):
        for pattern in _SECRET_PATTERNS:
            value = pattern.sub(REDACTED, value)
        return value
    if isinstance(value, dict):
        return {k: redact(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    return value


def _item_count(value: Any) -> int:
    lists = [len(v) for v in value.values() if isinstance(v, list)] if isinstance(value, dict) else []
    return max([1, *lists])


def enforce_output(spec: ToolSpec, raw: Any) -> dict:
    if not isinstance(raw, dict):
        raise OutputRejected("output_not_object")
    try:
        clean = canonicalize(redact(raw), spec.output_schema)
    except SchemaViolation as exc:
        raise OutputRejected(f"output_{exc.code}") from exc
    if _item_count(clean) > spec.max_output_items:
        raise OutputRejected("output_too_many_items")
    if len(canonical_json(clean)) > spec.max_output_bytes:
        raise OutputRejected("output_too_large")
    return clean


def as_untrusted_tool_result(tool: ToolSpec, output: dict) -> dict:
    """The envelope a consumer (H3 orchestrator) receives: provenance plus data, explicitly not instructions."""
    return {"kind": "tool_result", "trusted_instructions": False, "tool_id": tool.tool_id,
            "tool_version": tool.version, "data": output}
