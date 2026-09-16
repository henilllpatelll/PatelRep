"""Regression tests for POST /guest-requests/{id}/create-work-order — the
guest-request -> engineering work-order bridge (migration 103). Mirrors the
FakeDB + real-JWT TestClient harness in test_guest_requests_delete_rbac.py.
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


def _base_rows(**overrides) -> dict:
    guest_request = {
        "id": "req-1",
        "tenant_id": "hotel-a",
        "title": "AC not cooling",
        "description": "Guest says AC blows warm air",
        "room_id": "room-1",
        "status": "open",
        "priority": "normal",
        "guest_impact": "high",
        "category": "maintenance",
    }
    guest_request.update(overrides.pop("guest_request", {}))
    rows = {
        "guest_requests": [guest_request],
        "work_orders": overrides.pop("work_orders", []),
        "assets": overrides.pop("assets", []),
        "guest_request_events": [],
    }
    rows.update(overrides)
    return rows


def _client(db: FakeDB) -> TestClient:
    guest_requests_router.__dict__["supabase"].__class__  # no-op, keeps import used
    import routers.work_orders as work_orders_router

    # The bridge imports SLA_MINUTES from work_orders lazily; work_orders also
    # holds its own `supabase` reference, but this endpoint never calls it.
    del work_orders_router
    guest_requests_router.supabase = db
    return TestClient(app)


def test_create_work_order_404_when_request_missing(monkeypatch):
    db = FakeDB(_base_rows())
    monkeypatch.setattr(guest_requests_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/guest-requests/does-not-exist/create-work-order",
        json={"category": "hvac"},
        headers=_auth_header("front_desk"),
    )

    assert response.status_code == 404


def test_create_work_order_forbidden_for_engineer(monkeypatch):
    db = FakeDB(_base_rows())
    monkeypatch.setattr(guest_requests_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/guest-requests/req-1/create-work-order",
        json={"category": "hvac"},
        headers=_auth_header("engineer"),
    )

    assert response.status_code == 403
    assert db.rows["work_orders"] == []


def test_create_work_order_409_when_status_not_bridgeable(monkeypatch):
    db = FakeDB(_base_rows(guest_request={"status": "resolved"}))
    monkeypatch.setattr(guest_requests_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/guest-requests/req-1/create-work-order",
        json={"category": "hvac"},
        headers=_auth_header("front_desk"),
    )

    assert response.status_code == 409
    assert db.rows["work_orders"] == []


def test_create_work_order_409_when_already_linked(monkeypatch):
    db = FakeDB(_base_rows(work_orders=[
        {"id": "wo-existing", "tenant_id": "hotel-a", "guest_request_id": "req-1", "status": "open"},
    ]))
    monkeypatch.setattr(guest_requests_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/guest-requests/req-1/create-work-order",
        json={"category": "hvac"},
        headers=_auth_header("front_desk"),
    )

    assert response.status_code == 409


def test_create_work_order_ignores_cancelled_prior_work_order(monkeypatch):
    """A cancelled prior bridge attempt must not block creating a new one."""
    db = FakeDB(_base_rows(work_orders=[
        {"id": "wo-cancelled", "tenant_id": "hotel-a", "guest_request_id": "req-1", "status": "cancelled"},
    ]))
    monkeypatch.setattr(guest_requests_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/guest-requests/req-1/create-work-order",
        json={"category": "hvac"},
        headers=_auth_header("front_desk"),
    )

    assert response.status_code == 200


def test_create_work_order_happy_path_derives_priority_and_links_asset(monkeypatch):
    db = FakeDB(_base_rows(
        assets=[{"id": "asset-1", "tenant_id": "hotel-a", "room_id": "room-1", "is_active": True}],
    ))
    monkeypatch.setattr(guest_requests_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/guest-requests/req-1/create-work-order",
        json={"category": "hvac"},
        headers=_auth_header("front_desk"),
    )

    assert response.status_code == 200
    body = response.json()
    wo = body["data"]
    assert wo["room_id"] == "room-1"
    assert wo["asset_id"] == "asset-1"
    assert wo["guest_request_id"] == "req-1"
    assert wo["guest_reported"] is True
    # guest_impact="high" -> urgent even though the guest_request's own priority is "normal"
    assert wo["priority"] == "urgent"
    assert wo["sla_minutes"] == 60
    assert body["meta"]["guest_request_status"] == "dispatched"

    updated_request = next(r for r in db.rows["guest_requests"] if r["id"] == "req-1")
    assert updated_request["status"] == "dispatched"
    assert updated_request["acknowledged_at"] is not None
    assert updated_request["dispatched_at"] is not None

    event_types = [e["event_type"] for e in db.rows["guest_request_events"]]
    assert event_types == ["note", "acknowledged", "dispatched"]


def test_create_work_order_skips_asset_link_when_room_has_multiple_assets(monkeypatch):
    db = FakeDB(_base_rows(
        assets=[
            {"id": "asset-1", "tenant_id": "hotel-a", "room_id": "room-1", "is_active": True},
            {"id": "asset-2", "tenant_id": "hotel-a", "room_id": "room-1", "is_active": True},
        ],
    ))
    monkeypatch.setattr(guest_requests_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/guest-requests/req-1/create-work-order",
        json={"category": "hvac"},
        headers=_auth_header("front_desk"),
    )

    assert response.status_code == 200
    assert response.json()["data"]["asset_id"] is None


def test_create_work_order_rejects_asset_from_a_different_room(monkeypatch):
    db = FakeDB(_base_rows(
        assets=[{"id": "asset-1", "tenant_id": "hotel-a", "room_id": "room-2", "is_active": True}],
    ))
    monkeypatch.setattr(guest_requests_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/guest-requests/req-1/create-work-order",
        json={"category": "hvac", "asset_id": "asset-1"},
        headers=_auth_header("front_desk"),
    )

    assert response.status_code == 422


def test_create_work_order_explicit_priority_overrides_derived_value(monkeypatch):
    db = FakeDB(_base_rows(guest_request={"guest_impact": "standard", "priority": "normal"}))
    monkeypatch.setattr(guest_requests_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/guest-requests/req-1/create-work-order",
        json={"category": "safety", "priority": "emergency"},
        headers=_auth_header("gm"),
    )

    assert response.status_code == 200
    assert response.json()["data"]["priority"] == "emergency"
    assert response.json()["data"]["sla_minutes"] == 30
