"""Housekeeper Tasks Phase 4: Add Task contract (idempotent create, room directory, parser safety).

Runs against the shared in-memory Supabase fake with a primary-key unique index on tasks, so a
repeated client_request_id (which becomes the task id) fails like Postgres would.
"""
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from middleware.auth import CurrentUser
from models.requests import CreateTaskRequest
from routers import ai_copilot, rooms as rooms_router
from routers import tasks as tasks_router
from services.ai import task_parser
from services.ai.task_parser import hotel_zone, normalize_due_at, try_fast_path

from .fake_supabase import FakeDB

HOTEL = "hotel-a"
OTHER_HOTEL = "hotel-b"
ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
COWORKER = "11111111-aaaa-4aaa-8aaa-111111111111"
ROOM_A = "11111111-1111-4111-8111-111111111111"
ROOM_B = "22222222-2222-4222-8222-222222222222"
KEY = "9b2f4c1e-7d3a-4f60-8a55-3c1d9e0a7b11"


def hk(user_id=ME, hotel=HOTEL):
    return CurrentUser(user_id=user_id, hotel_id=hotel, role="housekeeper", email="hk@example.com")


def supervisor():
    return CurrentUser(user_id="sup-1", hotel_id=HOTEL, role="housekeeping_supervisor", email="s@example.com")


@pytest.fixture
def db(monkeypatch):
    database = FakeDB(
        {
            "tasks": [],
            "rooms": [
                {"id": ROOM_A, "tenant_id": HOTEL, "room_number": "318", "floor": 3, "building": "A"},
                {"id": ROOM_B, "tenant_id": OTHER_HOTEL, "room_number": "318", "floor": 3, "building": "A"},
            ],
            "user_roles": [
                {"id": "ur1", "user_id": COWORKER, "tenant_id": HOTEL, "is_active": True},
                {"id": "ur2", "user_id": ME, "tenant_id": HOTEL, "is_active": True},
            ],
            "tenants": [{"id": HOTEL, "name": "Hotel A", "timezone": "America/Chicago"}],
            "shifts": [],
        },
        unique_indexes=[("tasks", "tasks_pkey", ["id"], {})],
    )
    for module in (tasks_router, rooms_router, ai_copilot):
        monkeypatch.setattr(module, "supabase", database)
    return database


def request(**overrides):
    body = {"title": "Deliver two extra pillows", "task_type": "housekeeping", "room_id": ROOM_A}
    body.update(overrides)
    return CreateTaskRequest(**body)


# --------------------------------------------------------------------------- room directory


@pytest.mark.asyncio
async def test_room_directory_is_tenant_scoped_and_minimal(db):
    result = await rooms_router.room_directory(hk())

    assert [r["id"] for r in result["data"]] == [ROOM_A]
    # Only these columns are requested (the fake returns whole rows, so check the query itself).
    assert ("rooms", ("id, room_number, floor, building",)) in db.select_calls


def test_room_directory_route_is_not_shadowed_by_the_room_id_route(db):
    token = jwt.encode(
        {"sub": ME, "role": "housekeeper", "email": "x@example.com", "aud": "authenticated", "hotel_id": HOTEL},
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )
    response = TestClient(app).get(
        "/v1/rooms/directory", headers={"Authorization": f"Bearer {token}", "X-Forwarded-For": "192.0.2.80"}
    )

    assert response.status_code == 200
    assert [r["room_number"] for r in response.json()["data"]] == ["318"]


# --------------------------------------------------------------------------- create


@pytest.mark.asyncio
async def test_housekeeper_creates_a_task_with_a_verified_room(db):
    response = await tasks_router.create_task(request(assigned_to=ME, client_request_id=KEY), hk())

    row = response["data"]
    assert row["id"] == KEY
    assert row["room_id"] == ROOM_A and row["rooms"]["room_number"] == "318"
    assert row["assigned_to"] == ME and row["created_by"] == ME
    assert row.get("is_ai_created") is None  # a manual task is never labelled AI-created
    assert response["meta"] == {"replayed": False}


@pytest.mark.asyncio
async def test_ai_suggested_flag_is_recorded(db):
    response = await tasks_router.create_task(request(ai_suggested=True), hk())

    assert response["data"]["is_ai_created"] is True


@pytest.mark.asyncio
async def test_housekeeper_cannot_assign_a_task_to_someone_else(db):
    with pytest.raises(HTTPException) as err:
        await tasks_router.create_task(request(assigned_to=COWORKER), hk())

    assert err.value.status_code == 403
    assert db.rows["tasks"] == []


@pytest.mark.asyncio
async def test_housekeeper_cannot_set_a_department(db):
    with pytest.raises(HTTPException) as err:
        await tasks_router.create_task(request(department_id=str(uuid.uuid4())), hk())

    assert err.value.status_code == 403


@pytest.mark.asyncio
async def test_supervisor_assignment_is_unchanged(db):
    response = await tasks_router.create_task(request(assigned_to=COWORKER), supervisor())

    assert response["data"]["assigned_to"] == COWORKER


@pytest.mark.asyncio
async def test_other_hotels_room_is_a_404_and_creates_nothing(db):
    with pytest.raises(HTTPException) as err:
        await tasks_router.create_task(request(room_id=ROOM_B), hk())

    assert err.value.status_code == 404
    assert db.rows["tasks"] == []


@pytest.mark.asyncio
async def test_location_only_task_has_no_room(db):
    response = await tasks_router.create_task(
        request(room_id=None, location_text="Pool deck", task_type="general"), hk()
    )

    assert response["data"]["room_id"] is None and response["data"]["location_text"] == "Pool deck"
    assert "rooms" not in response["data"]


# --------------------------------------------------------------------------- idempotency


@pytest.mark.asyncio
async def test_retrying_with_the_same_key_returns_the_first_task(db):
    first = await tasks_router.create_task(request(client_request_id=KEY), hk())
    second = await tasks_router.create_task(request(client_request_id=KEY), hk())

    assert len(db.rows["tasks"]) == 1
    assert second["data"]["id"] == first["data"]["id"] == KEY
    assert second["meta"] == {"replayed": True}
    assert second["data"]["rooms"]["room_number"] == "318"


@pytest.mark.asyncio
async def test_losing_a_same_key_race_resolves_to_the_winners_task(db, monkeypatch):
    winner = await tasks_router.create_task(request(client_request_id=KEY), hk())
    # The pre-check misses once (the other attempt had not committed yet), the insert collides.
    real = tasks_router._find_task_by_request_key
    calls = {"n": 0}

    def flaky(key, user):
        calls["n"] += 1
        return None if calls["n"] == 1 else real(key, user)

    monkeypatch.setattr(tasks_router, "_find_task_by_request_key", flaky)

    loser = await tasks_router.create_task(request(client_request_id=KEY), hk())

    assert loser["meta"]["replayed"] is True and loser["data"]["id"] == winner["data"]["id"]
    assert len(db.rows["tasks"]) == 1


@pytest.mark.asyncio
async def test_a_key_used_by_someone_else_is_a_conflict_not_a_replay(db):
    await tasks_router.create_task(request(client_request_id=KEY), hk("someone-else"))

    with pytest.raises(HTTPException) as err:
        await tasks_router.create_task(request(client_request_id=KEY), hk())

    assert err.value.status_code == 409
    assert len(db.rows["tasks"]) == 1


@pytest.mark.asyncio
async def test_a_key_used_in_another_hotel_is_a_conflict_and_leaks_nothing(db):
    await tasks_router.create_task(request(room_id=None, client_request_id=KEY), hk(ME, OTHER_HOTEL))

    with pytest.raises(HTTPException) as err:
        await tasks_router.create_task(request(client_request_id=KEY), hk())

    assert err.value.status_code == 409
    assert "hotel" not in str(err.value.detail).lower()


@pytest.mark.asyncio
async def test_without_a_key_two_creates_are_two_tasks(db):
    await tasks_router.create_task(request(), hk())
    await tasks_router.create_task(request(), hk())

    assert len(db.rows["tasks"]) == 2


def test_create_http_contract_rejects_bad_enums_and_keys(db):
    token = jwt.encode(
        {"sub": ME, "role": "housekeeper", "email": "x@example.com", "aud": "authenticated", "hotel_id": HOTEL},
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )
    headers = {"Authorization": f"Bearer {token}", "X-Forwarded-For": "192.0.2.81"}
    client = TestClient(app)
    ok = {"title": "Pillows", "task_type": "housekeeping", "priority": "normal", "client_request_id": KEY}

    assert client.post("/v1/tasks", json=ok, headers=headers).status_code == 200
    assert client.post("/v1/tasks", json={**ok, "task_type": "magic", "client_request_id": None}, headers=headers).status_code == 422
    assert client.post("/v1/tasks", json={**ok, "priority": "whenever", "client_request_id": None}, headers=headers).status_code == 422
    assert client.post("/v1/tasks", json={**ok, "client_request_id": "not-a-uuid"}, headers=headers).status_code == 422
    assert len(db.rows["tasks"]) == 1


# --------------------------------------------------------------------------- parser safety


NOW = datetime(2026, 10, 13, 17, 0, tzinfo=timezone.utc)  # 12:00 in Chicago (CDT, UTC-5)


def test_naive_due_time_is_read_in_the_hotel_zone_not_the_servers():
    iso, unresolved = normalize_due_at("2026-10-13T14:00:00", hotel_zone("America/Chicago"), NOW)

    assert (iso, unresolved) == ("2026-10-13T19:00:00Z", False)  # 2 PM CDT == 19:00 UTC


def test_due_time_with_an_offset_is_converted_to_utc():
    iso, unresolved = normalize_due_at("2026-10-13T14:00:00-05:00", hotel_zone("America/Chicago"), NOW)

    assert (iso, unresolved) == ("2026-10-13T19:00:00Z", False)


def test_unparseable_or_past_due_times_are_unresolved_not_guessed():
    zone = hotel_zone("America/Chicago")

    assert normalize_due_at("tomorrow morning", zone, NOW) == (None, True)
    assert normalize_due_at("2026-10-13T09:00:00", zone, NOW) == (None, True)  # 9 AM, already past
    assert normalize_due_at(None, zone, NOW) == (None, False)
    assert normalize_due_at("  ", zone, NOW) == (None, False)


def test_unknown_hotel_zone_falls_back_to_the_platform_default():
    assert str(hotel_zone("Mars/Olympus")) == "America/Chicago"
    assert str(hotel_zone(None)) == "America/Chicago"


def test_parser_prompt_carries_the_hotels_local_date_and_zone(monkeypatch):
    captured = {}

    class FakeCompletions:
        def create(self, **kwargs):
            captured.update(kwargs)
            message = SimpleNamespace(tool_calls=[])
            return SimpleNamespace(
                choices=[SimpleNamespace(message=message)], usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1)
            )

    client = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions()))
    monkeypatch.setattr(task_parser, "get_openai_client", lambda: client)

    task_parser.parse_nl_tasks(
        "Room 318 needs pillows before 2 PM", "Hotel A", "u", "housekeeper", timezone_name="America/Los_Angeles"
    )

    system = captured["messages"][0]["content"]
    assert "America/Los_Angeles" in system
    assert "omit due_at" in system and "Never invent a room number" in system


def test_rule_engine_never_swallows_a_stated_time():
    assert try_fast_path("Room 318 needs two extra pillows before 2 PM") is None
    assert try_fast_path("room 318 needs pillows tomorrow") is None
    assert try_fast_path("Habitación 318 necesita almohadas para las 3") is None
    assert try_fast_path("Room 318 needs extra pillows")["tasks"][0]["room_number"] == "318"


def test_finalize_verifies_rooms_validates_due_and_drops_assignees(db):
    tasks = [
        {"title": "A", "room_number": "318", "due_at": "2000-01-01T00:00:00Z", "assigned_to": COWORKER},
        {"title": "B", "room_number": "999", "due_at": None},
        {"title": "C", "room_number": None, "due_at": "soon"},
    ]

    ai_copilot._finalize_parsed_tasks(HOTEL, tasks, "America/Chicago")

    a, b, c = tasks
    assert a["room_id"] == ROOM_A and a["room_number_display"] == "318"  # this hotel's 318, not the other's
    assert a["due_at"] is None and a["due_unresolved"] is True and "assigned_to" not in a
    assert b["room_id"] is None and b["room_number_display"] == "999"  # kept as text, never a guessed id
    assert c["room_id"] is None and c["due_unresolved"] is True
