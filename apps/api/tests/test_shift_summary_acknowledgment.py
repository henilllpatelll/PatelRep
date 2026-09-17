"""Shift-summary acknowledgment tests (39-03).

Proves the acknowledge endpoint is any-role, idempotent (never overwrites the
first acknowledger, never 409s), tenant-scoped (404 cross-tenant), and that
get_shift_summary surfaces a resolved acknowledged_by_name.

Uses the FakeDB + TestClient + real-JWT harness shared with test_logbook_timezone.py.
"""

from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import logbook as logbook_router
from tests.smoke.fake_supabase import FakeDB

SUMMARY_ID = "22222222-2222-4222-8222-222222222222"


def _auth_header(role: str, hotel_id: str = "hotel-a", user_id: str = "user-a-1") -> dict[str, str]:
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _db(summary_extra: dict | None = None, profiles: list | None = None) -> FakeDB:
    summary = {
        "id": SUMMARY_ID,
        "tenant_id": "hotel-a",
        "shift_id": "shift-1",
        "summary_text": "Overnight handoff.",
        "generated_by_ai": True,
        "acknowledged_by": None,
        "acknowledged_at": None,
    }
    if summary_extra:
        summary.update(summary_extra)
    return FakeDB({
        "shift_summaries": [summary],
        "user_profiles": profiles if profiles is not None else [],
    })


def test_non_gm_role_can_acknowledge(monkeypatch):
    """No require_role gate: an engineer can acknowledge and it sets by/at."""
    db = _db(profiles=[{"id": "user-a-1", "preferred_name": "Engie", "full_name": "Engineer One"}])
    monkeypatch.setattr(logbook_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        f"/v1/logbook/shift-summary/{SUMMARY_ID}/acknowledge",
        headers=_auth_header("engineer", user_id="user-a-1"),
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["acknowledged_by"] == "user-a-1"
    assert data["acknowledged_at"] is not None
    assert data["acknowledged_by_name"] == "Engie"
    # Persisted to the row
    assert db.rows["shift_summaries"][0]["acknowledged_by"] == "user-a-1"


def test_acknowledge_is_idempotent_and_never_overwrites(monkeypatch):
    """A row already acknowledged by user A: user B's call returns A unchanged."""
    db = _db(
        summary_extra={"acknowledged_by": "user-a-A", "acknowledged_at": "2026-09-16T08:00:00+00:00"},
        profiles=[{"id": "user-a-A", "preferred_name": "Alice", "full_name": "Alice Anderson"}],
    )
    monkeypatch.setattr(logbook_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        f"/v1/logbook/shift-summary/{SUMMARY_ID}/acknowledge",
        headers=_auth_header("gm", user_id="user-a-B"),
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["acknowledged_by"] == "user-a-A"
    assert data["acknowledged_at"] == "2026-09-16T08:00:00+00:00"
    assert data["acknowledged_by_name"] == "Alice"
    # The stored row was not overwritten by user B
    assert db.rows["shift_summaries"][0]["acknowledged_by"] == "user-a-A"


def test_acknowledge_missing_summary_returns_404(monkeypatch):
    db = _db()
    monkeypatch.setattr(logbook_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/logbook/shift-summary/00000000-0000-4000-8000-000000000000/acknowledge",
        headers=_auth_header("gm"),
    )

    assert response.status_code == 404


def test_acknowledge_cross_tenant_returns_404(monkeypatch):
    """A summary owned by hotel-a is not found for a hotel-b caller."""
    db = _db()
    monkeypatch.setattr(logbook_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        f"/v1/logbook/shift-summary/{SUMMARY_ID}/acknowledge",
        headers=_auth_header("gm", hotel_id="hotel-b", user_id="user-b-1"),
    )

    assert response.status_code == 404
    # Untouched
    assert db.rows["shift_summaries"][0]["acknowledged_by"] is None


def test_get_shift_summary_resolves_acknowledged_by_name(monkeypatch):
    db = _db(
        summary_extra={"acknowledged_by": "user-a-A", "acknowledged_at": "2026-09-16T08:00:00+00:00"},
        profiles=[{"id": "user-a-A", "preferred_name": "Alice", "full_name": "Alice Anderson"}],
    )
    monkeypatch.setattr(logbook_router, "supabase", db)
    client = TestClient(app)

    response = client.get("/v1/logbook/shift-summary/shift-1", headers=_auth_header("gm"))

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["summary_text"] == "Overnight handoff."
    assert data["acknowledged_by_name"] == "Alice"


def test_get_shift_summary_name_null_when_unacknowledged(monkeypatch):
    db = _db()
    monkeypatch.setattr(logbook_router, "supabase", db)
    client = TestClient(app)

    response = client.get("/v1/logbook/shift-summary/shift-1", headers=_auth_header("gm"))

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["acknowledged_by_name"] is None
