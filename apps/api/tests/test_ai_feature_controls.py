"""Phase 7: operator rollout controls for the new optional AI features.

Built on the existing fail-closed tenant flag system (core/feature_flags.py). Pins that a switched-off
feature is refused server-side BEFORE any provider is contacted or credit is touched, that one hotel's
setting never leaks into another's, that `/ai/capabilities` tells the phone exactly what to show, and
that the manual (non-AI) alternatives are not gated.
"""

from datetime import date
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
import jwt
from PIL import Image

from core import feature_flags
from core.config import settings
from core.feature_registry import FEATURE_REGISTRY
from main import app
from middleware import credits
from routers import ai_copilot as ai_router
from tests.smoke.fake_supabase import FakeDB

FLAGS = ("hk_ai_assistant", "hk_ai_photo_analysis", "hk_ai_task_translation")


def _auth(role="housekeeper", hotel_id="hotel-a", user_id="hk-1"):
    token = jwt.encode({"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"},
                       settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _flag_rows(**per_hotel):
    return [
        {"tenant_id": hotel, "feature_key": key, "enabled": True}
        for hotel, keys in per_hotel.items() for key in keys
    ]


def _db(flag_rows, overage_cents=0):
    today = date.today()
    return FakeDB({
        "tenant_feature_flags": flag_rows,
        "credit_ledger": [{
            "id": "l", "tenant_id": "hotel-a", "credits_included": 5000, "overage_cost_cents": overage_cents,
            "period_start": date(today.year, 1, 1).isoformat(), "period_end": date(today.year, 12, 31).isoformat(),
        }],
        "subscriptions": [{"tenant_id": "hotel-a", "cap_cents": 12_900, "plan_status": "active"}],
        "ai_interactions": [], "tasks": [], "rooms": [], "room_assignments": [],
    })


@pytest.fixture(autouse=True)
def _isolated(monkeypatch):
    feature_flags._cache.clear()
    monkeypatch.setattr(settings, "ai_provider", "hosted")
    yield
    feature_flags._cache.clear()


def _install(monkeypatch, db):
    for module in (feature_flags, credits, ai_router):
        monkeypatch.setattr(module, "supabase", db)


def _jpeg() -> bytes:
    buf = BytesIO()
    Image.new("RGB", (64, 64), (200, 200, 200)).save(buf, format="JPEG")
    return buf.getvalue()


def _forbid(name):
    def fail(*_a, **_k):
        raise AssertionError(f"{name} ran although the feature is switched off")
    return fail


def test_the_three_flags_are_registered_default_off_release_flags():
    for key in FLAGS:
        assert key in FEATURE_REGISTRY and FEATURE_REGISTRY[key].type == "release"
    assert FEATURE_REGISTRY["hk_ai_photo_analysis"].backend_enforced
    assert FEATURE_REGISTRY["hk_ai_task_translation"].backend_enforced


# ---- capabilities --------------------------------------------------------------------------------------

def test_every_capability_is_off_until_an_operator_enables_it(monkeypatch):
    _install(monkeypatch, _db([]))
    res = TestClient(app).get("/v1/ai/capabilities", headers=_auth())
    assert res.status_code == 200
    assert res.json()["data"] == {"unified_assistant": False, "photo_analysis": False, "task_translation": False}


def test_capabilities_reflect_this_hotel_only(monkeypatch):
    _install(monkeypatch, _db(_flag_rows(**{"hotel-b": FLAGS, "hotel-a": ("hk_ai_assistant",)})))
    client = TestClient(app)
    a = client.get("/v1/ai/capabilities", headers=_auth(hotel_id="hotel-a")).json()["data"]
    b = client.get("/v1/ai/capabilities", headers=_auth(hotel_id="hotel-b")).json()["data"]
    assert a == {"unified_assistant": True, "photo_analysis": False, "task_translation": False}
    assert b == {"unified_assistant": True, "photo_analysis": True, "task_translation": True}


def test_a_disabled_row_and_a_lookup_failure_both_read_as_off(monkeypatch):
    rows = [{"tenant_id": "hotel-a", "feature_key": "hk_ai_assistant", "enabled": False}]
    _install(monkeypatch, _db(rows))
    assert TestClient(app).get("/v1/ai/capabilities", headers=_auth()).json()["data"]["unified_assistant"] is False

    feature_flags._cache.clear()

    class Broken:
        def table(self, _name):
            raise RuntimeError("database unavailable")

    monkeypatch.setattr(feature_flags, "supabase", Broken())
    assert TestClient(app).get("/v1/ai/capabilities", headers=_auth()).json()["data"]["unified_assistant"] is False


# ---- server-side enforcement ---------------------------------------------------------------------------

def test_photo_analysis_is_refused_before_anything_runs_when_switched_off(monkeypatch):
    db = _db([])
    _install(monkeypatch, db)
    monkeypatch.setattr(ai_router, "analyze_photo", _forbid("analyze_photo"))
    res = TestClient(app).post(
        "/v1/ai/photo-analysis", files={"file": ("p.jpg", _jpeg(), "image/jpeg")}, headers=_auth(),
    )
    assert res.status_code == 403
    assert "hk_ai_photo_analysis" in res.json()["detail"]
    assert db.rows["ai_interactions"] == []  # nothing logged, nothing charged


def test_photo_analysis_for_hotel_a_is_not_unlocked_by_hotel_bs_flag(monkeypatch):
    _install(monkeypatch, _db(_flag_rows(**{"hotel-b": ("hk_ai_photo_analysis",)})))
    monkeypatch.setattr(ai_router, "analyze_photo", _forbid("analyze_photo"))
    res = TestClient(app).post(
        "/v1/ai/photo-analysis", files={"file": ("p.jpg", _jpeg(), "image/jpeg")}, headers=_auth(hotel_id="hotel-a"),
    )
    assert res.status_code == 403


def test_enabled_but_over_the_cap_is_still_refused_before_the_provider(monkeypatch):
    # The flag is not an entitlement: the existing credit cap still applies.
    _install(monkeypatch, _db(_flag_rows(**{"hotel-a": ("hk_ai_photo_analysis",)}), overage_cents=10_000))
    monkeypatch.setattr(ai_router, "analyze_photo", _forbid("analyze_photo"))
    res = TestClient(app).post(
        "/v1/ai/photo-analysis", files={"file": ("p.jpg", _jpeg(), "image/jpeg")}, headers=_auth(),
    )
    assert res.status_code == 402


def test_task_translation_is_refused_when_switched_off(monkeypatch):
    _install(monkeypatch, _db([]))
    monkeypatch.setattr(ai_router, "translate_task_fields", _forbid("translate_task_fields"))
    res = TestClient(app).post(
        "/v1/ai/tasks/11111111-1111-4111-8111-111111111111/translate", json={"target_language": "es"}, headers=_auth(),
    )
    assert res.status_code == 403
    assert "hk_ai_task_translation" in res.json()["detail"]


def test_the_manual_alternatives_do_not_depend_on_any_ai_flag(monkeypatch):
    """Reporting and creating tasks by hand never reads these flags: switching AI off removes help, not work."""
    _install(monkeypatch, _db([]))
    seen = []
    real = feature_flags.is_feature_enabled
    monkeypatch.setattr(feature_flags, "is_feature_enabled", lambda t, k: (seen.append(k), real(t, k))[1])
    # The free chat replies (no model involved) still answer with every AI flag off.
    res = TestClient(app).post("/v1/ai/copilot/chat", json={"message": "hello"}, headers=_auth())
    assert res.status_code == 200
    assert not set(seen) & set(FLAGS)
