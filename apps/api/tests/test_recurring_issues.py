"""Tests for GET /assets/recurring-issues (recurring-failure radar).

Flags assets/rooms with >= min_count work orders in a rolling window, e.g.
"Room 214 AC: 3rd WO in 30 days" -- pure frequency counting, no AI cost.
"""

from datetime import datetime, timedelta, timezone

import pytest

from middleware.auth import CurrentUser
from routers import assets as assets_router
from tests.smoke.fake_supabase import FakeDB

GM = CurrentUser(user_id="gm-1", hotel_id="hotel-1", role="gm", email="gm@example.com")

NOW = datetime.now(timezone.utc)


def _iso(days_ago: float) -> str:
    return (NOW - timedelta(days=days_ago)).isoformat()


def _wo(id_, asset_id=None, room_id=None, days_ago=1, category="hvac", status="open"):
    return {
        "id": id_,
        "tenant_id": "hotel-1",
        "asset_id": asset_id,
        "room_id": room_id,
        "category": category,
        "title": f"WO {id_}",
        "status": status,
        "created_at": _iso(days_ago),
    }


@pytest.mark.asyncio
async def test_asset_with_three_recent_wos_is_flagged(monkeypatch):
    db = FakeDB({
        "work_orders": [
            _wo("wo-1", asset_id="asset-1", days_ago=25),
            _wo("wo-2", asset_id="asset-1", days_ago=15),
            _wo("wo-3", asset_id="asset-1", days_ago=2),
        ],
        "assets": [{"id": "asset-1", "name": "AC Unit 214", "room_id": "room-214", "rooms": {"room_number": "214"}}],
        "rooms": [],
    })
    monkeypatch.setattr(assets_router, "supabase", db)

    response = await assets_router.get_recurring_issues(days=30, min_count=3, current_user=GM)

    issues = response["data"]
    assert len(issues) == 1
    issue = issues[0]
    assert issue["asset_id"] == "asset-1"
    assert issue["asset_name"] == "AC Unit 214"
    assert issue["room_number"] == "214"
    assert issue["wo_count"] == 3
    assert issue["window_days"] == 30
    assert set(issue["work_order_ids"]) == {"wo-1", "wo-2", "wo-3"}


@pytest.mark.asyncio
async def test_asset_below_threshold_is_not_flagged(monkeypatch):
    db = FakeDB({
        "work_orders": [
            _wo("wo-1", asset_id="asset-1", days_ago=25),
            _wo("wo-2", asset_id="asset-1", days_ago=15),
        ],
        "assets": [],
        "rooms": [],
    })
    monkeypatch.setattr(assets_router, "supabase", db)

    response = await assets_router.get_recurring_issues(days=30, min_count=3, current_user=GM)

    assert response["data"] == []


@pytest.mark.asyncio
async def test_wo_outside_window_is_excluded(monkeypatch):
    db = FakeDB({
        "work_orders": [
            _wo("wo-1", asset_id="asset-1", days_ago=25),
            _wo("wo-2", asset_id="asset-1", days_ago=15),
            _wo("wo-3", asset_id="asset-1", days_ago=45),  # outside 30-day window
        ],
        "assets": [{"id": "asset-1", "name": "Boiler", "room_id": None, "rooms": None}],
        "rooms": [],
    })
    monkeypatch.setattr(assets_router, "supabase", db)

    response = await assets_router.get_recurring_issues(days=30, min_count=3, current_user=GM)

    assert response["data"] == []


@pytest.mark.asyncio
async def test_cancelled_work_orders_are_excluded(monkeypatch):
    db = FakeDB({
        "work_orders": [
            _wo("wo-1", asset_id="asset-1", days_ago=25),
            _wo("wo-2", asset_id="asset-1", days_ago=15),
            _wo("wo-3", asset_id="asset-1", days_ago=2, status="cancelled"),
        ],
        "assets": [],
        "rooms": [],
    })
    monkeypatch.setattr(assets_router, "supabase", db)

    response = await assets_router.get_recurring_issues(days=30, min_count=3, current_user=GM)

    assert response["data"] == []


@pytest.mark.asyncio
async def test_room_only_work_orders_group_by_room_when_no_asset_link(monkeypatch):
    db = FakeDB({
        "work_orders": [
            _wo("wo-1", room_id="room-9", days_ago=20, category="plumbing"),
            _wo("wo-2", room_id="room-9", days_ago=10, category="plumbing"),
            _wo("wo-3", room_id="room-9", days_ago=1, category="plumbing"),
        ],
        "assets": [],
        "rooms": [{"id": "room-9", "room_number": "310"}],
    })
    monkeypatch.setattr(assets_router, "supabase", db)

    response = await assets_router.get_recurring_issues(days=30, min_count=3, current_user=GM)

    issues = response["data"]
    assert len(issues) == 1
    assert issues[0]["asset_id"] is None
    assert issues[0]["room_id"] == "room-9"
    assert issues[0]["room_number"] == "310"
    assert issues[0]["wo_count"] == 3


@pytest.mark.asyncio
async def test_results_sorted_by_count_descending(monkeypatch):
    db = FakeDB({
        "work_orders": [
            *[_wo(f"a-{i}", asset_id="asset-A", days_ago=i) for i in range(3)],
            *[_wo(f"b-{i}", asset_id="asset-B", days_ago=i) for i in range(5)],
        ],
        "assets": [
            {"id": "asset-A", "name": "A", "room_id": None, "rooms": None},
            {"id": "asset-B", "name": "B", "room_id": None, "rooms": None},
        ],
        "rooms": [],
    })
    monkeypatch.setattr(assets_router, "supabase", db)

    response = await assets_router.get_recurring_issues(days=30, min_count=3, current_user=GM)

    issues = response["data"]
    assert [i["asset_id"] for i in issues] == ["asset-B", "asset-A"]


@pytest.mark.asyncio
async def test_no_work_orders_returns_empty_list(monkeypatch):
    db = FakeDB({"work_orders": [], "assets": [], "rooms": []})
    monkeypatch.setattr(assets_router, "supabase", db)

    response = await assets_router.get_recurring_issues(days=30, min_count=3, current_user=GM)

    assert response["data"] == []
