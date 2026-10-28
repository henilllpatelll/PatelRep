"""Room Board V2 phase 6 server contracts.

The supervisor's DND wellness check goes through ONE endpoint (POST /rooms/{id}/welfare-check): it needs DND to
really be on, and it answers a repeat request with the task that already exists instead of a second task and a
second round of notifications. The mobile inspection flow posts the legacy JSON endpoint, which must apply the
same "only a CLEAN room can be inspected" rule as /inspections/complete.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
import jwt

from core.config import settings
from main import app
from routers import housekeeping as housekeeping_router
from routers import rooms as rooms_router
from tests.smoke.fake_supabase import FakeDB

HOTEL = "hotel-a"
OTHER_HOTEL = "hotel-b"
DND_ROOM = str(uuid.uuid4())
QUIET_ROOM = str(uuid.uuid4())
CLEAN_ROOM = str(uuid.uuid4())
INSPECTED_ROOM = str(uuid.uuid4())
FOREIGN_ROOM = str(uuid.uuid4())
TEMPLATE = str(uuid.uuid4())
ITEM = str(uuid.uuid4())
FOREIGN_TEMPLATE = str(uuid.uuid4())
FOREIGN_ITEM = str(uuid.uuid4())


def _auth(role="housekeeping_supervisor", hotel_id=HOTEL, user_id="sup-1"):
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _now():
    return datetime.now(timezone.utc)


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB({
        "room_status": [
            {"room_id": DND_ROOM, "tenant_id": HOTEL, "status": "OCCUPIED", "dnd_flag": True},
            {"room_id": QUIET_ROOM, "tenant_id": HOTEL, "status": "OCCUPIED", "dnd_flag": False},
            {"room_id": CLEAN_ROOM, "tenant_id": HOTEL, "status": "CLEAN", "dnd_flag": False, "clean_type": "DEP"},
            {"room_id": INSPECTED_ROOM, "tenant_id": HOTEL, "status": "INSPECTED", "dnd_flag": False},
            {"room_id": FOREIGN_ROOM, "tenant_id": OTHER_HOTEL, "status": "CLEAN", "dnd_flag": True},
        ],
        "rooms": [
            {"id": CLEAN_ROOM, "tenant_id": HOTEL, "room_number": "206"},
            {"id": INSPECTED_ROOM, "tenant_id": HOTEL, "room_number": "209"},
            {"id": DND_ROOM, "tenant_id": HOTEL, "room_number": "207"},
            {"id": QUIET_ROOM, "tenant_id": HOTEL, "room_number": "208"},
            {"id": FOREIGN_ROOM, "tenant_id": OTHER_HOTEL, "room_number": "901"},
        ],
        "user_roles": [
            {"user_id": "sup-1", "tenant_id": HOTEL, "role": "housekeeping_supervisor", "is_active": True},
            {"user_id": "fd-1", "tenant_id": HOTEL, "role": "front_desk", "is_active": True},
            {"user_id": "sup-9", "tenant_id": OTHER_HOTEL, "role": "housekeeping_supervisor", "is_active": True},
        ],
        "inspection_templates": [
            {"id": TEMPLATE, "tenant_id": HOTEL, "is_active": True},
            {"id": FOREIGN_TEMPLATE, "tenant_id": OTHER_HOTEL, "is_active": True},
        ],
        "inspection_template_items": [
            {"id": ITEM, "tenant_id": HOTEL, "template_id": TEMPLATE},
            {"id": FOREIGN_ITEM, "tenant_id": OTHER_HOTEL, "template_id": FOREIGN_TEMPLATE},
        ],
        "tasks": [],
        "notifications": [],
        "inspections": [],
        "inspection_results": [],
        "room_status_history": [],
    })
    monkeypatch.setattr(rooms_router, "supabase", fake)
    monkeypatch.setattr(housekeeping_router, "supabase", fake)
    return fake


@pytest.fixture
def client(db):
    return TestClient(app)


def _welfare(client, room_id=DND_ROOM, **auth):
    return client.post(f"/v1/rooms/{room_id}/welfare-check", json={}, headers=_auth(**auth))


class TestWelfareCheck:
    def test_creates_one_task_and_notifies_supervisors_and_front_desk(self, client, db):
        response = _welfare(client)
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["already_requested"] is False
        assert data["notified"] is True
        assert len(db.rows["tasks"]) == 1
        assert db.rows["tasks"][0]["room_id"] == DND_ROOM
        assert db.rows["tasks"][0]["tenant_id"] == HOTEL
        recipients = sorted(n["user_id"] for n in db.rows["notifications"])
        assert recipients == ["fd-1", "sup-1"]

    def test_requires_do_not_disturb_to_be_active(self, client, db):
        response = _welfare(client, QUIET_ROOM)
        assert response.status_code == 409
        assert db.rows["tasks"] == []
        assert db.rows["notifications"] == []

    def test_a_repeat_request_returns_the_open_task_and_notifies_nobody_again(self, client, db):
        first = _welfare(client).json()["data"]
        notified_once = len(db.rows["notifications"])
        second = _welfare(client)
        assert second.status_code == 200
        assert second.json()["data"]["task_id"] == first["task_id"]
        assert second.json()["data"]["already_requested"] is True
        assert second.json()["data"]["notified"] is False
        assert len(db.rows["tasks"]) == 1
        assert len(db.rows["notifications"]) == notified_once

    def test_a_second_supervisor_also_gets_the_existing_task(self, client, db):
        _welfare(client)
        again = _welfare(client, user_id="sup-2")
        assert again.json()["data"]["already_requested"] is True
        assert len(db.rows["tasks"]) == 1

    def test_the_older_supervisor_wellness_task_also_counts_as_open(self, client, db):
        db.rows["tasks"].append({
            "id": "legacy-1", "tenant_id": HOTEL, "room_id": DND_ROOM, "task_type": "housekeeping",
            "title": "Supervisor wellness check — Room 207", "status": "open", "created_at": _now().isoformat(),
        })
        response = _welfare(client)
        assert response.json()["data"]["task_id"] == "legacy-1"
        assert len(db.rows["tasks"]) == 1

    def test_a_completed_or_old_task_does_not_block_a_new_request(self, client, db):
        db.rows["tasks"].extend([
            {"id": "done-1", "tenant_id": HOTEL, "room_id": DND_ROOM, "task_type": "housekeeping",
             "title": "Welfare check — Room 207", "status": "completed", "created_at": _now().isoformat()},
            {"id": "old-1", "tenant_id": HOTEL, "room_id": DND_ROOM, "task_type": "housekeeping",
             "title": "Welfare check — Room 207", "status": "open", "created_at": (_now() - timedelta(hours=30)).isoformat()},
        ])
        response = _welfare(client)
        assert response.json()["data"]["already_requested"] is False
        assert len(db.rows["tasks"]) == 3

    def test_another_hotels_open_task_is_not_reused(self, client, db):
        db.rows["tasks"].append({
            "id": "foreign-1", "tenant_id": OTHER_HOTEL, "room_id": DND_ROOM, "task_type": "housekeeping",
            "title": "Welfare check — Room 207", "status": "open", "created_at": _now().isoformat(),
        })
        response = _welfare(client)
        assert response.json()["data"]["task_id"] != "foreign-1"

    def test_a_room_in_another_hotel_is_not_found(self, client, db):
        assert _welfare(client, FOREIGN_ROOM).status_code == 404
        assert db.rows["tasks"] == []

    def test_it_never_turns_do_not_disturb_off(self, client, db):
        _welfare(client)
        row = next(r for r in db.rows["room_status"] if r["room_id"] == DND_ROOM)
        assert row["dnd_flag"] is True

    @pytest.mark.parametrize("role", ["housekeeper", "engineer", "chief_engineer"])
    def test_floor_and_engineering_roles_are_refused(self, client, db, role):
        assert _welfare(client, role=role).status_code == 403
        assert db.rows["tasks"] == []


def _inspection(room_id, **overrides):
    body = {
        "room_id": room_id,
        "template_id": TEMPLATE,
        "overall_result": "passed",
        "items": [{"template_item_id": ITEM, "result": "pass"}],
    }
    body.update(overrides)
    return body


class TestInspectionGuard:
    def test_a_clean_room_can_be_inspected(self, client, db):
        response = client.post("/v1/housekeeping/inspections", json=_inspection(CLEAN_ROOM), headers=_auth())
        assert response.status_code == 200
        assert len(db.rows["inspections"]) == 1
        assert db.rows["inspections"][0]["tenant_id"] == HOTEL
        assert db.rows["inspections"][0]["inspected_by"] == "sup-1"

    def test_a_room_that_was_already_inspected_is_refused_and_nothing_is_written(self, client, db):
        response = client.post("/v1/housekeeping/inspections", json=_inspection(INSPECTED_ROOM), headers=_auth())
        assert response.status_code == 409
        assert db.rows["inspections"] == []
        assert db.rows["inspection_results"] == []
        assert db.rows["room_status_history"] == []

    def test_a_room_still_being_serviced_is_refused(self, client, db):
        response = client.post("/v1/housekeeping/inspections", json=_inspection(DND_ROOM), headers=_auth())
        assert response.status_code == 409
        assert db.rows["inspections"] == []

    def test_a_room_in_another_hotel_is_not_found(self, client, db):
        response = client.post("/v1/housekeeping/inspections", json=_inspection(FOREIGN_ROOM), headers=_auth())
        assert response.status_code == 404
        assert db.rows["inspections"] == []

    def test_another_hotels_checklist_is_refused_and_nothing_is_written(self, client, db):
        body = _inspection(CLEAN_ROOM, template_id=FOREIGN_TEMPLATE, items=[{"template_item_id": FOREIGN_ITEM, "result": "pass"}])
        response = client.post("/v1/housekeeping/inspections", json=body, headers=_auth())
        assert response.status_code == 404
        assert db.rows["inspections"] == []

    def test_an_item_from_a_different_checklist_is_refused(self, client, db):
        body = _inspection(CLEAN_ROOM, items=[{"template_item_id": FOREIGN_ITEM, "result": "pass"}])
        response = client.post("/v1/housekeeping/inspections", json=body, headers=_auth())
        assert response.status_code == 422
        assert db.rows["inspections"] == []
        assert next(r for r in db.rows["room_status"] if r["room_id"] == CLEAN_ROOM)["status"] == "CLEAN"

    def test_a_failed_inspection_of_a_clean_room_is_still_recorded(self, client, db):
        body = _inspection(CLEAN_ROOM, overall_result="failed", items=[{"template_item_id": ITEM, "result": "fail"}], notes="Mirror")
        response = client.post("/v1/housekeeping/inspections", json=body, headers=_auth())
        assert response.status_code == 200
        assert db.rows["inspections"][0]["overall_result"] == "failed"
        assert db.rows["room_status_history"][0]["to_status"] == "DIRTY"

    def test_a_pass_without_a_checklist_is_still_rejected(self, client, db):
        response = client.post("/v1/housekeeping/inspections", json=_inspection(CLEAN_ROOM, items=[]), headers=_auth())
        assert response.status_code == 422
        assert db.rows["inspections"] == []

    def test_a_housekeeper_cannot_inspect(self, client, db):
        response = client.post("/v1/housekeeping/inspections", json=_inspection(CLEAN_ROOM), headers=_auth(role="housekeeper"))
        assert response.status_code == 403
        assert db.rows["inspections"] == []
