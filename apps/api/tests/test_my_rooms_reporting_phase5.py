"""Phase 5 server contract for the mobile My Rooms reporting sheets.

Floor staff intake to Lost & Found (and only intake), a housekeeper's photo on
their own work order (and nobody else's), bounded + retry-safe room notes, and
the access-issue attempts that must never start a clean session.
"""

import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import lost_found as lost_found_router
from routers import rooms as rooms_router
from routers import work_orders as work_orders_router
from tests.smoke.fake_supabase import FakeDB

HOTEL = "hotel-a"
OTHER_HOTEL = "hotel-b"
ROOM = str(uuid.uuid4())
FOREIGN_ROOM = str(uuid.uuid4())


def _auth(role="housekeeper", hotel_id=HOTEL, user_id="hk-1"):
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB({
        "room_status": [
            {"room_id": ROOM, "tenant_id": HOTEL, "status": "PICKUP", "assigned_to": "hk-1", "dnd_flag": False, "dnd_attempt_count": 0},
            {"room_id": FOREIGN_ROOM, "tenant_id": OTHER_HOTEL, "status": "PICKUP", "assigned_to": "hk-9"},
        ],
        "room_assignments": [],
        "room_status_history": [],
        "room_service_attempts": [],
        "lost_found_items": [],
        "lost_found_custody_events": [],
        "work_orders": [
            {"id": "wo-mine", "tenant_id": HOTEL, "created_by": "hk-1"},
            {"id": "wo-theirs", "tenant_id": HOTEL, "created_by": "hk-2"},
        ],
        "work_order_photos": [],
    })
    for module in (rooms_router, lost_found_router, work_orders_router):
        monkeypatch.setattr(module, "supabase", fake)
    monkeypatch.setattr(rooms_router, "_record_audit_event", lambda **kwargs: None)
    monkeypatch.setattr(rooms_router, "_log_room_activity", lambda *args, **kwargs: None)
    return fake


@pytest.fixture
def client(db):
    return TestClient(app)


class TestFoundItemIntake:
    def test_housekeeper_can_log_a_found_item_with_the_room(self, client, db):
        response = client.post(
            "/v1/lost-found",
            json={"description": "Black charger", "room_id": ROOM, "location_found": "Room 218"},
            headers=_auth(),
        )
        assert response.status_code == 200
        item = db.rows["lost_found_items"][0]
        assert item["found_by"] == "hk-1"
        assert item["tenant_id"] == HOTEL
        assert item["room_id"] == ROOM
        assert db.rows["lost_found_custody_events"][0]["event_type"] == "intake"

    def test_floor_intake_cannot_set_desk_custody_fields(self, client, db):
        client.post(
            "/v1/lost-found",
            json={
                "description": "Gold ring",
                "tag_identifier": "LF-1",
                "storage_location": "Safe",
                "classification": "high_value",
            },
            headers=_auth(),
        )
        item = db.rows["lost_found_items"][0]
        assert item["classification"] == "standard"
        assert item["tag_identifier"] is None
        assert item["storage_location"] is None

    def test_a_retried_submit_does_not_log_the_item_twice(self, client, db):
        payload = {"description": "Black charger", "room_id": ROOM}
        first = client.post("/v1/lost-found", json=payload, headers=_auth())
        for row in db.rows["lost_found_items"]:
            row.setdefault("created_at", datetime.now(timezone.utc).isoformat())
        second = client.post("/v1/lost-found", json=payload, headers=_auth())
        assert first.status_code == second.status_code == 200
        assert second.json()["replayed"] is True
        assert len(db.rows["lost_found_items"]) == 1

    def test_other_floor_roles_are_still_rejected(self, client, db):
        response = client.post("/v1/lost-found", json={"description": "Phone charger"}, headers=_auth("engineer"))
        assert response.status_code == 403
        assert db.rows["lost_found_items"] == []


class TestWorkOrderPhoto:
    def _upload(self, client, wo_id, role="housekeeper", user_id="hk-1"):
        return client.post(
            f"/v1/work-orders/{wo_id}/photos",
            files={"file": ("leak.jpg", b"\xff\xd8\xff\xe0jpeg", "image/jpeg")},
            data={"photo_type": "before"},
            headers=_auth(role, user_id=user_id),
        )

    def test_housekeeper_can_attach_a_photo_to_the_issue_they_reported(self, client, db):
        response = self._upload(client, "wo-mine")
        assert response.status_code == 200
        assert db.rows["work_order_photos"][0]["uploaded_by"] == "hk-1"
        assert db.storage_uploads[0][1].startswith(f"{HOTEL}/wo-mine/")

    def test_housekeeper_cannot_attach_to_someone_elses_work_order(self, client, db):
        assert self._upload(client, "wo-theirs").status_code == 403
        assert db.rows["work_order_photos"] == []
        assert db.storage_uploads == []

    def test_cross_tenant_work_order_is_not_found(self, client, db):
        response = self._upload(client, "wo-mine", user_id="hk-1")
        assert response.status_code == 200
        foreign = client.post(
            "/v1/work-orders/wo-mine/photos",
            files={"file": ("leak.jpg", b"\xff\xd8\xff\xe0jpeg", "image/jpeg")},
            headers=_auth("housekeeper", hotel_id=OTHER_HOTEL),
        )
        assert foreign.status_code == 404


class TestRoomNotes:
    def test_note_is_stored_as_a_note_only_history_entry(self, client, db):
        response = client.post(f"/v1/rooms/{ROOM}/notes", json={"text": "  Extra pillows on bed  "}, headers=_auth())
        assert response.status_code == 200
        entry = db.rows["room_status_history"][0]
        assert entry["notes"] == "Extra pillows on bed"
        assert entry["from_status"] == entry["to_status"] == "PICKUP"
        assert entry["changed_by"] == "hk-1"

    def test_overlong_note_is_rejected(self, client, db):
        response = client.post(f"/v1/rooms/{ROOM}/notes", json={"text": "x" * 1001}, headers=_auth())
        assert response.status_code == 422
        assert db.rows["room_status_history"] == []

    def test_an_immediate_retry_of_the_same_note_is_one_note(self, client, db):
        first = client.post(f"/v1/rooms/{ROOM}/notes", json={"text": "Tray at door"}, headers=_auth())
        second = client.post(f"/v1/rooms/{ROOM}/notes", json={"text": "Tray at door"}, headers=_auth())
        assert first.status_code == second.status_code == 200
        assert second.json()["data"]["replayed"] is True
        assert len(db.rows["room_status_history"]) == 1

    def test_the_same_text_from_another_person_is_a_separate_note(self, client, db):
        client.post(f"/v1/rooms/{ROOM}/notes", json={"text": "Tray at door"}, headers=_auth())
        client.post(f"/v1/rooms/{ROOM}/notes", json={"text": "Tray at door"}, headers=_auth(user_id="hk-2", role="housekeeping_supervisor"))
        assert len(db.rows["room_status_history"]) == 2

    def test_note_on_another_hotels_room_is_not_found(self, client):
        response = client.post(f"/v1/rooms/{FOREIGN_ROOM}/notes", json={"text": "hello"}, headers=_auth())
        assert response.status_code == 404


class TestAccessIssueAttempts:
    def test_other_access_issue_is_logged_with_its_note_and_starts_no_session(self, client, db):
        response = client.post(
            f"/v1/rooms/{ROOM}/service-attempts",
            json={"result": "other", "note": "Door double-locked", "attempted_at": datetime.now(timezone.utc).isoformat()},
            headers=_auth(),
        )
        assert response.status_code == 200
        attempt = db.rows["room_service_attempts"][0]
        assert attempt["result"] == "other"
        assert attempt["note"] == "Door double-locked"
        assert db.rows.get("room_clean_sessions", []) == []
        status = db.rows["room_status"][0]
        assert status["status"] == "PICKUP"
        assert status["dnd_flag"] is False
