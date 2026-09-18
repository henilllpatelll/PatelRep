"""Tests for GET /ai/risk-alerts' three new exception categories (proactive
exception alerts): low_stock_parts, pending_guest_issues, recurring_issues.

These reuse existing signal sources (services.inventory, guest_requests table,
routers.assets.get_recurring_issues) rather than re-deriving the logic --
see the docstring on get_risk_alerts for why this is not a duplicate of the
cron-driven shift_summary AI narrative that mentions similar counts.
"""

from datetime import datetime, timedelta, timezone

import pytest

from middleware.auth import CurrentUser
from routers import ai_copilot, assets as assets_router
from services import inventory as inventory_service
from tests.smoke.fake_supabase import FakeDB

GM = CurrentUser(user_id="gm-1", hotel_id="hotel-1", role="gm", email="gm@example.com")


def _patch_all(monkeypatch, db):
    monkeypatch.setattr(ai_copilot, "supabase", db)
    monkeypatch.setattr(inventory_service, "supabase", db)
    monkeypatch.setattr(assets_router, "supabase", db)


@pytest.mark.asyncio
async def test_low_stock_part_is_surfaced(monkeypatch):
    db = FakeDB({
        "engineering_parts": [
            {"id": "part-1", "tenant_id": "hotel-1", "name": "HVAC Filter", "minimum_stock": 5, "is_active": True},
        ],
        "engineering_part_stock": [
            {"part_id": "part-1", "tenant_id": "hotel-1", "quantity": 2},
        ],
    })
    _patch_all(monkeypatch, db)

    response = await ai_copilot.get_risk_alerts(current_user=GM)

    low_stock = response["data"]["low_stock_parts"]
    assert len(low_stock) == 1
    assert low_stock[0]["name"] == "HVAC Filter"
    assert low_stock[0]["on_hand"] == 2.0


@pytest.mark.asyncio
async def test_well_stocked_part_is_not_surfaced(monkeypatch):
    db = FakeDB({
        "engineering_parts": [
            {"id": "part-1", "tenant_id": "hotel-1", "name": "HVAC Filter", "minimum_stock": 5, "is_active": True},
        ],
        "engineering_part_stock": [
            {"part_id": "part-1", "tenant_id": "hotel-1", "quantity": 20},
        ],
    })
    _patch_all(monkeypatch, db)

    response = await ai_copilot.get_risk_alerts(current_user=GM)

    assert response["data"]["low_stock_parts"] == []


@pytest.mark.asyncio
async def test_pending_guest_issue_is_surfaced(monkeypatch):
    db = FakeDB({
        "guest_requests": [
            {"id": "gr-1", "tenant_id": "hotel-1", "title": "AC not working", "description": None,
             "status": "open", "room_id": "room-1", "rooms": {"room_number": "214"}},
            {"id": "gr-2", "tenant_id": "hotel-1", "title": "Old complaint", "description": None,
             "status": "resolved", "room_id": "room-2", "rooms": {"room_number": "215"}},
        ],
    })
    _patch_all(monkeypatch, db)

    response = await ai_copilot.get_risk_alerts(current_user=GM)

    issues = response["data"]["pending_guest_issues"]
    assert len(issues) == 1
    assert issues[0]["id"] == "gr-1"


@pytest.mark.asyncio
async def test_recurring_issue_is_surfaced(monkeypatch):
    now = datetime.now(timezone.utc)
    db = FakeDB({
        "work_orders": [
            {"id": f"wo-{i}", "tenant_id": "hotel-1", "asset_id": "asset-1", "room_id": None,
             "category": "hvac", "title": f"WO {i}", "status": "open",
             "created_at": (now - timedelta(days=i * 5)).isoformat()}
            for i in range(3)
        ],
        "assets": [{"id": "asset-1", "name": "Rooftop HVAC", "room_id": None, "rooms": None}],
    })
    _patch_all(monkeypatch, db)

    response = await ai_copilot.get_risk_alerts(current_user=GM)

    recurring = response["data"]["recurring_issues"]
    assert len(recurring) == 1
    assert recurring[0]["asset_id"] == "asset-1"
    assert recurring[0]["wo_count"] == 3


@pytest.mark.asyncio
async def test_empty_tenant_returns_empty_exception_lists(monkeypatch):
    db = FakeDB()
    _patch_all(monkeypatch, db)

    response = await ai_copilot.get_risk_alerts(current_user=GM)

    assert response["data"]["low_stock_parts"] == []
    assert response["data"]["pending_guest_issues"] == []
    assert response["data"]["recurring_issues"] == []
    assert response["data"]["housekeeping_risks"] == []
    assert response["data"]["maintenance_risks"] == []
    assert response["data"]["sla_breaches"] == []
