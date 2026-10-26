"""Phase 9 audit additions for publish_assignment_batch (migrations 221/222), against the REAL migrated database.

Gaps found while auditing the Phase 5-7 suites:
  * reassignment racing a removal (and another reassignment) for the SAME room was never exercised;
  * a supervisor of ANOTHER hotel acting on this hotel (a forged tenant/actor pair) was not tested;
  * only the `anon` role was checked against the function and the idempotency table, but real signed-in users carry
    the `authenticated` role - their (absent) access is what actually matters.

Runs only against the isolated Supabase stack created by the migration gate, like the neighbouring modules.
"""

import os
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from postgrest.exceptions import APIError

from batch_support import audit_count, change, conflicts_of, dated, make_hotel, mirror, new_client, psql_available, publish, run_sql, seed_dated
from core.database import get_supabase

pytestmark = pytest.mark.skipif(
    os.getenv("MIGRATED_DATABASE_TEST") != "1",
    reason="requires the isolated Supabase database created by the migration gate",
)

needs_psql = pytest.mark.skipif(not psql_available(), reason="needs psql (DB_URL) or PSQL_DOCKER_CONTAINER")

FUNCTION = "public.publish_assignment_batch(uuid, uuid, uuid, date, jsonb)"


@pytest.fixture(scope="module")
def db():
    return get_supabase()


def test_reassign_and_remove_racing_on_one_room_commit_exactly_one(db):
    """Three supervisors act on a room all of them saw as owned by hk0: two reassign it, one removes it. Exactly one
    commit may win; the rest must be told the room changed, and the dated row, the status mirror and the audit trail
    must all describe the winner and nobody else. Repeated on fresh rooms because a race is only evidence in bulk."""
    for _ in range(6):
        hotel = make_hotel(db, rooms={"x": {}}, housekeepers=3)
        owner, other_a, other_b = hotel.housekeepers
        seed_dated(db, hotel, "x", owner)
        room = hotel.rooms["x"]
        actions = {
            "reassign_a": [change(room, "reassign", other_a, expected=owner)],
            "reassign_b": [change(room, "reassign", other_b, expected=owner)],
            "remove": [change(room, "remove", None, expected=owner)],
        }

        def attempt(name):
            try:
                publish(new_client(), hotel, actions[name])
                return name, None
            except APIError as error:
                return name, error

        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(attempt, list(actions)))

        winners = [name for name, error in results if error is None]
        assert len(winners) == 1, f"expected exactly one winner, got {winners}"
        for name, error in results:
            if error is not None:
                assert error.code == "P0409", f"{name}: a lost race must be a clean conflict, not {error.code}"
                assert conflicts_of(error)[0]["code"] == "assignment_changed"

        winner = winners[0]
        if winner == "remove":
            assert dated(db, hotel, "x") is None
            assert mirror(db, hotel, "x")["assigned_to"] is None
        else:
            expected_owner = other_a if winner == "reassign_a" else other_b
            assert dated(db, hotel, "x")["assigned_to"] == expected_owner
            assert mirror(db, hotel, "x")["assigned_to"] == expected_owner
        assert audit_count(db, hotel, "x") == 1  # one committed change, one audit row - the losers left none


def test_a_supervisor_of_another_hotel_cannot_act_on_this_hotel(db):
    """The API supplies the tenant and the acting user from the verified session, but the function must not rely on
    that: a real supervisor of hotel B paired with hotel A's id has no role in hotel A and is refused."""
    mine = make_hotel(db, rooms={"x": {}})
    theirs = make_hotel(db, rooms={"y": {}})
    with pytest.raises(APIError) as caught:
        publish(db, mine, [change(mine.rooms["x"], "assign", mine.housekeepers[0])], actor=theirs.supervisor)
    assert caught.value.code == "P0403"
    assert dated(db, mine, "x") is None
    assert mirror(db, mine, "x")["assigned_to"] is None
    assert audit_count(db, mine, "x") == 0


def test_a_gm_of_another_hotel_cannot_reuse_an_operation_id_to_read_or_replay(db):
    """An operation id is scoped to its hotel AND person: the same id from another hotel's GM is a different, fresh
    operation (it neither replays nor collides), and cannot reach the first hotel's rooms."""
    mine = make_hotel(db, rooms={"x": {}})
    theirs = make_hotel(db, rooms={"y": {}})
    operation = str(uuid.uuid4())
    first = publish(db, mine, [change(mine.rooms["x"], "assign", mine.housekeepers[0])], operation_id=operation)
    assert first["replayed"] is False
    with pytest.raises(APIError) as caught:  # hotel B's GM sends hotel A's room under the shared id
        publish(db, theirs, [change(mine.rooms["x"], "assign", theirs.housekeepers[0])], operation_id=operation, actor=theirs.gm)
    assert caught.value.code == "P0409"
    assert conflicts_of(caught.value)[0]["code"] == "room_not_found"  # hotel A's room is invisible to hotel B
    assert dated(db, mine, "x")["assigned_to"] == mine.housekeepers[0]


@needs_psql
def test_signed_in_and_anonymous_roles_hold_no_privilege_on_the_function(db):
    """PostgREST gives a signed-in user the `authenticated` role. Neither it, `anon`, nor PUBLIC may execute the
    function (the API's service role, which supplies the verified tenant and actor, is the only caller)."""
    run_sql(
        f"""
        DO $$
        DECLARE bad text;
        BEGIN
          SELECT string_agg(coalesce(r.rolname, 'PUBLIC'), ',') INTO bad
          FROM pg_proc p
          CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          LEFT JOIN pg_roles r ON r.oid = a.grantee
          WHERE p.oid = '{FUNCTION}'::regprocedure
            AND a.privilege_type = 'EXECUTE'
            AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated'));
          IF bad IS NOT NULL THEN
            RAISE EXCEPTION 'publish_assignment_batch is executable by: %', bad;
          END IF;
          IF has_function_privilege('authenticated', '{FUNCTION}', 'EXECUTE')
             OR has_function_privilege('anon', '{FUNCTION}', 'EXECUTE') THEN
            RAISE EXCEPTION 'a client role can execute publish_assignment_batch';
          END IF;
          IF NOT has_function_privilege('service_role', '{FUNCTION}', 'EXECUTE') THEN
            RAISE EXCEPTION 'service_role must be able to execute publish_assignment_batch';
          END IF;
        END $$;
        """
    )


@needs_psql
def test_the_function_is_not_security_definer_and_pins_its_search_path(db):
    """SECURITY INVOKER with a pinned search_path: the function can never run with more rights than its caller, and a
    caller-controlled search_path cannot redirect its table references."""
    run_sql(
        f"""
        DO $$
        DECLARE p pg_proc%ROWTYPE;
        BEGIN
          SELECT * INTO p FROM pg_proc WHERE oid = '{FUNCTION}'::regprocedure;
          IF p.prosecdef THEN RAISE EXCEPTION 'publish_assignment_batch must not be SECURITY DEFINER'; END IF;
          IF p.proconfig IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%') THEN
            RAISE EXCEPTION 'publish_assignment_batch must pin its search_path';
          END IF;
        END $$;
        """
    )


@needs_psql
def test_client_roles_hold_no_privilege_on_the_idempotency_table(db):
    run_sql(
        """
        DO $$
        DECLARE role_name text; priv text;
        BEGIN
          FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
              IF has_table_privilege(role_name, 'public.assignment_batch_operations', priv) THEN
                RAISE EXCEPTION '% holds % on assignment_batch_operations', role_name, priv;
              END IF;
            END LOOP;
          END LOOP;
          IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.assignment_batch_operations'::regclass) THEN
            RAISE EXCEPTION 'row level security must stay enabled on assignment_batch_operations';
          END IF;
        END $$;
        """
    )
