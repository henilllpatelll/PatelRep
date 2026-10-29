"""Team Scheduling Phase 3: moving/reassigning a shift, safe cancel, recurring batches, preview, detail, template usage."""
from datetime import date, timedelta

import pytest

from core.errors import CodedHTTPException
from middleware.auth import CurrentUser
from models.requests import (
    BulkShiftAssignmentItem,
    BulkShiftAssignmentRequest,
    UpdateShiftAssignmentRequest,
    UpdateShiftRequest,
)
from routers import scheduling as sched
from routers import scheduling_plan as plan
from routers import scheduling_team as team
from routers import shifts as shifts_router
from services import scheduling_access as access

from .fake_supabase import FakeDB
from .test_scheduling_foundation import (
    DAY, ENGINEER, GM, HK, HOTEL, OTHER, S_ENG, S_EVE, S_MORN, S_NIGHT, SUP, U_ENG, U_HK1, U_HK2, U_INACTIVE, U_OTHER,
    refused, seed, stored_id,
)


@pytest.fixture
def db(monkeypatch):
    database = FakeDB(seed())
    for module in (sched, team, plan, access, shifts_router):
        monkeypatch.setattr(module, "supabase", database)
    return database


def bulk(*items):
    return BulkShiftAssignmentRequest(assignments=[BulkShiftAssignmentItem(**i) for i in items])


def item(user=U_HK1, shift=S_MORN, day=DAY, **extra):
    return {"user_id": user, "shift_id": shift, "work_date": day, **extra}


async def edit(row_id, actor=SUP, version=1, **fields):
    return await sched.update_shift_assignment(row_id, UpdateShiftAssignmentRequest(expected_version=version, **fields), actor)


# --- reassigning a shift to another employee --------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_shift_can_be_handed_to_another_employee_in_the_same_department(db):
    row_id = await stored_id()
    saved = (await edit(row_id, user_id=U_HK2))["data"]
    assert (saved["user_id"], saved["version"]) == (U_HK2, 2)
    audit = db.rows["operational_audit_events"][-1]
    assert audit["action"] == "updated" and audit["old_state"]["user_id"] == U_HK1 and audit["new_state"]["user_id"] == U_HK2


@pytest.mark.asyncio
async def test_reassigning_refuses_the_wrong_department_inactive_and_other_hotels_people(db):
    row_id = await stored_id()
    with pytest.raises(CodedHTTPException) as exc:
        await edit(row_id, user_id=U_ENG)
    assert refused(exc) == "department_mismatch"
    for missing in (U_INACTIVE, U_OTHER):
        with pytest.raises(CodedHTTPException) as exc:
            await edit(row_id, user_id=missing)
        assert refused(exc) == "staff_not_found"
    assert db.rows["shift_assignments"][0]["user_id"] == U_HK1 and db.rows["shift_assignments"][0]["version"] == 1


@pytest.mark.asyncio
async def test_reassigning_onto_someone_who_overlaps_is_refused(db):
    await stored_id(user=U_HK2, shift_id=S_MORN, start_time="06:00", end_time="10:00")
    mine = await stored_id(user=U_HK1, shift_id=S_EVE, start_time="09:00", end_time="12:00")
    with pytest.raises(CodedHTTPException) as exc:
        await edit(mine, user_id=U_HK2)
    assert refused(exc) == "schedule_conflict"


# --- moving a shift to another day ------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_shift_can_be_moved_to_another_future_day_and_is_resolved_in_hotel_time(db):
    row_id = await stored_id(shift_id=S_NIGHT)
    moved = (await edit(row_id, work_date=DAY + timedelta(days=1)))["data"]
    assert moved["work_date"] == "2030-01-09" and moved["starts_at"] == "2030-01-10T05:00:00+00:00"
    assert moved["ends_at"] == "2030-01-10T13:00:00+00:00"  # overnight: ends 07:00 the next local morning


@pytest.mark.asyncio
async def test_moving_into_the_past_or_onto_a_duplicate_is_refused(db):
    row_id = await stored_id()
    with pytest.raises(CodedHTTPException) as exc:
        await edit(row_id, work_date=date(2020, 1, 7))
    assert refused(exc) == "historical_assignment_locked"
    other_day = await stored_id(day=DAY + timedelta(days=1))
    with pytest.raises(CodedHTTPException) as exc:
        await edit(row_id, work_date=DAY + timedelta(days=1))
    assert refused(exc) == "duplicate_assignment"
    assert other_day and db.rows["shift_assignments"][0]["work_date"] == DAY.isoformat()


@pytest.mark.asyncio
async def test_moving_a_shift_whose_template_changed_since_keeps_its_own_times(db):
    row_id = await stored_id(shift_id=S_MORN)
    await sched.update_shift(S_MORN, UpdateShiftRequest(start_time="05:00", end_time="13:00"), SUP)
    moved = (await edit(row_id, work_date=DAY + timedelta(days=2)))["data"]
    assert (moved["start_time"], moved["end_time"]) == ("07:00:00", "15:00:00")


# --- cancelling (removing) a shift ------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cancel_with_a_stale_version_is_refused_and_keeps_the_shift(db):
    row_id = await stored_id()
    await edit(row_id, notes="changed by someone else")
    with pytest.raises(CodedHTTPException) as exc:
        await sched.delete_assignment(row_id, SUP, expected_version=1)
    assert refused(exc) == "version_conflict" and exc.value.extra["current"]["notes"] == "changed by someone else"
    assert len(db.rows["shift_assignments"]) == 1
    assert (await sched.delete_assignment(row_id, SUP, expected_version=2))["data"]["success"]
    assert db.rows["shift_assignments"] == [] and db.rows["operational_audit_events"][-1]["action"] == "deleted"


# --- recurring batches ------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_recurring_batch_with_custom_times_is_saved_and_a_retry_is_a_no_op(db):
    days = [DAY + timedelta(days=n) for n in (0, 7, 14)]
    request = bulk(*[item(day=d, start_time="08:00", end_time="16:00", notes="weekly") for d in days])
    first = (await sched.bulk_create_assignments(request, SUP))["data"]
    assert (first["created_count"], first["unchanged_count"]) == (3, 0)
    assert {r["start_time"] for r in db.rows["shift_assignments"]} == {"08:00:00"}
    assert {r["notes"] for r in db.rows["shift_assignments"]} == {"weekly"}
    retry = (await sched.bulk_create_assignments(request, SUP))["data"]
    assert (retry["created_count"], retry["unchanged_count"]) == (0, 3) and len(db.rows["shift_assignments"]) == 3


@pytest.mark.asyncio
async def test_a_recurring_batch_with_one_bad_occurrence_saves_nothing(db):
    await stored_id(day=DAY + timedelta(days=7), start_time="06:00", end_time="10:00", shift_id=S_EVE)
    before = len(db.rows["shift_assignments"])
    request = bulk(*[item(day=DAY + timedelta(days=n), start_time="08:00", end_time="12:00") for n in (0, 7, 14)])
    with pytest.raises(CodedHTTPException) as exc:
        await sched.bulk_create_assignments(request, SUP)
    assert refused(exc) == "schedule_conflict" and len(db.rows["shift_assignments"]) == before


# --- preview (dry run) ------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_preview_lists_what_would_be_saved_and_writes_nothing(db):
    await stored_id(day=DAY + timedelta(days=7))
    request = bulk(*[item(day=DAY + timedelta(days=n)) for n in (0, 7, 14)])
    data = (await plan.preview_assignments(request, SUP))["data"]
    assert data["ok"] and (data["create_count"], data["unchanged_count"]) == (2, 1)
    assert [i["status"] for i in data["items"]] == ["new", "existing", "new"]
    assert len(db.rows["shift_assignments"]) == 1
    assert not [e for e in db.rows["operational_audit_events"] if e["action"] == "created" and e["resource_id"] != db.rows["shift_assignments"][0]["id"]]


@pytest.mark.asyncio
async def test_preview_reports_a_blocking_conflict_with_the_servers_own_code(db):
    await stored_id(shift_id=S_EVE, start_time="09:00", end_time="12:00")
    data = (await plan.preview_assignments(bulk(item(start_time="08:00", end_time="10:00")), SUP))["data"]
    assert data["ok"] is False and data["blocking"]["code"] == "schedule_conflict" and data["blocking"]["status"] == 409
    assert data["blocking"]["conflicts"][0]["code"] == "overlapping_shift" and data["items"] == []


@pytest.mark.asyncio
async def test_preview_carries_warnings_and_never_softens_authorisation(db):
    long_shift = (await plan.preview_assignments(bulk(item(start_time="06:00", end_time="20:00")), SUP))["data"]
    assert long_shift["ok"] and [w["code"] for w in long_shift["warnings"]] == ["long_shift"]
    with pytest.raises(CodedHTTPException) as exc:
        await plan.preview_assignments(bulk(item(user=U_ENG, shift=S_ENG)), SUP)
    assert refused(exc) == "department_forbidden"
    with pytest.raises(CodedHTTPException) as exc:
        await plan.preview_assignments(bulk(item(user=U_OTHER)), SUP)
    assert refused(exc) == "staff_not_found"


# --- shift detail -----------------------------------------------------------------------------------------

def session(user, started, status="ended", ended=None, **extra):
    return {"user_id": user, "tenant_id": HOTEL, "status": status, "started_at": started, "ended_at": ended,
            "on_break_since": None, "break_seconds": 0, **extra}


@pytest.mark.asyncio
async def test_detail_of_a_past_shift_reads_attendance_only_from_shift_sessions(db):
    row_id = await stored_id(day=date(2020, 1, 7))
    db.rows["shift_assignments"][0]["clocked_in_at"] = "2020-01-07T13:00:00+00:00"  # legacy column: must not leak
    db.rows["hk_shift_sessions"].append(session(U_HK1, "2020-01-07T13:05:00+00:00", ended="2020-01-07T21:00:00+00:00"))
    db.rows["hk_shift_sessions"].append(session(U_HK2, "2020-01-07T13:00:00+00:00"))
    data = (await plan.get_assignment_detail(row_id, SUP))["data"]
    assert data["attendance"]["verified"] and [s["started_at"] for s in data["attendance"]["sessions"]] == ["2020-01-07T13:05:00+00:00"]
    assert "clocked_in_at" not in data["assignment"] and data["editable"] is False and data["department_code"] == "HK"


@pytest.mark.asyncio
async def test_detail_of_a_future_shift_makes_no_attendance_claim(db):
    row_id = await stored_id()
    data = (await plan.get_assignment_detail(row_id, SUP))["data"]
    assert data["attendance"] == {"applicable": False, "verified": False, "sessions": []} and data["editable"] is True


@pytest.mark.asyncio
async def test_detail_says_unverified_when_attendance_cannot_be_read(db, monkeypatch):
    row_id = await stored_id(day=date(2020, 1, 7))
    real = db.table

    def table(name):
        if name == "hk_shift_sessions":
            raise RuntimeError("down")
        return real(name)
    monkeypatch.setattr(db, "table", table)
    data = (await plan.get_assignment_detail(row_id, SUP))["data"]
    assert data["attendance"]["applicable"] and data["attendance"]["verified"] is False and data["attendance"]["sessions"] == []


@pytest.mark.asyncio
async def test_detail_room_summary_is_a_count_when_known_and_unavailable_otherwise(db, monkeypatch):
    row_id = await stored_id()
    db.rows.setdefault("room_assignments", []).extend([
        {"tenant_id": HOTEL, "assigned_to": U_HK1, "assignment_date": DAY.isoformat(), "room_id": f"r{n}"} for n in range(3)
    ] + [{"tenant_id": HOTEL, "assigned_to": U_HK2, "assignment_date": DAY.isoformat(), "room_id": "rx"}])
    assert (await plan.get_assignment_detail(row_id, SUP))["data"]["rooms"] == {"applicable": True, "available": True, "count": 3}

    real = db.table

    def table(name):
        if name == "room_assignments":
            raise RuntimeError("down")
        return real(name)
    monkeypatch.setattr(db, "table", table)
    rooms = (await plan.get_assignment_detail(row_id, SUP))["data"]["rooms"]
    assert rooms == {"applicable": True, "available": False, "count": None}


@pytest.mark.asyncio
async def test_detail_is_scoped_by_hotel_and_department(db):
    row_id = await stored_id()
    other_gm = CurrentUser(user_id="a0000077-0000-4000-8000-000000000077", hotel_id=OTHER, role="gm", email="g@o.test")
    with pytest.raises(CodedHTTPException) as exc:
        await plan.get_assignment_detail(row_id, other_gm)
    assert refused(exc) == "assignment_not_found"
    with pytest.raises(CodedHTTPException) as exc:
        await plan.get_assignment_detail(row_id, ENGINEER)
    assert refused(exc) == "department_forbidden"
    assert (await plan.get_assignment_detail(row_id, GM))["data"]["assignment"]["id"] == row_id
    assert HK.role == "housekeeper"  # a housekeeper is not a TEAM_VIEW role; the route-level guard rejects them


# --- template usage ---------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_template_usage_counts_upcoming_and_past_and_ignores_cancelled(db):
    await stored_id(day=date(2020, 1, 7))
    await stored_id(day=DAY)
    await stored_id(day=DAY + timedelta(days=1))
    cancelled = await stored_id(day=DAY + timedelta(days=2))
    next(r for r in db.rows["shift_assignments"] if r["id"] == cancelled)["publication_state"] = "cancelled"
    usage = (await plan.get_shift_usage(S_MORN, SUP))["data"]
    assert (usage["upcoming"], usage["past"], usage["archived"]) == (2, 1, False)
    await sched.delete_shift(S_MORN, SUP)
    after = (await plan.get_shift_usage(S_MORN, SUP))["data"]
    assert (after["upcoming"], after["past"], after["archived"]) == (2, 1, True)  # archiving removes nothing
    assert len(db.rows["shift_assignments"]) == 4


@pytest.mark.asyncio
async def test_template_usage_is_scoped(db):
    with pytest.raises(CodedHTTPException) as exc:
        await plan.get_shift_usage(S_ENG, SUP)
    assert refused(exc) == "department_forbidden"
    with pytest.raises(CodedHTTPException) as exc:
        await plan.get_shift_usage("c0000009-0000-4000-8000-000000000009", SUP)
    assert refused(exc) == "shift_not_found"
