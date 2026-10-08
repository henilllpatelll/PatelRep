"""Transactional email via the Resend REST API.

Never simulates success: ``send_email`` either returns the provider's message id or raises
``EmailError``. ``is_configured`` is False without credentials (and in a staging process
that has not enabled external integrations), so callers can surface "Delivery not
configured" honestly.
"""
from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from typing import Optional

import httpx

from core.config import settings

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"
TIMEOUT_SECONDS = 20.0
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024  # stay well under typical provider limits


class EmailError(Exception):
    """Delivery failed. ``retryable`` marks transient provider/network failures."""

    def __init__(self, summary: str, *, retryable: bool):
        super().__init__(summary)
        self.summary = summary
        self.retryable = retryable


@dataclass(frozen=True)
class Attachment:
    filename: str
    content: bytes


def configuration_status() -> dict:
    """What an authorised admin can be told about delivery readiness (no secrets)."""
    missing = [name for name, value in (("RESEND_API_KEY", settings.resend_api_key), ("REPORT_EMAIL_FROM", settings.report_email_from)) if not value]
    blocked_by_env = settings.app_env == "staging" and not settings.staging_external_integrations_enabled
    return {
        "configured": not missing and not blocked_by_env,
        "missing": missing,
        "blocked_reason": "External integrations are disabled in this staging environment." if blocked_by_env else None,
        "required_env": ["RESEND_API_KEY", "REPORT_EMAIL_FROM"],
    }


def is_configured() -> bool:
    return configuration_status()["configured"]


def send_email(
    *, to: list[str], subject: str, html: str, text: str, attachments: Optional[list[Attachment]] = None,
    idempotency_key: Optional[str] = None,
) -> str:
    if not is_configured():
        raise EmailError("Email delivery is not configured", retryable=False)
    if not to:
        raise EmailError("No recipients with an email address", retryable=False)
    payload: dict = {"from": settings.report_email_from, "to": to, "subject": subject, "html": html, "text": text}
    if attachments:
        if sum(len(a.content) for a in attachments) > MAX_ATTACHMENT_BYTES:
            raise EmailError("Report attachment exceeds the email size limit", retryable=False)
        payload["attachments"] = [{"filename": a.filename, "content": base64.b64encode(a.content).decode("ascii")} for a in attachments]
    headers = {"Authorization": f"Bearer {settings.resend_api_key}", "Content-Type": "application/json"}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key[:256]
    try:
        response = httpx.post(RESEND_URL, json=payload, headers=headers, timeout=TIMEOUT_SECONDS)
    except httpx.HTTPError as exc:
        logger.warning("Resend request failed: %s", type(exc).__name__)
        raise EmailError("Could not reach the email provider", retryable=True) from exc
    if response.status_code in (429,) or response.status_code >= 500:
        raise EmailError(f"Email provider unavailable (HTTP {response.status_code})", retryable=True)
    if response.status_code >= 400:
        # Provider error text can echo request details; log status only, return a fixed summary.
        logger.warning("Resend rejected email: HTTP %s", response.status_code)
        raise EmailError(f"Email provider rejected the message (HTTP {response.status_code})", retryable=False)
    message_id = (response.json() or {}).get("id")
    if not message_id:
        raise EmailError("Email provider returned no message id", retryable=True)
    return str(message_id)
