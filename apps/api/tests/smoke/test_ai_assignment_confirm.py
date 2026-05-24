from types import SimpleNamespace

import pytest

from middleware.auth import CurrentUser
from models.requests import AssignmentPreview
from routers import ai_copilot


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
        self.ilike_filters = []
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

    def ilike(self, column, pattern):
        self.ilike_filters.append((column, pattern.replace("%", "").lower()))
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def execute(self):
        rows = self.db.rows.setdefault(self.table_name, [])
        matched = self._matched(rows)

        if self.action == "select":
            return SimpleNamespace(data=matched)

        if self.action == "update":
            for row in matched:
                row.update(self.payload)
            return SimpleNamespace(data=matched)

        if self.action == "upsert":
            payload = dict(self.payload)
            rows.append(payload)
            self.db.upserts.append((self.table_name, payload, tuple(self.conflict_columns)))
            return SimpleNamespace(data=[payload])

        return SimpleNamespace(data=[])

    def _matched(self, rows):
        matched = rows
        for column, value in self.filters:
            matched = [row for row in matched if row.get(column) == value]
        for column, values in self.in_filters:
            matched = [row for row in matched if row.get(column) in values]
        for column, pattern in self.ilike_filters:
            matched = [row for row in matched if pattern in str(row.get(column, "")).lower()]
        return matched


@pytest.mark.asyncio
async def test_confirm_assignments_writes_required_assignment_fields(monkeypatch):
    room_id = "22222222-2222-4222-8222-222222222222"
    housekeeper_id = "44444444-4444-4444-8444-444444444444"
    db = FakeDB({
        "rooms": [{
            "id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "room_number": "101",
        }],
        "user_roles": [{
            "id": "role-1",
            "user_id": housekeeper_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "role": "housekeeper",
            "is_active": True,
        }],
        "room_assignments": [],
    })
    monkeypatch.setattr(ai_copilot, "supabase", db)

    response = await ai_copilot.confirm_assignments(
        [
            AssignmentPreview(
                staff_name_hint="Maria",
                staff_id=housekeeper_id,
                room_numbers=["101"],
                task_ids=[],
                clean_type="LIGHT",
            )
        ],
        current_user=SUPERVISOR,
    )

    assert response == {"data": {"assigned_count": 1}}
    table, payload, conflict_columns = db.upserts[0]
    assert table == "room_assignments"
    assert payload["room_id"] == room_id
    assert payload["assigned_to"] == housekeeper_id
    assert payload["assigned_by"] == SUPERVISOR.user_id
    assert payload["clean_type"] == "LIGHT"
    assert payload["is_ai_suggested"] is True
    assert conflict_columns == ("room_id", "assignment_date")


@pytest.mark.asyncio
async def test_confirm_assignments_resolves_staff_by_tenant_role(monkeypatch):
    room_id = "22222222-2222-4222-8222-222222222222"
    housekeeper_id = "44444444-4444-4444-8444-444444444444"
    db = FakeDB({
        "rooms": [{
            "id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "room_number": "101",
        }],
        "user_roles": [{
            "id": "role-1",
            "user_id": housekeeper_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "role": "housekeeper",
            "is_active": True,
        }],
        "user_profiles": [{
            "id": housekeeper_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "full_name": "Maria Lopez",
        }],
        "room_assignments": [],
    })
    monkeypatch.setattr(ai_copilot, "supabase", db)

    response = await ai_copilot.confirm_assignments(
        [
            AssignmentPreview(
                staff_name_hint="Maria",
                staff_id=None,
                room_numbers=["101"],
                task_ids=[],
            )
        ],
        current_user=SUPERVISOR,
    )

    assert response == {"data": {"assigned_count": 1}}
    assert db.upserts[0][1]["assigned_to"] == housekeeper_id
