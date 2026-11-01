"""Work-order checklist contract (engineering mobile redesign, Phase 4): the read model with its readiness summary,
the guarded item update, and the required-item preflight on POST /work-orders/{id}/complete.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from models.requests import (
    CompleteWorkOrderRequest,
    CreateChecklistItemRequest,
    UpdateChecklistItemRequest,
)
from routers import work_orders as wo_router
from tests.smoke.fake_supabase import FakeDB as _SmokeDB

ENGINEER = CurrentUser(user_id="eng-1", hotel_id="hotel-1", role="engineer", email="e@x.com")
OTHER_ENGINEER = CurrentUser(user_id="eng-2", hotel_id="hotel-1", role="engineer", email="e2@x.com")
GM = CurrentUser(user_id="gm-1", hotel_id="hotel-1", role="gm", email="g@x.com")
CHIEF = CurrentUser(user_id="chief-1", hotel_id="hotel-1", role="chief_engineer", email="c@x.com")
OTHER_HOTEL_ENGINEER = CurrentUser(user_id="eng-9", hotel_id="hotel-2", role="engineer", email="x@x.com")


class FakeDB(_SmokeDB):
    """The shared fake plus the two RPCs the completion path calls."""

    def rpc(self, function_name, payload):
        if function_name == "apply_work_order_timing_action":
            return SimpleNamespace(execute=lambda: SimpleNamespace(data={"status": payload["p_action"]}))
        wo = next(r for r in self.rows["work_orders"] if r["id"] == payload["p_work_order_id"])
        wo["status"] = payload["p_new_status"]
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=[wo]))


def _item(item_id, sort_order, *, required=False, done=False, wo="wo-1", tenant="hotel-1", label=None):
    return {
        "id": item_id,
        "tenant_id": tenant,
        "work_order_id": wo,
        "label": label or f"Step {item_id}",
        "is_required": required,
        "is_done": done,
        "done_by": "eng-1" if done else None,
        "done_at": "2026-10-31T10:00:00+00:00" if done else None,
        "sort_order": sort_order,
    }


def _db(items=None, *, status="in_progress", assigned_to="eng-1"):
    return FakeDB(
        {
            "work_orders": [{"id": "wo-1", "tenant_id": "hotel-1", "status": status, "assigned_to": assigned_to, "title": "AC"}],
            "work_order_checklist_items": items or [],
            "operational_audit_events": [],
        }
    )


@pytest.fixture
def install(monkeypatch):
    def _install(db):
        monkeypatch.setattr(wo_router, "supabase", db)
        from services import inventory as inventory_service

        monkeypatch.setattr(inventory_service, "supabase", db)
        return db

    return _install


# ── Read ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_read_returns_items_in_order_with_a_readiness_summary(install):
    install(_db([_item("c", 3), _item("a", 1, required=True, done=True), _item("b", 2, required=True)]))
    res = await wo_router.list_checklist_items("wo-1", ENGINEER)
    assert [i["id"] for i in res["data"]] == ["a", "b", "c"]
    s = res["summary"]
    assert (s["total"], s["completed"], s["required_total"], s["required_completed"], s["ready"]) == (3, 1, 2, 1, False)
    assert s["required_remaining"] == [{"id": "b", "label": "Step b"}]
    assert res["meta"] == {"work_order_status": "in_progress", "editable": True}


@pytest.mark.asyncio
async def test_a_row_without_the_required_column_is_optional(install):
    legacy = _item("a", 1)
    del legacy["is_required"]
    install(_db([legacy]))
    res = await wo_router.list_checklist_items("wo-1", ENGINEER)
    assert res["data"][0]["is_required"] is False and res["summary"]["ready"] is True


@pytest.mark.asyncio
async def test_a_work_order_with_no_checklist_is_empty_and_ready_not_an_error(install):
    install(_db([]))
    res = await wo_router.list_checklist_items("wo-1", ENGINEER)
    assert res["data"] == []
    assert res["summary"] == {"total": 0, "completed": 0, "required_total": 0, "required_completed": 0, "required_remaining": [], "ready": True}


@pytest.mark.asyncio
async def test_a_closed_work_order_reads_as_not_editable(install):
    install(_db([_item("a", 1, done=True)], status="completed"))
    res = await wo_router.list_checklist_items("wo-1", ENGINEER)
    assert res["meta"]["editable"] is False and res["data"][0]["is_done"] is True


@pytest.mark.asyncio
async def test_read_in_another_hotel_is_404_and_leaks_no_items(install):
    install(_db([_item("a", 1)]))
    with pytest.raises(HTTPException) as err:
        await wo_router.list_checklist_items("wo-1", OTHER_HOTEL_ENGINEER)
    assert err.value.status_code == 404


@pytest.mark.asyncio
async def test_items_from_another_hotel_never_appear_in_the_read(install):
    install(_db([_item("a", 1), _item("x", 2, tenant="hotel-2")]))
    res = await wo_router.list_checklist_items("wo-1", ENGINEER)
    assert [i["id"] for i in res["data"]] == ["a"]


# ── Update ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_assigned_engineer_marks_a_step_done_and_gets_the_new_summary(install):
    db = install(_db([_item("a", 1, required=True)]))
    res = await wo_router.update_checklist_item("wo-1", "a", UpdateChecklistItemRequest(is_done=True), ENGINEER)
    assert res["data"]["is_done"] is True and res["data"]["done_by"] == "eng-1" and res["data"]["done_at"]
    assert res["summary"]["ready"] is True
    assert db.rows["operational_audit_events"][0]["action"] == "work_order.checklist_item_updated"


@pytest.mark.asyncio
async def test_reopening_clears_who_and_when(install):
    install(_db([_item("a", 1, required=True, done=True)]))
    res = await wo_router.update_checklist_item("wo-1", "a", UpdateChecklistItemRequest(is_done=False), ENGINEER)
    assert res["data"]["is_done"] is False and res["data"]["done_by"] is None and res["data"]["done_at"] is None
    assert res["summary"]["ready"] is False


@pytest.mark.asyncio
async def test_repeating_the_current_state_keeps_the_original_done_by(install):
    db = install(_db([_item("a", 1, done=True)]))
    db.rows["work_order_checklist_items"][0]["done_by"] = "someone-else"
    res = await wo_router.update_checklist_item("wo-1", "a", UpdateChecklistItemRequest(is_done=True), ENGINEER)
    assert res["data"]["done_by"] == "someone-else"
    assert db.rows["operational_audit_events"] == []


@pytest.mark.asyncio
async def test_an_engineer_cannot_update_another_engineers_order(install):
    install(_db([_item("a", 1)], assigned_to="eng-1"))
    with pytest.raises(HTTPException) as err:
        await wo_router.update_checklist_item("wo-1", "a", UpdateChecklistItemRequest(is_done=True), OTHER_ENGINEER)
    assert err.value.status_code == 403


@pytest.mark.asyncio
async def test_a_step_from_another_work_order_is_404(install):
    db = install(_db([_item("a", 1, wo="wo-2")]))
    with pytest.raises(HTTPException) as err:
        await wo_router.update_checklist_item("wo-1", "a", UpdateChecklistItemRequest(is_done=True), ENGINEER)
    assert err.value.status_code == 404
    assert db.rows["work_order_checklist_items"][0]["is_done"] is False


@pytest.mark.asyncio
async def test_a_step_in_another_hotel_is_404_and_not_written(install):
    db = install(_db([_item("a", 1, tenant="hotel-2")]))
    with pytest.raises(HTTPException) as err:
        await wo_router.update_checklist_item("wo-1", "a", UpdateChecklistItemRequest(is_done=True), ENGINEER)
    assert err.value.status_code == 404
    assert db.rows["work_order_checklist_items"][0]["is_done"] is False


@pytest.mark.asyncio
async def test_another_hotels_user_gets_404_for_the_work_order(install):
    install(_db([_item("a", 1)]))
    with pytest.raises(HTTPException) as err:
        await wo_router.update_checklist_item("wo-1", "a", UpdateChecklistItemRequest(is_done=True), OTHER_HOTEL_ENGINEER)
    assert err.value.status_code == 404


@pytest.mark.parametrize("status", ["completed", "cancelled"])
@pytest.mark.asyncio
async def test_a_closed_work_order_checklist_is_read_only(install, status):
    db = install(_db([_item("a", 1, done=True)], status=status))
    with pytest.raises(HTTPException) as err:
        await wo_router.update_checklist_item("wo-1", "a", UpdateChecklistItemRequest(is_done=False), GM)
    assert err.value.status_code == 409 and err.value.detail["code"] == "work_order_closed"
    assert db.rows["work_order_checklist_items"][0]["is_done"] is True


@pytest.mark.asyncio
async def test_a_concurrent_update_is_not_overwritten(install):
    class RaceDB(FakeDB):
        flipped = False

        def table(self, name):
            q = super().table(name)
            if name == "work_order_checklist_items" and not self.flipped:
                original = q.update

                def update(payload):
                    # Another person completes the step between our read and our write.
                    self.flipped = True
                    row = self.rows["work_order_checklist_items"][0]
                    row.update({"is_done": True, "done_by": "eng-2", "done_at": "2026-10-31T11:00:00+00:00"})
                    return original(payload)

                q.update = update
            return q

    db = RaceDB({
        "work_orders": [{"id": "wo-1", "tenant_id": "hotel-1", "status": "in_progress", "assigned_to": "eng-1"}],
        "work_order_checklist_items": [_item("a", 1)],
        "operational_audit_events": [],
    })
    install(db)
    res = await wo_router.update_checklist_item("wo-1", "a", UpdateChecklistItemRequest(is_done=True), ENGINEER)
    assert res["data"]["is_done"] is True and res["data"]["done_by"] == "eng-2"


def test_the_update_body_requires_a_boolean():
    with pytest.raises(Exception):
        UpdateChecklistItemRequest()


@pytest.mark.asyncio
async def test_chief_engineer_keeps_the_web_console_checklist_access(install):
    """Documented deviation: the web console lets the chief toggle steps; the mobile app does not offer it."""
    install(_db([_item("a", 1)], assigned_to="eng-1"))
    res = await wo_router.update_checklist_item("wo-1", "a", UpdateChecklistItemRequest(is_done=True), CHIEF)
    assert res["data"]["is_done"] is True


@pytest.mark.asyncio
async def test_adding_a_required_step_by_hand_is_saved_as_required(install):
    install(_db([_item("a", 1)]))
    res = await wo_router.add_checklist_item("wo-1", CreateChecklistItemRequest(label="Lockout/tagout", is_required=True), GM)
    assert res["data"]["is_required"] is True and res["data"]["sort_order"] == 2


# ── Template seeding ─────────────────────────────────────────────────────────

def test_seeding_copies_the_required_flag_only_when_it_is_set(monkeypatch):
    db = FakeDB({
        "work_order_checklist_templates": [{"id": "t1", "tenant_id": "hotel-1", "category": "hvac", "is_active": True}],
        "work_order_checklist_template_items": [
            {"id": "i1", "tenant_id": "hotel-1", "template_id": "t1", "label": "Lock out", "sort_order": 1, "is_required": True},
            {"id": "i2", "tenant_id": "hotel-1", "template_id": "t1", "label": "Photo", "sort_order": 2},
        ],
        "work_order_checklist_items": [],
    })
    monkeypatch.setattr(wo_router, "supabase", db)
    wo_router._seed_checklist_from_template("wo-9", "hvac", "hotel-1")
    rows = {r["label"]: r for r in db.rows["work_order_checklist_items"]}
    assert rows["Lock out"]["is_required"] is True
    assert "is_required" not in rows["Photo"]


# ── Completion ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_completion_is_rejected_while_a_required_step_is_open_and_changes_nothing(install):
    db = install(_db([_item("a", 1, required=True, label="Lock out"), _item("b", 2, required=True, done=True), _item("c", 3)]))
    with pytest.raises(HTTPException) as err:
        await wo_router.complete_work_order("wo-1", CompleteWorkOrderRequest(verification_result="passed"), ENGINEER)
    assert err.value.status_code == 422
    assert err.value.detail["code"] == "checklist_incomplete"
    assert err.value.detail["remaining"] == [{"id": "a", "label": "Lock out"}]
    assert err.value.detail["applied"] is False
    assert db.rows["work_orders"][0]["status"] == "in_progress"


@pytest.mark.asyncio
async def test_optional_open_steps_never_block_completion(install):
    db = install(_db([_item("a", 1), _item("b", 2, required=True, done=True)]))
    await wo_router.complete_work_order("wo-1", CompleteWorkOrderRequest(verification_result="passed"), ENGINEER)
    assert db.rows["work_orders"][0]["status"] == "completed"


@pytest.mark.asyncio
async def test_completion_succeeds_when_every_required_step_is_done(install):
    db = install(_db([_item("a", 1, required=True, done=True)]))
    await wo_router.complete_work_order("wo-1", CompleteWorkOrderRequest(verification_result="passed"), ENGINEER)
    assert db.rows["work_orders"][0]["status"] == "completed"


@pytest.mark.asyncio
async def test_a_work_order_with_no_checklist_still_completes(install):
    db = install(_db([]))
    await wo_router.complete_work_order("wo-1", CompleteWorkOrderRequest(verification_result="passed"), ENGINEER)
    assert db.rows["work_orders"][0]["status"] == "completed"


@pytest.mark.asyncio
async def test_a_completion_replay_on_a_required_incomplete_order_is_rejected_the_same_way(install):
    install(_db([_item("a", 1, required=True)]))
    for _ in range(2):
        with pytest.raises(HTTPException) as err:
            await wo_router.complete_work_order("wo-1", CompleteWorkOrderRequest(), ENGINEER)
        assert err.value.detail["code"] == "checklist_incomplete"


@pytest.mark.asyncio
async def test_replaying_a_completion_on_an_already_completed_order_is_not_a_checklist_error(install):
    """Legacy and finished orders keep their existing answer; the new rule never re-judges a closed record."""
    install(_db([_item("a", 1, required=True)], status="completed"))
    with pytest.raises(HTTPException) as err:
        await wo_router.complete_work_order("wo-1", CompleteWorkOrderRequest(), ENGINEER)
    assert not (isinstance(err.value.detail, dict) and err.value.detail.get("code") == "checklist_incomplete")


@pytest.mark.asyncio
async def test_a_failed_verification_is_recorded_even_with_required_steps_open(install):
    db = install(_db([_item("a", 1, required=True)]))
    with pytest.raises(HTTPException) as err:
        await wo_router.complete_work_order(
            "wo-1", CompleteWorkOrderRequest(verification_result="failed", verification_notes="Still warm"), ENGINEER
        )
    assert err.value.status_code == 409
    assert db.rows["work_orders"][0]["verification_result"] == "failed"
    assert db.rows["work_orders"][0]["status"] == "in_progress"


@pytest.mark.asyncio
async def test_reopening_a_required_step_blocks_a_later_completion(install):
    db = install(_db([_item("a", 1, required=True, done=True)]))
    await wo_router.update_checklist_item("wo-1", "a", UpdateChecklistItemRequest(is_done=False), ENGINEER)
    with pytest.raises(HTTPException) as err:
        await wo_router.complete_work_order("wo-1", CompleteWorkOrderRequest(), ENGINEER)
    assert err.value.status_code == 422
    assert db.rows["work_orders"][0]["status"] == "in_progress"
