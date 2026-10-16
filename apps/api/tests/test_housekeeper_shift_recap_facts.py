"""Housekeeper shift recap: the server-built aggregate and the grounded model call.

Pins the Phase 6 data contract: assigned rooms are never treated as completed
work, submitted-for-inspection and inspected stay separate, blocked/pending
rooms are reported as such, recorded minutes are only used when they agree with
the session's own timestamps, and the model is never called (nor charged) when
nothing was completed. Synthetic ids and room numbers only.
"""

import json
from unittest.mock import AsyncMock
from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest
from dateutil import tz as dtz
from fastapi import HTTPException

from middleware.auth import CurrentUser
from models.requests import HousekeeperShiftRecapRequest
from routers import ai_copilot
from services.ai import housekeeper_shift_recap as recap_service
from services.ai.housekeeper_shift_recap import (
    InsufficientEvidence,
    UngroundedRecap,
    compute_shift_facts,
    generate_shift_recap,
    load_shift_facts,
    validate_grounded,
)
from tests.smoke.fake_supabase import FakeDB

CT = dtz.gettz("America/Chicago")
ME = "user-hk-1"
OTHER = "user-hk-2"
HOTEL = "hotel-a"
SHIFT_DATE = date(2026, 10, 15)


def _utc(text: str) -> datetime:
    return datetime.fromisoformat(text).astimezone(timezone.utc)


def _assign(*room_ids):
    return [{"id": f"asg-{r}", "room_id": r, "assignment_date": SHIFT_DATE.isoformat()} for r in room_ids]


def _status(**by_room):
    return {r: {"room_id": r, "status": s, "dnd_flag": False, "do_not_service": False} for r, s in by_room.items()}


def _numbers(*room_ids):
    return {r: r.replace("r", "") for r in room_ids}


def _session(room, status="completed", ended="2026-10-15T15:00:00+00:00", started="2026-10-15T14:30:00+00:00",
             seconds=1800, user=ME, blocked=None):
    return {
        "room_id": room, "housekeeper_id": user, "status": status, "blocked_reason": blocked,
        "started_at": started, "ended_at": ended, "duration_seconds": seconds,
    }


SHIFT = {"started_at": "2026-10-15T13:00:00+00:00", "ended_at": "2026-10-15T21:00:00+00:00", "status": "ended"}
NOW = _utc("2026-10-15T22:00:00+00:00")


def _facts(**overrides):
    args = dict(
        assignments=_assign("r101", "r102", "r103", "r104", "r105"),
        room_status_by_id=_status(r101="INSPECTED", r102="CLEAN", r103="CLEAN", r104="OOO", r105="DIRTY"),
        room_number_by_id=_numbers("r101", "r102", "r103", "r104", "r105"),
        sessions=[],
        shift=SHIFT,
        open_work_order_room_ids=[],
        shift_date=SHIFT_DATE,
        tz=CT,
        now=NOW,
        user_id=ME,
    )
    args.update(overrides)
    return compute_shift_facts(**args)


def test_assigned_rooms_are_not_completed_rooms():
    facts = _facts()
    rooms = facts["rooms"]
    assert rooms["assigned"] == 5
    assert rooms["completed"] == 3  # 1 inspected + 2 submitted; not 5
    assert rooms["unavailable"] == 1
    assert rooms["not_started"] == 1
    assert rooms["assigned"] != rooms["completed"]


def test_submitted_and_inspected_stay_separate():
    rooms = _facts()["rooms"]
    assert rooms["inspected"] == 1
    assert rooms["submitted"] == 2
    assert rooms["completed"] == rooms["inspected"] + rooms["submitted"]


def test_every_assigned_room_lands_in_exactly_one_bucket():
    status = _status(r101="INSPECTED", r102="CLEAN", r103="IN_PROGRESS", r104="OUT_OF_SERVICE", r105="DIRTY")
    rooms = _facts(room_status_by_id=status)["rooms"]
    total = rooms["inspected"] + rooms["submitted"] + rooms["in_progress"] + rooms["unavailable"] + rooms["not_started"] + rooms["status_unknown"]
    assert total == rooms["assigned"] == 5


def test_a_room_without_a_status_row_is_unknown_not_finished():
    status = _status(r101="CLEAN")
    rooms = _facts(room_status_by_id=status)["rooms"]
    assert rooms["status_unknown"] == 4
    assert rooms["completed"] == 1


def test_restricted_and_open_work_order_rooms_are_listed_as_handoffs():
    status = _status(r101="CLEAN", r102="DIRTY", r103="DIRTY", r104="DIRTY", r105="DIRTY")
    status["r102"]["dnd_flag"] = True
    status["r103"]["do_not_service"] = True
    facts = _facts(room_status_by_id=status, open_work_order_room_ids=["r104", "r999"])
    assert facts["rooms"]["restricted"] == 2
    assert facts["handoffs"]["restricted"] == ["102", "103"]
    # An open work order on a room that is not on this person's list is not their handoff.
    assert facts["handoffs"]["open_work_orders"] == ["104"]
    assert "102" in facts["handoffs"]["unfinished"]


def test_only_this_persons_completed_sessions_inside_the_window_count():
    sessions = [
        _session("r102"),
        _session("r103", user=OTHER),  # someone else's work
        _session("r101", ended="2026-10-15T12:00:00+00:00", started="2026-10-15T11:30:00+00:00"),  # before clock-in
        _session("r105", ended="2026-10-15T21:30:00+00:00", started="2026-10-15T21:00:00+00:00"),  # after clock-out
        _session("r104", status="abandoned", blocked="dnd"),
    ]
    facts = _facts(sessions=sessions)
    assert facts["sessions"]["completed_by_you"] == 1
    assert facts["sessions"]["stopped"] == 1
    assert facts["sessions"]["stopped_blocked"] == 1


def test_a_room_cleaned_after_being_stopped_is_not_counted_as_stopped():
    sessions = [
        _session("r102", status="abandoned", ended="2026-10-15T14:00:00+00:00", started="2026-10-15T13:40:00+00:00", blocked="guest_in_room"),
        _session("r102"),
    ]
    facts = _facts(sessions=sessions)
    assert facts["sessions"]["completed_by_you"] == 1
    assert facts["sessions"]["stopped"] == 0


def test_a_room_completed_but_no_longer_on_the_list_is_reported_separately():
    sessions = [_session("r777")]
    facts = _facts(sessions=sessions, room_number_by_id=_numbers("r101", "r102", "r103", "r104", "r105", "r777"))
    assert facts["sessions"]["completed_by_you"] == 1
    assert facts["sessions"]["completed_off_list"] == 1
    assert facts["rooms"]["assigned"] == 5


def test_shift_spanning_midnight_uses_the_recorded_shift_not_the_calendar_day():
    shift = {"started_at": "2026-10-16T03:00:00+00:00", "ended_at": "2026-10-16T11:00:00+00:00", "status": "ended"}
    # 22:00 CT on the 15th through 06:00 CT on the 16th. A session at 01:00 CT (06:00 UTC the 16th)
    # belongs to the shift of the 15th; one the next afternoon does not.
    sessions = [
        _session("r102", started="2026-10-16T05:30:00+00:00", ended="2026-10-16T06:00:00+00:00"),
        _session("r103", started="2026-10-16T20:00:00+00:00", ended="2026-10-16T20:30:00+00:00"),
    ]
    facts = _facts(shift=shift, sessions=sessions, now=_utc("2026-10-16T12:00:00+00:00"))
    assert facts["window"]["basis"] == "shift"
    assert facts["window"]["shift_ended"] is True
    assert facts["sessions"]["completed_by_you"] == 1


def test_without_a_shift_record_the_hotel_local_day_is_used_and_says_so():
    late = _session("r102", started="2026-10-16T04:00:00+00:00", ended="2026-10-16T04:30:00+00:00")  # 23:30 CT on the 15th
    next_day = _session("r103", started="2026-10-16T06:00:00+00:00", ended="2026-10-16T06:30:00+00:00")  # 01:30 CT on the 16th
    facts = _facts(shift=None, sessions=[late, next_day])
    assert facts["window"]["basis"] == "day"
    assert facts["sessions"]["completed_by_you"] == 1


def test_recorded_minutes_come_only_from_sessions_whose_timestamps_agree():
    good = _session("r102", started="2026-10-15T14:00:00+00:00", ended="2026-10-15T14:30:00+00:00", seconds=1800)
    wrong = _session("r103", started="2026-10-15T14:40:00+00:00", ended="2026-10-15T15:00:00+00:00", seconds=7000)
    huge = _session("r101", started="2026-10-15T13:10:00+00:00", ended="2026-10-15T20:10:00+00:00", seconds=7 * 3600)
    missing = _session("r105", seconds=None)
    facts = _facts(sessions=[good, wrong, huge, missing])
    assert facts["timing"] == {"timed_rooms": 1, "recorded_minutes": 30}
    assert facts["sessions"]["completed_by_you"] == 4  # untimed rooms are still completed


def test_estimated_clean_time_is_never_used_as_actual_time():
    session = _session("r102", seconds=None)
    session["base_clean_minutes"] = 45
    facts = _facts(sessions=[session])
    assert facts["timing"]["recorded_minutes"] is None
    assert "45" not in json.dumps(facts)


def test_no_completed_work_means_no_evidence():
    facts = _facts(room_status_by_id=_status(r101="DIRTY", r102="DIRTY", r103="DIRTY", r104="OOO", r105="DIRTY"))
    assert facts["evidence"] == "none"
    assert facts["rooms"]["completed"] == 0


def test_an_employee_without_assignments_but_with_a_completed_session_has_evidence():
    facts = _facts(assignments=[], room_status_by_id={}, sessions=[_session("r102")], room_number_by_id=_numbers("r102"))
    assert facts["evidence"] == "sufficient"
    assert facts["rooms"]["assigned"] == 0


def test_fingerprint_changes_when_the_shift_changes_materially():
    first = _facts()
    second = _facts(room_status_by_id=_status(r101="INSPECTED", r102="CLEAN", r103="CLEAN", r104="OOO", r105="CLEAN"))
    assert first["fingerprint"] != second["fingerprint"]
    assert first["fingerprint"] == _facts()["fingerprint"]


def test_long_room_lists_are_capped_without_changing_the_counts():
    ids = [f"r{200 + n}" for n in range(30)]
    facts = _facts(
        assignments=_assign(*ids),
        room_status_by_id=_status(**{r: "DIRTY" for r in ids}),
        room_number_by_id=_numbers(*ids),
    )
    assert facts["rooms"]["assigned"] == 30
    assert facts["rooms"]["not_started"] == 30
    assert len(facts["handoffs"]["unfinished"]) == recap_service.MAX_LISTED_ROOMS


# ─── grounding ──────────────────────────────────────────────────────────────

def test_grounded_text_passes_and_invented_numbers_fail():
    facts = _facts()
    validate_grounded({"headline": "3 rooms were submitted or inspected and 1 room is still open.", "note": ""}, facts)
    with pytest.raises(UngroundedRecap):
        validate_grounded({"headline": "You finished 9 rooms today.", "note": ""}, facts)


def test_performance_and_time_saving_claims_are_rejected():
    facts = _facts()
    for headline in ("You worked faster than usual.", "A productive shift with 3 rooms.", "You saved time on 3 rooms."):
        with pytest.raises(UngroundedRecap):
            validate_grounded({"headline": headline, "note": ""}, facts)


def _fake_client(text, calls):
    def create(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(content=[SimpleNamespace(text=text)], usage=SimpleNamespace(input_tokens=120, output_tokens=40))

    return SimpleNamespace(messages=SimpleNamespace(create=create))


def test_the_model_is_not_called_without_completed_work(monkeypatch):
    calls = []
    monkeypatch.setattr(recap_service, "get_anthropic_client", lambda: _fake_client("{}", calls))
    with pytest.raises(InsufficientEvidence):
        generate_shift_recap(_facts(room_status_by_id=_status(r101="DIRTY", r102="DIRTY", r103="DIRTY", r104="OOO", r105="DIRTY")), "en")
    assert calls == []


def test_the_prompt_carries_the_aggregate_and_no_raw_room_list(monkeypatch):
    calls = []
    text = json.dumps({"headline": "3 of 5 assigned rooms are submitted or inspected.", "note": "1 room remains."})
    monkeypatch.setattr(recap_service, "get_anthropic_client", lambda: _fake_client(text, calls))
    facts = _facts(sessions=[_session("r102")])
    result = generate_shift_recap(facts, "en")
    assert result["recap"]["headline"].startswith("3 of 5")
    sent = calls[0]["messages"][0]["content"]
    assert '"assigned": 5' in sent and '"completed": 3' in sent
    assert "fingerprint" not in sent
    assert "already complete" not in calls[0]["system"].lower()


def test_ungrounded_model_output_is_an_error_not_a_recap(monkeypatch):
    text = json.dumps({"headline": "You cleaned 42 rooms.", "note": ""})
    monkeypatch.setattr(recap_service, "get_anthropic_client", lambda: _fake_client(text, []))
    with pytest.raises(UngroundedRecap):
        generate_shift_recap(_facts(sessions=[_session("r102")]), "en")


# ─── loader against the shared fake database ────────────────────────────────

def _db():
    return FakeDB(
        rows={
            "tenants": [{"id": HOTEL, "timezone": "America/Chicago"}],
            "hk_shift_sessions": [
                {"id": "s1", "tenant_id": HOTEL, "user_id": ME, "started_at": "2026-10-15T13:00:00+00:00",
                 "ended_at": "2026-10-15T21:00:00+00:00", "status": "ended", "break_seconds": 0},
                {"id": "s2", "tenant_id": "hotel-b", "user_id": ME, "started_at": "2026-10-15T13:00:00+00:00",
                 "ended_at": "2026-10-15T21:00:00+00:00", "status": "ended", "break_seconds": 0},
            ],
            "room_assignments": [
                {"id": "a1", "tenant_id": HOTEL, "room_id": "r101", "assigned_to": ME, "assignment_date": "2026-10-15"},
                {"id": "a2", "tenant_id": HOTEL, "room_id": "r102", "assigned_to": ME, "assignment_date": "2026-10-15"},
                {"id": "a3", "tenant_id": HOTEL, "room_id": "r103", "assigned_to": OTHER, "assignment_date": "2026-10-15"},
                {"id": "a4", "tenant_id": "hotel-b", "room_id": "r104", "assigned_to": ME, "assignment_date": "2026-10-15"},
            ],
            "room_status": [
                {"tenant_id": HOTEL, "room_id": "r101", "status": "CLEAN"},
                {"tenant_id": HOTEL, "room_id": "r102", "status": "DIRTY"},
            ],
            "rooms": [{"tenant_id": HOTEL, "id": "r101", "room_number": "101"}, {"tenant_id": HOTEL, "id": "r102", "room_number": "102"}],
            "room_clean_sessions": [
                {"tenant_id": HOTEL, "room_id": "r101", "housekeeper_id": ME, "status": "completed", "blocked_reason": None,
                 "started_at": "2026-10-15T14:00:00+00:00", "ended_at": "2026-10-15T14:30:00+00:00", "duration_seconds": 1800},
            ],
            "work_orders": [{"tenant_id": HOTEL, "room_id": "r102", "status": "open"}],
        }
    )


def test_loader_reads_only_this_person_in_this_hotel():
    facts = load_shift_facts(_db(), hotel_id=HOTEL, user_id=ME, shift_date=SHIFT_DATE, now=NOW)
    assert facts["rooms"]["assigned"] == 2  # not the other hotel's room, not the other person's
    assert facts["rooms"]["submitted"] == 1
    assert facts["rooms"]["not_started"] == 1
    assert facts["sessions"]["completed_by_you"] == 1
    assert facts["window"]["basis"] == "shift"
    assert facts["handoffs"]["open_work_orders"] == ["102"]
    assert facts["evidence"] == "sufficient"


# ─── endpoint ────────────────────────────────────────────────────────────────

USER = CurrentUser(user_id=ME, hotel_id=HOTEL, role="housekeeper", email="hk@example.com")


@pytest.fixture
def endpoint(monkeypatch):
    ai_copilot._recap_cache.clear()
    state = SimpleNamespace(model_calls=[], charges=[], logs=[], facts=None)
    text = json.dumps({"headline": "3 of 5 assigned rooms are submitted or inspected.", "note": ""})
    monkeypatch.setattr(recap_service, "get_anthropic_client", lambda: _fake_client(text, state.model_calls))

    async def charge(hotel_id, kind, prompt_tokens, completion_tokens):
        state.charges.append((hotel_id, kind, prompt_tokens, completion_tokens))
        return 1.5

    async def log(**kwargs):
        state.logs.append(kwargs)

    monkeypatch.setattr(ai_copilot, "assert_ai_allowance", AsyncMock())  # pre-flight; the post-call charge is what these tests drive

    monkeypatch.setattr(ai_copilot, "check_and_deduct_credits", charge)
    monkeypatch.setattr(ai_copilot, "log_ai_interaction", log)
    state.facts = _facts(sessions=[_session("r102")])
    monkeypatch.setattr(ai_copilot, "load_shift_facts", lambda *a, **k: state.facts)
    return state


async def _call(language="en"):
    return await ai_copilot.housekeeping_shift_recap(HousekeeperShiftRecapRequest(language=language), USER)


@pytest.mark.asyncio
async def test_endpoint_returns_wording_with_the_verified_facts(endpoint):
    body = (await _call())["data"]
    assert body["headline"].startswith("3 of 5")
    assert body["facts"]["rooms"]["completed"] == 3
    assert body["cached"] is False
    assert endpoint.charges == [(HOTEL, "housekeeper_shift_recap", 120, 40)]


@pytest.mark.asyncio
async def test_unchanged_facts_are_not_paid_for_twice(endpoint):
    await _call()
    again = (await _call())["data"]
    assert again["cached"] is True and again["credits_used"] == 0
    assert len(endpoint.model_calls) == 1 and len(endpoint.charges) == 1


@pytest.mark.asyncio
async def test_changed_facts_buy_a_new_recap(endpoint):
    await _call()
    endpoint.facts = _facts(sessions=[_session("r102")], room_status_by_id=_status(r101="INSPECTED", r102="CLEAN", r103="CLEAN", r104="OOO", r105="CLEAN"))
    await _call()
    assert len(endpoint.model_calls) == 2


@pytest.mark.asyncio
async def test_no_completed_work_is_409_with_no_model_call_and_no_charge(endpoint):
    endpoint.facts = _facts(room_status_by_id=_status(r101="DIRTY", r102="DIRTY", r103="DIRTY", r104="OOO", r105="DIRTY"))
    with pytest.raises(HTTPException) as err:
        await _call()
    assert err.value.status_code == 409
    assert endpoint.model_calls == [] and endpoint.charges == []


@pytest.mark.asyncio
async def test_ungrounded_output_is_503_and_not_charged(endpoint, monkeypatch):
    bad = json.dumps({"headline": "You cleaned 42 rooms.", "note": ""})
    monkeypatch.setattr(recap_service, "get_anthropic_client", lambda: _fake_client(bad, []))
    with pytest.raises(HTTPException) as err:
        await _call()
    assert err.value.status_code == 503
    assert endpoint.charges == []
    assert endpoint.logs[-1]["success"] is False


@pytest.mark.asyncio
async def test_credit_cap_surfaces_as_402_and_nothing_is_cached(endpoint, monkeypatch):
    async def capped(*args, **kwargs):
        raise HTTPException(status_code=402, detail="Monthly AI credit cap reached.")

    monkeypatch.setattr(ai_copilot, "assert_ai_allowance", AsyncMock())  # pre-flight; the post-call charge is what these tests drive

    monkeypatch.setattr(ai_copilot, "check_and_deduct_credits", capped)
    with pytest.raises(HTTPException) as err:
        await _call()
    assert err.value.status_code == 402
    assert ai_copilot._recap_cache == {}


def test_a_legacy_rooms_list_from_an_older_app_is_ignored():
    request = HousekeeperShiftRecapRequest.model_validate({"language": "es", "rooms": [{"room_number": "101", "status": "DIRTY"}]})
    assert request.language == "es"
    assert not hasattr(request, "rooms")
