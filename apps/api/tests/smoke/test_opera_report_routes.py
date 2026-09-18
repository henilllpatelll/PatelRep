"""Router-level tests for the new Opera SFTP report-ingestion endpoints.

Follows the direct-call pattern used by tests/test_opera_pilot_gate.py: the
router coroutine is awaited directly with a hand-built CurrentUser, so
require_role()'s FastAPI Depends() gate is not exercised here (it's DI-time
enforcement, not something a direct call goes through) -- only the in-body
_require_opera_pilot() gate, response shape, tenant isolation, and the
OperaSftpConnectRequest validator are meaningfully testable this way.
"""
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from middleware.auth import CurrentUser
from models.requests import OperaSftpConnectRequest
from routers import integrations as integrations_router
from services.opera.sftp_client import SftpConnectionError
from tests.smoke.fake_supabase import FakeDB

GM_PILOT = CurrentUser(user_id="gm-1", hotel_id="hotel-pilot", role="gm", email="gm@pilot.com")
GM_NON_PILOT = CurrentUser(user_id="gm-2", hotel_id="hotel-non-pilot", role="gm", email="gm@non-pilot.com")
CHIEF_ENGINEER_PILOT = CurrentUser(user_id="ce-1", hotel_id="hotel-pilot", role="chief_engineer", email="ce@pilot.com")


def _sftp_connect_body(**overrides):
    base = dict(sftp_host="sftp.example.com", sftp_username="opera", sftp_password="secret")
    base.update(overrides)
    return OperaSftpConnectRequest(**base)


def _pilot_db(**extra_rows) -> FakeDB:
    rows = {"tenants": [{"id": "hotel-pilot", "opera_pilot_enabled": True}]}
    rows.update(extra_rows)
    return FakeDB(rows=rows)


def _non_pilot_db() -> FakeDB:
    return FakeDB(rows={"tenants": [{"id": "hotel-non-pilot", "opera_pilot_enabled": False}]})


# ---------------------------------------------------------------------------
# OperaSftpConnectRequest validation (pure, no DB)
# ---------------------------------------------------------------------------


def test_connect_request_requires_exactly_one_auth_method():
    with pytest.raises(ValidationError):
        OperaSftpConnectRequest(sftp_host="h", sftp_username="u")  # neither

    with pytest.raises(ValidationError):
        OperaSftpConnectRequest(sftp_host="h", sftp_username="u", sftp_password="p", sftp_private_key="k")  # both


def test_connect_request_accepts_password_only():
    body = _sftp_connect_body()
    assert body.sftp_password == "secret"
    assert body.report_delimiter == "\t"


# ---------------------------------------------------------------------------
# Pilot gate on the 4 new endpoints
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sftp_connect_403_when_pilot_not_enabled(monkeypatch):
    db = _non_pilot_db()
    monkeypatch.setattr(integrations_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await integrations_router.opera_sftp_connect(body=_sftp_connect_body(), current_user=GM_NON_PILOT)

    assert exc.value.status_code == 403
    assert db.rows.get("opera_credentials", []) == []


@pytest.mark.asyncio
async def test_sftp_sync_403_when_pilot_not_enabled(monkeypatch):
    db = _non_pilot_db()
    monkeypatch.setattr(integrations_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await integrations_router.opera_sftp_sync(current_user=GM_NON_PILOT)

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_sftp_test_403_when_pilot_not_enabled(monkeypatch):
    db = _non_pilot_db()
    monkeypatch.setattr(integrations_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await integrations_router.opera_sftp_test(current_user=GM_NON_PILOT)

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_sftp_files_403_when_pilot_not_enabled(monkeypatch):
    db = _non_pilot_db()
    monkeypatch.setattr(integrations_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await integrations_router.list_opera_report_files(current_user=GM_NON_PILOT)

    assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# opera_sftp_connect: fail-fast on a bad connection, never stores credentials
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sftp_connect_fails_fast_and_stores_nothing_on_bad_connection(monkeypatch):
    db = _pilot_db()
    monkeypatch.setattr(integrations_router, "supabase", db)
    monkeypatch.setattr(
        integrations_router, "sftp_test_connection",
        lambda creds: (_ for _ in ()).throw(SftpConnectionError("connection refused")),
    )

    with pytest.raises(HTTPException) as exc:
        await integrations_router.opera_sftp_connect(body=_sftp_connect_body(), current_user=GM_PILOT)

    assert exc.value.status_code == 400
    assert db.rows.get("opera_credentials", []) == []


@pytest.mark.asyncio
async def test_sftp_connect_stores_credentials_on_success(monkeypatch):
    db = _pilot_db(opera_credentials=[])
    monkeypatch.setattr(integrations_router, "supabase", db)
    monkeypatch.setattr(integrations_router, "sftp_test_connection", lambda creds: None)
    monkeypatch.setattr(integrations_router, "sync_report_files", lambda hotel_id: {"synced": 0, "files_processed": 0, "error": None})

    result = await integrations_router.opera_sftp_connect(body=_sftp_connect_body(), current_user=GM_PILOT)

    assert result["data"]["connected"] is True
    stored = db.rows["opera_credentials"][0]
    assert stored["connection_mode"] == "sftp_report"
    assert stored["tenant_id"] == "hotel-pilot"


# ---------------------------------------------------------------------------
# GET /opera/sftp/files: tenant isolation + role visibility (chief_engineer allowed)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sftp_files_only_returns_current_tenants_rows(monkeypatch):
    db = _pilot_db(opera_report_files=[
        {"tenant_id": "hotel-pilot", "remote_filename": "mine.txt", "report_type": "in_house", "status": "processed", "rows_parsed": 1, "rows_upserted": 1, "error_detail": None, "processed_at": "2026-09-17T00:00:00Z"},
        {"tenant_id": "hotel-other", "remote_filename": "theirs.txt", "report_type": "in_house", "status": "processed", "rows_parsed": 1, "rows_upserted": 1, "error_detail": None, "processed_at": "2026-09-17T00:00:00Z"},
    ])
    monkeypatch.setattr(integrations_router, "supabase", db)

    result = await integrations_router.list_opera_report_files(current_user=CHIEF_ENGINEER_PILOT)

    filenames = {row["remote_filename"] for row in result["data"]}
    assert filenames == {"mine.txt"}


# ---------------------------------------------------------------------------
# GET /opera/status: secrets must never appear in the response
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_opera_status_never_leaks_sftp_secrets(monkeypatch):
    db = _pilot_db(opera_credentials=[{
        "tenant_id": "hotel-pilot",
        "is_connected": True,
        "connection_mode": "sftp_report",
        "sftp_host": "sftp.example.com",
        "sftp_remote_path": "/reports",
        "sftp_password": "enc:v1:should-never-appear",
        "sftp_private_key": "enc:v1:should-never-appear-either",
        "hotel_id_opera": None,
        "ohip_base_url": None,
        "last_sync_at": None,
        "created_at": "2026-09-01T00:00:00Z",
        "updated_at": "2026-09-01T00:00:00Z",
    }])
    monkeypatch.setattr(integrations_router, "supabase", db)

    result = await integrations_router.opera_status(current_user=GM_PILOT)

    assert result["data"]["connection_mode"] == "sftp_report"
    assert result["data"]["sftp_host"] == "sftp.example.com"
    assert "sftp_password" not in result["data"]
    assert "sftp_private_key" not in result["data"]
    assert "should-never-appear" not in str(result["data"])


@pytest.mark.asyncio
async def test_opera_disconnect_nulls_sftp_secrets_too(monkeypatch):
    db = _pilot_db(opera_credentials=[{
        "tenant_id": "hotel-pilot", "is_connected": True, "connection_mode": "sftp_report",
        "sftp_password": "enc:v1:secret", "sftp_private_key": "enc:v1:key",
    }])
    monkeypatch.setattr(integrations_router, "supabase", db)

    result = await integrations_router.opera_disconnect(current_user=GM_PILOT)

    assert result["data"]["connected"] is False
    stored = db.rows["opera_credentials"][0]
    assert stored["sftp_password"] is None
    assert stored["sftp_private_key"] is None
