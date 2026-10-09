"""Concurrent clean-session starts: the unique indexes decide, losers answer cleanly.

Each test forces BOTH requests through every read-then-insert check before either
inserts (a barrier at the last step before the insert), which is the exact window
the old code lost. The in-memory fake enforces the same partial unique indexes as
migrations 055 and 209, so only the database-level guarantee can pass these.
"""

import threading
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from main import app
from routers import clean_sessions as clean_sessions_router
from routers import cleaning_checklists as checklists_router
from services import room_status_transitions as transitions
from tests.smoke.fake_supabase import FakeDB
from tests.test_clean_sessions_lifecycle import HOTEL, ROOM_1, ROOM_2, _auth, _room_status, _templates, _today

UNIQUE_INDEXES = [
    ("room_clean_sessions", "room_clean_sessions_pkey", ("id",), {}),
    ("room_clean_sessions", "rcs_one_active_per_room", ("tenant_id", "room_id"), {"status": "active"}),
    ("room_clean_sessions", "rcs_one_active_per_attendant", ("tenant_id", "housekeeper_id"), {"status": "active"}),
]


@pytest.fixture
def db(monkeypatch):
    templates, items = _templates()
    fake = FakeDB(
        {
            "tenants": [{"id": HOTEL, "timezone": "America/Chicago"}],
            "cleaning_checklist_templates": templates,
            "cleaning_checklist_items": items,
            "rooms": [{"id": ROOM_1, "tenant_id": HOTEL}, {"id": ROOM_2, "tenant_id": HOTEL}],
            "room_status": [_room_status(ROOM_1, assigned_to=None), _room_status(ROOM_2, assigned_to=None)],
            "room_assignments": [
                {"id": f"as-{room}-{user}", "tenant_id": HOTEL, "room_id": room, "assigned_to": user,
                 "assignment_date": _today(), "clean_type": "DEP"}
                for room in (ROOM_1, ROOM_2)
                for user in ("hk-1", "hk-2")
            ],
        },
        unique_indexes=UNIQUE_INDEXES,
    )
    for module in (clean_sessions_router, checklists_router, transitions):
        monkeypatch.setattr(module, "supabase", fake)
    return fake


@pytest.fixture
def race(monkeypatch):
    """Hold each request just before its insert until both have passed every check."""
    barrier = threading.Barrier(2, timeout=10)
    original = clean_sessions_router._release_stale_sessions

    def gated(*args, **kwargs):
        original(*args, **kwargs)
        barrier.wait()

    monkeypatch.setattr(clean_sessions_router, "_release_stale_sessions", gated)


def _post(results, index, room_id, user_id, session_id):
    body = {
        "id": session_id,
        "room_id": room_id,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "entry_acknowledged": True,
    }
    # One client per thread: TestClient is not safe to share across threads.
    results[index] = TestClient(app).post("/v1/clean-sessions", json=body, headers=_auth(user_id=user_id))


def _run_pair(a, b):
    results = [None, None]
    threads = [threading.Thread(target=_post, args=(results, i, *args)) for i, args in enumerate((a, b))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)
        assert not t.is_alive(), "request deadlocked"
    return results


def _active(db, room_id=None):
    return [
        r for r in db.rows["room_clean_sessions"]
        if r["status"] == "active" and (room_id is None or r["room_id"] == room_id)
    ]


def test_two_housekeepers_racing_for_one_room_yield_one_session(db, race):
    res = _run_pair((ROOM_1, "hk-1", str(uuid.uuid4())), (ROOM_1, "hk-2", str(uuid.uuid4())))
    assert sorted(r.status_code for r in res) == [200, 409], [r.text for r in res]
    loser = next(r for r in res if r.status_code == 409)
    assert loser.json()["detail"]["code"] == "ROOM_IN_USE"
    assert len(_active(db, ROOM_1)) == 1
    winner = next(r for r in res if r.status_code == 200).json()["data"]
    assert _active(db, ROOM_1)[0]["id"] == winner["id"]


def test_loser_does_not_touch_room_status_or_history(db, race):
    _run_pair((ROOM_1, "hk-1", str(uuid.uuid4())), (ROOM_1, "hk-2", str(uuid.uuid4())))
    history = [h for h in db.rows.get("room_status_history", []) if h["room_id"] == ROOM_1]
    assert len(history) == 1  # only the winner's IN_PROGRESS transition


def test_one_attendant_racing_for_two_rooms_gets_one_active_room(db, race):
    res = _run_pair((ROOM_1, "hk-1", str(uuid.uuid4())), (ROOM_2, "hk-1", str(uuid.uuid4())))
    assert sorted(r.status_code for r in res) == [200, 409], [r.text for r in res]
    loser = next(r for r in res if r.status_code == 409)
    assert loser.json()["detail"]["code"] == "ACTIVE_SESSION_EXISTS"
    assert loser.json()["detail"]["active_session_id"] is not None
    assert len(_active(db)) == 1
    in_progress = [r for r in db.rows["room_status"] if r["status"] == "IN_PROGRESS"]
    assert len(in_progress) == 1


def test_same_session_id_started_twice_at_once_is_one_session(db, race):
    sid = str(uuid.uuid4())
    res = _run_pair((ROOM_1, "hk-1", sid), (ROOM_1, "hk-1", sid))
    assert [r.status_code for r in res] == [200, 200], [r.text for r in res]
    assert {r.json()["data"]["id"] for r in res} == {sid}
    assert len(db.rows["room_clean_sessions"]) == 1
    history = [h for h in db.rows.get("room_status_history", []) if h["room_id"] == ROOM_1]
    assert len(history) == 1


def test_same_housekeeper_same_room_different_ids_resolves_to_one_session(db, race):
    res = _run_pair((ROOM_1, "hk-1", str(uuid.uuid4())), (ROOM_1, "hk-1", str(uuid.uuid4())))
    assert [r.status_code for r in res] == [200, 200], [r.text for r in res]
    assert len({r.json()["data"]["id"] for r in res}) == 1
    assert len(_active(db, ROOM_1)) == 1


def test_non_unique_insert_failures_still_surface(db, monkeypatch):
    """Only the known unique violations are translated; anything else is a real error."""
    original = db.table

    def broken(name):
        query = original(name)
        if name == "room_clean_sessions":
            real_execute = query.execute

            def execute():
                if query.action == "insert":
                    raise RuntimeError("connection reset")
                return real_execute()

            query.execute = execute
        return query

    monkeypatch.setattr(db, "table", broken)
    client = TestClient(app, raise_server_exceptions=False)
    res = client.post(
        "/v1/clean-sessions",
        json={"id": str(uuid.uuid4()), "room_id": ROOM_1, "started_at": datetime.now(timezone.utc).isoformat(),
              "entry_acknowledged": True},
        headers=_auth(),
    )
    assert res.status_code == 500
