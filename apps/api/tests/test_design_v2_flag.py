"""Design System V2 per-hotel activation (`design_v2`).

The flag rides the existing tenant flag system: the registry entry, the fail-closed per-tenant lookup and
`GET /auth/me` -> `hotel.enabled_features`, which web and mobile both read. These tests pin that it is OFF by
default, that one hotel's setting never reaches another hotel, that turning it off is visible on the very next
context read (after the in-process cache window), that a database failure fails closed, and that reading it
costs no AI call and no credit.
"""

import itertools
from datetime import date

import jwt
import pytest
from fastapi.testclient import TestClient

from core import feature_flags
from core.config import settings
from core.feature_registry import FEATURE_REGISTRY
from main import app
from routers import auth as auth_router
from tests.smoke.fake_supabase import FakeDB

KEY = "design_v2"
HOTEL_A, HOTEL_B, HOTEL_C = "hotel-a", "hotel-b", "hotel-c"
ROLES = ("housekeeper", "inspector", "housekeeping_supervisor", "engineer", "chief_engineer", "front_desk", "gm")


_calls = itertools.count()


def _auth(hotel_id, role="gm", user_id=None):
    # /auth/* has a strict per-user rate limit (10/min); a fresh subject per request keeps these tests independent of it.
    user_id = user_id or f"user-{next(_calls)}"
    token = jwt.encode(
        {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"},
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


def _db(flag_rows):
    today = date.today()
    return FakeDB({
        "tenant_feature_flags": flag_rows,
        "tenants": [
            {"id": h, "name": f"Hotel {h[-1].upper()}", "timezone": "America/Chicago", "room_count": 80,
             "logo_url": None, "front_desk_modules": [], "web_redesign_sections": []}
            for h in (HOTEL_A, HOTEL_B, HOTEL_C)
        ],
                "subscriptions": [{"tenant_id": h, "plan_status": "active", "credits_included": 5000, "cap_cents": 12_900} for h in (HOTEL_A, HOTEL_B, HOTEL_C)],
        "credit_ledger": [{
            "id": "l", "tenant_id": HOTEL_A, "credits_included": 5000, "overage_cost_cents": 0,
            "period_start": date(today.year, 1, 1).isoformat(), "period_end": date(today.year, 12, 31).isoformat(),
        }],
        "ai_interactions": [],
    })


@pytest.fixture(autouse=True)
def _isolated():
    feature_flags._cache.clear()
    yield
    feature_flags._cache.clear()


def _install(monkeypatch, db):
    for module in (feature_flags, auth_router):
        monkeypatch.setattr(module, "supabase", db)


def _features(client, hotel_id, role="gm"):
    res = client.get("/v1/auth/me", headers=_auth(hotel_id, role))
    assert res.status_code == 200, res.text
    return res.json()["hotel"]["enabled_features"]


def test_design_v2_is_a_registered_visual_only_release_flag():
    flag = FEATURE_REGISTRY[KEY]
    assert flag.type == "release"
    # Presentation only: nothing on the backend may gate a capability on it.
    assert flag.backend_enforced is False


def test_default_off_for_every_hotel_when_no_row_exists(monkeypatch):
    _install(monkeypatch, _db([]))
    client = TestClient(app)
    for hotel in (HOTEL_A, HOTEL_B, HOTEL_C):
        assert KEY not in _features(client, hotel)


def test_enabled_for_one_hotel_only(monkeypatch):
    _install(monkeypatch, _db([{"tenant_id": HOTEL_A, "feature_key": KEY, "enabled": True}]))
    client = TestClient(app)
    assert KEY in _features(client, HOTEL_A)
    assert KEY not in _features(client, HOTEL_B)
    assert KEY not in _features(client, HOTEL_C)


def test_a_disabled_row_is_the_same_as_no_row(monkeypatch):
    _install(monkeypatch, _db([{"tenant_id": HOTEL_A, "feature_key": KEY, "enabled": False}]))
    assert KEY not in _features(TestClient(app), HOTEL_A)


@pytest.mark.parametrize("role", ROLES)
def test_every_role_sees_the_same_hotel_decision(monkeypatch, role):
    _install(monkeypatch, _db([{"tenant_id": HOTEL_A, "feature_key": KEY, "enabled": True}]))
    client = TestClient(app)
    assert KEY in _features(client, HOTEL_A, role)
    assert KEY not in _features(client, HOTEL_B, role)


def test_turning_it_off_is_observed_on_the_next_read_after_the_cache_window(monkeypatch):
    db = _db([{"tenant_id": HOTEL_A, "feature_key": KEY, "enabled": True}])
    _install(monkeypatch, db)
    client = TestClient(app)
    assert KEY in _features(client, HOTEL_A)

    # What Feature Rollout does: flip the row. Within the 15 s window the cached "on" can still be served...
    db.rows["tenant_feature_flags"][0]["enabled"] = False
    # ...and once the window has passed (simulated by dropping the cache) the very next /auth/me says off.
    feature_flags._cache.clear()
    assert KEY not in _features(client, HOTEL_A)
    assert KEY not in _features(client, HOTEL_B)


def test_a_database_failure_fails_closed(monkeypatch):
    class Boom:
        def table(self, _name):
            raise RuntimeError("database unavailable")

    monkeypatch.setattr(feature_flags, "supabase", Boom())
    assert feature_flags.is_feature_enabled(HOTEL_A, KEY) is False


def test_reading_the_flag_makes_no_ai_call_and_spends_no_credit(monkeypatch):
    db = _db([{"tenant_id": HOTEL_A, "feature_key": KEY, "enabled": True}])
    _install(monkeypatch, db)
    client = TestClient(app)
    ledger_before = [dict(r) for r in db.rows["credit_ledger"]]
    for _ in range(3):
        _features(client, HOTEL_A)
    assert db.rows["ai_interactions"] == []
    assert db.rows["credit_ledger"] == ledger_before


def test_no_router_gates_a_route_on_design_v2():
    """Visual only. If a router ever required it, a rollback would lock people out instead of restyling."""
    import pathlib

    root = pathlib.Path(__file__).resolve().parent.parent
    offenders = [
        str(path.relative_to(root))
        for path in list((root / "routers").glob("*.py")) + list((root / "services").rglob("*.py"))
        if KEY in path.read_text(encoding="utf-8")
    ]
    assert offenders == []
