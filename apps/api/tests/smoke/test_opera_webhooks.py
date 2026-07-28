"""
Opera Cloud webhook path: signature verification, pilot no-op gate, and per-handler
dispatch (D-05/D-03/D-06).

Signature (D-05): `_verify_opera_signature` must validate against the per-hotel
`opera_credentials.webhook_secret` (schema-provisioned, migration 002), not a
`CRON_SECRET`-derived key Oracle never knows.

Pilot no-op (D-03): the webhook dispatcher cannot 403 (Oracle isn't redirectable) —
a non-pilot hotel's webhook must be a silent no-op, mirroring the existing
"hotel not found or not connected" ignore shape.

Dispatch (D-06): each of the 5 handlers updates room_status + inserts
room_status_history with change_source="opera_webhook", tenant-scoped.

NOTE (06-RESEARCH Open Question 1 / Assumption A1): Oracle OHIP's exact webhook
signing scheme (header name, hash algorithm, canonicalization) could not be verified
against a live OHIP sandbox. These tests assert the verifiable, correct-by-construction
contract — verification uses the per-hotel opera_credentials.webhook_secret, structurally
identical to the working Twilio check — not Oracle's exact real-world wire format.
"""

import hashlib
import hmac
import json

import pytest

from routers import webhooks as webhooks_router
from services.opera import webhooks as opera_webhooks_service
from tests.smoke.fake_supabase import FakeDB

HOTEL_ID = "hotel-a"
OPERA_HOTEL_ID = "SAND01"
WEBHOOK_SECRET = "s3cret"


class FakeRequest:
    def __init__(self, payload=b"{}", headers=None):
        self._payload = payload
        self.headers = headers or {}

    async def body(self):
        return self._payload


def _make_db(pilot_enabled=True, webhook_secret=WEBHOOK_SECRET, connected=True):
    return FakeDB({
        "opera_credentials": [{
            "tenant_id": HOTEL_ID,
            "hotel_id_opera": OPERA_HOTEL_ID,
            "is_connected": connected,
            "webhook_secret": webhook_secret,
        }],
        "tenants": [{"id": HOTEL_ID, "opera_pilot_enabled": pilot_enabled}],
        "rooms": [{"id": "room-1", "tenant_id": HOTEL_ID, "room_number": "101"}],
        "room_status": [{"room_id": "room-1", "tenant_id": HOTEL_ID, "status": "OCCUPIED"}],
        "room_status_history": [],
        "tasks": [],
    })


def _sign(payload: bytes, secret: str) -> str:
    return "sha256=" + hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()


def _checkout_payload() -> bytes:
    return json.dumps({
        "hotelId": OPERA_HOTEL_ID,
        "eventType": "RESERVATION.CHECKED_OUT",
        "payload": {"roomNumber": "101"},
    }).encode()


# --- Signature verification (D-05) ---------------------------------------------


def test_signature_accepts_webhook_secret():
    """Post-fix: a signature computed with the per-hotel webhook_secret must verify."""
    payload = _checkout_payload()
    sig = _sign(payload, WEBHOOK_SECRET)
    assert webhooks_router._verify_opera_signature(payload, sig, WEBHOOK_SECRET) is True


def test_signature_rejects_cron_secret_key():
    """A signature computed with settings.cron_secret (the old, wrong key) must fail
    against the correct per-hotel webhook_secret."""
    payload = _checkout_payload()
    wrong_sig = _sign(payload, webhooks_router.settings.cron_secret)
    assert webhooks_router._verify_opera_signature(payload, wrong_sig, WEBHOOK_SECRET) is False


def test_signature_fails_closed_when_secret_missing():
    payload = _checkout_payload()
    sig = _sign(payload, "irrelevant-key")
    assert webhooks_router._verify_opera_signature(payload, sig, None) is False
    assert webhooks_router._verify_opera_signature(payload, sig, "") is False


# --- Pilot no-op gate (D-03) -----------------------------------------------------


@pytest.mark.asyncio
async def test_webhook_noop_for_non_pilot_hotel(monkeypatch):
    """A connected hotel with opera_pilot_enabled=False must silently no-op — no
    handler invoked, zero DB writes, even for a valid checkout payload."""
    db = _make_db(pilot_enabled=False)
    monkeypatch.setattr(webhooks_router, "supabase", db)

    response = await webhooks_router.opera_webhook(FakeRequest(payload=_checkout_payload()))

    assert response["status"] == "ignored"
    assert "pilot" in response.get("reason", "")
    assert db.updates == []
    assert not any(table == "room_status_history" for table, _ in db.inserts)


# --- Handler dispatch (D-06) ------------------------------------------------------


def test_handle_checkout_updates_room_status(monkeypatch):
    db = _make_db()
    monkeypatch.setattr(opera_webhooks_service, "supabase", db)

    opera_webhooks_service.handle_checkout(HOTEL_ID, {"roomNumber": "101"})

    updated = db.rows["room_status"][0]
    assert updated["status"] == "DIRTY"
    history = [row for table, row in db.inserts if table == "room_status_history"]
    assert history[-1]["change_source"] == "opera_webhook"
    assert history[-1]["to_status"] == "DIRTY"
    assert history[-1]["tenant_id"] == HOTEL_ID


def test_handle_checkin_updates_guest_info(monkeypatch):
    db = _make_db()
    monkeypatch.setattr(opera_webhooks_service, "supabase", db)

    opera_webhooks_service.handle_checkin(HOTEL_ID, {
        "roomNumber": "101",
        "reservation": {
            "guestProfile": {"firstName": "Jane", "lastName": "Doe"},
            "reservationId": "RES-1",
        },
    })

    updated = db.rows["room_status"][0]
    assert updated["guest_name"] == "Jane Doe"
    assert updated["fo_status"] == "OCC"


def test_handle_dnd_sets_flag(monkeypatch):
    db = _make_db()
    monkeypatch.setattr(opera_webhooks_service, "supabase", db)

    opera_webhooks_service.handle_dnd(HOTEL_ID, {"roomNumber": "101"})

    assert db.rows["room_status"][0]["dnd_flag"] is True


def test_handle_make_up_room_creates_task(monkeypatch):
    db = _make_db()
    monkeypatch.setattr(opera_webhooks_service, "supabase", db)

    opera_webhooks_service.handle_make_up_room(HOTEL_ID, {"roomNumber": "101"})

    assert len(db.rows["tasks"]) == 1
    assert db.rows["tasks"][0]["tenant_id"] == HOTEL_ID
    assert db.rows["tasks"][0]["room_id"] == "room-1"


# --- Unknown event / hotel no-ops --------------------------------------------------


@pytest.mark.asyncio
async def test_unknown_event_type_is_noop(monkeypatch):
    db = _make_db()
    monkeypatch.setattr(webhooks_router, "supabase", db)
    payload = json.dumps({
        "hotelId": OPERA_HOTEL_ID,
        "eventType": "SOMETHING.WEIRD",
        "payload": {},
    }).encode()

    response = await webhooks_router.opera_webhook(FakeRequest(payload=payload))

    assert response["status"] == "ok"
    assert response["event_type"] == "SOMETHING.WEIRD"
    assert db.updates == []
    assert db.inserts == []


@pytest.mark.asyncio
async def test_unknown_hotel_is_ignored(monkeypatch):
    db = FakeDB({"opera_credentials": [], "tenants": []})
    monkeypatch.setattr(webhooks_router, "supabase", db)

    response = await webhooks_router.opera_webhook(FakeRequest(payload=_checkout_payload()))

    assert response == {"status": "ignored", "reason": "hotel not found or not connected"}
    assert db.updates == []
