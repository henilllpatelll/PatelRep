"""GET /schedules/forecast: persisted inputs -> an honest staffing forecast (FakeDB; handlers called directly)."""
from datetime import datetime, timedelta, timezone

import pytest

from core.errors import CodedHTTPException
from models.coverage_requests import AssignGapRequest, RecordAbsenceRequest
from models.leave_requests import CreateTimeOffRequest, DecideTimeOffRequest
from routers import scheduling as sched
from routers import scheduling_absences as absences
from routers import scheduling_coverage as coverage
from routers import scheduling_forecast as fc
from routers import scheduling_leave as leave
from services import forecast_store

from .request_support import CHIEF, D2, DAY, ENG, GM, HK1, HOTEL, OTHER_GM, S_EVE, SUP, U_HK1, U_HK2, U_HK3, make_db, scheduled
from .test_scheduling_foundation import refused

NOW = datetime(2030, 1, 8, 15, 0, tzinfo=timezone.utc)      # Tuesday 09:00 in Chicago; the 07:00-15:00 shift has 6h left


@pytest.fixture
def db(monkeypatch):
    database = make_db(monkeypatch)
    monkeypatch.setattr(fc, "utc_now", lambda: NOW)
    monkeypatch.setattr(forecast_store, "supabase", database)
    monkeypatch.setattr(forecast_store, "load_roster", lambda *a, **k: [])
    monkeypatch.setattr(forecast_store, "_learned", lambda hotel_id: (None, True))
    database.rows["room_types"] = [{"id": "rt-k", "tenant_id": HOTEL, "code": "K", "base_clean_minutes": 30},
                                   {"id": "rt-none", "tenant_id": HOTEL, "code": "X", "base_clean_minutes": None}]
    database.rows["rooms"], database.rows["room_status"] = [], []
    for row in database.rows["tenants"]:
        row["opera_pilot_enabled"] = False
    return database


def add_room(db, number, status="DIRTY", clean_type="DEP", type_id="rt-k", tenant=HOTEL, **extra):
    room_id = f"r{number:07d}-0000-4000-8000-000000000000"
    db.rows["rooms"].append({"id": room_id, "tenant_id": tenant, "room_number": str(number), "room_type_id": type_id, "is_active": True})
    db.rows["room_status"].append({"room_id": room_id, "tenant_id": tenant, "status": status, "clean_type": clean_type, "fo_status": None,
                                   "assigned_to": None, "do_not_service": False, "actual_checkout_at": None, "updated_at": "2030-01-08T14:00:00Z", **extra})
    return room_id


async def forecast(actor=SUP, **kw):
    args = {"date_from": None, "days": 7, "break_minutes": 0, **kw}
    return await fc.get_staffing_forecast(current_user=actor, **args)


async def today(actor=SUP, **kw):
    return (await forecast(actor, **kw))["data"]["days"][0]


# --- today -----------------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_today_is_sufficient_when_the_remaining_labour_covers_the_remaining_rooms(db):
    await scheduled(user=U_HK1)
    for number in (101, 102, 103):
        add_room(db, number)
    day = await today()
    assert (day["status"], day["basis"], day["forecast_quality"]) == ("sufficient", "estimate", "estimated")
    assert day["demand"]["minutes"]["value"] == 90 and day["demand"]["rooms"] == 3
    assert day["capacity"]["productive_minutes"]["value"] == 360 and day["capacity"]["measured_from"] == "now"
    assert day["demand"]["by_category"][0] == {"category": "departure", "rooms": 3, "minutes": 90, "unestimated_rooms": 0}
    assert "later_departures_unknown" in day["limitations"] and day["capacity"]["break_policy"] == "unknown"


@pytest.mark.asyncio
async def test_today_is_short_with_the_shortfall_and_an_explainable_shift_estimate(db):
    await scheduled(user=U_HK1)
    for number in range(201, 215):
        add_room(db, number)                                   # 14 rooms x 30 min = 420 > 360 left
    day = await today()
    assert (day["status"], day["headline"]) == ("short", {"code": "short", "reason": None, "gap_minutes": 60, "is_minimum": False})
    assert day["gap"]["additional_shifts"]["value"] == 1 and day["gap"]["additional_shifts"]["quality"] == "estimate"
    rec = next(r for r in day["recommendations"] if r["kind"] == "shortfall")
    assert (rec["basis"], rec["action"]) == ("estimate", {"type": "add_shift", "date": "2030-01-08"})


@pytest.mark.asyncio
async def test_unestimated_rooms_stop_sufficient_but_known_work_can_still_prove_short(db):
    await scheduled(user=U_HK1)
    add_room(db, 301, type_id="rt-none")
    day = await today()
    assert (day["status"], day["forecast_quality"], day["demand"]["unestimated_rooms"]) == ("unknown", "partial", 1)
    assert day["headline"]["reason"] == "unestimated_rooms"
    assert any(r["kind"] == "missing_estimates" and r["action"] is None for r in day["recommendations"])
    for number in range(310, 325):
        add_room(db, number)                                   # 15 x 30 = 450 known minutes alone exceed 360
    day = await today()
    assert (day["status"], day["headline"]["is_minimum"], day["gap"]["additional_shifts"]["is_minimum"]) == ("short", True, True)


@pytest.mark.asyncio
async def test_a_room_in_several_operational_lists_is_counted_once(db):
    await scheduled(user=U_HK1)
    room_id = add_room(db, 401, clean_type="DEP")
    db.rows["room_assignments"].append({"room_id": room_id, "tenant_id": HOTEL, "assigned_to": U_HK1, "assignment_date": "2030-01-08", "clean_type": "DEP"})
    day = await today()
    assert day["demand"]["rooms"] == 1 and day["demand"]["unassigned_rooms"] == 0


@pytest.mark.asyncio
async def test_room_status_changes_move_the_forecast_and_its_revision(db):
    await scheduled(user=U_HK1)
    room_id = add_room(db, 501)
    first = await forecast()
    next(r for r in db.rows["room_status"] if r["room_id"] == room_id).update(status="CLEAN", updated_at="2030-01-08T14:30:00Z")
    second = await forecast()
    assert first["data"]["days"][0]["demand"]["minutes"]["value"] == 30 and second["data"]["days"][0]["demand"]["minutes"]["value"] == 0
    assert first["meta"]["revision"] != second["meta"]["revision"]
    assert (await forecast())["meta"]["revision"] == second["meta"]["revision"]          # same inputs, same revision


@pytest.mark.asyncio
async def test_unassigned_remaining_rooms_become_an_assignments_recommendation_with_the_date(db):
    await scheduled(user=U_HK1)
    add_room(db, 601)
    add_room(db, 602, assigned_to=U_HK1)
    day = await today()
    rec = next(r for r in day["recommendations"] if r["kind"] == "unassigned_rooms")
    assert (rec["params"]["rooms"], rec["action"]) == (1, {"type": "view_assignments", "date": "2030-01-08"})


# --- capacity from the schedule --------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_confirmed_callout_and_its_replacement_are_each_counted_once(db):
    first = await scheduled(user=U_HK1)
    result = await absences.record_absence(RecordAbsenceRequest(assignment_id=first, expected_version=1, kind="called_out"), SUP)
    short = await today()
    assert short["capacity"]["productive_minutes"]["value"] == 0 and short["capacity"]["confirmed_callouts"] == 1
    gap = result["data"]["gap"]
    assert [g["gap_id"] for g in short["open_gaps"]] == [gap["id"]]
    rec = next(r for r in short["recommendations"] if r["kind"] == "uncovered_shift")
    assert (rec["basis"], rec["action"]["type"], rec["action"]["gap_id"]) == ("verified", "find_coverage", gap["id"])
    await coverage.assign_gap(gap["id"], AssignGapRequest(user_id=U_HK2, expected_version=gap["version"], acknowledge_warnings=True), SUP)
    covered = await today()
    assert covered["capacity"]["productive_minutes"]["value"] == 360 and covered["capacity"]["replacements"] == 1
    assert covered["capacity"]["people"] == 1 and covered["open_gaps"] == []


@pytest.mark.asyncio
async def test_approved_leave_reduces_capacity_while_pending_leave_only_warns(db):
    await scheduled(user=U_HK1)
    await scheduled(user=U_HK2)
    pending = (await leave.create_time_off(CreateTimeOffRequest(start_date=DAY, end_date=DAY, reason_category="personal"), HK1))["data"]
    assert (await today())["capacity"]["productive_minutes"]["value"] == 720
    assert "pending_leave" in (await today())["limitations"]
    await leave.approve_time_off(pending["id"], DecideTimeOffRequest(expected_version=pending["version"]), SUP)
    day = await today()
    assert day["capacity"]["productive_minutes"]["value"] == 360 and day["capacity"]["leave_reduced_shifts"] == 1
    assert any(r["kind"] == "leave_conflict" and r["action"]["type"] == "review_time_off" for r in day["recommendations"])


@pytest.mark.asyncio
async def test_a_draft_shift_is_not_capacity_and_scheduled_is_not_the_same_as_clocked_in(db):
    await scheduled(user=U_HK1)
    next(a for a in db.rows["shift_assignments"]).update(publication_state="draft")
    assert (await today())["capacity"]["productive_minutes"]["value"] == 0 and (await today())["capacity"]["draft_shifts"] == 1
    next(a for a in db.rows["shift_assignments"]).update(publication_state="published")
    day = await today()
    assert day["capacity"]["productive_minutes"]["value"] == 360
    assert day["current"] == {"verified": True, "source": "hk_shift_sessions", "scheduled_people": 1, "working": 0, "on_break": 0,
                              "not_clocked_in": 1, "clocked_out": 0, "unknown": 0}      # scheduled, not absent, not working


@pytest.mark.asyncio
async def test_unreadable_attendance_leaves_the_plan_intact_and_current_unverified(db, monkeypatch):
    await scheduled(user=U_HK1)
    monkeypatch.setattr(forecast_store, "load_roster", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down")))
    day = await today()
    assert day["current"] == {"verified": False, "scheduled_people": 1} and day["capacity"]["productive_minutes"]["value"] == 360


@pytest.mark.asyncio
async def test_a_break_what_if_is_applied_but_never_saved(db):
    await scheduled(user=U_HK1)
    day = await today(break_minutes=30)
    assert day["capacity"]["full_day_minutes"]["value"] == 450 and day["capacity"]["break_policy"] == "scenario"
    assert "scenario_break_minutes" in day["capacity"]["productive_minutes"]["assumptions"]
    assert (await today())["capacity"]["full_day_minutes"]["value"] == 480


# --- the seven-day outlook -------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_future_days_show_scheduled_labour_but_are_never_sufficient_without_a_demand_source(db):
    await scheduled(user=U_HK1, day=D2)
    result = await forecast()
    days = result["data"]["days"]
    assert [d["date"] for d in days] == [(DAY + timedelta(days=i)).isoformat() for i in range(7)] and days[0]["is_today"] and not days[1]["is_today"]
    tomorrow = days[1]
    assert (tomorrow["status"], tomorrow["forecast_quality"], tomorrow["headline"]["reason"]) == ("unknown", "unavailable", "pms_not_connected")
    assert tomorrow["demand"]["minutes"]["value"] is None and tomorrow["capacity"]["productive_minutes"]["value"] == 480
    assert tomorrow["demand"]["scope"] == "unavailable" and tomorrow["current"] is None
    db.rows["tenants"][0]["opera_pilot_enabled"] = True
    assert (await forecast())["data"]["days"][1]["headline"]["reason"] == "future_demand_unavailable"


@pytest.mark.asyncio
async def test_a_day_boundary_uses_the_hotel_date_and_rolls_over(db, monkeypatch):
    await scheduled(user=U_HK1, day=D2)
    monkeypatch.setattr(fc, "utc_now", lambda: datetime(2030, 1, 9, 5, 30, tzinfo=timezone.utc))    # Tue 23:30 in Chicago, still the 8th
    assert (await forecast())["meta"]["hotel_today"] == "2030-01-08"
    monkeypatch.setattr(fc, "utc_now", lambda: datetime(2030, 1, 9, 6, 30, tzinfo=timezone.utc))    # Wed 00:30 in Chicago
    rolled = await forecast()
    assert rolled["meta"]["hotel_today"] == "2030-01-09" and rolled["data"]["days"][0]["is_today"]


# --- failure handling, scope and isolation ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_unreadable_board_or_leave_degrades_to_unknown_and_an_unreadable_plan_is_an_error(db, monkeypatch):
    await scheduled(user=U_HK1)
    add_room(db, 701)
    original = db.table

    def failing(name):
        if name in broken:
            raise RuntimeError("down")
        return original(name)
    monkeypatch.setattr(db, "table", failing)
    broken = {"room_status"}
    day = await today()
    assert (day["status"], day["demand"]["minutes"]["reason"]) == ("unknown", "room_board_unreadable")
    broken = {"time_off_requests"}
    day = await today()
    assert (day["status"], day["capacity"]["productive_minutes"]["reason"]) == ("unknown", "leave_unreadable")
    broken = {"shift_assignments"}
    with pytest.raises(CodedHTTPException) as exc:
        await forecast()
    assert refused(exc) == "forecast_unavailable"


@pytest.mark.asyncio
async def test_only_housekeeping_managers_may_read_the_forecast_and_the_scope_is_checked(db):
    for actor in (ENG, CHIEF):
        with pytest.raises(CodedHTTPException) as exc:
            await forecast(actor)
        assert refused(exc) == "department_forbidden"
    assert (await forecast(GM))["data"]["days"] and (await forecast(SUP))["data"]["days"]


def test_forecast_routes_are_gated_by_role():
    from middleware.auth import get_current_user
    paths = set()
    for route in fc.router.routes:
        assert [d.call for d in route.dependant.dependencies if d.call is not get_current_user], f"{route.path} has no role gate"
        paths.add(route.path)
    assert paths == {"/schedules/forecast", "/schedules/forecast/{day}"}


@pytest.mark.asyncio
async def test_date_bounds_are_enforced(db):
    for bad, code in ((DAY - timedelta(days=1), "past_date"), (DAY + timedelta(days=61), "date_too_far")):
        with pytest.raises(CodedHTTPException) as exc:
            await forecast(date_from=bad)
        assert refused(exc) == code
    assert len((await forecast(days=3))["data"]["days"]) == 3
    db.rows["tenants"][0]["name"] = "Fossil Creek Inn"
    assert (await forecast())["meta"]["hotel_name"] == "Fossil Creek Inn"
    assert (await fc.get_staffing_forecast_day(DAY + timedelta(days=2), 0, SUP))["data"]["date"] == "2030-01-10"


@pytest.mark.asyncio
async def test_another_hotels_rooms_shifts_and_absences_never_leak_in(db):
    await scheduled(user=U_HK1)
    add_room(db, 801)
    add_room(db, 802, tenant="hotel-b")
    db.rows["shift_assignments"].append({"id": "x-1", "tenant_id": "hotel-b", "user_id": U_HK3, "shift_id": S_EVE, "work_date": "2030-01-08",
                                          "shift_name": "Other", "start_time": "07:00:00", "end_time": "15:00:00", "publication_state": "published",
                                          "starts_at": "2030-01-08T13:00:00+00:00", "ends_at": "2030-01-08T21:00:00+00:00", "version": 1})
    mine = await today()
    assert (mine["demand"]["rooms"], mine["capacity"]["productive_minutes"]["value"]) == (1, 360)
    theirs = await today(OTHER_GM)
    assert (theirs["demand"]["rooms"], theirs["capacity"]["people"]) == (1, 0)           # their own room, nobody else's labour


@pytest.mark.asyncio
async def test_writes_to_shifts_are_reflected_on_the_next_read_with_no_stale_cache(db):
    empty = await forecast()
    row_id = await scheduled(user=U_HK1)
    created = await forecast()
    await sched.delete_shift_assignment(row_id, SUP) if hasattr(sched, "delete_shift_assignment") else await sched.delete_assignment(row_id, SUP)
    removed = await forecast()
    values = [r["data"]["days"][0]["capacity"]["productive_minutes"]["value"] for r in (empty, created, removed)]
    assert values == [0, 360, 0]
    assert len({empty["meta"]["revision"], created["meta"]["revision"]}) == 2
