"""POST /housekeeping/assignments/batch-publish through the real FastAPI app, against the real migrated database.

The unit tests cover the HTTP contract with a stubbed RPC; these confirm the same contract end to end: the JWT's
hotel and user reach the database function, a refusal really leaves the tables untouched, and the read-only result
check answers from what actually committed.
"""

import os
import uuid

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from batch_support import change, dated, hotel_today, make_hotel, mirror, operation_count, seed_dated, snapshot
from core.config import settings
from core.database import get_supabase
from main import app
from routers import housekeeping as housekeeping_router

pytestmark = pytest.mark.skipif(
    os.getenv("MIGRATED_DATABASE_TEST") != "1",
    reason="requires the isolated Supabase database created by the migration gate",
)

URL = "/v1/housekeeping/assignments/batch-publish"


@pytest.fixture(scope="module")
def db():
    return get_supabase()


@pytest.fixture
def pushes(monkeypatch):
    sent = []

    async def _noop():
        return None

    def record(tenant_id, rooms):  # recorded when the handler schedules it, not when the loop later runs it
        sent.append((tenant_id, [r["room_id"] for r in rooms]))
        return _noop()

    monkeypatch.setattr(housekeeping_router, "_push_batch_assignments", record)
    return sent


@pytest.fixture
def client():
    return TestClient(app)  # not a context manager: leaving the app lifespan would close the shared database client


def _auth(hotel_id, user_id, role="housekeeping_supervisor"):
    token = jwt.encode({"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _body(changes, operation_id=None):
    """The request body: `change()` dicts without the fields a given kind must not send."""
    kept = [{k: v for k, v in c.items() if v is not None and v is not False} for c in changes]
    return {"operation_id": operation_id or str(uuid.uuid4()), "date": hotel_today().isoformat(), "changes": kept}


def test_a_publication_commits_and_is_read_back_by_its_operation_id(db, client, pushes):
    hotel = make_hotel(db)
    a, b = hotel.housekeepers[:2]
    seed_dated(db, hotel, "r2", a)
    body = _body([change(hotel.rooms["r1"], "assign", b), change(hotel.rooms["r2"], "reassign", b, expected=a)])

    response = client.post(URL, json=body, headers=_auth(hotel.tenant_id, hotel.supervisor))
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "committed" and data["replayed"] is False and data["counts"]["total"] == 2
    assert dated(db, hotel, "r1")["assigned_by"] == hotel.supervisor
    assert mirror(db, hotel, "r2")["assigned_to"] == b

    check = client.get(f"{URL}/{body['operation_id']}", headers=_auth(hotel.tenant_id, hotel.supervisor)).json()["data"]
    assert check["status"] == "committed" and check["result"]["affected_room_ids"] == data["affected_room_ids"]
    # Another supervisor of the same hotel, and a GM of another hotel, learn nothing about it.
    other = client.get(f"{URL}/{body['operation_id']}", headers=_auth(hotel.tenant_id, hotel.gm, "gm")).json()["data"]
    assert other == {"status": "not_found"}


def test_a_retry_of_a_committed_publication_returns_the_original_and_notifies_once(db, client, pushes):
    hotel = make_hotel(db)
    body = _body([change(hotel.rooms["r1"], "assign", hotel.housekeepers[0])])
    headers = _auth(hotel.tenant_id, hotel.supervisor)
    first = client.post(URL, json=body, headers=headers).json()["data"]
    again = client.post(URL, json=body, headers=headers)
    assert again.status_code == 200 and again.json()["data"]["replayed"] is True
    assert {k: v for k, v in again.json()["data"].items() if k != "replayed"} == {k: v for k, v in first.items() if k != "replayed"}
    assert len(pushes) == 1  # the replay did not notify again
    assert operation_count(db, hotel) == 1


def test_a_stale_draft_is_a_409_that_names_the_room_and_changes_nothing(db, client, pushes):
    hotel = make_hotel(db)
    a, b = hotel.housekeepers[:2]
    seed_dated(db, hotel, "r3", b)
    before = snapshot(db, hotel)
    response = client.post(URL, json=_body([change(hotel.rooms["r1"], "assign", a), change(hotel.rooms["r3"], "assign", a)]), headers=_auth(hotel.tenant_id, hotel.supervisor))
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["applied"] is False and detail["code"] == "assignment_batch_conflict"
    assert [(c["room_id"], c["code"], c["current_assigned_to"]) for c in detail["conflicts"]] == [(hotel.rooms["r3"], "assignment_changed", b)]
    assert snapshot(db, hotel) == before and pushes == []


def test_the_token_decides_the_hotel_so_another_hotels_rooms_are_not_reachable(db, client, pushes):
    mine, theirs = make_hotel(db), make_hotel(db)
    before = snapshot(db, theirs)
    response = client.post(URL, json=_body([change(theirs.rooms["r1"], "assign", mine.housekeepers[0])]), headers=_auth(mine.tenant_id, mine.supervisor))
    assert response.status_code == 409
    assert response.json()["detail"]["conflicts"][0]["code"] == "room_not_found"
    assert snapshot(db, theirs) == before
    # A supervisor token minted for MY hotel but carrying THEIR user id cannot publish as them either.
    forged = client.post(URL, json=_body([change(mine.rooms["r1"], "assign", mine.housekeepers[0])]), headers=_auth(mine.tenant_id, theirs.supervisor))
    assert forged.status_code == 403
    assert dated(db, mine, "r1") is None
