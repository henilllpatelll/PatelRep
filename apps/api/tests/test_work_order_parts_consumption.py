"""Closing a work order can consume engineering spare parts (migration 102):
stock decrements, a transaction is logged against the work order, and
insufficient stock blocks the completion entirely rather than completing
the WO with only some parts deducted.
"""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from models.requests import CompleteWorkOrderRequest, ConsumedPartItem
from routers import work_orders as work_orders_router
from services import inventory as inventory_service

ENGINEER = CurrentUser(user_id="engineer-1", hotel_id="hotel-1", role="engineer", email="engineer@example.com")


class _Query:
    def __init__(self, db, table_name):
        self.db = db
        self.table_name = table_name
        self.mode = "select"
        self.payload = None
        self.on_conflict = None
        self.filters = []
        self.in_filters = []
        self.single = False

    def select(self, *_a, **_kw):
        self.mode = "select"
        return self

    def update(self, payload):
        self.mode = "update"
        self.payload = payload
        return self

    def insert(self, payload):
        self.mode = "insert"
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
        rows = self.db.tables.setdefault(self.table_name, [])
        if self.mode == "insert":
            new_row = dict(self.payload)
            new_row.setdefault("id", f"{self.table_name}-{len(rows) + 1}")
            rows.append(new_row)
            return SimpleNamespace(data=[new_row])
        if self.mode == "upsert":
            key_cols = (self.on_conflict or "").split(",")
            existing = next(
                (r for r in rows if all(r.get(k) == self.payload.get(k) for k in key_cols)), None
            )
            if existing is not None:
                existing.update(self.payload)
                return SimpleNamespace(data=[existing])
            new_row = dict(self.payload)
            rows.append(new_row)
            return SimpleNamespace(data=[new_row])
        matched = self._matched(rows)
        if self.mode == "update":
            for row in matched:
                row.update(self.payload)
            return SimpleNamespace(data=matched)
        if self.single:
            return SimpleNamespace(data=matched[0] if matched else None)
        return SimpleNamespace(data=matched)


class _CompleteDatabase:
    def __init__(self, *, stock_quantity: float):
        self.tables = {
            "work_orders": [
                {"id": "wo-1", "tenant_id": "hotel-1", "assigned_to": "engineer-1", "status": "in_progress", "priority": "normal"}
            ],
            "engineering_part_stock": [
                {"part_id": "part-1", "location_id": "loc-1", "tenant_id": "hotel-1", "quantity": stock_quantity}
            ],
            "engineering_part_transactions": [],
        }
        self.rpc_calls: list[tuple[str, dict]] = []

    def table(self, name):
        return _Query(self, name)

    def rpc(self, function_name, payload):
        self.rpc_calls.append((function_name, payload))
        wo = self.tables["work_orders"][0]
        wo["status"] = payload["p_new_status"]
        result = SimpleNamespace(data=[wo])
        return SimpleNamespace(execute=lambda: result)


def _patch(monkeypatch, db):
    monkeypatch.setattr(work_orders_router, "supabase", db)
    monkeypatch.setattr(inventory_service, "supabase", db)


@pytest.mark.asyncio
async def test_complete_work_order_consumes_parts_and_decrements_stock(monkeypatch):
    db = _CompleteDatabase(stock_quantity=10)
    _patch(monkeypatch, db)

    response = await work_orders_router.complete_work_order(
        "wo-1",
        CompleteWorkOrderRequest(
            notes="Replaced filter",
            parts_consumed=[ConsumedPartItem(part_id="part-1", location_id="loc-1", quantity=3)],
        ),
        ENGINEER,
    )

    assert response["data"]["status"] == "completed"
    assert db.tables["engineering_part_stock"][0]["quantity"] == 7
    txn = db.tables["engineering_part_transactions"][0]
    assert txn["work_order_id"] == "wo-1"
    assert txn["quantity_delta"] == -3
    assert txn["resulting_quantity"] == 7


@pytest.mark.asyncio
async def test_complete_work_order_blocks_completion_on_insufficient_stock(monkeypatch):
    db = _CompleteDatabase(stock_quantity=1)
    _patch(monkeypatch, db)

    with pytest.raises(HTTPException) as exc:
        await work_orders_router.complete_work_order(
            "wo-1",
            CompleteWorkOrderRequest(
                parts_consumed=[ConsumedPartItem(part_id="part-1", location_id="loc-1", quantity=3)],
            ),
            ENGINEER,
        )

    assert exc.value.status_code == 409
    # The pre-flight check runs before the transition RPC — the WO must
    # never end up completed with only some (or none) of its parts deducted.
    assert db.rpc_calls == []
    assert db.tables["work_orders"][0]["status"] == "in_progress"
    assert db.tables["engineering_part_stock"][0]["quantity"] == 1
    assert db.tables["engineering_part_transactions"] == []


@pytest.mark.asyncio
async def test_complete_work_order_without_parts_is_unaffected(monkeypatch):
    db = _CompleteDatabase(stock_quantity=10)
    _patch(monkeypatch, db)

    response = await work_orders_router.complete_work_order(
        "wo-1", CompleteWorkOrderRequest(notes="No parts needed"), ENGINEER
    )

    assert response["data"]["status"] == "completed"
    assert db.tables["engineering_part_stock"][0]["quantity"] == 10
    assert db.tables["engineering_part_transactions"] == []
