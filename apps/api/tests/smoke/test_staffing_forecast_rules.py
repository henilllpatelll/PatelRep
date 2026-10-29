"""Staffing forecast rules (pure): housekeeping demand, scheduled capacity and the coverage comparison."""
from datetime import date, datetime, time, timedelta, timezone

from dateutil import tz

from services.scheduling import QuantityFact, resolve_occurrence
from services.staffing_capacity import (
    ATTENDANT, OTHER_DEPARTMENT, OTHER_HK, UNKNOWN_DEPARTMENT, additional_shifts, classify_person, compute_capacity,
    merge_intervals, subtract,
)
from services.staffing_demand import board_work, category_of, estimate_minutes, resolve_clean_type, summarize
from services.staffing_forecast import ForecastData, _compare, _Demand, forecast_day

UTC = timezone.utc
CHICAGO = tz.gettz("America/Chicago")
DAY = date(2030, 1, 8)
NOW = datetime(2030, 1, 8, 15, 0, tzinfo=UTC)         # 09:00 in Chicago
START, END = datetime(2030, 1, 8, 13, 0, tzinfo=UTC), datetime(2030, 1, 8, 21, 0, tzinfo=UTC)   # the 07:00-15:00 shift


# --- demand ----------------------------------------------------------------------------------------------------------

def room(room_id, status="DIRTY", clean_type="DEP", base=30, code="K", **extra):
    return {"room_id": room_id, "status": status, "clean_type": clean_type, "fo_status": None, "base_clean_minutes": base,
            "room_type_code": code, "is_active": True, "do_not_service": False, "assigned_to": None, "actual_checkout_at": None, **extra}


def test_departure_and_stayover_rooms_are_sized_from_the_room_type_and_categorised():
    work, declined = board_work([room("a", "DIRTY", "DEP", 30), room("b", "PICKUP", "LIGHT", 20), room("c", "OCCUPIED", "FULL", 25)], {}, None)
    assert [(w.room_id, w.category, w.minutes, w.basis) for w in work] == [
        ("a", "departure", 30, "room_type"), ("b", "stayover", 20, "room_type"), ("c", "stayover", 25, "room_type")]
    assert declined == 0 and summarize(work)["minutes"] == 75


def test_a_learned_figure_wins_except_for_a_stayover_pickup():
    def learned(code, clean):
        return {("K", "DEP"): 41.0, ("K", "LIGHT"): 12.0}.get((code, clean))

    work, _ = board_work([room("a", "DIRTY", "DEP", 30), room("b", "PICKUP", "LIGHT", 20)], {}, learned)
    assert [(w.minutes, w.basis) for w in work] == [(41, "history"), (20, "room_type")]


def test_a_room_with_no_configured_minutes_is_unestimated_never_padded_with_a_default():
    work, _ = board_work([room("a", base=None), room("b", base=0), room("c", base=30)], {}, None)
    assert [w.minutes for w in work] == [None, None, 30]
    summary = summarize(work)
    assert (summary["minutes"], summary["unestimated_rooms"]) == (30, 2)


def test_only_remaining_work_counts_and_unknown_or_unavailable_statuses_are_ignored():
    rows = [room("a", "IN_PROGRESS"), room("b", "CLEAN"), room("c", "INSPECTED"), room("d", "OOO"), room("e", "OUT_OF_SERVICE"),
            room("f", "SOMETHING_NEW"), room("g", "DIRTY", is_active=False)]
    work, _ = board_work(rows, {}, None)
    assert [w.room_id for w in work] == ["a"]


def test_a_room_is_counted_once_even_if_the_board_repeats_it():
    work, _ = board_work([room("a"), room("a", "PICKUP", "LIGHT")], {}, None)
    assert len(work) == 1


def test_a_guest_who_declined_service_is_known_zero_work_and_reported():
    work, declined = board_work([room("a", do_not_service=True), room("b")], {}, None)
    assert [w.room_id for w in work] == ["b"] and declined == 1


def test_clean_type_precedence_matches_the_room_board():
    status = {"clean_type": "DEP", "actual_checkout_at": None}
    assert resolve_clean_type(status, {"clean_type": "LIGHT"}) == "LIGHT"                          # dated assignment wins
    assert resolve_clean_type({**status, "actual_checkout_at": "2030-01-08T10:00:00Z"}, {"clean_type": "LIGHT"}) == "DEP"   # checkout wins
    assert resolve_clean_type({"clean_type": "NONSENSE"}, None) is None                             # unknown stays unknown
    assert category_of(None, "DIRTY") == "vacant_dirty" and category_of(None, "IN_PROGRESS") == "other"
    assert estimate_minutes(30, "K", None, "DIRTY", None) == (30, "room_type")


# --- capacity --------------------------------------------------------------------------------------------------------

def shift(i, user, starts=START, ends=END, state="published", shift_id="s-morn", **extra):
    return {"id": f"as-{i}", "user_id": user, "shift_id": shift_id, "shift_name": "Morning", "start_time": "07:00:00", "end_time": "15:00:00",
            "starts_at": starts.isoformat(), "ends_at": ends.isoformat(), "publication_state": state, "version": 1, "work_date": "2030-01-08", **extra}


KINDS = {"hk1": ATTENDANT, "hk2": ATTENDANT, "hk3": ATTENDANT, "sup": OTHER_HK, "eng": OTHER_DEPARTMENT, "ghost": UNKNOWN_DEPARTMENT}


def capacity(rows, today=False, **kw):
    return compute_capacity(rows, person_kind=lambda u: KINDS.get(u, UNKNOWN_DEPARTMENT), now=NOW, is_today=today, **kw)


def test_capacity_is_elapsed_minutes_of_published_attendant_shifts():
    result = capacity([shift(1, "hk1"), shift(2, "hk2")])
    assert (result.scheduled_minutes, len(result.attendant_ids)) == (960, 2)
    assert result.shifts[0]["people"] == 2 and result.shifts[0]["productive_minutes"] == 960


def test_drafts_cancelled_supervisors_and_other_departments_are_not_attendant_capacity():
    result = capacity([shift(1, "hk1"), shift(2, "hk2", state="draft"), shift(3, "hk3", state="cancelled"),
                       shift(4, "sup"), shift(5, "eng"), shift(6, "ghost")])
    assert result.scheduled_minutes == 480
    assert (result.draft_shifts, result.other_hk_people, result.unknown_department_shifts) == (1, 1, 1)


def test_overnight_and_dst_shifts_use_real_elapsed_time():
    spring_start, spring_end = resolve_occurrence(date(2030, 3, 9), time(23, 0), time(7, 0), CHICAGO)   # 02:00 does not exist
    fall_start, fall_end = resolve_occurrence(date(2030, 11, 2), time(23, 0), time(7, 0), CHICAGO)       # 01:00 happens twice
    assert capacity([shift(1, "hk1", spring_start, spring_end)]).scheduled_minutes == 7 * 60
    assert capacity([shift(1, "hk1", fall_start, fall_end)]).scheduled_minutes == 9 * 60


def test_overlapping_segments_of_one_person_are_never_counted_twice():
    result = capacity([shift(1, "hk1"), shift(2, "hk1", START + timedelta(hours=4), END + timedelta(hours=2), shift_id="s-2")])
    assert result.scheduled_minutes == 10 * 60
    assert list(merge_intervals([(START, END), (START + timedelta(hours=1), END - timedelta(hours=1))])) == [(START, END)]


def test_known_breaks_are_deducted_and_unknown_breaks_are_not_invented():
    assert capacity([shift(1, "hk1")]).scheduled_minutes == 480
    assert capacity([shift(1, "hk1")], break_minutes=30).scheduled_minutes == 450
    assert capacity([shift(1, "hk1", END - timedelta(minutes=20), END)], break_minutes=30).scheduled_minutes == 0   # never negative


def test_a_confirmed_callout_removes_the_shift_and_its_replacement_counts_once():
    absence = {"assignment_id": "as-1", "status": "covered", "kind": "called_out"}
    rows = [shift(1, "hk1"), shift(2, "hk2", shift_id="s-replacement")]
    result = capacity(rows, absences=[absence], filled_assignment_ids=["as-2"])
    assert (result.scheduled_minutes, result.confirmed_callouts, result.replacements) == (480, 1, 1)


def test_an_unconfirmed_callout_still_counts_but_is_surfaced_and_a_withdrawn_one_is_ignored():
    reported = capacity([shift(1, "hk1")], absences=[{"assignment_id": "as-1", "status": "reported", "kind": "called_out"}])
    withdrawn = capacity([shift(1, "hk1")], absences=[{"assignment_id": "as-1", "status": "withdrawn", "kind": "called_out"}])
    assert (reported.scheduled_minutes, reported.pending_callouts) == (480, 1)
    assert (withdrawn.scheduled_minutes, withdrawn.pending_callouts, withdrawn.confirmed_callouts) == (480, 0, 0)


def test_leaving_early_shortens_the_shift():
    leaving = {"assignment_id": "as-1", "status": "confirmed", "kind": "leaving_early", "leaving_at": (START + timedelta(hours=3)).isoformat()}
    assert capacity([shift(1, "hk1")], absences=[leaving]).scheduled_minutes == 180


def test_approved_leave_removes_only_the_overlap_and_pending_leave_removes_nothing():
    half = {"user_id": "hk1", "status": "approved", "starts_at": (START + timedelta(hours=4)).isoformat(), "ends_at": (END + timedelta(days=1)).isoformat()}
    pending = {"user_id": "hk2", "status": "pending", "starts_at": START.isoformat(), "ends_at": END.isoformat()}
    result = capacity([shift(1, "hk1"), shift(2, "hk2")], leaves=[half, pending])
    assert result.scheduled_minutes == 240 + 480
    assert (result.leave_reduced_shifts, result.pending_leave_shifts) == (1, 1)


def test_today_counts_only_the_time_still_ahead():
    result = capacity([shift(1, "hk1")], today=True)      # now = 15:00Z, shift ends 21:00Z
    assert (result.scheduled_minutes, result.remaining_minutes) == (480, 360)
    assert capacity([shift(1, "hk1")], today=False).remaining_minutes is None


def test_person_classification_never_treats_other_roles_as_room_attendants():
    assert classify_person("HK", ["housekeeper"]) == ATTENDANT
    assert classify_person("HK", ["housekeeping_supervisor"]) == OTHER_HK
    assert classify_person("ENG", ["housekeeper"]) == OTHER_DEPARTMENT
    assert classify_person(None, ["housekeeper"]) == UNKNOWN_DEPARTMENT


def test_interval_subtraction_and_headcount_estimates_need_a_real_shift_length():
    assert subtract((START, END), [(START + timedelta(hours=2), START + timedelta(hours=3))]) == [
        (START, START + timedelta(hours=2)), (START + timedelta(hours=3), END)]
    assert additional_shifts(100, 480) == 1 and additional_shifts(500, 480) == 2
    assert additional_shifts(100, None) is None and additional_shifts(0, 480) is None


# --- comparison ------------------------------------------------------------------------------------------------------

def demand(value, complete=True, incomplete=()):
    return _Demand(QuantityFact(float(value), "estimate", "x"), complete, "x", incomplete=list(incomplete))


CAP = QuantityFact(300.0, "estimate", "scheduled_shifts")


def test_complete_demand_gives_sufficient_or_short():
    assert _compare(CAP, demand(200))[0].status == "sufficient"
    short = _compare(CAP, demand(450))[0]
    assert (short.status, short.gap_minutes) == ("short", -150.0)


def test_incomplete_demand_is_a_lower_bound_so_it_can_prove_short_but_never_sufficient():
    comparison, minimum = _compare(CAP, demand(450, False, ["unestimated_rooms"]))
    assert (comparison.status, minimum) == ("short", True)
    comparison, minimum = _compare(CAP, demand(100, False, ["unestimated_rooms"]))
    assert (comparison.status, minimum, comparison.gap_minutes) == ("unknown", False, None)


def test_missing_demand_or_capacity_is_unknown_not_zero():
    gone = QuantityFact(None, "unavailable", "x", "pms_not_connected")
    assert _compare(CAP, _Demand(gone, False, "unavailable", incomplete=["pms_not_connected"]))[0].status == "unknown"
    assert _compare(QuantityFact(None, "unavailable", "scheduled_shifts", "leave_unreadable"), demand(10))[0].status == "unknown"


# --- one day, end to end (pure) --------------------------------------------------------------------------------------

def data(**kw):
    base = dict(now=NOW, today=DAY, assignments=[], person_kind=lambda u: KINDS.get(u, UNKNOWN_DEPARTMENT), absences=[], leaves=[],
                gaps=[], board=[], learned_available=True)
    base.update(kw)
    return ForecastData(**base)


def test_today_is_sufficient_short_or_unknown_from_the_inputs():
    plenty = forecast_day(DAY, data(assignments=[shift(1, "hk1")], board=[room("a"), room("b")]))
    assert (plenty["status"], plenty["headline"]["code"]) == ("sufficient", "sufficient")
    assert plenty["capacity"]["productive_minutes"]["value"] == 360.0 and plenty["demand"]["minutes"]["value"] == 60.0

    rooms = [room(str(i), base=60) for i in range(8)]
    short = forecast_day(DAY, data(assignments=[shift(1, "hk1")], board=rooms))
    assert (short["status"], short["headline"]["gap_minutes"], short["gap"]["additional_shifts"]["value"]) == ("short", 120, 1)

    unreadable = forecast_day(DAY, data(assignments=[shift(1, "hk1")], board=None))
    assert (unreadable["status"], unreadable["forecast_quality"], unreadable["demand"]["minutes"]["value"]) == ("unknown", "unavailable", None)


def test_a_future_day_without_a_demand_feed_is_unknown_and_never_sufficient():
    tomorrow = DAY + timedelta(days=1)
    result = forecast_day(tomorrow, data(assignments=[{**shift(1, "hk1"), "work_date": tomorrow.isoformat()}], pms_connected=False))
    assert result["status"] == "unknown" and result["headline"]["reason"] == "pms_not_connected"
    assert result["demand"]["minutes"]["quality"] == "unavailable" and result["capacity"]["productive_minutes"]["value"] == 480.0
    assert result["time_window"] == {"available": False, "reason": "no_service_window_data"}


def test_unreadable_absences_or_leave_make_capacity_unavailable_rather_than_assumed():
    assert forecast_day(DAY, data(assignments=[shift(1, "hk1")], absences=None))["capacity"]["productive_minutes"]["reason"] == "absences_unreadable"
    assert forecast_day(DAY, data(assignments=[shift(1, "hk1")], leaves=None))["status"] == "unknown"
