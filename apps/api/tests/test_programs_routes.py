"""Route-level contracts for the maintenance/housekeeping programs domain.

Proves the LIVE programs.py router (and the pm-completion path it shares
with assets.py) obey the locked cross-phase contracts: manager-only reads,
correct RBAC including chief_engineer, tenant isolation on PM schedules,
and bug-449 None-safety on maybe_single() reads.

Mirrors the TestClient + real-JWT harness used in
tests/smoke/test_tenant_isolation.py for true HTTP-level RBAC checks, and
the direct-router-call + FakeDB harness used in test_evidence_foundation.py
for logic/tenant-isolation checks that need database-state assertions.
"""

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from middleware.auth import CurrentUser
from models.requests import CompletePMProgramRequest
from routers import assets as assets_router
from routers import programs as programs_router
from tests.smoke.fake_supabase import FakeDB


def _auth_header(role: str, hotel_id: str = "hotel-a", user_id: str = "user-a-1") -> dict[str, str]:
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _pm_complete_payload() -> dict:
    return {"items": [{"key": "check", "label": "Visual check", "result": "passed"}]}


def test_overview_requires_manager_role(monkeypatch):
    """A housekeeper cannot read the program overview (DND policy, pars, sampling rules)."""
    monkeypatch.setattr(programs_router, "supabase", FakeDB())
    client = TestClient(app)

    response = client.get("/v1/programs/overview", headers=_auth_header("housekeeper"))

    assert response.status_code == 403


def test_overview_allows_manager(monkeypatch):
    """gm and chief_engineer can read the program overview."""
    monkeypatch.setattr(programs_router, "supabase", FakeDB())
    client = TestClient(app)

    for role in ("gm", "chief_engineer"):
        response = client.get("/v1/programs/overview", headers=_auth_header(role))
        assert response.status_code == 200, f"{role} should be able to read the program overview"


def test_pm_complete_rbac(monkeypatch):
    """housekeeper is blocked from PM completion; engineer/chief_engineer/gm can complete."""
    db = FakeDB({
        "pm_schedules": [{"id": "sched-1", "tenant_id": "hotel-a", "asset_id": "asset-1", "interval_days": 30}],
    })
    monkeypatch.setattr(assets_router, "supabase", db)
    client = TestClient(app)

    housekeeper_response = client.post(
        "/v1/assets/pm-schedules/sched-1/complete",
        headers=_auth_header("housekeeper"),
        json=_pm_complete_payload(),
    )
    assert housekeeper_response.status_code == 403

    for role in ("engineer", "chief_engineer", "gm"):
        response = client.post(
            "/v1/assets/pm-schedules/sched-1/complete",
            headers=_auth_header(role),
            json=_pm_complete_payload(),
        )
        assert response.status_code != 403, f"{role} should be allowed to reach the PM-complete handler"


@pytest.mark.asyncio
async def test_cross_tenant_pm_schedule_404(monkeypatch):
    """A PM schedule owned by tenant B is invisible to tenant A and no completion row is written."""
    db = FakeDB({
        "pm_schedules": [{"id": "sched-b", "tenant_id": "hotel-b", "asset_id": "asset-b", "interval_days": 30}],
    })
    monkeypatch.setattr(assets_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await assets_router.complete_pm_schedule(
            "sched-b",
            CompletePMProgramRequest(items=[{"key": "check", "label": "Visual check", "result": "passed"}]),
            current_user=CurrentUser(user_id="user-a-1", hotel_id="hotel-a", role="gm"),
        )

    assert exc.value.status_code == 404
    assert db.rows.get("pm_completion_records", []) == []


class _NoneReturningQuery:
    """Mirrors the real supabase-py shape: maybe_single().execute() returns None outright
    (not an object whose .data is None) when there is no matching row (bug-449)."""

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def maybe_single(self):
        return self

    def execute(self):
        return None


class _NoneReturningDB:
    def table(self, _name):
        return _NoneReturningQuery()


def test_maybe_single_none_returns_404_not_500(monkeypatch):
    """_get_pm_schedule must not raise AttributeError when maybe_single() returns None outright."""
    monkeypatch.setattr(programs_router, "supabase", _NoneReturningDB())

    with pytest.raises(HTTPException) as exc:
        programs_router._get_pm_schedule(
            "missing-sched",
            CurrentUser(user_id="user-a-1", hotel_id="hotel-a", role="gm"),
        )

    assert exc.value.status_code == 404
