"""Pure scheduling rules: time resolution, conflicts, warnings, attendance status, capacity and workflow contracts."""
import ast
import re
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import pytest
from dateutil import tz

from services import scheduling as s
from services.scheduling_contracts import MANAGER_DEPARTMENT_CODES, WORKFLOWS

CHICAGO = tz.gettz("America/Chicago")
API_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = API_ROOT.parent.parent


def utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


def occ(user="u1", shift="s1", day=date(2030, 1, 7), start=time(7), end=time(15), id=None, zone=CHICAGO):
    starts, ends = s.resolve_occurrence(day, start, end, zone)
    return s.Occurrence(user, shift, day, starts, ends, id)


# --- time ------------------------------------------------------------------------------------------------

def test_parse_clock_accepts_minutes_and_seconds_and_rejects_garbage():
    assert s.parse_clock("07:00") == time(7, 0)
    assert s.parse_clock("07:00:00") == time(7, 0)
    assert s.parse_clock("23:59") == time(23, 59)
    for bad in ("24:00", "7", "07:60", "", "ab:cd", None, 700, "07:00:61"):
        assert s.parse_clock(bad) is None


def test_day_shift_resolves_in_hotel_local_time():
    starts, ends = s.resolve_occurrence(date(2030, 1, 7), time(7), time(15), CHICAGO)  # CST = UTC-6
    assert (starts, ends) == (utc(2030, 1, 7, 13), utc(2030, 1, 7, 21))


def test_overnight_shift_ends_next_calendar_day():
    starts, ends = s.resolve_occurrence(date(2030, 1, 7), time(23), time(7), CHICAGO)
    assert (starts, ends) == (utc(2030, 1, 8, 5), utc(2030, 1, 8, 13))


def test_spring_forward_shortens_the_overnight_shift_by_an_hour():
    # 2026-03-08 02:00 CST -> 03:00 CDT. 22:00 Mar 7 .. 06:00 Mar 8 is 7 real hours.
    starts, ends = s.resolve_occurrence(date(2026, 3, 7), time(22), time(6), CHICAGO)
    assert ends - starts == timedelta(hours=7)


def test_fall_back_lengthens_the_overnight_shift_by_an_hour():
    # 2026-11-01 02:00 CDT -> 01:00 CST. 22:00 Oct 31 .. 06:00 Nov 1 is 9 real hours.
    starts, ends = s.resolve_occurrence(date(2026, 10, 31), time(22), time(6), CHICAGO)
    assert ends - starts == timedelta(hours=9)


def test_nonexistent_local_time_uses_the_pre_transition_offset_like_postgres():
    starts, _ = s.resolve_occurrence(date(2026, 3, 8), time(2, 30), time(10), CHICAGO)
    assert starts == utc(2026, 3, 8, 8, 30)  # 02:30 CST == 03:30 CDT


def test_ambiguous_local_time_uses_standard_time_like_postgres():
    starts, _ = s.resolve_occurrence(date(2026, 11, 1), time(1, 30), time(9), CHICAGO)
    assert starts == utc(2026, 11, 1, 7, 30)  # the later (CST) 01:30


# --- conflicts -------------------------------------------------------------------------------------------

def test_back_to_back_shifts_do_not_overlap():
    assert not s.overlaps(occ(start=time(7), end=time(15)), occ(shift="s2", start=time(15), end=time(23)))


def test_two_non_overlapping_shifts_on_one_date_are_allowed():
    morning, evening = occ(start=time(6), end=time(10)), occ(shift="s2", start=time(16), end=time(20))
    assert s.find_conflicts([evening], [morning]) == []


def test_overlapping_shift_is_a_conflict_with_the_stored_row_id():
    stored = occ(id="a1")
    [conflict] = s.find_conflicts([occ(shift="s2", start=time(14), end=time(22))], [stored])
    assert (conflict.code, conflict.with_assignment_id) == ("overlapping_shift", "a1")


def test_overnight_shift_conflicts_with_next_morning_shift():
    night = occ(day=date(2030, 1, 7), start=time(23), end=time(7))
    next_morning = occ(shift="s2", day=date(2030, 1, 8), start=time(6), end=time(14))
    assert [c.code for c in s.find_conflicts([next_morning], [night])] == ["overlapping_shift"]


def test_duplicate_inside_one_request_is_flagged_and_other_people_are_ignored():
    a, dup, other = occ(), occ(), occ(user="u2")
    assert [c.code for c in s.find_conflicts([a, dup, other], [])] == ["duplicate_assignment"]


# --- warnings --------------------------------------------------------------------------------------------

def codes(warnings):
    return sorted(w.code for w in warnings)


def test_short_rest_between_shifts_warns_but_enough_rest_does_not():
    today = date(2030, 1, 1)
    late = occ(day=date(2030, 1, 7), start=time(15), end=time(23))
    soon = occ(shift="s2", day=date(2030, 1, 8), start=time(5), end=time(13))
    fine = occ(shift="s3", day=date(2030, 1, 8), start=time(9), end=time(17))
    assert "insufficient_rest" in codes(s.compute_warnings([soon], [late], hotel_today=today))
    assert "insufficient_rest" not in codes(s.compute_warnings([fine], [late], hotel_today=today))


def test_weekly_overtime_counts_the_whole_monday_to_sunday_week():
    week = [occ(shift=f"s{i}", day=date(2030, 1, 7) + timedelta(days=i)) for i in range(5)]  # 5 x 8h = 40h
    extra = occ(shift="sx", day=date(2030, 1, 12), start=time(7), end=time(11))
    assert "weekly_overtime" not in codes(s.compute_warnings([week[0]], week[1:], hotel_today=date(2030, 1, 1)))
    assert "weekly_overtime" in codes(s.compute_warnings([extra], week, hotel_today=date(2030, 1, 1)))


def test_long_shift_and_past_date_warnings():
    long_shift = occ(start=time(6), end=time(20))
    assert codes(s.compute_warnings([long_shift], [], hotel_today=date(2030, 1, 1))) == ["long_shift"]
    assert codes(s.compute_warnings([occ()], [], hotel_today=date(2030, 2, 1))) == ["past_date"]


def test_policy_can_silence_or_block_a_rule_and_hard_conflicts_are_not_a_policy():
    long_shift = occ(start=time(6), end=time(20))
    off = s.compute_warnings([long_shift], [], hotel_today=date(2030, 1, 1), policy={"long_shift": "off"})
    block = s.compute_warnings([long_shift], [], hotel_today=date(2030, 1, 1), policy={"long_shift": "block"})
    assert off == [] and [w.severity for w in block] == ["block"]
    assert "overlapping_shift" not in s.DEFAULT_WARNING_POLICY and "duplicate_assignment" not in s.DEFAULT_WARNING_POLICY


def test_editing_a_row_does_not_count_itself_as_a_neighbour():
    row = occ(id="a1", start=time(6), end=time(20))
    assert codes(s.compute_warnings([row], [row], hotel_today=date(2030, 1, 1))) == ["long_shift"]


# --- attendance interpretation ---------------------------------------------------------------------------

NOW = utc(2030, 1, 7, 18)


@pytest.mark.parametrize(
    "scheduled, session, verified, expected",
    [
        (True, None, True, "not_clocked_in"),
        (False, None, True, "scheduled"),
        (True, {"status": "active", "started_at": "2030-01-07T13:00:00+00:00"}, True, "working"),
        (True, {"status": "on_break", "started_at": "2030-01-07T13:00:00+00:00"}, True, "on_break"),
        (True, {"status": "ended", "started_at": "2030-01-07T13:00:00+00:00"}, True, "clocked_out"),
        (True, {"status": "active", "started_at": "2030-01-06T20:00:00+00:00"}, True, "unknown"),  # 22h open
        (True, {"status": "active", "started_at": "garbage"}, True, "unknown"),
        (True, {"status": "mystery", "started_at": "2030-01-07T13:00:00+00:00"}, True, "unknown"),
        (True, None, False, "unknown"),
        (True, {"status": "active", "started_at": "2030-01-07T13:00:00+00:00"}, False, "unknown"),
    ],
)
def test_workforce_status(scheduled, session, verified, expected):
    assert s.derive_workforce_status(scheduled=scheduled, session=session, attendance_verified=verified, now=NOW) == expected


def test_not_clocked_in_is_never_reported_as_absent():
    values = set(s.WorkforceStatus.__args__)
    assert "absent" not in values and "confirmed_absent" not in values


def test_open_shift_threshold_matches_the_mobile_roster_normalizer():
    source = (REPO_ROOT / "apps/mobile/lib/housekeeping/supervisorTeam.ts").read_text(encoding="utf-8")
    match = re.search(r"MAX_PLAUSIBLE_OPEN_SHIFT_MS\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*([\d_]+)", source)
    assert match, "mobile constant moved: update this contract test deliberately"
    hours, minutes, millis = (int(g.replace("_", "")) for g in match.groups())
    assert timedelta(milliseconds=hours * minutes * millis) == s.MAX_PLAUSIBLE_OPEN_SHIFT


# --- capacity contract -----------------------------------------------------------------------------------

def fact(value, quality="verified"):
    return s.QuantityFact(value, quality, "test") if value is not None else s.QuantityFact(None, "unavailable", "test", "no data")


def test_missing_inputs_never_produce_sufficient_or_short():
    for capacity, demand in ((fact(None), fact(100)), (fact(100), fact(None)), (fact(None), fact(None))):
        result = s.compare_capacity(capacity, demand)
        assert (result.status, result.basis, result.gap_minutes) == ("unknown", "unavailable", None) and result.reasons


def test_capacity_comparison_and_estimate_basis():
    assert s.compare_capacity(fact(480), fact(400)).status == "sufficient"
    short = s.compare_capacity(fact(300), fact(400, "estimate"))
    assert (short.status, short.basis, short.gap_minutes) == ("short", "estimate", -100.0)
    assert s.compare_capacity(fact(400), fact(400)).basis == "verified"


def test_quantity_fact_rejects_inconsistent_construction():
    with pytest.raises(ValueError):
        s.QuantityFact(None, "verified", "x")
    with pytest.raises(ValueError):
        s.QuantityFact(5, "unavailable", "x")


# --- workflow contracts ----------------------------------------------------------------------------------

@pytest.mark.parametrize("key", sorted(WORKFLOWS))
def test_workflow_is_well_formed(key):
    wf = WORKFLOWS[key]
    assert wf.initial in wf.states and wf.terminal <= wf.states
    for state in wf.states:
        outgoing = wf.transitions.get(state, ())
        assert (not outgoing) == (state in wf.terminal), f"{key}.{state}: terminal states end, others must go somewhere"
        for transition in outgoing:
            assert transition.actors, f"{key}: {state}->{transition.to} has nobody allowed to perform it"
    reachable, frontier = {wf.initial}, [wf.initial]
    while frontier:
        for transition in wf.transitions.get(frontier.pop(), ()):
            if transition.to not in reachable:
                reachable.add(transition.to)
                frontier.append(transition.to)
    assert reachable == set(wf.states), f"{key}: unreachable states {set(wf.states) - reachable}"
    assert wf.key == key


def test_scheduling_is_kept_separate_from_gm_only_temporary_role_authorization():
    for name in ("routers/scheduling.py", "routers/scheduling_team.py", "services/scheduling.py",
                 "services/scheduling_access.py", "services/scheduling_contracts.py"):
        tree = ast.parse((API_ROOT / name).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                assert "staff_schedules" not in (node.module or ""), name
                assert all(alias.name != "staff_schedules" for alias in node.names), name
            if isinstance(node, ast.Import):
                assert all("staff_schedules" not in alias.name for alias in node.names), name
            if isinstance(node, ast.Call) and getattr(node.func, "attr", "") == "table" and node.args:
                assert getattr(node.args[0], "value", None) != "staff_role_schedules", name


def test_only_gm_is_unrestricted_and_every_scoped_role_has_a_department():
    assert [role for role, codes_ in MANAGER_DEPARTMENT_CODES.items() if codes_ is None] == ["gm"]
    assert all(codes_ for role, codes_ in MANAGER_DEPARTMENT_CODES.items() if role != "gm")


# --- the migration ---------------------------------------------------------------------------------------

def test_migration_225_protects_history_and_is_marked_for_review():
    sql = (REPO_ROOT / "supabase/migrations/225_team_scheduling_foundation.sql").read_text(encoding="utf-8")
    assert "ON DELETE NO ACTION" in sql and "ON DELETE RESTRICT" not in sql.split("ADD CONSTRAINT shift_assignments_shift_id_fkey")[1]
    assert re.search(r"--\s*migration-safety:\s*destructive-reviewed", sql)
    assert re.search(r"--\s*rollback-plan:\s*\S+", sql)
    assert "pg_advisory_xact_lock" in sql and "23P01" in sql
    statements = "\n".join(line for line in sql.splitlines() if not line.lstrip().startswith("--"))
    assert not re.search(r"\bTRUNCATE\b|\bDELETE\s+FROM\b|DROP\s+(TABLE|COLUMN)", statements)
