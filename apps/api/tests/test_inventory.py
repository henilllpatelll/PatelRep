"""Engineering spare-parts inventory (migration 102): items, locations,
stock, and the add/remove/count/transfer transaction verbs.
"""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser, require_role
from models.requests import (
    CreateEngineeringPartLocationRequest,
    CreateEngineeringPartRequest,
    CreateEngineeringPartTransactionRequest,
    UpdateEngineeringPartRequest,
)
from routers import inventory as inventory_router
from services import inventory as inventory_service

MANAGER = CurrentUser(user_id="eng-1", hotel_id="hotel-1", role="engineer", email="eng@example.com")


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


def _patch(monkeypatch, db):
    monkeypatch.setattr(inventory_router, "supabase", db)
    monkeypatch.setattr(inventory_service, "supabase", db)


# ---------------------------------------------------------------------------
# Parts / locations CRUD
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_part_sets_tenant_id(monkeypatch):
    db = FakeDB()
    _patch(monkeypatch, db)

    response = await inventory_router.create_part(
        CreateEngineeringPartRequest(name="HVAC Filter 20x20", minimum_stock=5, maximum_stock=50),
        MANAGER,
    )

    assert response["data"]["tenant_id"] == "hotel-1"
    assert response["data"]["name"] == "HVAC Filter 20x20"


@pytest.mark.asyncio
async def test_create_part_persists_unit_cost(monkeypatch):
    db = FakeDB()
    _patch(monkeypatch, db)

    response = await inventory_router.create_part(
        CreateEngineeringPartRequest(name="Belt", unit_cost=14.99), MANAGER
    )

    assert response["data"]["unit_cost"] == 14.99


@pytest.mark.asyncio
async def test_update_part_sets_unit_cost(monkeypatch):
    db = FakeDB({
        "engineering_parts": [
            {"id": "part-1", "tenant_id": "hotel-1", "name": "Belt", "minimum_stock": 0, "unit_cost": None}
        ]
    })
    _patch(monkeypatch, db)

    await inventory_router.update_part(
        "part-1", UpdateEngineeringPartRequest(unit_cost=9.5), MANAGER
    )

    assert db.rows["engineering_parts"][0]["unit_cost"] == 9.5


@pytest.mark.asyncio
async def test_create_location_validates_parent_tenant(monkeypatch):
    db = FakeDB({"engineering_part_locations": [{"id": "loc-other", "tenant_id": "hotel-2", "name": "Other"}]})
    _patch(monkeypatch, db)

    with pytest.raises(HTTPException) as exc:
        await inventory_router.create_location(
            CreateEngineeringPartLocationRequest(name="Shelf", parent_id="loc-other"), MANAGER
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_get_part_404_for_other_tenant(monkeypatch):
    db = FakeDB({"engineering_parts": [{"id": "part-1", "tenant_id": "hotel-2", "name": "X", "minimum_stock": 0}]})
    _patch(monkeypatch, db)

    with pytest.raises(HTTPException) as exc:
        await inventory_router.get_part("part-1", MANAGER)
    assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# list_parts — total_on_hand + low_stock computed at read time
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_list_parts_flags_low_stock(monkeypatch):
    db = FakeDB({
        "engineering_parts": [
            {"id": "part-1", "tenant_id": "hotel-1", "name": "Filter", "minimum_stock": 10, "is_active": True},
            {"id": "part-2", "tenant_id": "hotel-1", "name": "Belt", "minimum_stock": 2, "is_active": True},
        ],
        "engineering_part_stock": [
            {"part_id": "part-1", "location_id": "loc-1", "tenant_id": "hotel-1", "quantity": 3},
            {"part_id": "part-2", "location_id": "loc-1", "tenant_id": "hotel-1", "quantity": 5},
        ],
    })
    _patch(monkeypatch, db)

    response = await inventory_router.list_parts(low_stock_only=False, current_user=MANAGER)
    by_id = {p["id"]: p for p in response["data"]}
    assert by_id["part-1"]["total_on_hand"] == 3
    assert by_id["part-1"]["low_stock"] is True
    assert by_id["part-2"]["low_stock"] is False

    low_only = await inventory_router.list_parts(low_stock_only=True, current_user=MANAGER)
    assert [p["id"] for p in low_only["data"]] == ["part-1"]


# ---------------------------------------------------------------------------
# Transactions — add / remove / count / transfer
# ---------------------------------------------------------------------------

def _base_db(quantity: float = 0.0) -> FakeDB:
    return FakeDB({
        "engineering_parts": [{"id": "part-1", "tenant_id": "hotel-1", "name": "Filter", "minimum_stock": 5}],
        "engineering_part_locations": [
            {"id": "loc-1", "tenant_id": "hotel-1", "name": "Shop"},
            {"id": "loc-2", "tenant_id": "hotel-1", "name": "Truck"},
        ],
        "engineering_part_stock": (
            [{"part_id": "part-1", "location_id": "loc-1", "tenant_id": "hotel-1", "quantity": quantity}]
            if quantity else []
        ),
        "engineering_part_transactions": [],
    })


@pytest.mark.asyncio
async def test_add_transaction_increases_stock_and_logs(monkeypatch):
    db = _base_db()
    _patch(monkeypatch, db)

    response = await inventory_router.create_part_transaction(
        "part-1",
        CreateEngineeringPartTransactionRequest(transaction_type="add", location_id="loc-1", quantity=10),
        MANAGER,
    )

    txn = response["data"]
    assert txn["quantity_delta"] == 10
    assert txn["resulting_quantity"] == 10
    assert db.rows["engineering_part_stock"][0]["quantity"] == 10
    assert len(db.rows["engineering_part_transactions"]) == 1


@pytest.mark.asyncio
async def test_remove_transaction_blocked_when_insufficient_stock(monkeypatch):
    db = _base_db(quantity=2)
    _patch(monkeypatch, db)

    with pytest.raises(HTTPException) as exc:
        await inventory_router.create_part_transaction(
            "part-1",
            CreateEngineeringPartTransactionRequest(transaction_type="remove", location_id="loc-1", quantity=5),
            MANAGER,
        )

    assert exc.value.status_code == 409
    assert db.rows["engineering_part_stock"][0]["quantity"] == 2  # untouched
    assert db.rows["engineering_part_transactions"] == []  # no partial log


@pytest.mark.asyncio
async def test_count_transaction_sets_absolute_quantity(monkeypatch):
    db = _base_db(quantity=7)
    _patch(monkeypatch, db)

    response = await inventory_router.create_part_transaction(
        "part-1",
        CreateEngineeringPartTransactionRequest(transaction_type="count", location_id="loc-1", quantity=4),
        MANAGER,
    )

    txn = response["data"]
    assert txn["quantity_delta"] == -3  # 4 - 7
    assert txn["resulting_quantity"] == 4
    assert db.rows["engineering_part_stock"][0]["quantity"] == 4


@pytest.mark.asyncio
async def test_transfer_moves_stock_between_locations(monkeypatch):
    db = _base_db(quantity=10)
    _patch(monkeypatch, db)

    response = await inventory_router.create_part_transaction(
        "part-1",
        CreateEngineeringPartTransactionRequest(
            transaction_type="transfer", location_id="loc-1", destination_location_id="loc-2", quantity=4
        ),
        MANAGER,
    )

    out_txn, in_txn = response["data"]
    assert out_txn["quantity_delta"] == -4
    assert in_txn["quantity_delta"] == 4
    assert out_txn["transfer_group_id"] == in_txn["transfer_group_id"]

    stock_by_location = {row["location_id"]: row["quantity"] for row in db.rows["engineering_part_stock"]}
    assert stock_by_location["loc-1"] == 6
    assert stock_by_location["loc-2"] == 4


# ---------------------------------------------------------------------------
# RBAC — only management/engineering roles can mutate
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_non_manager_role_blocked_from_mutating_endpoints():
    check = require_role(*inventory_router._MANAGER_ROLES)
    with pytest.raises(HTTPException) as exc:
        await check(
            current_user=CurrentUser(
                user_id="hk-1", hotel_id="hotel-1", role="housekeeper", email="hk@example.com"
            )
        )
    assert exc.value.status_code == 403
