"""Team Scheduling Phase 5: time-off requests (submit, approve, deny, cancel) and what approval does and does not do."""
from datetime import timedelta

import pytest
from pydantic import ValidationError

from core.errors import CodedHTTPException
from models.coverage_requests import AssignGapRequest, RecordAbsenceRequest
from models.leave_requests import CancelRequest, CreateTimeOffRequest, DecideTimeOffRequest
from routers import scheduling_absences as absences
from routers import scheduling_coverage as coverage
from routers import scheduling_leave as leave

from .request_support import (
    make_db,
    CHIEF, D2, D3, DAY, ENG, GM, HK1, HK2, HK3, OTHER_GM, SUP, U_ENG, U_HK1, U_HK2, U_HK3,
    assignment, audit, scheduled, today_plus,
)
from .test_scheduling_foundation import refused

@pytest.fixture
def db(monkeypatch):
    return make_db(monkeypatch)


ACTORS = {U_HK1: HK1, U_HK2: HK2, U_HK3: HK3, U_ENG: ENG}


def request(start=DAY, end=None, **kw):
    kw.setdefault("reason_category", "personal")
    return CreateTimeOffRequest(start_date=start, end_date=end or start, **kw)


async def pending_leave(db, user=U_HK1, start=DAY, end=None, **kw):
    return (await leave.create_time_off(request(start, end, **kw), ACTORS[user]))["data"]


async def approved_leave(db, user=U_HK1, start=DAY, end=None, **kw):
    made = await pending_leave(db, user, start, end, **kw)
    approver = GM if user == U_ENG else SUP
    return (await leave.approve_time_off(made["id"], DecideTimeOffRequest(expected_version=made["version"]), approver))["data"]


# --- submitting ------------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_request_is_saved_pending_for_the_signed_in_employee_and_changes_no_shift(db):
    shift_id = await scheduled(user=U_HK1)
    before = dict(assignment(db, shift_id))
    result = await leave.create_time_off(request(note="Family trip"), HK1)
    data = result["data"]
    assert (data["status"], data["user"]["id"], data["version"], data["note"]) == ("pending", U_HK1, 1, "Family trip")
    assert (data["start_date"], data["end_date"], data["partial"]) == (DAY.isoformat(), DAY.isoformat(), False)
    assert data["starts_at"].startswith("2030-01-08T06:00:00") and data["ends_at"].startswith("2030-01-09T06:00:00")   # Chicago midnight to midnight
    assert assignment(db, shift_id) == before
    assert audit(db, "time_off_request", "created")
    assert data["impact"]["shift_count"] == 1 and data["impact"]["unresolved_count"] == 1       # shown, not resolved
    assert data["can"] == {"approve": False, "deny": False, "cancel": True, "cancel_needs_reason": False}


def test_a_request_cannot_name_another_employee_or_a_status():
    for extra in ({"user_id": U_HK2}, {"status": "approved"}, {"department_id": "x"}):
        with pytest.raises(ValidationError):
            request(**extra)
    with pytest.raises(ValidationError):
        request(reason_category="chemotherapy")        # categories are coarse on purpose
    with pytest.raises(ValidationError):
        request(start_time="9am")


@pytest.mark.asyncio
async def test_dates_times_and_length_are_validated(db):
    cases = [
        (request(DAY + timedelta(2), DAY), "end_before_start"),
        (request(today_plus(-5), today_plus(-2)), "dates_in_past"),
        (request(DAY, DAY + timedelta(61)), "range_too_long"),
        (request(DAY, DAY + timedelta(1), partial=True, start_time="09:00", end_time="12:00"), "partial_must_be_one_day"),
        (request(DAY, partial=True), "invalid_partial_times"),
        (request(DAY, partial=True, start_time="09:00", end_time="09:00"), "invalid_partial_times"),
        (request(DAY, start_time="09:00", end_time="12:00"), "times_need_partial"),
    ]
    for body, code in cases:
        with pytest.raises(CodedHTTPException) as exc:
            await leave.create_time_off(body, HK1)
        assert refused(exc) == code, code
    with pytest.raises(ValidationError):                                   # an impossible clock time never reaches the handler
        request(DAY, partial=True, start_time="25:00", end_time="26:00")
    assert db.rows["time_off_requests"] == []


@pytest.mark.asyncio
async def test_a_partial_day_covers_only_its_hours_and_an_overnight_partial_is_allowed(db):
    data = await pending_leave(db, start=DAY, partial=True, start_time="13:00", end_time="17:00")
    assert data["partial"] and data["starts_at"].startswith("2030-01-08T19:00:00") and data["ends_at"].startswith("2030-01-08T23:00:00")
    overnight = await pending_leave(db, U_HK2, start=DAY, partial=True, start_time="22:00", end_time="06:00")
    assert overnight["ends_at"].startswith("2030-01-09T12:00:00")


@pytest.mark.asyncio
async def test_overlapping_live_requests_are_refused_adjacent_and_dead_ones_are_not(db):
    first = await pending_leave(db, start=DAY, end=D2)
    with pytest.raises(CodedHTTPException) as exc:
        await leave.create_time_off(request(D2, D3), HK1)
    assert refused(exc) == "leave_overlap" and exc.value.extra["conflicts"][0]["id"] == first["id"]
    await pending_leave(db, start=D3)                                      # the next day is fine
    await leave.deny_time_off(first["id"], DecideTimeOffRequest(expected_version=1, reason="Short staffed"), SUP)
    assert (await pending_leave(db, start=D2))["status"] == "pending"      # denied leave no longer blocks
    other = await pending_leave(db, U_HK2, start=DAY)                       # another person can ask for the same dates
    assert other["user"]["id"] == U_HK2


@pytest.mark.asyncio
async def test_a_retried_submission_returns_the_original_request(db):
    first = await leave.create_time_off(request(idempotency_key="retry-key-0001"), HK1)
    again = await leave.create_time_off(request(idempotency_key="retry-key-0001"), HK1)
    assert again["meta"]["replayed"] and again["data"]["id"] == first["data"]["id"]
    assert len(db.rows["time_off_requests"]) == 1


@pytest.mark.asyncio
async def test_only_active_staff_can_request_time_off(db):
    from middleware.auth import CurrentUser
    stranger = CurrentUser(user_id="a0000077-0000-4000-8000-000000000077", hotel_id="hotel-a", role="housekeeper", email="n@x.test")
    with pytest.raises(CodedHTTPException) as exc:
        await leave.create_time_off(request(), stranger)
    assert refused(exc) == "not_active_staff"


# --- visibility --------------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_request_is_visible_only_to_its_owner_and_supervisors_of_that_department(db):
    made = await pending_leave(db, note="private note")
    assert (await leave.get_time_off(made["id"], HK1))["data"]["note"] == "private note"
    assert (await leave.get_time_off(made["id"], SUP))["data"]["viewer"] == "manager"
    assert (await leave.get_time_off(made["id"], GM))["data"]["id"] == made["id"]
    for stranger in (HK2, ENG, CHIEF, OTHER_GM):
        with pytest.raises(CodedHTTPException) as exc:
            await leave.get_time_off(made["id"], stranger)
        assert refused(exc) == "request_not_found"
        with pytest.raises(CodedHTTPException):
            await leave.time_off_history(made["id"], stranger)


@pytest.mark.asyncio
async def test_decision_routes_admit_only_schedule_managers():
    from middleware.auth import get_current_user
    from fastapi import HTTPException
    for route in leave.router.routes:
        if route.path.endswith(("/approve", "/deny")):
            gates = [d.call for d in route.dependant.dependencies if d.call is not get_current_user]
            assert gates
            assert (await gates[0](SUP)).user_id == SUP.user_id
            for denied in (HK1, CHIEF):
                with pytest.raises(HTTPException) as exc:
                    await gates[0](denied)
                assert exc.value.status_code == 403


# --- approving and denying -----------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_approval_records_the_decision_but_never_touches_a_scheduled_shift(db):
    shift_id = await scheduled(user=U_HK1)
    before = dict(assignment(db, shift_id))
    made = await pending_leave(db)
    result = await leave.approve_time_off(made["id"], DecideTimeOffRequest(expected_version=1), SUP)
    data = result["data"]
    assert data["status"] == "approved" and data["decided_by"]["id"] == SUP.user_id and data["version"] == 2
    assert assignment(db, shift_id) == before and db.rows["shift_assignments"] == [before]    # nothing deleted, moved or cancelled
    impact = data["impact"]
    assert impact["verified"] and impact["shift_count"] == 1 and impact["unresolved_count"] == 1
    assert impact["shifts"][0]["id"] == shift_id and impact["shifts"][0]["overlap"] == "full" and not impact["shifts"][0]["resolved"]
    assert result["meta"]["follow_up_required"] is True                  # approved is NOT the same as resolved
    assert [e["to_status"] for e in data["timeline"]] == ["pending", "approved"]
    assert audit(db, "time_off_request", "approved")


@pytest.mark.asyncio
async def test_a_partial_overlap_is_reported_as_partial(db):
    await scheduled(user=U_HK1)                                          # 07:00-15:00
    made = await pending_leave(db, partial=True, start_time="13:00", end_time="17:00")
    data = (await leave.approve_time_off(made["id"], DecideTimeOffRequest(expected_version=1), SUP))["data"]
    assert data["impact"]["shifts"][0]["overlap"] == "partial"


@pytest.mark.asyncio
async def test_follow_up_is_resolved_only_when_coverage_actually_resolves_the_shift(db):
    shift_id = await scheduled(user=U_HK1)
    approved = await approved_leave(db)
    assert approved["impact"]["unresolved_count"] == 1
    out = await absences.record_absence(RecordAbsenceRequest(assignment_id=shift_id, expected_version=1, kind="unavailable"), SUP)
    gap = out["data"]["gap"]
    mid = (await leave.get_time_off(approved["id"], SUP))["data"]["impact"]
    assert mid["shifts"][0]["coverage"]["status"] == "open" and mid["unresolved_count"] == 1       # an open gap is not a resolution
    await coverage.assign_gap(gap["id"], AssignGapRequest(user_id=U_HK2, expected_version=gap["version"], acknowledge_warnings=True), SUP)
    done = (await leave.get_time_off(approved["id"], SUP))["data"]["impact"]
    assert done["unresolved_count"] == 0 and done["shifts"][0]["resolved"]
    assert done["shifts"][0]["coverage"]["replacement"]["id"] == U_HK2


@pytest.mark.asyncio
async def test_denial_needs_a_reason_and_persists_who_when_and_why(db):
    made = await pending_leave(db)
    with pytest.raises(CodedHTTPException) as exc:
        await leave.deny_time_off(made["id"], DecideTimeOffRequest(expected_version=1), SUP)
    assert refused(exc) == "reason_required" and db.rows["time_off_requests"][0]["status"] == "pending"
    denied = (await leave.deny_time_off(made["id"], DecideTimeOffRequest(expected_version=1, reason="Inventory week"), SUP))["data"]
    assert (denied["status"], denied["decision_reason"], denied["decided_by"]["id"]) == ("denied", "Inventory week", SUP.user_id)
    assert denied["decided_at"] and audit(db, "time_off_request", "denied")[0]["reason_note"] == "Inventory week"
    assert denied["can"]["approve"] is False and denied["can"]["cancel"] is False


@pytest.mark.asyncio
async def test_two_supervisors_cannot_both_decide_and_a_stale_screen_gets_the_current_state(db):
    made = await pending_leave(db)
    await leave.approve_time_off(made["id"], DecideTimeOffRequest(expected_version=1), SUP)
    with pytest.raises(CodedHTTPException) as exc:                        # the second supervisor tries to deny the same request
        await leave.deny_time_off(made["id"], DecideTimeOffRequest(expected_version=1, reason="No"), GM)
    assert refused(exc) == "request_not_pending" and exc.value.extra["current_status"] == "approved"
    with pytest.raises(CodedHTTPException) as exc:
        await leave.approve_time_off(made["id"], DecideTimeOffRequest(expected_version=1), GM)
    assert refused(exc) == "request_not_pending"
    assert db.rows["time_off_requests"][0]["status"] == "approved" and len(audit(db, "time_off_request", "approved")) == 1


@pytest.mark.asyncio
async def test_a_wrong_version_is_a_conflict_not_a_silent_overwrite(db):
    made = await pending_leave(db)
    with pytest.raises(CodedHTTPException) as exc:
        await leave.approve_time_off(made["id"], DecideTimeOffRequest(expected_version=7), SUP)
    assert refused(exc) == "version_conflict" and db.rows["time_off_requests"][0]["status"] == "pending"


@pytest.mark.asyncio
async def test_a_retried_decision_by_the_same_person_is_a_success(db):
    made = await pending_leave(db)
    await leave.approve_time_off(made["id"], DecideTimeOffRequest(expected_version=1), SUP)
    again = await leave.approve_time_off(made["id"], DecideTimeOffRequest(expected_version=1), SUP)
    assert again["meta"]["replayed"] and again["data"]["status"] == "approved" and len(audit(db, "time_off_request", "approved")) == 1


@pytest.mark.asyncio
async def test_approval_races_with_the_employee_withdrawing(db):
    made = await pending_leave(db)
    await leave.cancel_time_off(made["id"], CancelRequest(expected_version=1), HK1)        # the employee withdrew first
    with pytest.raises(CodedHTTPException) as exc:
        await leave.approve_time_off(made["id"], DecideTimeOffRequest(expected_version=1), SUP)
    assert refused(exc) == "request_not_pending" and exc.value.extra["current_status"] == "cancelled"


@pytest.mark.asyncio
async def test_supervisors_cannot_decide_outside_their_department_or_their_own_request(db):
    eng_request = await pending_leave(db, U_ENG)
    for outsider in (SUP, OTHER_GM):
        with pytest.raises(CodedHTTPException) as exc:
            await leave.approve_time_off(eng_request["id"], DecideTimeOffRequest(expected_version=1), outsider)
        assert refused(exc) == "request_not_found"
    own = (await leave.create_time_off(request(DAY), SUP))["data"]
    with pytest.raises(CodedHTTPException) as exc:
        await leave.approve_time_off(own["id"], DecideTimeOffRequest(expected_version=1), SUP)
    assert refused(exc) == "cannot_decide_own"
    assert (await leave.approve_time_off(own["id"], DecideTimeOffRequest(expected_version=1), GM))["data"]["status"] == "approved"
    gm_own = (await leave.create_time_off(request(D3), GM))["data"]
    assert (await leave.approve_time_off(gm_own["id"], DecideTimeOffRequest(expected_version=1), GM))["data"]["status"] == "approved"


@pytest.mark.asyncio
async def test_leave_that_has_already_ended_cannot_be_decided(db):
    made = await pending_leave(db, start=today_plus(0))
    db.rows["time_off_requests"][0]["ends_at"] = "2020-01-01T00:00:00+00:00"
    db.rows["time_off_requests"][0]["starts_at"] = "2019-12-31T00:00:00+00:00"
    with pytest.raises(CodedHTTPException) as exc:
        await leave.approve_time_off(made["id"], DecideTimeOffRequest(expected_version=1), SUP)
    assert refused(exc) == "leave_over"


# --- cancelling -------------------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_an_employee_withdraws_a_pending_request_without_giving_a_reason(db):
    made = await pending_leave(db)
    result = await leave.cancel_time_off(made["id"], CancelRequest(expected_version=1), HK1)
    assert result["data"]["status"] == "cancelled" and audit(db, "time_off_request", "cancelled")
    again = await leave.cancel_time_off(made["id"], CancelRequest(expected_version=1), HK1)
    assert again["meta"]["replayed"]


@pytest.mark.asyncio
async def test_cancelling_approved_leave_needs_a_reason_and_restores_nothing(db):
    shift_id = await scheduled(user=U_HK1)
    approved = await approved_leave(db)
    out = await absences.record_absence(RecordAbsenceRequest(assignment_id=shift_id, expected_version=1, kind="unavailable"), SUP)
    await coverage.assign_gap(out["data"]["gap"]["id"], AssignGapRequest(user_id=U_HK2, expected_version=out["data"]["gap"]["version"], acknowledge_warnings=True), SUP)
    before = [dict(a) for a in db.rows["shift_assignments"]]
    with pytest.raises(CodedHTTPException) as exc:
        await leave.cancel_time_off(approved["id"], CancelRequest(expected_version=2), HK1)
    assert refused(exc) == "reason_required"
    cancelled = (await leave.cancel_time_off(approved["id"], CancelRequest(expected_version=2, reason="Plans changed"), HK1))["data"]
    assert cancelled["status"] == "cancelled" and cancelled["cancel_reason"] == "Plans changed"
    assert db.rows["shift_assignments"] == before                          # the replacement stays; nothing was silently restored
    assert cancelled["impact"]["shifts"][0]["coverage"]["status"] == "filled"   # shown so a supervisor can review it


@pytest.mark.asyncio
async def test_a_supervisor_may_cancel_approved_leave_with_a_reason_but_not_pending_leave(db):
    pending = await pending_leave(db)
    with pytest.raises(CodedHTTPException) as exc:
        await leave.cancel_time_off(pending["id"], CancelRequest(expected_version=1, reason="x"), SUP)
    assert refused(exc) == "request_not_cancellable"                        # a supervisor denies a pending request; only the employee withdraws it
    await leave.approve_time_off(pending["id"], DecideTimeOffRequest(expected_version=1), SUP)
    done = await leave.cancel_time_off(pending["id"], CancelRequest(expected_version=2, reason="Coverage emergency"), SUP)
    assert done["data"]["status"] == "cancelled"


@pytest.mark.asyncio
async def test_nobody_else_can_cancel_and_a_finished_request_cannot_change(db):
    made = await pending_leave(db)
    for stranger in (HK2, ENG):
        with pytest.raises(CodedHTTPException) as exc:
            await leave.cancel_time_off(made["id"], CancelRequest(expected_version=1), stranger)
        assert refused(exc) == "request_not_found"
    await leave.deny_time_off(made["id"], DecideTimeOffRequest(expected_version=1, reason="No"), SUP)
    with pytest.raises(CodedHTTPException) as exc:
        await leave.cancel_time_off(made["id"], CancelRequest(expected_version=2), HK1)
    assert refused(exc) == "request_not_cancellable"
