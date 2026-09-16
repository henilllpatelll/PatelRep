"""hourly_rate write path (GM-only, range-validated) and read gating in staff.py:
only a GM may set it, and it is never leaked to any non-GM caller's staff list.
"""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from routers import staff as staff_router

GM = CurrentUser(user_id="gm-1", hotel_id="hotel-1", role="gm", email="gm@x.com")
ENGINEER = CurrentUser(user_id="eng-1", hotel_id="hotel-1", role="engineer", email="eng@x.com")


class FakeQuery:
    def __init__(self, db, table_name):
        self.db = db
        self.table_name = table_name
        self.mode = "select"
        self.payload = None
        self.filters = []
        self.in_filters = []
        self.order_col = None

    def select(self, *_a, **_kw):
        self.mode = "select"
        return self

    def insert(self, payload):
        self.mode = "insert"
        self.payload = payload
        return self

    def update(self, payload):
        self.mode = "update"
        self.payload = payload
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def in_(self, column, values):
        self.in_filters.append((column, set(values)))
        return self

    def order(self, column, desc=False):
        self.order_col = column
        return self

    def _matched(self, rows):
        matched = rows
        for column, value in self.filters:
            matched = [r for r in matched if r.get(column) == value]
        for column, values in self.in_filters:
            matched = [r for r in matched if r.get(column) in values]
        return matched

    def execute(self):
        rows = self.db.rows.setdefault(self.table_name, [])
        if self.mode == "insert":
            payloads = self.payload if isinstance(self.payload, list) else [self.payload]
            created = []
            for p in payloads:
                new_row = dict(p)
                new_row.setdefault("id", f"{self.table_name}-{len(rows) + 1}")
                rows.append(new_row)
                created.append(new_row)
            return SimpleNamespace(data=created)
        matched = self._matched(rows)
        if self.mode == "update":
            for row in matched:
                row.update(self.payload)
            return SimpleNamespace(data=matched)
        if self.order_col:
            matched = sorted(matched, key=lambda r: r.get(self.order_col) or "")
        return SimpleNamespace(data=matched)


class FakeDB:
    def __init__(self, rows=None):
        self.rows = rows or {}
        # list_staff calls supabase.auth.admin.list_users() for email lookup;
        # email resolution is unrelated to these assertions, so return no users.
        self.auth = SimpleNamespace(
            admin=SimpleNamespace(list_users=lambda: SimpleNamespace(users=[]))
        )

    def table(self, name):
        return FakeQuery(self, name)


def _seed_staff_db(hourly_rate=None):
    return FakeDB({
        "user_roles": [
            {
                "id": "role-1",
                "user_id": "staff-1",
                "tenant_id": "hotel-1",
                "role": "engineer",
                "department_id": None,
                "is_active": True,
                "created_at": "2026-01-01T00:00:00Z",
                "custom_role_id": None,
                "hourly_rate": hourly_rate,
            }
        ],
        "user_profiles": [],
        "custom_roles": [],
    })


@pytest.mark.asyncio
async def test_update_staff_gm_can_set_hourly_rate(monkeypatch):
    db = _seed_staff_db()
    monkeypatch.setattr(staff_router, "supabase", db)

    await staff_router.update_staff("staff-1", {"hourly_rate": 22.5}, GM)

    assert db.rows["user_roles"][0]["hourly_rate"] == 22.5


@pytest.mark.asyncio
async def test_update_staff_rejects_hourly_rate_over_500(monkeypatch):
    db = _seed_staff_db()
    monkeypatch.setattr(staff_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await staff_router.update_staff("staff-1", {"hourly_rate": 501}, GM)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_update_staff_rejects_negative_hourly_rate(monkeypatch):
    db = _seed_staff_db()
    monkeypatch.setattr(staff_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await staff_router.update_staff("staff-1", {"hourly_rate": -5}, GM)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_list_staff_includes_hourly_rate_for_gm(monkeypatch):
    db = _seed_staff_db(hourly_rate=30.0)
    monkeypatch.setattr(staff_router, "supabase", db)

    response = await staff_router.list_staff(GM)

    entry = response["data"]["staff"][0]
    assert "hourly_rate" in entry
    assert entry["hourly_rate"] == 30.0


@pytest.mark.asyncio
async def test_list_staff_omits_hourly_rate_for_non_gm(monkeypatch):
    db = _seed_staff_db(hourly_rate=30.0)
    monkeypatch.setattr(staff_router, "supabase", db)

    response = await staff_router.list_staff(ENGINEER)

    entry = response["data"]["staff"][0]
    assert "hourly_rate" not in entry
