"""fill_coverage_gap() (migration 226) against the REAL migrated database, never mocks.

The unit tests prove how the API uses the function; these prove the function itself: it fills a gap atomically
(replacement shift + gap + absence + offers + claims move together or not at all), refuses a stale or already-resolved
gap with its own error codes, and rolls EVERYTHING back when the replacement overlaps another shift.
"""

import os
import uuid
from datetime import date, timedelta

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


def scenario(db):
    """A hotel where housekeeper 0 is called out of the morning shift 30 days from now, with an open gap behind it."""
    hotel = make_hotel(db, rooms={"r1": {}}, housekeepers=3)
    tenant = hotel.tenant_id
    dept = db.table("departments").insert({"tenant_id": tenant, "name": "Housekeeping", "code": "HK"}).execute().data[0]["id"]
    shift = db.table("shifts").insert({"tenant_id": tenant, "name": "Morning", "department_id": dept, "start_time": "07:00:00", "end_time": "15:00:00"}).execute().data[0]["id"]
    day = (date.today() + timedelta(days=30)).isoformat()
    original = db.table("shift_assignments").insert({"tenant_id": tenant, "user_id": hotel.housekeepers[0], "shift_id": shift, "work_date": day}).execute().data[0]
    absence = db.table("absence_records").insert({
        "tenant_id": tenant, "user_id": hotel.housekeepers[0], "assignment_id": original["id"], "department_id": dept, "work_date": day,
        "starts_at": original["starts_at"], "ends_at": original["ends_at"], "kind": "called_out", "status": "confirmed", "recorded_by": hotel.supervisor,
    }).execute().data[0]
    gap = db.table("coverage_gaps").insert({
        "tenant_id": tenant, "department_id": dept, "source": "absence", "absence_id": absence["id"], "original_assignment_id": original["id"],
        "shift_id": shift, "shift_name": "Morning", "work_date": day, "start_time": "07:00:00", "end_time": "15:00:00",
        "starts_at": original["starts_at"], "ends_at": original["ends_at"], "status": "open",
    }).execute().data[0]
    return hotel, dept, shift, day, original, absence, gap


def payload(hotel, shift, dept, day, gap, user):
    return {
        "user_id": user, "shift_id": shift, "work_date": day, "shift_name": "Morning", "department_id": dept,
        "start_time": "07:00:00", "end_time": "15:00:00", "starts_at": gap["starts_at"], "ends_at": gap["ends_at"], "notes": None,
    }


def fill(db, hotel, gap, assignment, *, version=1, resolution="direct_assignment", offer=None, claim=None):
    return db.rpc("fill_coverage_gap", {
        "p_tenant_id": hotel.tenant_id, "p_gap_id": gap["id"], "p_expected_version": version, "p_assignment": assignment,
        "p_resolution": resolution, "p_offer_id": offer, "p_claim_id": claim, "p_actor": hotel.supervisor,
    }).execute()


def rows(db, table, **where):
    query = db.table(table).select("*")
    for key, value in where.items():
        query = query.eq(key, value)
    return query.execute().data


def test_a_fill_moves_the_replacement_gap_absence_offers_and_claims_together(db):
    hotel, dept, shift, day, original, absence, gap = scenario(db)
    yes, other = hotel.housekeepers[1], hotel.housekeepers[2]
    offer = db.table("coverage_offers").insert({"tenant_id": hotel.tenant_id, "gap_id": gap["id"], "user_id": yes, "status": "pending", "offered_by": hotel.supervisor}).execute().data[0]
    spare = db.table("coverage_offers").insert({"tenant_id": hotel.tenant_id, "gap_id": gap["id"], "user_id": other, "status": "pending", "offered_by": hotel.supervisor}).execute().data[0]
    claim = db.table("coverage_claims").insert({"tenant_id": hotel.tenant_id, "gap_id": gap["id"], "user_id": other, "status": "pending"}).execute().data[0]

    result = fill(db, hotel, gap, payload(hotel, shift, dept, day, gap, yes), resolution="offer_accepted", offer=offer["id"])
    assignment_id = result.data["assignment_id"] if isinstance(result.data, dict) else result.data[0]["assignment_id"]

    replacement = rows(db, "shift_assignments", id=assignment_id)[0]
    assert (replacement["user_id"], replacement["start_time"], replacement["end_time"], replacement["publication_state"]) == (yes, "07:00:00", "15:00:00", "published")
    assert replacement["starts_at"] == gap["starts_at"] and replacement["ends_at"] == gap["ends_at"]
    filled = rows(db, "coverage_gaps", id=gap["id"])[0]
    assert (filled["status"], filled["resolution"], filled["filled_user_id"], filled["filled_assignment_id"], filled["version"]) == ("filled", "offer_accepted", yes, assignment_id, 2)
    assert rows(db, "absence_records", id=absence["id"])[0]["status"] == "covered"
    assert rows(db, "coverage_offers", id=offer["id"])[0]["status"] == "accepted"
    assert rows(db, "coverage_offers", id=spare["id"])[0]["status"] == "superseded"
    assert rows(db, "coverage_claims", id=claim["id"])[0]["status"] == "declined"
    # The plan's history is untouched: the called-out person's own shift is still there, unchanged.
    assert rows(db, "shift_assignments", id=original["id"])[0]["user_id"] == hotel.housekeepers[0]


def error_code(call):
    with pytest.raises(APIError) as exc:
        call()
    return exc.value.code


def test_a_stale_version_and_an_already_resolved_gap_are_refused_with_their_own_codes(db):
    hotel, dept, shift, day, _original, _absence, gap = scenario(db)
    candidate = payload(hotel, shift, dept, day, gap, hotel.housekeepers[1])
    assert error_code(lambda: fill(db, hotel, gap, candidate, version=7)) == "CV001"
    assert rows(db, "coverage_gaps", id=gap["id"])[0]["status"] == "open"
    fill(db, hotel, gap, candidate)
    assert error_code(lambda: fill(db, hotel, gap, payload(hotel, shift, dept, day, gap, hotel.housekeepers[2]), version=2)) == "CV002"
    assert len(rows(db, "shift_assignments", shift_id=shift, work_date=day)) == 2   # the original + exactly one replacement
    unknown = {**gap, "id": str(uuid.uuid4())}
    assert error_code(lambda: fill(db, hotel, unknown, candidate)) == "CV003"


def test_an_overlapping_replacement_rolls_everything_back(db):
    hotel, dept, shift, day, _original, absence, gap = scenario(db)
    busy = hotel.housekeepers[1]
    other_shift = db.table("shifts").insert({"tenant_id": hotel.tenant_id, "name": "Mid", "department_id": dept, "start_time": "10:00:00", "end_time": "18:00:00"}).execute().data[0]["id"]
    db.table("shift_assignments").insert({"tenant_id": hotel.tenant_id, "user_id": busy, "shift_id": other_shift, "work_date": day}).execute()
    offer = db.table("coverage_offers").insert({"tenant_id": hotel.tenant_id, "gap_id": gap["id"], "user_id": busy, "status": "pending", "offered_by": hotel.supervisor}).execute().data[0]

    assert error_code(lambda: fill(db, hotel, gap, payload(hotel, shift, dept, day, gap, busy), resolution="offer_accepted", offer=offer["id"])) == "23P01"
    assert rows(db, "coverage_gaps", id=gap["id"])[0]["status"] == "open"
    assert rows(db, "absence_records", id=absence["id"])[0]["status"] == "confirmed"
    assert rows(db, "coverage_offers", id=offer["id"])[0]["status"] == "pending"
    assert [r["user_id"] for r in rows(db, "shift_assignments", shift_id=shift, work_date=day)] == [hotel.housekeepers[0]]


def test_one_live_call_out_per_shift_and_one_live_gap_per_call_out(db):
    hotel, dept, _shift, day, original, absence, gap = scenario(db)
    duplicate_absence = {
        "tenant_id": hotel.tenant_id, "user_id": hotel.housekeepers[0], "assignment_id": original["id"], "department_id": dept, "work_date": day,
        "starts_at": original["starts_at"], "ends_at": original["ends_at"], "kind": "emergency", "status": "confirmed",
    }
    assert error_code(lambda: db.table("absence_records").insert(duplicate_absence).execute()) == "23505"
    duplicate_gap = {k: v for k, v in gap.items() if k not in ("id", "created_at", "updated_at")}
    assert error_code(lambda: db.table("coverage_gaps").insert(duplicate_gap).execute()) == "23505"
    pending = {"tenant_id": hotel.tenant_id, "gap_id": gap["id"], "user_id": hotel.housekeepers[1], "status": "pending"}
    db.table("coverage_offers").insert(pending).execute()
    assert error_code(lambda: db.table("coverage_offers").insert(pending).execute()) == "23505"
    assert absence["status"] == "confirmed"
