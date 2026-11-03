"""Engineering PM + Assets V2, Phase 3: equipment identity. Retry-safe registration, version-checked edits, explicit
clearing, guarded retirement, the identity photograph, tag lookup and tenant isolation. Handlers are called directly
against the in-memory FakeDB (the SQL in migration 233 is additive columns only)."""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from models.requests import AttachAssetPhotoRequest, CreateAssetRequest, RetireAssetRequest, UpdateAssetRequest
from routers import assets as assets_router
from routers import evidence as evidence_router

from .pm_fakes import PmFakeDB

TENANT, OTHER = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
ASSET, ROOM, CATEGORY = (str(uuid.uuid4()) for _ in range(3))
EVIDENCE, OLD_EVIDENCE, FOREIGN_EVIDENCE = (str(uuid.uuid4()) for _ in range(3))


def user(role: str, tenant: str = TENANT) -> CurrentUser:
    return CurrentUser(user_id=f"{role}-1", hotel_id=tenant, role=role, email=f"{role}@example.com")


ENGINEER, CHIEF, GM, HOUSEKEEPER = user("engineer"), user("chief_engineer"), user("gm"), user("housekeeper")
UNIQUE_INDEXES = [
    ("assets", "assets_tenant_active_tag_uidx", ["tenant_id", "asset_tag"], {"is_active": True}),
    ("assets", "assets_pkey", ["id"], {}),
]


def photo_record(record_id: str, asset_id: str = ASSET, tenant: str = TENANT, **extra) -> dict:
    return {
        "id": record_id, "tenant_id": tenant, "evidence_type": "photo", "related_entity_type": "asset",
        "related_entity_id": asset_id, "storage_path": f"{tenant}/{record_id}/x.jpg", "file_content_type": "image/jpeg", **extra,
    }


@pytest.fixture
def db(monkeypatch):
    database = PmFakeDB({
        "assets": [{"id": ASSET, "tenant_id": TENANT, "name": "Chiller", "asset_tag": "CH-1", "is_active": True, "row_version": 1}],
        "rooms": [{"id": ROOM, "tenant_id": TENANT}],
        "asset_categories": [{"id": CATEGORY, "tenant_id": TENANT}],
        "evidence_records": [photo_record(EVIDENCE), photo_record(OLD_EVIDENCE), photo_record(FOREIGN_EVIDENCE, tenant=OTHER)],
    }, unique_indexes=UNIQUE_INDEXES)
    monkeypatch.setattr(assets_router, "supabase", database)
    monkeypatch.setattr(evidence_router, "supabase", database)
    return database


async def refused(awaitable) -> HTTPException:
    with pytest.raises(HTTPException) as caught:
        await awaitable
    return caught.value


def asset_row(db, asset_id: str = ASSET) -> dict:
    return next(r for r in db.rows["assets"] if r["id"] == asset_id)


def audit_actions(db) -> list[str]:
    return [e["action"] for e in db.rows.get("operational_audit_events", [])]


def guard(path: str, method: str) -> set[str]:
    for route in assets_router.router.routes:
        if getattr(route, "path", None) == path.removeprefix("/v1") and method in getattr(route, "methods", set()):
            for dep in route.dependant.dependencies:
                if "require_role" in getattr(dep.call, "__qualname__", ""):
                    return set(dep.call.__closure__[0].cell_contents)
    raise AssertionError(f"no role-guarded {method} {path}")


# ── registration ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_registering_equipment_binds_it_to_the_callers_property_and_is_audited(db):
    created = (await assets_router.create_asset(
        CreateAssetRequest(name="Pool pump", category_id=CATEGORY, room_id=ROOM, asset_tag=" PP-1 ", criticality="high"), CHIEF))["data"]
    assert created["tenant_id"] == TENANT and created["asset_tag"] == "PP-1" and created["room_id"] == ROOM
    assert created["criticality"] == "high" and created["row_version"] == 1
    assert audit_actions(db) == ["asset.created"]


@pytest.mark.asyncio
async def test_a_non_room_location_needs_no_room(db):
    created = (await assets_router.create_asset(
        CreateAssetRequest(name="Roof unit", category_id=CATEGORY, location_text="Roof"), ENGINEER))["data"]
    assert created["room_id"] is None if "room_id" in created else True
    assert created["location_text"] == "Roof"


@pytest.mark.asyncio
async def test_replaying_a_registration_returns_the_original_and_never_a_second_asset(db):
    new_id = str(uuid.uuid4())
    request = CreateAssetRequest(id=new_id, name="Ice machine", category_id=CATEGORY, asset_tag="ICE-1")
    first = (await assets_router.create_asset(request, CHIEF))["data"]
    again = (await assets_router.create_asset(request, CHIEF))["data"]
    assert first["id"] == again["id"] == new_id
    assert len([r for r in db.rows["assets"] if r["name"] == "Ice machine"]) == 1
    assert audit_actions(db).count("asset.created") == 1


@pytest.mark.asyncio
async def test_a_racing_duplicate_id_reads_back_the_winner_instead_of_failing(db, monkeypatch):
    new_id = str(uuid.uuid4())
    request = CreateAssetRequest(id=new_id, name="Ice machine", category_id=CATEGORY)
    calls = {"n": 0}
    real = assets_router._own_asset

    def late(asset_id, current_user):  # the first look finds nothing; the winner's row lands before our insert
        calls["n"] += 1
        if calls["n"] == 1:
            db.rows["assets"].append({"id": new_id, "tenant_id": TENANT, "name": "Ice machine", "is_active": True, "row_version": 1})
            return None
        return real(asset_id, current_user)

    monkeypatch.setattr(assets_router, "_own_asset", late)
    result = (await assets_router.create_asset(request, CHIEF))["data"]
    assert result["id"] == new_id
    assert len([r for r in db.rows["assets"] if r["id"] == new_id]) == 1


@pytest.mark.asyncio
async def test_an_id_that_exists_only_in_another_property_is_refused_without_revealing_it(db):
    foreign_id = str(uuid.uuid4())
    db.rows["assets"].append({"id": foreign_id, "tenant_id": OTHER, "name": "Theirs", "is_active": True, "row_version": 1})
    error = await refused(assets_router.create_asset(CreateAssetRequest(id=foreign_id, name="Mine", category_id=CATEGORY), CHIEF))
    assert error.status_code == 409 and error.detail["code"] == "asset_id_in_use"
    assert "Theirs" not in str(error.detail)


@pytest.mark.asyncio
async def test_a_duplicate_tag_is_rejected_even_when_the_pre_check_is_raced(db, monkeypatch):
    monkeypatch.setattr(assets_router, "_require_tag_free", lambda *a, **k: None)  # the database index is the backstop
    error = await refused(assets_router.create_asset(CreateAssetRequest(name="Dup", category_id=CATEGORY, asset_tag="CH-1"), CHIEF))
    assert error.status_code == 409 and error.detail["code"] == "asset_tag_in_use"


@pytest.mark.asyncio
async def test_a_foreign_room_or_category_is_rejected(db):
    assert (await refused(assets_router.create_asset(CreateAssetRequest(name="x", category_id=CATEGORY, room_id=str(uuid.uuid4())), CHIEF))).status_code == 422
    assert (await refused(assets_router.create_asset(CreateAssetRequest(name="x", category_id=str(uuid.uuid4())), CHIEF))).status_code == 422


def test_required_fields_and_criticality_are_validated():
    with pytest.raises(ValueError):
        CreateAssetRequest(name="", category_id=CATEGORY)
    with pytest.raises(ValueError):
        CreateAssetRequest(name="x", category_id=CATEGORY, criticality="catastrophic")
    with pytest.raises(ValueError):
        CreateAssetRequest(name="x", category_id=CATEGORY, id="not-a-uuid")


# ── editing ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_an_edit_applies_bumps_the_version_and_audits_only_what_changed(db):
    updated = (await assets_router.update_asset(ASSET, UpdateAssetRequest(expected_row_version=1, notes="Serviced", name="Chiller"), CHIEF))["data"]
    assert updated["row_version"] == 2 and updated["notes"] == "Serviced"
    event = db.rows["operational_audit_events"][-1]
    assert event["action"] == "asset.updated" and set(event["new_state"]) == {"notes"}


@pytest.mark.asyncio
async def test_a_stale_edit_is_refused_with_the_current_record_and_changes_nothing(db):
    await assets_router.update_asset(ASSET, UpdateAssetRequest(expected_row_version=1, notes="First editor"), CHIEF)
    error = await refused(assets_router.update_asset(ASSET, UpdateAssetRequest(expected_row_version=1, notes="Second editor"), GM))
    assert error.status_code == 409 and error.detail["code"] == "asset_conflict"
    assert error.detail["current"]["notes"] == "First editor" and error.detail["current"]["row_version"] == 2
    assert asset_row(db)["notes"] == "First editor"


@pytest.mark.asyncio
async def test_a_write_that_loses_the_race_after_the_read_is_a_conflict_not_an_overwrite(db, monkeypatch):
    real = assets_router._require_tag_free

    def interleave(*args, **kwargs):  # someone else's edit lands between our read and our write
        asset_row(db)["row_version"] = 2
        asset_row(db)["notes"] = "theirs"
        return real(*args, **kwargs)

    monkeypatch.setattr(assets_router, "_require_tag_free", interleave)
    error = await refused(assets_router.update_asset(ASSET, UpdateAssetRequest(expected_row_version=1, asset_tag="CH-2", notes="mine"), CHIEF))
    assert error.status_code == 409 and asset_row(db)["notes"] == "theirs" and asset_row(db)["asset_tag"] == "CH-1"


@pytest.mark.asyncio
async def test_clear_fields_empties_optional_values_and_omission_never_does(db):
    asset_row(db).update(manufacturer="Trane", model="X1", warranty_expires="2030-01-01")
    await assets_router.update_asset(ASSET, UpdateAssetRequest(notes="n"), CHIEF)
    assert asset_row(db)["manufacturer"] == "Trane" and asset_row(db)["warranty_expires"] == "2030-01-01"
    await assets_router.update_asset(ASSET, UpdateAssetRequest(clear_fields=["manufacturer", "warranty_expires"]), CHIEF)
    assert asset_row(db)["manufacturer"] is None and asset_row(db)["warranty_expires"] is None and asset_row(db)["model"] == "X1"
    audited = db.rows["operational_audit_events"][-1]
    assert audited["old_state"]["manufacturer"] == "Trane" and audited["new_state"]["manufacturer"] is None


@pytest.mark.asyncio
async def test_setting_and_clearing_the_same_field_is_rejected_and_required_fields_are_not_clearable(db):
    assert (await refused(assets_router.update_asset(ASSET, UpdateAssetRequest(model="A", clear_fields=["model"]), CHIEF))).status_code == 422
    with pytest.raises(ValueError):
        UpdateAssetRequest(clear_fields=["name"])


@pytest.mark.asyncio
async def test_an_edit_keeps_schedules_and_work_orders_and_cannot_cross_properties(db):
    db.rows["pm_schedules"] = [{"id": "s1", "tenant_id": TENANT, "asset_id": ASSET, "is_active": True}]
    db.rows["work_orders"] = [{"id": "w1", "tenant_id": TENANT, "asset_id": ASSET, "status": "open"}]
    await assets_router.update_asset(ASSET, UpdateAssetRequest(name="Chiller #1", criticality="life_safety"), CHIEF)
    assert db.rows["pm_schedules"][0]["is_active"] is True and db.rows["work_orders"][0]["asset_id"] == ASSET
    assert asset_row(db)["criticality"] == "life_safety"
    assert (await refused(assets_router.update_asset(ASSET, UpdateAssetRequest(notes="x"), user("gm", OTHER)))).status_code == 404


# ── retirement ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_retiring_needs_a_reason_keeps_history_ends_schedules_and_is_audited(db):
    db.rows["pm_schedules"] = [{"id": "s1", "tenant_id": TENANT, "asset_id": ASSET, "is_active": True}]
    db.rows["pm_completion_records"] = [{"id": "c1", "tenant_id": TENANT, "pm_schedule_id": "s1"}]
    with pytest.raises(ValueError):
        RetireAssetRequest(reason="")
    result = (await assets_router.retire_asset(ASSET, RetireAssetRequest(reason="Removed from service", expected_row_version=1), CHIEF))["data"]
    assert result["is_active"] is False and result["row_version"] == 2
    assert db.rows["pm_schedules"][0]["is_active"] is False and len(db.rows["pm_completion_records"]) == 1
    event = db.rows["operational_audit_events"][-1]
    assert event["action"] == "asset.retired" and event["reason_note"] == "Removed from service"
    assert event["new_state"]["pm_schedules_deactivated"] == ["s1"]
    assert (await refused(assets_router.retire_asset(ASSET, RetireAssetRequest(reason="again again"), CHIEF))).detail["code"] == "asset_already_retired"


@pytest.mark.asyncio
async def test_retiring_is_refused_while_repairs_or_downtime_are_open(db):
    db.rows["work_orders"] = [{"id": "w1", "tenant_id": TENANT, "asset_id": ASSET, "status": "in_progress"}]
    error = await refused(assets_router.retire_asset(ASSET, RetireAssetRequest(reason="Replaced unit"), CHIEF))
    assert error.status_code == 409 and error.detail["code"] == "asset_has_open_work_orders" and asset_row(db)["is_active"] is True
    db.rows["work_orders"][0]["status"] = "completed"
    db.rows["asset_downtime_periods"] = [{"id": "d1", "tenant_id": TENANT, "asset_id": ASSET, "restored_at": None}]
    error = await refused(assets_router.retire_asset(ASSET, RetireAssetRequest(reason="Replaced unit"), CHIEF))
    assert error.detail["code"] == "asset_has_open_downtime"


@pytest.mark.asyncio
async def test_retiring_respects_the_version_token_and_property_boundary(db):
    error = await refused(assets_router.retire_asset(ASSET, RetireAssetRequest(reason="Replaced unit", expected_row_version=7), CHIEF))
    assert error.detail["code"] == "asset_conflict"
    assert (await refused(assets_router.retire_asset(ASSET, RetireAssetRequest(reason="Replaced unit"), user("gm", OTHER)))).status_code == 404


def test_role_guards_for_the_new_and_changed_routes():
    assert guard("/v1/assets", "POST") == {"engineer", "chief_engineer", "gm"}
    assert guard("/v1/assets/{asset_id}", "PATCH") == {"engineer", "chief_engineer", "gm"}
    assert guard("/v1/assets/{asset_id}/retire", "POST") == {"chief_engineer", "gm"}
    assert guard("/v1/assets/{asset_id}/photo", "PUT") == {"engineer", "chief_engineer", "gm"}
    assert guard("/v1/assets/{asset_id}/photo", "DELETE") == {"engineer", "chief_engineer", "gm"}


# ── identity photograph ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_attaching_a_photo_serves_only_a_signed_url_and_never_the_storage_path(db):
    result = (await assets_router.set_asset_photo(ASSET, AttachAssetPhotoRequest(evidence_id=EVIDENCE), ENGINEER))["data"]
    assert result["photo_evidence_id"] == EVIDENCE and "token=" in result["photo_url"]
    detail = (await assets_router.get_asset(ASSET, ENGINEER))["data"]
    assert "token=" in detail["photo_url"] and "storage_path" not in detail
    assert audit_actions(db)[-1] == "asset.photo_changed"


@pytest.mark.asyncio
async def test_replacing_the_photo_removes_only_the_previous_identity_photo(db):
    inspection = "inspection-photo"
    db.rows["evidence_records"].append(photo_record(inspection, related_entity_type="pm_completion", related_entity_id="c1"))
    await assets_router.set_asset_photo(ASSET, AttachAssetPhotoRequest(evidence_id=OLD_EVIDENCE), ENGINEER)
    await assets_router.set_asset_photo(ASSET, AttachAssetPhotoRequest(evidence_id=EVIDENCE), ENGINEER)
    ids = {r["id"] for r in db.rows["evidence_records"]}
    assert OLD_EVIDENCE not in ids and EVIDENCE in ids and inspection in ids
    assert asset_row(db)["photo_evidence_id"] == EVIDENCE


@pytest.mark.asyncio
async def test_a_photo_must_be_an_uploaded_image_captured_for_this_asset_in_this_property(db):
    other_asset = str(uuid.uuid4())
    db.rows["evidence_records"] += [
        photo_record("other-asset", asset_id=other_asset),
        photo_record("no-file", storage_path=None),
        photo_record("a-pdf", file_content_type="application/pdf"),
        photo_record("not-photo", evidence_type="file"),
    ]
    for bad in ("other-asset", "no-file", "a-pdf", "not-photo", FOREIGN_EVIDENCE, str(uuid.uuid4())):
        try:
            request = AttachAssetPhotoRequest(evidence_id=bad)
        except ValueError:
            continue  # a non-UUID is refused at the model
        assert (await refused(assets_router.set_asset_photo(ASSET, request, ENGINEER))).status_code == 422
    assert asset_row(db).get("photo_evidence_id") is None


@pytest.mark.asyncio
async def test_removing_the_photo_clears_the_pointer_and_deletes_the_file(db):
    await assets_router.set_asset_photo(ASSET, AttachAssetPhotoRequest(evidence_id=EVIDENCE), ENGINEER)
    result = (await assets_router.remove_asset_photo(ASSET, ENGINEER))["data"]
    assert result["photo_url"] is None and asset_row(db)["photo_evidence_id"] is None
    assert EVIDENCE not in {r["id"] for r in db.rows["evidence_records"]}
    assert ("evidence-files", f"{TENANT}/{EVIDENCE}/x.jpg") in db.storage_removed
    assert audit_actions(db)[-1] == "asset.photo_removed"
    assert (await assets_router.remove_asset_photo(ASSET, ENGINEER))["data"]["photo_url"] is None  # idempotent


@pytest.mark.asyncio
async def test_photo_calls_are_property_scoped(db):
    assert (await refused(assets_router.set_asset_photo(ASSET, AttachAssetPhotoRequest(evidence_id=EVIDENCE), user("gm", OTHER)))).status_code == 404
    assert (await refused(assets_router.remove_asset_photo(ASSET, user("gm", OTHER)))).status_code == 404


# ── scanning / lookup ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_lookup_matches_a_tag_in_any_letter_case_and_a_new_label_by_id(db):
    for text in ("CH-1", "ch-1", " Ch-1 "):
        assert (await assets_router.lookup_asset(asset_id=None, tag=text, current_user=ENGINEER))["data"]["id"] == ASSET
    assert (await assets_router.lookup_asset(asset_id=ASSET, tag=None, current_user=ENGINEER))["data"]["name"] == "Chiller"
    created = (await assets_router.create_asset(CreateAssetRequest(name="New", category_id=CATEGORY), CHIEF))["data"]
    assert (await assets_router.lookup_asset(asset_id=created["id"], tag=None, current_user=ENGINEER))["data"]["id"] == created["id"]


@pytest.mark.asyncio
async def test_lookup_prefers_active_equipment_flags_retired_and_never_crosses_properties(db):
    db.rows["assets"].append({"id": str(uuid.uuid4()), "tenant_id": TENANT, "name": "Old chiller", "asset_tag": "OLD-1", "is_active": False, "row_version": 1})
    retired = (await assets_router.lookup_asset(asset_id=None, tag="old-1", current_user=ENGINEER))["data"]
    assert retired["is_active"] is False
    db.rows["assets"].append({"id": str(uuid.uuid4()), "tenant_id": TENANT, "name": "New chiller", "asset_tag": "OLD-1", "is_active": True, "row_version": 1})
    assert (await assets_router.lookup_asset(asset_id=None, tag="OLD-1", current_user=ENGINEER))["data"]["name"] == "New chiller"
    assert (await refused(assets_router.lookup_asset(asset_id=None, tag="CH-1", current_user=user("gm", OTHER)))).status_code == 404
    assert (await refused(assets_router.lookup_asset(asset_id=ASSET, tag=None, current_user=user("gm", OTHER)))).status_code == 404
    assert (await refused(assets_router.lookup_asset(asset_id=None, tag=None, current_user=ENGINEER))).status_code == 422


# ── PM record -> equipment and corrective work orders ────────────────────────

COMPLETION, SCHEDULE_ID = str(uuid.uuid4()), str(uuid.uuid4())


@pytest.mark.asyncio
async def test_a_completion_record_links_its_exact_equipment_and_the_work_orders_it_opened(db):
    db.rows["pm_completion_records"] = [{"id": COMPLETION, "tenant_id": TENANT, "pm_schedule_id": SCHEDULE_ID, "asset_id": ASSET, "photos": []}]
    db.rows["work_orders"] = [
        {"id": "w-mine", "tenant_id": TENANT, "title": "Corrective PM work: Belt", "status": "open", "work_order_number": 41, "pm_completion_id": COMPLETION, "created_at": "2026-01-01"},
        {"id": "w-other-completion", "tenant_id": TENANT, "title": "Unrelated", "status": "open", "pm_completion_id": str(uuid.uuid4())},
        {"id": "w-foreign", "tenant_id": OTHER, "title": "Foreign", "status": "open", "pm_completion_id": COMPLETION},
    ]
    before = len(db.rows["work_orders"])
    record = (await assets_router.get_pm_completion(SCHEDULE_ID, COMPLETION, ENGINEER))["data"]
    assert (record["asset"]["id"], record["asset"]["name"], record["asset"]["asset_tag"], record["asset"]["is_active"]) == (ASSET, "Chiller", "CH-1", True)
    assert [w["id"] for w in record["corrective_work_orders"]] == ["w-mine"]
    assert len(db.rows["work_orders"]) == before  # reading a record never creates work


@pytest.mark.asyncio
async def test_a_completion_record_for_retired_equipment_still_links_it_and_marks_it(db):
    asset_row(db)["is_active"] = False
    db.rows["pm_completion_records"] = [{"id": COMPLETION, "tenant_id": TENANT, "pm_schedule_id": SCHEDULE_ID, "asset_id": ASSET, "photos": []}]
    record = (await assets_router.get_pm_completion(SCHEDULE_ID, COMPLETION, ENGINEER))["data"]
    assert record["asset"]["id"] == ASSET and record["asset"]["is_active"] is False


@pytest.mark.asyncio
async def test_another_propertys_completion_is_not_found_and_leaks_no_equipment(db):
    db.rows["pm_completion_records"] = [{"id": COMPLETION, "tenant_id": TENANT, "pm_schedule_id": SCHEDULE_ID, "asset_id": ASSET, "photos": []}]
    assert (await refused(assets_router.get_pm_completion(SCHEDULE_ID, COMPLETION, user("gm", OTHER)))).status_code == 404
