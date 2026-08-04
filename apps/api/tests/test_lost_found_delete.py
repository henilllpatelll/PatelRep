"""Regression tests for LOSTFOUND-01: permanent delete of a Lost & Found item
with prior custody-transfer history (mirrors the FakeDB + real-JWT TestClient
harness in tests/test_lost_found_retention.py).

FakeDB does not enforce foreign-key constraints or DB triggers, so it cannot
reproduce the original ON DELETE RESTRICT foreign-key-violation 500 that this
fix addresses. These tests lock in the delete endpoint's contract instead:
204 on success, 404 for a missing item, and no manual deletion of
lost_found_custody_events rows in the router (the endpoint must rely on the
DB-level CASCADE added by migration 087). The actual cascade + no-orphans
guarantee is provided by migration 087 and is a SQL/DDL-level guarantee, not
something these Python-level tests can verify directly.
"""

from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import lost_found as lost_found_router
from tests.smoke.fake_supabase import FakeDB


def _auth_header(role: str, hotel_id: str = "hotel-a", user_id: str = "user-a-1") -> dict[str, str]:
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _db_with_item_and_custody_history() -> FakeDB:
    return FakeDB({
        "lost_found_items": [
            {"id": "item-1", "tenant_id": "hotel-a", "status": "unclaimed"},
        ],
        "lost_found_custody_events": [
            {
                "id": "event-1",
                "tenant_id": "hotel-a",
                "lost_found_item_id": "item-1",
                "event_type": "intake",
            },
        ],
    })


def test_delete_item_with_custody_history_returns_204(monkeypatch):
    db = _db_with_item_and_custody_history()
    monkeypatch.setattr(lost_found_router, "supabase", db)
    client = TestClient(app)

    response = client.delete("/v1/lost-found/item-1", headers=_auth_header("gm"))

    assert response.status_code == 204
    assert db.rows["lost_found_items"] == []


def test_delete_item_does_not_manually_delete_custody_events(monkeypatch):
    """The endpoint relies on the DB cascade (migration 087), not application code."""
    db = _db_with_item_and_custody_history()
    monkeypatch.setattr(lost_found_router, "supabase", db)
    client = TestClient(app)

    response = client.delete("/v1/lost-found/item-1", headers=_auth_header("gm"))

    assert response.status_code == 204
    assert all(table != "lost_found_custody_events" for table, _ in db.deletes)
    # FakeDB has no FK cascade, so the child row is left behind here — that gap is
    # exactly what migration 087's DB-level CASCADE closes in the real database.
    assert db.rows["lost_found_custody_events"] == [
        {
            "id": "event-1",
            "tenant_id": "hotel-a",
            "lost_found_item_id": "item-1",
            "event_type": "intake",
        }
    ]


def test_delete_nonexistent_item_returns_404(monkeypatch):
    db = _db_with_item_and_custody_history()
    monkeypatch.setattr(lost_found_router, "supabase", db)
    client = TestClient(app)

    response = client.delete("/v1/lost-found/does-not-exist", headers=_auth_header("gm"))

    assert response.status_code == 404
    assert db.rows["lost_found_items"] == [
        {"id": "item-1", "tenant_id": "hotel-a", "status": "unclaimed"}
    ]


def test_delete_item_forbidden_for_housekeeper(monkeypatch):
    db = _db_with_item_and_custody_history()
    monkeypatch.setattr(lost_found_router, "supabase", db)
    client = TestClient(app)

    response = client.delete("/v1/lost-found/item-1", headers=_auth_header("housekeeper"))

    assert response.status_code == 403
    assert db.rows["lost_found_items"] == [
        {"id": "item-1", "tenant_id": "hotel-a", "status": "unclaimed"}
    ]


def test_patch_item_forbidden_for_housekeeper(monkeypatch):
    db = _db_with_item_and_custody_history()
    monkeypatch.setattr(lost_found_router, "supabase", db)
    client = TestClient(app)

    response = client.patch(
        "/v1/lost-found/item-1",
        json={"status": "claimed"},
        headers=_auth_header("housekeeper"),
    )

    assert response.status_code == 403


def test_patch_item_allowed_for_gm(monkeypatch):
    db = _db_with_item_and_custody_history()
    monkeypatch.setattr(lost_found_router, "supabase", db)
    client = TestClient(app)

    response = client.patch(
        "/v1/lost-found/item-1",
        json={"status": "claimed"},
        headers=_auth_header("gm"),
    )

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "claimed"
