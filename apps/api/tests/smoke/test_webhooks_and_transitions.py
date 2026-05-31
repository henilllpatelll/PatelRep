from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from models.requests import ManualCheckoutRequest, UpdateRoomStatusRequest
from routers import rooms as rooms_router
from routers import webhooks as webhooks_router


HOUSEKEEPER = CurrentUser(
    user_id="hk-1",
    hotel_id="hotel-a",
    role="housekeeper",
    email="hk@example.com",
)
SUPERVISOR = CurrentUser(
    user_id="sup-1",
    hotel_id="hotel-a",
    role="housekeeping_supervisor",
    email="sup@example.com",
)
FRONT_DESK = CurrentUser(
    user_id="fd-1",
    hotel_id="hotel-a",
    role="front_desk",
    email="fd@example.com",
)


class FakeDB:
    def __init__(self, rows=None):
        self.rows = rows or {}
        self.inserts = []
        self.updates = []

    def table(self, name):
        return FakeQuery(self, name)


class FakeQuery:
    def __init__(self, db, table_name):
        self.db = db
        self.table_name = table_name
        self.action = "select"
        self.payload = {}
        self.filters = {}
        self.single = False
        self.order_column = None
        self.order_desc = False
        self.limit_count = None

    def select(self, *_args, **_kwargs):
        self.action = "select"
        return self

    def delete(self):
        self.action = "delete"
        return self

    def update(self, payload):
        self.action = "update"
        self.payload = payload
        return self

    def insert(self, payload):
        self.action = "insert"
        self.payload = payload
        return self

    def eq(self, column, value):
        self.filters[column] = value
        return self

    def lte(self, *_args, **_kwargs):
        return self

    def gte(self, *_args, **_kwargs):
        return self

    def in_(self, column, values):
        self.filters[column] = set(values)
        return self

    def maybe_single(self):
        self.single = True
        return self

    def order(self, column, desc=False):
        self.order_column = column
        self.order_desc = desc
        return self

    def limit(self, count):
        self.limit_count = count
        return self

    def execute(self):
        rows = self.db.rows.setdefault(self.table_name, [])
        matched = [
            row for row in rows
            if all(row.get(k) in v if isinstance(v, set) else row.get(k) == v for k, v in self.filters.items())
        ]
        if self.order_column:
            matched = sorted(
                matched,
                key=lambda row: row.get(self.order_column) or "",
                reverse=self.order_desc,
            )
        if self.limit_count is not None:
            matched = matched[:self.limit_count]

        if self.action == "select":
            return SimpleNamespace(data=matched[0] if self.single and matched else matched)

        if self.action == "update":
            for row in matched:
                row.update(self.payload)
            self.db.updates.append((self.table_name, dict(self.payload), dict(self.filters)))
            return SimpleNamespace(data=matched)

        if self.action == "insert":
            row = {"id": f"{self.table_name}-{len(rows) + 1}", **self.payload}
            rows.append(row)
            self.db.inserts.append((self.table_name, row))
            return SimpleNamespace(data=[row])

        if self.action == "delete":
            deleted = list(matched)
            self.db.rows[self.table_name] = [row for row in rows if row not in deleted]
            return SimpleNamespace(data=deleted)

        return SimpleNamespace(data=[])


class FakeRequest:
    def __init__(self, payload=b"{}", headers=None):
        self._payload = payload
        self.headers = headers or {}

    async def body(self):
        return self._payload


@pytest.mark.asyncio
async def test_manual_checkout_marks_departure_dirty_and_notifies_assignee(monkeypatch):
    scheduled_checkout = "2026-05-28T11:00:00+00:00"
    actual_checkout = "2026-05-28T15:20:00+00:00"
    db = FakeDB({
        "room_status": [{
            "id": "rs-1",
            "room_id": "room-1",
            "tenant_id": "hotel-a",
            "status": "OCCUPIED",
            "assigned_to": "hk-1",
            "checkout_time": scheduled_checkout,
            "guest_name": "Guest Name",
            "vip_flag": True,
            "dnd_flag": True,
        }],
        "rooms": [{
            "id": "room-1",
            "tenant_id": "hotel-a",
            "room_number": "214",
        }],
        "room_status_history": [],
        "notifications": [],
    })
    push_calls = []

    def fake_push(*args):
        push_calls.append(args)
        async def noop():
            return None
        return noop()

    monkeypatch.setattr(rooms_router, "supabase", db)
    monkeypatch.setattr(rooms_router, "_send_checkout_push", fake_push)

    response = await rooms_router.manual_checkout_room(
        "room-1",
        ManualCheckoutRequest(actual_checkout_at=actual_checkout),
        current_user=FRONT_DESK,
    )

    updated = db.rows["room_status"][0]
    assert response["data"]["status"] == "DIRTY"
    assert updated["status"] == "DIRTY"
    assert updated["fo_status"] == "VAC"
    assert updated["actual_checkout_at"] == actual_checkout
    assert updated["checkout_time"] == scheduled_checkout
    assert updated["guest_name"] is None
    assert updated["vip_flag"] is False
    assert updated["dnd_flag"] is False
    assert db.inserts[0][0] == "room_status_history"
    assert db.inserts[0][1]["from_status"] == "OCCUPIED"
    assert db.inserts[0][1]["to_status"] == "DIRTY"
    assert db.rows["notifications"][0]["user_id"] == "hk-1"
    assert db.rows["notifications"][0]["type"] == "room_checked_out"
    assert push_calls == [("hk-1", "214", "room-1")]


@pytest.mark.asyncio
async def test_manual_checkout_preserves_active_cleaning_status(monkeypatch):
    actual_checkout = "2026-05-28T15:20:00+00:00"
    db = FakeDB({
        "room_status": [{
            "id": "rs-1",
            "room_id": "room-1",
            "tenant_id": "hotel-a",
            "status": "IN_PROGRESS",
            "assigned_to": "hk-1",
            "checkout_time": "2026-05-28T11:00:00+00:00",
        }],
        "rooms": [{
            "id": "room-1",
            "tenant_id": "hotel-a",
            "room_number": "214",
        }],
        "room_status_history": [],
        "notifications": [],
    })
    push_calls = []

    def fake_push(*args):
        push_calls.append(args)
        async def noop():
            return None
        return noop()

    monkeypatch.setattr(rooms_router, "supabase", db)
    monkeypatch.setattr(rooms_router, "_send_checkout_push", fake_push)

    response = await rooms_router.manual_checkout_room(
        "room-1",
        ManualCheckoutRequest(actual_checkout_at=actual_checkout),
        current_user=FRONT_DESK,
    )

    updated = db.rows["room_status"][0]
    assert response["data"]["status"] == "IN_PROGRESS"
    assert updated["status"] == "IN_PROGRESS"
    assert updated["fo_status"] == "VAC"
    assert updated["actual_checkout_at"] == actual_checkout
    assert db.inserts[0][1]["from_status"] == "IN_PROGRESS"
    assert db.inserts[0][1]["to_status"] == "IN_PROGRESS"
    assert db.rows["notifications"] == []
    assert push_calls == []


@pytest.mark.asyncio
async def test_checkout_clears_stayover_note(monkeypatch):
    """Stayover note in history must not linger on the card after checkout."""
    db = FakeDB({
        "rooms": [{"id": "room-1", "tenant_id": "hotel-a", "room_number": "101"}],
        "room_status": [{
            "room_id": "room-1",
            "tenant_id": "hotel-a",
            "status": "OCCUPIED",
            "fo_status": "OCC",
            "clean_type": "DEP",
            "assigned_to": None,
            "actual_checkout_at": None,
            "checkout_time": None,
            "notes": None,
        }],
        "room_status_history": [{
            "room_id": "room-1",
            "tenant_id": "hotel-a",
            "from_status": "OCCUPIED",
            "to_status": "OCCUPIED",
            "changed_by": "sup-1",
            "change_source": "app",
            "notes": "stayover",
        }],
        "notifications": [],
    })
    monkeypatch.setattr(rooms_router, "supabase", db)
    monkeypatch.setattr(rooms_router, "_send_checkout_push", lambda *_: None)

    await rooms_router.manual_checkout_room(
        "room-1",
        ManualCheckoutRequest(actual_checkout_at="2026-05-31T15:00:00+00:00"),
        current_user=FRONT_DESK,
    )

    remaining_notes = [row.get("notes") for row in db.rows["room_status_history"]]
    assert "stayover" not in remaining_notes


def stripe_event(event_type, obj):
    return SimpleNamespace(type=event_type, data=SimpleNamespace(object=obj))


@pytest.mark.asyncio
async def test_room_transition_updates_status_and_writes_history(monkeypatch):
    db = FakeDB({
        "room_status": [{
            "id": "rs-1",
            "room_id": "room-1",
            "tenant_id": "hotel-a",
            "status": "DIRTY",
            "assigned_to": "hk-1",
        }],
        "room_status_history": [],
    })
    monkeypatch.setattr(rooms_router, "supabase", db)

    response = await rooms_router.update_room_status(
        "room-1",
        UpdateRoomStatusRequest(status="IN_PROGRESS", notes="Started room"),
        current_user=HOUSEKEEPER,
    )

    assert response["data"]["status"] == "IN_PROGRESS"
    assert db.rows["room_status"][0]["status"] == "IN_PROGRESS"
    assert db.inserts[0][0] == "room_status_history"
    assert db.inserts[0][1]["from_status"] == "DIRTY"
    assert db.inserts[0][1]["to_status"] == "IN_PROGRESS"
    assert db.inserts[0][1]["tenant_id"] == "hotel-a"


@pytest.mark.asyncio
async def test_room_status_undo_reverts_latest_matching_change(monkeypatch):
    db = FakeDB({
        "room_status": [{
            "id": "rs-1",
            "room_id": "room-1",
            "tenant_id": "hotel-a",
            "status": "IN_PROGRESS",
            "assigned_to": "hk-1",
        }],
        "room_status_history": [{
            "id": "hist-1",
            "room_id": "room-1",
            "tenant_id": "hotel-a",
            "from_status": "DIRTY",
            "to_status": "IN_PROGRESS",
            "changed_by": "hk-1",
            "created_at": "2026-05-25T15:00:00+00:00",
        }],
    })
    monkeypatch.setattr(rooms_router, "supabase", db)

    response = await rooms_router.undo_room_status(
        "room-1",
        current_user=HOUSEKEEPER,
    )

    assert response["data"]["status"] == "DIRTY"
    assert response["data"]["undo"]["from_status"] == "IN_PROGRESS"
    assert response["data"]["undo"]["to_status"] == "DIRTY"
    assert db.rows["room_status"][0]["status"] == "DIRTY"
    assert db.inserts[0][1]["from_status"] == "IN_PROGRESS"
    assert db.inserts[0][1]["to_status"] == "DIRTY"


@pytest.mark.asyncio
async def test_room_history_respects_limit(monkeypatch):
    db = FakeDB({
        "room_status_history": [
            {
                "id": "hist-1",
                "room_id": "room-1",
                "tenant_id": "hotel-a",
                "from_status": "IN_PROGRESS",
                "to_status": "CLEAN",
                "changed_by": "hk-1",
                "created_at": "2026-05-25T16:00:00+00:00",
            },
            {
                "id": "hist-2",
                "room_id": "room-1",
                "tenant_id": "hotel-a",
                "from_status": "DIRTY",
                "to_status": "IN_PROGRESS",
                "changed_by": "hk-1",
                "created_at": "2026-05-25T15:00:00+00:00",
            },
        ],
    })
    monkeypatch.setattr(rooms_router, "supabase", db)

    response = await rooms_router.get_room_history(
        "room-1",
        limit=1,
        current_user=HOUSEKEEPER,
    )

    assert len(response["data"]) == 1
    assert response["data"][0]["to_status"] == "CLEAN"


@pytest.mark.asyncio
async def test_room_status_undo_rejects_other_housekeeper_change(monkeypatch):
    db = FakeDB({
        "room_status": [{
            "id": "rs-1",
            "room_id": "room-1",
            "tenant_id": "hotel-a",
            "status": "CLEAN",
            "assigned_to": "hk-3",
        }],
        "room_status_history": [{
            "id": "hist-1",
            "room_id": "room-1",
            "tenant_id": "hotel-a",
            "from_status": "IN_PROGRESS",
            "to_status": "CLEAN",
            "changed_by": "hk-2",
            "created_at": "2026-05-25T15:00:00+00:00",
        }],
    })
    monkeypatch.setattr(rooms_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await rooms_router.undo_room_status(
            "room-1",
            current_user=HOUSEKEEPER,
        )

    assert exc.value.status_code == 403
    assert db.rows["room_status"][0]["status"] == "CLEAN"
    assert db.inserts == []


@pytest.mark.asyncio
async def test_room_status_undo_allows_assigned_housekeeper_clean_rollback(monkeypatch):
    db = FakeDB({
        "room_status": [{
            "id": "rs-1",
            "room_id": "room-1",
            "tenant_id": "hotel-a",
            "status": "CLEAN",
            "assigned_to": "hk-1",
        }],
        "room_status_history": [{
            "id": "hist-1",
            "room_id": "room-1",
            "tenant_id": "hotel-a",
            "from_status": "IN_PROGRESS",
            "to_status": "CLEAN",
            "changed_by": "hk-2",
            "created_at": "2026-05-25T15:00:00+00:00",
        }],
    })
    monkeypatch.setattr(rooms_router, "supabase", db)

    response = await rooms_router.undo_room_status(
        "room-1",
        current_user=HOUSEKEEPER,
    )

    assert response["data"]["status"] == "IN_PROGRESS"
    assert db.rows["room_status"][0]["status"] == "IN_PROGRESS"


@pytest.mark.asyncio
async def test_room_status_undo_allows_front_desk_clean_rollback(monkeypatch):
    front_desk = CurrentUser(
        user_id="fd-1",
        hotel_id="hotel-a",
        role="front_desk",
        email="fd@example.com",
    )
    db = FakeDB({
        "room_status": [{
            "id": "rs-1",
            "room_id": "room-1",
            "tenant_id": "hotel-a",
            "status": "CLEAN",
            "assigned_to": "hk-1",
        }],
        "room_status_history": [{
            "id": "hist-1",
            "room_id": "room-1",
            "tenant_id": "hotel-a",
            "from_status": "IN_PROGRESS",
            "to_status": "CLEAN",
            "changed_by": "hk-1",
            "created_at": "2026-05-25T15:00:00+00:00",
        }],
    })
    monkeypatch.setattr(rooms_router, "supabase", db)

    response = await rooms_router.undo_room_status(
        "room-1",
        current_user=front_desk,
    )

    assert response["data"]["status"] == "IN_PROGRESS"
    assert db.rows["room_status"][0]["status"] == "IN_PROGRESS"


@pytest.mark.asyncio
async def test_room_transition_rejects_housekeeper_inspection(monkeypatch):
    db = FakeDB({
        "room_status": [{
            "id": "rs-1",
            "room_id": "room-1",
            "tenant_id": "hotel-a",
            "status": "CLEAN",
        }],
        "room_status_history": [],
    })
    monkeypatch.setattr(rooms_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await rooms_router.update_room_status(
            "room-1",
            UpdateRoomStatusRequest(status="INSPECTED"),
            current_user=HOUSEKEEPER,
        )

    assert exc.value.status_code == 403
    assert db.rows["room_status"][0]["status"] == "CLEAN"
    assert db.rows["room_status_history"] == []


@pytest.mark.asyncio
async def test_pickup_room_can_start_normal_clean_flow(monkeypatch):
    db = FakeDB({
        "room_status": [{
            "id": "rs-1",
            "room_id": "room-1",
            "tenant_id": "hotel-a",
            "status": "PICKUP",
            "assigned_to": "hk-1",
        }],
        "room_status_history": [],
    })
    monkeypatch.setattr(rooms_router, "supabase", db)

    response = await rooms_router.update_room_status(
        "room-1",
        UpdateRoomStatusRequest(status="IN_PROGRESS", notes="Started stayover service"),
        current_user=HOUSEKEEPER,
    )

    assert response["data"]["status"] == "IN_PROGRESS"
    assert db.inserts[0][1]["from_status"] == "PICKUP"
    assert db.inserts[0][1]["to_status"] == "IN_PROGRESS"


@pytest.mark.asyncio
async def test_room_transition_allows_supervisor_inspection(monkeypatch):
    db = FakeDB({
        "room_status": [{
            "id": "rs-1",
            "room_id": "room-1",
            "tenant_id": "hotel-a",
            "status": "CLEAN",
        }],
        "room_status_history": [],
    })
    monkeypatch.setattr(rooms_router, "supabase", db)

    response = await rooms_router.update_room_status(
        "room-1",
        UpdateRoomStatusRequest(status="INSPECTED"),
        current_user=SUPERVISOR,
    )

    assert response["data"]["status"] == "INSPECTED"
    assert response["data"]["last_inspected_by"] == "sup-1"
    assert db.inserts[0][1]["from_status"] == "CLEAN"
    assert db.inserts[0][1]["to_status"] == "INSPECTED"


@pytest.mark.asyncio
async def test_stripe_subscription_updated_scopes_update_to_tenant(monkeypatch):
    db = FakeDB({
        "subscriptions": [{
            "tenant_id": "hotel-a",
            "plan_status": "trialing",
            "stripe_subscription_id": None,
        }],
    })
    monkeypatch.setattr(webhooks_router, "supabase", db)
    sub = SimpleNamespace(
        id="sub_123",
        status="active",
        metadata={"hotel_id": "hotel-a"},
        trial_end=None,
        current_period_start=1_700_000_000,
        current_period_end=1_702_592_000,
    )
    monkeypatch.setattr(
        webhooks_router.stripe.Webhook,
        "construct_event",
        lambda *_args, **_kwargs: stripe_event("customer.subscription.updated", sub),
    )

    response = await webhooks_router.stripe_webhook(FakeRequest(headers={"stripe-signature": "sig"}))

    assert response == {"status": "ok"}
    assert db.rows["subscriptions"][0]["plan_status"] == "active"
    assert db.rows["subscriptions"][0]["stripe_subscription_id"] == "sub_123"
    assert db.updates[0][2] == {"tenant_id": "hotel-a"}


@pytest.mark.asyncio
async def test_stripe_invoice_paid_updates_current_credit_ledger_period(monkeypatch):
    db = FakeDB({
        "subscriptions": [{
            "tenant_id": "hotel-a",
            "stripe_subscription_id": "sub_123",
        }],
        "credit_ledger": [{
            "id": "ledger-1",
            "tenant_id": "hotel-a",
            "stripe_invoice_id": None,
            "period_start": "2026-05-01",
            "period_end": "2026-05-31",
        }],
    })
    monkeypatch.setattr(webhooks_router, "supabase", db)
    invoice = SimpleNamespace(id="in_123", subscription="sub_123")
    monkeypatch.setattr(
        webhooks_router.stripe.Webhook,
        "construct_event",
        lambda *_args, **_kwargs: stripe_event("invoice.paid", invoice),
    )

    response = await webhooks_router.stripe_webhook(FakeRequest(headers={"stripe-signature": "sig"}))

    assert response == {"status": "ok"}
    assert db.rows["credit_ledger"][0]["stripe_invoice_id"] == "in_123"
    assert db.updates[-1][0] == "credit_ledger"
    assert db.updates[-1][2] == {"tenant_id": "hotel-a"}


@pytest.mark.asyncio
async def test_opera_webhook_unknown_hotel_is_ignored(monkeypatch):
    db = FakeDB({"opera_credentials": []})
    monkeypatch.setattr(webhooks_router, "supabase", db)
    payload = b'{"hotelId":"opera-missing","eventType":"RESERVATION.CHECKED_OUT","payload":{}}'

    response = await webhooks_router.opera_webhook(FakeRequest(payload=payload))

    assert response == {"status": "ignored", "reason": "hotel not found or not connected"}
    assert db.updates == []
