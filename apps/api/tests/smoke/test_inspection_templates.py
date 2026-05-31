from types import SimpleNamespace

import pytest

from middleware.auth import CurrentUser
from routers import housekeeping as housekeeping_router


SUPERVISOR = CurrentUser(
    user_id="sup-1",
    hotel_id="hotel-a",
    role="housekeeping_supervisor",
    email="sup@example.com",
)


class FakeDB:
    def __init__(self, rows=None):
        self.rows = rows or {}
        self.inserts = []

    def table(self, name):
        return FakeQuery(self, name)


class FakeQuery:
    def __init__(self, db, table_name):
        self.db = db
        self.table_name = table_name
        self.action = "select"
        self.payload = None
        self.filters = {}
        self.order_column = None
        self.order_desc = False

    def select(self, *_args, **_kwargs):
        self.action = "select"
        return self

    def insert(self, payload):
        self.action = "insert"
        self.payload = payload
        return self

    def eq(self, column, value):
        self.filters[column] = value
        return self

    def order(self, column, desc=False, **_kwargs):
        self.order_column = column
        self.order_desc = desc
        return self

    def execute(self):
        rows = self.db.rows.setdefault(self.table_name, [])
        matched = [
            row
            for row in rows
            if all(row.get(column) == value for column, value in self.filters.items())
        ]
        if self.order_column:
            matched = sorted(
                matched,
                key=lambda row: row.get(self.order_column) or "",
                reverse=self.order_desc,
            )

        if self.action == "select":
            return SimpleNamespace(data=matched)

        if self.action == "insert":
            payload_rows = self.payload if isinstance(self.payload, list) else [self.payload]
            saved = []
            for payload in payload_rows:
                assert isinstance(payload, dict)
                row = {
                    "id": payload.get("id") or f"{self.table_name}-{len(rows) + 1}",
                    **payload,
                }
                rows.append(row)
                self.db.inserts.append((self.table_name, row))
                saved.append(row)
            return SimpleNamespace(data=saved)

        return SimpleNamespace(data=[])


@pytest.mark.asyncio
async def test_list_inspection_templates_creates_persisted_default_when_missing(monkeypatch):
    db = FakeDB({"inspection_templates": [], "inspection_template_items": []})
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    response = await housekeeping_router.list_inspection_templates(SUPERVISOR)

    template = response["data"][0]
    assert template["id"]
    assert template["name"] == "Standard Room Inspection"
    assert len(template["items"]) >= 6
    assert all(item["id"] for item in template["items"])
    assert any(table == "inspection_templates" for table, _row in db.inserts)
    assert sum(1 for table, _row in db.inserts if table == "inspection_template_items") >= 6


@pytest.mark.asyncio
async def test_list_inspection_templates_backfills_blank_default_template(monkeypatch):
    db = FakeDB({
        "inspection_templates": [{
            "id": "tmpl-1",
            "tenant_id": "hotel-a",
            "name": "Standard Room Inspection",
            "room_type_id": None,
            "is_default": True,
            "is_active": True,
        }],
        "inspection_template_items": [],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    response = await housekeeping_router.list_inspection_templates(SUPERVISOR)

    template = response["data"][0]
    assert template["id"] == "tmpl-1"
    assert len(template["items"]) >= 6
    assert all(item["template_id"] == "tmpl-1" for item in db.rows["inspection_template_items"])
