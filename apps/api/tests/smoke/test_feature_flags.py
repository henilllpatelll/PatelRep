"""Tests for core/feature_flags.py: fail-closed evaluation, tenant isolation,
unknown-key handling, DB-failure fail-closed behavior, and the synthetic
staging_flag_demo endpoint's end-to-end 403/200 enforcement.
"""

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jose import jwt

import core.feature_flags as feature_flags_module
from core.config import settings
from main import app
from middleware.auth import CurrentUser
from tests.smoke.fake_supabase import FakeDB

FEATURE_KEY = "staging_flag_demo"


@pytest.fixture(autouse=True)
def _clear_flag_cache():
    """The short-TTL in-process cache is intentionally module-global (it backs
    the kill-switch across requests); tests must not leak cached values into
    each other."""
    feature_flags_module._cache.clear()
    yield
    feature_flags_module._cache.clear()


def _auth_header(hotel_id: str, role: str = "gm", user_id: str = "user-1") -> dict[str, str]:
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _flags_db(rows: list[dict]) -> FakeDB:
    return FakeDB({"tenant_feature_flags": rows})


def test_missing_row_is_disabled(monkeypatch):
    monkeypatch.setattr(feature_flags_module, "supabase", _flags_db([]))
    assert feature_flags_module.is_feature_enabled("hotel-a", FEATURE_KEY) is False


def test_enabled_false_row_is_disabled(monkeypatch):
    db = _flags_db([{"tenant_id": "hotel-a", "feature_key": FEATURE_KEY, "enabled": False}])
    monkeypatch.setattr(feature_flags_module, "supabase", db)
    assert feature_flags_module.is_feature_enabled("hotel-a", FEATURE_KEY) is False


def test_enabled_true_row_is_enabled(monkeypatch):
    db = _flags_db([{"tenant_id": "hotel-a", "feature_key": FEATURE_KEY, "enabled": True}])
    monkeypatch.setattr(feature_flags_module, "supabase", db)
    assert feature_flags_module.is_feature_enabled("hotel-a", FEATURE_KEY) is True


def test_tenant_isolation(monkeypatch):
    db = _flags_db([
        {"tenant_id": "hotel-a", "feature_key": FEATURE_KEY, "enabled": True},
        {"tenant_id": "hotel-b", "feature_key": FEATURE_KEY, "enabled": False},
    ])
    monkeypatch.setattr(feature_flags_module, "supabase", db)
    assert feature_flags_module.is_feature_enabled("hotel-a", FEATURE_KEY) is True
    assert feature_flags_module.is_feature_enabled("hotel-b", FEATURE_KEY) is False


def test_unknown_feature_key_raises_keyerror(monkeypatch):
    monkeypatch.setattr(feature_flags_module, "supabase", _flags_db([]))
    with pytest.raises(KeyError):
        feature_flags_module.is_feature_enabled("hotel-a", "not_a_real_key")
    with pytest.raises(KeyError):
        feature_flags_module.require_feature("not_a_real_key")
    with pytest.raises(KeyError):
        feature_flags_module.require_feature_sync("hotel-a", "not_a_real_key")


def test_db_error_fails_closed_for_is_feature_enabled(monkeypatch):
    class _RaisingDB:
        def table(self, _name):
            raise RuntimeError("simulated connection failure")

    monkeypatch.setattr(feature_flags_module, "supabase", _RaisingDB())
    assert feature_flags_module.is_feature_enabled("hotel-a", FEATURE_KEY) is False


def test_db_error_fails_closed_for_require_feature_sync(monkeypatch):
    class _RaisingDB:
        def table(self, _name):
            raise RuntimeError("simulated connection failure")

    monkeypatch.setattr(feature_flags_module, "supabase", _RaisingDB())
    with pytest.raises(HTTPException) as exc_info:
        feature_flags_module.require_feature_sync("hotel-a", FEATURE_KEY)
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_require_feature_dependency_raises_403_not_500_on_db_error(monkeypatch):
    class _RaisingDB:
        def table(self, _name):
            raise RuntimeError("simulated connection failure")

    monkeypatch.setattr(feature_flags_module, "supabase", _RaisingDB())
    check = feature_flags_module.require_feature(FEATURE_KEY)
    current_user = CurrentUser(user_id="user-1", hotel_id="hotel-a", role="gm")
    with pytest.raises(HTTPException) as exc_info:
        await check(current_user=current_user)
    assert exc_info.value.status_code == 403


def test_demo_endpoint_returns_403_when_flag_missing(monkeypatch):
    monkeypatch.setattr(feature_flags_module, "supabase", _flags_db([]))
    client = TestClient(app)
    response = client.get("/v1/internal/feature-flag-demo", headers=_auth_header("hotel-a"))
    assert response.status_code == 403


def test_demo_endpoint_returns_200_when_flag_enabled_for_this_tenant(monkeypatch):
    db = _flags_db([{"tenant_id": "hotel-a", "feature_key": FEATURE_KEY, "enabled": True}])
    monkeypatch.setattr(feature_flags_module, "supabase", db)
    client = TestClient(app)
    response = client.get("/v1/internal/feature-flag-demo", headers=_auth_header("hotel-a"))
    assert response.status_code == 200
    assert response.json() == {"gated": True, "hotel_id": "hotel-a"}


def test_demo_endpoint_enabling_one_tenant_does_not_enable_another(monkeypatch):
    db = _flags_db([{"tenant_id": "hotel-a", "feature_key": FEATURE_KEY, "enabled": True}])
    monkeypatch.setattr(feature_flags_module, "supabase", db)
    client = TestClient(app)
    response = client.get("/v1/internal/feature-flag-demo", headers=_auth_header("hotel-b"))
    assert response.status_code == 403
