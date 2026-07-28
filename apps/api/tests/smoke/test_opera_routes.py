"""
Opera routes RBAC + tenant-isolation smoke tests (D-01/D-06).

Covers all 7 /integrations/opera/* endpoints:
  connect, status, sync, conflicts (list), conflicts/{id}/resolve, test, disconnect

RBAC per the verified map (apps/api/routers/integrations.py):
  connect/sync/test/disconnect = gm-only
  conflicts list + resolve     = gm, chief_engineer
  status                       = any authenticated role

Tenant isolation: rows seeded under tenant_id="hotel-a"; handler invoked as
hotel-b; asserts empty/404-shaped result and zero cross-tenant writes.

Uses the rich FakeDB (tests.smoke.fake_supabase) which supports select/update/
delete/maybe_single/in_/eq — a bare-None maybe_single (no SimpleNamespace-based
workarounds), matching the bug-449-safe idiom used throughout the codebase.

All hotels used here are seeded with opera_pilot_enabled=True in the tenants
table so these tests exercise RBAC/tenant-isolation independent of the D-03
pilot gate (covered separately in tests/test_opera_pilot_gate.py).
"""
import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from models.requests import ResolveOperaSyncConflictRequest
from routers import integrations as integrations_router
from tests.smoke.fake_supabase import FakeDB


ALL_ROLES = ["housekeeper", "engineer", "housekeeping_supervisor", "chief_engineer", "front_desk", "gm"]


def _user(hotel_id: str, role: str, user_id: str = "u-1") -> CurrentUser:
    return CurrentUser(user_id=user_id, hotel_id=hotel_id, role=role, email=f"{role}@example.com")


def _pilot_enabled_db(*hotel_ids: str, **extra_rows) -> FakeDB:
    rows = {"tenants": [{"id": hid, "opera_pilot_enabled": True} for hid in hotel_ids]}
    rows.update(extra_rows)
    return FakeDB(rows=rows)


def _route(path: str, method: str):
    return next(
        r for r in integrations_router.router.routes
        if r.path == path and method in r.methods
    )


# ---------------------------------------------------------------------------
# RBAC matrix — one test per endpoint (all 7)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_opera_connect_rbac_gm_only():
    role_check = _route("/integrations/opera/connect", "POST").dependant.dependencies[0].call
    for role in ALL_ROLES:
        user = _user("hotel-a", role)
        if role == "gm":
            result = await role_check(current_user=user)
            assert result.role == "gm"
        else:
            with pytest.raises(HTTPException) as exc:
                await role_check(current_user=user)
            assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_opera_status_rbac_any_authenticated_role(monkeypatch):
    db = _pilot_enabled_db("hotel-a")
    monkeypatch.setattr(integrations_router, "supabase", db)

    for role in ALL_ROLES:
        result = await integrations_router.opera_status(current_user=_user("hotel-a", role))
        assert result["data"]["connected"] is False


@pytest.mark.asyncio
async def test_opera_sync_rbac_gm_only():
    role_check = _route("/integrations/opera/sync", "POST").dependant.dependencies[0].call
    for role in ALL_ROLES:
        user = _user("hotel-a", role)
        if role == "gm":
            result = await role_check(current_user=user)
            assert result.role == "gm"
        else:
            with pytest.raises(HTTPException) as exc:
                await role_check(current_user=user)
            assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_opera_conflicts_list_rbac_gm_and_chief_engineer():
    role_check = _route("/integrations/opera/conflicts", "GET").dependant.dependencies[0].call
    allowed = {"gm", "chief_engineer"}
    for role in ALL_ROLES:
        user = _user("hotel-a", role)
        if role in allowed:
            result = await role_check(current_user=user)
            assert result.role == role
        else:
            with pytest.raises(HTTPException) as exc:
                await role_check(current_user=user)
            assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_opera_conflicts_resolve_rbac_gm_and_chief_engineer():
    role_check = _route("/integrations/opera/conflicts/{conflict_id}/resolve", "POST").dependant.dependencies[0].call
    allowed = {"gm", "chief_engineer"}
    for role in ALL_ROLES:
        user = _user("hotel-a", role)
        if role in allowed:
            result = await role_check(current_user=user)
            assert result.role == role
        else:
            with pytest.raises(HTTPException) as exc:
                await role_check(current_user=user)
            assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_opera_test_rbac_gm_only():
    role_check = _route("/integrations/opera/test", "POST").dependant.dependencies[0].call
    for role in ALL_ROLES:
        user = _user("hotel-a", role)
        if role == "gm":
            result = await role_check(current_user=user)
            assert result.role == "gm"
        else:
            with pytest.raises(HTTPException) as exc:
                await role_check(current_user=user)
            assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_opera_disconnect_rbac_gm_only():
    role_check = _route("/integrations/opera/disconnect", "DELETE").dependant.dependencies[0].call
    for role in ALL_ROLES:
        user = _user("hotel-a", role)
        if role == "gm":
            result = await role_check(current_user=user)
            assert result.role == "gm"
        else:
            with pytest.raises(HTTPException) as exc:
                await role_check(current_user=user)
            assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Tenant isolation — cross-hotel reads return empty/404 with zero writes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_opera_status_tenant_isolation_returns_not_connected(monkeypatch):
    """Hotel A's Opera connection is invisible to Hotel B's status probe."""
    db = _pilot_enabled_db(
        "hotel-a", "hotel-b",
        opera_credentials=[{
            "id": "cred-a-1",
            "tenant_id": "hotel-a",
            "is_connected": True,
            "hotel_id_opera": "SAND01",
            "ohip_base_url": "https://ohip.example.com",
        }],
    )
    monkeypatch.setattr(integrations_router, "supabase", db)

    result = await integrations_router.opera_status(current_user=_user("hotel-b", "gm"))

    assert result["data"]["connected"] is False


@pytest.mark.asyncio
async def test_opera_conflicts_list_tenant_isolation_returns_empty(monkeypatch):
    """Hotel A's open Opera conflicts are invisible to a Hotel B chief_engineer."""
    db = _pilot_enabled_db(
        "hotel-a", "hotel-b",
        integration_sync_conflicts=[{
            "id": "conflict-a-1",
            "tenant_id": "hotel-a",
            "provider": "opera",
            "status": "open",
            "detected_at": "2026-07-01T00:00:00+00:00",
        }],
    )
    monkeypatch.setattr(integrations_router, "supabase", db)

    result = await integrations_router.list_opera_sync_conflicts(current_user=_user("hotel-b", "chief_engineer"))

    assert result["data"] == []


@pytest.mark.asyncio
async def test_opera_conflicts_resolve_tenant_isolation_raises_404_and_leaves_data_intact(monkeypatch):
    """A Hotel B gm cannot resolve Hotel A's open Opera conflict; Hotel A's row is untouched."""
    db = _pilot_enabled_db(
        "hotel-a", "hotel-b",
        integration_sync_conflicts=[{
            "id": "conflict-a-1",
            "tenant_id": "hotel-a",
            "provider": "opera",
            "status": "open",
            "local_entity_id": None,
            "remote_snapshot": {},
        }],
    )
    monkeypatch.setattr(integrations_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await integrations_router.resolve_opera_sync_conflict(
            "conflict-a-1",
            ResolveOperaSyncConflictRequest(resolution="remote_wins"),
            current_user=_user("hotel-b", "gm"),
        )

    assert exc.value.status_code == 404
    hotel_a_conflict = next(r for r in db.rows["integration_sync_conflicts"] if r["id"] == "conflict-a-1")
    assert hotel_a_conflict["status"] == "open"
    assert db.updates == []
    assert not [i for i in db.inserts if i[0] == "integration_sync_conflict_events"]
