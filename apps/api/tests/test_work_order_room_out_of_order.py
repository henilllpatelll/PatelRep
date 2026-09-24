"""Contract tests for the create-work-order "room can't be sold right now"
toggle: it opens a room-unavailability period (migration 108) linked to the
new work order, using the same RPC the dedicated Out-of-Order screen uses.
"""

from types import SimpleNamespace

import pytest

from middleware.auth import CurrentUser
from models.requests import CreateWorkOrderRequest
from routers import work_orders as work_orders_router
from tests.smoke.fake_supabase import FakeDB

FRONT_DESK = CurrentUser(user_id="fd-1", hotel_id="hotel-1", role="front_desk", email="fd@example.com")

ROOM_ROWS = {"rooms": [{"id": "11111111-1111-4111-8111-111111111111", "tenant_id": "hotel-1"}]}


class DBWithRpc:
    """Wraps FakeDB with a minimal `.rpc()` so work_orders.py's Out-of-Order
    call can be exercised without teaching the shared FakeDB about RPCs."""

    def __init__(self, db, rpc_data=None, raise_on_rpc=False):
        self._db = db
        self.rows = db.rows
        self.rpc_calls: list[tuple[str, dict]] = []
        self._rpc_data = rpc_data if rpc_data is not None else {"period": {"id": "period-1"}}
        self._raise_on_rpc = raise_on_rpc

    def table(self, name):
        return self._db.table(name)

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        if self._raise_on_rpc:
            raise RuntimeError("rpc unavailable")
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=self._rpc_data))


@pytest.mark.asyncio
async def test_create_work_order_marks_room_out_of_order_when_flagged(monkeypatch):
    db = DBWithRpc(FakeDB(dict(ROOM_ROWS)))
    monkeypatch.setattr(work_orders_router, "supabase", db)

    response = await work_orders_router.create_work_order(
        CreateWorkOrderRequest(
            title="No power in room",
            category="electrical",
            priority="emergency",
            room_id="11111111-1111-4111-8111-111111111111",
            mark_room_out_of_order=True,
        ),
        FRONT_DESK,
    )

    assert response["room_marked_out_of_order"] is True
    assert len(db.rpc_calls) == 1
    name, params = db.rpc_calls[0]
    assert name == "create_room_unavailability"
    assert params["p_room_id"] == "11111111-1111-4111-8111-111111111111"
    assert params["p_tenant_id"] == "hotel-1"
    assert params["p_reason_code"] == "ELECTRICAL"
    assert params["p_work_order_id"] == response["data"]["id"]
    assert params["p_created_by"] == "fd-1"


@pytest.mark.asyncio
async def test_create_work_order_unmapped_category_falls_back_to_other(monkeypatch):
    db = DBWithRpc(FakeDB(dict(ROOM_ROWS)))
    monkeypatch.setattr(work_orders_router, "supabase", db)

    await work_orders_router.create_work_order(
        CreateWorkOrderRequest(
            title="Scuffed baseboard",
            category="painting",
            priority="low",
            room_id="11111111-1111-4111-8111-111111111111",
            mark_room_out_of_order=True,
        ),
        FRONT_DESK,
    )

    _, params = db.rpc_calls[0]
    assert params["p_reason_code"] == "OTHER"


@pytest.mark.asyncio
async def test_create_work_order_without_flag_does_not_touch_room_status(monkeypatch):
    db = DBWithRpc(FakeDB(dict(ROOM_ROWS)))
    monkeypatch.setattr(work_orders_router, "supabase", db)

    response = await work_orders_router.create_work_order(
        CreateWorkOrderRequest(title="Loose cabinet handle", category="general", priority="low", room_id="11111111-1111-4111-8111-111111111111"),
        FRONT_DESK,
    )

    assert response["room_marked_out_of_order"] is False
    assert db.rpc_calls == []


@pytest.mark.asyncio
async def test_create_work_order_flag_without_room_is_a_no_op(monkeypatch):
    db = DBWithRpc(FakeDB({}))
    monkeypatch.setattr(work_orders_router, "supabase", db)

    response = await work_orders_router.create_work_order(
        CreateWorkOrderRequest(title="Lobby art damaged", category="general", priority="low", mark_room_out_of_order=True),
        FRONT_DESK,
    )

    assert response["room_marked_out_of_order"] is False
    assert db.rpc_calls == []


@pytest.mark.asyncio
async def test_create_work_order_out_of_order_rpc_failure_does_not_block_creation(monkeypatch):
    db = DBWithRpc(FakeDB(dict(ROOM_ROWS)), raise_on_rpc=True)
    monkeypatch.setattr(work_orders_router, "supabase", db)

    response = await work_orders_router.create_work_order(
        CreateWorkOrderRequest(
            title="No power in room",
            category="electrical",
            priority="emergency",
            room_id="11111111-1111-4111-8111-111111111111",
            mark_room_out_of_order=True,
        ),
        FRONT_DESK,
    )

    assert response["data"] is not None
    assert response["room_marked_out_of_order"] is False
