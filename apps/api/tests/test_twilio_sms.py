"""Phase 5 Plan 02: Twilio SMS send wrapper, guest_phone/opt-out routing, and webhooks.

Live SMS delivery is NOT verifiable here — no Twilio credentials exist locally (D-01).
Every test drives services.sms.twilio_client / routers.guest_requests / routers.webhooks
against FakeTwilioClient and the in-memory FakeDB supabase double.
"""

from core.config import settings
from services.sms import twilio_client
from tests.smoke.fake_twilio_client import FakeTwilioClient


def _configure(monkeypatch):
    monkeypatch.setattr(settings, "twilio_account_sid", "AC_test")
    monkeypatch.setattr(settings, "twilio_auth_token", "auth_test")
    monkeypatch.setattr(settings, "twilio_phone_number", "+15550001111")
    monkeypatch.setattr(settings, "twilio_status_callback_url", "")


def test_send_sms_raises_when_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "twilio_account_sid", "")
    monkeypatch.setattr(settings, "twilio_auth_token", "")
    monkeypatch.setattr(settings, "twilio_phone_number", "")

    import pytest

    with pytest.raises(twilio_client.SmsNotConfiguredError):
        twilio_client.send_sms(to="+12145550123", body="hi")


def test_send_sms_returns_provider_sid_and_status(monkeypatch):
    _configure(monkeypatch)
    fake = FakeTwilioClient(next_sid="SM123", next_status="queued")
    monkeypatch.setattr(twilio_client, "build_client", lambda: fake)

    result = twilio_client.send_sms(to="+12145550123", body="hi")

    assert result == {"provider_message_id": "SM123", "status": "queued"}
    assert fake.sent == [{
        "to": "+12145550123",
        "from_": "+15550001111",
        "body": "hi",
        "status_callback": None,
    }]


def test_send_sms_opt_out_error_code_21610_raises_sms_opted_out_error(monkeypatch):
    _configure(monkeypatch)
    fake = FakeTwilioClient(raise_code=21610)
    monkeypatch.setattr(twilio_client, "build_client", lambda: fake)

    import pytest

    with pytest.raises(twilio_client.SmsOptedOutError) as exc:
        twilio_client.send_sms(to="+12145550123", body="hi")
    assert exc.value.error_code == "21610"


def test_send_sms_other_provider_error_raises_sms_send_error(monkeypatch):
    _configure(monkeypatch)
    fake = FakeTwilioClient(raise_code=30003)
    monkeypatch.setattr(twilio_client, "build_client", lambda: fake)

    import pytest

    with pytest.raises(twilio_client.SmsSendError) as exc:
        twilio_client.send_sms(to="+12145550123", body="hi")
    assert exc.value.error_code == "30003"
