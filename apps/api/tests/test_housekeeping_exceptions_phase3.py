"""Phase 3 server contract for the mobile My Rooms exceptions workflow.

Pre-entry service attempts (idempotent, assignment-gated, tenant-scoped),
correction-only reclean sessions seeded from the failed inspection, and the
structured reclean details + hotel timezone the dashboard reads.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from dateutil import tz as dateutil_tz
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import clean_sessions as clean_sessions_router
from routers import cleaning_checklists as checklists_router
from routers import housekeeping as housekeeping_router
from routers import rooms as rooms_router
from services import room_status_transitions as transitions
from tests.smoke.fake_supabase import FakeDB

HOTEL = "hotel-a"
OTHER_HOTEL = "hotel-b"
ROOM = str(uuid.uuid4())
OTHER_ROOM = str(uuid.uuid4())
FOREIGN_ROOM = str(uuid.uuid4())


def _auth(role="housekeeper", hotel_id=HOTEL, user_id="hk-1"):
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _today():
    return datetime.now(dateutil_tz.gettz("America/Chicago")).date().isoformat()


def _stamp(minutes_ago=5):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()


def _room_status(room_id, tenant=HOTEL, **overrides):
    row = {
        "room_id": room_id, "tenant_id": tenant, "status": "PICKUP", "clean_type": "FULL",
        "fo_status": "OCC", "dnd_flag": False, "do_not_service": False, "assigned_to": "hk-1",
        "dnd_attempt_count": 0,
    }
    row.update(overrides)
    return row


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB({
        "tenants": [{"id": HOTEL, "timezone": "America/New_York"}],
        "rooms": [
            {"id": ROOM, "tenant_id": HOTEL, "room_number": "314", "floor": 3},
            {"id": OTHER_ROOM, "tenant_id": HOTEL, "room_number": "315", "floor": 3},
            {"id": FOREIGN_ROOM, "tenant_id": OTHER_HOTEL, "room_number": "900", "floor": 9},
        ],
        "room_status": [
            _room_status(ROOM),
            _room_status(OTHER_ROOM, assigned_to="hk-2"),
            _room_status(FOREIGN_ROOM, tenant=OTHER_HOTEL),
        ],
        "room_assignments": [
            {"id": "a1", "tenant_id": HOTEL, "room_id": ROOM, "assigned_to": "hk-1", "assignment_date": _today(), "clean_type": "FULL"},
            {"id": "a2", "tenant_id": HOTEL, "room_id": OTHER_ROOM, "assigned_to": "hk-2", "assignment_date": _today(), "clean_type": "FULL"},
        ],
        "room_service_attempts": [],
        "cleaning_checklist_templates": [
            {"id": "tpl-FULL", "tenant_id": HOTEL, "clean_type": "FULL", "name": "FULL", "is_active": True},
        ],
        "cleaning_checklist_items": [
            {"id": "t1", "tenant_id": HOTEL, "template_id": "tpl-FULL", "section": "Bedroom", "label": "Change linens", "is_required": True, "sort_order": 1},
            {"id": "t2", "tenant_id": HOTEL, "template_id": "tpl-FULL", "section": "General", "label": "Empty trash", "is_required": False, "sort_order": 2},
        ],
    })
    for module in (rooms_router, clean_sessions_router, checklists_router, transitions, housekeeping_router):
        monkeypatch.setattr(module, "supabase", fake)
    monkeypatch.setattr(rooms_router, "_record_audit_event", lambda **kwargs: None)
    monkeypatch.setattr(rooms_router, "_log_room_activity", lambda *args, **kwargs: None)
    return fake


@pytest.fixture
def client(db):
    return TestClient(app)


def _attempts(db):
    return db.rows["room_service_attempts"]


def _status(db, room_id=ROOM):
    return next(row for row in db.rows["room_status"] if row["room_id"] == room_id)


class TestServiceAttempts:
    def test_records_a_pre_entry_attempt_without_any_clean_session(self, client, db):
        at = _stamp()
        response = client.post(
            f"/v1/rooms/{ROOM}/service-attempts",
            json={"result": "dnd_no_response", "attempted_at": at},
            headers=_auth(),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["replayed"] is False
        assert body["room"]["dnd_attempt_count"] == 1
        assert body["room"]["dnd_flag"] is True
        assert len(_attempts(db)) == 1
        assert db.rows.get("room_clean_sessions", []) == []
        assert _status(db)["dnd_attempt_count"] == 1

    def test_a_retried_request_is_a_replay_and_does_not_double_count(self, client, db):
        payload = {"result": "dnd_no_response", "attempted_at": _stamp()}
        first = client.post(f"/v1/rooms/{ROOM}/service-attempts", json=payload, headers=_auth())
        second = client.post(f"/v1/rooms/{ROOM}/service-attempts", json=payload, headers=_auth())
        assert first.status_code == second.status_code == 200
        assert second.json()["replayed"] is True
        assert second.json()["room"]["dnd_attempt_count"] == 1
        assert len(_attempts(db)) == 1
        assert _status(db)["dnd_attempt_count"] == 1

    def test_distinct_attempts_each_count(self, client, db):
        for minutes in (30, 10):
            client.post(
                f"/v1/rooms/{ROOM}/service-attempts",
                json={"result": "dnd_no_response", "attempted_at": _stamp(minutes)},
                headers=_auth(),
            )
        assert _status(db)["dnd_attempt_count"] == 2
        assert len(_attempts(db)) == 2

    def test_return_later_stores_the_retry_without_setting_dnd(self, client, db):
        retry = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        response = client.post(
            f"/v1/rooms/{ROOM}/service-attempts",
            json={"result": "return_later", "attempted_at": _stamp(), "return_at": retry},
            headers=_auth(),
        )
        assert response.status_code == 200
        assert response.json()["room"]["dnd_flag"] is False
        assert response.json()["room"]["dnd_retry_at"] == retry
        assert _status(db)["dnd_retry_at"] == retry

    def test_return_later_requires_a_retry_time(self, client):
        response = client.post(
            f"/v1/rooms/{ROOM}/service-attempts",
            json={"result": "return_later", "attempted_at": _stamp()},
            headers=_auth(),
        )
        assert response.status_code == 422

    def test_guest_answered_clears_dnd_and_retry(self, client, db):
        _status(db).update({"dnd_flag": True, "dnd_retry_at": _stamp()})
        response = client.post(
            f"/v1/rooms/{ROOM}/service-attempts",
            json={"result": "guest_answered", "attempted_at": _stamp()},
            headers=_auth(),
        )
        assert response.status_code == 200
        assert _status(db)["dnd_flag"] is False
        assert _status(db)["dnd_retry_at"] is None

    def test_a_future_attempt_time_is_clamped_to_now(self, client, db):
        future = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
        client.post(
            f"/v1/rooms/{ROOM}/service-attempts",
            json={"result": "dnd_no_response", "attempted_at": future},
            headers=_auth(),
        )
        recorded = datetime.fromisoformat(_attempts(db)[0]["attempted_at"])
        assert recorded <= datetime.now(timezone.utc) + timedelta(seconds=5)

    def test_a_housekeeper_cannot_log_attempts_on_someone_elses_room(self, client, db):
        response = client.post(
            f"/v1/rooms/{OTHER_ROOM}/service-attempts",
            json={"result": "dnd_no_response", "attempted_at": _stamp()},
            headers=_auth(),
        )
        assert response.status_code == 403
        assert _attempts(db) == []
        assert _status(db, OTHER_ROOM)["dnd_attempt_count"] == 0

    def test_supervisors_are_not_assignment_bound(self, client, db):
        response = client.post(
            f"/v1/rooms/{OTHER_ROOM}/service-attempts",
            json={"result": "dnd_no_response", "attempted_at": _stamp()},
            headers=_auth(role="housekeeping_supervisor", user_id="sup-1"),
        )
        assert response.status_code == 200

    def test_another_hotels_room_is_not_found(self, client, db):
        response = client.post(
            f"/v1/rooms/{FOREIGN_ROOM}/service-attempts",
            json={"result": "dnd_no_response", "attempted_at": _stamp()},
            headers=_auth(),
        )
        assert response.status_code == 404
        assert _attempts(db) == []

    def test_tenant_a_cannot_read_tenant_bs_attempt_history(self, client, db):
        db.rows["room_service_attempts"].append(
            {"id": "x", "tenant_id": OTHER_HOTEL, "room_id": FOREIGN_ROOM, "result": "dnd_no_response", "attempted_at": _stamp()}
        )
        response = client.get(f"/v1/rooms/{FOREIGN_ROOM}/service-attempts", headers=_auth())
        assert response.status_code == 200
        assert response.json()["data"] == []

    def test_roles_outside_housekeeping_cannot_record_attempts(self, client):
        # Unauthenticated access is covered by the app-wide auth tests (and shares an
        # anonymous rate-limit bucket across files), so assert the role gate here.
        payload = {"result": "dnd_no_response", "attempted_at": _stamp()}
        response = client.post(f"/v1/rooms/{ROOM}/service-attempts", json=payload, headers=_auth(role="front_desk"))
        assert response.status_code == 403


def _seed_failed_inspection(db, room_id=ROOM):
    db.rows["inspections"] = [
        {"id": "insp-old", "tenant_id": HOTEL, "room_id": room_id, "overall_result": "failed", "completed_at": "2026-10-06T10:00:00+00:00", "notes": "Old"},
        {"id": "insp-1", "tenant_id": HOTEL, "room_id": room_id, "overall_result": "failed", "completed_at": "2026-10-08T14:00:00+00:00", "notes": "Needs another pass"},
    ]
    db.rows["inspection_results"] = [
        {"tenant_id": HOTEL, "inspection_id": "insp-1", "template_item_id": "ti-1", "result": "fail", "note": "Missing shampoo and conditioner"},
        {"tenant_id": HOTEL, "inspection_id": "insp-1", "template_item_id": "ti-2", "result": "fail", "note": "Visible streaks remain"},
        {"tenant_id": HOTEL, "inspection_id": "insp-1", "template_item_id": "ti-3", "result": "pass", "note": None},
        {"tenant_id": HOTEL, "inspection_id": "insp-old", "template_item_id": "ti-9", "result": "fail", "note": "Old problem"},
    ]
    db.rows["inspection_template_items"] = [
        {"id": "ti-1", "description": "Restock bathroom amenities"},
        {"id": "ti-2", "description": "Clean bathroom mirror"},
        {"id": "ti-3", "description": "Bed made"},
        {"id": "ti-9", "description": "Old item"},
    ]


class TestRecleanSession:
    def _start(self, client, room_id=ROOM):
        return client.post(
            "/v1/clean-sessions",
            json={"id": str(uuid.uuid4()), "room_id": room_id, "started_at": datetime.now(timezone.utc).isoformat(), "entry_acknowledged": True},
            headers=_auth(),
        )

    def test_a_reclean_session_is_a_correction_only_checklist(self, client, db):
        _status(db).update({"status": "DIRTY", "fo_status": "VAC", "actual_checkout_at": _stamp(120), "reclean_requested_at": _stamp(30)})
        _seed_failed_inspection(db)
        response = self._start(client)
        assert response.status_code == 200
        checklist = response.json()["data"]["checklist"]
        assert [item["label"] for item in checklist] == ["Restock bathroom amenities", "Clean bathroom mirror"]
        assert all(item["is_required"] and not item["checked"] and item["section"] == "Corrections" for item in checklist)

    def test_an_ordinary_clean_still_uses_the_hotel_template(self, client, db):
        _status(db).update({"status": "DIRTY", "fo_status": "VAC", "actual_checkout_at": _stamp(120)})
        _seed_failed_inspection(db)  # history exists, but no reclean is requested
        checklist = self._start(client).json()["data"]["checklist"]
        assert [item["label"] for item in checklist] == ["Change linens", "Empty trash"]

    def test_a_reclean_cannot_be_submitted_until_every_correction_is_ticked(self, client, db):
        _status(db).update({"status": "DIRTY", "fo_status": "VAC", "actual_checkout_at": _stamp(120), "reclean_requested_at": _stamp(30)})
        _seed_failed_inspection(db)
        session = self._start(client).json()["data"]
        response = client.post(
            f"/v1/clean-sessions/{session['id']}/complete",
            json={"ended_at": datetime.now(timezone.utc).isoformat(), "checklist": []},
            headers=_auth(),
        )
        assert response.status_code == 422

    def test_a_reclean_without_recoverable_corrections_falls_back_to_the_template(self, client, db):
        _status(db).update({"status": "DIRTY", "fo_status": "VAC", "actual_checkout_at": _stamp(120), "reclean_requested_at": _stamp(30)})
        checklist = self._start(client).json()["data"]["checklist"]
        assert [item["label"] for item in checklist] == ["Change linens", "Empty trash"]

    def test_inspection_history_is_not_modified(self, client, db):
        _status(db).update({"status": "DIRTY", "fo_status": "VAC", "actual_checkout_at": _stamp(120), "reclean_requested_at": _stamp(30)})
        _seed_failed_inspection(db)
        before = [dict(row) for row in db.rows["inspections"]] + [dict(row) for row in db.rows["inspection_results"]]
        self._start(client)
        after = [dict(row) for row in db.rows["inspections"]] + [dict(row) for row in db.rows["inspection_results"]]
        assert before == after


class TestMyRoomsPayload:
    def test_returns_structured_corrections_and_the_hotel_timezone(self, client, db):
        _status(db).update({"status": "DIRTY", "fo_status": "VAC", "reclean_requested_at": _stamp(30)})
        _seed_failed_inspection(db)
        for row in db.rows["room_status"]:
            row["rooms"] = {"id": row["room_id"], "room_number": "314", "floor": 3, "room_types": None}
        response = client.get(f"/v1/housekeeping/my-rooms?date={_today()}", headers=_auth())
        assert response.status_code == 200
        body = response.json()
        assert body["meta"]["timezone"] == "America/New_York"
        room = body["data"][0]
        assert room["reclean_corrections"] == ["Restock bathroom amenities", "Clean bathroom mirror"]
        details = room["reclean_details"]
        assert details["inspection_id"] == "insp-1"
        assert details["inspected_at"] == "2026-10-08T14:00:00+00:00"
        assert details["notes"] == "Needs another pass"
        assert details["items"] == [
            {"id": "ti-1", "label": "Restock bathroom amenities", "note": "Missing shampoo and conditioner"},
            {"id": "ti-2", "label": "Clean bathroom mirror", "note": "Visible streaks remain"},
        ]

    def test_falls_back_to_the_default_timezone_when_none_is_configured(self, client, db):
        db.rows["tenants"] = [{"id": HOTEL, "timezone": None}]
        for row in db.rows["room_status"]:
            row["rooms"] = {"id": row["room_id"], "room_number": "314", "floor": 3, "room_types": None}
        body = client.get(f"/v1/housekeeping/my-rooms?date={_today()}", headers=_auth()).json()
        assert body["meta"]["timezone"] == "America/Chicago"


class TestEntryRestrictionsAreServerEnforced:
    """Restrictions are re-validated on the server, not only hidden in the app."""

    def _start(self, client, ack=True):
        return client.post(
            "/v1/clean-sessions",
            json={"id": str(uuid.uuid4()), "room_id": ROOM, "started_at": datetime.now(timezone.utc).isoformat(), "entry_acknowledged": ack},
            headers=_auth(),
        )

    def test_dnd_blocks_start_even_when_the_knock_was_acknowledged(self, client, db):
        _status(db).update({"dnd_flag": True})
        response = self._start(client)
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "DND_ACTIVE"

    def test_a_declined_service_blocks_start_for_the_stay(self, client, db):
        _status(db).update({"do_not_service": True, "status": "DIRTY", "clean_type": "DEP", "fo_status": "OCC", "actual_checkout_at": None})
        response = self._start(client)
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "SERVICE_DECLINED"

    def test_a_verified_checkout_ends_the_decline(self, client, db):
        _status(db).update(
            {"do_not_service": True, "status": "DIRTY", "clean_type": "DEP", "fo_status": "VAC", "actual_checkout_at": _stamp(60)}
        )
        assert self._start(client).status_code == 200

    def test_an_unverified_departure_still_needs_the_knock_acknowledgement(self, client, db):
        _status(db).update({"status": "DIRTY", "clean_type": "DEP", "fo_status": "OCC", "actual_checkout_at": None})
        response = self._start(client, ack=False)
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "ENTRY_PROTOCOL_REQUIRED"
        assert self._start(client, ack=True).status_code == 200
