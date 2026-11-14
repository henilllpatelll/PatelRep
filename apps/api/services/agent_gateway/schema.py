"""Strict validation and canonicalisation of tool arguments and outputs.

The gateway accepts only a closed, deliberately small JSON-Schema subset, and every tool schema in the gateway catalog
is checked against it at import time (``assert_supported_schema``). Anything outside the subset is a programming error,
never a silently-ignored keyword. Validation is fail-closed:

  * objects must be closed (``additionalProperties: false``) at EVERY depth; unknown fields are refused
  * types are exact: ``True`` is not an integer, ``1.0`` is not an integer, strings are never coerced
  * strings are NFC-normalised before checks and must not contain control characters; uuids are lower-cased
  * identity/authority keys (``hotel_id``, ``role``, ``approved``, ...) are refused at ANY depth, including inside arrays
  * the encoded payload and nesting depth are bounded

``canonicalize`` returns a new value (never mutating the input) that is what the gateway stores and digests, so two
spellings of the same request (key order, uuid case, NFC form) produce one action digest.
"""
from __future__ import annotations

import json
import re
import unicodedata
from typing import Any, Mapping

from services.agent_harness.vocabulary import IDENTITY_CLAIM_KEYS

MAX_INPUT_BYTES = 4_096
MAX_DEPTH = 4
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_SUPPORTED_KEYWORDS = {
    "object": {"type", "properties", "required", "additionalProperties", "description"},
    "string": {"type", "maxLength", "minLength", "pattern", "format", "enum", "description"},
    "integer": {"type", "minimum", "maximum", "description"},
    "boolean": {"type", "description"},
    "array": {"type", "items", "maxItems", "description"},
}
_NULLABLE_TYPES = {"string", "integer", "boolean"}


class SchemaViolation(ValueError):
    """A value does not satisfy its tool schema. ``code`` is stable and machine-readable; the message names a path only."""

    def __init__(self, code: str, path: str = "$") -> None:
        super().__init__(f"{code} at {path}")
        self.code = code
        self.path = path


def _types(schema: Mapping[str, Any]) -> tuple[str, bool]:
    raw = schema.get("type")
    if isinstance(raw, str):
        return raw, False
    if isinstance(raw, list) and len(raw) == 2 and "null" in raw:
        base = next(t for t in raw if t != "null")
        if base in _NULLABLE_TYPES:
            return base, True
    raise ValueError(f"unsupported schema type {raw!r}")


def assert_supported_schema(schema: Mapping[str, Any], path: str = "$", depth: int = 0) -> None:
    """Import-time guard for gateway tool schemas: only the closed subset above, closed objects everywhere."""
    if depth > MAX_DEPTH:
        raise ValueError(f"schema nests deeper than {MAX_DEPTH} at {path}")
    base, _ = _types(schema)
    allowed = _SUPPORTED_KEYWORDS.get(base)
    if allowed is None:
        raise ValueError(f"unsupported type {base!r} at {path}")
    extra = set(schema) - allowed
    if extra:
        raise ValueError(f"unsupported schema keywords {sorted(extra)} at {path}")
    if base == "object":
        if schema.get("additionalProperties") is not False or not isinstance(schema.get("properties"), dict):
            raise ValueError(f"objects must be closed with declared properties at {path}")
        claims = IDENTITY_CLAIM_KEYS & set(schema["properties"])
        if claims:
            raise ValueError(f"schema declares identity/authority fields {sorted(claims)} at {path}")
        for name, sub in schema["properties"].items():
            assert_supported_schema(sub, f"{path}.{name}", depth + 1)
    if base == "array":
        if not isinstance(schema.get("maxItems"), int) or not isinstance(schema.get("items"), dict):
            raise ValueError(f"arrays need items and maxItems at {path}")
        assert_supported_schema(schema["items"], f"{path}[]", depth + 1)
    if base == "string" and schema.get("format") not in (None, "uuid", "date-time"):
        raise ValueError(f"unsupported string format at {path}")


def scan_identity_claims(value: Any, path: str = "$", depth: int = 0) -> None:
    """Refuse identity/authority keys anywhere in an untrusted payload (a model may nest them to hide them)."""
    if depth > MAX_DEPTH + 2:
        raise SchemaViolation("payload_too_deep", path)
    if isinstance(value, Mapping):
        for key, sub in value.items():
            if not isinstance(key, str):
                raise SchemaViolation("non_string_key", path)
            if key.lower() in IDENTITY_CLAIM_KEYS:
                raise SchemaViolation("untrusted_identity_claim", f"{path}.{key}")
            scan_identity_claims(sub, f"{path}.{key}", depth + 1)
    elif isinstance(value, (list, tuple)):
        for index, sub in enumerate(value):
            scan_identity_claims(sub, f"{path}[{index}]", depth + 1)


def _canonical_string(value: str, schema: Mapping[str, Any], path: str) -> str:
    text = unicodedata.normalize("NFC", value)
    if _CONTROL_RE.search(text):
        raise SchemaViolation("control_character", path)
    fmt = schema.get("format")
    if fmt == "uuid":
        text = text.lower()
        if not UUID_RE.match(text):
            raise SchemaViolation("invalid_uuid", path)
    if "minLength" in schema and len(text) < schema["minLength"]:
        raise SchemaViolation("string_too_short", path)
    if "maxLength" in schema and len(text) > schema["maxLength"]:
        raise SchemaViolation("string_too_long", path)
    if "pattern" in schema and not re.fullmatch(schema["pattern"], text):
        raise SchemaViolation("pattern_mismatch", path)
    if "enum" in schema and text not in schema["enum"]:
        raise SchemaViolation("not_in_enum", path)
    return text


def canonicalize(value: Any, schema: Mapping[str, Any], path: str = "$", depth: int = 0) -> Any:
    """Validate ``value`` against ``schema`` and return its canonical form (new objects; input untouched)."""
    if depth > MAX_DEPTH:
        raise SchemaViolation("payload_too_deep", path)
    base, nullable = _types(schema)
    if value is None:
        if nullable:
            return None
        raise SchemaViolation("null_not_allowed", path)
    if base == "object":
        if not isinstance(value, Mapping):
            raise SchemaViolation("expected_object", path)
        props = schema["properties"]
        out: dict[str, Any] = {}
        for key in value:
            if not isinstance(key, str):
                raise SchemaViolation("non_string_key", path)
            if key not in props:
                raise SchemaViolation("unknown_field", f"{path}.{key}")
        for key in schema.get("required", []):
            if key not in value:
                raise SchemaViolation("missing_field", f"{path}.{key}")
        for key in sorted(value):
            out[key] = canonicalize(value[key], props[key], f"{path}.{key}", depth + 1)
        return out
    if base == "array":
        if not isinstance(value, (list, tuple)):
            raise SchemaViolation("expected_array", path)
        if len(value) > schema["maxItems"]:
            raise SchemaViolation("too_many_items", path)
        return [canonicalize(item, schema["items"], f"{path}[{i}]", depth + 1) for i, item in enumerate(value)]
    if base == "string":
        if not isinstance(value, str):
            raise SchemaViolation("expected_string", path)
        return _canonical_string(value, schema, path)
    if base == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            raise SchemaViolation("expected_integer", path)
        if "minimum" in schema and value < schema["minimum"]:
            raise SchemaViolation("integer_too_small", path)
        if "maximum" in schema and value > schema["maximum"]:
            raise SchemaViolation("integer_too_large", path)
        return value
    if base == "boolean":
        if not isinstance(value, bool):
            raise SchemaViolation("expected_boolean", path)
        return value
    raise SchemaViolation("unsupported_type", path)


def canonical_json(value: Any) -> bytes:
    """The exact bytes the gateway measures and digests (sorted keys, no whitespace, UTF-8)."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def validate_arguments(arguments: Any, schema: Mapping[str, Any]) -> dict:
    """Full untrusted-input pipeline: size bound, nested identity scan, strict schema, canonical form."""
    if not isinstance(arguments, Mapping):
        raise SchemaViolation("expected_object")
    try:
        encoded = canonical_json(arguments)
    except (TypeError, ValueError) as exc:
        raise SchemaViolation("malformed_encoding") from exc
    if len(encoded) > MAX_INPUT_BYTES:
        raise SchemaViolation("payload_too_large")
    scan_identity_claims(arguments)
    return canonicalize(arguments, schema)
