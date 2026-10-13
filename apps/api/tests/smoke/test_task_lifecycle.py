"""Housekeeper Tasks Phase 1: lifecycle authorization, retrieval contract, AI confirm contract.

Runs against the shared in-memory Supabase fake so conditional (atomic) updates behave like
Postgres: a filtered UPDATE only touches rows that still match.
"""
import base64
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from middleware.auth import CurrentUser
from models.requests import TaskPreview, UpdateTaskRequest
from routers import ai_copilot
from routers import task_lifecycle as lifecycle
from routers import tasks as tasks_router

from .fake_supabase import FakeDB

HOTEL = "hotel-a"
OTHER_HOTEL = "hotel-b"
ME = "hk-me"
COWORKER = "hk-other"
ROOM_A = "11111111-1111-4111-8111-111111111111"
ROOM_B = "22222222-2222-4222-8222-222222222222"
STAFF_A = "33333333-3333-4333-8333-333333333333"

NOW = datetime.now(timezone.utc)


def hk(user_id=ME, hotel=HOTEL):
    return CurrentUser(user_id=user_id, hotel_id=hotel, role="housekeeper", email="hk@example.com")


def supervisor(user_id="sup-1", hotel=HOTEL):
    return CurrentUser(user_id=user_id, hotel_id=hotel, role="housekeeping_supervisor", email="s@example.com")


def make_task(task_id, **overrides):
    row = {
        "id": task_id,
        "tenant_id": HOTEL,
        "title": f"Task {task_id}",
        "task_type": "housekeeping",
        "priority": "normal",
        "status": "open",
        "assigned_to": ME,
        "created_by": "sup-1",
        "created_at": (NOW - timedelta(hours=3)).isoformat(),
        "due_at": (NOW + timedelta(hours=2)).isoformat(),
        "started_at": None,
        "completed_at": None,
    }
    row.update(overrides)
    return row


@pytest.fixture
def db(monkeypatch):
    database = FakeDB({"tasks": [], "task_comments": [], "operational_audit_events": [], "guest_requests": [],
                       "user_profiles": [], "user_roles": [], "rooms": []})
    for module in (lifecycle, tasks_router, ai_copilot):
        monkeypatch.setattr(module, "supabase", database)
    return database


def task_row(db, task_id):
    return next(r for r in db.rows["tasks"] if r["id"] == task_id)


def audit_actions(db):
    return [r["action"] for r in db.rows["operational_audit_events"]]


# --------------------------------------------------------------------------- complete


@pytest.mark.asyncio
async def test_housekeeper_completes_their_own_in_progress_task(db):
    db.rows["tasks"].append(make_task("t1", status="in_progress", started_at=NOW.isoformat()))

    response = await lifecycle.complete_task("t1", None, hk())

    assert response["data"]["status"] == "completed"
    assert response["meta"]["replayed"] is False
    stored = task_row(db, "t1")
    assert stored["status"] == "completed"
    completed_at = datetime.fromisoformat(stored["completed_at"])
    assert abs((completed_at - datetime.now(timezone.utc)).total_seconds()) < 30  # server clock
    assert audit_actions(db) == ["task.completed"]
    audit = db.rows["operational_audit_events"][0]
    assert (audit["tenant_id"], audit["resource_id"], audit["actor_id"]) == (HOTEL, "t1", ME)


@pytest.mark.asyncio
async def test_complete_from_open_backfills_started_at(db):
    db.rows["tasks"].append(make_task("t1", status="open"))

    await lifecycle.complete_task("t1", None, hk())

    stored = task_row(db, "t1")
    assert stored["started_at"] == stored["completed_at"]


@pytest.mark.asyncio
async def test_housekeeper_cannot_complete_a_coworkers_task(db):
    db.rows["tasks"].append(make_task("t1", status="in_progress", assigned_to=COWORKER))

    with pytest.raises(HTTPException) as err:
        await lifecycle.complete_task("t1", None, hk())

    assert err.value.status_code == 403
    assert task_row(db, "t1")["status"] == "in_progress"
    assert audit_actions(db) == []


@pytest.mark.asyncio
async def test_housekeeper_cannot_complete_an_unassigned_task(db):
    db.rows["tasks"].append(make_task("t1", assigned_to=None))

    with pytest.raises(HTTPException) as err:
        await lifecycle.complete_task("t1", None, hk())

    assert err.value.status_code == 403
    assert task_row(db, "t1")["status"] == "open"


@pytest.mark.asyncio
async def test_cross_tenant_task_is_a_404_not_a_leak(db):
    db.rows["tasks"].append(make_task("t1", tenant_id=OTHER_HOTEL, assigned_to=ME))

    for call in (
        lifecycle.complete_task("t1", None, hk()),
        lifecycle.start_task("t1", hk()),
    ):
        with pytest.raises(HTTPException) as err:
            await call
        assert err.value.status_code == 404
    assert task_row(db, "t1")["status"] == "open"


@pytest.mark.asyncio
async def test_manager_can_complete_someone_elses_task(db):
    db.rows["tasks"].append(make_task("t1", status="in_progress", assigned_to=COWORKER))

    response = await lifecycle.complete_task("t1", None, supervisor())

    assert response["data"]["status"] == "completed"


@pytest.mark.asyncio
async def test_cancelled_task_cannot_be_completed(db):
    db.rows["tasks"].append(make_task("t1", status="cancelled"))

    with pytest.raises(HTTPException) as err:
        await lifecycle.complete_task("t1", None, hk())

    assert err.value.status_code == 409
    assert task_row(db, "t1")["status"] == "cancelled"


@pytest.mark.asyncio
async def test_repeated_completion_is_a_replay_with_no_second_side_effect(db):
    db.rows["tasks"].append(make_task("t1", status="in_progress", started_at=NOW.isoformat()))
    from models.requests import CompleteTaskRequest

    first = await lifecycle.complete_task("t1", CompleteTaskRequest(note="Left towels"), hk())
    completed_at = task_row(db, "t1")["completed_at"]
    second = await lifecycle.complete_task("t1", CompleteTaskRequest(note="Left towels"), hk())

    assert first["meta"]["replayed"] is False and first["meta"]["note_saved"] is True
    assert second["meta"] == {"replayed": True}
    assert task_row(db, "t1")["completed_at"] == completed_at
    assert len(db.rows["task_comments"]) == 1
    assert audit_actions(db) == ["task.completed"]


@pytest.mark.asyncio
async def test_losing_a_completion_race_resolves_to_a_replay(db, monkeypatch):
    db.rows["tasks"].append(make_task("t1", status="in_progress", started_at=NOW.isoformat()))
    real_load = lifecycle._load_task
    calls = {"n": 0}

    def load_with_stale_first_read(task_id, hotel_id):
        calls["n"] += 1
        row = real_load(task_id, hotel_id)
        if calls["n"] == 1:
            # a concurrent request completes the task right after this request read it
            task_row(db, "t1").update(status="completed", completed_at=NOW.isoformat())
            row = dict(row, status="in_progress")
        return row

    monkeypatch.setattr(lifecycle, "_load_task", load_with_stale_first_read)

    response = await lifecycle.complete_task("t1", None, hk())

    assert response["meta"]["replayed"] is True
    assert audit_actions(db) == []  # the winner wrote its own audit row; the loser wrote none


@pytest.mark.asyncio
async def test_note_failure_does_not_undo_a_committed_completion(db, monkeypatch):
    db.rows["tasks"].append(make_task("t1", status="in_progress", started_at=NOW.isoformat()))
    from models.requests import CompleteTaskRequest

    real_table = db.table

    def table(name):
        if name == "task_comments":
            raise RuntimeError("comments unavailable")
        return real_table(name)

    monkeypatch.setattr(db, "table", table)

    response = await lifecycle.complete_task("t1", CompleteTaskRequest(note="x"), hk())

    assert response["data"]["status"] == "completed"
    assert response["meta"]["note_saved"] is False


@pytest.mark.asyncio
async def test_generic_patch_still_refuses_housekeeper_status_changes(db):
    db.rows["tasks"].append(make_task("t1", status="in_progress"))

    with pytest.raises(HTTPException) as err:
        await tasks_router.update_task("t1", UpdateTaskRequest(status="completed"), hk())

    assert err.value.status_code == 403
    assert task_row(db, "t1")["status"] == "in_progress"


# --------------------------------------------------------------------------- start / claim


@pytest.mark.asyncio
async def test_start_moves_an_assigned_open_task_to_in_progress(db):
    db.rows["tasks"].append(make_task("t1", priority="normal"))

    response = await lifecycle.start_task("t1", hk())

    stored = task_row(db, "t1")
    assert response["meta"]["replayed"] is False
    assert stored["status"] == "in_progress" and stored["started_at"]
    # start can not touch assignment or priority
    assert (stored["assigned_to"], stored["priority"]) == (ME, "normal")
    assert audit_actions(db) == ["task.started"]


@pytest.mark.asyncio
async def test_start_replay_and_invalid_transitions(db):
    db.rows["tasks"].extend(
        [
            make_task("started", status="in_progress", started_at=NOW.isoformat()),
            make_task("done", status="completed"),
            make_task("cancelled", status="cancelled"),
            make_task("escalated", status="escalated"),
        ]
    )

    replay = await lifecycle.start_task("started", hk())
    assert replay["meta"] == {"replayed": True}
    assert audit_actions(db) == []

    for task_id in ("done", "cancelled"):
        with pytest.raises(HTTPException) as err:
            await lifecycle.start_task(task_id, hk())
        assert err.value.status_code == 409

    await lifecycle.start_task("escalated", hk())
    assert task_row(db, "escalated")["status"] == "in_progress"


@pytest.mark.asyncio
async def test_start_rejects_other_peoples_and_unassigned_tasks(db):
    db.rows["tasks"].extend([make_task("theirs", assigned_to=COWORKER), make_task("pool", assigned_to=None)])

    with pytest.raises(HTTPException) as theirs:
        await lifecycle.start_task("theirs", hk())
    with pytest.raises(HTTPException) as pool:
        await lifecycle.start_task("pool", hk())

    assert theirs.value.status_code == 403
    assert pool.value.status_code == 409
    assert task_row(db, "pool")["assigned_to"] is None


@pytest.mark.asyncio
async def test_concurrent_claims_have_exactly_one_winner(db):
    db.rows["tasks"].append(make_task("pool", assigned_to=None))

    winner = await tasks_router.claim_task("pool", hk(ME))
    with pytest.raises(HTTPException) as loser:
        await tasks_router.claim_task("pool", hk(COWORKER))

    assert winner["data"]["assigned_to"] == ME
    assert loser.value.status_code == 409
    assert task_row(db, "pool")["assigned_to"] == ME
    assert audit_actions(db) == ["task.claimed"]


@pytest.mark.asyncio
async def test_claim_precheck_race_returns_409_when_conditional_update_matches_nothing(db, monkeypatch):
    db.rows["tasks"].append(make_task("pool", assigned_to=None))
    real_table = db.table
    state = {"claimed": False}

    def table(name):
        query = real_table(name)
        if name == "tasks" and not state["claimed"]:
            original_execute = query.execute

            def execute():
                result = original_execute()
                if query.action == "select":
                    # someone else wins between this housekeeper's read and write
                    task_row(db, "pool").update(assigned_to=COWORKER, status="in_progress")
                    state["claimed"] = True
                return result

            query.execute = execute
        return query

    monkeypatch.setattr(db, "table", table)

    with pytest.raises(HTTPException) as err:
        await tasks_router.claim_task("pool", hk(ME))
    assert err.value.status_code == 409
    assert task_row(db, "pool")["assigned_to"] == COWORKER


@pytest.mark.asyncio
async def test_claim_only_housekeeping_tasks(db):
    db.rows["tasks"].append(make_task("eng", assigned_to=None, task_type="engineering"))

    with pytest.raises(HTTPException) as err:
        await tasks_router.claim_task("eng", hk())
    assert err.value.status_code == 403


# --------------------------------------------------------------------------- retrieval


@pytest.mark.asyncio
async def test_my_work_and_available_are_disjoint_and_server_filtered(db):
    db.rows["tasks"].extend(
        [
            make_task("mine-open", status="open"),
            make_task("mine-prog", status="in_progress"),
            make_task("mine-esc", status="escalated"),
            make_task("mine-done", status="completed"),
            make_task("mine-cancel", status="cancelled"),
            make_task("created-for-other", assigned_to=COWORKER, created_by=ME),
            make_task("theirs", assigned_to=COWORKER),
            make_task("pool-1", assigned_to=None),
            make_task("pool-eng", assigned_to=None, task_type="engineering"),
            make_task("pool-started", assigned_to=None, status="in_progress"),
            make_task("other-hotel-mine", tenant_id=OTHER_HOTEL),
            make_task("other-hotel-pool", tenant_id=OTHER_HOTEL, assigned_to=None),
        ]
    )

    mine = await lifecycle.list_my_work(limit=100, cursor=None, current_user=hk())
    pool = await lifecycle.list_available_tasks(limit=100, cursor=None, current_user=hk())

    assert {t["id"] for t in mine["data"]} == {"mine-open", "mine-prog", "mine-esc"}
    assert {t["id"] for t in pool["data"]} == {"pool-1"}
    assert mine["meta"]["truncated"] is False and mine["meta"]["has_more"] is False


@pytest.mark.asyncio
async def test_my_work_sort_order_is_deterministic(db):
    soon = (NOW + timedelta(hours=1)).isoformat()
    later = (NOW + timedelta(hours=5)).isoformat()
    past = (NOW - timedelta(hours=1)).isoformat()
    db.rows["tasks"].extend(
        [
            make_task("open-later", due_at=later),
            make_task("open-urgent-soon", priority="urgent", due_at=soon),
            make_task("in-progress", status="in_progress", due_at=later),
            make_task("overdue-low", priority="low", due_at=past),
            make_task("overdue-urgent", priority="urgent", due_at=past),
            make_task("open-no-due", due_at=None),
        ]
    )

    result = await lifecycle.list_my_work(limit=100, cursor=None, current_user=hk())

    assert [t["id"] for t in result["data"]] == [
        "overdue-urgent",
        "overdue-low",
        "in-progress",
        "open-urgent-soon",
        "open-later",
        "open-no-due",
    ]


@pytest.mark.asyncio
async def test_pagination_returns_every_active_task_exactly_once(db):
    # more rows than one fetch page (500) AND more than one response page
    total = 1230
    for i in range(total):
        db.rows["tasks"].append(
            make_task(
                f"t{i:04d}",
                created_at=(NOW - timedelta(minutes=total - i)).isoformat(),
                due_at=(NOW + timedelta(minutes=i % 90 - 30)).isoformat(),
                priority=("urgent", "normal", "low")[i % 3],
            )
        )

    seen: list[str] = []
    cursor = None
    pages = 0
    while True:
        page = await lifecycle.list_my_work(limit=200, cursor=cursor, current_user=hk())
        seen.extend(t["id"] for t in page["data"])
        pages += 1
        assert page["meta"]["total"] == total and page["meta"]["truncated"] is False
        cursor = page["meta"]["next_cursor"]
        if not page["meta"]["has_more"]:
            break

    assert pages == 7
    assert len(seen) == total and len(set(seen)) == total


@pytest.mark.asyncio
async def test_hitting_the_scan_cap_is_reported_not_silent(db, monkeypatch):
    monkeypatch.setattr(lifecycle, "FETCH_PAGE_SIZE", 10)
    monkeypatch.setattr(lifecycle, "FETCH_HARD_CAP", 20)
    for i in range(35):
        db.rows["tasks"].append(make_task(f"t{i:02d}"))

    result = await lifecycle.list_my_work(limit=200, cursor=None, current_user=hk())

    assert result["meta"]["truncated"] is True


@pytest.mark.asyncio
async def test_bad_cursors_are_rejected(db):
    for bad in ("not-base64!!", base64.urlsafe_b64encode(b'{"k":[1]}').decode(),
                base64.urlsafe_b64encode(json.dumps({"as_of": NOW.isoformat(), "k": ["a", 1, 2, 3, 4]}).encode()).decode()):
        db.rows["tasks"].append(make_task("t1"))
        db.rows["tasks"].append(make_task("t2"))
        with pytest.raises(HTTPException) as err:
            await lifecycle.list_my_work(limit=10, cursor=bad, current_user=hk())
        assert err.value.status_code == 422


@pytest.mark.asyncio
async def test_completed_history_is_mine_newest_first_and_keyset_paged(db):
    same_instant = (NOW - timedelta(hours=1)).isoformat()
    db.rows["tasks"].extend(
        [make_task(f"c{i}", status="completed", completed_at=(NOW - timedelta(hours=i + 2)).isoformat())
         for i in range(5)]
        + [
            make_task("tie-a", status="completed", completed_at=same_instant),
            make_task("tie-b", status="completed", completed_at=same_instant),
            make_task("tie-c", status="completed", completed_at=same_instant),
            make_task("theirs", status="completed", assigned_to=COWORKER, completed_at=same_instant),
            make_task("other-hotel", status="completed", tenant_id=OTHER_HOTEL, completed_at=same_instant),
            make_task("active", status="in_progress"),
            make_task("legacy-no-timestamp", status="completed", completed_at=None),
        ]
    )

    seen = []
    cursor = None
    while True:
        page = await lifecycle.list_my_completed(limit=3, cursor=cursor, current_user=hk())
        seen.extend(t["id"] for t in page["data"])
        cursor = page["meta"]["next_cursor"]
        if not page["meta"]["has_more"]:
            break

    assert seen == ["tie-c", "tie-b", "tie-a", "c0", "c1", "c2", "c3", "c4"]


@pytest.mark.asyncio
async def test_guest_request_link_exposes_only_id_and_status(db):
    db.rows["tasks"].append(make_task("t1", task_type="guest_request"))
    db.rows["guest_requests"].append(
        {"id": "gr1", "tenant_id": HOTEL, "task_id": "t1", "status": "open", "guest_name": "Secret Guest"}
    )

    result = await lifecycle.list_my_work(limit=10, cursor=None, current_user=hk())

    assert result["data"][0]["guest_request"] == {"id": "gr1", "status": "open"}


# --------------------------------------------------------------------------- HTTP route wiring


def _headers(role="housekeeper", user_id=ME, hotel=HOTEL):
    payload = {"sub": user_id, "role": role, "email": "x@example.com", "aud": "authenticated", "hotel_id": hotel}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}", "X-Forwarded-For": "192.0.2.77"}


def test_static_task_paths_beat_the_task_id_route(db):
    db.rows["tasks"].append(make_task("t1"))
    client = TestClient(app)

    mine = client.get("/v1/tasks/mine", headers=_headers())
    assert mine.status_code == 200
    assert [t["id"] for t in mine.json()["data"]] == ["t1"]
    assert client.get("/v1/tasks/mine").status_code == 401
    assert client.get("/v1/tasks/available", headers=_headers(role="engineer")).status_code == 403
    assert client.get("/v1/tasks/available", headers=_headers()).status_code == 200


def test_complete_http_contract_accepts_no_body_and_a_note(db):
    db.rows["tasks"].extend([make_task("t1", status="in_progress"), make_task("t2", status="in_progress")])
    client = TestClient(app)

    no_body = client.post("/v1/tasks/t1/complete", headers=_headers())
    with_note = client.post("/v1/tasks/t2/complete", json={"note": "done"}, headers=_headers())
    forbidden = client.post("/v1/tasks/t2/complete", headers=_headers(user_id=COWORKER))

    assert no_body.status_code == 200 and no_body.json()["data"]["status"] == "completed"
    assert with_note.status_code == 200 and with_note.json()["meta"]["note_saved"] is True
    assert forbidden.status_code == 403  # authorization is decided before replay


# --------------------------------------------------------------------------- AI confirm contract


MOBILE_PREVIEW = {
    "title": "Bring extra towels",
    "description": "Guest asked at the desk",
    "task_type": "housekeeping",
    "priority": "normal",
    "room_number_display": "214",
}


@pytest.fixture
def ai_db(db):
    db.rows["rooms"].extend(
        [
            {"id": ROOM_A, "tenant_id": HOTEL, "room_number": "214"},
            {"id": ROOM_B, "tenant_id": OTHER_HOTEL, "room_number": "214"},
        ]
    )
    db.rows["user_roles"].append({"id": "ur1", "user_id": STAFF_A, "tenant_id": HOTEL, "is_active": True})
    return db


@pytest.mark.asyncio
async def test_confirm_creates_a_task_with_a_verified_room(ai_db):
    preview = TaskPreview(**MOBILE_PREVIEW)

    response = await ai_copilot.confirm_tasks([preview], hk())

    created = response["data"]["tasks"][0]
    assert response["data"]["created_count"] == 1
    assert created["room_id"] == ROOM_A
    assert created["location_text"] is None
    assert created["is_ai_created"] is True and created["created_by"] == ME
    assert created["tenant_id"] == HOTEL


@pytest.mark.asyncio
async def test_unverified_room_text_is_a_location_not_a_room(ai_db):
    preview = TaskPreview(**{**MOBILE_PREVIEW, "room_number_display": "Pool deck"})

    response = await ai_copilot.confirm_tasks([preview], hk())

    created = response["data"]["tasks"][0]
    assert created["room_id"] is None
    assert created["location_text"] == "Pool deck"


@pytest.mark.asyncio
async def test_foreign_room_id_is_rejected(ai_db):
    preview = TaskPreview(**{**MOBILE_PREVIEW, "room_number_display": None, "room_id": ROOM_B})

    with pytest.raises(HTTPException) as err:
        await ai_copilot.confirm_tasks([preview], hk())

    assert err.value.status_code == 400
    assert ai_db.rows.get("tasks") == []


@pytest.mark.asyncio
async def test_assignee_is_persisted_validated_and_policy_checked(ai_db):
    preview = TaskPreview(**{**MOBILE_PREVIEW, "assigned_to": STAFF_A})

    manager = await ai_copilot.confirm_tasks([preview], supervisor())
    created = manager["data"]["tasks"][0]
    assert (created["assigned_to"], created["assigned_by"]) == (STAFF_A, "sup-1")

    with pytest.raises(HTTPException) as denied:  # a housekeeper may not assign to others
        await ai_copilot.confirm_tasks([TaskPreview(**{**MOBILE_PREVIEW, "title": "Other", "assigned_to": STAFF_A})], hk())
    assert denied.value.status_code == 403

    ghost = TaskPreview(**{**MOBILE_PREVIEW, "title": "Ghost", "assigned_to": "44444444-4444-4444-8444-444444444444"})
    with pytest.raises(HTTPException) as unknown:
        await ai_copilot.confirm_tasks([ghost], supervisor())
    assert unknown.value.status_code == 400


@pytest.mark.asyncio
async def test_identical_resubmission_does_not_create_a_second_task(ai_db):
    preview = TaskPreview(**MOBILE_PREVIEW)

    first = await ai_copilot.confirm_tasks([preview], hk())
    # Postgres stamps created_at via its column default; the in-memory fake does not.
    ai_db.rows["tasks"][0]["created_at"] = datetime.now(timezone.utc).isoformat()
    second = await ai_copilot.confirm_tasks([preview], hk())

    assert first["meta"]["deduplicated"] == 0
    assert second["meta"]["deduplicated"] == 1
    assert second["data"]["tasks"][0]["id"] == first["data"]["tasks"][0]["id"]
    assert len(ai_db.rows["tasks"]) == 1
    # a different person sending the same text is a different request, and so is the same
    # text after the dedupe window has passed
    await ai_copilot.confirm_tasks([preview], hk(COWORKER))
    assert len(ai_db.rows["tasks"]) == 2
    ai_db.rows["tasks"][0]["created_at"] = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    await ai_copilot.confirm_tasks([preview], hk())
    assert len(ai_db.rows["tasks"]) == 3


def test_preview_normalization_and_validation():
    normalized = TaskPreview(title="x", priority="High", task_type="Maintenance", due_at="2026-10-12T18:00:00Z")
    assert normalized.priority == "urgent"
    assert normalized.task_type == "engineering"
    assert normalized.due_at == "2026-10-12T18:00:00+00:00"
    assert TaskPreview(title="x", due_at="2026-10-12T13:00:00-05:00").due_at == "2026-10-12T18:00:00+00:00"

    for bad in (
        {"title": ""},
        {"title": "x", "priority": "whenever"},
        {"title": "x", "task_type": "lost_found"},
        {"title": "x", "due_at": "tomorrow morning"},
        {"title": "x", "room_id": "not-a-uuid"},
    ):
        with pytest.raises(ValueError):
            TaskPreview(**bad)


def test_confirm_http_contract_requires_an_array_of_previews(ai_db):
    client = TestClient(app)
    headers = _headers()

    ok = client.post("/v1/ai/tasks/confirm", json=[MOBILE_PREVIEW], headers=headers)
    single_object = client.post("/v1/ai/tasks/confirm", json=MOBILE_PREVIEW, headers=headers)
    invalid = client.post("/v1/ai/tasks/confirm", json=[{"priority": "urgent"}], headers=headers)
    bad_due = client.post("/v1/ai/tasks/confirm", json=[{**MOBILE_PREVIEW, "due_at": "soon"}], headers=headers)
    empty = client.post("/v1/ai/tasks/confirm", json=[], headers=headers)

    assert ok.status_code == 200 and ok.json()["data"]["created_count"] == 1
    assert single_object.status_code == 422
    assert invalid.status_code == 422
    assert bad_due.status_code == 422
    assert empty.status_code == 422
    assert len(ai_db.rows["tasks"]) == 1  # nothing was created by the rejected requests


# --------------------------------------------------------------------------- detail / comment scoping


@pytest.mark.asyncio
async def test_housekeeper_task_detail_follows_the_same_visibility_as_the_lists(db):
    db.rows["tasks"].extend(
        [
            make_task("mine"),
            make_task("created", assigned_to=COWORKER, created_by=ME),
            make_task("pool", assigned_to=None),
            make_task("theirs", assigned_to=COWORKER, created_by="sup-1"),
            make_task("pool-engineering", assigned_to=None, task_type="engineering"),
        ]
    )

    for visible in ("mine", "created", "pool"):
        assert (await tasks_router.get_task(visible, hk()))["data"]["id"] == visible
    for hidden in ("theirs", "pool-engineering"):
        with pytest.raises(HTTPException) as err:
            await tasks_router.get_task(hidden, hk())
        assert err.value.status_code == 404
    # managers keep full tenant visibility
    assert (await tasks_router.get_task("theirs", supervisor()))["data"]["id"] == "theirs"


@pytest.mark.asyncio
async def test_housekeeper_cannot_comment_on_a_task_they_cannot_see(db):
    db.rows["tasks"].extend([make_task("mine"), make_task("theirs", assigned_to=COWORKER)])

    await tasks_router.add_task_comment("mine", "on it", hk())
    with pytest.raises(HTTPException) as err:
        await tasks_router.add_task_comment("theirs", "hello", hk())

    assert err.value.status_code == 404
    assert [c["task_id"] for c in db.rows["task_comments"]] == ["mine"]


# --------------------------------------------------------------------------- activity feed + notes (phase 3)


def _profile(user_id, name, hotel=HOTEL):
    return {"id": user_id, "tenant_id": hotel, "full_name": name, "preferred_name": None}


@pytest.mark.asyncio
async def test_activity_returns_task_and_only_persisted_events_oldest_first(db):
    t0 = NOW - timedelta(hours=3)
    db.rows["tasks"].append(
        make_task("t1", status="in_progress", started_at=(NOW - timedelta(hours=1)).isoformat(), created_at=t0.isoformat())
    )
    db.rows["user_profiles"].extend([_profile("sup-1", "Front Desk"), _profile(ME, "Maria")])
    db.rows["operational_audit_events"].append(
        {"tenant_id": HOTEL, "resource_type": "task", "resource_id": "t1", "action": "task.started",
         "actor_id": ME, "created_at": (NOW - timedelta(hours=1)).isoformat()}
    )
    db.rows["task_comments"].append(
        {"id": "c1", "task_id": "t1", "tenant_id": HOTEL, "user_id": "sup-1", "comment": "Leave towels outside.",
         "is_system": False, "created_at": (NOW - timedelta(minutes=30)).isoformat()}
    )

    response = await lifecycle.get_task_activity("t1", hk())

    assert response["data"]["task"]["id"] == "t1"
    events = response["data"]["events"]
    assert [e["kind"] for e in events] == ["created", "started", "comment"]
    assert events[0]["actor_name"] == "Front Desk"
    assert events[1]["actor_name"] == "Maria"
    assert events[2]["text"] == "Leave towels outside."


@pytest.mark.asyncio
async def test_activity_never_invents_an_actor_or_event(db):
    # started via legacy PATCH: the row has started_at but there is no audit row.
    db.rows["tasks"].append(make_task("t1", status="in_progress", started_at=NOW.isoformat()))

    events = (await lifecycle.get_task_activity("t1", hk()))["data"]["events"]

    started = next(e for e in events if e["kind"] == "started")
    assert started["actor_name"] is None
    assert "completed" not in [e["kind"] for e in events]
    assert not any(e["kind"] == "claimed" for e in events)


@pytest.mark.asyncio
async def test_claimed_task_shows_a_claim_event_not_a_second_start(db):
    db.rows["tasks"].append(make_task("t1", status="in_progress", started_at=NOW.isoformat()))
    db.rows["operational_audit_events"].append(
        {"tenant_id": HOTEL, "resource_type": "task", "resource_id": "t1", "action": "task.claimed",
         "actor_id": ME, "created_at": NOW.isoformat()}
    )

    kinds = [e["kind"] for e in (await lifecycle.get_task_activity("t1", hk()))["data"]["events"]]

    assert kinds.count("claimed") == 1 and "started" not in kinds


@pytest.mark.asyncio
async def test_activity_is_scoped_like_task_detail(db):
    db.rows["tasks"].extend(
        [
            make_task("mine"),
            make_task("pool", assigned_to=None),
            make_task("theirs", assigned_to=COWORKER),
            make_task("foreign", tenant_id=OTHER_HOTEL),
        ]
    )
    for visible in ("mine", "pool"):
        assert (await lifecycle.get_task_activity(visible, hk()))["data"]["task"]["id"] == visible
    for hidden in ("theirs", "foreign", "does-not-exist"):
        with pytest.raises(HTTPException) as err:
            await lifecycle.get_task_activity(hidden, hk())
        assert err.value.status_code == 404
    assert (await lifecycle.get_task_activity("theirs", supervisor()))["data"]["task"]["id"] == "theirs"
    with pytest.raises(HTTPException) as err:
        await lifecycle.get_task_activity("foreign", supervisor())  # managers stop at the tenant line
    assert err.value.status_code == 404


@pytest.mark.asyncio
async def test_activity_does_not_leak_other_tenants_comments(db):
    db.rows["tasks"].append(make_task("t1"))
    db.rows["task_comments"].extend(
        [
            {"id": "ok", "task_id": "t1", "tenant_id": HOTEL, "user_id": ME, "comment": "mine", "is_system": False,
             "created_at": NOW.isoformat()},
            {"id": "bad", "task_id": "t1", "tenant_id": OTHER_HOTEL, "user_id": "x", "comment": "secret",
             "is_system": False, "created_at": NOW.isoformat()},
        ]
    )

    texts = [e.get("text") for e in (await lifecycle.get_task_activity("t1", hk()))["data"]["events"] if e["kind"] == "comment"]

    assert texts == ["mine"]


@pytest.mark.asyncio
async def test_comment_accepts_json_body_trims_and_attributes_author(db):
    from models.requests import TaskCommentRequest

    db.rows["tasks"].append(make_task("t1"))

    result = await tasks_router.add_task_comment("t1", None, hk(), body=TaskCommentRequest(comment="  Guest is asleep  "))

    stored = db.rows["task_comments"][0]
    assert result["data"]["comment"] == "Guest is asleep"
    assert (stored["task_id"], stored["tenant_id"], stored["user_id"]) == ("t1", HOTEL, ME)


@pytest.mark.asyncio
async def test_blank_or_oversized_notes_are_rejected_and_nothing_is_stored(db):
    db.rows["tasks"].append(make_task("t1"))

    for bad in (None, "", "   \n "):
        with pytest.raises(HTTPException) as err:
            await tasks_router.add_task_comment("t1", bad, hk())
        assert err.value.status_code == 422
    with pytest.raises(HTTPException) as err:
        await tasks_router.add_task_comment("t1", "x" * 2001, hk())
    assert err.value.status_code == 422
    assert db.rows["task_comments"] == []


@pytest.mark.asyncio
async def test_cross_tenant_task_cannot_be_commented_on(db):
    db.rows["tasks"].append(make_task("foreign", tenant_id=OTHER_HOTEL))

    with pytest.raises(HTTPException) as err:
        await tasks_router.add_task_comment("foreign", "hi", supervisor())

    assert err.value.status_code == 404
    assert db.rows["task_comments"] == []


def test_activity_and_json_comment_http_contract(db):
    from middleware.auth import get_current_user

    db.rows["tasks"].append(make_task("t1"))
    app.dependency_overrides[get_current_user] = lambda: hk()
    try:
        client = TestClient(app)
        posted = client.post("/v1/tasks/t1/comments", json={"comment": "Running late"})
        assert posted.status_code == 200 and posted.json()["data"]["comment"] == "Running late"
        assert client.post("/v1/tasks/t1/comments", json={"comment": "   "}).status_code == 422
        assert client.post("/v1/tasks/t1/comments").status_code == 422
        legacy = client.post("/v1/tasks/t1/comments?comment=legacy+web")
        assert legacy.status_code == 200 and legacy.json()["data"]["comment"] == "legacy web"
        assert [c["comment"] for c in db.rows["task_comments"]] == ["Running late", "legacy web"]
        feed = client.get("/v1/tasks/t1/activity")
        assert feed.status_code == 200
        assert feed.json()["data"]["task"]["id"] == "t1"
        assert client.get("/v1/tasks/nope/activity").status_code == 404
    finally:
        app.dependency_overrides.pop(get_current_user, None)
