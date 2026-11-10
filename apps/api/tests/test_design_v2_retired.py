"""Design System V2 is the permanent default design; its `design_v2` rollout flag is retired.

Nothing may depend on the flag any more. These tests pin that: the key is gone from the registry, a leftover
`tenant_feature_flags` row (production data and audit history are deliberately NOT deleted) is inert, every other
flag keeps working exactly as before, no router or service reads the key, and `/auth/me` still costs no AI call.
"""

import itertools
import pathlib
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

RETIRED = "design_v2"
OTHER = "hk_ai_assistant"
HOTEL_A, HOTEL_B = "hotel-a", "hotel-b"
ROLES = ("housekeeper", "inspector", "housekeeping_supervisor", "engineer", "chief_engineer", "front_desk", "gm")

_calls = itertools.count()


def _auth(hotel_id, role="gm"):
    # /auth/* has a strict per-user rate limit (10/min); a fresh subject per request keeps these tests independent of it.
    token = jwt.encode(
        {"sub": f"user-{next(_calls)}", "role": role, "hotel_id": hotel_id, "aud": "authenticated"},
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
            for h in (HOTEL_A, HOTEL_B)
        ],
        "subscriptions": [{"tenant_id": h, "plan_status": "active", "credits_included": 5000, "cap_cents": 12_900} for h in (HOTEL_A, HOTEL_B)],
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


def test_design_v2_is_no_longer_a_registered_flag():
    assert RETIRED not in FEATURE_REGISTRY
    # The shared framework and every other flag are untouched.
    assert OTHER in FEATURE_REGISTRY
    assert len(FEATURE_REGISTRY) >= 5


@pytest.mark.parametrize("role", ROLES)
def test_a_leftover_enabled_row_is_inert_for_every_role(monkeypatch, role):
    db = _db([
        {"tenant_id": HOTEL_A, "feature_key": RETIRED, "enabled": True},
        {"tenant_id": HOTEL_A, "feature_key": OTHER, "enabled": True},
    ])
    _install(monkeypatch, db)
    features = _features(TestClient(app), HOTEL_A, role)
    assert RETIRED not in features
    assert OTHER in features  # other flags keep working


def test_missing_false_and_true_rows_all_look_the_same(monkeypatch):
    rows = [
        {"tenant_id": HOTEL_A, "feature_key": RETIRED, "enabled": True},
        {"tenant_id": HOTEL_B, "feature_key": RETIRED, "enabled": False},
    ]
    _install(monkeypatch, _db(rows))
    client = TestClient(app)
    assert _features(client, HOTEL_A) == _features(client, HOTEL_B) == []


def test_retired_rows_are_never_deleted_or_modified_by_a_context_read(monkeypatch):
    rows = [{"tenant_id": HOTEL_A, "feature_key": RETIRED, "enabled": True}]
    db = _db(rows)
    _install(monkeypatch, db)
    before = [dict(r) for r in db.rows["tenant_feature_flags"]]
    _features(TestClient(app), HOTEL_A)
    assert db.rows["tenant_feature_flags"] == before


def test_context_read_makes_no_ai_call_and_spends_no_credit(monkeypatch):
    db = _db([])
    _install(monkeypatch, db)
    ledger_before = [dict(r) for r in db.rows["credit_ledger"]]
    client = TestClient(app)
    for _ in range(3):
        _features(client, HOTEL_A)
    assert db.rows["ai_interactions"] == []
    assert db.rows["credit_ledger"] == ledger_before


def test_no_backend_code_reads_the_retired_key():
    root = pathlib.Path(__file__).resolve().parent.parent
    offenders = [
        str(path.relative_to(root))
        for path in list((root / "routers").glob("*.py")) + list((root / "services").rglob("*.py")) + list((root / "core").glob("*.py"))
        if RETIRED in path.read_text(encoding="utf-8")
    ]
    assert offenders == []
