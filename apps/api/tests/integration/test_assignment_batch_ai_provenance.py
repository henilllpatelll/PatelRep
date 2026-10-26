"""publish_assignment_batch (migration 222): per-change AI provenance, against the REAL migrated database.

Smart Balance publishes through the same atomic function as every other bulk assignment. These tests prove the one
thing migration 222 adds: a change is recorded as an AI suggestion only when the app says it is an untouched
recommendation, one publication can carry both kinds without being split, and nothing else about the function changed.
"""

import os

import pytest

from batch_support import audit_count, change, dated, make_hotel, operation_count, publish, refused, seed_dated, snapshot
from core.database import get_supabase

pytestmark = pytest.mark.skipif(
    os.getenv("MIGRATED_DATABASE_TEST") != "1",
    reason="requires the isolated Supabase database created by the migration gate",
)


@pytest.fixture(scope="module")
def db():
    return get_supabase()


def _audit_new_state(db, hotel, name):
    rows = db.table("operational_audit_events").select("new_state").eq("tenant_id", hotel.tenant_id).eq("resource_id", hotel.rooms[name]).execute().data
    assert len(rows) == 1
    return rows[0]["new_state"]


def test_one_atomic_publication_records_each_changes_own_provenance(db):
    hotel = make_hotel(db)
    a, b = hotel.housekeepers[:2]
    seed_dated(db, hotel, "r3", a)
    result = publish(
        db,
        hotel,
        [
            change(hotel.rooms["r1"], "assign", a, ai=True),
            change(hotel.rooms["r2"], "assign", b),  # the supervisor's own choice
            change(hotel.rooms["r3"], "reassign", b, expected=a, ai=True),
        ],
    )
    assert result["status"] == "committed" and result["counts"]["total"] == 3
    assert dated(db, hotel, "r1")["is_ai_suggested"] is True
    assert dated(db, hotel, "r2")["is_ai_suggested"] is False
    assert dated(db, hotel, "r3")["is_ai_suggested"] is True and dated(db, hotel, "r3")["assigned_to"] == b
    assert _audit_new_state(db, hotel, "r1")["is_ai_suggested"] is True
    assert "is_ai_suggested" not in _audit_new_state(db, hotel, "r2")  # a manual change keeps its migration-221 shape
    by_room = {row["room_id"]: row for row in result["rooms"]}
    assert by_room[hotel.rooms["r1"]]["is_ai_suggested"] is True and "is_ai_suggested" not in by_room[hotel.rooms["r2"]]
    assert operation_count(db, hotel) == 1


def test_a_request_without_the_flag_behaves_exactly_as_before(db):
    hotel = make_hotel(db)
    a = hotel.housekeepers[0]
    publish(db, hotel, [change(hotel.rooms["r1"], "assign", a)])
    assert dated(db, hotel, "r1")["is_ai_suggested"] is False


def test_a_removal_can_never_be_an_ai_suggestion_and_nothing_is_written(db):
    hotel = make_hotel(db)
    a = hotel.housekeepers[0]
    seed_dated(db, hotel, "r1", a)
    before = snapshot(db, hotel)
    bad = change(hotel.rooms["r1"], "remove", expected=a)
    bad["is_ai_suggested"] = True
    error = refused(db, hotel, [bad])
    assert error.code == "P0422" and error.message == "invalid_request"
    assert snapshot(db, hotel) == before


def test_the_same_operation_with_changed_provenance_is_a_different_request(db):
    hotel = make_hotel(db)
    a = hotel.housekeepers[0]
    operation = "11111111-1111-4111-8111-111111111111"
    publish(db, hotel, [change(hotel.rooms["r1"], "assign", a, ai=True)], operation_id=operation)
    replay = publish(db, hotel, [change(hotel.rooms["r1"], "assign", a, ai=True)], operation_id=operation)
    assert replay["replayed"] is True
    error = refused(db, hotel, [change(hotel.rooms["r1"], "assign", a)], operation_id=operation)
    assert error.code == "P0409" and error.message == "operation_id_reused"
    assert dated(db, hotel, "r1")["is_ai_suggested"] is True  # the refusal changed nothing


def test_a_refused_mixed_batch_leaves_no_ai_row_behind(db):
    hotel = make_hotel(db)
    a, b = hotel.housekeepers[:2]
    seed_dated(db, hotel, "r2", a)
    before = snapshot(db, hotel)
    error = refused(db, hotel, [change(hotel.rooms["r1"], "assign", a, ai=True), change(hotel.rooms["r2"], "assign", b, ai=True)])
    assert error.code == "P0409"  # r2 is already owned: a stale expectation
    assert snapshot(db, hotel) == before
    assert dated(db, hotel, "r1") is None
    assert audit_count(db, hotel, "r1") == 0
