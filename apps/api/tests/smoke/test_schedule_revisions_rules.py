"""Team Scheduling Phase 7: the pure draft rules (services/schedule_revisions.py) - no database."""
from datetime import date

from services.schedule_revisions import build_review, comparable, stage_decision

TODAY = date(2030, 1, 1)
REV = {"id": "rev-1", "department_id": "dept-1"}
A, B = "user-a", "user-b"


def live_row(id="s1", user=A, day="2030-01-08", start="07:00:00", end="15:00:00", version=1, shift="shift-m", **extra):
    return {"id": id, "user_id": user, "shift_id": shift, "shift_name": "Morning", "work_date": day, "start_time": start, "end_time": end,
            "starts_at": f"{day}T{int(start[:2]) + 6:02d}:00:00+00:00", "ends_at": f"{day}T{int(end[:2]) + 6:02d}:00:00+00:00",
            "publication_state": "published", "version": version, "department_id": "dept-1", **extra}


def proposal(user=A, day="2030-01-08", start="08:00:00", end="16:00:00", shift="shift-m"):
    return {"user_id": user, "shift_id": shift, "shift_name": "Morning", "work_date": day, "start_time": start, "end_time": end,
            "department_id": "dept-1", "starts_at": f"{day}T{int(start[:2]) + 6:02d}:00:00+00:00", "ends_at": f"{day}T{int(end[:2]) + 6:02d}:00:00+00:00"}


def change(id, kind, assignment=None, base=None, prop=None, dept="dept-1", reason=None):
    return {"id": id, "kind": kind, "assignment_id": assignment, "base_version": base, "proposed": prop, "department_id": dept, "reason": reason}


def review(changes, live=None, neighbors=(), **kw):
    return build_review(revision=REV, changes=changes, live=live or {}, neighbors=list(neighbors), today=TODAY, names={A: "Ana", B: "Bea"}, **kw)


# --- staging decisions -----------------------------------------------------------------------------------------------------

def test_stage_decision_matrix():
    live, edited = live_row(), proposal()
    assert stage_decision(existing=None, incoming_kind="create", live=None, proposed=edited).action == "insert"
    assert stage_decision(existing={"kind": "create"}, incoming_kind="create", live=None, proposed=edited).action == "replace"
    assert stage_decision(existing={"kind": "create"}, incoming_kind="cancel", live=None, proposed=None).action == "delete"
    assert stage_decision(existing={"kind": "create"}, incoming_kind="update", live=None, proposed=edited) == stage_decision(
        existing={"kind": "create"}, incoming_kind="update", live=None, proposed=edited)
    assert stage_decision(existing=None, incoming_kind="update", live=live, proposed=edited).kind == "update"
    assert stage_decision(existing={"kind": "update"}, incoming_kind="cancel", live=live, proposed=None).kind == "cancel"   # cancel supersedes the earlier edit
    same = {**live, "start_time": "07:00", "end_time": "15:00"}
    assert stage_decision(existing=None, incoming_kind="update", live=live, proposed=same).action == "noop"
    assert stage_decision(existing={"kind": "update"}, incoming_kind="update", live=live, proposed=same).action == "delete"


def test_comparable_ignores_seconds_and_empty_notes():
    assert comparable({**live_row(), "notes": ""}) == comparable({**live_row(start="07:00:00"), "start_time": "07:00", "notes": None})


# --- the review ------------------------------------------------------------------------------------------------------------

def test_reassignment_is_counted_once_and_shows_both_employees():
    result = review([change("c1", "update", "s1", 1, proposal(user=B, start="07:00:00", end="15:00:00"))], {"s1": live_row()})
    assert result.summary == {"new": 0, "modified": 0, "cancelled": 0, "reassigned": 1, "employees_affected": 2, "total_changes": 1}
    kinds = {p["user_id"]: p["items"][0]["kind"] for p in result.impact}
    assert kinds == {A: "removed", B: "added"} and result.can_publish


def test_an_empty_draft_cannot_be_published():
    assert not review([]).can_publish and review([]).date_range is None


def test_a_change_from_another_department_is_blocked():
    result = review([change("c1", "create", prop=proposal(), dept="dept-2")])
    assert result.blocking[0]["code"] == "department_mismatch" and not result.can_publish


def test_past_dates_and_attendance_and_call_outs_block():
    past = review([change("c1", "create", prop=proposal(day="2029-12-01"))])
    assert past.blocking[0]["code"] == "past_date"
    started = review([change("c1", "cancel", "s1", 1)], {"s1": live_row()}, live_attendance={"s1"})
    assert started.blocking[0]["code"] == "has_attendance"
    committed = review([change("c1", "cancel", "s1", 1)], {"s1": live_row()}, committed={"s1"})
    assert committed.blocking[0]["code"] == "coverage_commitment"


def test_a_missing_or_changed_live_shift_is_stale_and_shows_the_current_value():
    gone = review([change("c1", "cancel", "s1", 1)], {})
    assert gone.blocking[0]["code"] == "stale_shift"
    moved = review([change("c1", "update", "s1", 1, proposal())], {"s1": live_row(version=3, start="09:00:00", end="17:00:00")})
    assert moved.blocking[0]["code"] == "stale_shift" and moved.blocking[0]["current"]["start_time"] == "09:00" and moved.blocking[0]["current_version"] == 3


def test_two_new_shifts_for_one_person_that_overlap_are_blocked_but_back_to_back_is_fine():
    clash = review([change("c1", "create", prop=proposal(start="08:00:00", end="12:00:00", shift="s-a")),
                    change("c2", "create", prop=proposal(start="11:00:00", end="15:00:00", shift="s-b"))])
    assert any(b["code"] == "overlapping_shift" for b in clash.blocking)
    fine = review([change("c1", "create", prop=proposal(start="08:00:00", end="12:00:00", shift="s-a")),
                   change("c2", "create", prop=proposal(start="12:00:00", end="16:00:00", shift="s-b"))])
    assert fine.blocking == []


def test_the_final_schedule_is_what_is_checked_so_moving_a_shift_off_a_clash_passes():
    other = live_row(id="s2", start="09:00:00", end="13:00:00", shift="shift-x")
    stays = review([change("c1", "create", prop=proposal(start="10:00:00", end="12:00:00", shift="s-new"))], neighbors=[other])
    assert any(b["code"] == "overlapping_shift" for b in stays.blocking)
    resolved = review([change("c1", "create", prop=proposal(start="10:00:00", end="12:00:00", shift="s-new")), change("c2", "cancel", "s2", 1)],
                      {"s2": other}, neighbors=[other])
    assert resolved.blocking == [] and resolved.summary["cancelled"] == 1


def test_a_duplicate_person_shift_date_against_a_published_row_is_blocked():
    existing = live_row(id="s9", start="07:00:00", end="15:00:00")
    result = review([change("c1", "create", prop=proposal(start="07:00:00", end="15:00:00"))], neighbors=[existing])
    assert {"duplicate_assignment", "overlapping_shift"} & {b["code"] for b in result.blocking}


def test_employee_availability_warnings_and_leave_are_passed_through_correctly():
    advice = [{"code": "outside_availability", "user_id": A, "work_date": "2030-01-08", "detail": "x", "severity": "warn"}]
    warned = review([change("c1", "create", prop=proposal())], availability_warnings=advice)
    assert warned.can_publish and warned.warnings[-1]["code"] == "outside_availability"
    leave = review([change("c1", "create", prop=proposal())], leave_blocked={"c1": {"leave": [{"id": "l1"}]}})
    assert leave.blocking[0]["code"] == "approved_time_off" and not leave.can_publish


def test_the_employee_face_of_a_shift_never_includes_notes_or_reasons():
    result = review([change("c1", "cancel", "s1", 1, reason="late again")], {"s1": live_row(notes="warned twice")})
    item = result.impact[0]["items"][0]
    assert "warned twice" not in str(item["before"]) and item["reason"] == "late again"       # the reason stays on the manager's review only
