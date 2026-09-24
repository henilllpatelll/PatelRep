"""Contract tests for the Work Order Console panel redesign (migration 110):
checklist (template seed + toggle), parts-by-WO listing, the duplicate-signal
heuristic, snooze, and merge-as-duplicate-cancel.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser, require_role
from models.requests import (
    CreateChecklistItemRequest,
    CreateWorkOrderRequest,
    MergeWorkOrderRequest,
    SnoozeWorkOrderRequest,
    UpdateChecklistItemRequest,
)
from routers import work_orders as work_orders_router
from tests.smoke.fake_supabase import FakeDB

NOW = datetime.now(timezone.utc)
GM = CurrentUser(user_id="gm-1", hotel_id="hotel-1", role="gm", email="gm@example.com")
ENGINEER = CurrentUser(user_id="eng-1", hotel_id="hotel-1", role="engineer", email="eng@example.com")
CHIEF = CurrentUser(user_id="chief-1", hotel_id="hotel-1", role="chief_engineer", email="chief@example.com")


def _iso(days_ago: float = 0) -> str:
    return (NOW - timedelta(days=days_ago)).isoformat()


# ---------------------------------------------------------------------------
# Checklist — template seeding on creation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_work_order_seeds_checklist_from_category_template(monkeypatch):
    db = FakeDB({
        "work_order_checklist_templates": [{"id": "tpl-1", "tenant_id": "hotel-1", "category": "hvac", "is_active": True}],
        "work_order_checklist_template_items": [
            {"id": "ti-1", "template_id": "tpl-1", "label": "Confirm setpoint", "estimated_minutes": 10, "sort_order": 1},
            {"id": "ti-2", "template_id": "tpl-1", "label": "Check belt tension", "estimated_minutes": 20, "sort_order": 2},
        ],
    })
    monkeypatch.setattr(work_orders_router, "supabase", db)

    response = await work_orders_router.create_work_order(
        CreateWorkOrderRequest(title="AC blowing warm", category="hvac", priority="normal"),
        ENGINEER,
    )
    wo_id = response["data"]["id"]

    seeded = [row for row in db.rows["work_order_checklist_items"] if row["work_order_id"] == wo_id]
    assert [item["label"] for item in seeded] == ["Confirm setpoint", "Check belt tension"]
    assert seeded[0]["estimated_minutes"] == 10
    assert all(item["tenant_id"] == "hotel-1" and not item.get("is_done") for item in seeded)


@pytest.mark.asyncio
async def test_create_work_order_with_untemplated_category_has_empty_checklist(monkeypatch):
    db = FakeDB({})
    monkeypatch.setattr(work_orders_router, "supabase", db)

    response = await work_orders_router.create_work_order(
        CreateWorkOrderRequest(title="Replace lobby art", category="general", priority="low"),
        ENGINEER,
    )

    assert db.rows.get("work_order_checklist_items", []) == []
    assert response["data"] is not None


@pytest.mark.asyncio
async def test_toggle_checklist_item_sets_done_by_and_done_at(monkeypatch):
    db = FakeDB({
        "work_order_checklist_items": [
            {"id": "item-1", "tenant_id": "hotel-1", "work_order_id": "wo-1", "label": "Step", "is_done": False, "done_by": None, "done_at": None},
        ],
    })
    monkeypatch.setattr(work_orders_router, "supabase", db)

    response = await work_orders_router.update_checklist_item(
        "wo-1", "item-1", UpdateChecklistItemRequest(is_done=True), ENGINEER
    )

    assert response["data"]["is_done"] is True
    assert response["data"]["done_by"] == "eng-1"
    assert response["data"]["done_at"] is not None


@pytest.mark.asyncio
async def test_toggle_checklist_item_cross_tenant_is_404(monkeypatch):
    db = FakeDB({
        "work_order_checklist_items": [
            {"id": "item-1", "tenant_id": "hotel-2", "work_order_id": "wo-1", "label": "Step", "is_done": False},
        ],
    })
    monkeypatch.setattr(work_orders_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await work_orders_router.update_checklist_item(
            "wo-1", "item-1", UpdateChecklistItemRequest(is_done=True), ENGINEER
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_add_checklist_item_appends_after_existing_sort_order(monkeypatch):
    db = FakeDB({
        "work_orders": [{"id": "wo-1", "tenant_id": "hotel-1"}],
        "work_order_checklist_items": [
            {"id": "item-1", "tenant_id": "hotel-1", "work_order_id": "wo-1", "label": "First", "sort_order": 1},
        ],
    })
    monkeypatch.setattr(work_orders_router, "supabase", db)

    response = await work_orders_router.add_checklist_item(
        "wo-1", CreateChecklistItemRequest(label="Custom step", estimated_minutes=15), CHIEF
    )

    assert response["data"]["sort_order"] == 2
    assert response["data"]["label"] == "Custom step"


@pytest.mark.parametrize("role", ["housekeeper", "front_desk", "housekeeping_supervisor"])
@pytest.mark.asyncio
async def test_checklist_toggle_blocks_non_engineering_roles(role):
    check = require_role("engineer", "chief_engineer", "gm")
    with pytest.raises(HTTPException) as exc:
        await check(current_user=CurrentUser(user_id="u1", hotel_id="hotel-1", role=role, email="x@example.com"))
    assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Parts — list by work order
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_work_order_parts_scopes_to_tenant_and_wo(monkeypatch):
    db = FakeDB({
        "work_orders": [{"id": "wo-1", "tenant_id": "hotel-1"}],
        "engineering_part_transactions": [
            {"id": "t-1", "tenant_id": "hotel-1", "work_order_id": "wo-1", "quantity_delta": -2, "created_at": _iso(1)},
            {"id": "t-2", "tenant_id": "hotel-1", "work_order_id": "wo-2", "quantity_delta": -1, "created_at": _iso(1)},
            {"id": "t-3", "tenant_id": "hotel-2", "work_order_id": "wo-1", "quantity_delta": -5, "created_at": _iso(1)},
        ],
    })
    monkeypatch.setattr(work_orders_router, "supabase", db)

    response = await work_orders_router.list_work_order_parts("wo-1", GM)

    assert [row["id"] for row in response["data"]] == ["t-1"]


# ---------------------------------------------------------------------------
# Duplicate-signal — cheap frequency heuristic
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_duplicate_signal_flags_other_open_wo_on_same_asset(monkeypatch):
    db = FakeDB({
        "work_orders": [
            {"id": "wo-1", "tenant_id": "hotel-1", "work_order_number": 1140, "asset_id": "asset-1", "room_id": None, "category": "hvac", "status": "open", "created_at": _iso(0.1)},
            {"id": "wo-2", "tenant_id": "hotel-1", "work_order_number": 1141, "asset_id": "asset-1", "room_id": None, "category": "hvac", "status": "in_progress", "created_at": _iso(2), "rooms": {"room_number": "209"}, "title": "Belt slipping"},
        ],
        "assets": [{"id": "asset-1", "tenant_id": "hotel-1", "zone": None}],
    })
    monkeypatch.setattr(work_orders_router, "supabase", db)

    response = await work_orders_router.get_duplicate_signal("wo-1", GM)

    signal = response["data"]
    assert signal is not None
    assert signal["candidate_wo_number"] == 1141
    assert signal["confidence"] >= 55
    assert len(signal["signals"]) == 1


@pytest.mark.asyncio
async def test_duplicate_signal_none_when_no_other_open_wo(monkeypatch):
    db = FakeDB({
        "work_orders": [
            {"id": "wo-1", "tenant_id": "hotel-1", "work_order_number": 1140, "asset_id": "asset-1", "room_id": None, "category": "hvac", "status": "open", "created_at": _iso(0.1)},
        ],
        "assets": [{"id": "asset-1", "tenant_id": "hotel-1", "zone": None}],
    })
    monkeypatch.setattr(work_orders_router, "supabase", db)

    response = await work_orders_router.get_duplicate_signal("wo-1", GM)

    assert response["data"] is None


@pytest.mark.asyncio
async def test_duplicate_signal_none_for_already_closed_wo(monkeypatch):
    db = FakeDB({
        "work_orders": [
            {"id": "wo-1", "tenant_id": "hotel-1", "work_order_number": 1140, "asset_id": "asset-1", "room_id": None, "category": "hvac", "status": "completed", "created_at": _iso(0.1)},
        ],
        "assets": [{"id": "asset-1", "tenant_id": "hotel-1", "zone": None}],
    })
    monkeypatch.setattr(work_orders_router, "supabase", db)

    response = await work_orders_router.get_duplicate_signal("wo-1", GM)

    assert response["data"] is None


@pytest.mark.asyncio
async def test_duplicate_signal_groups_by_shared_zone_across_assets(monkeypatch):
    db = FakeDB({
        "work_orders": [
            {"id": "wo-1", "tenant_id": "hotel-1", "work_order_number": 1140, "asset_id": "asset-207", "room_id": None, "category": "hvac", "status": "open", "created_at": _iso(0.1)},
            {"id": "wo-2", "tenant_id": "hotel-1", "work_order_number": 1141, "asset_id": "asset-209", "room_id": None, "category": "hvac", "status": "open", "created_at": _iso(1), "rooms": {"room_number": "209"}, "title": "AC blowing warm"},
        ],
        "assets": [
            {"id": "asset-207", "tenant_id": "hotel-1", "zone": "HVAC zone B"},
            {"id": "asset-209", "tenant_id": "hotel-1", "zone": "HVAC zone B"},
        ],
    })
    monkeypatch.setattr(work_orders_router, "supabase", db)

    response = await work_orders_router.get_duplicate_signal("wo-1", GM)

    signal = response["data"]
    assert signal is not None
    assert signal["same_zone"] is True
    assert signal["candidate_wo_number"] == 1141


# ---------------------------------------------------------------------------
# Snooze
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_snooze_sets_snoozed_until_one_hour_out(monkeypatch):
    db = FakeDB({"work_orders": [{"id": "wo-1", "tenant_id": "hotel-1", "snoozed_until": None}]})
    monkeypatch.setattr(work_orders_router, "supabase", db)

    response = await work_orders_router.snooze_work_order("wo-1", SnoozeWorkOrderRequest(hours=1), ENGINEER)

    snoozed_until = datetime.fromisoformat(response["data"]["snoozed_until"])
    delta = snoozed_until - NOW
    assert timedelta(minutes=55) < delta < timedelta(minutes=65)


@pytest.mark.asyncio
async def test_snooze_unknown_work_order_is_404(monkeypatch):
    db = FakeDB({"work_orders": []})
    monkeypatch.setattr(work_orders_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await work_orders_router.snooze_work_order("missing", SnoozeWorkOrderRequest(hours=1), ENGINEER)
    assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# Merge — cancels source as duplicate, comments on target. RPC-backed, so
# this uses a small local fake (mirrors test_work_order_transitions.py's
# _TransitionDatabase) rather than the plain FakeDB.
# ---------------------------------------------------------------------------


class _MergeDatabase(FakeDB):
    def __init__(self, rows):
        super().__init__(rows)
        self.rpc_calls: list[tuple[str, dict]] = []

    def rpc(self, function_name: str, payload: dict):
        self.rpc_calls.append((function_name, payload))
        wo = next(row for row in self.rows["work_orders"] if row["id"] == payload["p_work_order_id"])
        wo["status"] = payload["p_new_status"]
        result = SimpleNamespace(data=[wo])
        return SimpleNamespace(execute=lambda: result)


WO_1140 = "11111111-1111-4111-8111-111111111140"
WO_1141 = "11111111-1111-4111-8111-111111111141"


@pytest.mark.asyncio
async def test_merge_cancels_source_and_comments_on_target(monkeypatch):
    db = _MergeDatabase({
        "work_orders": [
            {"id": WO_1140, "tenant_id": "hotel-1", "work_order_number": 1140, "status": "open"},
            {"id": WO_1141, "tenant_id": "hotel-1", "work_order_number": 1141, "status": "in_progress"},
        ],
    })
    monkeypatch.setattr(work_orders_router, "supabase", db)

    response = await work_orders_router.merge_work_order(
        WO_1140, MergeWorkOrderRequest(target_wo_id=WO_1141), CHIEF
    )

    assert response["data"]["status"] == "cancelled"
    assert db.rpc_calls[0][1]["p_reason_code"] == "duplicate"

    comments = db.rows.get("work_order_comments", [])
    assert len(comments) == 1
    assert comments[0]["work_order_id"] == WO_1141
    assert comments[0]["is_system"] is True
    assert "WO-1140" in comments[0]["comment"]


@pytest.mark.asyncio
async def test_merge_into_self_is_rejected(monkeypatch):
    db = _MergeDatabase({"work_orders": [{"id": WO_1140, "tenant_id": "hotel-1", "work_order_number": 1140, "status": "open"}]})
    monkeypatch.setattr(work_orders_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await work_orders_router.merge_work_order(WO_1140, MergeWorkOrderRequest(target_wo_id=WO_1140), CHIEF)
    assert exc.value.status_code == 422


@pytest.mark.parametrize("role", ["engineer", "housekeeper", "front_desk"])
@pytest.mark.asyncio
async def test_merge_blocks_roles_other_than_chief_and_gm(role):
    check = require_role("chief_engineer", "gm")
    with pytest.raises(HTTPException) as exc:
        await check(current_user=CurrentUser(user_id="u1", hotel_id="hotel-1", role=role, email="x@example.com"))
    assert exc.value.status_code == 403
