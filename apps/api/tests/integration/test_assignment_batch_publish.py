"""publish_assignment_batch (migration 221) against the REAL migrated database.

These tests are the proof that publication is atomic: they read the tables back after every refusal and assert
that NOTHING changed (no assignment row, no status mirror, no audit row, no idempotency record) - something a
mocked service cannot show. Runs only against the isolated Supabase stack created by the migration gate.
"""

import json
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from postgrest.exceptions import APIError

from batch_support import (
    audit_count,
    change,
    conflicts_of,
    dated,
    hotel_today,
    make_hotel,
    mirror,
    new_client,
    operation_count,
    psql_available,
    publish,
    refused,
    run_sql,
    seed_dated,
    snapshot,
    start_sql,
)
from core.database import get_supabase

pytestmark = pytest.mark.skipif(
    os.getenv("MIGRATED_DATABASE_TEST") != "1",
    reason="requires the isolated Supabase database created by the migration gate",
)

needs_psql = pytest.mark.skipif(not psql_available(), reason="needs psql (DB_URL) or PSQL_DOCKER_CONTAINER")


def hotel_now():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc)


@pytest.fixture(scope="module")
def db():
    return get_supabase()


# ─── Commit: every change, together ──────────────────────────────────────────────────────────────────────────

def test_all_valid_assignments_commit_together(db):
    hotel = make_hotel(db)
    a, b = hotel.housekeepers[:2]
    result = publish(db, hotel, [change(hotel.rooms["r1"], "assign", a), change(hotel.rooms["r2"], "assign", a), change(hotel.rooms["r3"], "assign", b)])

    assert result["status"] == "committed" and result["replayed"] is False
    assert result["counts"] == {"total": 3, "assign": 3, "reassign": 0, "remove": 0}
    assert sorted(result["affected_room_ids"]) == sorted(hotel.room_ids("r1", "r2", "r3"))
    for name, owner in (("r1", a), ("r2", a), ("r3", b)):
        assert dated(db, hotel, name)["assigned_to"] == owner
        assert dated(db, hotel, name)["assigned_by"] == hotel.supervisor
        assert mirror(db, hotel, name)["assigned_to"] == owner
    assert dated(db, hotel, "r4") is None and mirror(db, hotel, "r4")["assigned_to"] is None
    assert operation_count(db, hotel) == 1


def test_mixed_assign_reassign_and_remove_commit_together(db):
    hotel = make_hotel(db)
    a, b, c = hotel.housekeepers
    seed_dated(db, hotel, "r2", a)  # dated + mirror
    seed_dated(db, hotel, "r3", a)

    result = publish(
        db,
        hotel,
        [
            change(hotel.rooms["r1"], "assign", b),
            change(hotel.rooms["r2"], "reassign", c, expected=a),
            change(hotel.rooms["r3"], "remove", expected=a),
        ],
    )
    assert result["counts"] == {"total": 3, "assign": 1, "reassign": 1, "remove": 1}
    assert dated(db, hotel, "r1")["assigned_to"] == b and mirror(db, hotel, "r1")["assigned_to"] == b
    assert dated(db, hotel, "r2")["assigned_to"] == c and mirror(db, hotel, "r2")["assigned_to"] == c
    assert dated(db, hotel, "r3") is None and mirror(db, hotel, "r3")["assigned_to"] is None
    by_room = {row["room_id"]: row for row in result["rooms"]}
    assert by_room[hotel.rooms["r2"]]["previous_assigned_to"] == a and by_room[hotel.rooms["r2"]]["assigned_to"] == c
    assert sorted(result["affected_housekeeper_ids"]) == sorted([a, b, c])


def test_mirror_only_ownership_is_reassigned_and_removed_correctly(db):
    hotel = make_hotel(db)
    a, b = hotel.housekeepers[:2]
    seed_dated(db, hotel, "r1", a, mirror_too=False)  # dated only: owner a through the dated row
    db.table("room_status").update({"assigned_to": a}).eq("room_id", hotel.rooms["r2"]).execute()  # mirror only
    db.table("room_status").update({"assigned_to": a}).eq("room_id", hotel.rooms["r3"]).execute()  # mirror only

    publish(
        db,
        hotel,
        [
            change(hotel.rooms["r1"], "reassign", b, expected=a),
            change(hotel.rooms["r2"], "reassign", b, expected=a),
            change(hotel.rooms["r3"], "remove", expected=a),
        ],
    )
    assert dated(db, hotel, "r1")["assigned_to"] == b and mirror(db, hotel, "r1")["assigned_to"] == b
    # A mirror-only reassignment gains a dated row; a mirror-only removal clears the mirror.
    assert dated(db, hotel, "r2")["assigned_to"] == b and mirror(db, hotel, "r2")["assigned_to"] == b
    assert dated(db, hotel, "r3") is None and mirror(db, hotel, "r3")["assigned_to"] is None


def test_cleaning_type_and_status_are_preserved(db):
    hotel = make_hotel(db, rooms={"dep": {"clean_type": "DEP"}, "full": {"clean_type": "FULL", "status": "PICKUP"}, "occ": {"status": "OCCUPIED"}})
    a, b = hotel.housekeepers[:2]
    seed_dated(db, hotel, "full", a, clean_type="FULL")

    publish(db, hotel, [change(hotel.rooms["dep"], "assign", a), change(hotel.rooms["full"], "reassign", b, expected=a), change(hotel.rooms["occ"], "assign", b)])

    assert dated(db, hotel, "dep")["clean_type"] == "DEP"
    assert dated(db, hotel, "full")["clean_type"] == "FULL"  # reassign keeps the existing row's type
    assert (mirror(db, hotel, "full")["status"], mirror(db, hotel, "full")["clean_type"]) == ("PICKUP", "FULL")
    assert mirror(db, hotel, "occ")["status"] == "OCCUPIED"
    assert mirror(db, hotel, "dep")["status"] == "DIRTY"


def test_reassign_clears_the_ai_flag_and_walking_order(db):
    hotel = make_hotel(db)
    a, b = hotel.housekeepers[:2]
    db.table("room_assignments").insert(
        {"tenant_id": hotel.tenant_id, "room_id": hotel.rooms["r1"], "assigned_to": a, "assigned_by": hotel.supervisor, "assignment_date": hotel_today().isoformat(), "is_ai_suggested": True, "sequence_order": 3}
    ).execute()
    db.table("room_status").update({"assigned_to": a}).eq("room_id", hotel.rooms["r1"]).execute()
    publish(db, hotel, [change(hotel.rooms["r1"], "reassign", b, expected=a)])
    row = dated(db, hotel, "r1")
    assert row["assigned_to"] == b and row["is_ai_suggested"] is False and row["sequence_order"] is None


# ─── Refuse: all or nothing ──────────────────────────────────────────────────────────────────────────────────

def test_a_conflict_on_the_last_room_commits_nothing_for_the_earlier_ones(db):
    hotel = make_hotel(db)
    a, b = hotel.housekeepers[:2]
    ordered = sorted(hotel.rooms.values())
    last = ordered[-1]
    last_name = next(name for name, rid in hotel.rooms.items() if rid == last)
    seed_dated(db, hotel, last_name, b)  # the supervisor believes it is unassigned: stale
    before = snapshot(db, hotel)

    error = refused(db, hotel, [change(rid, "assign", a) for rid in ordered])

    assert error.code == "P0409" and error.message == "assignment_batch_conflict"
    assert [(c["room_id"], c["code"]) for c in conflicts_of(error)] == [(last, "assignment_changed")]
    assert conflicts_of(error)[0]["current_assigned_to"] == b
    assert snapshot(db, hotel) == before  # no assignment row, no mirror, no audit row, no idempotency record


def test_every_problem_is_reported_not_just_the_first(db):
    hotel = make_hotel(db, rooms={"ok": {}, "started": {"status": "IN_PROGRESS"}, "dnd": {"dnd_flag": True}, "declined": {"do_not_service": True}, "owned": {}})
    a, b = hotel.housekeepers[:2]
    seed_dated(db, hotel, "owned", b)
    error = refused(
        db,
        hotel,
        [change(hotel.rooms[n], "assign", a) for n in ("ok", "started", "dnd", "declined", "owned")],
    )
    codes = {c["room_id"]: c["code"] for c in conflicts_of(error)}
    assert codes == {
        hotel.rooms["started"]: "room_not_assignable",
        hotel.rooms["dnd"]: "room_blocked",
        hotel.rooms["declined"]: "room_blocked",
        hotel.rooms["owned"]: "assignment_changed",
    }
    assert next(c for c in conflicts_of(error) if c["room_id"] == hotel.rooms["dnd"])["blocks"] == ["dnd"]


@pytest.mark.parametrize(
    "overrides,blocks",
    [
        ({"dnd_retry_at": "future"}, ["return_later"]),
        ({"dnd_flag": True, "do_not_service": True}, ["service_declined", "dnd"]),
    ],
)
def test_soft_blocked_rooms_are_refused_and_never_silently_included(db, overrides, blocks):
    hotel = make_hotel(db, rooms={"x": {}})
    if overrides.get("dnd_retry_at") == "future":
        overrides = {"dnd_retry_at": (hotel_now() + timedelta(hours=2)).isoformat()}
    db.table("room_status").update(overrides).eq("room_id", hotel.rooms["x"]).execute()
    error = refused(db, hotel, [change(hotel.rooms["x"], "assign", hotel.housekeepers[0])])
    assert conflicts_of(error)[0]["blocks"] == blocks
    assert dated(db, hotel, "x") is None


def test_an_open_occupancy_discrepancy_blocks_assignment_but_not_removal(db):
    hotel = make_hotel(db, rooms={"d": {}, "e": {}})
    a = hotel.housekeepers[0]
    seed_dated(db, hotel, "e", a)
    for name in ("d", "e"):
        db.table("room_occupancy_discrepancies").insert({"tenant_id": hotel.tenant_id, "room_id": hotel.rooms[name], "status": "open", "housekeeping_observed": "vacant", "reported_by": a}).execute()
    error = refused(db, hotel, [change(hotel.rooms["d"], "assign", a)])
    assert conflicts_of(error)[0]["blocks"] == ["occupancy_discrepancy"]
    publish(db, hotel, [change(hotel.rooms["e"], "remove", expected=a)])  # taking work off a room is always allowed
    assert dated(db, hotel, "e") is None


@pytest.mark.parametrize("status", ["IN_PROGRESS", "CLEAN", "INSPECTED", "OOO"])
def test_a_room_past_dirty_is_never_dispatched_or_taken_back(db, status):
    hotel = make_hotel(db, rooms={"x": {}})
    a = hotel.housekeepers[0]
    seed_dated(db, hotel, "x", a)
    db.table("room_status").update({"status": status}).eq("room_id", hotel.rooms["x"]).execute()
    before = snapshot(db, hotel)
    for changes in ([change(hotel.rooms["x"], "reassign", hotel.housekeepers[1], expected=a)], [change(hotel.rooms["x"], "remove", expected=a)]):
        assert conflicts_of(refused(db, hotel, changes))[0]["code"] == "room_not_assignable"
    assert snapshot(db, hotel) == before


def test_duplicate_room_changes_are_rejected(db):
    hotel = make_hotel(db)
    a, b = hotel.housekeepers[:2]
    error = refused(db, hotel, [change(hotel.rooms["r1"], "assign", a), change(hotel.rooms["r1"], "assign", b)])
    assert (error.code, error.message) == ("P0422", "invalid_request")
    assert json.loads(error.details)["reason"] == "duplicate_room"
    assert dated(db, hotel, "r1") is None


@pytest.mark.parametrize(
    "bad",
    [
        {"kind": "assign", "housekeeper_id": None, "expected_assigned_to": None, "expect_unassigned": True},
        {"kind": "assign", "housekeeper_id": "hk", "expected_assigned_to": "hk", "expect_unassigned": True},
        {"kind": "assign", "housekeeper_id": "hk", "expected_assigned_to": None, "expect_unassigned": False},
        {"kind": "reassign", "housekeeper_id": "hk", "expected_assigned_to": None, "expect_unassigned": False},
        {"kind": "reassign", "housekeeper_id": "hk", "expected_assigned_to": "hk", "expect_unassigned": False},
        {"kind": "remove", "housekeeper_id": "hk", "expected_assigned_to": "hk", "expect_unassigned": False},
        {"kind": "remove", "housekeeper_id": None, "expected_assigned_to": None, "expect_unassigned": True},
        {"kind": "swap", "housekeeper_id": "hk", "expected_assigned_to": None, "expect_unassigned": True},
    ],
)
def test_contradictory_or_malformed_changes_are_rejected(db, bad):
    hotel = make_hotel(db, rooms={"x": {}})
    hk = hotel.housekeepers[0]
    item = {"room_id": hotel.rooms["x"], **{k: (hk if v == "hk" else v) for k, v in bad.items()}}
    error = refused(db, hotel, [item])
    assert error.code == "P0422"
    assert dated(db, hotel, "x") is None


def test_unparseable_payloads_are_rejected_not_half_read(db):
    hotel = make_hotel(db, rooms={"x": {}})
    for payload in ([], [{"room_id": "not-a-uuid", "kind": "assign"}], [{"kind": "assign"}], {"not": "an array"}, [1, 2]):
        assert refused(db, hotel, payload).code == "P0422"
    assert operation_count(db, hotel) == 0


def test_more_than_the_documented_limit_is_rejected(db):
    hotel = make_hotel(db, rooms={"x": {}})
    too_many = [change(str(uuid.uuid4()), "assign", hotel.housekeepers[0]) for _ in range(151)]
    error = refused(db, hotel, too_many)
    assert json.loads(error.details) == {"reason": "too_many_changes", "max": 150}


# ─── Tenancy and authorisation ───────────────────────────────────────────────────────────────────────────────

def test_a_room_of_another_hotel_is_refused_and_looks_like_a_missing_room(db):
    mine = make_hotel(db)
    theirs = make_hotel(db)
    error = refused(db, mine, [change(mine.rooms["r1"], "assign", mine.housekeepers[0]), change(theirs.rooms["r1"], "assign", mine.housekeepers[0])])
    assert [(c["room_id"], c["code"]) for c in conflicts_of(error)] == [(theirs.rooms["r1"], "room_not_found")]
    assert dated(db, theirs, "r1") is None and mirror(db, theirs, "r1")["assigned_to"] is None
    assert dated(db, mine, "r1") is None  # and nothing of mine was written either


def test_an_employee_of_another_hotel_is_refused(db):
    mine = make_hotel(db)
    theirs = make_hotel(db)
    error = refused(db, mine, [change(mine.rooms["r1"], "assign", theirs.housekeepers[0])])
    assert conflicts_of(error)[0]["code"] == "invalid_housekeeper"
    assert dated(db, mine, "r1") is None


def test_an_inactive_or_non_housekeeping_employee_is_refused(db):
    hotel = make_hotel(db, housekeepers=2)
    inactive, active = hotel.housekeepers
    db.table("user_roles").update({"is_active": False}).eq("user_id", inactive).execute()
    for target in (inactive, hotel.gm):  # a GM is not a housekeeping employee
        assert conflicts_of(refused(db, hotel, [change(hotel.rooms["r1"], "assign", target)]))[0]["code"] == "invalid_housekeeper"
    publish(db, hotel, [change(hotel.rooms["r1"], "assign", active)])


def test_a_supervisor_may_be_assigned_work_like_the_legacy_endpoint_allows(db):
    hotel = make_hotel(db)
    publish(db, hotel, [change(hotel.rooms["r1"], "assign", hotel.supervisor)])
    assert dated(db, hotel, "r1")["assigned_to"] == hotel.supervisor


def test_only_a_gm_or_housekeeping_supervisor_may_publish(db):
    hotel = make_hotel(db)
    other = make_hotel(db)
    changes = [change(hotel.rooms["r1"], "assign", hotel.housekeepers[0])]
    for actor in (hotel.housekeepers[1], other.supervisor, str(uuid.uuid4())):
        assert refused(db, hotel, changes, actor=actor).code == "P0403"
    publish(db, hotel, changes, actor=hotel.gm)  # a GM may
    assert dated(db, hotel, "r1") is not None


def test_a_deactivated_supervisor_may_not_publish(db):
    hotel = make_hotel(db)
    db.table("user_roles").update({"is_active": False}).eq("user_id", hotel.supervisor).execute()
    assert refused(db, hotel, [change(hotel.rooms["r1"], "assign", hotel.housekeepers[0])]).code == "P0403"


def test_the_function_is_not_callable_by_client_roles(db):
    from supabase import create_client

    from core.config import settings

    if not os.environ.get("ANON_KEY"):
        pytest.skip("ANON_KEY not exported")
    hotel = make_hotel(db, rooms={"x": {}})
    anon = create_client(settings.supabase_project_url, os.environ["ANON_KEY"])
    with pytest.raises(APIError) as caught:
        anon.rpc("publish_assignment_batch", {"p_tenant_id": hotel.tenant_id, "p_actor_id": hotel.supervisor, "p_operation_id": str(uuid.uuid4()), "p_date": hotel_today().isoformat(), "p_changes": [change(hotel.rooms["x"], "assign", hotel.housekeepers[0])]}).execute()
    assert caught.value.code in {"42501", "PGRST202"}  # permission denied (or hidden)
    assert dated(db, hotel, "x") is None


def test_the_idempotency_table_is_closed_to_client_roles(db):
    from supabase import create_client

    from core.config import settings

    if not os.environ.get("ANON_KEY"):
        pytest.skip("ANON_KEY not exported")
    anon = create_client(settings.supabase_project_url, os.environ["ANON_KEY"])
    try:
        rows = anon.table("assignment_batch_operations").select("id").limit(1).execute().data
        assert rows == []  # RLS with no policy: nothing is readable
    except APIError as error:
        assert error.code == "42501"


# ─── The operating date ──────────────────────────────────────────────────────────────────────────────────────

def test_only_the_hotels_own_today_may_be_published(db):
    hotel = make_hotel(db)
    for day in (hotel_today() - timedelta(days=1), hotel_today() + timedelta(days=1)):
        error = refused(db, hotel, [change(hotel.rooms["r1"], "assign", hotel.housekeepers[0])], on=day)
        assert error.message == "date_mismatch"
        assert json.loads(error.details)["expected_date"] == hotel_today().isoformat()
    assert dated(db, hotel, "r1") is None
    assert operation_count(db, hotel) == 0


# ─── Audit ───────────────────────────────────────────────────────────────────────────────────────────────────

def test_audit_rows_exist_only_for_committed_changes(db):
    hotel = make_hotel(db)
    a, b = hotel.housekeepers[:2]
    seed_dated(db, hotel, "r2", a)
    stale = [change(hotel.rooms["r1"], "assign", a), change(hotel.rooms["r2"], "reassign", b, expected=b)]
    refused(db, hotel, stale)
    assert audit_count(db, hotel, "r1") == 0 and audit_count(db, hotel, "r2") == 0

    op = str(uuid.uuid4())
    publish(db, hotel, [change(hotel.rooms["r1"], "assign", a), change(hotel.rooms["r2"], "reassign", b, expected=a)], operation_id=op)
    rows = db.table("operational_audit_events").select("action, actor_id, actor_role, old_state, new_state, source").eq("tenant_id", hotel.tenant_id).execute().data
    by_action = {r["action"]: r for r in rows}
    assert set(by_action) == {"housekeeping.assignment.assigned", "housekeeping.assignment.reassigned"}
    reassigned = by_action["housekeeping.assignment.reassigned"]
    assert reassigned["actor_id"] == hotel.supervisor and reassigned["actor_role"] == "housekeeping_supervisor" and reassigned["source"] == "api"
    assert reassigned["old_state"]["assigned_to"] == a and reassigned["new_state"] == {"assigned_to": b, "assignment_date": hotel_today().isoformat(), "operation_id": op}


# ─── Idempotency ─────────────────────────────────────────────────────────────────────────────────────────────

def test_the_same_operation_and_payload_is_safe_to_repeat(db):
    hotel = make_hotel(db)
    a, b = hotel.housekeepers[:2]
    op = str(uuid.uuid4())
    changes = [change(hotel.rooms["r1"], "assign", a), change(hotel.rooms["r2"], "assign", a)]
    first = publish(db, hotel, changes, operation_id=op)
    after_first = snapshot(db, hotel)

    # The world moves on: someone else takes r1. A retry of the committed operation must not undo that.
    db.table("room_assignments").update({"assigned_to": b}).eq("room_id", hotel.rooms["r1"]).execute()
    db.table("room_status").update({"assigned_to": b}).eq("room_id", hotel.rooms["r1"]).execute()
    moved_on = snapshot(db, hotel)

    again = publish(db, hotel, list(reversed(changes)), operation_id=op)  # request order is not part of the identity
    assert again["replayed"] is True and first["replayed"] is False
    assert {k: v for k, v in again.items() if k != "replayed"} == {k: v for k, v in first.items() if k != "replayed"}
    assert snapshot(db, hotel) == moved_on != after_first
    assert operation_count(db, hotel) == 1 and audit_count(db, hotel, "r1") == 1


def test_a_committed_operation_replays_even_after_the_hotel_day_rolls_over(db):
    hotel = make_hotel(db)
    op = str(uuid.uuid4())
    changes = [change(hotel.rooms["r1"], "assign", hotel.housekeepers[0])]
    publish(db, hotel, changes, operation_id=op)
    # Pretend the retry arrives after midnight: the stored row is the answer, not the date check.
    db.table("assignment_batch_operations").update({"assignment_date": (hotel_today() - timedelta(days=1)).isoformat()}).eq("operation_id", op).execute()
    assert publish(db, hotel, changes, operation_id=op)["replayed"] is True


def test_the_same_operation_id_with_different_changes_is_refused(db):
    hotel = make_hotel(db)
    a, b = hotel.housekeepers[:2]
    op = str(uuid.uuid4())
    publish(db, hotel, [change(hotel.rooms["r1"], "assign", a)], operation_id=op)
    before = snapshot(db, hotel)
    for different in ([change(hotel.rooms["r1"], "assign", b)], [change(hotel.rooms["r2"], "assign", a)], [change(hotel.rooms["r1"], "assign", a), change(hotel.rooms["r2"], "assign", a)]):
        error = refused(db, hotel, different, operation_id=op)
        assert (error.code, error.message) == ("P0409", "operation_id_reused")
    assert snapshot(db, hotel) == before


def test_another_person_cannot_replay_or_probe_an_operation(db):
    hotel = make_hotel(db)
    op = str(uuid.uuid4())
    changes = [change(hotel.rooms["r1"], "assign", hotel.housekeepers[0])]
    publish(db, hotel, changes, operation_id=op)
    assert refused(db, hotel, changes, operation_id=op, actor=hotel.gm).message == "operation_id_reused"


def test_operation_ids_are_scoped_per_hotel(db):
    one, two = make_hotel(db), make_hotel(db)
    op = str(uuid.uuid4())
    publish(db, one, [change(one.rooms["r1"], "assign", one.housekeepers[0])], operation_id=op)
    result = publish(db, two, [change(two.rooms["r1"], "assign", two.housekeepers[0])], operation_id=op)
    assert result["replayed"] is False and dated(db, two, "r1") is not None


def test_a_refused_operation_leaves_no_record_so_it_can_be_corrected_and_resent(db):
    hotel = make_hotel(db)
    a, b = hotel.housekeepers[:2]
    op = str(uuid.uuid4())
    seed_dated(db, hotel, "r1", b)
    refused(db, hotel, [change(hotel.rooms["r1"], "assign", a)], operation_id=op)
    assert operation_count(db, hotel) == 0
    # The same operation id, now correctly expecting the real owner, commits.
    assert publish(db, hotel, [change(hotel.rooms["r1"], "reassign", a, expected=b)], operation_id=op)["replayed"] is False


def test_concurrent_duplicates_commit_exactly_once(db):
    hotel = make_hotel(db)
    a = hotel.housekeepers[0]
    op = str(uuid.uuid4())
    changes = [change(hotel.rooms[n], "assign", a) for n in ("r1", "r2", "r3")]

    def attempt(_):
        return publish(new_client(), hotel, changes, operation_id=op)

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(attempt, range(8)))
    assert sum(1 for r in results if r["replayed"] is False) == 1
    assert sum(1 for r in results if r["replayed"] is True) == 7
    assert operation_count(db, hotel) == 1
    assert all(audit_count(db, hotel, n) == 1 for n in ("r1", "r2", "r3"))


# ─── Concurrency ─────────────────────────────────────────────────────────────────────────────────────────────

def test_concurrent_publications_for_one_room_never_silently_overwrite_each_other(db):
    hotel = make_hotel(db, rooms={"x": {}})
    hks = hotel.housekeepers

    def attempt(hk):
        try:
            return ("ok", publish(new_client(), hotel, [change(hotel.rooms["x"], "assign", hk)]))
        except APIError as error:
            return ("conflict", error)

    with ThreadPoolExecutor(max_workers=len(hks)) as pool:
        results = list(pool.map(attempt, hks))
    winners = [hk for hk, (kind, _) in zip(hks, results) if kind == "ok"]
    assert len(winners) == 1  # exactly one commit; every other saw the winner's owner as a conflict
    for kind, error in results:
        if kind == "conflict":
            assert conflicts_of(error)[0]["code"] == "assignment_changed" and conflicts_of(error)[0]["current_assigned_to"] == winners[0]
    assert dated(db, hotel, "x")["assigned_to"] == winners[0] == mirror(db, hotel, "x")["assigned_to"]
    assert audit_count(db, hotel, "x") == 1


def test_overlapping_batches_in_opposite_order_never_deadlock(db):
    hotel = make_hotel(db, rooms={f"r{i}": {} for i in range(1, 7)})
    a, b = hotel.housekeepers[:2]
    ids = list(hotel.rooms.values())

    def attempt(args):
        hk, order = args
        try:
            publish(new_client(), hotel, [change(rid, "assign", hk) for rid in order])
            return "ok"
        except APIError as error:
            return error.code

    jobs = [(a, ids), (b, list(reversed(ids))), (a, ids[1:] + ids[:1]), (b, ids[3:] + ids[:3])] * 3
    with ThreadPoolExecutor(max_workers=8) as pool:
        outcomes = list(pool.map(attempt, jobs))
    assert set(outcomes) <= {"ok", "P0409"}  # a commit or a clean conflict - never a deadlock (40P01) or a 500
    assert "ok" in outcomes
    owners = {mirror(db, hotel, n)["assigned_to"] for n in hotel.rooms}
    # Whatever won, each batch was applied whole: every room has the same owner as its dated row.
    assert all(dated(db, hotel, n)["assigned_to"] == mirror(db, hotel, n)["assigned_to"] for n in hotel.rooms)
    assert owners <= {a, b}


@needs_psql
def test_a_cleaner_starting_the_room_during_publication_is_never_overridden(db):
    """A real second session holds the room's row lock, as a cleaner starting the room would, then commits
    IN_PROGRESS. The publication must wait for that lock and then REFUSE - not dispatch a room that has started."""
    hotel = make_hotel(db, rooms={"x": {}, "y": {}})
    a = hotel.housekeepers[0]
    holder = start_sql(
        f"BEGIN; SELECT 1 FROM public.room_status WHERE room_id = '{hotel.rooms['x']}' FOR UPDATE; "
        f"SELECT pg_sleep(3); UPDATE public.room_status SET status = 'IN_PROGRESS' WHERE room_id = '{hotel.rooms['x']}'; COMMIT;"
    )
    time.sleep(1.2)  # the holder has the lock
    began = time.monotonic()
    error = refused(new_client(), hotel, [change(hotel.rooms["x"], "assign", a), change(hotel.rooms["y"], "assign", a)])
    waited = time.monotonic() - began
    holder.wait(timeout=30)

    assert waited > 1.0  # it queued on the lock instead of racing past it
    assert [(c["room_id"], c["code"]) for c in conflicts_of(error)] == [(hotel.rooms["x"], "room_not_assignable")]
    assert dated(db, hotel, "x") is None and dated(db, hotel, "y") is None  # y, which was fine, was not published either
    assert mirror(db, hotel, "x")["status"] == "IN_PROGRESS" and mirror(db, hotel, "x")["assigned_to"] is None


@needs_psql
def test_a_mirror_only_owner_change_during_publication_is_a_conflict_not_a_lost_update(db):
    """A mirror-only room has no dated row to guard the write, so the room_status row lock is the protection. A second
    session holds that lock and commits a NEW owner; the publication (expecting the old owner) must wait, re-read and
    refuse - the newer owner must never be overwritten."""
    hotel = make_hotel(db, rooms={"x": {}})
    a, b, c = hotel.housekeepers
    db.table("room_status").update({"assigned_to": a}).eq("room_id", hotel.rooms["x"]).execute()
    holder = start_sql(
        f"BEGIN; SELECT 1 FROM public.room_status WHERE room_id = '{hotel.rooms['x']}' FOR UPDATE; "
        f"SELECT pg_sleep(3); UPDATE public.room_status SET assigned_to = '{c}' WHERE room_id = '{hotel.rooms['x']}'; COMMIT;"
    )
    time.sleep(1.2)
    error = refused(new_client(), hotel, [change(hotel.rooms["x"], "reassign", b, expected=a)])
    holder.wait(timeout=30)

    assert [(c_["code"], c_["current_assigned_to"]) for c_ in conflicts_of(error)] == [("assignment_changed", c)]
    assert mirror(db, hotel, "x")["assigned_to"] == c and dated(db, hotel, "x") is None


@needs_psql
def test_a_failure_after_earlier_writes_rolls_every_earlier_write_back(db):
    """Validation passes, then the LAST room's write fails inside the transaction (an injected trigger). The earlier
    rooms' rows, mirrors and audit rows - already written within the function - must vanish with it."""
    hotel = make_hotel(db)
    a = hotel.housekeepers[0]
    ordered = sorted(hotel.rooms.values())
    suffix = uuid.uuid4().hex[:8]
    fn = f"batch_test_fail_{suffix}"
    run_sql(
        f"CREATE FUNCTION public.{fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
        f"IF NEW.room_id = '{ordered[-1]}' AND (SELECT count(*) FROM public.room_assignments WHERE tenant_id = NEW.tenant_id) = {len(ordered) - 1} "
        f"THEN RAISE EXCEPTION 'injected failure on the last room' USING ERRCODE = '23514'; END IF; RETURN NEW; END $$;"
        f"CREATE TRIGGER {fn} BEFORE INSERT ON public.room_assignments FOR EACH ROW EXECUTE FUNCTION public.{fn}();"
    )
    try:
        before = snapshot(db, hotel)
        with pytest.raises(APIError) as caught:
            publish(db, hotel, [change(rid, "assign", a) for rid in ordered])
        assert caught.value.code == "23514"
        # The trigger fires only when the earlier rooms' rows already exist inside the transaction, so reaching this
        # error proves they were written first - and that they are gone now.
        assert snapshot(db, hotel) == before
        assert all(dated(db, hotel, n) is None and mirror(db, hotel, n)["assigned_to"] is None for n in hotel.rooms)
    finally:
        run_sql(f"DROP TRIGGER {fn} ON public.room_assignments; DROP FUNCTION public.{fn}();")
    # With the fault gone the very same batch commits.
    assert publish(db, hotel, [change(rid, "assign", a) for rid in ordered])["counts"]["total"] == len(ordered)


@needs_psql
def test_a_unique_violation_from_a_racing_insert_is_a_conflict_not_an_overwrite(db):
    """Another writer creates the dated row between our validation and our INSERT (simulated by a trigger that
    inserts it first). The batch must raise a conflict and commit nothing."""
    hotel = make_hotel(db)
    a, b = hotel.housekeepers[:2]
    ordered = sorted(hotel.rooms.values())
    racing = ordered[-1]
    fn = f"batch_test_race_{uuid.uuid4().hex[:8]}"
    run_sql(
        f"CREATE FUNCTION public.{fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
        f"IF NEW.room_id = '{racing}' AND NEW.assigned_to = '{a}' THEN "
        f"INSERT INTO public.room_assignments(tenant_id, room_id, assigned_to, assigned_by, assignment_date) VALUES (NEW.tenant_id, NEW.room_id, '{b}', NEW.assigned_by, NEW.assignment_date); END IF; RETURN NEW; END $$;"
        f"CREATE TRIGGER {fn} BEFORE INSERT ON public.room_assignments FOR EACH ROW EXECUTE FUNCTION public.{fn}();"
    )
    try:
        before = snapshot(db, hotel)
        error = refused(db, hotel, [change(rid, "assign", a) for rid in ordered])
        assert error.code == "P0409" and conflicts_of(error)[0] == {"room_id": racing, "code": "assignment_changed"}
        assert snapshot(db, hotel) == before
    finally:
        run_sql(f"DROP TRIGGER {fn} ON public.room_assignments; DROP FUNCTION public.{fn}();")
