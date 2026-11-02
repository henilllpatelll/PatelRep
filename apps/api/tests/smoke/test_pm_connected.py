"""Engineering PM + Assets V2, Phase 6: the work order's preventive-maintenance source. The link is the real
`pm_completion_id`; nothing is inferred from titles, dates or equipment names, and nothing crosses a property."""

from __future__ import annotations

import uuid

import pytest

from middleware.auth import CurrentUser
from routers import work_orders as wo_router

from .pm_fakes import PmFakeDB

TENANT, OTHER = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
ASSET, SCHEDULE, COMPLETION, FOREIGN_COMPLETION = (str(uuid.uuid4()) for _ in range(4))
WO_PM, WO_PLAIN, WO_FOREIGN_LINK, WO_ITEM, WO_STALE_KEY = (str(uuid.uuid4()) for _ in range(5))
CHIEF = CurrentUser(user_id="chief-1", hotel_id=TENANT, role="chief_engineer", email="c@example.com")
ENGINEER = CurrentUser(user_id="eng-1", hotel_id=TENANT, role="engineer", email="e@example.com")


@pytest.fixture
def db(monkeypatch):
    database = PmFakeDB({
        "assets": [{"id": ASSET, "tenant_id": TENANT, "name": "Chiller"}],
        "pm_schedules": [{"id": SCHEDULE, "tenant_id": TENANT, "asset_id": ASSET, "name": "Quarterly chiller check"}],
        "pm_completion_records": [
            {"id": COMPLETION, "tenant_id": TENANT, "pm_schedule_id": SCHEDULE, "asset_id": ASSET,
             "completed_at": "2026-10-30T15:00:00+00:00", "photos": [{"evidence_id": "p1"}]},
            {"id": FOREIGN_COMPLETION, "tenant_id": OTHER, "pm_schedule_id": str(uuid.uuid4()), "asset_id": None,
             "completed_at": "2026-10-30T15:00:00+00:00", "photos": []},
        ],
        "pm_completion_items": [
            {"id": "i1", "tenant_id": TENANT, "completion_id": COMPLETION, "item_key": "coolant", "label": "Coolant level", "result": "failed",
             "note": "Low, weeping at the gasket", "evidence": [{"evidence_id": "e1"}]},
            {"id": "i2", "tenant_id": TENANT, "completion_id": COMPLETION, "item_key": "belt", "label": "Belt tension", "result": "passed",
             "note": None, "evidence": []},
        ],
        "work_orders": [
            {"id": WO_PM, "tenant_id": TENANT, "title": "PM fail: Coolant level", "status": "open", "priority": "urgent",
             "asset_id": ASSET, "is_pm_generated": True, "pm_completion_id": COMPLETION},
            {"id": WO_ITEM, "tenant_id": TENANT, "title": "Corrective PM work: Coolant level", "status": "open", "priority": "urgent",
             "asset_id": ASSET, "is_pm_generated": True, "pm_completion_id": COMPLETION, "pm_completion_item_key": "coolant"},
            {"id": WO_STALE_KEY, "tenant_id": TENANT, "title": "x", "status": "open", "priority": "urgent",
             "asset_id": ASSET, "is_pm_generated": True, "pm_completion_id": COMPLETION, "pm_completion_item_key": "belt"},
            {"id": WO_PLAIN, "tenant_id": TENANT, "title": "PM fail: Coolant level", "status": "open", "priority": "normal",
             "asset_id": ASSET, "is_pm_generated": False, "pm_completion_id": None},
            {"id": WO_FOREIGN_LINK, "tenant_id": TENANT, "title": "x", "status": "open", "priority": "normal",
             "asset_id": ASSET, "is_pm_generated": True, "pm_completion_id": FOREIGN_COMPLETION},
        ],
    })
    monkeypatch.setattr(wo_router, "supabase", database)
    return database


@pytest.mark.asyncio
async def test_a_pm_generated_order_carries_its_real_source_and_only_the_failed_items(db):
    source = (await wo_router.get_work_order(WO_PM, CHIEF))["data"]["pm_source"]
    assert source["completion_id"] == COMPLETION and source["schedule_id"] == SCHEDULE
    assert source["schedule_name"] == "Quarterly chiller check" and source["asset_id"] == ASSET
    assert source["failed_items"] == [{"label": "Coolant level", "note": "Low, weeping at the gasket"}]
    assert source["evidence_count"] == 2


@pytest.mark.asyncio
async def test_an_order_with_no_link_gets_no_source_even_with_a_matching_title(db):
    assert (await wo_router.get_work_order(WO_PLAIN, ENGINEER))["data"]["pm_source"] is None


@pytest.mark.asyncio
async def test_a_link_pointing_at_another_property_reads_as_no_source(db):
    assert (await wo_router.get_work_order(WO_FOREIGN_LINK, CHIEF))["data"]["pm_source"] is None


@pytest.mark.asyncio
async def test_a_failed_source_lookup_never_fails_the_repair_screen(db, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("db down")
    real = db.table
    monkeypatch.setattr(db, "table", lambda name: boom() if name == "pm_completion_records" else real(name))
    data = (await wo_router.get_work_order(WO_PM, CHIEF))["data"]
    assert data["pm_source"] == {"completion_id": COMPLETION, "schedule_id": None, "details_unavailable": True}
    assert data["id"] == WO_PM


@pytest.mark.asyncio
async def test_an_order_that_recorded_its_item_names_exactly_that_step(db):
    source = (await wo_router.get_work_order(WO_ITEM, CHIEF))["data"]["pm_source"]
    assert source["this_item"] == {"label": "Coolant level", "note": "Low, weeping at the gasket"}
    assert [i["label"] for i in source["failed_items"]] == ["Coolant level"]


@pytest.mark.asyncio
async def test_an_older_order_without_a_recorded_item_claims_no_item(db):
    assert (await wo_router.get_work_order(WO_PM, CHIEF))["data"]["pm_source"]["this_item"] is None


@pytest.mark.asyncio
async def test_a_recorded_key_that_is_not_a_failed_step_claims_nothing(db):
    """A passed step (or any key that matches no failed item) can never be presented as the cause."""
    assert (await wo_router.get_work_order(WO_STALE_KEY, CHIEF))["data"]["pm_source"]["this_item"] is None
