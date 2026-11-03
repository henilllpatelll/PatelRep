"""Engineering PM + Assets V2, Phase 4: field evidence integrity. A photo backs exactly one place, belongs to the
technician who took it and to the equipment being inspected, and becomes permanent once an inspection is recorded.
Handlers are called directly with the FakeDB that models record_pm_completion() (pm_fakes.py)."""

from __future__ import annotations

import uuid

import pytest

from routers import assets as assets_router
from routers import evidence as evidence_router
from routers import programs as programs_router

from .pm_fakes import PmFakeDB
from .test_pm_foundation import ASSET, ENGINEER, OTHER, TEMPLATE, TENANT, complete, make_db, refused, user


def photo(evidence_id: str, **overrides) -> dict:
    return {
        "id": evidence_id, "tenant_id": TENANT, "collected_by": ENGINEER.user_id, "storage_path": f"{TENANT}/{evidence_id}/a.jpg",
        "evidence_type": "photo", "related_entity_type": "asset", "related_entity_id": ASSET, **overrides,
    }


@pytest.fixture
def db(monkeypatch) -> PmFakeDB:
    database = make_db()
    for module in (assets_router, programs_router, evidence_router):
        monkeypatch.setattr(module, "supabase", database)
    return database


def step(result="passed", **extra) -> dict:
    return {"key": "belt", "label": "Belt", "result": result, **extra}


# ── a photo is accepted only when it is genuinely this technician's, for this equipment ──

@pytest.mark.asyncio
async def test_a_photo_taken_for_this_equipment_by_this_technician_is_recorded_and_linked(db):
    db.rows["evidence_records"] = [photo("ev-1")]
    done = await complete(db, items=[step(evidence=["ev-1"])])
    assert db.rows["evidence_records"][0]["related_entity_type"] == "pm_completion"
    assert db.rows["evidence_records"][0]["related_entity_id"] == done["data"]["id"]


@pytest.mark.asyncio
@pytest.mark.parametrize("override,why", [
    ({"storage_path": None}, "never uploaded"),
    ({"collected_by": "someone-else"}, "taken by another person"),
    ({"related_entity_id": str(uuid.uuid4())}, "taken for other equipment"),
    ({"related_entity_type": "task", "related_entity_id": "t-1"}, "attached to other work"),
    ({"related_entity_type": "pm_completion", "related_entity_id": str(uuid.uuid4())}, "already part of a recorded inspection"),
])
async def test_unusable_evidence_is_refused_and_nothing_is_written(db, override, why):
    db.rows["evidence_records"] = [photo("ev-1", **override)]
    error = await refused(complete(db, items=[step(evidence=["ev-1"])]))
    assert error.status_code == 422, why
    assert db.rows.get("pm_completion_records", []) == []
    assert db.rows["evidence_records"][0]["related_entity_type"] == override.get("related_entity_type", "asset")


@pytest.mark.asyncio
async def test_evidence_from_another_property_still_reads_as_not_found(db):
    db.rows["evidence_records"] = [photo("ev-1", tenant_id=OTHER)]
    error = await refused(complete(db, items=[step(evidence=["ev-1"])]))
    assert error.status_code == 422 and "not found" in str(error.detail)


@pytest.mark.asyncio
async def test_one_photo_cannot_back_two_checklist_items(db):
    db.rows["evidence_records"] = [photo("ev-1")]
    items = [step(requires_evidence=True, evidence=["ev-1"]), {"key": "belt2", "label": "Pulley", "result": "passed", "requires_evidence": True, "evidence": ["ev-1"]}]
    error = await refused(complete(db, items=items))
    assert error.status_code == 422 and "more than once" in str(error.detail)
    assert db.rows.get("pm_completion_records", []) == []


@pytest.mark.asyncio
async def test_a_photo_on_one_item_does_not_satisfy_another_items_requirement(db):
    db.rows["evidence_records"] = [photo("ev-1")]
    items = [step(requires_evidence=True, evidence=["ev-1"]), {"key": "belt2", "label": "Pulley", "result": "passed", "requires_evidence": True}]
    error = await refused(complete(db, items=items))
    assert error.status_code == 422 and "Pulley" in str(error.detail)


@pytest.mark.asyncio
async def test_a_photo_cannot_be_on_an_item_and_in_the_general_photos(db):
    db.rows["evidence_records"] = [photo("ev-1")]
    error = await refused(complete(db, photos=["ev-1"], items=[step(evidence=["ev-1"])]))
    assert error.status_code == 422


# ── the procedure, not the app, decides what needs a photo ──

@pytest.mark.asyncio
async def test_a_controlled_step_cannot_be_recorded_without_its_photo_whatever_the_request_claims(db):
    db.rows["pm_checklist_templates"][0]["items"] = {"checklist": [{"key": "belt", "label": "Belt", "requires_evidence": True}]}
    error = await refused(complete(db, checklist_template_id=TEMPLATE, items=[step(requires_evidence=False)]))
    assert error.status_code == 422 and "Belt" in str(error.detail)
    assert db.rows.get("pm_completion_records", []) == []


@pytest.mark.asyncio
async def test_a_controlled_step_is_recorded_as_controlled_and_n_a_stays_allowed(db):
    db.rows["evidence_records"] = [photo("ev-1")]
    db.rows["pm_checklist_templates"][0]["items"] = {"checklist": [
        {"key": "belt", "label": "Belt", "requires_evidence": True}, {"key": "tag", "label": "Tag", "requires_evidence": True}]}
    await complete(db, checklist_template_id=TEMPLATE, items=[step(evidence=["ev-1"]), {"key": "tag", "label": "Tag", "result": "not_applicable"}])
    recorded = {row["item_key"]: row for row in db.rows["pm_completion_items"]}
    assert recorded["belt"]["requires_evidence"] is True and recorded["tag"]["result"] == "not_applicable"


# ── a replay of an accepted submission is still a replay ──

@pytest.mark.asyncio
async def test_retrying_an_accepted_submission_returns_the_original_even_though_its_photo_is_now_linked(db):
    db.rows["evidence_records"] = [photo("ev-1")]
    submission = str(uuid.uuid4())
    first = await complete(db, submission_id=submission, items=[step(evidence=["ev-1"])])
    again = await complete(db, submission_id=submission, items=[step(evidence=["ev-1"])])
    assert again["meta"]["replayed"] is True and again["data"]["id"] == first["data"]["id"]
    assert len(db.rows["pm_completion_records"]) == 1


@pytest.mark.asyncio
async def test_a_fresh_submission_cannot_reuse_the_photo_of_a_recorded_inspection(db):
    db.rows["evidence_records"] = [photo("ev-1")]
    await complete(db, submission_id=str(uuid.uuid4()), items=[step(evidence=["ev-1"])])
    linked_to = db.rows["evidence_records"][0]["related_entity_id"]
    error = await refused(complete(db, submission_id=str(uuid.uuid4()), items=[step(evidence=["ev-1"])]))
    assert error.status_code == 422 and "already part of a recorded inspection" in str(error.detail)
    assert db.rows["evidence_records"][0]["related_entity_id"] == linked_to and len(db.rows["pm_completion_records"]) == 1


# ── what the technician is told after a recorded inspection ──

@pytest.mark.asyncio
async def test_the_result_carries_the_real_order_numbers_and_the_next_due_date(db):
    done = await complete(db, items=[step("failed", note="frayed")])
    # The fake's work orders carry no number of their own; the API reports whatever the database holds, never an invented one.
    order = done["data"]["corrective_work_orders"][0]
    db_order = db.rows["work_orders"][0]
    assert order["id"] == db_order["id"] and order.get("work_order_number") == db_order.get("work_order_number")
    assert done["data"]["next_due_at"] == db.rows["pm_schedules"][0]["next_due_at"]


# ── recorded evidence is permanent ──

@pytest.mark.asyncio
async def test_recorded_evidence_cannot_be_deleted_or_replaced_but_an_unrecorded_photo_can(db):
    db.rows["evidence_records"] = [photo("ev-1"), photo("ev-2")]
    await complete(db, items=[step(evidence=["ev-1"])])

    error = await refused(evidence_router.delete_evidence_record("ev-1", ENGINEER))
    assert error.status_code == 409
    assert any(row["id"] == "ev-1" for row in db.rows["evidence_records"])

    class Upload:
        content_type, filename = "image/jpeg", "x.jpg"

        async def read(self, _n):
            return b"x"

    replaced = await refused(evidence_router.upload_evidence_file("ev-1", Upload(), ENGINEER))
    assert replaced.status_code == 409

    assert await evidence_router.delete_evidence_record("ev-2", ENGINEER) is None
    assert [row["id"] for row in db.rows["evidence_records"]] == ["ev-1"]


@pytest.mark.asyncio
async def test_another_properties_user_cannot_touch_evidence_at_all(db):
    db.rows["evidence_records"] = [photo("ev-1")]
    error = await refused(evidence_router.delete_evidence_record("ev-1", user("engineer", tenant=OTHER)))
    assert error.status_code == 404
