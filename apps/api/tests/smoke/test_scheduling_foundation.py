"""Scheduling API: integrity, authorization, tenant isolation, concurrency and compatibility (FakeDB, handlers called directly)."""
from datetime import date, datetime, timedelta, timezone

import pytest
from dateutil import tz
from postgrest.exceptions import APIError
from pydantic import ValidationError

from core.errors import CodedHTTPException
from middleware.auth import CurrentUser
from models.requests import (
    BulkShiftAssignmentItem,
    BulkShiftAssignmentRequest,
    CreateShiftAssignmentRequest,
    CreateShiftRequest,
    UpdateShiftAssignmentRequest,
    UpdateShiftRequest,
)
from routers import scheduling as sched
from routers import scheduling_team as team
from routers import shifts as shifts_router
from services import scheduling_access as access

from .fake_supabase import FakeDB

HOTEL, OTHER = "hotel-a", "hotel-b"
D_HK, D_ENG, D_OTHER = "d0000001-0000-4000-8000-000000000001", "d0000002-0000-4000-8000-000000000002", "d0000003-0000-4000-8000-000000000003"
U_HK1, U_HK2, U_ENG, U_INACTIVE, U_OTHER, U_GM, U_SUP, U_NODEPT = (
    f"a000000{i}-0000-4000-8000-00000000000{i}" for i in range(1, 9)
)
S_MORN, S_EVE, S_NIGHT, S_ENG, S_OTHER = (f"c000000{i}-0000-4000-8000-00000000000{i}" for i in range(1, 6))
DAY = date(2030, 1, 8)  # a Tuesday, far from "today" so the fixtures never depend on the current date

GM = CurrentUser(user_id=U_GM, hotel_id=HOTEL, role="gm", email="gm@x.test")
SUP = CurrentUser(user_id=U_SUP, hotel_id=HOTEL, role="housekeeping_supervisor", email="s@x.test")
ENGINEER = CurrentUser(user_id=U_ENG, hotel_id=HOTEL, role="engineer", email="e@x.test")
HK = CurrentUser(user_id=U_HK1, hotel_id=HOTEL, role="housekeeper", email="h@x.test")
CHIEF = CurrentUser(user_id="a0000099-0000-4000-8000-000000000099", hotel_id=HOTEL, role="chief_engineer", email="c@x.test")


def shift(id, name, dept, start, end, tenant=HOTEL, **extra):
    return {"id": id, "tenant_id": tenant, "name": name, "department_id": dept, "start_time": start, "end_time": end,
            "is_active": True, "archived_at": None, "version": 1, **extra}


def role(user, role_name, dept, tenant=HOTEL, active=True):
    return {"user_id": user, "tenant_id": tenant, "role": role_name, "department_id": dept, "is_active": active}


def seed():
    return {
        "tenants": [{"id": HOTEL, "timezone": "America/Chicago"}, {"id": OTHER, "timezone": "America/Chicago"}],
        "departments": [
            {"id": D_HK, "tenant_id": HOTEL, "code": "HK"}, {"id": D_ENG, "tenant_id": HOTEL, "code": "ENG"},
            {"id": D_OTHER, "tenant_id": OTHER, "code": "HK"},
        ],
        "user_roles": [
            role(U_HK1, "housekeeper", D_HK), role(U_HK2, "housekeeper", D_HK), role(U_ENG, "engineer", D_ENG),
            role(U_INACTIVE, "housekeeper", D_HK, active=False), role(U_OTHER, "housekeeper", D_OTHER, tenant=OTHER),
            role(U_GM, "gm", None), role(U_SUP, "housekeeping_supervisor", D_HK), role(U_NODEPT, "gm", None),
        ],
        "user_profiles": [
            {"id": U_HK1, "full_name": "Ana Lopez"}, {"id": U_HK2, "full_name": "Bea Cruz"},
            {"id": U_ENG, "full_name": "Eli Park"}, {"id": U_SUP, "full_name": "Sam Wu"},
        ],
        "shifts": [
            shift(S_MORN, "Morning", D_HK, "07:00:00", "15:00:00"), shift(S_EVE, "Evening", D_HK, "15:00:00", "23:00:00"),
            shift(S_NIGHT, "Night", D_HK, "23:00:00", "07:00:00"), shift(S_ENG, "Eng Day", D_ENG, "08:00:00", "16:00:00"),
            shift(S_OTHER, "Other hotel", D_OTHER, "07:00:00", "15:00:00", tenant=OTHER),
        ],
        "shift_assignments": [], "operational_audit_events": [], "hk_shift_sessions": [],
    }


class RacingDB(FakeDB):
    """Postgres refuses the insert (the trigger's overlap check) after the API's own pre-check passed."""
    def table(self, name):
        query = super().table(name)
        if name == "shift_assignments":
            real = query.execute

            def execute():
                if query.action == "insert":
                    raise APIError({"message": "shift_assignments overlap for user", "code": "23P01", "hint": "overlapping_shift", "details": None})
                return real()
            query.execute = execute
        return query


@pytest.fixture
def db(monkeypatch):
    return install(monkeypatch, FakeDB(seed()))


def install(monkeypatch, database):
    for module in (sched, team, access, shifts_router):
        monkeypatch.setattr(module, "supabase", database)
    return database


def req(user=U_HK1, shift_id=S_MORN, day=DAY, **extra):
    return CreateShiftAssignmentRequest(user_id=user, shift_id=shift_id, work_date=day, **extra)


# Handlers are called directly, so FastAPI's Query(...) defaults must be supplied by hand.
async def list_assignments(**kw):
    args = {"work_date": None, "shift_id": None, "user_id": None, "date_from": None, "date_to": None, **kw}
    return await sched.list_assignments(**args)


async def list_shifts(**kw):
    return await sched.list_shifts(**{"department_id": None, "is_active": None, "include_archived": False, **kw})


async def my_schedule(**kw):
    return await sched.get_my_schedule(**{"date_from": None, "date_to": None, **kw})


async def team_schedule(**kw):
    args = {"date_to": None, "department_id": None, "role": None, "user_id": None, "include_attendance": False,
            "page": 1, "per_page": 50, **kw}
    return await team.get_team_schedule(**args)


async def create(actor, **kwargs):
    return await sched.create_shift_assignment(req(**kwargs), actor)


def refused(excinfo) -> str:
    assert isinstance(excinfo.value, CodedHTTPException), excinfo.value
    return excinfo.value.code


# --- creating --------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_stores_an_immutable_occurrence_snapshot_and_audits_it(db):
    response = await create(SUP)
    row = response["data"]
    assert (row["shift_name"], row["start_time"], row["end_time"], row["department_id"]) == ("Morning", "07:00:00", "15:00:00", D_HK)
    assert (row["starts_at"], row["ends_at"]) == ("2030-01-08T13:00:00+00:00", "2030-01-08T21:00:00+00:00")
    assert row["shifts"] == {"name": "Morning", "start_time": "07:00:00", "end_time": "15:00:00"}  # legacy nested shape
    assert response["meta"]["created"] is True
    assert [e["action"] for e in db.rows["operational_audit_events"]] == ["created"]


@pytest.mark.asyncio
async def test_repeating_a_create_is_a_no_op(db):
    first = await create(SUP)
    again = await create(SUP)
    assert again["data"]["id"] == first["data"]["id"] and again["meta"]["created"] is False
    assert len(db.rows["shift_assignments"]) == 1


@pytest.mark.asyncio
async def test_one_person_can_work_two_non_overlapping_shifts_on_one_date(db):
    await create(SUP, shift_id=S_MORN, start_time="06:00", end_time="10:00")
    second = await create(SUP, shift_id=S_EVE, start_time="16:00", end_time="20:00")
    assert len(db.rows["shift_assignments"]) == 2 and second["meta"]["created"]


@pytest.mark.asyncio
async def test_overlapping_shift_is_refused_and_nothing_is_written(db):
    await create(SUP)
    with pytest.raises(CodedHTTPException) as exc:
        await create(SUP, shift_id=S_EVE, start_time="14:00", end_time="22:00")
    assert refused(exc) == "schedule_conflict" and exc.value.extra["conflicts"][0]["code"] == "overlapping_shift"
    assert len(db.rows["shift_assignments"]) == 1


@pytest.mark.asyncio
async def test_overnight_shift_blocks_an_overlapping_morning_shift_the_next_day(db):
    await create(SUP, shift_id=S_NIGHT)
    with pytest.raises(CodedHTTPException) as exc:
        await create(SUP, shift_id=S_MORN, day=DAY + timedelta(days=1), start_time="06:00", end_time="14:00")
    assert refused(exc) == "schedule_conflict"


@pytest.mark.asyncio
async def test_overnight_shift_starting_at_midnight_boundary_is_stored_as_next_day_end(db):
    row = (await create(SUP, shift_id=S_NIGHT))["data"]
    assert (row["starts_at"], row["ends_at"]) == ("2030-01-09T05:00:00+00:00", "2030-01-09T13:00:00+00:00")


@pytest.mark.asyncio
async def test_dst_overnight_shift_is_resolved_in_hotel_time(db):
    row = (await create(SUP, shift_id=S_NIGHT, day=date(2030, 3, 9), start_time="22:00", end_time="06:00"))["data"]
    start, end = (datetime.fromisoformat(row[k]) for k in ("starts_at", "ends_at"))
    assert end - start == timedelta(hours=7)  # 2030-03-10 is the spring-forward night: 22:00 -> 06:00 is 7 real hours
    assert row["start_time"] == "22:00:00" and row["end_time"] == "06:00:00"  # the wall-clock times are what is stored


@pytest.mark.asyncio
async def test_a_concurrent_overlap_that_beats_the_pre_check_is_a_clean_409(monkeypatch):
    install(monkeypatch, RacingDB(seed()))
    with pytest.raises(CodedHTTPException) as exc:
        await create(SUP)
    assert refused(exc) == "schedule_conflict" and exc.value.status_code == 409


@pytest.mark.asyncio
async def test_invalid_times_are_rejected_at_the_model_and_at_the_handler(db):
    for bad in ("25:00", "nope"):
        with pytest.raises(ValidationError):  # the request model's own 422
            req(start_time=bad)
    with pytest.raises(CodedHTTPException) as exc:  # a zero-length shift passes the model, not the rule
        await create(SUP, start_time="08:00", end_time="08:00")
    assert refused(exc) == "invalid_time" and exc.value.status_code == 422
    assert db.rows["shift_assignments"] == []


@pytest.mark.asyncio
async def test_inactive_or_unknown_employee_is_not_found(db):
    for user in (U_INACTIVE, "a0000042-0000-4000-8000-000000000042"):
        with pytest.raises(CodedHTTPException) as exc:
            await create(SUP, user=user)
        assert refused(exc) == "staff_not_found" and exc.value.status_code == 404


@pytest.mark.asyncio
async def test_other_hotels_staff_and_shifts_are_invisible(db):
    with pytest.raises(CodedHTTPException) as exc:
        await create(GM, user=U_OTHER)
    assert refused(exc) == "staff_not_found"
    with pytest.raises(CodedHTTPException) as exc:
        await create(GM, shift_id=S_OTHER)
    assert refused(exc) == "shift_not_found"


@pytest.mark.asyncio
async def test_employee_must_belong_to_the_shifts_department(db):
    with pytest.raises(CodedHTTPException) as exc:
        await create(GM, user=U_HK1, shift_id=S_ENG)
    assert refused(exc) == "department_mismatch" and exc.value.status_code == 422


@pytest.mark.asyncio
async def test_a_scoped_manager_cannot_schedule_another_department(db):
    with pytest.raises(CodedHTTPException) as exc:
        await create(SUP, user=U_ENG, shift_id=S_ENG)
    assert refused(exc) == "department_forbidden" and exc.value.status_code == 403
    assert (await create(ENGINEER, user=U_ENG, shift_id=S_ENG))["meta"]["created"]


@pytest.mark.asyncio
async def test_a_person_with_unknown_department_is_scheduled_with_a_warning_not_guessed(db):
    db.rows["user_roles"].append(role("a0000050-0000-4000-8000-000000000050", "front_desk", None))
    db.rows["user_profiles"].append({"id": "a0000050-0000-4000-8000-000000000050", "full_name": "Fran"})
    db.rows["departments"].append({"id": "d0000009-0000-4000-8000-000000000009", "tenant_id": HOTEL, "code": "XX"})
    response = await create(GM, user="a0000050-0000-4000-8000-000000000050")
    assert [w["code"] for w in response["meta"]["warnings"]] == ["employee_department_unknown"]


@pytest.mark.asyncio
async def test_archived_or_inactive_template_cannot_be_scheduled(db):
    db.rows["shifts"][0]["archived_at"] = "2029-01-01T00:00:00+00:00"
    with pytest.raises(CodedHTTPException) as exc:
        await create(SUP)
    assert refused(exc) == "shift_inactive" and exc.value.status_code == 409


# --- bulk ------------------------------------------------------------------------------------------------

def bulk(*pairs):
    return BulkShiftAssignmentRequest(assignments=[BulkShiftAssignmentItem(user_id=u, shift_id=s, work_date=d) for u, s, d in pairs])


@pytest.mark.asyncio
async def test_bulk_is_all_or_nothing(db):
    request = bulk((U_HK1, S_MORN, DAY), (U_HK2, S_MORN, DAY), ("a0000042-0000-4000-8000-000000000042", S_MORN, DAY))
    with pytest.raises(CodedHTTPException):
        await sched.bulk_create_assignments(request, SUP)
    assert db.rows["shift_assignments"] == [] and db.rows["operational_audit_events"] == []


@pytest.mark.asyncio
async def test_bulk_conflict_inside_the_request_saves_nothing(db):
    request = BulkShiftAssignmentRequest(assignments=[
        BulkShiftAssignmentItem(user_id=U_HK1, shift_id=S_MORN, work_date=DAY),
        BulkShiftAssignmentItem(user_id=U_HK1, shift_id=S_MORN, work_date=DAY),
    ])
    with pytest.raises(CodedHTTPException) as exc:
        await sched.bulk_create_assignments(request, SUP)
    assert refused(exc) == "schedule_conflict" and exc.value.extra["conflicts"][0]["code"] == "duplicate_assignment"
    assert db.rows["shift_assignments"] == []


@pytest.mark.asyncio
async def test_bulk_is_idempotent_on_retry(db):
    request = bulk((U_HK1, S_MORN, DAY), (U_HK2, S_MORN, DAY))
    first = await sched.bulk_create_assignments(request, SUP)
    again = await sched.bulk_create_assignments(request, SUP)
    assert (first["data"]["created_count"], again["data"]["created_count"], again["data"]["unchanged_count"]) == (2, 0, 2)
    assert len(db.rows["shift_assignments"]) == 2


@pytest.mark.asyncio
async def test_bulk_database_refusal_leaves_nothing_behind(monkeypatch):
    database = install(monkeypatch, RacingDB(seed()))
    with pytest.raises(CodedHTTPException):
        await sched.bulk_create_assignments(bulk((U_HK1, S_MORN, DAY), (U_HK2, S_MORN, DAY)), SUP)
    assert database.rows["shift_assignments"] == []


# --- templates: edit, archive, history -------------------------------------------------------------------

@pytest.mark.asyncio
async def test_editing_a_template_never_changes_existing_assignments(db):
    created = (await create(SUP))["data"]
    await sched.update_shift(S_MORN, UpdateShiftRequest(start_time="09:00:00", end_time="17:00:00", name="Late morning"), GM)
    stored = db.rows["shift_assignments"][0]
    assert (stored["shift_name"], stored["start_time"], stored["end_time"], stored["starts_at"]) == (
        "Morning", "07:00:00", "15:00:00", created["starts_at"])
    listed = (await list_assignments(work_date=DAY, current_user=GM))["data"][0]
    assert listed["shifts"] == {"name": "Morning", "start_time": "07:00:00", "end_time": "15:00:00"}
    assert db.rows["shifts"][0]["start_time"] == "09:00:00" and db.rows["shifts"][0]["version"] == 2


@pytest.mark.asyncio
async def test_template_edit_with_a_stale_version_is_refused(db):
    await sched.update_shift(S_MORN, UpdateShiftRequest(name="Early", expected_version=1), GM)
    with pytest.raises(CodedHTTPException) as exc:
        await sched.update_shift(S_MORN, UpdateShiftRequest(name="Other", expected_version=1), GM)
    assert refused(exc) == "version_conflict" and exc.value.extra["current_version"] == 2


@pytest.mark.asyncio
async def test_template_edit_validates_times_and_scope(db):
    with pytest.raises(CodedHTTPException) as exc:
        await sched.update_shift(S_MORN, UpdateShiftRequest(end_time="07:00:00"), GM)
    assert refused(exc) == "invalid_time"
    with pytest.raises(CodedHTTPException) as exc:
        await sched.update_shift(S_ENG, UpdateShiftRequest(name="x"), SUP)
    assert refused(exc) == "department_forbidden"


@pytest.mark.asyncio
async def test_delete_archives_the_template_and_keeps_every_assignment(db):
    await create(SUP)
    assert await sched.delete_shift(S_MORN, GM) is None
    template = db.rows["shifts"][0]
    assert template["archived_at"] and template["is_active"] is False and template["archived_by"] == U_GM
    assert len(db.rows["shift_assignments"]) == 1
    assert S_MORN not in [s["id"] for s in (await list_shifts(current_user=GM))["data"]]
    assert S_MORN in [s["id"] for s in (await list_shifts(include_archived=True, current_user=GM))["data"]]
    await sched.delete_shift(S_MORN, GM)  # repeating is a no-op
    assert [e["action"] for e in db.rows["operational_audit_events"] if e["resource_type"] == "shift_definition"] == ["archived"]


@pytest.mark.asyncio
async def test_delete_unknown_or_other_hotels_shift_is_404(db):
    for shift_id in (S_OTHER, "c0000042-0000-4000-8000-000000000042"):
        with pytest.raises(CodedHTTPException) as exc:
            await sched.delete_shift(shift_id, GM)
        assert refused(exc) == "shift_not_found"


@pytest.mark.asyncio
async def test_create_template_validates_and_enforces_scope_and_uniqueness(db):
    with pytest.raises(CodedHTTPException) as exc:
        await sched.create_shift(CreateShiftRequest(name="Bad", department_id=D_HK, start_time="08:00", end_time="08:00"), GM)
    assert refused(exc) == "invalid_time"
    with pytest.raises(CodedHTTPException) as exc:
        await sched.create_shift(CreateShiftRequest(name="Morning", department_id=D_HK, start_time="08:00", end_time="09:00"), GM)
    assert refused(exc) == "duplicate_shift_name"
    with pytest.raises(CodedHTTPException) as exc:
        await sched.create_shift(CreateShiftRequest(name="New", department_id=D_ENG, start_time="08:00", end_time="09:00"), SUP)
    assert refused(exc) == "department_forbidden"
    with pytest.raises(CodedHTTPException) as exc:
        await sched.create_shift(CreateShiftRequest(name="New", department_id=D_OTHER, start_time="08:00", end_time="09:00"), GM)
    assert refused(exc) == "department_not_found"
    ok = await sched.create_shift(CreateShiftRequest(name="Swing", department_id=D_HK, start_time="11:00", end_time="19:00"), SUP)
    assert ok["data"]["name"] == "Swing"


# --- editing an occurrence + concurrency -----------------------------------------------------------------

async def stored_id(actor=SUP, **kwargs):
    return (await create(actor, **kwargs))["data"]["id"]


@pytest.mark.asyncio
async def test_edit_updates_the_snapshot_and_bumps_the_version(db):
    row_id = await stored_id()
    saved = await sched.update_shift_assignment(row_id, UpdateShiftAssignmentRequest(expected_version=1, start_time="08:00", end_time="16:00", notes="swap"), SUP)
    data = saved["data"]
    assert (data["start_time"], data["end_time"], data["version"], data["notes"]) == ("08:00:00", "16:00:00", 2, "swap")
    assert data["starts_at"] == "2030-01-08T14:00:00+00:00"


@pytest.mark.asyncio
async def test_second_editor_with_the_old_version_is_refused_with_the_current_row(db):
    row_id = await stored_id()
    await sched.update_shift_assignment(row_id, UpdateShiftAssignmentRequest(expected_version=1, notes="first"), SUP)
    with pytest.raises(CodedHTTPException) as exc:
        await sched.update_shift_assignment(row_id, UpdateShiftAssignmentRequest(expected_version=1, notes="second"), GM)
    assert refused(exc) == "version_conflict" and exc.value.extra["current"]["notes"] == "first"
    assert db.rows["shift_assignments"][0]["notes"] == "first"


@pytest.mark.asyncio
async def test_edit_that_lands_between_read_and_write_is_not_lost(db, monkeypatch):
    """Compare-and-swap: if the row changed after we read it, the guarded UPDATE matches nothing and we report 409."""
    row_id = await stored_id()
    real_update = db.table

    def table(name):
        query = real_update(name)
        if name == "shift_assignments":
            real_execute = query.execute

            def execute():
                if query.action == "update":
                    db.rows["shift_assignments"][0]["version"] = 2  # a concurrent writer got there first
                return real_execute()
            query.execute = execute
        return query
    monkeypatch.setattr(db, "table", table)
    with pytest.raises(CodedHTTPException) as exc:
        await sched.update_shift_assignment(row_id, UpdateShiftAssignmentRequest(expected_version=1, notes="mine"), SUP)
    assert refused(exc) == "version_conflict"
    assert db.rows["shift_assignments"][0].get("notes") != "mine"


@pytest.mark.asyncio
async def test_edit_that_would_overlap_is_refused(db):
    await create(SUP, shift_id=S_MORN, start_time="06:00", end_time="10:00")
    second = await stored_id(shift_id=S_EVE, start_time="16:00", end_time="20:00")
    with pytest.raises(CodedHTTPException) as exc:
        await sched.update_shift_assignment(second, UpdateShiftAssignmentRequest(expected_version=1, start_time="09:00"), SUP)
    assert refused(exc) == "schedule_conflict"


@pytest.mark.asyncio
async def test_edit_can_change_the_shift_within_the_department_only(db):
    row_id = await stored_id()
    moved = await sched.update_shift_assignment(row_id, UpdateShiftAssignmentRequest(expected_version=1, shift_id=S_EVE), SUP)
    assert (moved["data"]["shift_name"], moved["data"]["start_time"]) == ("Evening", "15:00:00")
    with pytest.raises(CodedHTTPException) as exc:
        await sched.update_shift_assignment(row_id, UpdateShiftAssignmentRequest(expected_version=2, shift_id=S_ENG), GM)
    assert refused(exc) == "department_mismatch"


@pytest.mark.asyncio
async def test_past_and_clocked_in_shifts_cannot_be_edited_or_removed(db):
    old = await stored_id(day=date(2020, 1, 7))
    with pytest.raises(CodedHTTPException) as exc:
        await sched.update_shift_assignment(old, UpdateShiftAssignmentRequest(expected_version=1, notes="x"), GM)
    assert refused(exc) == "historical_assignment_locked"
    with pytest.raises(CodedHTTPException) as exc:
        await sched.delete_assignment(old, SUP)
    assert refused(exc) == "historical_assignment_locked"
    assert (await sched.delete_assignment(old, GM))["data"]["success"]  # a GM may correct history

    live = await stored_id()
    db.rows["shift_assignments"][0]["clocked_in_at"] = "2030-01-08T13:05:00+00:00"
    for call in (
        sched.update_shift_assignment(live, UpdateShiftAssignmentRequest(expected_version=1, notes="x"), SUP),
        sched.delete_assignment(live, SUP),
    ):
        with pytest.raises(CodedHTTPException) as exc:
            await call
        assert refused(exc) == "has_attendance"


@pytest.mark.asyncio
async def test_delete_audits_the_removed_row_and_respects_tenant_and_department(db):
    row_id = await stored_id()
    with pytest.raises(CodedHTTPException) as exc:
        await sched.delete_assignment(row_id, ENGINEER)
    assert refused(exc) == "department_forbidden"
    with pytest.raises(CodedHTTPException) as exc:
        await sched.delete_assignment(row_id, CurrentUser(user_id=U_GM, hotel_id=OTHER, role="gm", email="g@o.test"))
    assert refused(exc) == "assignment_not_found"
    assert (await sched.delete_assignment(row_id, SUP))["data"] == {"success": True, "deleted_id": row_id}
    assert db.rows["shift_assignments"] == []
    assert [e["action"] for e in db.rows["operational_audit_events"]][-1] == "deleted"


# --- reading: compatibility, scoping, bounds --------------------------------------------------------------

def legacy_row(id, user, shift_id, day, dept=D_HK, **extra):
    return {"id": id, "tenant_id": HOTEL, "user_id": user, "shift_id": shift_id, "work_date": day.isoformat(),
            "shift_name": "Morning", "department_id": dept, "start_time": "07:00:00", "end_time": "15:00:00",
            "starts_at": f"{day.isoformat()}T13:00:00+00:00", "ends_at": f"{day.isoformat()}T21:00:00+00:00",
            "publication_state": "published", "version": 1, "is_on_shift": False, "clocked_in_at": None,
            "clocked_out_at": None, "created_at": "2030-01-01T00:00:00+00:00", **extra}


@pytest.mark.asyncio
async def test_list_keeps_the_shapes_the_web_and_mobile_consumers_read(db):
    db.rows["shift_assignments"] = [legacy_row("r1", U_HK1, S_MORN, DAY)]
    [row] = (await list_assignments(work_date=DAY, current_user=SUP))["data"]
    # apps/web ShiftAssignment + apps/mobile normalizeScheduledShifts read exactly these.
    for key in ("id", "tenant_id", "user_id", "shift_id", "work_date", "is_on_shift", "clocked_in_at", "clocked_out_at", "created_at"):
        assert key in row
    assert row["shifts"] == {"name": "Morning", "start_time": "07:00:00", "end_time": "15:00:00"}


@pytest.mark.asyncio
async def test_list_is_scoped_by_role_and_department(db):
    db.rows["shift_assignments"] = [
        legacy_row("r1", U_HK1, S_MORN, DAY), legacy_row("r2", U_HK2, S_MORN, DAY),
        legacy_row("r3", U_ENG, S_ENG, DAY, dept=D_ENG),
    ]
    async def ids(who):
        return sorted(r["id"] for r in (await list_assignments(work_date=DAY, current_user=who))["data"])
    assert await ids(GM) == ["r1", "r2", "r3"]
    assert await ids(SUP) == ["r1", "r2"] and await ids(ENGINEER) == ["r3"] and await ids(CHIEF) == ["r3"]
    assert await ids(HK) == ["r1"]  # a housekeeper only ever sees their own shifts, even asking for someone else's
    other = await list_assignments(work_date=DAY, user_id=U_HK2, current_user=HK)
    assert [r["id"] for r in other["data"]] == ["r1"]


@pytest.mark.asyncio
async def test_list_is_bounded_by_default_and_by_explicit_range(db, monkeypatch):
    monkeypatch.setattr(sched, "hotel_today", lambda zone: DAY)
    db.rows["shift_assignments"] = [
        legacy_row("old", U_HK1, S_MORN, DAY - timedelta(days=400)),
        legacy_row("near", U_HK1, S_MORN, DAY - timedelta(days=3)),
        legacy_row("far", U_HK1, S_MORN, DAY + timedelta(days=400)),
    ]
    default = await list_assignments(current_user=GM)
    assert [r["id"] for r in default["data"]] == ["near"] and default["meta"]["truncated"] is False
    with pytest.raises(CodedHTTPException) as exc:
        await list_assignments(date_from=DAY, date_to=DAY + timedelta(days=200), current_user=GM)
    assert refused(exc) == "range_too_large" and exc.value.status_code == 422
    with pytest.raises(CodedHTTPException) as exc:
        await list_assignments(date_from=DAY, date_to=DAY - timedelta(days=1), current_user=GM)
    assert refused(exc) == "invalid_range"


@pytest.mark.asyncio
async def test_my_schedule_uses_the_hotel_local_day_and_only_published_shifts(db, monkeypatch):
    monkeypatch.setattr(sched, "hotel_today", lambda zone: DAY)
    db.rows["shift_assignments"] = [
        legacy_row("mine", U_HK1, S_MORN, DAY), legacy_row("draft", U_HK1, S_EVE, DAY, publication_state="draft"),
        legacy_row("theirs", U_HK2, S_MORN, DAY), legacy_row("later", U_HK1, S_MORN, DAY + timedelta(days=30)),
    ]
    assert [r["id"] for r in (await my_schedule(current_user=HK))["data"]] == ["mine"]


def test_hotel_today_is_the_local_calendar_day_not_the_utc_day():
    zone = tz.gettz("America/Chicago")
    assert access.hotel_today(zone, datetime(2030, 6, 1, 2, 0, tzinfo=timezone.utc)) == date(2030, 5, 31)
    assert access.hotel_today(zone, datetime(2030, 6, 1, 6, 0, tzinfo=timezone.utc)) == date(2030, 6, 1)


@pytest.mark.asyncio
async def test_unreadable_hotel_timezone_is_a_503_not_a_guess(monkeypatch):
    class Broken(FakeDB):
        def table(self, name):
            raise RuntimeError("db down")
    install(monkeypatch, Broken(seed()))
    with pytest.raises(CodedHTTPException) as exc:
        await list_assignments(current_user=GM)
    assert refused(exc) == "timezone_unavailable" and exc.value.status_code == 503


@pytest.mark.asyncio
async def test_today_roster_keeps_its_response_shape(db, monkeypatch):
    monkeypatch.setattr(sched, "hotel_today", lambda zone: DAY)
    db.rows["shift_assignments"] = [legacy_row("r1", U_HK1, S_MORN, DAY, is_on_shift=True, clocked_in_at="2030-01-08T13:02:00+00:00")]
    result = (await sched.today_roster(SUP))["data"]
    assert result["date"] == "2030-01-08" and result["roster"][0]["shift"]["name"] == "Morning"
    assert set(result["roster"][0]) == {"user_id", "full_name", "role", "shift", "clocked_in_at", "is_on_shift"}


# --- team schedule ---------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_team_returns_scoped_people_with_their_shifts_and_a_revision(db):
    db.rows["shift_assignments"] = [legacy_row("r1", U_HK1, S_MORN, DAY), legacy_row("r3", U_ENG, S_ENG, DAY, dept=D_ENG)]
    result = await team_schedule(date_from=DAY, current_user=SUP)
    assert [p["full_name"] for p in result["data"]["staff"]] == ["Ana Lopez", "Bea Cruz", "Sam Wu"]
    assert [a["id"] for a in result["data"]["assignments"]] == ["r1"]
    assert "clocked_in_at" not in result["data"]["assignments"][0]  # legacy clock columns are not attendance
    assert result["meta"]["counts"]["staff_scheduled"] == 1 and result["meta"]["revision"]
    gm_view = await team_schedule(date_from=DAY, current_user=GM)
    assert {a["id"] for a in gm_view["data"]["assignments"]} == {"r1", "r3"}
    assert (await team_schedule(date_from=DAY, role="engineer", current_user=GM))["meta"]["counts"]["staff_total"] == 1


@pytest.mark.asyncio
async def test_team_revision_changes_when_a_shift_is_edited(db):
    row_id = await stored_id()
    before = (await team_schedule(date_from=DAY, current_user=GM))["meta"]["revision"]
    await sched.update_shift_assignment(row_id, UpdateShiftAssignmentRequest(expected_version=1, notes="n"), GM)
    assert (await team_schedule(date_from=DAY, current_user=GM))["meta"]["revision"] != before


@pytest.mark.asyncio
async def test_team_department_filter_is_authorised_and_tenant_scoped(db):
    with pytest.raises(CodedHTTPException) as exc:
        await team_schedule(date_from=DAY, department_id=D_ENG, current_user=SUP)
    assert refused(exc) == "department_forbidden"
    with pytest.raises(CodedHTTPException) as exc:
        await team_schedule(date_from=DAY, department_id=D_OTHER, current_user=GM)
    assert refused(exc) == "department_not_found"
    assert (await team_schedule(date_from=DAY, department_id=D_ENG, current_user=GM))["meta"]["counts"]["staff_total"] == 1


@pytest.mark.asyncio
async def test_team_validates_range_and_attendance_combination(db):
    cases = [
        ({"date_to": DAY - timedelta(days=1)}, "invalid_range"),
        ({"date_to": DAY + timedelta(days=60)}, "range_too_large"),
        ({"date_to": DAY + timedelta(days=1), "include_attendance": True}, "attendance_requires_single_day"),
    ]
    for kwargs, code in cases:
        with pytest.raises(CodedHTTPException) as exc:
            await team_schedule(date_from=DAY, current_user=GM, **kwargs)
        assert refused(exc) == code and exc.value.status_code == 422


@pytest.mark.asyncio
async def test_team_paginates_people_and_reports_empty_state(db):
    page1 = await team_schedule(date_from=DAY, per_page=2, current_user=SUP)
    page2 = await team_schedule(date_from=DAY, per_page=2, page=2, current_user=SUP)
    assert [p["full_name"] for p in page1["data"]["staff"]] == ["Ana Lopez", "Bea Cruz"] and page1["meta"]["pagination"]["has_more"]
    assert [p["full_name"] for p in page2["data"]["staff"]] == ["Sam Wu"] and not page2["meta"]["pagination"]["has_more"]
    empty = await team_schedule(date_from=DAY, page=5, current_user=SUP)
    assert empty["data"] == {"staff": [], "assignments": []} and empty["meta"]["state"] == "empty"


@pytest.mark.asyncio
async def test_team_carries_an_overnight_shift_from_the_previous_day(db):
    night = legacy_row("night", U_HK1, S_NIGHT, DAY - timedelta(days=1), start_time="23:00:00", end_time="07:00:00",
                       starts_at="2030-01-08T05:00:00+00:00", ends_at="2030-01-08T13:00:00+00:00")
    ended = legacy_row("ended", U_HK2, S_MORN, DAY - timedelta(days=1), starts_at="2030-01-07T13:00:00+00:00", ends_at="2030-01-07T21:00:00+00:00")
    db.rows["shift_assignments"] = [night, ended]
    result = await team_schedule(date_from=DAY, current_user=SUP)
    assert [(a["id"], a["carried_from_previous_day"]) for a in result["data"]["assignments"]] == [("night", True)]


@pytest.mark.asyncio
async def test_team_attendance_is_verified_from_shift_sessions_only(db, monkeypatch):
    now = datetime.now(timezone.utc)
    db.rows["shift_assignments"] = [legacy_row("r1", U_HK1, S_MORN, DAY), legacy_row("r2", U_HK2, S_MORN, DAY)]
    monkeypatch.setattr(team, "load_roster", lambda hotel, day, zone: [
        {"user_id": U_HK1, "status": "active", "started_at": (now - timedelta(hours=1)).isoformat()}])
    result = await team_schedule(date_from=DAY, include_attendance=True, current_user=SUP)
    status = {p["user_id"]: p["workforce_status"] for p in result["data"]["staff"]}
    # Ana is working; Bea is scheduled with no session (not clocked in, NOT absent); Sam has no shift today.
    assert status == {U_HK1: "working", U_HK2: "not_clocked_in", U_SUP: "scheduled"}
    assert {a["id"]: a["workforce_status"] for a in result["data"]["assignments"]} == {"r1": "working", "r2": "not_clocked_in"}
    assert result["meta"]["attendance"]["verified"] and result["meta"]["counts"]["by_status"]["working"] == 1


@pytest.mark.asyncio
async def test_team_does_not_guess_when_attendance_cannot_be_read(db, monkeypatch):
    db.rows["shift_assignments"] = [legacy_row("r1", U_HK1, S_MORN, DAY)]

    def boom(*_args):
        raise RuntimeError("sessions unavailable")
    monkeypatch.setattr(team, "load_roster", boom)
    result = await team_schedule(date_from=DAY, include_attendance=True, current_user=SUP)
    assert {p["workforce_status"] for p in result["data"]["staff"]} == {"unknown"}
    assert result["meta"]["attendance"]["verified"] is False and "by_status" not in result["meta"]["counts"]


@pytest.mark.asyncio
async def test_room_assignments_do_not_make_anyone_present(db, monkeypatch):
    db.rows["room_assignments"] = [{"id": "ra1", "tenant_id": HOTEL, "assigned_to": U_HK2, "assignment_date": DAY.isoformat()}]
    db.rows["shift_assignments"] = [legacy_row("r2", U_HK2, S_MORN, DAY)]
    monkeypatch.setattr(team, "load_roster", lambda *_: [])
    result = await team_schedule(date_from=DAY, include_attendance=True, current_user=SUP)
    assert {p["user_id"]: p["workforce_status"] for p in result["data"]["staff"]}[U_HK2] == "not_clocked_in"


@pytest.mark.asyncio
async def test_roster_endpoint_and_team_share_one_attendance_read(db):
    """GET /shifts/roster is now a thin wrapper over load_roster: same rows, same hotel-local day window."""
    db.rows["hk_shift_sessions"] = [{"id": "x", "tenant_id": HOTEL, "user_id": U_HK1, "status": "active",
                                     "started_at": "2030-01-08T14:00:00+00:00", "on_break_since": None, "break_seconds": 0}]
    endpoint = await shifts_router.get_shift_roster(roster_date=DAY, current_user=SUP)
    direct = shifts_router.load_roster(HOTEL, DAY, access.hotel_zone(HOTEL))
    assert endpoint["data"] == direct and direct[0]["user_id"] == U_HK1


# --- adjacent consumers ------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_shift_summary_cron_skips_archived_templates(db, monkeypatch):
    """Archiving replaces hard deletion, so the cron that walks every shift must not keep summarising archived ones."""
    import services.ai.shift_summary as summary
    from routers import internal

    seen = []

    async def fake_generate(tenant_id, shift_id, shift_date):
        seen.append(shift_id)
        return {"was_generated": True}

    db.rows["shifts"][0]["archived_at"] = "2029-01-01T00:00:00+00:00"  # Morning is archived
    monkeypatch.setattr(internal, "supabase", db)
    monkeypatch.setattr(internal, "verify_cron", lambda secret: None)
    monkeypatch.setattr(internal, "_record_cron_run", lambda name: None)
    monkeypatch.setattr(summary, "generate_or_get_shift_summary", fake_generate)
    monkeypatch.setattr(summary, "hotel_today", lambda tenant_id: DAY)
    await internal.generate_shift_summaries("secret")
    assert S_MORN not in seen and {S_EVE, S_NIGHT, S_ENG, S_OTHER} == set(seen)
