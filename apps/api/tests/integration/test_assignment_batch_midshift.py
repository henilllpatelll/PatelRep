"""Midshift recovery (Supervisor Assignments V2 phase 7) through the REAL atomic publication function.

Phase 7 adds no database function of its own: "Reassign remaining work" stages ordinary reassignments into the
unpublished draft and publishes them through `publish_assignment_batch` (migrations 221/222). These tests pin the
properties that make that safe for a person who left early with work in every stage - the work that can move moves
together or not at all, and the work that cannot move keeps its owner whatever the client sent.
"""

import os
import uuid

import pytest

from batch_support import audit_count, change, conflicts_of, dated, make_hotel, mirror, operation_count, publish, refused, seed_dated, snapshot
from core.database import get_supabase

pytestmark = pytest.mark.skipif(
    os.getenv("MIGRATED_DATABASE_TEST") != "1",
    reason="requires the isolated Supabase database created by the migration gate",
)

MOVABLE = ["u1", "u2", "u3", "u4", "u5", "u6"]


@pytest.fixture(scope="module")
def db():
    return get_supabase()


def left_early_hotel(db):
    """A person (housekeepers[0]) who leaves with nine rooms: six unstarted (the last one mirror-only), one being cleaned,
    one submitted for inspection, one inspected."""
    rooms = {name: {} for name in MOVABLE}
    rooms.update({"cleaning": {"status": "IN_PROGRESS"}, "submitted": {"status": "CLEAN"}, "inspected": {"status": "INSPECTED"}})
    hotel = make_hotel(db, rooms=rooms, housekeepers=3)
    source = hotel.housekeepers[0]
    for name in MOVABLE[:-1]:
        seed_dated(db, hotel, name, source)
    db.table("room_status").update({"assigned_to": source}).eq("room_id", hotel.rooms["u6"]).execute()  # mirror-only ownership
    for name in ("cleaning", "submitted", "inspected"):
        seed_dated(db, hotel, name, source)
    return hotel, source


def recovery(hotel, source, receivers, names=MOVABLE):
    return [change(hotel.rooms[name], "reassign", receivers[index % len(receivers)], expected=source) for index, name in enumerate(names)]


def test_the_unstarted_work_moves_together_and_the_protected_work_keeps_its_owner(db):
    hotel, source = left_early_hotel(db)
    receivers = hotel.housekeepers[1:]
    result = publish(db, hotel, recovery(hotel, source, receivers))

    assert result["counts"] == {"total": 6, "assign": 0, "reassign": 6, "remove": 0}
    for index, name in enumerate(MOVABLE):
        owner = receivers[index % len(receivers)]
        assert dated(db, hotel, name)["assigned_to"] == owner, name  # mirror-only u6 gained a dated row
        assert mirror(db, hotel, name)["assigned_to"] == owner, name
    # Completed, submitted and in-progress rooms are exactly as they were: still the source's, status untouched.
    for name, status in (("cleaning", "IN_PROGRESS"), ("submitted", "CLEAN"), ("inspected", "INSPECTED")):
        assert dated(db, hotel, name)["assigned_to"] == source, name
        assert mirror(db, hotel, name)["assigned_to"] == source and mirror(db, hotel, name)["status"] == status, name
    assert sorted(result["affected_housekeeper_ids"]) == sorted([source, *receivers])


def test_it_is_a_human_decision_in_the_audit_trail_and_a_retry_adds_nothing(db):
    hotel, source = left_early_hotel(db)
    receivers = hotel.housekeepers[1:]
    operation = str(uuid.uuid4())
    changes = recovery(hotel, source, receivers)
    first = publish(db, hotel, changes, operation_id=operation)

    rows = db.table("operational_audit_events").select("action, actor_id, old_state, new_state").eq("tenant_id", hotel.tenant_id).execute().data
    assert len(rows) == 6 and {row["action"] for row in rows} == {"housekeeping.assignment.reassigned"}
    for row in rows:
        assert row["actor_id"] == hotel.supervisor
        assert row["old_state"]["assigned_to"] == source  # who the work came from
        assert row["new_state"]["operation_id"] == operation and row["new_state"]["assigned_to"] in receivers
        assert "is_ai_suggested" not in row["new_state"]  # a supervisor's own decision, never labelled AI
    for name in MOVABLE:
        assert dated(db, hotel, name)["is_ai_suggested"] is False

    again = publish(db, hotel, list(reversed(changes)), operation_id=operation)
    assert again["replayed"] is True and first["replayed"] is False
    assert operation_count(db, hotel) == 1
    assert all(audit_count(db, hotel, name) == 1 for name in MOVABLE)


def test_sending_the_room_being_cleaned_refuses_the_whole_recovery(db):
    hotel, source = left_early_hotel(db)
    receivers = hotel.housekeepers[1:]
    before = snapshot(db, hotel)
    changes = recovery(hotel, source, receivers) + [change(hotel.rooms["cleaning"], "reassign", receivers[0], expected=source)]

    error = refused(db, hotel, changes)

    assert [c["code"] for c in conflicts_of(error)] == ["room_not_assignable"]
    assert conflicts_of(error)[0]["room_id"] == hotel.rooms["cleaning"]
    assert snapshot(db, hotel) == before  # none of the six legitimate moves was applied either


@pytest.mark.parametrize("protected", ["submitted", "inspected"])
def test_finished_rooms_cannot_be_moved_by_a_client_that_includes_them(db, protected):
    hotel, source = left_early_hotel(db)
    before = snapshot(db, hotel)
    changes = recovery(hotel, source, hotel.housekeepers[1:]) + [change(hotel.rooms[protected], "reassign", hotel.housekeepers[1], expected=source)]
    assert conflicts_of(refused(db, hotel, changes))[0]["code"] == "room_not_assignable"
    assert snapshot(db, hotel) == before


def test_a_room_someone_else_took_meanwhile_rejects_every_move_and_names_the_room(db):
    hotel, source = left_early_hotel(db)
    receivers = hotel.housekeepers[1:]
    changes = recovery(hotel, source, receivers)
    # Another supervisor moves u3 to the second receiver after this plan was prepared.
    db.table("room_assignments").update({"assigned_to": receivers[1]}).eq("room_id", hotel.rooms["u3"]).execute()
    db.table("room_status").update({"assigned_to": receivers[1]}).eq("room_id", hotel.rooms["u3"]).execute()
    before = snapshot(db, hotel)

    error = refused(db, hotel, changes)

    assert [(c["room_id"], c["code"]) for c in conflicts_of(error)] == [(hotel.rooms["u3"], "assignment_changed")]
    assert snapshot(db, hotel) == before
    assert operation_count(db, hotel) == 0  # a refused operation leaves no record, so a corrected plan can be sent


def test_a_housekeeper_of_another_hotel_can_never_receive_the_work(db):
    hotel, source = left_early_hotel(db)
    other, _ = left_early_hotel(db)
    before = snapshot(db, hotel)
    changes = recovery(hotel, source, [other.housekeepers[1]])
    refused(db, hotel, changes)
    assert snapshot(db, hotel) == before
