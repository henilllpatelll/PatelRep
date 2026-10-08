"""Settings > Rooms & Accessibility (phase 2): single-room create/edit and delete safety.

FakeDB does not enforce foreign keys, so these tests lock in the router contract:
tenant scoping, duplicate protection, no status mutation on create/edit, and that a room
with operational history can never be deleted (the real DB would cascade-delete it).
"""

from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import rooms as rooms_router
from tests.smoke.fake_supabase import FakeDB


def _auth(role: str = "gm", hotel_id: str = "hotel-a") -> dict[str, str]:
    payload = {"sub": "user-1", "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    return {"Authorization": f"Bearer {jwt.encode(payload, settings.supabase_jwt_secret, algorithm='HS256')}"}


def _db(**extra) -> FakeDB:
    rows = {
        "room_types": [
            {"id": "rt-a", "tenant_id": "hotel-a", "code": "SD", "name": "Standard"},
            {"id": "rt-b", "tenant_id": "hotel-b", "code": "SD", "name": "Standard"},
        ],
        "rooms": [
            {"id": "room-101", "tenant_id": "hotel-a", "room_number": "101", "floor": 1, "room_type_id": "rt-a"},
            {"id": "room-102", "tenant_id": "hotel-a", "room_number": "102", "floor": 1, "room_type_id": "rt-a"},
            {"id": "room-b-1", "tenant_id": "hotel-b", "room_number": "101", "floor": 1, "room_type_id": "rt-b"},
        ],
        "room_status": [
            {"room_id": "room-101", "tenant_id": "hotel-a", "status": "CLEAN"},
        ],
    }
    rows.update(extra)
    return FakeDB(rows)


def _client(monkeypatch, db: FakeDB) -> TestClient:
    monkeypatch.setattr(rooms_router, "supabase", db)
    return TestClient(app)


def test_list_room_types_is_hotel_scoped(monkeypatch):
    res = _client(monkeypatch, _db()).get("/v1/rooms/types", headers=_auth())
    assert res.status_code == 200
    assert [t["id"] for t in res.json()["data"]] == ["rt-a"]


def test_create_room_inserts_room_and_initial_status(monkeypatch):
    db = _db()
    res = _client(monkeypatch, db).post(
        "/v1/rooms", json={"room_number": " 201 ", "floor": 2, "room_type_id": "rt-a", "building": " A "}, headers=_auth(),
    )
    assert res.status_code == 201
    created = res.json()["data"]
    assert created["room_number"] == "201" and created["building"] == "A" and created["tenant_id"] == "hotel-a"
    assert any(t == "room_status" and r["room_id"] == created["id"] and r["status"] == "DIRTY" for t, r in db.inserts)


def test_create_duplicate_room_is_409_and_never_resets_status(monkeypatch):
    db = _db()
    res = _client(monkeypatch, db).post(
        "/v1/rooms", json={"room_number": "101", "floor": 1, "room_type_id": "rt-a"}, headers=_auth(),
    )
    assert res.status_code == 409
    assert db.updates == []
    assert [r["status"] for r in db.rows["room_status"] if r["room_id"] == "room-101"] == ["CLEAN"]


def test_create_room_same_number_in_another_hotel_is_allowed(monkeypatch):
    # hotel-b already has room 101; hotel-a creating "301" must not collide, and 101 in b is invisible to a.
    res = _client(monkeypatch, _db()).post(
        "/v1/rooms", json={"room_number": "301", "floor": 3, "room_type_id": "rt-a"}, headers=_auth(),
    )
    assert res.status_code == 201


def test_create_room_rejects_another_hotels_room_type(monkeypatch):
    res = _client(monkeypatch, _db()).post(
        "/v1/rooms", json={"room_number": "301", "floor": 3, "room_type_id": "rt-b"}, headers=_auth(),
    )
    assert res.status_code == 422


def test_create_room_requires_manager_role(monkeypatch):
    for role in ("housekeeper", "engineer", "front_desk", "chief_engineer"):
        res = _client(monkeypatch, _db()).post(
            "/v1/rooms", json={"room_number": "301", "floor": 3, "room_type_id": "rt-a"}, headers=_auth(role),
        )
        assert res.status_code == 403, role


def test_update_details_changes_master_data_only(monkeypatch):
    db = _db()
    res = _client(monkeypatch, db).patch(
        "/v1/rooms/room-101/details", json={"floor": 4, "building": "B"}, headers=_auth(),
    )
    assert res.status_code == 200
    assert db.rows["rooms"][0]["floor"] == 4 and db.rows["rooms"][0]["building"] == "B"
    assert all(table == "rooms" for table, _ in db.updates)
    assert db.rows["room_status"][0]["status"] == "CLEAN"


def test_update_details_blocks_duplicate_number_but_allows_keeping_own(monkeypatch):
    client = _client(monkeypatch, _db())
    dup = client.patch("/v1/rooms/room-101/details", json={"room_number": "102"}, headers=_auth())
    assert dup.status_code == 409
    same = client.patch("/v1/rooms/room-101/details", json={"room_number": "101", "floor": 2}, headers=_auth())
    assert same.status_code == 200


def test_update_details_cannot_touch_another_hotels_room(monkeypatch):
    db = _db()
    res = _client(monkeypatch, db).patch("/v1/rooms/room-b-1/details", json={"floor": 9}, headers=_auth())
    assert res.status_code == 404
    assert db.rows["rooms"][2]["floor"] == 1


def test_update_details_requires_a_field(monkeypatch):
    res = _client(monkeypatch, _db()).patch("/v1/rooms/room-101/details", json={}, headers=_auth())
    assert res.status_code == 422


def test_delete_room_with_history_is_refused(monkeypatch):
    db = _db(room_status_history=[{"id": "h1", "room_id": "room-101", "tenant_id": "hotel-a"}])
    res = _client(monkeypatch, db).delete("/v1/rooms/room-101", headers=_auth())
    assert res.status_code == 409
    assert "status history" in res.json()["detail"]
    assert db.deletes == []


def test_delete_room_blocked_by_work_order_and_reports_it(monkeypatch):
    db = _db(work_orders=[{"id": "wo1", "room_id": "room-101", "tenant_id": "hotel-a"}])
    client = _client(monkeypatch, db)
    check = client.get("/v1/rooms/room-101/deletion-check", headers=_auth()).json()["data"]
    assert check["can_delete"] is False and check["blocked_by"] == ["work orders"]
    assert client.delete("/v1/rooms/room-101", headers=_auth()).status_code == 409


def test_delete_room_without_history_succeeds(monkeypatch):
    db = _db()
    client = _client(monkeypatch, db)
    check = client.get("/v1/rooms/room-102/deletion-check", headers=_auth()).json()["data"]
    assert check == {"room_number": "102", "can_delete": True, "blocked_by": []}
    assert client.delete("/v1/rooms/room-102", headers=_auth()).status_code == 200
    assert [r["id"] for r in db.rows["rooms"] if r["tenant_id"] == "hotel-a"] == ["room-101"]


def test_delete_cannot_reach_another_hotels_room(monkeypatch):
    db = _db()
    res = _client(monkeypatch, db).delete("/v1/rooms/room-b-1", headers=_auth())
    assert res.status_code == 404
    assert any(r["id"] == "room-b-1" for r in db.rows["rooms"])
