"""Migration 229: request-workflow notification intents are written in the SAME transaction as the business change.

Against the REAL migrated database, never mocks. The failure window this closes: the API used to queue these messages
after its own write committed, so a crash in between lost them. Now the database writes the intent with the change, so a
rolled-back change leaves no message, a committed one cannot lose it, and a replay cannot duplicate it.
"""

import os
import uuid
from datetime import date, timedelta

import pytest
from postgrest.exceptions import APIError

from batch_support import make_hotel
from core.database import get_supabase
from test_coverage_fill import fill, payload, scenario

pytestmark = pytest.mark.skipif(
    os.getenv("MIGRATED_DATABASE_TEST") != "1",
    reason="requires the isolated Supabase database created by the migration gate",
)


@pytest.fixture(scope="module")
def db():
    return get_supabase()


def messages(db, tenant, event=None):
    query = db.table("schedule_notifications").select("event_type, user_id, payload, status, dedupe_key").eq("tenant_id", tenant)
    if event:
        query = query.eq("event_type", event)
    return query.execute().data


def users(rows):
    return {row["user_id"] for row in rows}


def time_off(db, hotel, user, start, **over):
    row = {
        "tenant_id": hotel.tenant_id, "user_id": user, "start_date": start, "end_date": start,
        "starts_at": f"{start}T06:00:00+00:00", "ends_at": f"{start}T23:00:00+00:00", "reason_category": "health", "note": "chemotherapy",
    }
    return db.table("time_off_requests").insert({**row, **over}).execute().data[0]


def test_a_time_off_request_and_its_decision_queue_their_messages_with_the_change(db):
    hotel = make_hotel(db, rooms={"r1": {}}, housekeepers=2)
    employee = hotel.housekeepers[0]
    day = (date.today() + timedelta(days=40)).isoformat()
    request = time_off(db, hotel, employee, day)

    # Managers who cover Housekeeping hear a request exists. The requester and the reason are not part of it.
    asked = messages(db, hotel.tenant_id, "schedule_time_off_requested")
    assert users(asked) == {hotel.supervisor, hotel.gm}
    assert all(set(row["payload"]) == {"request_id"} for row in asked)
    assert "chemotherapy" not in str(asked) and "health" not in str(asked)

    db.table("time_off_requests").update({"status": "approved", "decided_by": hotel.supervisor, "version": 2}).eq("id", request["id"]).execute()
    decided = messages(db, hotel.tenant_id, "schedule_time_off_approved")
    assert [(row["user_id"], row["status"]) for row in decided] == [(employee, "queued")]


def test_deciding_your_own_request_messages_nobody(db):
    hotel = make_hotel(db, rooms={"r1": {}}, housekeepers=1)
    request = time_off(db, hotel, hotel.supervisor, (date.today() + timedelta(days=41)).isoformat())
    db.table("time_off_requests").update({"status": "approved", "decided_by": hotel.supervisor, "version": 2}).eq("id", request["id"]).execute()
    assert messages(db, hotel.tenant_id, "schedule_time_off_approved") == []


def test_a_rolled_back_fill_leaves_no_message_and_a_committed_one_keeps_it(db):
    """fill_coverage_gap() accepts the offer and inserts the replacement in one transaction: an overlap undoes both, and
    with them the 'offer accepted' message; the retry that succeeds queues exactly one."""
    hotel, dept, shift, day, original, absence, gap = scenario(db)
    offerer, offered = hotel.supervisor, hotel.housekeepers[1]
    offer = db.table("coverage_offers").insert({"tenant_id": hotel.tenant_id, "gap_id": gap["id"], "user_id": offered, "offered_by": offerer}).execute().data[0]
    assert users(messages(db, hotel.tenant_id, "schedule_offer_received")) == {offered}   # queued with the offer insert

    early = db.table("shifts").insert({"tenant_id": hotel.tenant_id, "name": "Early", "department_id": dept, "start_time": "06:00:00", "end_time": "14:00:00"}).execute().data[0]["id"]
    blocker = db.table("shift_assignments").insert({"tenant_id": hotel.tenant_id, "user_id": offered, "shift_id": early, "work_date": day}).execute().data[0]

    with pytest.raises(APIError) as refused:
        fill(db, hotel, gap, payload(hotel, shift, dept, day, gap, offered), resolution="offer_accepted", offer=offer["id"])
    assert refused.value.code == "23P01"
    assert messages(db, hotel.tenant_id, "schedule_offer_accepted") == []                 # rolled back with the fill
    assert db.table("coverage_offers").select("status").eq("id", offer["id"]).execute().data[0]["status"] == "pending"

    db.table("shift_assignments").delete().eq("id", blocker["id"]).execute()
    fill(db, hotel, gap, payload(hotel, shift, dept, day, gap, offered), resolution="offer_accepted", offer=offer["id"])
    assert [(row["user_id"], row["payload"]["offer_id"]) for row in messages(db, hotel.tenant_id, "schedule_offer_accepted")] == [(offerer, offer["id"])]


def test_an_approved_swap_messages_both_people_with_the_day_they_now_work(db):
    hotel, dept, shift, day, original, absence, gap = scenario(db)
    a, b = hotel.housekeepers[0], hotel.housekeepers[1]
    other_day = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
    evening = db.table("shifts").insert({"tenant_id": hotel.tenant_id, "name": "Evening", "department_id": dept, "start_time": "15:00:00", "end_time": "23:00:00"}).execute().data[0]["id"]
    theirs = db.table("shift_assignments").insert({"tenant_id": hotel.tenant_id, "user_id": b, "shift_id": evening, "work_date": other_day}).execute().data[0]
    mine = db.table("shift_assignments").insert({"tenant_id": hotel.tenant_id, "user_id": a, "shift_id": evening, "work_date": day}).execute().data[0]
    swap = db.table("shift_swap_requests").insert({
        "tenant_id": hotel.tenant_id, "department_id": dept, "requester_id": a, "counterpart_id": b, "requester_assignment_id": mine["id"],
        "counterpart_assignment_id": theirs["id"], "requester_assignment_version": mine["version"], "counterpart_assignment_version": theirs["version"],
        "expires_at": (date.today() + timedelta(days=5)).isoformat() + "T00:00:00+00:00",
    }).execute().data[0]
    assert users(messages(db, hotel.tenant_id, "schedule_swap_proposed")) == {b}

    db.table("shift_swap_requests").update({"status": "accepted", "version": 2}).eq("id", swap["id"]).execute()
    assert users(messages(db, hotel.tenant_id, "schedule_swap_accepted")) == {a}
    assert users(messages(db, hotel.tenant_id, "schedule_swap_needs_approval")) == {hotel.supervisor, hotel.gm}

    db.rpc("approve_shift_swap", {
        "p_tenant_id": hotel.tenant_id, "p_swap_id": swap["id"], "p_expected_version": 2, "p_actor": hotel.supervisor,
        "p_actor_role": "housekeeping_supervisor", "p_note": None,
    }).execute()
    approved = {row["user_id"]: row["payload"]["work_date"] for row in messages(db, hotel.tenant_id, "schedule_swap_approved")}
    assert approved == {a: other_day, b: day}                                             # each is sent to the shift they now hold


def test_a_replayed_intent_is_stored_once(db):
    hotel = make_hotel(db, rooms={"r1": {}}, housekeepers=1)
    key = str(uuid.uuid4())
    for _ in range(3):
        db.rpc("schedule_notice", {
            "p_tenant": hotel.tenant_id, "p_user": hotel.housekeepers[0], "p_event": "schedule_claim_declined", "p_key": key, "p_payload": {"claim_id": key},
        }).execute()
    assert len(messages(db, hotel.tenant_id, "schedule_claim_declined")) == 1


def test_a_delivery_that_keeps_crashing_the_worker_is_closed_as_failed_not_reclaimed_forever(db):
    hotel = make_hotel(db, rooms={"r1": {}}, housekeepers=1)
    user = hotel.housekeepers[0]
    expired = (date.today() - timedelta(days=1)).isoformat() + "T00:00:00+00:00"
    rows = db.table("schedule_notifications").insert([
        {"tenant_id": hotel.tenant_id, "user_id": user, "event_type": "schedule_published", "dedupe_key": f"k-{uuid.uuid4()}", "status": "processing", "attempts": 5, "locked_until": expired},
        {"tenant_id": hotel.tenant_id, "user_id": user, "event_type": "schedule_published", "dedupe_key": f"k-{uuid.uuid4()}", "status": "processing", "attempts": 2, "locked_until": expired},
    ]).execute().data
    exhausted, retryable = rows[0]["id"], rows[1]["id"]
    claimed = {row["id"] for row in db.rpc("claim_schedule_notifications", {"p_limit": 200, "p_revision_id": None}).execute().data}
    assert retryable in claimed and exhausted not in claimed
    closed = db.table("schedule_notifications").select("status, last_error").eq("id", exhausted).execute().data[0]
    assert closed == {"status": "failed", "last_error": "abandoned_after_crash"}


def test_a_call_out_saves_its_absence_and_gap_together_or_not_at_all(db):
    hotel, dept, shift, day, original, absence, gap = scenario(db)
    other = hotel.housekeepers[1]
    assignment = db.table("shift_assignments").insert({"tenant_id": hotel.tenant_id, "user_id": other, "shift_id": shift, "work_date": (date.fromisoformat(day) + timedelta(days=1)).isoformat()}).execute().data[0]
    absence_row = {
        "user_id": other, "assignment_id": assignment["id"], "department_id": dept, "work_date": assignment["work_date"], "starts_at": assignment["starts_at"],
        "ends_at": assignment["ends_at"], "kind": "called_out", "status": "confirmed", "recorded_by": hotel.supervisor, "idempotency_key": f"key-{uuid.uuid4()}",
    }
    gap_row = {
        "department_id": dept, "shift_id": shift, "shift_name": "Morning", "work_date": assignment["work_date"], "start_time": "07:00:00", "end_time": "15:00:00",
        "starts_at": assignment["starts_at"], "ends_at": assignment["ends_at"], "created_by": hotel.supervisor,
    }

    def record(gap_part):
        return db.rpc("record_absence_with_gap", {"p_tenant_id": hotel.tenant_id, "p_absence": absence_row, "p_gap": gap_part}).execute().data

    with pytest.raises(APIError):
        record({**gap_row, "department_id": None})                                           # the gap cannot be written ...
    assert db.table("absence_records").select("id").eq("assignment_id", assignment["id"]).execute().data == []   # ... so neither is the absence

    saved = record(gap_row)
    assert saved["absence"]["assignment_id"] == assignment["id"] and saved["gap"]["absence_id"] == saved["absence"]["id"] and saved["gap"]["status"] == "open"
    with pytest.raises(APIError) as duplicate:
        record(gap_row)                                                                      # a replay is refused, never a second pair
    assert duplicate.value.code == "23505"
    assert len(db.table("coverage_gaps").select("id").eq("absence_id", saved["absence"]["id"]).execute().data) == 1


def test_an_offer_and_its_gap_move_together_and_a_stale_gap_leaves_no_offer(db):
    hotel, dept, shift, day, original, absence, gap = scenario(db)
    offered = hotel.housekeepers[1]

    def offer(version, user=offered):
        return db.rpc("create_coverage_offer", {
            "p_tenant_id": hotel.tenant_id, "p_gap_id": gap["id"], "p_expected_version": version, "p_user_id": user, "p_offered_by": hotel.supervisor,
            "p_expires_at": (date.today() + timedelta(days=2)).isoformat() + "T00:00:00+00:00",
        }).execute().data

    with pytest.raises(APIError) as stale:
        offer(9)
    assert stale.value.code == "CV001"
    assert db.table("coverage_offers").select("id").eq("gap_id", gap["id"]).execute().data == []
    assert messages(db, hotel.tenant_id, "schedule_offer_received") == []                    # no offer, so nothing to tell or take back

    made = offer(1)
    assert made["status"] == "pending" and made["delivery"] == "not_sent"
    moved = db.table("coverage_gaps").select("status, version").eq("id", gap["id"]).execute().data[0]
    assert moved == {"status": "offered", "version": 2}
    assert users(messages(db, hotel.tenant_id, "schedule_offer_received")) == {offered}

    with pytest.raises(APIError) as duplicate:
        offer(2)
    assert duplicate.value.code == "23505"
    offer(2, hotel.housekeepers[2])                                                          # a second person does not bump the version
    assert db.table("coverage_gaps").select("version").eq("id", gap["id"]).execute().data[0]["version"] == 2
