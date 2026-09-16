"""Completing a work order computes and persists dollar costs (Phase 38):
labor_cost from the assignee's hourly_rate, parts_cost from consumed parts'
unit_cost, and total_cost from the two — with NULL (never 0) meaning
"cost unknown". The pre-existing parts stock decrement is unaffected.
"""
from types import SimpleNamespace

import pytest

from middleware.auth import CurrentUser
from models.requests import CompleteWorkOrderRequest, ConsumedPartItem
from routers import work_orders as work_orders_router
from services import inventory as inventory_service

ENGINEER = CurrentUser(user_id="engineer-1", hotel_id="hotel-1", role="engineer", email="e@x.com")


class FakeQuery:
    def __init__(self, db, table_name):
        self.db = db
        self.table_name = table_name
        self.mode = "select"
        self.payload = None
        self.on_conflict = None
        self.filters = []
        self.in_filters = []
        self.order_col = None
        self.limit_n = None
        self.single = False

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

    def upsert(self, payload, on_conflict=None):
        self.mode = "upsert"
        self.payload = payload
        self.on_conflict = on_conflict
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

    def limit(self, n):
        self.limit_n = n
        return self

    def maybe_single(self):
        self.single = True
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
        if self.mode == "upsert":
            key_cols = (self.on_conflict or "").split(",")
            existing = next(
                (r for r in rows if all(r.get(k) == self.payload.get(k) for k in key_cols)), None
            )
            if existing is not None:
                existing.update(self.payload)
                return SimpleNamespace(data=[existing])
            new_row = dict(self.payload)
            new_row.setdefault("id", f"{self.table_name}-{len(rows) + 1}")
            rows.append(new_row)
            return SimpleNamespace(data=[new_row])
        matched = self._matched(rows)
        if self.mode == "update":
            for row in matched:
                row.update(self.payload)
            return SimpleNamespace(data=matched)
        if self.order_col:
            matched = sorted(matched, key=lambda r: r.get(self.order_col) or "")
        if self.limit_n is not None:
            matched = matched[: self.limit_n]
        if self.single:
            return SimpleNamespace(data=matched[0] if matched else None)
        return SimpleNamespace(data=matched)


class FakeDB:
    def __init__(self, rows=None):
        self.rows = rows or {}

    def table(self, name):
        return FakeQuery(self, name)

    def rpc(self, function_name, payload):
        wo = self.rows["work_orders"][0]
        wo["status"] = payload["p_new_status"]
        result = SimpleNamespace(data=[wo])
        return SimpleNamespace(execute=lambda: result)


def _patch(monkeypatch, db):
    monkeypatch.setattr(work_orders_router, "supabase", db)
    monkeypatch.setattr(inventory_service, "supabase", db)


def _base_rows(**extra):
    rows = {
        "work_orders": [
            {"id": "wo-1", "tenant_id": "hotel-1", "assigned_to": "engineer-1", "status": "in_progress"}
        ],
    }
    rows.update(extra)
    return rows


# ---------------------------------------------------------------------------
# Labor cost
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_complete_work_order_computes_labor_cost_from_assignee_rate(monkeypatch):
    db = FakeDB(_base_rows(
        user_roles=[{"user_id": "engineer-1", "tenant_id": "hotel-1", "role": "engineer",
                     "is_active": True, "hourly_rate": 25.0}],
    ))
    _patch(monkeypatch, db)

    response = await work_orders_router.complete_work_order(
        "wo-1", CompleteWorkOrderRequest(labor_hours=2.0), ENGINEER
    )

    assert response["data"]["labor_cost"] == 50.0
    assert response["data"]["total_cost"] == 50.0
    assert response["data"]["parts_cost"] is None


@pytest.mark.asyncio
async def test_complete_work_order_labor_cost_null_when_no_rate_on_file(monkeypatch):
    db = FakeDB(_base_rows(user_roles=[]))
    _patch(monkeypatch, db)

    response = await work_orders_router.complete_work_order(
        "wo-1", CompleteWorkOrderRequest(labor_hours=2.0), ENGINEER
    )

    assert response["data"]["labor_cost"] is None
    assert response["data"]["total_cost"] is None


@pytest.mark.asyncio
async def test_complete_work_order_labor_cost_falls_back_to_completing_user(monkeypatch):
    # An unassigned WO can only be completed by a gm; labor_cost must then fall
    # back to the completing user's rate since assigned_to is NULL.
    gm = CurrentUser(user_id="gm-1", hotel_id="hotel-1", role="gm", email="gm@x.com")
    db = FakeDB({
        "work_orders": [
            {"id": "wo-1", "tenant_id": "hotel-1", "assigned_to": None, "status": "in_progress"}
        ],
        "user_roles": [{"user_id": "gm-1", "tenant_id": "hotel-1", "role": "gm",
                        "is_active": True, "hourly_rate": 30.0}],
    })
    _patch(monkeypatch, db)

    response = await work_orders_router.complete_work_order(
        "wo-1", CompleteWorkOrderRequest(labor_hours=2.0), gm
    )

    assert response["data"]["labor_cost"] == 60.0


# ---------------------------------------------------------------------------
# Parts cost
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_complete_work_order_computes_parts_cost_from_unit_cost(monkeypatch):
    db = FakeDB(_base_rows(
        engineering_parts=[{"id": "part-1", "tenant_id": "hotel-1", "unit_cost": 12.5}],
        engineering_part_stock=[
            {"part_id": "part-1", "location_id": "loc-1", "tenant_id": "hotel-1", "quantity": 10}
        ],
        engineering_part_transactions=[],
    ))
    _patch(monkeypatch, db)

    response = await work_orders_router.complete_work_order(
        "wo-1",
        CompleteWorkOrderRequest(
            parts_consumed=[ConsumedPartItem(part_id="part-1", location_id="loc-1", quantity=3)]
        ),
        ENGINEER,
    )

    assert response["data"]["parts_cost"] == 37.5
    assert response["data"]["total_cost"] == 37.5
    assert response["data"]["labor_cost"] is None
    # Pre-existing behavior: stock decremented.
    assert db.rows["engineering_part_stock"][0]["quantity"] == 7


@pytest.mark.asyncio
async def test_complete_work_order_parts_cost_treats_unknown_unit_cost_as_zero(monkeypatch):
    db = FakeDB(_base_rows(
        engineering_parts=[{"id": "part-1", "tenant_id": "hotel-1", "unit_cost": None}],
        engineering_part_stock=[
            {"part_id": "part-1", "location_id": "loc-1", "tenant_id": "hotel-1", "quantity": 10}
        ],
        engineering_part_transactions=[],
    ))
    _patch(monkeypatch, db)

    response = await work_orders_router.complete_work_order(
        "wo-1",
        CompleteWorkOrderRequest(
            parts_consumed=[ConsumedPartItem(part_id="part-1", location_id="loc-1", quantity=3)]
        ),
        ENGINEER,
    )

    assert response["data"]["parts_cost"] == 0.0
    assert response["data"]["total_cost"] == 0.0
    # Pre-existing behavior: stock still decremented, completion succeeded.
    assert response["data"]["status"] == "completed"
    assert db.rows["engineering_part_stock"][0]["quantity"] == 7


# ---------------------------------------------------------------------------
# Total cost
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_complete_work_order_total_cost_null_when_both_unknown(monkeypatch):
    db = FakeDB(_base_rows())
    _patch(monkeypatch, db)

    response = await work_orders_router.complete_work_order(
        "wo-1", CompleteWorkOrderRequest(notes="No cost data"), ENGINEER
    )

    assert response["data"]["labor_cost"] is None
    assert response["data"]["parts_cost"] is None
    assert response["data"]["total_cost"] is None


@pytest.mark.asyncio
async def test_complete_work_order_total_cost_sums_both_when_present(monkeypatch):
    db = FakeDB(_base_rows(
        user_roles=[{"user_id": "engineer-1", "tenant_id": "hotel-1", "role": "engineer",
                     "is_active": True, "hourly_rate": 20.0}],
        engineering_parts=[{"id": "part-1", "tenant_id": "hotel-1", "unit_cost": 5.0}],
        engineering_part_stock=[
            {"part_id": "part-1", "location_id": "loc-1", "tenant_id": "hotel-1", "quantity": 10}
        ],
        engineering_part_transactions=[],
    ))
    _patch(monkeypatch, db)

    response = await work_orders_router.complete_work_order(
        "wo-1",
        CompleteWorkOrderRequest(
            labor_hours=2.0,
            parts_consumed=[ConsumedPartItem(part_id="part-1", location_id="loc-1", quantity=3)],
        ),
        ENGINEER,
    )

    labor_cost = response["data"]["labor_cost"]
    parts_cost = response["data"]["parts_cost"]
    assert labor_cost == 40.0
    assert parts_cost == 15.0
    assert response["data"]["total_cost"] == labor_cost + parts_cost
