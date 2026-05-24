from datetime import date
from types import SimpleNamespace

import pytest

from middleware.auth import CurrentUser
from models.requests import CreateAssignmentsRequest
from routers import housekeeping as housekeeping_router


SUPERVISOR = CurrentUser(
    user_id="11111111-1111-4111-8111-111111111111",
    hotel_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role="housekeeping_supervisor",
    email="sup@example.com",
)


class FakeDB:
    def __init__(self, rows=None):
        self.rows = rows or {}
        self.upserts = []
        self.updates = []

    def table(self, name):
        return FakeQuery(self, name)


class FakeQuery:
    def __init__(self, db, table_name):
        self.db = db
        self.table_name = table_name
        self.action = "select"
        self.payload = None
        self.filters = []
        self.in_filters = []
        self.single = False
        self.conflict_columns = []

    def select(self, *_args, **_kwargs):
        self.action = "select"
        return self

    def update(self, payload):
        self.action = "update"
        self.payload = payload
        return self

    def upsert(self, payload, on_conflict=None, **_kwargs):
        self.action = "upsert"
        self.payload = payload
        self.conflict_columns = [c.strip() for c in (on_conflict or "").split(",") if c.strip()]
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def in_(self, column, values):
        self.in_filters.append((column, set(values)))
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def maybe_single(self):
        self.single = True
        return self

    def execute(self):
        rows = self.db.rows.setdefault(self.table_name, [])
        matched = self._matched(rows)

        if self.action == "select":
            return SimpleNamespace(data=matched[0] if self.single and matched else matched)

        if self.action == "update":
            for row in matched:
                row.update(self.payload)
            self.db.updates.append((self.table_name, dict(self.payload), dict(self.filters)))
            return SimpleNamespace(data=matched)

        if self.action == "upsert":
            payload_rows = self.payload if isinstance(self.payload, list) else [self.payload]
            saved = []
            for payload in payload_rows:
                assert isinstance(payload, dict)
                existing = next(
                    (
                        row for row in rows
                        if self.conflict_columns
                        and all(row.get(column) == payload.get(column) for column in self.conflict_columns)
                    ),
                    None,
                )
                if existing:
                    existing.update(payload)
                    saved.append(existing)
                else:
                    row = {"id": f"{self.table_name}-{len(rows) + 1}", **payload}
                    rows.append(row)
                    saved.append(row)
            self.db.upserts.append((self.table_name, payload_rows, tuple(self.conflict_columns)))
            return SimpleNamespace(data=saved)

        return SimpleNamespace(data=[])

    def _matched(self, rows):
        matched = rows
        for column, value in self.filters:
            matched = [row for row in matched if row.get(column) == value]
        for column, values in self.in_filters:
            matched = [row for row in matched if row.get(column) in values]
        return matched


@pytest.mark.asyncio
async def test_board_uses_selected_date_assignments_not_stale_room_status(monkeypatch):
    room_today = "22222222-2222-4222-8222-222222222222"
    room_unassigned_today = "33333333-3333-4333-8333-333333333333"
    hk_today = "44444444-4444-4444-8444-444444444444"
    hk_yesterday = "55555555-5555-4555-8555-555555555555"
    db = FakeDB({
        "room_status": [
            {
                "room_id": room_today,
                "tenant_id": SUPERVISOR.hotel_id,
                "assigned_to": hk_yesterday,
                "status": "DIRTY",
                "rooms": {"floor": 1, "room_number": "101"},
            },
            {
                "room_id": room_unassigned_today,
                "tenant_id": SUPERVISOR.hotel_id,
                "assigned_to": hk_yesterday,
                "status": "DIRTY",
                "rooms": {"floor": 1, "room_number": "102"},
            },
        ],
        "room_assignments": [
            {
                "id": "assign-today",
                "tenant_id": SUPERVISOR.hotel_id,
                "room_id": room_today,
                "assigned_to": hk_today,
                "shift_id": None,
                "assignment_date": "2026-05-24",
                "clean_type": "LIGHT",
            },
            {
                "id": "assign-yesterday",
                "tenant_id": SUPERVISOR.hotel_id,
                "room_id": room_unassigned_today,
                "assigned_to": hk_yesterday,
                "shift_id": None,
                "assignment_date": "2026-05-23",
            },
        ],
        "room_readiness_predictions": [],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    response = await housekeeping_router.get_housekeeping_board(
        board_date=date(2026, 5, 24),
        shift_id=None,
        include_predictions=False,
        current_user=SUPERVISOR,
    )

    by_room = {row["room_id"]: row for row in response["data"]}
    assert by_room[room_today]["assigned_to"] == hk_today
    assert by_room[room_today]["assignment_id"] == "assign-today"
    assert by_room[room_today]["clean_type"] == "LIGHT"
    assert by_room[room_unassigned_today]["assigned_to"] is None
    assert by_room[room_unassigned_today]["assignment_id"] is None
    assert by_room[room_unassigned_today]["clean_type"] is None


@pytest.mark.asyncio
async def test_create_assignments_reassigns_existing_room_for_same_day(monkeypatch):
    room_id = "22222222-2222-4222-8222-222222222222"
    old_hk = "55555555-5555-4555-8555-555555555555"
    new_hk = "44444444-4444-4444-8444-444444444444"
    db = FakeDB({
        "rooms": [{"id": room_id, "tenant_id": SUPERVISOR.hotel_id, "room_number": "101"}],
        "user_roles": [{
            "id": "role-1",
            "user_id": new_hk,
            "tenant_id": SUPERVISOR.hotel_id,
            "role": "housekeeper",
            "is_active": True,
        }],
        "room_assignments": [{
            "id": "assign-existing",
            "tenant_id": SUPERVISOR.hotel_id,
            "room_id": room_id,
            "assigned_to": old_hk,
            "assigned_by": "old-supervisor",
            "assignment_date": "2026-05-24",
        }],
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "assigned_to": old_hk,
        }],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    def fake_create_task(coro):
        coro.close()
        return None

    monkeypatch.setattr(housekeeping_router.asyncio, "create_task", fake_create_task)

    request = CreateAssignmentsRequest(
        date=date(2026, 5, 24),
        shift_id=None,
        assignments=[{"room_id": room_id, "housekeeper_id": new_hk, "clean_type": "FULL"}],
        is_ai_suggested=False,
    )

    response = await housekeeping_router.create_assignments(request, current_user=SUPERVISOR)

    assert response["data"][0]["id"] == "assign-existing"
    assert response["data"][0]["assigned_to"] == new_hk
    assert response["data"][0]["clean_type"] == "FULL"
    assert db.rows["room_assignments"][0]["assigned_to"] == new_hk
    assert db.rows["room_assignments"][0]["clean_type"] == "FULL"
    assert db.rows["room_assignments"][0]["assigned_by"] == SUPERVISOR.user_id
    assert db.rows["room_status"][0]["assigned_to"] == new_hk
    assert db.upserts[0][2] == ("room_id", "assignment_date")
