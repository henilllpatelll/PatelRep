"""Phase 5 Plan 02: Twilio SMS send wrapper, guest_phone/opt-out routing, and webhooks.

Live SMS delivery is NOT verifiable here — no Twilio credentials exist locally (D-01).
Every test drives services.sms.twilio_client / routers.guest_requests / routers.webhooks
against FakeTwilioClient and the in-memory FakeDB supabase double.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from twilio.request_validator import RequestValidator

from core.config import settings
from middleware.auth import CurrentUser
from models.requests import CreateGuestMessageRequest
from routers import guest_requests as guest_requests_router
from routers import webhooks as webhooks_router
from services.sms import twilio_client
from services.sms.twilio_client import SmsNotConfiguredError, SmsOptedOutError, SmsSendError
from tests.smoke.fake_supabase import FakeDB
from tests.smoke.fake_twilio_client import FakeTwilioClient


FRONT_DESK = CurrentUser(user_id="fd-1", hotel_id="hotel-a", role="front_desk", email="fd@example.com")
HOUSEKEEPER = CurrentUser(user_id="hk-1", hotel_id="hotel-a", role="housekeeper", email="hk@example.com")


def _guest_request_row(**overrides):
    row = {
        "id": "gr-1",
        "tenant_id": "hotel-a",
        "contact_consent_at": "2026-07-20T10:00:00+00:00",
        "contact_opted_out_at": None,
        "contact_preference": "sms",
        "guest_phone": "+12145550100",
    }
    row.update(overrides)
    return row


def _configure(monkeypatch):
    monkeypatch.setattr(settings, "twilio_account_sid", "AC_test")
    monkeypatch.setattr(settings, "twilio_auth_token", "auth_test")
    monkeypatch.setattr(settings, "twilio_phone_number", "+15550001111")
    monkeypatch.setattr(settings, "twilio_status_callback_url", "")


def test_send_sms_raises_when_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "twilio_account_sid", "")
    monkeypatch.setattr(settings, "twilio_auth_token", "")
    monkeypatch.setattr(settings, "twilio_phone_number", "")

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

    with pytest.raises(twilio_client.SmsOptedOutError) as exc:
        twilio_client.send_sms(to="+12145550123", body="hi")
    assert exc.value.error_code == "21610"


def test_send_sms_other_provider_error_raises_sms_send_error(monkeypatch):
    _configure(monkeypatch)
    fake = FakeTwilioClient(raise_code=30003)
    monkeypatch.setattr(twilio_client, "build_client", lambda: fake)

    with pytest.raises(twilio_client.SmsSendError) as exc:
        twilio_client.send_sms(to="+12145550123", body="hi")
    assert exc.value.error_code == "30003"


# --- Task 2: guest_phone fallback, real send, reactive opt-out, GET messages ---


@pytest.mark.asyncio
async def test_send_guest_message_falls_back_to_guest_phone(monkeypatch):
    db = FakeDB({"guest_requests": [_guest_request_row()]})
    monkeypatch.setattr(guest_requests_router, "supabase", db)
    monkeypatch.setattr(
        guest_requests_router, "send_sms",
        lambda *, to, body: {"provider_message_id": "SM_sent_1", "status": "sent"},
    )

    response = await guest_requests_router.send_guest_message(
        "gr-1",
        CreateGuestMessageRequest(body="Housekeeping is on the way", recipient=None),
        current_user=FRONT_DESK,
    )

    message = response["data"]
    assert message["recipient"] == "+12145550100"
    assert db.inserts[0][0] == "guest_messages"
    delivery_events = [row for table, row in db.inserts if table == "guest_message_delivery_events"]
    assert delivery_events[0]["status"] == "sent"
    assert delivery_events[0]["provider_message_id"] == "SM_sent_1"


@pytest.mark.asyncio
async def test_send_guest_message_missing_recipient_returns_422(monkeypatch):
    db = FakeDB({"guest_requests": [_guest_request_row(guest_phone=None)]})
    monkeypatch.setattr(guest_requests_router, "supabase", db)
    monkeypatch.setattr(guest_requests_router, "send_sms", lambda **_kwargs: None)

    with pytest.raises(HTTPException) as exc:
        await guest_requests_router.send_guest_message(
            "gr-1",
            CreateGuestMessageRequest(body="hi", recipient=None),
            current_user=FRONT_DESK,
        )

    assert exc.value.status_code == 422
    assert exc.value.detail == "No recipient phone number on file for this guest request"
    assert db.inserts == []


@pytest.mark.asyncio
async def test_send_guest_message_opt_out_sets_contact_opted_out_at(monkeypatch):
    db = FakeDB({"guest_requests": [_guest_request_row()]})
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    def _raise_opted_out(*, to, body):
        raise SmsOptedOutError("Recipient has opted out of SMS", "21610")

    monkeypatch.setattr(guest_requests_router, "send_sms", _raise_opted_out)

    with pytest.raises(HTTPException) as exc:
        await guest_requests_router.send_guest_message(
            "gr-1",
            CreateGuestMessageRequest(body="hi", recipient="+12145550100"),
            current_user=FRONT_DESK,
        )

    assert exc.value.status_code == 422
    assert exc.value.detail == "Guest has opted out of SMS"
    assert db.rows["guest_requests"][0]["contact_opted_out_at"] is not None
    delivery_events = [row for table, row in db.inserts if table == "guest_message_delivery_events"]
    assert delivery_events[0]["status"] == "opted_out"
    assert delivery_events[0]["error_code"] == "21610"
    events = [row for table, row in db.inserts if table == "guest_request_events"]
    assert any(event["detail"] == "Guest opted out of SMS" for event in events)


@pytest.mark.asyncio
async def test_send_guest_message_not_configured_records_queued_and_returns_200(monkeypatch):
    db = FakeDB({"guest_requests": [_guest_request_row()]})
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    def _raise_not_configured(*, to, body):
        raise SmsNotConfiguredError("Twilio credentials are not configured")

    monkeypatch.setattr(guest_requests_router, "send_sms", _raise_not_configured)

    response = await guest_requests_router.send_guest_message(
        "gr-1",
        CreateGuestMessageRequest(body="hi", recipient="+12145550100"),
        current_user=FRONT_DESK,
    )

    assert response["data"]["recipient"] == "+12145550100"
    delivery_events = [row for table, row in db.inserts if table == "guest_message_delivery_events"]
    assert delivery_events[0]["status"] == "queued"
    assert delivery_events[0]["failure_reason"] == "sms_provider_not_configured"


@pytest.mark.asyncio
async def test_send_guest_message_provider_error_returns_502(monkeypatch):
    db = FakeDB({"guest_requests": [_guest_request_row()]})
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    def _raise_send_error(*, to, body):
        raise SmsSendError("SMS send failed", "30003")

    monkeypatch.setattr(guest_requests_router, "send_sms", _raise_send_error)

    with pytest.raises(HTTPException) as exc:
        await guest_requests_router.send_guest_message(
            "gr-1",
            CreateGuestMessageRequest(body="hi", recipient="+12145550100"),
            current_user=FRONT_DESK,
        )

    assert exc.value.status_code == 502
    delivery_events = [row for table, row in db.inserts if table == "guest_message_delivery_events"]
    assert delivery_events[0]["status"] == "failed"
    assert delivery_events[0]["error_code"] == "30003"


@pytest.mark.asyncio
async def test_list_guest_messages_uses_latest_delivery_event(monkeypatch):
    db = FakeDB({
        "guest_requests": [_guest_request_row()],
        "guest_messages": [
            {
                "id": "msg-1", "tenant_id": "hotel-a", "guest_request_id": "gr-1",
                "direction": "outbound", "channel": "sms", "body": "hi",
                "recipient": "+12145550100", "delivery_status": "queued",
                "created_at": "2026-07-20T10:00:00+00:00",
            },
        ],
        "guest_message_delivery_events": [
            {
                "id": "ev-1", "tenant_id": "hotel-a", "guest_message_id": "msg-1",
                "status": "sent", "failure_reason": None,
                "created_at": "2026-07-20T10:00:01+00:00",
            },
            {
                "id": "ev-2", "tenant_id": "hotel-a", "guest_message_id": "msg-1",
                "status": "delivered", "failure_reason": None,
                "created_at": "2026-07-20T10:00:05+00:00",
            },
        ],
    })
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    response = await guest_requests_router.list_guest_messages("gr-1", current_user=FRONT_DESK)

    assert response["data"][0]["effective_delivery_status"] == "delivered"


@pytest.mark.asyncio
async def test_list_guest_messages_rejects_unauthorized_role(monkeypatch):
    db = FakeDB({"guest_requests": [_guest_request_row()]})
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await guest_requests_router.list_guest_messages("gr-1", current_user=HOUSEKEEPER)

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_list_guest_messages_cross_tenant_returns_404(monkeypatch):
    db = FakeDB({"guest_requests": [_guest_request_row(tenant_id="hotel-b")]})
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await guest_requests_router.list_guest_messages("gr-1", current_user=FRONT_DESK)

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_create_guest_request_persists_guest_phone(monkeypatch):
    from models.requests import CreateGuestRequestRequest

    db = FakeDB({"guest_request_sla_policies": [], "tasks": []})
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    response = await guest_requests_router.create_guest_request(
        CreateGuestRequestRequest(title="AC not working", guest_phone="+12145550199"),
        current_user=FRONT_DESK,
    )

    assert response["data"]["guest_phone"] == "+12145550199"


# --- Task 3: inbound + status-callback webhooks ---


class FakeTwilioRequest:
    def __init__(self, form: dict, headers: dict | None = None, path: str = "/v1/webhooks/twilio-sms"):
        self._form = form
        self.headers = headers or {}
        self.url = SimpleNamespace(path=path)

    async def form(self):
        return self._form


def _signed_headers(form: dict, path: str, proto: str = "https", host: str = "api.example.com"):
    url = f"{proto}://{host}{path}"
    signature = RequestValidator("auth_test").compute_signature(url, form)
    return {"x-twilio-signature": signature, "x-forwarded-proto": proto, "host": host}


@pytest.mark.asyncio
async def test_twilio_signature_rejected_in_production(monkeypatch):
    _configure(monkeypatch)
    monkeypatch.setattr(settings, "app_env", "production")
    db = FakeDB({"guest_messages": []})
    monkeypatch.setattr(webhooks_router, "supabase", db)
    form = {"From": "+12145550100", "Body": "hi", "MessageSid": "SMabc"}
    request = FakeTwilioRequest(form, headers={"x-twilio-signature": "wrong"})

    with pytest.raises(HTTPException) as exc:
        await webhooks_router.twilio_sms_webhook(request)

    assert exc.value.status_code == 401
    assert db.inserts == []


@pytest.mark.asyncio
async def test_twilio_signature_skipped_in_development(monkeypatch):
    _configure(monkeypatch)
    monkeypatch.setattr(settings, "app_env", "development")
    db = FakeDB({"guest_messages": []})
    monkeypatch.setattr(webhooks_router, "supabase", db)
    form = {"From": "+12145550100", "Body": "hi", "MessageSid": "SMabc"}
    request = FakeTwilioRequest(form, headers={})

    response = await webhooks_router.twilio_sms_webhook(request)

    assert response == {"status": "ignored", "reason": "no_matching_outbound"}


@pytest.mark.asyncio
async def test_signature_url_uses_forwarded_proto(monkeypatch):
    _configure(monkeypatch)
    monkeypatch.setattr(settings, "app_env", "production")
    db = FakeDB({"guest_messages": []})
    monkeypatch.setattr(webhooks_router, "supabase", db)
    form = {"From": "+12145550100", "Body": "hi", "MessageSid": "SMabc"}
    headers = _signed_headers(form, "/v1/webhooks/twilio-sms")
    request = FakeTwilioRequest(form, headers=headers)

    response = await webhooks_router.twilio_sms_webhook(request)

    assert response == {"status": "ignored", "reason": "no_matching_outbound"}


@pytest.mark.asyncio
async def test_reply_only_match_appends_to_existing_request(monkeypatch):
    _configure(monkeypatch)
    monkeypatch.setattr(settings, "app_env", "development")
    recent = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    db = FakeDB({
        "guest_messages": [{
            "id": "msg-1", "tenant_id": "hotel-a", "guest_request_id": "gr-1",
            "direction": "outbound", "recipient": "+12145550100",
            "created_at": recent,
        }],
        "guest_request_events": [],
    })
    monkeypatch.setattr(webhooks_router, "supabase", db)
    form = {"From": "+12145550100", "Body": "On my way", "MessageSid": "SMreply1"}
    request = FakeTwilioRequest(form)

    response = await webhooks_router.twilio_sms_webhook(request)

    assert response == {"status": "ok"}
    inbound = [row for table, row in db.inserts if table == "guest_messages" and row.get("direction") == "inbound"]
    assert inbound[0]["guest_request_id"] == "gr-1"
    assert inbound[0]["excluded_from_ai"] is True
    events = [row for table, row in db.inserts if table == "guest_request_events"]
    assert events[0]["event_type"] == "guest_contacted"
    assert events[0]["source"] == "sms"


@pytest.mark.asyncio
async def test_reply_ignores_outbound_older_than_match_window(monkeypatch):
    # WR-04: the global Twilio number cannot disambiguate tenants, so a stale outbound
    # from another hotel must not capture a fresh inbound reply.
    _configure(monkeypatch)
    monkeypatch.setattr(settings, "app_env", "development")
    stale = (
        datetime.now(timezone.utc)
        - timedelta(hours=webhooks_router.INBOUND_MATCH_WINDOW_HOURS + 1)
    ).isoformat()
    db = FakeDB({
        "guest_messages": [{
            "id": "msg-1", "tenant_id": "hotel-a", "guest_request_id": "gr-1",
            "direction": "outbound", "recipient": "+12145550100",
            "created_at": stale,
        }],
        "guest_request_events": [],
    })
    monkeypatch.setattr(webhooks_router, "supabase", db)
    form = {"From": "+12145550100", "Body": "On my way", "MessageSid": "SMreply2"}
    request = FakeTwilioRequest(form)

    response = await webhooks_router.twilio_sms_webhook(request)

    assert response == {"status": "ignored", "reason": "no_matching_outbound"}
    assert [table for table, _ in db.inserts if table == "guest_messages"] == []


@pytest.mark.asyncio
async def test_reply_only_no_match_creates_nothing(monkeypatch):
    _configure(monkeypatch)
    monkeypatch.setattr(settings, "app_env", "development")
    db = FakeDB({"guest_messages": [], "guest_requests": [], "guest_request_events": []})
    monkeypatch.setattr(webhooks_router, "supabase", db)
    form = {"From": "+19995550000", "Body": "hello?", "MessageSid": "SMcold1"}
    request = FakeTwilioRequest(form)

    response = await webhooks_router.twilio_sms_webhook(request)

    assert response == {"status": "ignored", "reason": "no_matching_outbound"}
    assert [table for table, _ in db.inserts if table == "guest_requests"] == []
    assert [table for table, _ in db.inserts if table == "guest_messages"] == []
    assert [table for table, _ in db.inserts if table == "guest_request_events"] == []


@pytest.mark.asyncio
async def test_status_callback_appends_delivery_event(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "development")
    db = FakeDB({
        "guest_message_delivery_events": [{
            "id": "ev-1", "tenant_id": "hotel-a", "guest_message_id": "msg-1",
            "status": "sent", "provider_message_id": "SMsent1",
            "created_at": "2026-07-20T10:00:00+00:00",
        }],
    })
    monkeypatch.setattr(webhooks_router, "supabase", db)
    form = {"MessageSid": "SMsent1", "MessageStatus": "delivered"}
    request = FakeTwilioRequest(form, path="/v1/webhooks/twilio-status")

    response = await webhooks_router.twilio_status_webhook(request)

    assert response == {"status": "ok"}
    inserted = [row for table, row in db.inserts if table == "guest_message_delivery_events"]
    assert inserted[0]["status"] == "delivered"
    assert inserted[0]["guest_message_id"] == "msg-1"


@pytest.mark.asyncio
async def test_status_callback_unknown_message_sid_is_ignored(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "development")
    db = FakeDB({"guest_message_delivery_events": []})
    monkeypatch.setattr(webhooks_router, "supabase", db)
    form = {"MessageSid": "SMunknown", "MessageStatus": "delivered"}
    request = FakeTwilioRequest(form, path="/v1/webhooks/twilio-status")

    response = await webhooks_router.twilio_status_webhook(request)

    assert response == {"status": "ignored", "reason": "unknown_message"}
    assert db.inserts == []
