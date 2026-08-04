"""Regression tests for RBAC-02: DELETE /guest-requests/{request_id} must be
restricted to management roles (mirrors the FakeDB + real-JWT TestClient
harness in tests/test_lost_found_delete.py).
"""

from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import guest_requests as guest_requests_router
from tests.smoke.fake_supabase import FakeDB


def _auth_header(role: str, hotel_id: str = "hotel-a", user_id: str = "user-a-1") -> dict[str, str]:
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _db_with_deletable_request() -> FakeDB:
    return FakeDB({
        "guest_requests": [
            {"id": "req-1", "tenant_id": "hotel-a", "task_id": None},
        ],
    })


def test_delete_guest_request_forbidden_for_housekeeper(monkeypatch):
    db = _db_with_deletable_request()
    monkeypatch.setattr(guest_requests_router, "supabase", db)
    client = TestClient(app)

    response = client.delete("/v1/guest-requests/req-1", headers=_auth_header("housekeeper"))

    assert response.status_code == 403
    assert db.rows["guest_requests"] == [
        {"id": "req-1", "tenant_id": "hotel-a", "task_id": None}
    ]


def test_delete_guest_request_allowed_for_gm(monkeypatch):
    db = _db_with_deletable_request()
    monkeypatch.setattr(guest_requests_router, "supabase", db)
    client = TestClient(app)

    response = client.delete("/v1/guest-requests/req-1", headers=_auth_header("gm"))

    assert response.status_code == 204
    assert db.rows["guest_requests"] == []
