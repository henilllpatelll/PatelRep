"""Phase 10 (housekeeping redesign): the lightweight supervisor Pass/Fail
inspection flow, and the reclean_requested_at plumbing it depends on.

Before this, POST /housekeeping/inspections/{id}/reclean only ever created a
generic task -- nothing ever set room_status.reclean_requested_at, so the
frontend's recleanRequired selector (lib/housekeeping/roomState.ts) could
never fire and My Rooms' Reclean section was permanently unreachable.
"""

from datetime import datetime, timezone
import json

import pytest

from middleware.auth import CurrentUser
from models.requests import InspectionResultItem, SubmitInspectionRequest
from routers import housekeeping as hk_router

from .fake_supabase import FakeDB

HOTEL = "hotel-a"
ROOM_ID = "88a3bb25-8ca8-487d-aceb-a4a5a786ef5e"
TEMPLATE_ITEM_TOWELS = "4090a13d-f8c8-4628-8513-b669f59c5954"
TEMPLATE_ITEM_MIRROR = "a2fd0f18-4a5f-4bd9-a026-85b4cffb9617"

SUPERVISOR = CurrentUser(user_id="sup-1", hotel_id=HOTEL, role="housekeeping_supervisor", email="sup@example.com")


def make_db(room_overrides: dict | None = None, inspections: list[dict] | None = None, results: list[dict] | None = None):
    room_row = {
        "room_id": ROOM_ID,
        "tenant_id": HOTEL,
        "status": "CLEAN",
        "clean_type": "DEP",
        "reclean_requested_at": None,
        **(room_overrides or {}),
    }
    return FakeDB({
        "room_status": [room_row],
        "rooms": [{"id": ROOM_ID, "tenant_id": HOTEL, "room_number": "101"}],
        "room_assignments": [],
        "room_status_history": [],
        "inspections": inspections or [],
        "inspection_results": results or [],
        "inspection_template_items": [
            {"id": TEMPLATE_ITEM_TOWELS, "description": "Missing bath towels"},
            {"id": TEMPLATE_ITEM_MIRROR, "description": "Mirror streaked"},
        ],
        "tasks": [],
    })


def current_room(db):
    return db.rows["room_status"][0]


# ---------------------------------------------------------------------------
# submit_inspection
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_submit_inspection_pass_clears_pending_reclean_flag(monkeypatch):
    db = make_db(room_overrides={"reclean_requested_at": "2026-09-29T10:00:00+00:00"})
    monkeypatch.setattr(hk_router, "supabase", db)

    body = SubmitInspectionRequest(
        room_id=ROOM_ID,
        template_id="ef4ec74d-6127-4d35-91ee-8bbf0676a1c1",
        overall_result="passed",
        items=[InspectionResultItem(template_item_id=TEMPLATE_ITEM_TOWELS, result="pass")],
    )
    await hk_router.submit_inspection(body, SUPERVISOR)

    assert current_room(db)["reclean_requested_at"] is None


@pytest.mark.asyncio
async def test_submit_inspection_fail_does_not_touch_reclean_flag_directly(monkeypatch):
    # The flag is set by the separate /reclean endpoint, not by submit_inspection
    # itself -- a failed inspection alone (without triggering reclean) should not
    # silently flip the flag.
    db = make_db()
    monkeypatch.setattr(hk_router, "supabase", db)

    body = SubmitInspectionRequest(
        room_id=ROOM_ID,
        overall_result="failed",
        notes="Towels missing, mirror streaked",
        items=[
            InspectionResultItem(template_item_id=TEMPLATE_ITEM_TOWELS, result="fail", note=None),
            InspectionResultItem(template_item_id=TEMPLATE_ITEM_MIRROR, result="fail", note=None),
        ],
    )
    await hk_router.submit_inspection(body, SUPERVISOR)

    assert current_room(db)["reclean_requested_at"] is None
    assert len(db.rows["inspection_results"]) == 2


@pytest.mark.asyncio
async def test_legacy_pass_endpoint_rejects_empty_checklists(monkeypatch):
    db = make_db()
    monkeypatch.setattr(hk_router, "supabase", db)

    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        await hk_router.submit_inspection(
            SubmitInspectionRequest(room_id=ROOM_ID, overall_result="passed"),
            SUPERVISOR,
        )
    assert exc_info.value.status_code == 422


# ---------------------------------------------------------------------------
# trigger_reclean
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_trigger_reclean_sets_flag_and_resets_room_to_dirty(monkeypatch):
    inspection_id = "insp-1"
    db = make_db(inspections=[{
        "id": inspection_id, "tenant_id": HOTEL, "room_id": ROOM_ID,
        "overall_result": "failed", "notes": "Towels missing", "inspected_by": SUPERVISOR.user_id,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }])
    monkeypatch.setattr(hk_router, "supabase", db)

    result = await hk_router.trigger_reclean(inspection_id, SUPERVISOR)

    room = current_room(db)
    assert room["status"] == "DIRTY"
    assert room["reclean_requested_at"] is not None
    assert result["data"]["task"]["title"] == "Re-clean Room 101"
    # tasks.priority's real Postgres CHECK constraint only allows
    # urgent/normal/low (not "high") -- FakeDB doesn't enforce CHECK
    # constraints, so this was live-broken (23514) until fixed.
    assert result["data"]["task"]["priority"] in ("urgent", "normal", "low")


@pytest.mark.asyncio
async def test_trigger_reclean_rejects_a_passed_inspection(monkeypatch):
    inspection_id = "insp-2"
    db = make_db(inspections=[{
        "id": inspection_id, "tenant_id": HOTEL, "room_id": ROOM_ID,
        "overall_result": "passed", "notes": None, "inspected_by": SUPERVISOR.user_id,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }])
    monkeypatch.setattr(hk_router, "supabase", db)

    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        await hk_router.trigger_reclean(inspection_id, SUPERVISOR)
    assert exc_info.value.status_code == 400


# ---------------------------------------------------------------------------
# _attach_reclean_corrections (My Rooms enrichment)
# ---------------------------------------------------------------------------

def test_attach_reclean_corrections_lists_failed_items_by_label(monkeypatch):
    db = FakeDB({
        "inspections": [
            {"id": "insp-old", "tenant_id": HOTEL, "room_id": ROOM_ID, "overall_result": "failed", "completed_at": "2026-09-28T10:00:00+00:00"},
            {"id": "insp-new", "tenant_id": HOTEL, "room_id": ROOM_ID, "overall_result": "failed", "completed_at": "2026-09-29T10:00:00+00:00"},
        ],
        "inspection_results": [
            # Belongs to the stale inspection -- must NOT appear in the result.
            {"inspection_id": "insp-old", "tenant_id": HOTEL, "template_item_id": "item-stale", "result": "fail", "note": None},
            # Belongs to the latest inspection.
            {"inspection_id": "insp-new", "tenant_id": HOTEL, "template_item_id": TEMPLATE_ITEM_TOWELS, "result": "fail", "note": None},
            {"inspection_id": "insp-new", "tenant_id": HOTEL, "template_item_id": None, "result": "fail", "note": "Smells like smoke"},
            {"inspection_id": "insp-new", "tenant_id": HOTEL, "template_item_id": TEMPLATE_ITEM_MIRROR, "result": "pass", "note": None},
        ],
        "inspection_template_items": [
            {"id": TEMPLATE_ITEM_TOWELS, "description": "Missing bath towels"},
            {"id": "item-stale", "description": "Old finding"},
        ],
    })
    rows = [{"room_id": ROOM_ID, "reclean_requested_at": "2026-09-29T11:00:00+00:00"}]
    monkeypatch.setattr(hk_router, "supabase", db)

    hk_router._attach_reclean_corrections(rows, HOTEL)

    assert rows[0]["reclean_corrections"] == ["Missing bath towels", "Smells like smoke"]


def test_attach_reclean_corrections_skips_rooms_without_the_flag(monkeypatch):
    db = FakeDB({"inspections": [], "inspection_results": [], "inspection_template_items": []})
    rows = [{"room_id": ROOM_ID, "reclean_requested_at": None}]
    monkeypatch.setattr(hk_router, "supabase", db)

    result = hk_router._attach_reclean_corrections(rows, HOTEL)

    assert "reclean_corrections" not in result[0]


# ---------------------------------------------------------------------------
# complete_inspection (checklist finalization)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_complete_inspection_rejects_unanswered_required_items(monkeypatch):
    db = make_db()
    db.rows["inspection_templates"] = [{"id": "ef4ec74d-6127-4d35-91ee-8bbf0676a1c1", "tenant_id": HOTEL, "is_active": True}]
    for item in db.rows["inspection_template_items"]:
        item.update({"tenant_id": HOTEL, "template_id": "ef4ec74d-6127-4d35-91ee-8bbf0676a1c1", "is_required": True, "requires_photo_on_fail": False})
    monkeypatch.setattr(hk_router, "supabase", db)

    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        await hk_router.complete_inspection(
            inspection=json.dumps({"room_id": ROOM_ID, "template_id": "ef4ec74d-6127-4d35-91ee-8bbf0676a1c1", "overall_result": "passed", "items": [{"template_item_id": TEMPLATE_ITEM_TOWELS, "result": "pass"}]}),
            photo_item_ids=[], photos=[], current_user=SUPERVISOR,
        )
    assert exc_info.value.status_code == 422
    assert "required items" in exc_info.value.detail


@pytest.mark.asyncio
async def test_complete_inspection_persists_a_real_checklist_not_an_empty_pass(monkeypatch):
    template_id = "ef4ec74d-6127-4d35-91ee-8bbf0676a1c1"
    db = make_db()
    db.rows["inspection_templates"] = [{"id": template_id, "tenant_id": HOTEL, "is_active": True}]
    for item in db.rows["inspection_template_items"]:
        item.update({"tenant_id": HOTEL, "template_id": template_id, "is_required": True, "requires_photo_on_fail": False})
    monkeypatch.setattr(hk_router, "supabase", db)

    result = await hk_router.complete_inspection(
        inspection=json.dumps({"room_id": ROOM_ID, "template_id": template_id, "overall_result": "passed", "items": [
            {"template_item_id": TEMPLATE_ITEM_TOWELS, "result": "pass"},
            {"template_item_id": TEMPLATE_ITEM_MIRROR, "result": "na"},
        ]}),
        photo_item_ids=[], photos=[], current_user=SUPERVISOR,
    )

    assert result["data"]["overall_result"] == "passed"
    assert len(db.rows["inspection_results"]) == 2
    assert {row["result"] for row in db.rows["inspection_results"]} == {"pass", "na"}
