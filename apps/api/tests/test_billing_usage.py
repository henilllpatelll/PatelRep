"""
Regression tests for BILLING-02/03/05/06 gaps:

1. credit_ledger rows were only lazily created by the AI-call path
   (check_and_deduct_credits), not by the billing page's own read path
   (GET /billing/credits) -- so a GM opening the billing page before any
   AI call ran that period saw a "No billing period found" placeholder.
2. subscriptions.cap_cents was never set at hotel creation (always NULL),
   so the $2.50/room/month cap silently never enforced.
3. GET /billing/credits had no projected month-end cost or cap-headroom
   fields.
4. No proactive signal when a hotel crosses 80% of its cap.
"""

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from middleware import credits
from middleware.auth import CurrentUser
from routers import billing as billing_router
from routers import hotels as hotels_router
from models.requests import CreateHotelRequest
from tests.smoke.fake_supabase import FakeDB, FakeQuery


GM = CurrentUser(
    user_id="11111111-1111-4111-8111-111111111111",
    hotel_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role="gm",
    email="gm@example.com",
)


# ---------------------------------------------------------------------------
# Fake Supabase plumbing: extends the shared FakeDB (whose .lte()/.gte()
# actually filter by string comparison, unlike the primitive fake in
# tests/smoke/test_webhooks_and_transitions.py) with .rpc() support (needed
# because check_and_deduct_credits calls supabase.rpc("increment_credits_used"))
# and .contains() support (needed for the notification dedup check).
# ---------------------------------------------------------------------------

class _RpcQuery:
    def __init__(self, db, name, params):
        self.db, self.name, self.params = db, name, params

    def execute(self):
        self.db.rpc_calls.append((self.name, self.params))
        return SimpleNamespace(data=[])


class BillingFakeQuery(FakeQuery):
    def contains(self, column, value):
        self.filters.append(("contains", column, value))
        return self

    def _matches(self, row):
        if not super()._matches(row):
            return False
        for op, column, value in self.filters:
            if op == "contains":
                actual = row.get(column) or {}
                if not all(actual.get(k) == v for k, v in value.items()):
                    return False
        return True


class BillingFakeDB(FakeDB):
    def __init__(self, rows=None):
        super().__init__(rows)
        self.rpc_calls = []

    def table(self, name):
        return BillingFakeQuery(self, name)

    def rpc(self, name, params):
        return _RpcQuery(self, name, params)


# ---------------------------------------------------------------------------
# Task 1 tests
# ---------------------------------------------------------------------------

def test_get_or_create_current_period_ledger_reuses_existing_row(monkeypatch):
    today = date.today()
    db = BillingFakeDB({
        "credit_ledger": [{
            "id": "ledger-1",
            "tenant_id": GM.hotel_id,
            "period_start": date(today.year, 1, 1).isoformat(),
            "period_end": date(today.year, 12, 31).isoformat(),
            "credits_included": 5000,
            "credits_used": 42,
        }],
    })
    monkeypatch.setattr(credits, "supabase", db)

    result = credits.get_or_create_current_period_ledger(GM.hotel_id)

    assert result["id"] == "ledger-1"
    assert result["credits_used"] == 42
    assert db.inserts == []


def test_get_or_create_current_period_ledger_creates_row_when_missing(monkeypatch):
    db = BillingFakeDB({
        "subscriptions": [{
            "id": "sub-1",
            "tenant_id": GM.hotel_id,
            "credits_included": 5000,
            "cap_cents": 20000,
            "plan_status": "trialing",
        }],
    })
    monkeypatch.setattr(credits, "supabase", db)

    result = credits.get_or_create_current_period_ledger(GM.hotel_id)

    today = date.today()
    expected_start = date(today.year, today.month, 1)
    assert result["period_start"] == expected_start.isoformat()
    from dateutil.relativedelta import relativedelta
    expected_end = expected_start + relativedelta(months=1) - timedelta(days=1)
    assert result["period_end"] == expected_end.isoformat()
    assert result.get("credits_used", 0) == 0

    ledger_inserts = [row for (table, row) in db.inserts if table == "credit_ledger"]
    assert len(ledger_inserts) == 1


@pytest.mark.asyncio
async def test_get_credits_returns_real_zeros_not_placeholder_message_for_new_period(monkeypatch):
    db = BillingFakeDB({
        "subscriptions": [{
            "id": "sub-1",
            "tenant_id": GM.hotel_id,
            "credits_included": 5000,
            "cap_cents": None,
            "base_fee_cents": 9900,
            "plan_status": "trialing",
        }],
    })
    monkeypatch.setattr(credits, "supabase", db)
    monkeypatch.setattr(billing_router, "supabase", db)

    response = await billing_router.get_credits(current_user=GM)

    data = response["data"]
    assert data["credits_used"] == 0
    assert "message" not in data


@pytest.mark.asyncio
async def test_create_hotel_sets_cap_cents_from_room_count(monkeypatch):
    db = BillingFakeDB()
    monkeypatch.setattr(hotels_router, "supabase", db)

    body = CreateHotelRequest(name="Test Hotel", room_count=80, timezone="America/Chicago")
    fake_user = CurrentUser(
        user_id="22222222-2222-4222-8222-222222222222",
        hotel_id="",
        role="gm",
        email="gm@example.com",
    )

    await hotels_router.create_hotel(body, current_user=fake_user)

    sub_inserts = [row for (table, row) in db.inserts if table == "subscriptions"]
    assert len(sub_inserts) == 1
    assert sub_inserts[0]["cap_cents"] == 80 * 250 == 20000
