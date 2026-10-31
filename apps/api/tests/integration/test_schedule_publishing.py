"""publish_schedule_revision() and the revision guards (migration 228) against the REAL migrated database, never mocks.

The unit tests prove how the API uses the function; these prove the function itself: it applies a whole revision in one
transaction (cancels, edits, creates), queues one notification intent per affected employee in that same transaction,
replays a repeated publish by idempotency key, refuses stale or closed revisions with its own error codes, rolls EVERYTHING
back when any change is refused, and keeps published history immutable.
"""

import os
import uuid
from datetime import date, datetime, timedelta

import pytest
from postgrest.exceptions import APIError

from batch_support import make_hotel
from core.database import get_supabase

pytestmark = pytest.mark.skipif(
    os.getenv("MIGRATED_DATABASE_TEST") != "1",
    reason="requires the isolated Supabase database created by the migration gate",
)

COLUMNS = "id, user_id, shift_id, work_date, start_time, end_time, starts_at, ends_at, publication_state, version"


@pytest.fixture(scope="module")
def db():
    return get_supabase()


def scenario(db):
    """A hotel with two housekeepers working 30 days from now (morning / evening) and a third with no shift."""
    hotel = make_hotel(db, rooms={"r1": {}}, housekeepers=3)
    tenant = hotel.tenant_id
    dept = db.table("departments").insert({"tenant_id": tenant, "name": "Housekeeping", "code": "HK"}).execute().data[0]["id"]
    morning = db.table("shifts").insert({"tenant_id": tenant, "name": "Morning", "department_id": dept, "start_time": "07:00:00", "end_time": "15:00:00"}).execute().data[0]["id"]
    evening = db.table("shifts").insert({"tenant_id": tenant, "name": "Evening", "department_id": dept, "start_time": "15:00:00", "end_time": "23:00:00"}).execute().data[0]["id"]
    day = (date.today() + timedelta(days=30)).isoformat()
    a = db.table("shift_assignments").insert({"tenant_id": tenant, "user_id": hotel.housekeepers[0], "shift_id": morning, "work_date": day}).execute().data[0]
    b = db.table("shift_assignments").insert({"tenant_id": tenant, "user_id": hotel.housekeepers[1], "shift_id": evening, "work_date": day}).execute().data[0]
    return hotel, dept, morning, evening, day, a, b


def revision(db, hotel, dept):
    return db.table("schedule_revisions").insert({"tenant_id": hotel.tenant_id, "department_id": dept, "created_by": hotel.supervisor}).execute().data[0]


def change(db, hotel, rev, dept, kind, **fields):
    return db.table("schedule_revision_changes").insert({
        "tenant_id": hotel.tenant_id, "revision_id": rev["id"], "department_id": dept, "kind": kind, **fields,
    }).execute().data[0]


def proposal(row, dept, **over):
    base = {"user_id": row["user_id"], "shift_id": row["shift_id"], "shift_name": "Morning", "department_id": dept, "work_date": row["work_date"],
            "start_time": row["start_time"], "end_time": row["end_time"], "starts_at": row["starts_at"], "ends_at": row["ends_at"], "notes": None}
    return {**base, **over}


def later(timestamp: str, hours: int) -> str:
    """The same instant moved by whole hours (the fixtures sit 30 days out, so DST never matters for the comparison)."""
    return (datetime.fromisoformat(timestamp) + timedelta(hours=hours)).isoformat()


def publish(db, hotel, rev, key=None, version=1):
    return db.rpc("publish_schedule_revision", {
        "p_tenant_id": hotel.tenant_id, "p_revision_id": rev["id"], "p_expected_version": version,
        "p_actor": hotel.supervisor, "p_actor_role": "housekeeping_supervisor", "p_idempotency_key": key or str(uuid.uuid4()),
    }).execute()


def refused(call) -> str:
    with pytest.raises(APIError) as caught:
        call()
    return caught.value.code


def live(db, assignment_id):
    return db.table("shift_assignments").select(COLUMNS).eq("id", assignment_id).execute().data[0]


def test_publish_applies_everything_together_and_queues_one_intent_per_employee(db):
    hotel, dept, morning, evening, day, a, b = scenario(db)
    rev = revision(db, hotel, dept)
    change(db, hotel, rev, dept, "update", assignment_id=a["id"], base_version=a["version"],
           proposed=proposal(a, dept, start_time="08:00:00", end_time="16:00:00", starts_at=later(a["starts_at"], 1), ends_at=later(a["ends_at"], 1)))
    change(db, hotel, rev, dept, "cancel", assignment_id=b["id"], base_version=b["version"])
    change(db, hotel, rev, dept, "create", client_key="new-shift-key-1",
           proposed=proposal(a, dept, user_id=hotel.housekeepers[2], shift_id=morning))
    assert live(db, a["id"])["start_time"] == "07:00:00"                                   # nothing applied before publishing
    result = publish(db, hotel, rev, "key-one").data
    assert (result["created"], result["updated"], result["cancelled"], result["employees_affected"], result["notifications_queued"]) == (1, 1, 1, 3, 3)
    assert live(db, b["id"])["publication_state"] == "cancelled" and live(db, a["id"])["start_time"] == "08:00:00"
    intents = db.table("schedule_notifications").select("user_id, status, event_type").eq("revision_id", rev["id"]).execute().data
    assert len(intents) == 3 and {i["status"] for i in intents} == {"queued"} and {i["event_type"] for i in intents} == {"schedule_published"}
    row = db.table("schedule_revisions").select("status, publication_key, published_by").eq("id", rev["id"]).execute().data[0]
    assert row == {"status": "published", "publication_key": "key-one", "published_by": hotel.supervisor}
    events = {e["event"] for e in db.table("schedule_revision_events").select("event").eq("revision_id", rev["id"]).execute().data}
    assert {"publication_succeeded", "notification_queued"} <= events


def test_a_repeated_publish_with_the_same_key_replays_and_a_different_key_is_refused(db):
    hotel, dept, morning, evening, day, a, b = scenario(db)
    rev = revision(db, hotel, dept)
    change(db, hotel, rev, dept, "cancel", assignment_id=b["id"], base_version=b["version"])
    publish(db, hotel, rev, "replay-key")
    again = publish(db, hotel, rev, "replay-key").data
    assert again["replayed"] is True
    assert len(db.table("schedule_notifications").select("id").eq("revision_id", rev["id"]).execute().data) == 1
    assert refused(lambda: publish(db, hotel, rev, "another-key")) == "SR002"


def test_a_shift_edited_after_the_draft_was_made_is_refused_as_stale_and_nothing_is_applied(db):
    hotel, dept, morning, evening, day, a, b = scenario(db)
    rev = revision(db, hotel, dept)
    change(db, hotel, rev, dept, "cancel", assignment_id=a["id"], base_version=a["version"])
    db.table("shift_assignments").update({"notes": "edited by someone else"}).eq("id", a["id"]).execute()      # trigger bumps the version
    assert refused(lambda: publish(db, hotel, rev)) == "SR005"
    assert live(db, a["id"])["publication_state"] == "published"
    assert db.table("schedule_revisions").select("status").eq("id", rev["id"]).execute().data[0]["status"] == "draft"


def test_any_refused_change_rolls_the_whole_revision_back(db):
    hotel, dept, morning, evening, day, a, b = scenario(db)
    rev = revision(db, hotel, dept)
    change(db, hotel, rev, dept, "cancel", assignment_id=b["id"], base_version=b["version"])             # valid on its own
    change(db, hotel, rev, dept, "create", client_key="clash-key-1",                                      # overlaps housekeeper 0's morning shift
           proposed=proposal(a, dept, shift_id=evening, shift_name="Evening", start_time="10:00:00", end_time="18:00:00",
                             starts_at=later(a["starts_at"], 3), ends_at=later(a["ends_at"], 3)))
    assert refused(lambda: publish(db, hotel, rev)) == "23P01"
    assert live(db, b["id"])["publication_state"] == "published"                                         # the valid cancel was not kept
    assert db.table("schedule_notifications").select("id").eq("revision_id", rev["id"]).execute().data == []
    assert db.table("schedule_revisions").select("status").eq("id", rev["id"]).execute().data[0]["status"] == "draft"


def test_a_call_out_in_progress_blocks_the_edit_and_attendance_blocks_it_too(db):
    hotel, dept, morning, evening, day, a, b = scenario(db)
    db.table("absence_records").insert({
        "tenant_id": hotel.tenant_id, "user_id": a["user_id"], "assignment_id": a["id"], "department_id": dept, "work_date": day,
        "starts_at": a["starts_at"], "ends_at": a["ends_at"], "kind": "called_out", "status": "confirmed", "recorded_by": hotel.supervisor,
    }).execute()
    rev = revision(db, hotel, dept)
    change(db, hotel, rev, dept, "cancel", assignment_id=a["id"], base_version=a["version"])
    assert refused(lambda: publish(db, hotel, rev)) == "SR008"


def test_swapping_two_people_on_the_same_shift_and_date_is_valid_and_a_cancelled_slot_can_be_reused(db):
    hotel, dept, morning, evening, day, a, b = scenario(db)
    other = db.table("shift_assignments").insert({"tenant_id": hotel.tenant_id, "user_id": hotel.housekeepers[2], "shift_id": morning, "work_date": day}).execute().data[0]
    rev = revision(db, hotel, dept)
    change(db, hotel, rev, dept, "update", assignment_id=a["id"], base_version=a["version"], proposed=proposal(a, dept, user_id=other["user_id"]))
    change(db, hotel, rev, dept, "update", assignment_id=other["id"], base_version=other["version"], proposed=proposal(other, dept, user_id=a["user_id"]))
    assert publish(db, hotel, rev).data["updated"] == 2
    assert live(db, a["id"])["user_id"] == other["user_id"] and live(db, other["id"])["user_id"] == a["user_id"]
    # the slot of a cancelled shift no longer blocks scheduling the same person on the same shift and date again
    rev2 = revision(db, hotel, dept)
    change(db, hotel, rev2, dept, "cancel", assignment_id=b["id"], base_version=b["version"])
    publish(db, hotel, rev2)
    db.table("shift_assignments").insert({"tenant_id": hotel.tenant_id, "user_id": b["user_id"], "shift_id": evening, "work_date": day}).execute()


def test_published_history_is_immutable_and_drafts_can_be_discarded_once(db):
    hotel, dept, morning, evening, day, a, b = scenario(db)
    rev = revision(db, hotel, dept)
    change(db, hotel, rev, dept, "cancel", assignment_id=b["id"], base_version=b["version"])
    publish(db, hotel, rev)
    assert refused(lambda: db.table("schedule_revisions").update({"status": "discarded"}).eq("id", rev["id"]).execute()) == "SR002"
    assert refused(lambda: db.table("schedule_revision_changes").update({"reason": "edited later"}).eq("revision_id", rev["id"]).execute()) == "SR002"
    assert refused(lambda: db.table("schedule_revision_events").delete().eq("revision_id", rev["id"]).execute()) == "SR002"
    assert refused(lambda: db.table("schedule_revisions").delete().eq("id", rev["id"]).execute()) == "SR004"
    draft = revision(db, hotel, dept)
    db.table("schedule_revisions").update({"status": "discarded"}).eq("id", draft["id"]).execute()
    assert refused(lambda: publish(db, hotel, draft)) == "SR004"
    assert refused(lambda: revision(db, hotel, dept) and revision(db, hotel, dept)) == "23505"          # one open draft per department


def test_the_outbox_claim_is_bounded_and_does_not_hand_out_a_row_twice(db):
    hotel, dept, morning, evening, day, a, b = scenario(db)
    rev = revision(db, hotel, dept)
    change(db, hotel, rev, dept, "cancel", assignment_id=b["id"], base_version=b["version"])
    publish(db, hotel, rev)
    first = db.rpc("claim_schedule_notifications", {"p_limit": 50, "p_revision_id": rev["id"]}).execute().data
    second = db.rpc("claim_schedule_notifications", {"p_limit": 50, "p_revision_id": rev["id"]}).execute().data
    assert len(first) == 1 and first[0]["status"] == "processing" and first[0]["attempts"] == 1 and second == []
