from datetime import date
from types import SimpleNamespace

import pytest

from middleware.auth import CurrentUser
from routers import housekeeping


SUPERVISOR = CurrentUser(
    user_id="11111111-1111-4111-8111-111111111111",
    hotel_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role="housekeeping_supervisor",
    email="sup@example.com",
)

TODAY = date.today().isoformat()


class FakeDB:
    def __init__(self, rows=None):
        self.rows = rows or {}

    def table(self, name):
        return FakeQuery(self, name)


class FakeQuery:
    def __init__(self, db, table_name):
        self.db = db
        self.table_name = table_name
        self.action = "select"
        self.filters = []
        self.in_filters = []

    def select(self, *_args, **_kwargs):
        self.action = "select"
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def in_(self, column, values):
        self.in_filters.append((column, set(values)))
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def execute(self):
        rows = self.db.rows.setdefault(self.table_name, [])
        matched = self._matched(rows)
        return SimpleNamespace(data=matched)

    def _matched(self, rows):
        matched = rows
        for column, value in self.filters:
            matched = [row for row in matched if row.get(column) == value]
        for column, values in self.in_filters:
            matched = [row for row in matched if row.get(column) in values]
        return matched


def _room_status_row(room_id, room_number, base_clean_minutes=30, vip_flag=False):
    return {
        "room_id": room_id,
        "tenant_id": SUPERVISOR.hotel_id,
        "status": "DIRTY",
        "vip_flag": vip_flag,
        "checkin_time": None,
        "rooms": {
            "id": room_id,
            "room_number": room_number,
            "floor": 1,
            "building": "A",
            "room_types": {
                "name": "Standard",
                "code": "STD",
                "base_clean_minutes": base_clean_minutes,
            },
        },
    }


@pytest.mark.asyncio
async def test_suggest_assignments_returns_suggestions_with_room_counts(monkeypatch):
    room_ids = [
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
    ]
    housekeeper_ids = [
        "55555555-5555-4555-8555-555555555555",
        "66666666-6666-4666-8666-666666666666",
    ]
    db = FakeDB({
        "room_status": [
            _room_status_row(room_ids[0], "101"),
            _room_status_row(room_ids[1], "102"),
            _room_status_row(room_ids[2], "103"),
        ],
        "shift_assignments": [
            {
                "tenant_id": SUPERVISOR.hotel_id,
                "work_date": TODAY,
                "user_id": housekeeper_ids[0],
            },
            {
                "tenant_id": SUPERVISOR.hotel_id,
                "work_date": TODAY,
                "user_id": housekeeper_ids[1],
            },
        ],
    })
    monkeypatch.setattr(housekeeping, "supabase", db)

    response = await housekeeping.suggest_assignments(
        board_date=None, shift_id=None, current_user=SUPERVISOR
    )

    suggestions = response["data"]["suggestions"]
    assert len(suggestions) > 0
    for suggestion in suggestions:
        assert "housekeeper" in suggestion
        assert "rooms" in suggestion
        assert "room_count" in suggestion
        assert "total_minutes" in suggestion
    assert sum(s["room_count"] for s in suggestions) == len(room_ids)


@pytest.mark.asyncio
async def test_suggest_assignments_empty_board_returns_no_rooms_message(monkeypatch):
    db = FakeDB({
        "room_status": [],
    })
    monkeypatch.setattr(housekeeping, "supabase", db)

    response = await housekeeping.suggest_assignments(
        board_date=None, shift_id=None, current_user=SUPERVISOR
    )

    assert response == {
        "data": {
            "suggestions": [],
            "message": "No rooms currently need assignment",
        }
    }


@pytest.mark.asyncio
async def test_suggest_assignments_no_staff_returns_no_housekeepers_message(monkeypatch):
    room_id = "22222222-2222-4222-8222-222222222222"
    db = FakeDB({
        "room_status": [_room_status_row(room_id, "101")],
        "shift_assignments": [],
        "user_roles": [],
    })
    monkeypatch.setattr(housekeeping, "supabase", db)

    response = await housekeeping.suggest_assignments(
        board_date=None, shift_id=None, current_user=SUPERVISOR
    )

    assert response == {
        "data": {
            "suggestions": [],
            "message": "No active housekeepers found for this property",
        }
    }
