"""GET /housekeeping/my-rooms: the fields the mobile My Rooms dashboard relies on.

The Floors tab groups by real property topology, so the endpoint must return the
room's ``building`` (never inferred from room numbers) next to the supervisor
``sequence_order`` and the rush/DND context it already carried.
"""

import uuid
from datetime import datetime

import pytest
from dateutil import tz as dateutil_tz
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import housekeeping as housekeeping_router
from tests.smoke.fake_supabase import FakeDB

HOTEL = "hotel-a"


def _auth(user_id="hk-1"):
    payload = {"sub": user_id, "role": "housekeeper", "hotel_id": HOTEL, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _today():
    return datetime.now(dateutil_tz.gettz("America/Chicago")).date().isoformat()


@pytest.fixture
def client(monkeypatch):
    east, tower, plain = (str(uuid.uuid4()) for _ in range(3))
    fake = FakeDB({
        "room_assignments": [
            {"id": "a1", "tenant_id": HOTEL, "room_id": east, "assigned_to": "hk-1", "assignment_date": _today(), "clean_type": "DEP", "sequence_order": 2},
            {"id": "a2", "tenant_id": HOTEL, "room_id": tower, "assigned_to": "hk-1", "assignment_date": _today(), "clean_type": "FULL", "sequence_order": 1},
            {"id": "a3", "tenant_id": HOTEL, "room_id": plain, "assigned_to": "hk-1", "assignment_date": _today(), "clean_type": "LIGHT", "sequence_order": None},
        ],
        "room_status": [
            {"room_id": east, "tenant_id": HOTEL, "status": "DIRTY", "fo_status": "VAC",
             "rooms": {"id": east, "room_number": "101", "floor": 1, "building": "East Wing", "room_types": {"name": "King", "code": "K", "base_clean_minutes": 30}}},
            {"room_id": tower, "tenant_id": HOTEL, "status": "DIRTY", "fo_status": "VAC",
             "rooms": {"id": tower, "room_number": "501", "floor": 5, "building": "Tower", "room_types": None}},
            {"room_id": plain, "tenant_id": HOTEL, "status": "DIRTY", "fo_status": "VAC",
             "rooms": {"id": plain, "room_number": "201", "floor": 2, "building": "", "room_types": None}},
        ],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", fake)
    for helper in ("_attach_task_sheet_clean_types", "_attach_room_activity", "_attach_reclean_corrections"):
        monkeypatch.setattr(housekeeping_router, helper, lambda rows, *args, **kwargs: rows)
    return TestClient(app)


def test_my_rooms_returns_real_building_and_keeps_supervisor_order(client):
    response = client.get(f"/v1/housekeeping/my-rooms?date={_today()}", headers=_auth())
    assert response.status_code == 200
    rows = response.json()["data"]

    by_number = {row["room_number"]: row for row in rows}
    assert by_number["101"]["building"] == "East Wing"
    assert by_number["501"]["building"] == "Tower"
    # A blank building is reported as "none", never guessed.
    assert by_number["201"]["building"] is None

    # Supervisor sequence leads; unsequenced rooms follow.
    assert [row["room_number"] for row in rows] == ["501", "101", "201"]
    assert [row["sequence_order"] for row in rows] == [1, 2, None]


def test_my_rooms_selects_the_building_column(client, monkeypatch):
    seen = []
    original = housekeeping_router.supabase.table

    def spy(name):
        query = original(name)
        if name == "room_status":
            select = query.select

            def capture(columns, *args, **kwargs):
                seen.append(columns)
                return select(columns, *args, **kwargs)

            query.select = capture
        return query

    monkeypatch.setattr(housekeeping_router.supabase, "table", spy)
    client.get(f"/v1/housekeeping/my-rooms?date={_today()}", headers=_auth())
    assert any("building" in columns for columns in seen)
