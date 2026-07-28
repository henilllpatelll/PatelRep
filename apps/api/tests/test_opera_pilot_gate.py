"""
D-03 Opera pilot-flag enforcement tests.

`tenants.opera_pilot_enabled` gates all 7 /integrations/opera/* endpoints AND the
reservation-sync cron path (services/opera/sync.py::sync_reservations), which is
the single source of truth for both the 30-min cron (routers/internal.py) and the
manual /opera/sync handler.

A hotel with opera_pilot_enabled=FALSE must get a 403 on every endpoint (never
reaching OHIP or touching opera_credentials/integration_sync_conflicts). A hotel
with opera_pilot_enabled=TRUE must pass the pilot gate (it may still fail later
for unrelated reasons, e.g. missing credentials — that's fine, we only assert the
pilot-gate 403 is absent).
"""
import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from models.requests import OperaConnectRequest, ResolveOperaSyncConflictRequest
from routers import integrations as integrations_router
from services.opera import sync as opera_sync_module
from tests.smoke.fake_supabase import FakeDB


GM_NON_PILOT = CurrentUser(user_id="user-np-1", hotel_id="hotel-non-pilot", role="gm", email="gm@non-pilot.com")
CHIEF_ENGINEER_NON_PILOT = CurrentUser(
    user_id="ce-np-1", hotel_id="hotel-non-pilot", role="chief_engineer", email="ce@non-pilot.com"
)
GM_PILOT = CurrentUser(user_id="user-p-1", hotel_id="hotel-pilot", role="gm", email="gm@pilot.com")


def _connect_body() -> OperaConnectRequest:
    return OperaConnectRequest(
        ohip_base_url="https://ohip.example.com/",
        hotel_id_opera="SAND01",
        integration_username="opera-user",
        integration_password="opera-password",
    )


def _non_pilot_db() -> FakeDB:
    return FakeDB(rows={
        "tenants": [{"id": "hotel-non-pilot", "opera_pilot_enabled": False}],
    })


def _pilot_db() -> FakeDB:
    return FakeDB(rows={
        "tenants": [{"id": "hotel-pilot", "opera_pilot_enabled": True}],
    })


# ---------------------------------------------------------------------------
# Non-pilot hotel: every Opera endpoint 403s with a pilot-related detail
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_opera_connect_403_when_pilot_not_enabled(monkeypatch):
    db = _non_pilot_db()
    monkeypatch.setattr(integrations_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await integrations_router.opera_connect(body=_connect_body(), current_user=GM_NON_PILOT)

    assert exc.value.status_code == 403
    assert "pilot" in exc.value.detail.lower()
    assert db.rows.get("opera_credentials", []) == []


@pytest.mark.asyncio
async def test_opera_status_403_when_pilot_not_enabled(monkeypatch):
    db = _non_pilot_db()
    monkeypatch.setattr(integrations_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await integrations_router.opera_status(current_user=GM_NON_PILOT)

    assert exc.value.status_code == 403
    assert "pilot" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_opera_sync_403_when_pilot_not_enabled(monkeypatch):
    db = _non_pilot_db()
    monkeypatch.setattr(integrations_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await integrations_router.opera_sync(current_user=GM_NON_PILOT)

    assert exc.value.status_code == 403
    assert "pilot" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_opera_conflicts_list_403_when_pilot_not_enabled(monkeypatch):
    db = _non_pilot_db()
    monkeypatch.setattr(integrations_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await integrations_router.list_opera_sync_conflicts(current_user=CHIEF_ENGINEER_NON_PILOT)

    assert exc.value.status_code == 403
    assert "pilot" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_opera_conflicts_resolve_403_when_pilot_not_enabled(monkeypatch):
    db = _non_pilot_db()
    monkeypatch.setattr(integrations_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await integrations_router.resolve_opera_sync_conflict(
            "conflict-1",
            ResolveOperaSyncConflictRequest(resolution="remote_wins"),
            current_user=CHIEF_ENGINEER_NON_PILOT,
        )

    assert exc.value.status_code == 403
    assert "pilot" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_opera_test_403_when_pilot_not_enabled(monkeypatch):
    db = _non_pilot_db()
    monkeypatch.setattr(integrations_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await integrations_router.opera_test(current_user=GM_NON_PILOT)

    assert exc.value.status_code == 403
    assert "pilot" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_opera_disconnect_403_when_pilot_not_enabled(monkeypatch):
    db = _non_pilot_db()
    monkeypatch.setattr(integrations_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await integrations_router.opera_disconnect(current_user=GM_NON_PILOT)

    assert exc.value.status_code == 403
    assert "pilot" in exc.value.detail.lower()


# ---------------------------------------------------------------------------
# Pilot-enabled hotel: pilot gate does not fire (endpoint may still fail later
# for unrelated reasons, e.g. no OHIP creds — we only assert the pilot 403 is absent)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_opera_status_passes_pilot_gate_when_enabled(monkeypatch):
    db = _pilot_db()
    monkeypatch.setattr(integrations_router, "supabase", db)

    result = await integrations_router.opera_status(current_user=GM_PILOT)

    assert result["data"]["connected"] is False


@pytest.mark.asyncio
async def test_opera_test_pilot_enabled_fails_for_missing_creds_not_pilot(monkeypatch):
    db = _pilot_db()
    monkeypatch.setattr(integrations_router, "supabase", db)
    monkeypatch.setattr(integrations_router, "get_opera_credentials", lambda hotel_id: None)

    with pytest.raises(HTTPException) as exc:
        await integrations_router.opera_test(current_user=GM_PILOT)

    # Not connected (400), not the pilot-gate 403 — proves the gate passed through.
    assert exc.value.status_code == 400
    assert "pilot" not in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_opera_disconnect_passes_pilot_gate_when_enabled(monkeypatch):
    db = _pilot_db()
    monkeypatch.setattr(integrations_router, "supabase", db)

    result = await integrations_router.opera_disconnect(current_user=GM_PILOT)

    assert result["data"]["connected"] is False


# ---------------------------------------------------------------------------
# Cron regression: sync_reservations skips connected-but-non-pilot hotels —
# no OHIP call, no DB write. Single source of truth for both the 30-min cron
# (routers/internal.py) and the /opera/sync handler.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sync_reservations_skips_connected_non_pilot_hotel(monkeypatch):
    db = FakeDB(rows={
        "tenants": [{"id": "hotel-non-pilot", "opera_pilot_enabled": False}],
        "opera_credentials": [{
            "id": "cred-1",
            "tenant_id": "hotel-non-pilot",
            "is_connected": True,
            "hotel_id_opera": "SAND01",
        }],
    })
    monkeypatch.setattr(opera_sync_module, "supabase", db)

    ohip_calls = []
    monkeypatch.setattr(
        opera_sync_module,
        "get_opera_credentials",
        lambda hotel_id: ohip_calls.append(hotel_id) or {"hotel_id_opera": "SAND01"},
    )
    monkeypatch.setattr(
        opera_sync_module,
        "ohip_request",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("OHIP must not be called for a non-pilot hotel")),
    )

    result = opera_sync_module.sync_reservations("hotel-non-pilot")

    assert result["synced"] == 0
    assert result.get("skipped") is True
    assert result.get("reason") == "opera_pilot_not_enabled"
    assert ohip_calls == []
    assert db.updates == []
    assert db.inserts == []
