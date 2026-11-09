"""Which shift occurrences the shift-summary cron may summarise (issue #204).

Pure window/eligibility maths (DST, overnight, grace, lookback vs the 8h cron
cadence) plus the tenant-scoped DB selection with multiple tenants, premature
shifts, non-working days, inactive/archived templates and unreadable tenants.
"""
from datetime import date, datetime, time, timedelta, timezone

import pytest
from dateutil import tz as dateutil_tz

from core.scheduler import CRON_SCHEDULE
from services.ai.shift_summary_due import load_due_occurrences
from services.ai.shift_summary_schedule import (
    GRACE, LOOKBACK, due_occurrences, local_to_utc, max_gap_between_runs, occurrence_window,
)
from tests.smoke.fake_supabase import FakeDB, FakeQuery

CHI = dateutil_tz.gettz("America/Chicago")
LA = dateutil_tz.gettz("America/Los_Angeles")


def utc(y, mo, d, h=0, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=timezone.utc)


def local(tz, y, mo, d, h=0, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=tz).astimezone(timezone.utc)


def _due(tz, shifts, worked, now, **kw):
    return [(o.shift_id, o.shift_date) for o in due_occurrences("t", tz, shifts, worked, now, **kw)]


MORNING = {"id": "morning", "start_time": "07:00:00", "end_time": "15:00:00"}
NIGHT = {"id": "night", "start_time": "23:00:00", "end_time": "07:00:00"}


# --- premature / grace / lookback ------------------------------------------------------------------------------------

def test_shift_still_running_is_never_summarised():
    worked = {("morning", "2026-09-29")}
    assert _due(CHI, [MORNING], worked, local(CHI, 2026, 9, 29, 14, 0)) == []
    assert _due(CHI, [MORNING], worked, local(CHI, 2026, 9, 29, 15, 0)) == []


def test_ended_shift_waits_out_the_staff_logging_grace():
    worked = {("morning", "2026-09-29")}
    assert _due(CHI, [MORNING], worked, local(CHI, 2026, 9, 29, 16, 59)) == []
    assert _due(CHI, [MORNING], worked, local(CHI, 2026, 9, 29, 17, 0)) == [("morning", "2026-09-29")]


def test_occurrence_ages_out_of_the_lookback_window():
    worked = {("morning", "2026-09-29")}
    end = local(CHI, 2026, 9, 29, 15, 0)
    assert _due(CHI, [MORNING], worked, end + LOOKBACK) == [("morning", "2026-09-29")]
    assert _due(CHI, [MORNING], worked, end + LOOKBACK + timedelta(minutes=1)) == []


def test_shift_that_did_not_run_that_day_is_never_summarised():
    """Non-working day: no published assignment and no logbook activity for that shift/date."""
    now = local(CHI, 2026, 9, 30, 20, 0)
    assert _due(CHI, [MORNING], set(), now) == []
    # worked only on a different date: the other date must not leak into this one
    assert _due(CHI, [MORNING], {("morning", "2026-09-27")}, now) == []


def test_only_the_occurrence_inside_the_window_is_selected_older_dates_are_not_revisited():
    worked = {("morning", "2026-09-29"), ("morning", "2026-09-30")}
    # 20:00 on the 30th: the 30th ended 5h ago; the 29th ended 29h ago and has aged out.
    assert _due(CHI, [MORNING], worked, local(CHI, 2026, 9, 30, 20, 0)) == [("morning", "2026-09-30")]


def test_published_assignment_that_ends_later_than_the_template_delays_the_summary():
    """An occurrence edited to run long must not be summarised on the template's end time."""
    worked = {("morning", "2026-09-29")}
    edited_end = local(CHI, 2026, 9, 29, 19, 0)
    now = local(CHI, 2026, 9, 29, 17, 30)
    assert _due(CHI, [MORNING], worked, now) == [("morning", "2026-09-29")]
    assert _due(CHI, [MORNING], worked, now, published_ends={("morning", "2026-09-29"): edited_end}) == []


# --- overnight / midnight crossing -----------------------------------------------------------------------------------

def test_overnight_shift_is_keyed_to_its_start_date_and_ends_next_local_day():
    worked = {("night", "2026-09-29")}
    assert _due(CHI, [NIGHT], worked, local(CHI, 2026, 9, 29, 23, 30)) == []      # just started
    assert _due(CHI, [NIGHT], worked, local(CHI, 2026, 9, 30, 6, 59)) == []       # still running
    assert _due(CHI, [NIGHT], worked, local(CHI, 2026, 9, 30, 8, 59)) == []       # inside grace
    assert _due(CHI, [NIGHT], worked, local(CHI, 2026, 9, 30, 9, 0)) == [("night", "2026-09-29")]


def test_overnight_shift_scheduled_for_today_is_not_due_this_morning():
    """The night shift that STARTS tonight must not be summarised just because it is 'today' and end_time looks past."""
    worked = {("night", "2026-09-30")}
    assert _due(CHI, [NIGHT], worked, local(CHI, 2026, 9, 30, 8, 0)) == []


def test_utc_date_differs_from_tenant_local_date():
    """21:00 local on the 29th is already the 30th in UTC; the tenant's local date still decides."""
    evening = {"id": "evening", "start_time": "15:00:00", "end_time": "21:00:00"}
    worked = {("evening", "2026-09-29")}
    now = utc(2026, 9, 30, 4, 0)  # 23:00 CDT on the 29th
    assert _due(CHI, [evening], worked, now) == [("evening", "2026-09-29")]
    assert _due(CHI, [evening], {("evening", "2026-09-30")}, now) == []


# --- DST ------------------------------------------------------------------------------------------------------------

def test_spring_forward_overnight_shift_is_seven_real_hours():
    start, end = occurrence_window(CHI, "23:00:00", "07:00:00", date(2026, 3, 7))
    assert start == utc(2026, 3, 8, 5, 0)   # 23:00 CST
    assert end == utc(2026, 3, 8, 12, 0)    # 07:00 CDT
    assert end - start == timedelta(hours=7)


def test_fall_back_overnight_shift_is_nine_real_hours():
    start, end = occurrence_window(CHI, "23:00:00", "07:00:00", date(2026, 10, 31))
    assert start == utc(2026, 11, 1, 4, 0)  # 23:00 CDT
    assert end == utc(2026, 11, 1, 13, 0)   # 07:00 CST
    assert end - start == timedelta(hours=9)


def test_wall_time_inside_the_spring_forward_gap_resolves_forward():
    # 02:30 never existed on 2026-03-08 in Chicago; it must land on a real instant (03:30 CDT), not crash or go backwards.
    assert local_to_utc(date(2026, 3, 8), time(2, 30), CHI, later=True) == utc(2026, 3, 8, 8, 30)


def test_ambiguous_fall_back_end_uses_the_later_pass_start_uses_the_earlier():
    d, t = date(2026, 11, 1), time(1, 30)
    assert local_to_utc(d, t, CHI, later=False) == utc(2026, 11, 1, 6, 30)  # 01:30 CDT
    assert local_to_utc(d, t, CHI, later=True) == utc(2026, 11, 1, 7, 30)   # 01:30 CST


def test_shift_ending_in_the_repeated_hour_is_not_summarised_on_the_first_pass():
    late = {"id": "late", "start_time": "18:00:00", "end_time": "01:30:00"}
    worked = {("late", "2026-10-31")}
    # first 01:30 (CDT) is 06:30Z; the shift really ends at the second 01:30 (CST) = 07:30Z; due at 09:30Z
    assert _due(CHI, [late], worked, utc(2026, 11, 1, 8, 45)) == []
    assert _due(CHI, [late], worked, utc(2026, 11, 1, 9, 30)) == [("late", "2026-10-31")]


# --- cron cadence vs lookback ---------------------------------------------------------------------------------------

def test_lookback_covers_the_cron_cadence_plus_grace():
    gap = max_gap_between_runs(CRON_SCHEDULE["logbook.shift-summary"]["hour"])
    assert gap == timedelta(hours=8)
    assert LOOKBACK >= gap + GRACE, "an occurrence could end, wait out grace and age out between two runs"


def test_every_finished_occurrence_is_seen_by_at_least_one_scheduled_run():
    """Simulate the real 07/15/23 UTC schedule: no occurrence may slip between runs, whatever minute it ends."""
    hours = [int(h) for h in str(CRON_SCHEDULE["logbook.shift-summary"]["hour"]).split(",")]
    runs = [utc(2026, 9, 25) + timedelta(days=d, hours=h) for d in range(0, 8) for h in hours]
    day = date(2026, 9, 28)
    for minute_of_day in range(10 * 60, 24 * 60, 10):  # shifts ending every 10 minutes from 10:00 to 23:50
        end = f"{minute_of_day // 60:02d}:{minute_of_day % 60:02d}:00"
        shift = {"id": "s", "start_time": "09:00:00", "end_time": end}
        worked = {("s", day.isoformat())}
        assert [r for r in runs if _due(CHI, [shift], worked, r)], f"shift ending {end} was never due at any run"


def test_max_gap_between_runs_wraps_past_midnight():
    assert max_gap_between_runs("7,15,23") == timedelta(hours=8)
    assert max_gap_between_runs("6") == timedelta(hours=24)
    assert max_gap_between_runs("1,2") == timedelta(hours=23)


# --- tenant-scoped DB selection ------------------------------------------------------------------------------------

T1, T2, T3, T_OFF = "tenant-chi", "tenant-la", "tenant-utc", "tenant-off"


def _shift(id_, tenant, start, end, **kw):
    return {"id": id_, "tenant_id": tenant, "start_time": start, "end_time": end,
            "is_active": True, "archived_at": None, **kw}


def _db(extra=None):
    rows = {
        "tenants": [
            {"id": T1, "timezone": "America/Chicago", "is_active": True},
            {"id": T2, "timezone": "America/Los_Angeles", "is_active": True},
            {"id": T3, "timezone": "UTC", "is_active": True},
            {"id": T_OFF, "timezone": "UTC", "is_active": False},
        ],
        "shifts": [
            _shift("chi-am", T1, "07:00", "15:00"),
            _shift("la-am", T2, "07:00", "15:00"),
            _shift("utc-am", T3, "07:00", "15:00"),
            _shift("off-am", T_OFF, "07:00", "15:00"),
        ],
        "shift_assignments": [],
        "logbook_entries": [],
        "shift_summaries": [],
    }
    rows.update(extra or {})
    return FakeDB(rows)


def _assign(shift, tenant, day, state="published", ends_at=None):
    return {"shift_id": shift, "tenant_id": tenant, "work_date": day, "publication_state": state, "ends_at": ends_at}


def _keys(selection):
    return sorted((o.tenant_id, o.shift_id, o.shift_date) for o in selection.due)


def test_multiple_tenants_are_judged_in_their_own_timezone():
    """Same instant, three hotels: only the ones whose 07-15 shift has really ended by their clock are due."""
    now = utc(2026, 9, 29, 22, 30)  # 17:30 CDT, 15:30 PDT, 22:30 UTC
    db = _db({"shift_assignments": [
        _assign("chi-am", T1, "2026-09-29"), _assign("la-am", T2, "2026-09-29"), _assign("utc-am", T3, "2026-09-29"),
        _assign("off-am", T_OFF, "2026-09-29"),
    ]})
    selection = load_due_occurrences(db, now)
    # LA: ended 15:00 PDT, only 30 minutes ago -> inside the 2h grace, not due. Inactive tenant: never.
    assert _keys(selection) == [(T1, "chi-am", "2026-09-29"), (T3, "utc-am", "2026-09-29")]
    assert selection.tenant_errors == []


def test_shift_that_has_not_ended_yet_is_not_selected_even_if_scheduled_today():
    db = _db({"shift_assignments": [_assign("chi-am", T1, "2026-09-29")]})
    assert _keys(load_due_occurrences(db, local(CHI, 2026, 9, 29, 11, 0))) == []


def test_non_working_day_without_assignment_or_activity_is_not_selected():
    db = _db()
    assert _keys(load_due_occurrences(db, local(CHI, 2026, 9, 29, 20, 0))) == []


def test_draft_and_cancelled_assignments_do_not_count_as_working():
    db = _db({"shift_assignments": [_assign("chi-am", T1, "2026-09-29", state="draft"),
                                    _assign("chi-am", T1, "2026-09-28", state="cancelled")]})
    assert _keys(load_due_occurrences(db, local(CHI, 2026, 9, 29, 20, 0))) == []


def test_logbook_activity_proves_the_shift_ran_even_without_a_schedule():
    db = _db({"logbook_entries": [
        {"tenant_id": T1, "shift_id": "chi-am", "entry_date": "2026-09-29", "archived_at": None},
        {"tenant_id": T1, "shift_id": "chi-am", "entry_date": "2026-09-28", "archived_at": "2026-09-28T20:00:00+00:00"},
    ]})
    assert _keys(load_due_occurrences(db, local(CHI, 2026, 9, 29, 20, 0))) == [(T1, "chi-am", "2026-09-29")]


def test_another_tenants_schedule_never_marks_this_tenants_shift_as_worked():
    db = _db({"shift_assignments": [_assign("chi-am", T2, "2026-09-29")]})  # wrong tenant for that shift
    assert _keys(load_due_occurrences(db, local(CHI, 2026, 9, 29, 20, 0))) == []


def test_archived_and_inactive_templates_are_ignored():
    db = _db({
        "shifts": [_shift("gone", T1, "07:00", "15:00", archived_at="2026-09-01T00:00:00+00:00"),
                   _shift("paused", T1, "07:00", "15:00", is_active=False)],
        "shift_assignments": [_assign("gone", T1, "2026-09-29"), _assign("paused", T1, "2026-09-29")],
    })
    assert _keys(load_due_occurrences(db, local(CHI, 2026, 9, 29, 20, 0))) == []


def test_existing_summaries_are_counted_not_regenerated():
    db = _db({"shift_assignments": [_assign("chi-am", T1, "2026-09-29")],
              "shift_summaries": [{"tenant_id": T1, "shift_id": "chi-am", "shift_date": "2026-09-29"}]})
    selection = load_due_occurrences(db, local(CHI, 2026, 9, 29, 20, 0))
    assert selection.due == [] and selection.already_present == 1


def test_overnight_shift_selected_next_morning_with_its_start_date():
    db = _db({"shifts": [_shift("chi-night", T1, "23:00", "07:00")],
              "shift_assignments": [_assign("chi-night", T1, "2026-09-29")]})
    assert _keys(load_due_occurrences(db, local(CHI, 2026, 9, 30, 8, 0))) == []
    assert _keys(load_due_occurrences(db, local(CHI, 2026, 9, 30, 9, 30))) == [(T1, "chi-night", "2026-09-29")]


def test_assignment_that_runs_past_the_template_end_defers_the_summary():
    ends = local(CHI, 2026, 9, 29, 19, 0).isoformat()
    db = _db({"shift_assignments": [_assign("chi-am", T1, "2026-09-29", ends_at=ends)]})
    assert _keys(load_due_occurrences(db, local(CHI, 2026, 9, 29, 18, 0))) == []
    assert _keys(load_due_occurrences(db, local(CHI, 2026, 9, 29, 21, 30))) == [(T1, "chi-am", "2026-09-29")]


def test_unreadable_tenant_is_skipped_and_reported_without_blocking_others():
    class FlakyDB(FakeDB):
        def table(self, name):
            q = FakeQuery(self, name)
            if name == "shift_assignments":
                orig = q.execute

                def execute():
                    if ("eq", "tenant_id", T2) in q.filters:
                        raise RuntimeError("connection reset")
                    return orig()
                q.execute = execute
            return q

    base = _db({"shift_assignments": [_assign("chi-am", T1, "2026-09-29"), _assign("la-am", T2, "2026-09-29")]})
    db = FlakyDB(base.rows)
    selection = load_due_occurrences(db, utc(2026, 9, 30, 1, 0))
    assert (T1, "chi-am", "2026-09-29") in _keys(selection)
    assert all(t != T2 for t, _s, _d in _keys(selection))
    assert len(selection.tenant_errors) == 1 and "connection reset" in selection.tenant_errors[0]


def test_global_shift_lookup_failure_propagates_so_the_cron_records_failed():
    class Boom:
        def table(self, _name):
            raise RuntimeError("supabase timeout")
    with pytest.raises(RuntimeError):
        load_due_occurrences(Boom(), utc(2026, 9, 30))
