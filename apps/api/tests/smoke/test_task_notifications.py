"""Housekeeper Tasks Phase 7: task event notifications (assigned, reassigned, cancelled, problem resolved).

In-app rows only (the existing push worker delivers them); generic wording, no duplicates, never the actor,
never another hotel, never able to fail the committed task change.
"""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from middleware.auth import CurrentUser
from models.requests import CreateTaskRequest, ReportTaskBlockerRequest, ResolveTaskBlockerRequest, UpdateTaskRequest
from routers import task_blockers as blockers
from routers import task_lifecycle as lifecycle
from routers import tasks as tasks_router

from .fake_supabase import FakeDB

HOTEL = "hotel-a"
ME = "11111111-1111-4111-8111-111111111111"
OTHER_HK = "22222222-2222-4222-8222-222222222222"
SUP = "sup-1"
NOW = datetime.now(timezone.utc)


def user(role, user_id, hotel=HOTEL):
    return CurrentUser(user_id=user_id, hotel_id=hotel, role=role, email="u@example.com")


def make_task(task_id, **overrides):
    row = {
        "id": task_id,
        "tenant_id": HOTEL,
        "title": "Guest Jane Doe in 412 wants extra towels",
        "task_type": "housekeeping",
        "priority": "normal",
        "status": "in_progress",
        "assigned_to": ME,
        "created_by": SUP,
        "created_at": (NOW - timedelta(hours=3)).isoformat(),
        "due_at": (NOW + timedelta(hours=2)).isoformat(),
        "started_at": NOW.isoformat(),
        "completed_at": None,
    }
    row.update(overrides)
    return row


@pytest.fixture
def db(monkeypatch):
    database = FakeDB(
        {
            "tasks": [],
            "task_comments": [],
            "task_blockers": [],
            "operational_audit_events": [],
            "guest_requests": [],
            "user_profiles": [
                {"id": ME, "tenant_id": HOTEL, "full_name": "Maria", "preferred_name": None},
                {"id": OTHER_HK, "tenant_id": HOTEL, "full_name": "Lee", "preferred_name": None},
            ],
            "user_roles": [
                {"user_id": SUP, "tenant_id": HOTEL, "role": "housekeeping_supervisor", "is_active": True},
                {"user_id": ME, "tenant_id": HOTEL, "role": "housekeeper", "is_active": True},
                {"user_id": OTHER_HK, "tenant_id": HOTEL, "role": "housekeeper", "is_active": True},
            ],
            "notifications": [],
            "notification_deliveries": [],
            "rooms": [],
        },
    )
    for module in (blockers, lifecycle, tasks_router):
        monkeypatch.setattr(module, "supabase", database)
    return database


def sent(db, event=None):
    return [n for n in db.rows["notifications"] if event is None or n["type"] == event]


@pytest.mark.asyncio
async def test_creating_a_task_for_someone_else_alerts_only_them_with_generic_text(db):
    request = CreateTaskRequest(title="Guest Jane Doe wants towels", task_type="housekeeping", assigned_to=ME)
    await tasks_router.create_task(request, user("housekeeping_supervisor", SUP))

    rows = sent(db)
    assert [(n["user_id"], n["type"], n["tenant_id"]) for n in rows] == [(ME, "task_assigned", HOTEL)]
    assert "Jane" not in rows[0]["title"] + rows[0]["body"]
    assert rows[0]["data"]["task_id"]  # the deep link target; nothing else rides along
    assert set(rows[0]["data"]) == {"task_id"}


@pytest.mark.asyncio
async def test_urgent_assignment_is_flagged_urgent(db):
    request = CreateTaskRequest(title="Spill", task_type="housekeeping", priority="urgent", assigned_to=ME)
    await tasks_router.create_task(request, user("housekeeping_supervisor", SUP))
    assert [n["type"] for n in sent(db)] == ["task_assigned_urgent"]


@pytest.mark.asyncio
async def test_a_task_you_make_for_yourself_does_not_alert_you(db):
    request = CreateTaskRequest(title="Restock cart", task_type="housekeeping", assigned_to=ME)
    await tasks_router.create_task(request, user("housekeeper", ME))
    assert sent(db) == []


@pytest.mark.asyncio
async def test_an_unassigned_task_alerts_nobody(db):
    await tasks_router.create_task(CreateTaskRequest(title="Pool deck", task_type="general"), user("housekeeping_supervisor", SUP))
    assert sent(db) == []


@pytest.mark.asyncio
async def test_reassigning_alerts_the_new_owner_and_tells_the_old_one(db):
    db.rows["tasks"].append(make_task("t1"))
    await tasks_router.update_task("t1", UpdateTaskRequest(assigned_to=OTHER_HK), user("housekeeping_supervisor", SUP))

    assert [(n["user_id"], n["type"]) for n in sent(db)] == [(OTHER_HK, "task_assigned"), (ME, "task_reassigned")]


@pytest.mark.asyncio
async def test_a_repeated_reassignment_does_not_double_alert_while_the_first_is_unread(db):
    db.rows["tasks"].append(make_task("t1", assigned_to=None, status="open"))
    patch = UpdateTaskRequest(assigned_to=OTHER_HK)
    await tasks_router.update_task("t1", patch, user("housekeeping_supervisor", SUP))
    db.rows["tasks"][0]["assigned_to"] = None  # a retry that lands on the same state
    await tasks_router.update_task("t1", patch, user("housekeeping_supervisor", SUP))

    assert len(sent(db, "task_assigned")) == 1


@pytest.mark.asyncio
async def test_reassigning_to_the_same_person_sends_nothing(db):
    db.rows["tasks"].append(make_task("t1"))
    await tasks_router.update_task("t1", UpdateTaskRequest(assigned_to=ME), user("housekeeping_supervisor", SUP))
    assert sent(db) == []


@pytest.mark.asyncio
async def test_cancelling_an_assigned_task_alerts_the_assignee(db):
    db.rows["tasks"].append(make_task("t1"))
    await tasks_router.update_task("t1", UpdateTaskRequest(status="cancelled"), user("housekeeping_supervisor", SUP))
    assert [(n["user_id"], n["type"]) for n in sent(db)] == [(ME, "task_cancelled")]


@pytest.mark.asyncio
async def test_a_manager_resolving_a_problem_tells_the_assignee_once(db):
    db.rows["tasks"].append(make_task("t1"))
    blocked = await blockers.report_blocker(
        "t1",
        ReportTaskBlockerRequest(reason="missing_supplies", details="No towels", client_request_id=uuid4()),
        user("housekeeper", ME),
    )
    blocker_id = blocked["data"]["blocker"]["id"]
    db.rows["notifications"].clear()  # the supervisor alert is covered elsewhere

    await blockers.resolve_blocker("t1", blocker_id, ResolveTaskBlockerRequest(note="Restocked"), user("housekeeping_supervisor", SUP))
    await blockers.resolve_blocker("t1", blocker_id, ResolveTaskBlockerRequest(note="Restocked"), user("housekeeping_supervisor", SUP))

    assert [(n["user_id"], n["type"]) for n in sent(db)] == [(ME, "task_blocker_resolved")]
    assert "Restocked" not in sent(db)[0]["body"]  # the resolution note stays on the task, not the lock screen


@pytest.mark.asyncio
async def test_a_notification_failure_never_fails_the_task_change(db, monkeypatch):
    real_table = db.table

    def flaky(name):
        if name == "notifications":
            raise RuntimeError("push store down")
        return real_table(name)

    monkeypatch.setattr(db, "table", flaky)
    db.rows["tasks"].append(make_task("t1"))

    response = await tasks_router.update_task("t1", UpdateTaskRequest(status="cancelled"), user("housekeeping_supervisor", SUP))

    assert response["data"]["status"] == "cancelled"
    assert db.rows["notifications"] == []


class _FakeExpo:
    """Stands in for httpx.AsyncClient; records what would be sent to Expo."""

    sent = []
    reply = {"data": {"status": "ok", "id": "ticket-1"}}
    status = 200

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json=None):
        type(self).sent.append((url, json))
        outer = self

        class Response:
            status_code = outer.status

            def json(self):
                return outer.reply

        return Response()


@pytest.fixture
def expo(monkeypatch):
    _FakeExpo.sent = []
    _FakeExpo.reply = {"data": {"status": "ok", "id": "ticket-1"}}
    _FakeExpo.status = 200
    monkeypatch.setattr(tasks_router.httpx, "AsyncClient", _FakeExpo)
    return _FakeExpo


def _give_token(db, user_id, token="ExponentPushToken[abc]"):
    next(p for p in db.rows["user_profiles"] if p["id"] == user_id)["expo_push_token"] = token


@pytest.mark.asyncio
async def test_push_is_sent_with_generic_text_and_marked_sent_only_when_expo_accepts(db, expo):
    _give_token(db, OTHER_HK)
    db.rows["tasks"].append(make_task("t1"))
    await tasks_router.update_task("t1", UpdateTaskRequest(assigned_to=OTHER_HK), user("housekeeping_supervisor", SUP))

    assert len(expo.sent) == 1
    payload = expo.sent[0][1]
    assert payload["to"] == "ExponentPushToken[abc]" and payload["data"] == {"task_id": "t1", "type": "task_assigned"}
    assert "Jane" not in payload["title"] + payload["body"]
    row = sent(db, "task_assigned")[0]
    assert row["push_sent"] is True and row["expo_push_ticket"] == "ticket-1"


@pytest.mark.asyncio
async def test_a_refused_push_leaves_the_in_app_alert_and_does_not_claim_delivery(db, expo):
    _give_token(db, OTHER_HK)
    expo.reply = {"data": {"status": "error", "message": "DeviceNotRegistered"}}
    db.rows["tasks"].append(make_task("t1"))
    await tasks_router.update_task("t1", UpdateTaskRequest(assigned_to=OTHER_HK), user("housekeeping_supervisor", SUP))

    row = sent(db, "task_assigned")[0]
    assert row.get("push_sent") in (None, False) and "expo_push_ticket" not in row


@pytest.mark.asyncio
async def test_no_device_token_means_in_app_only(db, expo):
    db.rows["tasks"].append(make_task("t1"))
    await tasks_router.update_task("t1", UpdateTaskRequest(assigned_to=OTHER_HK), user("housekeeping_supervisor", SUP))
    assert expo.sent == [] and len(sent(db, "task_assigned")) == 1


# --------------------------------------------------------------------------- Phase 7 authorization hardening


@pytest.mark.asyncio
async def test_only_managers_can_delete_tasks(db):
    """The gate is the route dependency, so assert it on the app, not by calling the handler."""
    from fastapi.testclient import TestClient
    from jose import jwt

    from core.config import settings
    from main import app

    def headers(role, user_id):
        payload = {"sub": user_id, "role": role, "email": "x@example.com", "aud": "authenticated", "hotel_id": HOTEL}
        return {"Authorization": f"Bearer {jwt.encode(payload, settings.supabase_jwt_secret, algorithm='HS256')}", "X-Forwarded-For": "192.0.2.79"}

    client = TestClient(app)
    db.rows["tasks"].append(make_task("t1"))
    for role in ("housekeeper", "engineer", "front_desk"):
        response = client.delete("/v1/tasks/t1", headers=headers(role, ME))
        assert response.status_code == 403, role
    assert [t["id"] for t in db.rows["tasks"]] == ["t1"]

    response = client.delete("/v1/tasks/t1", headers=headers("housekeeping_supervisor", SUP))
    assert response.status_code == 204
    assert db.rows["tasks"] == []


@pytest.mark.asyncio
async def test_a_manager_cannot_delete_another_hotels_task(db):
    from fastapi import HTTPException

    db.rows["tasks"].append(make_task("t1", tenant_id="hotel-b"))
    with pytest.raises(HTTPException) as caught:
        await tasks_router.delete_task("t1", user("gm", "gm-1"))
    assert caught.value.status_code == 404
    assert len(db.rows["tasks"]) == 1


@pytest.mark.asyncio
async def test_bulk_create_is_closed_to_floor_staff_and_validated_for_everyone_else(db):
    from fastapi import HTTPException

    async def code(coro):
        with pytest.raises(HTTPException) as caught:
            await coro
        return caught.value.status_code

    assert await code(tasks_router.batch_create_tasks([{"title": "x"}], user("housekeeper", ME))) == 403
    manager = user("housekeeping_supervisor", SUP)
    assert await code(tasks_router.batch_create_tasks([{"title": "x"}] * 21, manager)) == 422
    assert await code(tasks_router.batch_create_tasks([{"title": ""}], manager)) == 422
    assert await code(tasks_router.batch_create_tasks([{"title": "ok", "priority": "asap"}], manager)) == 422
    # a room from another hotel is refused, and the valid first row is not left behind
    db.rows["rooms"].append({"id": "r-other", "tenant_id": "hotel-b"})
    assert await code(tasks_router.batch_create_tasks([{"title": "ok"}, {"title": "bad", "room_id": "r-other"}], manager)) == 404
    assert db.rows["tasks"] == []

    result = await tasks_router.batch_create_tasks([{"title": "ok"}], manager)
    assert result["data"]["created_count"] == 1
