"""Team Scheduling Phase 5: the pure availability / leave / swap rules (no database).

Pins the three promises everything else relies on: silence is UNKNOWN (never available), approved leave is a hard blocker
(pending leave only a warning), and a published shift is never edited by any of it.
"""
from datetime import date, datetime, time, timedelta, timezone

import pytest
from dateutil import tz

from services.scheduling import Occurrence
from services.scheduling_availability import (
    APPROVED_TIME_OFF,
    AVAILABILITY_UNKNOWN,
    MARKED_UNAVAILABLE,
    OUTSIDE_AVAILABILITY,
    PENDING_TIME_OFF,
    WITHIN_AVAILABILITY,
    assess_window,
    effective_swap_status,
    evaluate_availability,
    freshness,
    leave_error,
    leave_overlapping,
    leave_window,
    parse_window,
    parse_windows,
    rule_for,
    shifts_overlapping,
    swap_expiry,
    swap_problem,
    weekly_summary,
    window_error,
)
from services.scheduling_coverage import evaluate_candidate, sort_candidates

CHI = tz.gettz("America/Chicago")
MON = date(2026, 11, 2)      # a Monday after the fall-back change
TUE = date(2026, 11, 3)


def at(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=CHI).astimezone(timezone.utc)


def weekly(weekday, mode="available", windows=(("07:00", "15:00"),), start="2026-01-01", end=None, rid=None, status="active"):
    return {"id": rid or f"w{weekday}{start}", "status": status, "kind": "weekly", "weekday": weekday, "mode": mode,
            "windows": [{"start": a, "end": b} for a, b in windows], "effective_from": start, "effective_to": end}


def exception(day: date, mode="unavailable", windows=()):
    return {"id": f"x{day}", "status": "active", "kind": "exception", "exception_date": day.isoformat(), "mode": mode,
            "windows": [{"start": a, "end": b} for a, b in windows]}


def verdict(start, end, weekly_rows=(), exceptions=()):
    return evaluate_availability(start, end, list(weekly_rows), list(exceptions), CHI).status


# --- windows ----------------------------------------------------------------------------------------------------

def test_windows_parse_and_reject_garbage():
    assert parse_window({"start": "07:00", "end": "15:30"}) == (time(7, 0), time(15, 30))
    assert parse_window({"start": "25:00", "end": "15:30"}) is None
    assert parse_window({"start": "07:00"}) is None
    assert parse_windows([{"start": "07:00", "end": "11:00"}, {"start": "x", "end": "y"}, "nope"]) == [(time(7), time(11))]
    assert parse_windows("not a list") == []


def test_window_validation_codes():
    assert window_error([]) == "windows_required"
    assert window_error([(time(7), time(11)), (time(12), time(15))]) is None
    assert window_error([(time(7), time(12)), (time(11), time(15))]) == "windows_overlap"
    assert window_error([(time(7), time(8))] * 5) == "too_many_windows"
    assert window_error([(time(22), time(6)), (time(23), time(2))]) == "windows_overlap"   # both start in the evening, so they collide
    assert window_error([(time(22), time(6)), (time(5), time(9))]) is None              # the 05:00 window is the SAME day's morning, not the overnight tail
    assert window_error([(time(0), time(0))]) is None                                       # all day


# --- which rule applies ------------------------------------------------------------------------------------------

def test_an_exception_beats_the_weekly_rule_and_effective_dates_choose_the_rule():
    rows = [weekly(0), weekly(0, "unavailable", (), start="2026-11-09", rid="later")]
    assert rule_for(MON, rows, []).mode == "available"
    assert rule_for(date(2026, 11, 9), rows, []).row_id == "later"
    assert rule_for(MON, rows, [exception(MON)]).source == "exception"
    assert rule_for(MON, [weekly(0, end="2026-10-31")], []) is None          # ended before this Monday
    assert rule_for(MON, [weekly(0, status="retired")], []) is None
    assert rule_for(TUE, [weekly(0)], []) is None                            # wrong weekday


# --- the verdict -------------------------------------------------------------------------------------------------

def test_silence_is_unknown_never_available():
    assert verdict(at(MON, 7), at(MON, 15)) == "unknown"
    assert verdict(at(MON, 7), at(MON, 15), [weekly(1)]) == "unknown"        # only Tuesday submitted


def test_inside_outside_and_unavailable():
    rows = [weekly(0), weekly(1, "unavailable", ())]
    assert verdict(at(MON, 7), at(MON, 15), rows) == "available"
    assert verdict(at(MON, 8), at(MON, 12), rows) == "available"
    assert verdict(at(MON, 6), at(MON, 14), rows) == "outside"
    assert verdict(at(MON, 7), at(MON, 15, 30), rows) == "outside"
    assert verdict(at(TUE, 9), at(TUE, 10), rows) == "unavailable"


def test_two_windows_leave_a_gap_that_is_outside():
    rows = [weekly(0, windows=(("07:00", "11:00"), ("12:00", "15:00")))]
    assert verdict(at(MON, 7), at(MON, 11), rows) == "available"
    assert verdict(at(MON, 7), at(MON, 15), rows) == "outside"


def test_a_date_exception_changes_one_day_only():
    rows = [weekly(0)]
    assert verdict(at(MON, 7), at(MON, 15), rows, [exception(MON)]) == "unavailable"
    assert verdict(at(MON, 7), at(MON, 15), rows, [exception(MON, "available", (("07:00", "15:00"),))]) == "available"
    assert verdict(at(MON, 7), at(MON, 15), rows, [exception(MON, "available", (("10:00", "12:00"),))]) == "outside"
    assert verdict(at(date(2026, 11, 9), 7), at(date(2026, 11, 9), 15), rows, [exception(MON)]) == "available"    # the exception was for Nov 2 only; next Monday follows the weekly rule


def test_all_day_window_covers_anything_that_day():
    rows = [weekly(0, windows=(("00:00", "00:00"),))]
    assert verdict(at(MON, 7), at(MON, 15), rows) == "available"
    assert verdict(at(MON, 23), at(TUE, 1), rows) == "unknown"               # Tuesday has no rule; the all-day window ends at midnight


def test_an_overnight_shift_is_judged_day_by_day_and_an_overnight_window_spills_over():
    night = (at(MON, 23), at(TUE, 7))
    assert verdict(*night, [weekly(0, windows=(("22:00", "08:00"),))]) == "available"      # Monday window runs to Tuesday 08:00
    assert verdict(*night, [weekly(0, windows=(("22:00", "08:00"),)), weekly(1, "unavailable", ())]) == "unavailable"
    assert verdict(*night, [weekly(0, windows=(("22:00", "23:30"),))]) == "outside"
    assert verdict(*night, [weekly(0, windows=(("22:00", "23:59"),))]) == "outside"


def test_dst_days_are_resolved_in_hotel_time():
    spring = date(2026, 3, 8)                  # clocks jump 02:00 -> 03:00: a 00:00-08:00 shift is 7 real hours
    start, end = at(spring, 0), at(spring, 8)
    assert (end - start) == timedelta(hours=7)
    assert verdict(start, end, [weekly(spring.weekday(), windows=(("00:00", "08:00"),), start="2026-01-01")]) == "available"
    fall = date(2026, 11, 1)                   # clocks fall back: the same shift is 9 real hours
    assert (at(fall, 8) - at(fall, 0)) == timedelta(hours=9)
    assert verdict(at(fall, 0), at(fall, 8), [weekly(fall.weekday(), windows=(("00:00", "08:00"),))]) == "available"


# --- leave ---------------------------------------------------------------------------------------------------------

def leave_row(status="approved", start=MON, end=MON, partial=False, hours=None, rid="l1"):
    if partial:
        a, b = at(start, hours[0]), at(start, hours[1])
    else:
        a, b = leave_window(start, end, CHI)
    return {"id": rid, "status": status, "start_date": start.isoformat(), "end_date": end.isoformat(),
            "starts_at": a.isoformat(), "ends_at": b.isoformat()}


def test_approved_leave_blocks_pending_leave_only_warns():
    shift = (at(MON, 7), at(MON, 15))
    approved = assess_window(*shift, weekly=[weekly(0)], exceptions=[], leave=[leave_row("approved")], zone=CHI)
    assert APPROVED_TIME_OFF in approved.blockers and approved.leave[0]["id"] == "l1"
    pending = assess_window(*shift, weekly=[weekly(0)], exceptions=[], leave=[leave_row("pending")], zone=CHI)
    assert not pending.blockers and PENDING_TIME_OFF in pending.warnings
    for ignored in ("denied", "cancelled"):
        clear = assess_window(*shift, weekly=[weekly(0)], exceptions=[], leave=[leave_row(ignored)], zone=CHI)
        assert not clear.blockers and PENDING_TIME_OFF not in clear.warnings


def test_a_partial_day_only_blocks_the_hours_it_covers():
    afternoon_off = leave_row("approved", partial=True, hours=(13, 17))
    assert leave_overlapping(at(MON, 7), at(MON, 15), [afternoon_off], "approved")        # 13:00-15:00 overlaps
    assert not leave_overlapping(at(MON, 7), at(MON, 13), [afternoon_off], "approved")    # back-to-back is not an overlap


def test_assessment_reasons_warnings_and_unknown():
    shift = (at(MON, 7), at(MON, 15))
    ok = assess_window(*shift, weekly=[weekly(0)], exceptions=[], leave=[], zone=CHI)
    assert (ok.status, ok.reasons, ok.warnings, ok.blockers) == ("available", [WITHIN_AVAILABILITY], [], [])
    none = assess_window(*shift, weekly=[], exceptions=[], leave=[], zone=CHI)
    assert (none.status, none.warnings) == ("unknown", [AVAILABILITY_UNKNOWN]) and not none.reasons
    out = assess_window(*shift, weekly=[weekly(0, windows=(("09:00", "12:00"),))], exceptions=[], leave=[], zone=CHI)
    assert out.warnings == [OUTSIDE_AVAILABILITY]
    off = assess_window(*shift, weekly=[weekly(0, "unavailable", ())], exceptions=[], leave=[], zone=CHI)
    assert off.warnings == [MARKED_UNAVAILABLE]


def test_leave_windows_follow_hotel_days_including_dst():
    start, end = leave_window(date(2026, 11, 1), date(2026, 11, 1), CHI)
    assert end - start == timedelta(hours=25)          # fall back: a 25 hour day
    start, end = leave_window(date(2026, 3, 8), date(2026, 3, 8), CHI)
    assert end - start == timedelta(hours=23)          # spring forward: a 23 hour day
    start, end = leave_window(date(2026, 11, 2), date(2026, 11, 4), CHI)
    assert end - start == timedelta(hours=72)
    start, end = leave_window(MON, MON, CHI, partial=True, start_time=time(22), end_time=time(6))
    assert end - start == timedelta(hours=8)           # an overnight partial day


def test_leave_request_validation_codes():
    today = MON
    ok = dict(partial=False, start_time=None, end_time=None)
    assert leave_error(today, today, today, **ok) is None
    assert leave_error(today + timedelta(1), today, today, **ok) == "end_before_start"
    assert leave_error(today - timedelta(3), today - timedelta(1), today, **ok) == "dates_in_past"
    assert leave_error(today - timedelta(1), today, today, **ok) is None            # already started but still running
    assert leave_error(today, today + timedelta(60), today, **ok) == "range_too_long"
    assert leave_error(today, today + timedelta(59), today, **ok) is None
    assert leave_error(today, today + timedelta(1), today, partial=True, start_time=time(9), end_time=time(12)) == "partial_must_be_one_day"
    assert leave_error(today, today, today, partial=True, start_time=None, end_time=None) == "invalid_partial_times"
    assert leave_error(today, today, today, partial=True, start_time=time(9), end_time=time(9)) == "invalid_partial_times"
    assert leave_error(today, today, today, partial=False, start_time=time(9), end_time=time(12)) == "times_need_partial"


def test_shifts_overlapping_is_the_staffing_consequence():
    window = leave_window(MON, TUE, CHI)
    rows = [
        {"id": "a", "starts_at": at(MON, 7).isoformat(), "ends_at": at(MON, 15).isoformat()},
        {"id": "b", "starts_at": at(TUE, 23).isoformat(), "ends_at": at(date(2026, 11, 4), 7).isoformat()},   # straddles the end
        {"id": "c", "starts_at": at(date(2026, 11, 4), 7).isoformat(), "ends_at": at(date(2026, 11, 4), 15).isoformat()},
        {"id": "d", "starts_at": at(date(2026, 11, 1), 15).isoformat(), "ends_at": at(date(2026, 11, 2), 0).isoformat()},   # ends as leave starts
    ]
    assert [r["id"] for r in shifts_overlapping(window, rows)] == ["a", "b"]


# --- misc ------------------------------------------------------------------------------------------------------------

def test_weekly_summary_and_freshness():
    summary = weekly_summary(MON, [weekly(0), weekly(2, "unavailable", ())])
    assert [d["state"] for d in summary] == ["available", "unset", "unavailable", "unset", "unset", "unset", "unset"]
    assert summary[0]["windows"] == [{"start": "07:00", "end": "15:00"}]
    now = datetime(2026, 11, 2, tzinfo=timezone.utc)
    assert freshness(None, now) == "none"
    assert freshness(now - timedelta(days=89), now) == "current"
    assert freshness(now - timedelta(days=91), now) == "stale"


def shift_row(user, start, end, **kw):
    return {"id": kw.pop("id", f"s-{user}"), "user_id": user, "department_id": "d1", "publication_state": "published",
            "starts_at": start.isoformat(), "ends_at": end.isoformat(), "clocked_in_at": None, **kw}


def test_swap_problems_are_explicit():
    now = at(MON, 1)
    a = shift_row("u1", at(date(2026, 11, 4), 7), at(date(2026, 11, 4), 15))
    b = shift_row("u2", at(date(2026, 11, 5), 7), at(date(2026, 11, 5), 15))
    assert swap_problem(a, b, now) is None
    assert swap_problem(a, {**b, "department_id": "d2"}, now) == "different_departments"
    assert swap_problem(a, {**b, "user_id": "u1"}, now) == "same_person"
    assert swap_problem(a, {**b, "publication_state": "draft"}, now) == "shift_not_published"
    assert swap_problem(a, {**b, "clocked_in_at": "2026-11-05T13:00:00Z"}, now) == "shift_has_attendance"
    assert swap_problem(a, shift_row("u2", at(date(2026, 11, 4), 11), at(date(2026, 11, 4), 19)), now) == "shifts_overlap"
    soon = shift_row("u2", now + timedelta(minutes=30), now + timedelta(hours=8))
    assert swap_problem(a, soon, now) == "shift_too_soon"


def test_swap_expiry_and_effective_status():
    now = at(MON, 8)
    early, late = now + timedelta(hours=10), now + timedelta(days=9)
    assert swap_expiry(now, early, late) == early                       # lapses when the earlier shift starts
    assert swap_expiry(now, late) == now + timedelta(hours=72)
    swap = {"status": "proposed", "expires_at": (now - timedelta(minutes=1)).isoformat()}
    assert effective_swap_status(swap, now) == "expired"
    assert effective_swap_status({**swap, "expires_at": (now + timedelta(hours=1)).isoformat()}, now) == "proposed"
    assert effective_swap_status({**swap, "status": "accepted"}, now) == "accepted"      # only a proposal lapses


# --- the coverage candidate engine -----------------------------------------------------------------------------------

def candidate(assessment, **kw):
    start, end = at(MON, 7), at(MON, 15)
    gap = Occurrence("", "s1", MON, start, end)
    return evaluate_candidate(
        user_id="u1", roles=("housekeeper",), department_id="d1", gap_department_id="d1", required_role="housekeeper", gap=gap,
        stored=[], stored_rows=[], other_pending_offers=[], clocked_in_elsewhere=False, hotel_today=MON, assessment=assessment, **kw)


def test_candidates_use_availability_and_keep_unknown_unknown():
    shift = (at(MON, 7), at(MON, 15))
    within = candidate(assess_window(*shift, weekly=[weekly(0)], exceptions=[], leave=[], zone=CHI))
    assert within.availability == "available" and within.eligible and WITHIN_AVAILABILITY in within.reasons
    unknown = candidate(assess_window(*shift, weekly=[], exceptions=[], leave=[], zone=CHI))
    assert unknown.availability == "unknown" and AVAILABILITY_UNKNOWN in unknown.warnings and unknown.eligible
    unreadable = candidate(None)
    assert unreadable.availability == "unknown" and AVAILABILITY_UNKNOWN in unreadable.warnings
    leave = candidate(assess_window(*shift, weekly=[weekly(0)], exceptions=[], leave=[leave_row("approved")], zone=CHI))
    assert not leave.eligible and APPROVED_TIME_OFF in leave.blockers and leave.detail["leave"][0]["id"] == "l1"
    outside = candidate(assess_window(*shift, weekly=[weekly(0, windows=(("09:00", "12:00"),))], exceptions=[], leave=[], zone=CHI))
    assert outside.eligible and OUTSIDE_AVAILABILITY in outside.warnings          # advisory, not a block


def test_candidates_sort_inside_availability_first_then_unknown_then_warned_then_ineligible():
    shift = (at(MON, 7), at(MON, 15))
    def mk(uid, assessment):
        found = candidate(assessment)
        found.user_id = uid
        return found

    items = [
        mk("blocked", assess_window(*shift, weekly=[], exceptions=[], leave=[leave_row("approved")], zone=CHI)),
        mk("warned", assess_window(*shift, weekly=[weekly(0, windows=(("09:00", "12:00"),))], exceptions=[], leave=[], zone=CHI)),
        mk("unknown", assess_window(*shift, weekly=[], exceptions=[], leave=[], zone=CHI)),
        mk("within", assess_window(*shift, weekly=[weekly(0)], exceptions=[], leave=[], zone=CHI)),
    ]
    names = {"within": "Zed", "unknown": "Amy", "warned": "Bo", "blocked": "Cy"}
    assert [c.user_id for c in sort_candidates(items, names)] == ["within", "unknown", "warned", "blocked"]


@pytest.mark.parametrize("bad", [{"start": "7", "end": "15:00"}, {"start": "07:00", "end": "ab:cd"}, {}])
def test_parse_window_rejects_malformed_clock_text(bad):
    assert parse_window(bad) is None
