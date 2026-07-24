"""Twilio SMS send wrapper. Thin by design — policy lives in the routers."""

from __future__ import annotations

import logging

from core.config import settings

logger = logging.getLogger(__name__)

TWILIO_OPTED_OUT_ERROR_CODE = 21610


class SmsNotConfiguredError(RuntimeError):
    """Raised when Twilio credentials are absent (the current local reality)."""


class SmsSendError(RuntimeError):
    """Raised when the provider rejected the send."""

    def __init__(self, message: str, error_code: str = "") -> None:
        super().__init__(message)
        self.error_code = error_code


class SmsOptedOutError(SmsSendError):
    """Twilio error 21610 — the recipient has unsubscribed (D-03 reactive opt-out)."""


def is_configured() -> bool:
    return bool(
        settings.twilio_account_sid
        and settings.twilio_auth_token
        and settings.twilio_phone_number
    )


def build_client():
    """Indirection point so tests can monkeypatch a FakeTwilioClient."""
    from twilio.rest import Client

    return Client(settings.twilio_account_sid, settings.twilio_auth_token)


def send_sms(*, to: str, body: str) -> dict:
    if not is_configured():
        raise SmsNotConfiguredError("Twilio credentials are not configured")
    client = build_client()
    try:
        message = client.messages.create(
            to=to,
            from_=settings.twilio_phone_number,
            body=body,
            status_callback=settings.twilio_status_callback_url or None,
        )
    except Exception as exc:  # noqa: BLE001 - provider exceptions vary by SDK version
        code = getattr(exc, "code", None)
        code_str = str(code) if code is not None else ""
        # Never log `to` — guest phone numbers are PII.
        logger.warning("Twilio send failed (code=%s)", code_str or "unknown")
        if code == TWILIO_OPTED_OUT_ERROR_CODE:
            raise SmsOptedOutError("Recipient has opted out of SMS", code_str) from exc
        raise SmsSendError("SMS send failed", code_str) from exc
    return {"provider_message_id": message.sid, "status": message.status}
