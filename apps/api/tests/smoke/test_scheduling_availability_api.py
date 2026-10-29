"""Team Scheduling Phase 5: employee availability API, and how availability + approved leave feed shift edits and coverage."""
from datetime import timedelta

import pytest
from pydantic import ValidationError

from core.errors import CodedHTTPException
from models.coverage_requests import AssignGapRequest, RecordAbsenceRequest
from models.leave_requests import (
    AvailabilityExceptionRequest,
    ReplaceAvailabilityRequest,
    RetireAvailabilityRequest,
)
from models.requests import UpdateShiftAssignmentRequest
from routers import scheduling as sched
from routers import scheduling_absences as absences
from routers import scheduling_availability as avail
from routers import scheduling_coverage as coverage
from services import coverage_fill

from .request_support import (
    make_db,
    CHIEF, D2, DAY, ENG, GM, HK1, HK2, HK3, OTHER_GM, S_ENG, SUP, U_ENG, U_ENG2, U_HK1, U_HK2, U_HK3,
    NEAR_TUE, assignment, audit, scheduled, today_plus, week_body,
)
from .test_scheduling_foundation import U_OTHER, create, refused

@pytest.fixture
def db(monkeypatch):
    return make_db(monkeypatch)


TUE = 1


async def put(actor, rev=0, eff=None, **days):
    return await avail.replace_my_availability(week_body(rev=rev, eff=eff, **days), actor)


async def state(actor):
    return (await avail.get_my_availability(actor))["data"]


def by_weekday(data):
    return {d["weekday"]: d for d in data["weekly"]}


# --- the employee's own availability --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_nothing_submitted_is_reported_as_nothing_submitted(db):
    data = await state(HK1)
    assert (data["revision"], data["submitted"], data["freshness"], data["last_updated_at"]) == (0, False, "none", None)
    assert {d["state"] for d in data["weekly"]} == {"unset"}


@pytest.mark.asyncio
async def test_a_week_is_saved_with_multiple_windows_unavailable_days_and_unset_days(db):
    saved = (await put(HK1, mon="07:00-15:00", tue="07:00-11:00,12:00-15:00", wed="off", thu="23:00-07:00"))["data"]
    days = by_weekday(saved)
    assert saved["revision"] == 1 and saved["submitted"] and saved["freshness"] == "current"
    assert days[0]["windows"] == [{"start": "07:00", "end": "15:00"}]
    assert len(days[1]["windows"]) == 2
    assert days[2]["state"] == "unavailable" and days[2]["windows"] == []
    assert days[3]["windows"] == [{"start": "23:00", "end": "07:00"}]            # overnight is kept as given
    assert days[4]["state"] == days[5]["state"] == days[6]["state"] == "unset"    # silence stays unknown
    assert audit(db, "availability", "weekly_replaced")


@pytest.mark.asyncio
async def test_saving_availability_never_edits_a_published_shift_but_warns_about_the_clash(db):
    shift_id = await scheduled(user=U_HK1, day=NEAR_TUE)           # Tuesday 07:00-15:00
    before = dict(assignment(db, shift_id))
    result = await put(HK1, tue="09:00-12:00")
    assert assignment(db, shift_id) == before                      # nothing moved, cancelled or re-assigned
    clashes = result["meta"]["shift_clashes"]
    assert [(c["id"], c["availability"]) for c in clashes] == [(shift_id, "outside")]
    inside = await put(HK1, rev=1, tue="07:00-15:00")
    assert inside["meta"]["shift_clashes"] == []


@pytest.mark.asyncio
async def test_unavailable_day_is_a_clash_and_still_changes_nothing(db):
    shift_id = await scheduled(user=U_HK1, day=NEAR_TUE)
    result = await put(HK1, tue="off")
    assert result["meta"]["shift_clashes"][0]["availability"] == "unavailable"
    assert assignment(db, shift_id)["user_id"] == U_HK1 and assignment(db, shift_id)["version"] == 1


@pytest.mark.asyncio
async def test_a_stale_revision_is_refused_and_an_identical_retry_is_recognised(db):
    await put(HK1, mon="07:00-15:00")
    with pytest.raises(CodedHTTPException) as exc:
        await put(HK1, rev=0, mon="08:00-16:00")                   # another device saved first
    assert refused(exc) == "availability_changed" and exc.value.extra["current"]["revision"] == 1
    again = await put(HK1, rev=0, mon="07:00-15:00")               # the answer to the first save was lost; same body again
    assert again["meta"]["replayed"] is True and again["data"]["revision"] == 1
    assert len([r for r in db.rows["employee_availability"] if r["status"] == "active"]) == 1


@pytest.mark.asyncio
async def test_availability_validation(db):
    for days, code in (({"mon": "09:00-12:00,11:00-14:00"}, "windows_overlap"), ):
        with pytest.raises(CodedHTTPException) as exc:
            await put(HK1, **days)
        assert refused(exc) == code
    with pytest.raises(CodedHTTPException) as exc:
        await avail.replace_my_availability(ReplaceAvailabilityRequest(expected_revision=0, days=[
            {"weekday": 0, "mode": "available", "windows": []}]), HK1)
    assert refused(exc) == "windows_required"
    with pytest.raises(CodedHTTPException) as exc:
        await avail.replace_my_availability(ReplaceAvailabilityRequest(expected_revision=0, days=[
            {"weekday": 0, "mode": "unavailable", "windows": [{"start": "07:00", "end": "15:00"}]}]), HK1)
    assert refused(exc) == "windows_not_allowed"
    with pytest.raises(CodedHTTPException) as exc:
        await avail.replace_my_availability(ReplaceAvailabilityRequest(expected_revision=0, days=[
            {"weekday": 0, "mode": "unavailable"}, {"weekday": 0, "mode": "unavailable"}]), HK1)
    assert refused(exc) == "duplicate_weekday"
    with pytest.raises(CodedHTTPException) as exc:
        await put(HK1, eff=today_plus(-2), mon="07:00-15:00")
    assert refused(exc) == "effective_in_past"
    with pytest.raises(ValidationError):                          # at most four windows a day, strict fields only
        week_body(mon="01:00-02:00,03:00-04:00,05:00-06:00,07:00-08:00,09:00-10:00")
    with pytest.raises(ValidationError):
        ReplaceAvailabilityRequest(expected_revision=0, days=[], user_id=U_HK2)
    with pytest.raises(ValidationError):
        ReplaceAvailabilityRequest(expected_revision=0, days=[{"weekday": 7, "mode": "unavailable"}])
    with pytest.raises(CodedHTTPException) as exc:
        await avail.replace_my_availability(ReplaceAvailabilityRequest(expected_revision=0, days=[
            {"weekday": 0, "mode": "available", "windows": [{"start": "25:00", "end": "26:00"}]}]), HK1)
    assert refused(exc) == "invalid_time"


@pytest.mark.asyncio
async def test_a_future_effective_date_keeps_the_current_week_until_then(db):
    await put(HK1, mon="07:00-15:00")
    start = today_plus(30)
    await put(HK1, rev=1, eff=start, mon="11:00-19:00")
    data = await state(HK1)
    assert by_weekday(data)[0]["windows"] == [{"start": "07:00", "end": "15:00"}]       # still the current rule
    assert data["upcoming_change"]["effective_from"] == start.isoformat()
    assert data["upcoming_change"]["weekly"][0]["windows"] == [{"start": "11:00", "end": "19:00"}]
    old = next(r for r in db.rows["employee_availability"] if r["revision"] == 1)
    assert old["status"] == "active" and old["effective_to"] == (start - timedelta(days=1)).isoformat()   # history kept, end-dated


@pytest.mark.asyncio
async def test_a_day_left_out_of_the_new_set_becomes_unset(db):
    await put(HK1, mon="07:00-15:00", tue="07:00-15:00")
    await put(HK1, rev=1, mon="07:00-15:00")
    days = by_weekday(await state(HK1))
    assert days[0]["state"] == "available" and days[1]["state"] == "unset"


@pytest.mark.asyncio
async def test_exceptions_are_added_once_per_date_and_can_be_retired(db):
    target = today_plus(10)
    saved = (await avail.add_my_exception(AvailabilityExceptionRequest(exception_date=target, mode="unavailable", note="Appointment"), HK1))["data"]
    assert saved["mode"] == "unavailable" and saved["windows"] == []
    with pytest.raises(CodedHTTPException) as exc:
        await avail.add_my_exception(AvailabilityExceptionRequest(exception_date=target, mode="unavailable"), HK1)
    assert refused(exc) == "exception_exists"
    assert [e["id"] for e in (await state(HK1))["exceptions"]] == [saved["id"]]
    with pytest.raises(CodedHTTPException) as exc:
        await avail.add_my_exception(AvailabilityExceptionRequest(exception_date=today_plus(-1), mode="unavailable"), HK1)
    assert refused(exc) == "date_in_past"
    with pytest.raises(CodedHTTPException) as exc:
        await avail.retire_availability(saved["id"], RetireAvailabilityRequest(expected_version=5), HK1)
    assert refused(exc) == "version_conflict"
    retired = (await avail.retire_availability(saved["id"], RetireAvailabilityRequest(expected_version=1), HK1))["data"]
    assert retired["version"] == 2 and (await state(HK1))["exceptions"] == []
    with pytest.raises(CodedHTTPException) as exc:
        await avail.retire_availability(saved["id"], RetireAvailabilityRequest(expected_version=2), HK1)
    assert refused(exc) == "availability_not_active"


@pytest.mark.asyncio
async def test_a_date_exception_with_hours_must_have_valid_windows(db):
    with pytest.raises(CodedHTTPException) as exc:
        await avail.add_my_exception(AvailabilityExceptionRequest(exception_date=today_plus(5), mode="available"), HK1)
    assert refused(exc) == "windows_required"
    ok = await avail.add_my_exception(AvailabilityExceptionRequest(
        exception_date=today_plus(5), mode="available", windows=[{"start": "10:00", "end": "14:00"}]), HK1)
    assert ok["data"]["windows"] == [{"start": "10:00", "end": "14:00"}]


@pytest.mark.asyncio
async def test_only_the_owner_or_a_supervisor_in_scope_may_retire_a_rule(db):
    target = today_plus(8)
    row = (await avail.add_my_exception(AvailabilityExceptionRequest(exception_date=target, mode="unavailable"), HK1))["data"]
    body = RetireAvailabilityRequest(expected_version=1)
    for stranger in (HK2, ENG, OTHER_GM):
        with pytest.raises(CodedHTTPException) as exc:
            await avail.retire_availability(row["id"], body, stranger)
        assert refused(exc) == "availability_not_found"          # somebody else's record = no such record
    assert (await avail.retire_availability(row["id"], body, SUP))["data"]["version"] == 2


# --- supervisors read their team ----------------------------------------------------------------------------------

async def team(actor, **kw):
    return await avail.team_availability(**{"q": None, "filter": "all", **kw}, current_user=actor)


@pytest.mark.asyncio
async def test_a_supervisor_sees_only_their_department_and_who_has_submitted_nothing(db):
    await put(HK1, mon="07:00-15:00", wed="off")
    data = await team(SUP)
    names = {p["id"]: p for p in data["data"]}
    assert set(names) == {U_HK1, U_HK2, U_HK3}                                           # no engineers, no inactive staff, not themselves
    assert names[U_HK1]["submitted"] and names[U_HK1]["freshness"] == "current"
    assert not names[U_HK2]["submitted"] and names[U_HK2]["freshness"] == "none" and names[U_HK2]["last_updated_at"] is None
    assert {d["state"] for d in names[U_HK2]["weekly"]} == {"unset"}
    assert [p["id"] for p in (await team(SUP, filter="none"))["data"]] == [U_HK2, U_HK3]
    assert [p["id"] for p in (await team(SUP, filter="submitted"))["data"]] == [U_HK1]
    assert [p["name"] for p in (await team(SUP, q="bea"))["data"]] == ["Bea Cruz"]


@pytest.mark.asyncio
async def test_team_availability_is_scoped_by_department_role_and_hotel(db):
    await put(HK1, mon="07:00-15:00")
    assert {p["id"] for p in (await team(ENG))["data"]} == {U_ENG2}
    assert {p["id"] for p in (await team(CHIEF))["data"]} == {U_ENG, U_ENG2}
    assert {p["id"] for p in (await team(GM))["data"]} >= {U_HK1, U_ENG}
    assert {p["id"] for p in (await team(OTHER_GM))["data"]} == {U_OTHER}          # their own hotel only; none of hotel-a


@pytest.mark.asyncio
async def test_stale_availability_is_labelled_stale_not_wrong(db):
    await put(HK1, mon="07:00-15:00")
    for row in db.rows["employee_availability"]:
        row["created_at"] = "2020-01-01T00:00:00+00:00"
    assert (await team(SUP, filter="stale"))["data"][0]["freshness"] == "stale"


@pytest.mark.asyncio
async def test_member_detail_includes_leave_and_clashes_and_hides_other_departments(db):
    await scheduled(user=U_HK1, day=NEAR_TUE)
    await put(HK1, tue="off")
    detail = (await avail.team_member_availability(U_HK1, SUP))["data"]
    assert detail["id"] == U_HK1 and detail["shift_clashes"][0]["availability"] == "unavailable"
    for actor, target in ((SUP, U_ENG), (ENG, U_HK1), (OTHER_GM, U_HK1), (SUP, "a0000042-0000-4000-8000-000000000042")):
        with pytest.raises(CodedHTTPException) as exc:
            await avail.team_member_availability(target, actor)
        assert refused(exc) == "employee_not_found"


def test_availability_routes_are_gated_by_role():
    from middleware.auth import get_current_user
    gates = {}
    for route in avail.router.routes:
        gates[route.path] = [d.call for d in route.dependant.dependencies if d.call is not get_current_user]
        assert gates[route.path], f"{route.path} has no role gate"
    assert set(gates) == {"/schedules/me/availability", "/schedules/me/availability/exceptions",
                          "/schedules/availability/{row_id}/retire", "/schedules/availability/team", "/schedules/availability/team/{user_id}"}


# --- availability feeds shift edits ---------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_adding_a_shift_outside_submitted_hours_warns_but_unknown_availability_is_silent(db):
    quiet = await create(SUP, user=U_HK1)                                              # nothing submitted
    assert not [w for w in quiet["meta"]["warnings"] if w["code"] in ("outside_availability", "marked_unavailable")]
    await put(HK2, tue="09:00-12:00")
    outside = await create(SUP, user=U_HK2)
    assert "outside_availability" in {w["code"] for w in outside["meta"]["warnings"]}
    await put(HK3, tue="off")
    off = await create(SUP, user=U_HK3)
    assert "marked_unavailable" in {w["code"] for w in off["meta"]["warnings"]}
    assert db.rows["shift_assignments"]                                                 # warnings advise, they do not refuse


@pytest.mark.asyncio
async def test_editing_a_shift_onto_unavailable_hours_warns(db):
    await put(HK1, tue="07:00-15:00")
    shift_id = await scheduled(user=U_HK1)
    saved = await sched.update_shift_assignment(shift_id, UpdateShiftAssignmentRequest(expected_version=1, start_time="08:00", end_time="18:00"), SUP)
    assert "outside_availability" in {w["code"] for w in saved["meta"]["warnings"]}


@pytest.mark.asyncio
async def test_approved_leave_refuses_a_new_or_moved_shift_and_pending_leave_only_warns(db):
    from .test_scheduling_leave_api import approved_leave, pending_leave
    await pending_leave(db, U_HK1, DAY, DAY)
    soft = await create(SUP, user=U_HK1)
    assert "pending_time_off" in {w["code"] for w in soft["meta"]["warnings"]}
    other = await scheduled(user=U_HK2, day=D2)
    await approved_leave(db, U_HK2, DAY, DAY)
    with pytest.raises(CodedHTTPException) as exc:
        await create(SUP, user=U_HK2)
    assert refused(exc) == "approved_time_off" and exc.value.extra["conflicts"][0]["user_id"] == U_HK2
    with pytest.raises(CodedHTTPException) as exc:             # moving an existing shift ONTO the leave is refused too
        await sched.update_shift_assignment(other, UpdateShiftAssignmentRequest(expected_version=1, work_date=DAY), SUP)
    assert refused(exc) == "approved_time_off" and assignment(db, other)["work_date"] == D2.isoformat()
    still_ok = await sched.update_shift_assignment(other, UpdateShiftAssignmentRequest(expected_version=1, notes="bring keys"), SUP)
    assert still_ok["data"]["notes"] == "bring keys"           # an unrelated edit is not held hostage by leave elsewhere


@pytest.mark.asyncio
async def test_leave_approved_over_an_existing_shift_leaves_that_shift_alone(db):
    from .test_scheduling_leave_api import approved_leave
    shift_id = await scheduled(user=U_HK1)
    before = dict(assignment(db, shift_id))
    await approved_leave(db, U_HK1, DAY, DAY)
    assert assignment(db, shift_id) == before
    rows = (await sched.update_shift_assignment(shift_id, UpdateShiftAssignmentRequest(expected_version=1, notes="still here"), SUP))["data"]
    assert rows["user_id"] == U_HK1


# --- coverage candidates -------------------------------------------------------------------------------------------

async def candidate_map(gap_id, actor=SUP):
    result = await coverage.find_candidates(gap_id, q=None, filter="all", role=None, current_user=actor)
    return {c["user_id"]: c for c in result["data"]}, result["meta"]


async def called_out_gap(user=U_HK1):
    shift_id = await scheduled(user=user)
    result = await absences.record_absence(RecordAbsenceRequest(assignment_id=shift_id, expected_version=1, kind="called_out"), SUP)
    return result["data"]["gap"]["id"], result["data"]["gap"]["version"]


@pytest.mark.asyncio
async def test_coverage_candidates_use_availability_and_unknown_stays_unknown(db):
    await put(HK2, tue="07:00-15:00")                                  # inside
    await put(HK3, tue="09:00-12:00")                                  # outside
    gap_id, _ = await called_out_gap()
    people, meta = await candidate_map(gap_id)
    assert people[U_HK2]["availability"] == "available" and "within_availability" in people[U_HK2]["reasons"]
    assert people[U_HK3]["availability"] == "outside" and "outside_availability" in people[U_HK3]["warnings"] and people[U_HK3]["eligible"]
    assert meta["availability_source"] == "submitted"
    nothing = (await candidate_map(gap_id))[0]
    await put(HK2, rev=1, tue="off")
    assert (await candidate_map(gap_id))[0][U_HK2]["availability"] == "unavailable"
    assert nothing[U_HK1]["blockers"] == ["is_absent_employee"]


@pytest.mark.asyncio
async def test_a_candidate_with_nothing_submitted_is_unknown_never_available(db):
    gap_id, _ = await called_out_gap()
    people, _ = await candidate_map(gap_id)
    assert people[U_HK2]["availability"] == "unknown" and "availability_unknown" in people[U_HK2]["warnings"]
    assert "within_availability" not in people[U_HK2]["reasons"]


@pytest.mark.asyncio
async def test_approved_leave_makes_a_candidate_ineligible_and_blocks_assignment(db):
    from .test_scheduling_leave_api import approved_leave
    await approved_leave(db, U_HK2, DAY, DAY)
    gap_id, version = await called_out_gap()
    people, _ = await candidate_map(gap_id)
    assert not people[U_HK2]["eligible"] and "approved_time_off" in people[U_HK2]["blockers"]
    assert people[U_HK2]["detail"]["leave"][0]["status"] == "approved"
    with pytest.raises(CodedHTTPException) as exc:
        await coverage.assign_gap(gap_id, AssignGapRequest(user_id=U_HK2, expected_version=version, acknowledge_warnings=True), SUP)
    assert refused(exc) == "candidate_ineligible" and "approved_time_off" in exc.value.extra["blockers"]


@pytest.mark.asyncio
async def test_pending_leave_and_outside_hours_need_an_explicit_acknowledgement(db):
    await put(HK2, tue="09:00-12:00")
    gap_id, version = await called_out_gap()
    with pytest.raises(CodedHTTPException) as exc:
        await coverage.assign_gap(gap_id, AssignGapRequest(user_id=U_HK2, expected_version=version), SUP)
    assert refused(exc) == "warnings_need_acknowledgement" and "outside_availability" in exc.value.extra["warnings"]
    done = await coverage.assign_gap(gap_id, AssignGapRequest(user_id=U_HK2, expected_version=version, acknowledge_warnings=True), SUP)
    assert done["data"]["status"] == "filled"


@pytest.mark.asyncio
async def test_unreadable_availability_degrades_to_unknown_not_to_available(db, monkeypatch):
    monkeypatch.setattr(coverage_fill, "assess_occurrences", lambda *a, **k: None)      # the read failed
    gap_id, _ = await called_out_gap()
    people, _ = await candidate_map(gap_id)
    assert people[U_HK2]["availability"] == "unknown" and "availability_unknown" in people[U_HK2]["warnings"]


@pytest.mark.asyncio
async def test_engineering_availability_is_not_visible_to_housekeeping_supervisors(db):
    await put(ENG, tue="08:00-16:00")
    await scheduled(user=U_ENG, shift_id=S_ENG, actor=GM)
    assert U_ENG not in {p["id"] for p in (await team(SUP))["data"]}
