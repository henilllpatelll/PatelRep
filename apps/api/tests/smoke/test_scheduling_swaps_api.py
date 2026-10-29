"""Team Scheduling Phase 5: two-way shift swaps (propose, coworker answer, supervisor approval) and the request inboxes."""
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from core.errors import CodedHTTPException
from models.coverage_requests import RecordAbsenceRequest
from models.leave_requests import CancelRequest, CreateSwapRequest, DecideSwapRequest, DecideTimeOffRequest, RespondSwapRequest
from routers import scheduling_absences as absences
from routers import scheduling_inbox as inbox
from routers import scheduling_leave as leave
from routers import scheduling_swaps as swaps

from .request_support import (
    make_db,
    CHIEF, D2, D3, DAY, ENG, GM, HK1, HK2, HK3, OTHER_GM, S_ENG, S_EVE, SUP, U_ENG, U_HK1, U_HK2, U_HK3,
    assignment, audit, scheduled,
)
from .test_scheduling_foundation import refused
from .test_scheduling_leave_api import approved_leave, pending_leave

@pytest.fixture
def db(monkeypatch):
    return make_db(monkeypatch)


async def pair(db, a_user=U_HK1, a_day=DAY, b_user=U_HK2, b_day=D2, **extra):
    """Two published shifts held by two housekeepers on different days: the ordinary swappable pair."""
    return await scheduled(user=a_user, day=a_day), await scheduled(user=b_user, day=b_day, **extra)


async def propose(a_id, b_id, actor=HK1, **kw):
    return await swaps.propose_swap(CreateSwapRequest(requester_assignment_id=a_id, counterpart_assignment_id=b_id, **kw), actor)


async def accepted_swap(db, **kw):
    a, b = await pair(db, **kw)
    swap = (await propose(a, b))["data"]
    await swaps.respond_to_swap(swap["id"], RespondSwapRequest(accept=True, expected_version=1), HK2)
    return a, b, swap["id"]


def row(db, swap_id):
    return next(s for s in db.rows["shift_swap_requests"] if s["id"] == swap_id)


async def approve(swap_id, version=2, actor=SUP, ack=False):
    return await swaps.approve_swap(swap_id, DecideSwapRequest(expected_version=version, acknowledge_warnings=ack), actor)


def owners(db, *ids):
    return [assignment(db, i)["user_id"] for i in ids]


# --- proposing -------------------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_proposal_names_both_shifts_and_changes_nobodys_schedule(db):
    a, b = await pair(db)
    before = [dict(assignment(db, a)), dict(assignment(db, b))]
    result = await propose(a, b, note="Dentist on Wednesday")
    swap = result["data"]
    assert (swap["status"], swap["version"], swap["viewer"]) == ("proposed", 1, "requester")
    assert (swap["requester"]["id"], swap["counterpart"]["id"]) == (U_HK1, U_HK2)          # the requester is the session, the counterpart the shift's holder
    assert swap["requester_shift"]["id"] == a and swap["counterpart_shift"]["id"] == b and swap["requester_shift"]["work_date"] == DAY.isoformat()
    assert [dict(assignment(db, a)), dict(assignment(db, b))] == before
    assert swap["can"] == {"respond": False, "cancel": True, "approve": False, "deny": False}
    assert audit(db, "shift_swap", "proposed") and swap["analysis"]["blockers"] == []
    assert datetime.fromisoformat(swap["expires_at"]) <= datetime.now(timezone.utc) + timedelta(hours=72, minutes=1)


def test_a_proposal_cannot_name_the_requester():
    ok = "b0000001-0000-4000-8000-000000000001"
    with pytest.raises(ValidationError):
        CreateSwapRequest(requester_assignment_id=ok, counterpart_assignment_id=ok.replace("1", "2"), requester_id=U_HK2)
    with pytest.raises(ValidationError):
        CreateSwapRequest(requester_assignment_id="nope", counterpart_assignment_id=ok)


@pytest.mark.asyncio
async def test_you_can_only_offer_your_own_shift(db):
    a, b = await pair(db)
    for stranger in (HK3, SUP):
        with pytest.raises(CodedHTTPException) as exc:
            await propose(a, b, stranger)
        assert refused(exc) == "assignment_not_found"
    with pytest.raises(CodedHTTPException) as exc:
        await propose(a, "b0000009-0000-4000-8000-000000000009")
    assert refused(exc) == "assignment_not_found"
    assert db.rows["shift_swap_requests"] == []


@pytest.mark.asyncio
async def test_shifts_that_cannot_be_exchanged_are_refused_with_reasons(db):
    a, same_day = await pair(db, b_day=DAY)                                      # both 07:00-15:00 on the same day
    with pytest.raises(CodedHTTPException) as exc:
        await propose(a, same_day)
    assert refused(exc) == "swap_invalid" and "shifts_overlap" in {b["code"] for b in exc.value.extra["blockers"]}

    mine = await scheduled(user=U_HK1, day=D3)
    eng = await scheduled(user=U_ENG, shift_id=S_ENG, day=D3, actor=GM)
    with pytest.raises(CodedHTTPException) as exc:
        await propose(mine, eng)
    assert "different_departments" in {b["code"] for b in exc.value.extra["blockers"]}

    own_other = await scheduled(user=U_HK1, shift_id=S_EVE, day=D3)
    with pytest.raises(CodedHTTPException) as exc:
        await propose(mine, own_other)
    assert "same_person" in {b["code"] for b in exc.value.extra["blockers"]}


@pytest.mark.asyncio
async def test_the_receiving_person_must_not_end_up_double_booked_or_on_approved_leave(db):
    a, b = await pair(db)
    await scheduled(user=U_HK2, day=DAY, shift_id=S_EVE, actor=SUP)             # HK2 is already on the evening of HK1's day: fine (back to back)
    ok = await propose(a, b)
    assert [w["code"] for w in ok["meta"]["warnings"]] == ["insufficient_rest"]  # advisory, to be acknowledged at approval
    await swaps.cancel_swap(ok["data"]["id"], CancelRequest(expected_version=1), HK1)

    await approved_leave(db, U_HK2, DAY, DAY)
    with pytest.raises(CodedHTTPException) as exc:
        await propose(a, b)
    assert {"code": "approved_time_off", "user_id": U_HK2} in exc.value.extra["blockers"]


@pytest.mark.asyncio
async def test_a_shift_with_a_call_out_or_already_in_a_live_swap_cannot_be_swapped(db):
    a, b = await pair(db)
    await absences.record_absence(RecordAbsenceRequest(assignment_id=a, expected_version=1, kind="called_out"), SUP)
    with pytest.raises(CodedHTTPException) as exc:
        await propose(a, b)
    assert refused(exc) == "shift_has_callout"

    c, d = await pair(db, a_user=U_HK3, a_day=D3, b_user=U_HK2, b_day=D3 + timedelta(days=1))
    await propose(c, d, HK3)
    third = await scheduled(user=U_HK1, day=D3 + timedelta(days=2))
    with pytest.raises(CodedHTTPException) as exc:
        await propose(third, d)                                                  # d is already half of a live swap
    assert refused(exc) == "shift_in_live_swap"


@pytest.mark.asyncio
async def test_a_shift_that_starts_very_soon_cannot_be_swapped(db):
    a, b = await pair(db)
    assignment(db, a)["starts_at"] = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
    assignment(db, a)["ends_at"] = (datetime.now(timezone.utc) + timedelta(hours=8)).isoformat()
    with pytest.raises(CodedHTTPException) as exc:
        await propose(a, b)
    assert "shift_too_soon" in {x["code"] for x in exc.value.extra["blockers"]}


@pytest.mark.asyncio
async def test_a_retried_proposal_returns_the_original(db):
    a, b = await pair(db)
    first = await propose(a, b, idempotency_key="retry-key-0001")
    again = await propose(a, b, idempotency_key="retry-key-0001")
    assert again["meta"]["replayed"] and again["data"]["id"] == first["data"]["id"] and len(db.rows["shift_swap_requests"]) == 1


# --- choosing a coworker ---------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_swap_options_list_only_valid_coworker_shifts_with_minimal_detail(db):
    mine = await scheduled(user=U_HK1, day=DAY)
    good = await scheduled(user=U_HK2, day=D2)
    await scheduled(user=U_HK3, day=DAY)                                          # overlaps mine: not offered
    await scheduled(user=U_ENG, shift_id=S_ENG, day=D2, actor=GM)                 # other department: not offered
    called_out = await scheduled(user=U_HK3, day=D3)
    await absences.record_absence(RecordAbsenceRequest(assignment_id=called_out, expected_version=1, kind="called_out"), SUP)
    result = await swaps.swap_options(mine, HK1)
    shown = [(g["person"]["id"], [s["id"] for s in g["shifts"]]) for g in result["data"]]
    assert shown == [(U_HK2, [good])]
    person = result["data"][0]["person"]
    assert set(person) == {"id", "name", "role"}                                   # no email, phone, availability, leave
    assert set(result["data"][0]["shifts"][0]) <= {"id", "work_date", "shift_name", "start_time", "end_time", "starts_at", "ends_at",
                                                    "version", "department_id", "user_id", "warnings"}


@pytest.mark.asyncio
async def test_swap_options_are_for_your_own_shifts_only_and_empty_when_the_shift_is_tied_up(db):
    a, b = await pair(db)
    with pytest.raises(CodedHTTPException) as exc:
        await swaps.swap_options(a, HK2)
    assert refused(exc) == "assignment_not_found"
    await propose(a, b)
    assert (await swaps.swap_options(a, HK1))["data"] == []                         # already half of a live swap


# --- the coworker's answer --------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_acceptance_records_willingness_but_does_not_change_the_schedule(db):
    a, b = await pair(db)
    swap = (await propose(a, b))["data"]
    seen = (await swaps.get_swap(swap["id"], HK2))["data"]
    assert seen["viewer"] == "counterpart" and seen["can"]["respond"] and not seen["can"]["approve"]
    answered = await swaps.respond_to_swap(swap["id"], RespondSwapRequest(accept=True, expected_version=1, note="Happy to"), HK2)
    assert answered["data"]["status"] == "accepted" and answered["data"]["response_note"] == "Happy to"
    assert owners(db, a, b) == [U_HK1, U_HK2]                                       # still exactly as scheduled
    assert answered["data"]["version"] == 2 and audit(db, "shift_swap", "accepted")


@pytest.mark.asyncio
async def test_a_coworker_can_decline_and_the_decline_is_final(db):
    a, b = await pair(db)
    swap = (await propose(a, b))["data"]
    declined = (await swaps.respond_to_swap(swap["id"], RespondSwapRequest(accept=False, expected_version=1), HK2))["data"]
    assert declined["status"] == "declined" and owners(db, a, b) == [U_HK1, U_HK2]
    with pytest.raises(CodedHTTPException) as exc:
        await swaps.respond_to_swap(swap["id"], RespondSwapRequest(accept=True, expected_version=2), HK2)
    assert refused(exc) == "swap_not_proposed"
    assert (await swaps.respond_to_swap(swap["id"], RespondSwapRequest(accept=False, expected_version=1), HK2))["meta"]["replayed"]


@pytest.mark.asyncio
async def test_only_the_asked_coworker_can_answer(db):
    a, b = await pair(db)
    swap = (await propose(a, b))["data"]
    with pytest.raises(CodedHTTPException) as exc:
        await swaps.respond_to_swap(swap["id"], RespondSwapRequest(accept=True, expected_version=1), HK1)
    assert refused(exc) == "not_counterpart"
    for stranger in (HK3, ENG, OTHER_GM):
        with pytest.raises(CodedHTTPException) as exc:
            await swaps.respond_to_swap(swap["id"], RespondSwapRequest(accept=True, expected_version=1), stranger)
        assert refused(exc) == "swap_not_found"
    assert row(db, swap["id"])["status"] == "proposed"


@pytest.mark.asyncio
async def test_an_expired_proposal_cannot_be_accepted_and_reads_as_expired(db):
    a, b = await pair(db)
    swap = (await propose(a, b))["data"]
    row(db, swap["id"])["expires_at"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    assert (await swaps.get_swap(swap["id"], HK1))["data"]["status"] == "expired"
    with pytest.raises(CodedHTTPException) as exc:
        await swaps.respond_to_swap(swap["id"], RespondSwapRequest(accept=True, expected_version=1), HK2)
    assert refused(exc) == "swap_expired" and row(db, swap["id"])["status"] == "proposed"


@pytest.mark.asyncio
async def test_a_stale_answer_is_a_conflict_and_a_changed_shift_blocks_acceptance(db):
    from models.requests import UpdateShiftAssignmentRequest
    from routers import scheduling as sched
    a, b = await pair(db)
    swap = (await propose(a, b))["data"]
    with pytest.raises(CodedHTTPException) as exc:
        await swaps.respond_to_swap(swap["id"], RespondSwapRequest(accept=True, expected_version=9), HK2)
    assert refused(exc) == "version_conflict"
    await sched.update_shift_assignment(a, UpdateShiftAssignmentRequest(expected_version=1, start_time="08:00", end_time="16:00"), SUP)
    with pytest.raises(CodedHTTPException) as exc:
        await swaps.respond_to_swap(swap["id"], RespondSwapRequest(accept=True, expected_version=1), HK2)
    assert refused(exc) == "swap_invalid" and "shift_changed" in {x["code"] for x in exc.value.extra["blockers"]}


# --- supervisor approval: the atomic exchange --------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_approval_exchanges_both_shifts_together_and_audits_it(db):
    a, b, swap_id = await accepted_swap(db)
    result = await approve(swap_id)
    assert result["data"]["status"] == "approved" and result["data"]["decided_by"]["id"] == SUP.user_id
    assert owners(db, a, b) == [U_HK2, U_HK1]                                       # exchanged
    assert [assignment(db, a)["version"], assignment(db, b)["version"]] == [2, 2]   # each shift's history shows the change
    assert db.swap_steps == [("exchanged", a, b)]
    assert {e["resource_type"] for e in audit(db, "shift_swap") + audit(db, "shift_assignment", "swapped")} == {"shift_swap", "shift_assignment"}
    assert len(audit(db, "shift_assignment", "swapped")) == 2 and result["data"]["can"]["approve"] is False
    assert [e["action"] for e in result["data"]["timeline"]] == ["proposed", "accepted", "approved"]


@pytest.mark.asyncio
async def test_a_swap_still_waiting_for_the_coworker_cannot_be_approved(db):
    a, b = await pair(db)
    swap = (await propose(a, b))["data"]
    with pytest.raises(CodedHTTPException) as exc:
        await approve(swap["id"], 1)
    assert refused(exc) == "swap_not_approvable" and owners(db, a, b) == [U_HK1, U_HK2]


@pytest.mark.asyncio
async def test_only_a_supervisor_of_that_department_can_decide(db):
    a, b, swap_id = await accepted_swap(db)
    for outsider in (ENG, OTHER_GM):
        with pytest.raises(CodedHTTPException) as exc:
            await approve(swap_id, actor=outsider)
        assert refused(exc) == "swap_not_found"
    assert owners(db, a, b) == [U_HK1, U_HK2]
    from middleware.auth import get_current_user
    from fastapi import HTTPException
    for route in swaps.router.routes:
        if route.path.endswith(("/approve", "/deny")):
            gate = [d.call for d in route.dependant.dependencies if d.call is not get_current_user][0]
            for denied in (HK1, CHIEF):
                with pytest.raises(HTTPException):
                    await gate(denied)


@pytest.mark.asyncio
async def test_stale_versions_and_double_approval_are_conflicts(db):
    a, b, swap_id = await accepted_swap(db)
    with pytest.raises(CodedHTTPException) as exc:
        await approve(swap_id, 1)
    assert refused(exc) == "version_conflict"
    await approve(swap_id)
    with pytest.raises(CodedHTTPException) as exc:                                  # a second supervisor arrives late
        await approve(swap_id, 2, actor=GM)
    assert refused(exc) == "swap_not_approvable" and exc.value.extra["current_status"] == "approved"
    assert owners(db, a, b) == [U_HK2, U_HK1]                                       # exchanged exactly once
    assert (await approve(swap_id, 2))["meta"]["replayed"]                          # the first supervisor's retry is a success


@pytest.mark.asyncio
async def test_the_coworker_withdrawing_during_approval_wins_and_nothing_changes(db):
    a, b, swap_id = await accepted_swap(db)
    db.swap_gate = lambda: row(db, swap_id).update(status="cancelled", version=3)
    with pytest.raises(CodedHTTPException) as exc:
        await approve(swap_id)
    assert refused(exc) == "swap_not_approvable" and owners(db, a, b) == [U_HK1, U_HK2] and db.swap_steps == []


@pytest.mark.asyncio
async def test_a_shift_edited_during_approval_aborts_the_whole_exchange(db):
    a, b, swap_id = await accepted_swap(db)
    db.swap_gate = lambda: assignment(db, b).update(version=assignment(db, b)["version"] + 1)
    with pytest.raises(CodedHTTPException) as exc:
        await approve(swap_id)
    assert refused(exc) == "shift_changed"
    assert owners(db, a, b) == [U_HK1, U_HK2] and row(db, swap_id)["status"] == "accepted"      # neither person's schedule moved


@pytest.mark.asyncio
async def test_leave_approved_after_acceptance_blocks_the_exchange_for_both_people(db):
    a, b, swap_id = await accepted_swap(db)
    leave_row = await pending_leave(db, U_HK2, DAY, DAY)
    await leave.approve_time_off(leave_row["id"], DecideTimeOffRequest(expected_version=1), SUP)
    with pytest.raises(CodedHTTPException) as exc:
        await approve(swap_id)
    assert refused(exc) == "swap_invalid" and {"code": "approved_time_off", "user_id": U_HK2} in exc.value.extra["blockers"]
    assert owners(db, a, b) == [U_HK1, U_HK2]


@pytest.mark.asyncio
async def test_leave_landing_between_the_precheck_and_the_exchange_rolls_everything_back(db):
    a, b, swap_id = await accepted_swap(db)
    def sneak_in_leave():
        row_ = {"id": "leave-race", "tenant_id": "hotel-a", "user_id": U_HK2, "status": "approved",
                "starts_at": assignment(db, a)["starts_at"], "ends_at": assignment(db, a)["ends_at"]}
        db.rows["time_off_requests"].append(row_)
    db.swap_gate = sneak_in_leave
    with pytest.raises(CodedHTTPException) as exc:
        await approve(swap_id)
    assert refused(exc) == "approved_time_off" and owners(db, a, b) == [U_HK1, U_HK2] and row(db, swap_id)["status"] == "accepted"


@pytest.mark.asyncio
async def test_warnings_must_be_acknowledged_before_approval(db):
    a, b = await pair(db)
    await scheduled(user=U_HK2, day=DAY, shift_id=S_EVE, actor=SUP)               # back to back with the shift HK2 would receive
    swap = (await propose(a, b))["data"]
    await swaps.respond_to_swap(swap["id"], RespondSwapRequest(accept=True, expected_version=1), HK2)
    with pytest.raises(CodedHTTPException) as exc:
        await approve(swap["id"])
    assert refused(exc) == "warnings_need_acknowledgement" and owners(db, a, b) == [U_HK1, U_HK2]
    assert (await approve(swap["id"], ack=True))["data"]["status"] == "approved"


@pytest.mark.asyncio
async def test_denial_needs_a_reason_and_leaves_both_schedules_alone(db):
    a, b, swap_id = await accepted_swap(db)
    with pytest.raises(CodedHTTPException) as exc:
        await swaps.deny_swap(swap_id, DecideSwapRequest(expected_version=2), SUP)
    assert refused(exc) == "reason_required"
    denied = (await swaps.deny_swap(swap_id, DecideSwapRequest(expected_version=2, reason="Training that day"), SUP))["data"]
    assert (denied["status"], denied["decision_reason"]) == ("denied", "Training that day") and owners(db, a, b) == [U_HK1, U_HK2]
    assert audit(db, "shift_swap", "denied")[0]["reason_note"] == "Training that day"


@pytest.mark.asyncio
async def test_participants_may_withdraw_before_approval_but_not_after(db):
    a, b = await pair(db)
    swap = (await propose(a, b))["data"]
    with pytest.raises(CodedHTTPException) as exc:
        await swaps.cancel_swap(swap["id"], CancelRequest(expected_version=1), HK2)         # the coworker declines a proposal; they do not cancel it
    assert refused(exc) == "swap_not_cancellable"
    await swaps.respond_to_swap(swap["id"], RespondSwapRequest(accept=True, expected_version=1), HK2)
    assert (await swaps.cancel_swap(swap["id"], CancelRequest(expected_version=2, reason="Changed my mind"), HK2))["data"]["status"] == "cancelled"
    for stranger in (HK3, SUP):
        with pytest.raises(CodedHTTPException):
            await swaps.cancel_swap(swap["id"], CancelRequest(expected_version=3), stranger)
    a2, b2, approved_id = await accepted_swap(db, a_day=D3, b_day=D3 + timedelta(days=1))
    await approve(approved_id)
    with pytest.raises(CodedHTTPException) as exc:
        await swaps.cancel_swap(approved_id, CancelRequest(expected_version=3), HK1)
    assert refused(exc) == "swap_not_cancellable" and owners(db, a2, b2) == [U_HK2, U_HK1]


@pytest.mark.asyncio
async def test_a_swap_is_visible_only_to_its_two_people_and_supervisors_in_scope(db):
    a, b = await pair(db)
    swap = (await propose(a, b))["data"]
    for viewer in (HK1, HK2, SUP, GM):
        assert (await swaps.get_swap(swap["id"], viewer))["data"]["id"] == swap["id"]
    for stranger in (HK3, ENG, CHIEF, OTHER_GM):
        with pytest.raises(CodedHTTPException) as exc:
            await swaps.get_swap(swap["id"], stranger)
        assert refused(exc) == "swap_not_found"
        with pytest.raises(CodedHTTPException):
            await swaps.swap_history(swap["id"], stranger)
    shaped = (await swaps.get_swap(swap["id"], HK2))["data"]
    assert "idempotency_key" not in shaped and set(shaped["requester"]) == {"id", "name", "role"}


# --- inboxes -------------------------------------------------------------------------------------------------------------------

async def inbox_list(actor, **kw):
    return await inbox.manager_requests(**{"type": "all", "status": "pending", "date_from": None, "date_to": None, "q": None, **kw}, current_user=actor)


@pytest.mark.asyncio
async def test_the_supervisor_inbox_counts_what_needs_a_decision(db):
    await pending_leave(db, U_HK1, DAY)
    await approved_leave(db, U_HK3, DAY)
    a, b = await pair(db, a_day=D2, b_day=D3)
    proposed = (await propose(a, b))["data"]
    waiting = await inbox_list(SUP)
    assert [i["type"] for i in waiting["data"]] == ["time_off"] and waiting["meta"]["counts"] == {"pending": 1, "approved": 1, "denied": 0, "all": 3}
    await swaps.respond_to_swap(proposed["id"], RespondSwapRequest(accept=True, expected_version=1), HK2)
    both = await inbox_list(SUP)
    assert {i["type"] for i in both["data"]} == {"time_off", "shift_swap"} and both["meta"]["counts"]["pending"] == 2
    swap_item = next(i for i in both["data"] if i["type"] == "shift_swap")
    assert swap_item["counterpart"]["id"] == U_HK2 and swap_item["swap"]["requester_shift"]["id"] == a and swap_item["needs_action"]
    leave_item = next(i for i in both["data"] if i["type"] == "time_off")
    assert leave_item["impact"] == {"verified": True, "shift_count": 0} and leave_item["leave"]["reason_category"] == "personal"
    only_swaps = await inbox_list(SUP, type="shift_swap", status="all")
    assert [i["type"] for i in only_swaps["data"]] == ["shift_swap"]
    approved = await inbox_list(SUP, status="approved")
    assert [i["user"]["id"] for i in approved["data"]] == [U_HK3]


@pytest.mark.asyncio
async def test_the_inbox_is_scoped_to_the_departments_a_role_covers_and_to_the_hotel(db):
    await pending_leave(db, U_HK1, DAY)
    await pending_leave(db, U_ENG, DAY)
    assert {i["user"]["id"] for i in (await inbox_list(SUP))["data"]} == {U_HK1}
    assert {i["user"]["id"] for i in (await inbox_list(ENG))["data"]} == {U_ENG}
    assert {i["user"]["id"] for i in (await inbox_list(GM))["data"]} == {U_HK1, U_ENG}
    assert (await inbox_list(OTHER_GM))["data"] == []


@pytest.mark.asyncio
async def test_inbox_filters_by_date_and_name(db):
    await pending_leave(db, U_HK1, DAY)
    await pending_leave(db, U_HK2, DAY + timedelta(days=20))
    assert [i["user"]["id"] for i in (await inbox_list(SUP, date_to=DAY + timedelta(days=5)))["data"]] == [U_HK1]
    assert [i["user"]["id"] for i in (await inbox_list(SUP, date_from=DAY + timedelta(days=10)))["data"]] == [U_HK2]
    assert [i["user"]["id"] for i in (await inbox_list(SUP, q="bea"))["data"]] == [U_HK2]
    denied = await pending_leave(db, U_HK3, DAY)
    await leave.deny_time_off(denied["id"], DecideTimeOffRequest(expected_version=1, reason="No"), SUP)
    assert [i["status"] for i in (await inbox_list(SUP, status="denied"))["data"]] == ["denied"]


@pytest.mark.asyncio
async def test_my_requests_show_only_mine_and_flag_swaps_waiting_for_my_answer(db):
    await pending_leave(db, U_HK1, DAY)
    await pending_leave(db, U_HK3, DAY)
    a, b = await pair(db, a_day=D2, b_day=D3)
    await propose(a, b)
    mine = await inbox.my_requests(HK2)
    assert [i["type"] for i in mine["data"]] == ["shift_swap"] and mine["data"][0]["needs_my_response"]
    assert mine["meta"]["counts"]["action_required"] == 1
    hk1 = await inbox.my_requests(HK1)
    assert {i["type"] for i in hk1["data"]} == {"time_off", "shift_swap"} and hk1["meta"]["counts"]["action_required"] == 0
    assert all(i["user"]["id"] == U_HK1 for i in hk1["data"] if i["type"] == "time_off")
    assert (await inbox.my_requests(ENG))["data"] == []
    mine_swaps = await swaps.my_swaps(HK2)
    assert len(mine_swaps["data"]) == 1 and mine_swaps["data"][0]["can"]["respond"]


@pytest.mark.asyncio
async def test_status_groups_cover_cancelled_declined_and_expired(db):
    made = await pending_leave(db, U_HK1, DAY)
    await leave.cancel_time_off(made["id"], CancelRequest(expected_version=1), HK1)
    a, b = await pair(db, a_day=D2, b_day=D3)
    swap = (await propose(a, b))["data"]
    await swaps.respond_to_swap(swap["id"], RespondSwapRequest(accept=False, expected_version=1), HK2)
    groups = {i["type"]: i["status_group"] for i in (await inbox.my_requests(HK1))["data"]}
    assert groups == {"time_off": "cancelled", "shift_swap": "denied"}
