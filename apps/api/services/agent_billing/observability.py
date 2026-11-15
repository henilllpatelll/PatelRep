"""Metadata-only logging for H4. Allowlisted scalar fields only, secret-redacted, length-capped.

There is no field for card data, Stripe secrets, tokens, request/response bodies, email addresses or exception text.
"""
from __future__ import annotations

import json
import logging
from decimal import Decimal
from typing import Any

import re

logger = logging.getLogger("patelrep.agent_billing")

ALLOWED_FIELDS = frozenset({
    "tenant_id", "operation_id", "period_start", "sequence", "state", "outcome", "reason", "error_code",
    "amount_cents", "charge_count", "stripe_invoice_item_id", "stripe_invoice_id", "invoice_status", "event_type",
    "event_id", "examined", "dry_run", "matched_operations", "found_items", "attempt_id",
})
MAX_STRING = 120
# Defence in depth: fields are allowlisted ids/codes, but anything secret-shaped is still masked.
_SECRET = re.compile(r"(sk|rk|pk)_(live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|Bearer\s+\S+|eyJ[A-Za-z0-9_-]{10,}"
                     r"(\.[A-Za-z0-9_-]+){0,2}|\d{13,19}")


def redact(text: str) -> str:
    return _SECRET.sub("[redacted]", text)


def _clean(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    return redact(str(value))[:MAX_STRING]


def log_event(event: str, **fields: Any) -> None:
    payload = {k: _clean(v) for k, v in fields.items()
               if k in ALLOWED_FIELDS and (v is None or isinstance(v, (str, int, bool, Decimal)))}
    logger.info(json.dumps({"event": event, **payload}, sort_keys=True, default=str))
