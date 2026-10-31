"""Phase 8 scenarios through the real FastAPI app against the REAL migrated database (never mocks).

The unit suites prove each rule with fakes; these prove what only a database can: two supervisors really racing on one
shift, a retried bulk create really writing nothing twice, the stored UTC instants for overnight and daylight-saving
shifts, and a draft really staying invisible to the employee until it is published.
"""

import os
import threading
import uuid
from datetime import date, datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient

from batch_support import make_hotel
from core.config import settings
from core.database import get_supabase
from main import app

pytestmark = pytest.mark.skipif(
    os.getenv("MIGRATED_DATABASE_TEST") != "1",
    reason="requires the isolated Supabase database created by the migration gate",
)

SPRING_FORWARD = date(2027, 3, 14)  # America/Chicago: 02:00 CST becomes 03:00 CDT
FALL_BACK = date(2027, 11, 7)  # America/Chicago: 02:00 CDT becomes 01:00 CST


@pytest.fixture(scope="module")
def db():
    return get_supabase()


def auth(hotel, user_id, role="housekeeping_supervisor"):
    token = jwt.encode({"sub": user_id, "role": role, "hotel_id": hotel.tenant_id, "aud": "authenticated"},
                       settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def client():
    return TestClient(app)  # not a context manager: leaving the app lifespan would close the shared database client


def world(db):
    """A hotel with a Housekeeping department, one 07:00-15:00 template and three housekeepers."""
    hotel = make_hotel(db, rooms={"r1": {}}, housekeepers=3)
    dept = db.table("departments").insert({"tenant_id": hotel.tenant_id, "name": "Housekeeping", "code": "HK"}).execute().data[0]["id"]
    shift = db.table("shifts").insert({"tenant_id": hotel.tenant_id, "name": "Morning", "department_id": dept,
                                       "start_time": "07:00:00", "end_time": "15:00:00"}).execute().data[0]["id"]
    return hotel, dept, shift


def create(http, hotel, shift, user, day, **times):
    return http.post("/v1/schedules/assignments", headers=auth(hotel, hotel.supervisor),
                     json={"user_id": user, "shift_id": shift, "work_date": day.isoformat(), **times})


def instants(response):
    data = response.json()["data"]
    return data["starts_at"], data["ends_at"]


# --- concurrent supervisors ---------------------------------------------------------------------------------------

def test_two_supervisors_saving_the_same_shift_at_once_commit_exactly_one(db):
    hotel, _dept, shift = world(db)
    day = date.today() + timedelta(days=20)
    row = create(client(), hotel, shift, hotel.housekeepers[0], day).json()["data"]
    barrier, results = threading.Barrier(2), []

    def save(end):
        http = client()
        barrier.wait()
        results.append(http.patch(f"/v1/schedules/assignments/{row['id']}", headers=auth(hotel, hotel.supervisor),
                                  json={"expected_version": row["version"], "end_time": end}))

    threads = [threading.Thread(target=save, args=(end,)) for end in ("14:00", "16:00")]
    [t.start() for t in threads]
    [t.join() for t in threads]

    assert sorted(r.status_code for r in results) == [200, 409]
    loser = next(r for r in results if r.status_code == 409)
    assert "version_conflict" in loser.text
    stored = db.table("shift_assignments").select("version, end_time").eq("id", row["id"]).single().execute().data
    winner = next(r for r in results if r.status_code == 200).json()["data"]
    assert stored["version"] == row["version"] + 1  # one write, not two
    assert stored["end_time"].startswith(winner["end_time"][:5])  # the stored shift is the winner's, not a blend


# --- recurring creation and idempotency ---------------------------------------------------------------------------

def test_a_retried_recurring_bulk_create_writes_nothing_twice(db):
    hotel, _dept, shift = world(db)
    start = date.today() + timedelta(days=21)
    items = [{"user_id": hotel.housekeepers[0], "shift_id": shift, "work_date": (start + timedelta(days=7 * n)).isoformat()} for n in range(6)]
    http = client()

    first = http.post("/v1/schedules/assignments/bulk", headers=auth(hotel, hotel.supervisor), json={"assignments": items})
    again = http.post("/v1/schedules/assignments/bulk", headers=auth(hotel, hotel.supervisor), json={"assignments": items})

    assert first.status_code == 200 and first.json()["data"]["created_count"] == 6
    assert again.status_code == 200
    assert again.json()["data"]["created_count"] == 0 and again.json()["data"]["unchanged_count"] == 6
    rows = db.table("shift_assignments").select("id").eq("tenant_id", hotel.tenant_id).execute().data
    assert len(rows) == 6


def test_one_overlapping_item_rejects_the_whole_recurring_batch(db):
    hotel, _dept, shift = world(db)
    day = date.today() + timedelta(days=22)
    http = client()
    assert create(http, hotel, shift, hotel.housekeepers[0], day, start_time="07:00", end_time="15:00").status_code == 200
    items = [
        {"user_id": hotel.housekeepers[0], "shift_id": shift, "work_date": (day + timedelta(days=1)).isoformat()},
        {"user_id": hotel.housekeepers[0], "shift_id": shift, "work_date": day.isoformat(), "start_time": "12:00", "end_time": "20:00"},
    ]
    refused = http.post("/v1/schedules/assignments/bulk", headers=auth(hotel, hotel.supervisor), json={"assignments": items})

    assert refused.status_code == 409
    assert len(db.table("shift_assignments").select("id").eq("tenant_id", hotel.tenant_id).execute().data) == 1


# --- overnight and daylight-saving shifts -------------------------------------------------------------------------

def test_an_overnight_shift_ends_the_next_morning_in_hotel_time(db):
    hotel, _dept, shift = world(db)
    day = date.today() + timedelta(days=23)
    response = create(client(), hotel, shift, hotel.housekeepers[0], day, start_time="22:00", end_time="06:00")

    assert response.status_code == 200
    stored = db.table("shift_assignments").select("starts_at, ends_at, work_date").eq("id", response.json()["data"]["id"]).single().execute().data
    start, end = (datetime.fromisoformat(stored[k].replace("Z", "+00:00")) for k in ("starts_at", "ends_at"))
    assert (end - start) == timedelta(hours=8)
    assert stored["work_date"] == day.isoformat()  # the shift belongs to the day it starts


@pytest.mark.parametrize("day, start, end, utc_start, utc_end, hours", [
    # Spring forward: the night shift loses an hour (22:00 CST -> 06:00 CDT is 7 elapsed hours).
    (SPRING_FORWARD - timedelta(days=1), "22:00", "06:00", "2027-03-14T04:00:00", "2027-03-14T11:00:00", 7),
    # Fall back: the night shift gains an hour (22:00 CDT -> 06:00 CST is 9 elapsed hours).
    (FALL_BACK - timedelta(days=1), "22:00", "06:00", "2027-11-07T03:00:00", "2027-11-07T12:00:00", 9),
    # A day shift that does not cross the change keeps its length on the change day itself.
    (SPRING_FORWARD, "06:00", "14:00", "2027-03-14T11:00:00", "2027-03-14T19:00:00", 8),
    (FALL_BACK, "06:00", "14:00", "2027-11-07T12:00:00", "2027-11-07T20:00:00", 8),
])
def test_daylight_saving_shifts_are_stored_as_the_real_instants(db, day, start, end, utc_start, utc_end, hours):
    hotel, _dept, shift = world(db)
    response = create(client(), hotel, shift, hotel.housekeepers[0], day, start_time=start, end_time=end)

    assert response.status_code == 200, response.text
    got_start, got_end = instants(response)
    assert got_start.replace("Z", "+00:00").startswith(utc_start) and got_end.replace("Z", "+00:00").startswith(utc_end)
    elapsed = datetime.fromisoformat(got_end.replace("Z", "+00:00")) - datetime.fromisoformat(got_start.replace("Z", "+00:00"))
    assert elapsed == timedelta(hours=hours)


# --- draft versus published visibility ----------------------------------------------------------------------------

def test_a_staged_change_is_invisible_to_the_employee_until_publication(db):
    hotel, dept, shift = world(db)
    employee = hotel.housekeepers[0]
    day = date.today() + timedelta(days=25)
    http = client()

    staged = http.post("/v1/schedules/revisions/changes", headers=auth(hotel, hotel.supervisor), json={
        "kind": "create", "user_id": employee, "shift_id": shift, "work_date": day.isoformat(), "client_key": f"scenario-{uuid.uuid4().hex[:8]}"})
    assert staged.status_code == 200, staged.text
    revision = staged.json()["data"]["revision"]

    def mine():
        return http.get(f"/v1/schedules/assignments/my-schedule?date_from={day}&date_to={day}", headers=auth(hotel, employee, "housekeeper"))

    assert mine().status_code == 200 and mine().json()["data"] == []  # the draft exists, the employee sees nothing
    assert db.table("shift_assignments").select("id").eq("tenant_id", hotel.tenant_id).execute().data == []

    published = http.post(f"/v1/schedules/revisions/{revision['id']}/publish", headers=auth(hotel, hotel.supervisor),
                          json={"idempotency_key": str(uuid.uuid4()), "expected_version": revision["version"], "confirm": True})
    assert published.status_code == 200, published.text
    assert len(mine().json()["data"]) == 1  # visible only now


# --- open-shift announcements -------------------------------------------------------------------------------------

def post_open_shift(http, hotel, shift, day):
    response = http.post("/v1/schedules/open-shifts", headers=auth(hotel, hotel.supervisor),
                         json={"shift_id": shift, "work_date": day.isoformat(), "claimable": True})
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


def announcements(db, hotel, gap_id):
    rows = db.table("schedule_notifications").select("user_id").eq("tenant_id", hotel.tenant_id).eq("event_type", "schedule_open_shift")         .eq("payload->>gap_id", gap_id).execute().data
    return sorted(r["user_id"] for r in rows)


def lose_and_age(db, hotel, gap_id, minutes):
    """Simulates an announcement that never got stored, for a posting made `minutes` ago."""
    db.table("schedule_notifications").delete().eq("tenant_id", hotel.tenant_id).eq("payload->>gap_id", gap_id).execute()
    made = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    db.table("coverage_gaps").update({"created_at": made}).eq("id", gap_id).execute()


def test_a_lost_open_shift_announcement_is_recovered_once_and_only_inside_its_window(db):
    from services.coverage_fill import reconcile_open_shift_announcements

    hotel, _dept, shift = world(db)
    http = client()
    day = date.today() + timedelta(days=6)
    recent, fresh, stale = (post_open_shift(http, hotel, shift, day + timedelta(days=n)) for n in range(3))
    everyone = sorted([*hotel.housekeepers, hotel.supervisor])  # the department's eligible people, the poster included
    assert announcements(db, hotel, recent) == everyone  # the normal path announces

    lose_and_age(db, hotel, recent, minutes=10)  # lost, and old enough to be re-checked
    lose_and_age(db, hotel, fresh, minutes=0)  # lost, but the request path may still be finishing
    lose_and_age(db, hotel, stale, minutes=400)  # lost, but the Open Shifts screen has been the source of truth for hours
    first = reconcile_open_shift_announcements()
    again = reconcile_open_shift_announcements()

    assert announcements(db, hotel, recent) == everyone
    assert announcements(db, hotel, fresh) == [] and announcements(db, hotel, stale) == []
    assert first["failed"] == 0 and first["announced"] >= len(everyone)
    assert again["announced"] == 0  # a repeat run finds nothing left to announce
    assert len(announcements(db, hotel, recent)) == len(set(announcements(db, hotel, recent)))  # one message per person


# --- other features that read the schedule ------------------------------------------------------------------------

def test_a_shift_cancelled_by_a_published_schedule_is_not_counted_as_working_elsewhere(db):
    from routers.housekeeping import _active_housekeepers
    from routers.management_roi import _scheduled_housekeepers_by_date

    hotel, dept, shift = world(db)
    working, cancelled = hotel.housekeepers[0], hotel.housekeepers[1]
    day = date.today() + timedelta(days=9)
    http = client()
    for user in (working, cancelled):
        assert create(http, hotel, shift, user, day).status_code == 200
    row = db.table("shift_assignments").select("id, version").eq("tenant_id", hotel.tenant_id).eq("user_id", cancelled).single().execute().data

    staged = http.post("/v1/schedules/revisions/changes", headers=auth(hotel, hotel.supervisor), json={
        "kind": "cancel", "assignment_id": row["id"], "expected_version": row["version"]})
    assert staged.status_code == 200, staged.text
    revision = staged.json()["data"]["revision"]
    published = http.post(f"/v1/schedules/revisions/{revision['id']}/publish", headers=auth(hotel, hotel.supervisor),
                          json={"idempotency_key": str(uuid.uuid4()), "expected_version": revision["version"], "confirm": True})
    assert published.status_code == 200, published.text

    assert _active_housekeepers(hotel.tenant_id, day) == [working]  # Smart assignment must not plan for the cancelled person
    assert _scheduled_housekeepers_by_date(hotel.tenant_id, dept, [day.isoformat()]) == {day.isoformat(): 1}


def test_the_employee_open_shift_list_decides_exactly_as_checking_each_posting_alone(db):
    from services import coverage_fill as fill
    from services.scheduling_access import load_departments, load_staff

    hotel, _dept, shift = world(db)
    me = hotel.housekeepers[0]
    http = client()
    busy_day, free_day = date.today() + timedelta(days=7), date.today() + timedelta(days=8)
    assert create(http, hotel, shift, me, busy_day).status_code == 200  # already works that day: the posting overlaps
    gaps = [db.table("coverage_gaps").select("*").eq("id", post_open_shift(http, hotel, shift, day)).single().execute().data for day in (busy_day, free_day)]

    departments = load_departments(hotel.tenant_id)
    staff = {me: load_staff(hotel.tenant_id, departments, [me])[me]}
    prefetch = fill.prefetch_user(hotel.tenant_id, me, gaps)
    alone = [fill.evaluate_users(hotel.tenant_id, g, staff, departments)[0].as_dict() for g in gaps]
    batched = [fill.evaluate_users(hotel.tenant_id, g, staff, departments, prefetch)[0].as_dict() for g in gaps]

    assert batched == alone
    assert alone[0]["eligible"] is False and alone[1]["eligible"] is True  # the comparison covers a blocked and an eligible case
