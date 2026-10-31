"""Migration 227 against the REAL migrated database, never mocks (Team Scheduling Phase 5).

The unit tests prove how the API uses these objects; these prove the objects themselves: the weekly-availability replace is
one atomic set with a revision check, live time-off cannot overlap, approved leave refuses every shift write that would land
on it (and only those), a shift is in at most one live swap, and approve_shift_swap() exchanges BOTH assignments with the
request and its audit rows in one transaction -- or changes nothing at all.
"""

import os
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from postgrest.exceptions import APIError

from batch_support import make_hotel
from core.database import get_supabase

pytestmark = pytest.mark.skipif(
    os.getenv("MIGRATED_DATABASE_TEST") != "1",
    reason="requires the isolated Supabase database created by the migration gate",
)


@pytest.fixture(scope="module")
def db():
    return get_supabase()


def days(offset: int) -> date:
    return date.today() + timedelta(days=offset)


def error_code(call):
    with pytest.raises(APIError) as exc:
        call()
    return exc.value.code


def rows(db, table, **where):
    query = db.table(table).select("*")
    for key, value in where.items():
        query = query.eq(key, value)
    return query.execute().data


class World:
    """One hotel, one HK department, two shifts, three housekeepers."""

    def __init__(self, db):
        self.db = db
        self.hotel = make_hotel(db, rooms={"r1": {}}, housekeepers=3)
        self.tenant = self.hotel.tenant_id
        self.dept = db.table("departments").insert({"tenant_id": self.tenant, "name": "Housekeeping", "code": "HK"}).execute().data[0]["id"]
        self.morning = db.table("shifts").insert({"tenant_id": self.tenant, "name": "Morning", "department_id": self.dept, "start_time": "07:00:00", "end_time": "15:00:00"}).execute().data[0]["id"]
        self.evening = db.table("shifts").insert({"tenant_id": self.tenant, "name": "Evening", "department_id": self.dept, "start_time": "15:00:00", "end_time": "23:00:00"}).execute().data[0]["id"]
        self.a, self.b, self.c = self.hotel.housekeepers

    def shift(self, user, offset, shift=None):
        return self.db.table("shift_assignments").insert(
            {"tenant_id": self.tenant, "user_id": user, "shift_id": shift or self.morning, "work_date": days(offset).isoformat()}).execute().data[0]

    def leave(self, user, start, end, status="pending", **extra):
        window_start = datetime.combine(days(start), datetime.min.time(), tzinfo=timezone.utc)
        window_end = datetime.combine(days(end) + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        return self.db.table("time_off_requests").insert({
            "tenant_id": self.tenant, "user_id": user, "start_date": days(start).isoformat(), "end_date": days(end).isoformat(),
            "starts_at": window_start.isoformat(), "ends_at": window_end.isoformat(), "reason_category": "personal", "status": status, **extra,
        }).execute().data[0]

    def swap(self, a_row, b_row, status="accepted", **extra):
        return self.db.table("shift_swap_requests").insert({
            "tenant_id": self.tenant, "department_id": self.dept, "requester_id": a_row["user_id"], "counterpart_id": b_row["user_id"],
            "requester_assignment_id": a_row["id"], "counterpart_assignment_id": b_row["id"],
            "requester_assignment_version": a_row["version"], "counterpart_assignment_version": b_row["version"],
            "status": status, "expires_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(), **extra,
        }).execute().data[0]

    def approve(self, swap, version=None):
        return self.db.rpc("approve_shift_swap", {
            "p_tenant_id": self.tenant, "p_swap_id": swap["id"], "p_expected_version": version or swap["version"],
            "p_actor": self.hotel.supervisor, "p_actor_role": "housekeeping_supervisor", "p_note": "ok",
        }).execute()


@pytest.fixture
def world(db):
    return World(db)


# --- availability -------------------------------------------------------------------------------------------------------

def replace(world, expected, effective, day_list):
    return world.db.rpc("replace_weekly_availability", {
        "p_tenant_id": world.tenant, "p_user_id": world.a, "p_actor": world.a, "p_expected_revision": expected,
        "p_effective_from": effective.isoformat(), "p_days": day_list,
    }).execute()


def monday(windows=({"start": "07:00", "end": "15:00"},)):
    return {"weekday": 0, "mode": "available", "windows": list(windows)}


def test_weekly_availability_is_replaced_as_one_set_with_a_revision_check(world):
    first = replace(world, 0, days(0), [monday(), {"weekday": 2, "mode": "unavailable", "windows": []}])
    assert (first.data["revision"], first.data["days"]) == (1, 2)
    assert error_code(lambda: replace(world, 0, days(0), [monday()])) == "AV001"          # stale: someone saved first
    assert len(rows(world.db, "employee_availability", user_id=world.a, status="active")) == 2
    replace(world, 1, days(0), [monday([{"start": "11:00", "end": "19:00"}])])
    active = rows(world.db, "employee_availability", user_id=world.a, status="active")
    assert [(r["weekday"], r["revision"]) for r in active] == [(0, 2)]
    assert len(rows(world.db, "employee_availability", user_id=world.a, status="retired")) == 2     # superseded rows are kept


def test_a_future_start_end_dates_the_current_rule_instead_of_replacing_it(world):
    replace(world, 0, days(0), [monday()])
    start = days(14)
    replace(world, 1, start, [monday([{"start": "11:00", "end": "19:00"}])])
    by_from = {r["effective_from"]: r for r in rows(world.db, "employee_availability", user_id=world.a, status="active")}
    assert by_from[days(0).isoformat()]["effective_to"] == (start - timedelta(days=1)).isoformat()
    assert by_from[start.isoformat()]["effective_to"] is None


def test_availability_rows_must_have_a_sensible_shape(world):
    base = {"tenant_id": world.tenant, "user_id": world.a, "kind": "weekly", "weekday": 0, "effective_from": days(0).isoformat()}
    assert error_code(lambda: world.db.table("employee_availability").insert({**base, "mode": "available", "windows": []}).execute()) == "23514"
    assert error_code(lambda: world.db.table("employee_availability").insert({**base, "mode": "unavailable", "windows": [{"start": "07:00", "end": "15:00"}]}).execute()) == "23514"
    assert error_code(lambda: world.db.table("employee_availability").insert({**base, "mode": "available", "windows": {"start": "07:00"}}).execute()) == "23514"
    assert error_code(lambda: world.db.table("employee_availability").insert({**base, "kind": "exception", "mode": "unavailable"}).execute()) == "23514"
    assert error_code(lambda: world.db.table("employee_availability").insert({**base, "weekday": 9, "mode": "unavailable"}).execute()) == "23514"


# --- time off ---------------------------------------------------------------------------------------------------------------

def test_live_time_off_cannot_overlap_but_dead_time_off_does_not_count(world):
    first = world.leave(world.a, 10, 12)
    assert error_code(lambda: world.leave(world.a, 12, 13)) == "23P01"
    assert world.leave(world.a, 13, 14)["status"] == "pending"                     # the next day is fine
    assert world.leave(world.b, 10, 12)["status"] == "pending"                     # another person is fine
    world.db.table("time_off_requests").update({"status": "denied", "decision_reason": "Short staffed"}).eq("id", first["id"]).execute()
    assert world.leave(world.a, 10, 11)["status"] == "pending"


def test_decided_requests_are_final_and_a_denial_needs_a_reason(world):
    request = world.leave(world.a, 20, 21)
    assert error_code(lambda: world.db.table("time_off_requests").update({"status": "denied"}).eq("id", request["id"]).execute()) == "23514"
    world.db.table("time_off_requests").update({"status": "denied", "decision_reason": "No"}).eq("id", request["id"]).execute()
    assert error_code(lambda: world.db.table("time_off_requests").update({"status": "approved"}).eq("id", request["id"]).execute()) == "TO010"


def test_approved_leave_refuses_shifts_that_land_on_it_and_nothing_else(world):
    leave = world.leave(world.a, 30, 31, status="approved")
    assert error_code(lambda: world.shift(world.a, 30)) == "TO001"                 # created on leave
    assert error_code(lambda: world.shift(world.a, 31, world.evening)) == "TO001"
    assert world.shift(world.a, 32)["publication_state"] == "published"             # the day after is fine
    assert world.shift(world.b, 30)["user_id"] == world.b                           # someone else is fine
    handed_over = world.shift(world.b, 33)
    world.leave(world.a, 33, 33, status="approved")
    assert error_code(lambda: world.db.table("shift_assignments").update({"user_id": world.a}).eq("id", handed_over["id"]).execute()) == "TO001"   # re-assigned onto leave
    assert rows(world.db, "shift_assignments", id=handed_over["id"])[0]["user_id"] == world.b
    world.db.table("time_off_requests").update({"status": "cancelled"}).eq("id", leave["id"]).execute()   # cancelled leave restricts nothing
    assert world.shift(world.a, 30)["user_id"] == world.a


def test_leave_approved_over_an_existing_shift_leaves_the_shift_in_place_and_editable(world):
    existing = world.shift(world.a, 50)
    world.leave(world.a, 50, 50, status="approved")
    assert rows(world.db, "shift_assignments", id=existing["id"])[0]["user_id"] == world.a             # approval touched nothing
    world.db.table("shift_assignments").update({"notes": "bring keys"}).eq("id", existing["id"]).execute()   # a notes edit is not held hostage
    assert rows(world.db, "shift_assignments", id=existing["id"])[0]["notes"] == "bring keys"


# --- shift swaps ------------------------------------------------------------------------------------------------------------

def test_a_shift_is_in_at_most_one_live_swap_and_finished_swaps_are_final(world):
    a, b, c = world.shift(world.a, 70), world.shift(world.b, 71), world.shift(world.c, 72)
    first = world.swap(a, b, status="proposed")
    assert error_code(lambda: world.swap(c, b, status="proposed")) == "SW011"      # b is already half of a live swap
    assert error_code(lambda: world.swap(b, c)) == "SW011"                         # ...in either column
    world.db.table("shift_swap_requests").update({"status": "declined"}).eq("id", first["id"]).execute()
    assert world.swap(c, b, status="proposed")["status"] == "proposed"             # free again once the first one is over
    assert error_code(lambda: world.db.table("shift_swap_requests").update({"status": "proposed"}).eq("id", first["id"]).execute()) == "SW012"


def users_of(world, *assignments):
    return [rows(world.db, "shift_assignments", id=a["id"])[0]["user_id"] for a in assignments]


def test_approval_exchanges_both_shifts_and_settles_the_request_in_one_step(world):
    a, b = world.shift(world.a, 80), world.shift(world.b, 81)
    swap = world.swap(a, b)
    world.approve(swap)
    assert users_of(world, a, b) == [world.b, world.a]
    after_a, after_b = rows(world.db, "shift_assignments", id=a["id"])[0], rows(world.db, "shift_assignments", id=b["id"])[0]
    assert (after_a["version"], after_b["version"]) == (2, 2)
    settled = rows(world.db, "shift_swap_requests", id=swap["id"])[0]
    assert (settled["status"], settled["decided_by"], settled["version"], settled["decision_reason"]) == ("approved", world.hotel.supervisor, 2, "ok")
    events = world.db.table("operational_audit_events").select("*").in_("resource_id", [swap["id"], a["id"], b["id"]]).execute().data
    assert sorted((e["resource_type"], e["action"]) for e in events) == [("shift_assignment", "swapped"), ("shift_assignment", "swapped"), ("shift_swap", "approved")]


def test_only_an_accepted_swap_at_the_expected_version_can_be_approved(world):
    a, b = world.shift(world.a, 82), world.shift(world.b, 83)
    waiting = world.swap(a, b, status="proposed")
    assert error_code(lambda: world.approve(waiting)) == "SW002"
    world.db.table("shift_swap_requests").update({"status": "accepted"}).eq("id", waiting["id"]).execute()
    assert error_code(lambda: world.approve(waiting, version=9)) == "SW001"
    assert error_code(lambda: world.db.rpc("approve_shift_swap", {
        "p_tenant_id": world.tenant, "p_swap_id": str(uuid.uuid4()), "p_expected_version": 1, "p_actor": world.hotel.supervisor,
        "p_actor_role": "gm", "p_note": None}).execute()) == "SW003"
    assert users_of(world, a, b) == [world.a, world.b]


def test_a_shift_edited_after_both_agreed_blocks_the_exchange(world):
    a, b = world.shift(world.a, 84), world.shift(world.b, 85)
    swap = world.swap(a, b)
    world.db.table("shift_assignments").update({"notes": "moved by a supervisor"}).eq("id", b["id"]).execute()      # bumps the version
    assert error_code(lambda: world.approve(swap)) == "SW005"
    assert users_of(world, a, b) == [world.a, world.b] and rows(world.db, "shift_swap_requests", id=swap["id"])[0]["status"] == "accepted"


def test_shifts_that_started_overlap_each_other_or_carry_a_call_out_are_refused(world):
    past = world.shift(world.a, -1)
    soon = world.shift(world.b, 86)
    assert error_code(lambda: world.approve(world.swap(past, soon))) == "SW006"

    mid = world.db.table("shifts").insert({"tenant_id": world.tenant, "name": "Mid", "department_id": world.dept, "start_time": "10:00:00", "end_time": "18:00:00"}).execute().data[0]["id"]
    one, two = world.shift(world.a, 87), world.shift(world.b, 87, mid)
    assert error_code(lambda: world.approve(world.swap(one, two))) == "SW009"

    left, right = world.shift(world.a, 88), world.shift(world.b, 89)
    world.db.table("absence_records").insert({
        "tenant_id": world.tenant, "user_id": world.a, "assignment_id": left["id"], "department_id": world.dept, "work_date": days(88).isoformat(),
        "starts_at": left["starts_at"], "ends_at": left["ends_at"], "kind": "called_out", "status": "confirmed",
    }).execute()
    assert error_code(lambda: world.approve(world.swap(left, right))) == "SW010"
    assert users_of(world, left, right) == [world.a, world.b]


def test_an_inactive_employee_blocks_the_exchange(world):
    a, b = world.shift(world.a, 90), world.shift(world.b, 91)
    swap = world.swap(a, b)
    world.db.table("user_roles").update({"is_active": False}).eq("user_id", world.b).eq("tenant_id", world.tenant).execute()
    assert error_code(lambda: world.approve(swap)) == "SW007"
    assert users_of(world, a, b) == [world.a, world.b]


def test_approved_leave_or_a_double_booking_for_the_new_owner_rolls_everything_back(world):
    a, b = world.shift(world.a, 100), world.shift(world.b, 101)
    swap = world.swap(a, b)
    world.leave(world.b, 100, 100, status="approved")                       # B is off on the day A's shift would move to B
    assert error_code(lambda: world.approve(swap)) == "TO001"
    assert users_of(world, a, b) == [world.a, world.b]                        # NEITHER schedule moved
    assert rows(world.db, "shift_swap_requests", id=swap["id"])[0]["status"] == "accepted"
    assert not world.db.table("operational_audit_events").select("*").eq("resource_id", swap["id"]).execute().data

    mid = world.db.table("shifts").insert({"tenant_id": world.tenant, "name": "Mid", "department_id": world.dept, "start_time": "10:00:00", "end_time": "18:00:00"}).execute().data[0]["id"]
    c, d = world.shift(world.a, 110), world.shift(world.b, 111)
    world.shift(world.b, 110, mid)                                            # B already works 10:00-18:00 on the day they would receive A's morning
    assert error_code(lambda: world.approve(world.swap(c, d))) == "23P01"
    assert users_of(world, c, d) == [world.a, world.b]


def test_two_supervisors_approving_at_once_exchange_the_shifts_exactly_once(world):
    from concurrent.futures import ThreadPoolExecutor
    a, b = world.shift(world.a, 120), world.shift(world.b, 121)
    swap = world.swap(a, b)

    def attempt():
        try:
            world.approve(swap)
            return "ok"
        except APIError as exc:
            return exc.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = sorted(pool.map(lambda _: attempt(), range(2)))
    assert outcomes == ["SW002", "ok"]
    assert users_of(world, a, b) == [world.b, world.a]                          # swapped once, not swapped back
    assert rows(world.db, "shift_assignments", id=a["id"])[0]["version"] == 2
