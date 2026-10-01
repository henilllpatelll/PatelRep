"""Phase 2 Lost & Found intake, custody, and access-control contracts."""

from datetime import datetime, timezone

from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import lost_found as lost_found_router
from tests.smoke.fake_supabase import FakeDB


def _auth_header(role: str, hotel_id: str = "hotel-a") -> dict[str, str]:
    token = jwt.encode(
        {"sub": "staff-1", "role": role, "hotel_id": hotel_id, "aud": "authenticated"},
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


def test_authorized_intake_persists_phase_two_fields_and_intake_location(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(lost_found_router, "supabase", db)
    found_at = "2026-09-30T11:30:00+00:00"

    response = TestClient(app).post(
        "/v1/lost-found",
        headers=_auth_header("front_desk"),
        json={
            "description": "Black iPhone 15 Pro",
            "tag_identifier": "lf-1042",
            "category": "electronics",
            "classification": "high_value",
            "distinguishing_details": "Clear case, crack near rear camera",
            "location_found": "Guest Room",
            "found_at": found_at,
            "storage_location": "Lost & Found Room · Bin A-12",
        },
    )

    assert response.status_code == 200
    item = response.json()["data"]
    assert item["tag_identifier"] == "LF-1042"
    assert item["found_at"] == found_at
    assert item["category"] == "electronics"
    assert db.rows["lost_found_custody_events"][0]["event_type"] == "intake"
    assert db.rows["lost_found_custody_events"][0]["storage_location"].endswith("Bin A-12")


def test_intake_rejects_unauthorized_role(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(lost_found_router, "supabase", db)

    response = TestClient(app).post(
        "/v1/lost-found",
        headers=_auth_header("engineer"),
        json={"description": "Phone charger"},
    )

    assert response.status_code == 403
    assert db.rows.get("lost_found_items", []) == []


def test_intake_rejects_duplicate_active_tenant_tag(monkeypatch):
    db = FakeDB({
        "lost_found_items": [
            {"id": "existing", "tenant_id": "hotel-a", "tag_identifier": "LF-1042", "status": "unclaimed"},
            {"id": "other-hotel", "tenant_id": "hotel-b", "tag_identifier": "LF-1042", "status": "unclaimed"},
        ]
    })
    monkeypatch.setattr(lost_found_router, "supabase", db)

    response = TestClient(app).post(
        "/v1/lost-found",
        headers=_auth_header("gm"),
        json={"description": "Wallet", "tag_identifier": "lf-1042"},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "This tag ID is already in use."


def test_move_records_previous_and_destination_storage(monkeypatch):
    db = FakeDB({
        "lost_found_items": [{
            "id": "item-1", "tenant_id": "hotel-a", "status": "unclaimed",
            "storage_location": "Lost & Found Room · Bin A-12",
        }],
        "lost_found_custody_events": [],
    })
    monkeypatch.setattr(lost_found_router, "supabase", db)

    response = TestClient(app).post(
        "/v1/lost-found/item-1/custody-events",
        headers=_auth_header("housekeeping_supervisor"),
        json={
            "event_type": "moved",
            "storage_location": "Front Desk · Safe #2",
            "note": "Guest contacted hotel",
        },
    )

    assert response.status_code == 200
    event = response.json()["data"]
    assert event["previous_storage_location"] == "Lost & Found Room · Bin A-12"
    assert event["storage_location"] == "Front Desk · Safe #2"
    assert db.rows["lost_found_items"][0]["storage_location"] == "Front Desk · Safe #2"


def test_move_rejects_same_destination_without_reason(monkeypatch):
    db = FakeDB({
        "lost_found_items": [{
            "id": "item-1", "tenant_id": "hotel-a", "status": "unclaimed",
            "storage_location": "Front Desk · Safe #2",
        }]
    })
    monkeypatch.setattr(lost_found_router, "supabase", db)

    response = TestClient(app).post(
        "/v1/lost-found/item-1/custody-events",
        headers=_auth_header("gm"),
        json={"event_type": "moved", "storage_location": "Front Desk · Safe #2"},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Choose a different storage location or add a reason for this move."


def test_inventory_search_and_filters_cover_phase_two_fields(monkeypatch):
    now = datetime.now(timezone.utc).isoformat()
    db = FakeDB({
        "lost_found_items": [
            {"id": "item-1", "tenant_id": "hotel-a", "description": "Phone", "tag_identifier": "LF-1042", "category": "electronics", "storage_location": "Front Desk · Safe #2", "created_at": now},
            {"id": "item-2", "tenant_id": "hotel-a", "description": "Coat", "tag_identifier": "LF-1043", "category": "clothing", "storage_location": "Lost & Found Room", "created_at": now},
        ]
    })
    monkeypatch.setattr(lost_found_router, "supabase", db)

    response = TestClient(app).get(
        "/v1/lost-found",
        headers=_auth_header("gm"),
        params={"search": "safe", "category": "electronics", "storage": "Front Desk"},
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["data"]] == ["item-1"]
