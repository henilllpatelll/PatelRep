"""Housekeeper Tasks Phase 5: Unable to Complete blockers, resume, resolution, supervisor view.

Runs against the shared in-memory Supabase fake with the real partial unique indexes declared,
so duplicate / concurrent reports collapse exactly like they do in Postgres.
"""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jose import jwt
from pydantic import ValidationError

from core.config import settings
from main import app
from middleware.auth import CurrentUser
from models.requests import ReportTaskBlockerRequest, ResolveTaskBlockerRequest, ResumeTaskRequest, UpdateTaskRequest
from routers import task_blockers as blockers
from routers import task_lifecycle as lifecycle
from routers import tasks as tasks_router

from .fake_supabase import FakeDB

HOTEL = "hotel-a"
OTHER_HOTEL = "hotel-b"
ME = "hk-me"
COWORKER = "hk-other"
SUP = "sup-1"
GM = "gm-1"

NOW = datetime.now(timezone.utc)
ALL_REASONS = [
    "guest_unavailable",
    "do_not_disturb",
    "missing_supplies",
    "access_issue",
    "assistance_needed",
    "equipment_issue",
    "other",
]


def user(role, user_id, hotel=HOTEL):
    return CurrentUser(user_id=user_id, hotel_id=hotel, role=role, email="u@example.com")


def hk(user_id=ME, hotel=HOTEL):
    return user("housekeeper", user_id, hotel)


def supervisor(user_id=SUP, hotel=HOTEL):
    return user("housekeeping_supervisor", user_id, hotel)


def make_task(task_id, **overrides):
    row = {
        "id": task_id,
        "tenant_id": HOTEL,
        "title": f"Task {task_id}",
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


def report(reason="missing_supplies", details="No clean towels on floor 2", key=None):
    return ReportTaskBlockerRequest(reason=reason, details=details, client_request_id=key or uuid4())


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
                {"id": ME, "tenant_id": HOTEL, "full_name": "Maria Lopez", "preferred_name": None},
                {"id": SUP, "tenant_id": HOTEL, "full_name": "Sam Supervisor", "preferred_name": None},
            ],
            "user_roles": [
                {"user_id": SUP, "tenant_id": HOTEL, "role": "housekeeping_supervisor", "is_active": True},
                {"user_id": "sup-2", "tenant_id": HOTEL, "role": "housekeeping_supervisor", "is_active": True},
                {"user_id": "sup-gone", "tenant_id": HOTEL, "role": "housekeeping_supervisor", "is_active": False},
                {"user_id": "sup-other-hotel", "tenant_id": OTHER_HOTEL, "role": "housekeeping_supervisor", "is_active": True},
                {"user_id": GM, "tenant_id": HOTEL, "role": "gm", "is_active": True},
            ],
            "notifications": [],
            "notification_deliveries": [],
            "rooms": [],
        },
        unique_indexes=[
            ("task_blockers", "uq_task_blockers_one_active", ("task_id",), {"status": "active"}),
            ("task_blockers", "uq_task_blockers_request", ("tenant_id", "client_request_id"), {}),
        ],
    )
    for module in (blockers, lifecycle, tasks_router):
        monkeypatch.setattr(module, "supabase", database)
    return database


def task_row(db, task_id):
    return next(r for r in db.rows["tasks"] if r["id"] == task_id)


def audit_actions(db):
    return [r["action"] for r in db.rows["operational_audit_events"]]


async def err(coro):
    with pytest.raises(HTTPException) as caught:
        await coro
    return caught.value


def code(exc):
    return exc.detail["code"] if isinstance(exc.detail, dict) else None


# --------------------------------------------------------------------------- request validation


@pytest.mark.parametrize("reason", ALL_REASONS)
def test_every_canonical_reason_is_accepted(reason):
    assert report(reason=reason, details="Details").reason == reason


def test_unknown_reason_is_rejected():
    with pytest.raises(ValidationError):
        report(reason="because")


@pytest.mark.parametrize("details", [None, "", "   "])
def test_other_requires_a_description(details):
    with pytest.raises(ValidationError):
        report(reason="other", details=details)


def test_other_with_a_description_and_common_reasons_without_one_are_valid():
    assert report(reason="other", details="Cart wheel is stuck").reason == "other"
    assert report(reason="do_not_disturb", details=None).details is None


def test_details_longer_than_the_limit_are_rejected():
    with pytest.raises(ValidationError):
        report(details="x" * 1001)


def test_a_request_without_an_idempotency_key_is_rejected():
    with pytest.raises(ValidationError):
        ReportTaskBlockerRequest(reason="missing_supplies")


# --------------------------------------------------------------------------- reporting


@pytest.mark.asyncio
async def test_assignee_reports_a_blocker_without_touching_the_task(db):
    db.rows["tasks"].append(make_task("t1"))
    columns = ("status", "assigned_to", "assigned_by", "due_at", "started_at", "completed_at", "priority", "title")
    before = {c: task_row(db, "t1").get(c) for c in columns}

    response = await blockers.report_blocker("t1", report(), hk())

    # status, assignee, due time, started_at: all untouched
    assert {c: task_row(db, "t1").get(c) for c in columns} == before
    blocker = response["data"]["blocker"]
    assert blocker["reason"] == "missing_supplies"
    assert blocker["details"] == "No clean towels on floor 2"
    assert blocker["reported_by"] == ME and blocker["reported_by_name"] == "Maria Lopez"
    assert blocker["status"] == "active"
    assert response["meta"]["replayed"] is False
    stored = db.rows["task_blockers"][0]
    assert stored["tenant_id"] == HOTEL and stored["task_id"] == "t1" and stored["assigned_to"] == ME
    assert abs((datetime.fromisoformat(stored["reported_at"]) - datetime.now(timezone.utc)).total_seconds()) < 30
    assert audit_actions(db) == ["task.blocker_reported"]
    # the authoritative task now carries the derived blocked state, and is still unfinished
    task = response["data"]["task"]
    assert task["status"] == "in_progress" and task["assigned_to"] == ME and task["completed_at"] is None
    assert task["blocker"]["id"] == blocker["id"]


@pytest.mark.asyncio
async def test_an_unstarted_assigned_task_can_also_be_blocked(db):
    db.rows["tasks"].append(make_task("t1", status="open", started_at=None))

    response = await blockers.report_blocker("t1", report("access_issue", None), hk())

    assert response["data"]["task"]["status"] == "open"
    assert response["data"]["blocker"]["reason"] == "access_issue"


@pytest.mark.asyncio
async def test_a_retry_with_the_same_key_replays_without_a_second_row_or_alert(db):
    db.rows["tasks"].append(make_task("t1"))
    request = report()

    first = await blockers.report_blocker("t1", request, hk())
    second = await blockers.report_blocker("t1", request, hk())

    assert first["meta"]["replayed"] is False and second["meta"]["replayed"] is True
    assert second["data"]["blocker"]["id"] == first["data"]["blocker"]["id"]
    assert len(db.rows["task_blockers"]) == 1
    assert len(db.rows["notifications"]) == 2  # two active supervisors, once
    assert audit_actions(db) == ["task.blocker_reported"]


@pytest.mark.asyncio
async def test_a_retry_still_replays_after_the_blocker_was_resolved(db):
    db.rows["tasks"].append(make_task("t1"))
    request = report()
    first = await blockers.report_blocker("t1", request, hk())
    await blockers.resume_task("t1", None, hk())

    replay = await blockers.report_blocker("t1", request, hk())

    assert replay["meta"]["replayed"] is True
    assert replay["data"]["blocker"]["id"] == first["data"]["blocker"]["id"]
    assert replay["data"]["blocker"]["status"] == "resolved"
    assert len(db.rows["task_blockers"]) == 1  # a late retry never re-blocks the task


@pytest.mark.asyncio
async def test_a_second_different_report_while_one_is_active_is_a_conflict(db):
    db.rows["tasks"].append(make_task("t1"))
    first = await blockers.report_blocker("t1", report("missing_supplies"), hk())

    exc = await err(blockers.report_blocker("t1", report("equipment_issue"), hk()))

    assert exc.status_code == 409 and code(exc) == "blocker_already_active"
    assert exc.detail["blocker"]["id"] == first["data"]["blocker"]["id"]
    assert len(db.rows["task_blockers"]) == 1


@pytest.mark.asyncio
async def test_a_request_key_cannot_be_reused_by_someone_else(db):
    db.rows["tasks"].extend([make_task("t1"), make_task("t2", assigned_to=COWORKER)])
    request = report()
    await blockers.report_blocker("t1", request, hk())

    exc = await err(blockers.report_blocker("t2", request, hk(COWORKER)))

    assert exc.status_code == 409 and code(exc) == "request_id_reused"


@pytest.mark.asyncio
async def test_a_housekeeper_cannot_report_on_a_coworkers_private_task(db):
    db.rows["tasks"].append(make_task("t1", assigned_to=COWORKER, created_by=SUP))

    exc = await err(blockers.report_blocker("t1", report(), hk()))

    assert exc.status_code == 404  # indistinguishable from a task that does not exist
    assert db.rows["task_blockers"] == []


@pytest.mark.asyncio
async def test_someone_who_can_see_a_task_but_does_not_own_it_cannot_block_it(db):
    db.rows["tasks"].append(make_task("t1", assigned_to=COWORKER, created_by=ME))  # I created it for them

    exc = await err(blockers.report_blocker("t1", report(), hk()))

    assert exc.status_code == 403 and code(exc) == "not_assignee"
    assert db.rows["task_blockers"] == []


@pytest.mark.asyncio
async def test_an_unassigned_pool_task_can_not_be_blocked(db):
    db.rows["tasks"].append(make_task("t1", status="open", assigned_to=None, started_at=None))

    exc = await err(blockers.report_blocker("t1", report(), hk()))

    assert exc.status_code == 403 and code(exc) == "not_assignee"


@pytest.mark.asyncio
async def test_another_hotels_task_is_not_found(db):
    db.rows["tasks"].append(make_task("t1"))

    exc = await err(blockers.report_blocker("t1", report(), hk(ME, OTHER_HOTEL)))

    assert exc.status_code == 404
    assert db.rows["task_blockers"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["completed", "cancelled"])
async def test_a_finished_task_can_not_be_blocked(db, status):
    db.rows["tasks"].append(make_task("t1", status=status))

    exc = await err(blockers.report_blocker("t1", report(), hk()))

    assert exc.status_code == 409 and code(exc) == "task_closed"
    assert db.rows["task_blockers"] == []
    assert task_row(db, "t1")["status"] == status


@pytest.mark.asyncio
async def test_a_reassignment_during_submission_leaves_no_report_behind(db, monkeypatch):
    db.rows["tasks"].append(make_task("t1"))
    real_load = blockers._load_task
    calls = {"n": 0}

    def load(task_id, hotel_id):
        calls["n"] += 1
        row = real_load(task_id, hotel_id)
        if calls["n"] == 2:  # the re-check after the insert: a supervisor reassigned it meanwhile
            task_row(db, "t1")["assigned_to"] = COWORKER
            row = dict(row, assigned_to=COWORKER)
        return row

    monkeypatch.setattr(blockers, "_load_task", load)

    exc = await err(blockers.report_blocker("t1", report(), hk()))

    assert exc.status_code == 409 and code(exc) == "task_changed"
    assert [b["status"] for b in db.rows["task_blockers"]] == ["resolved"]
    assert db.rows["task_blockers"][0]["resolution"] == "reassigned"
    assert db.rows["notifications"] == []  # nobody was alerted about a report that did not stand


# --------------------------------------------------------------------------- notifications


@pytest.mark.asyncio
async def test_active_supervisors_of_the_same_hotel_are_alerted_and_the_reporter_is_not(db):
    db.rows["tasks"].append(make_task("t1", location_text="Pool deck"))

    response = await blockers.report_blocker("t1", report(details="Guest asked us to leave"), hk())

    recipients = sorted(n["user_id"] for n in db.rows["notifications"])
    assert recipients == [SUP, "sup-2"]  # not the inactive one, not the other hotel, not the GM, not the reporter
    note = db.rows["notifications"][0]
    assert note["tenant_id"] == HOTEL and note["type"] == "task_blocked"
    assert "Guest asked us" not in note["body"] and "Task t1" not in note["body"]  # no free text, no title
    assert note["data"]["task_id"] == "t1"
    assert len(db.rows["notification_deliveries"]) == 2
    assert response["data"]["blocker"]["notification_status"] == "queued"
    assert db.rows["task_blockers"][0]["notified_count"] == 2


@pytest.mark.asyncio
async def test_the_reporter_is_never_alerted_as_their_own_supervisor(db):
    db.rows["tasks"].append(make_task("t1", assigned_to=SUP))
    db.rows["user_roles"] = [r for r in db.rows["user_roles"] if r["user_id"] == SUP]

    # a supervisor assigned a task reports it: with nobody else to alert the GM fallback applies
    response = await blockers.report_blocker("t1", report(), supervisor())

    assert [n["user_id"] for n in db.rows["notifications"]] == []  # no GM row in this trimmed table
    assert response["data"]["blocker"]["notification_status"] == "not_available"


@pytest.mark.asyncio
async def test_the_gm_is_alerted_when_no_supervisor_exists(db):
    db.rows["tasks"].append(make_task("t1"))
    db.rows["user_roles"] = [r for r in db.rows["user_roles"] if r["role"] == "gm"]

    response = await blockers.report_blocker("t1", report(), hk())

    assert [n["user_id"] for n in db.rows["notifications"]] == [GM]
    assert response["data"]["blocker"]["notification_status"] == "queued"


@pytest.mark.asyncio
async def test_no_one_to_alert_is_reported_as_not_available_not_as_sent(db):
    db.rows["tasks"].append(make_task("t1"))
    db.rows["user_roles"] = []

    response = await blockers.report_blocker("t1", report(), hk())

    assert response["data"]["blocker"]["notification_status"] == "not_available"
    assert db.rows["notifications"] == []


@pytest.mark.asyncio
async def test_a_notification_failure_keeps_the_blocker_and_says_so(db, monkeypatch):
    db.rows["tasks"].append(make_task("t1"))
    real_table = db.table

    def table(name):
        if name == "notifications":
            raise RuntimeError("push provider down")
        return real_table(name)

    monkeypatch.setattr(db, "table", table)

    response = await blockers.report_blocker("t1", report(), hk())

    assert len(db.rows["task_blockers"]) == 1
    assert response["data"]["blocker"]["notification_status"] == "failed"
    assert db.rows["task_blockers"][0]["notification_status"] == "failed"


# --------------------------------------------------------------------------- lifecycle interaction


@pytest.mark.asyncio
async def test_a_blocked_task_does_not_count_as_completed_and_stays_in_my_work(db):
    db.rows["tasks"].extend([make_task("t1"), make_task("t2")])
    await blockers.report_blocker("t1", report(), hk())

    mine = await lifecycle.list_my_work(limit=10, cursor=None, current_user=hk())
    done = await lifecycle.list_my_completed(limit=10, cursor=None, current_user=hk())

    by_id = {t["id"]: t for t in mine["data"]}
    assert set(by_id) == {"t1", "t2"}  # stays assigned and visible
    assert by_id["t1"]["blocker"]["reason"] == "missing_supplies" and by_id["t2"]["blocker"] is None
    assert by_id["t1"]["status"] == "in_progress" and by_id["t1"]["due_at"] == task_row(db, "t1")["due_at"]
    assert done["data"] == []
    available = await lifecycle.list_available_tasks(limit=10, cursor=None, current_user=hk())
    assert available["data"] == []  # a blocked task never falls back into the pool


@pytest.mark.asyncio
async def test_ordering_and_overdue_maths_ignore_blockers(db):
    db.rows["tasks"].extend(
        [
            make_task("late", due_at=(NOW - timedelta(hours=1)).isoformat()),
            make_task("soon", due_at=(NOW + timedelta(hours=1)).isoformat()),
        ]
    )
    before = [t["id"] for t in (await lifecycle.list_my_work(limit=10, cursor=None, current_user=hk()))["data"]]
    await blockers.report_blocker("late", report(), hk())

    after = [t["id"] for t in (await lifecycle.list_my_work(limit=10, cursor=None, current_user=hk()))["data"]]

    assert before == after == ["late", "soon"]
    assert task_row(db, "late")["due_at"] < NOW.isoformat()  # still overdue; SLA is not paused


@pytest.mark.asyncio
async def test_a_blocked_task_can_not_be_started_or_completed_by_its_assignee(db):
    db.rows["tasks"].extend([make_task("open1", status="open", started_at=None), make_task("run1")])
    await blockers.report_blocker("open1", report(), hk())
    await blockers.report_blocker("run1", report(), hk())

    start = await err(lifecycle.start_task("open1", hk()))
    complete = await err(lifecycle.complete_task("run1", None, hk()))

    assert start.status_code == 409 and code(start) == "task_blocked"
    assert complete.status_code == 409 and code(complete) == "task_blocked"
    assert task_row(db, "open1")["status"] == "open" and task_row(db, "run1")["status"] == "in_progress"


@pytest.mark.asyncio
async def test_after_resume_the_task_moves_on_normally(db):
    db.rows["tasks"].append(make_task("t1", status="open", started_at=None))
    await blockers.report_blocker("t1", report(), hk())
    await blockers.resume_task("t1", None, hk())

    started = await lifecycle.start_task("t1", hk())
    started_status = started["data"]["status"]  # the fake hands back the live row; read it before completing
    done = await lifecycle.complete_task("t1", None, hk())

    assert started_status == "in_progress"
    assert done["data"]["status"] == "completed" and done["data"]["blocker"] is None


@pytest.mark.asyncio
async def test_a_manager_completing_a_blocked_task_closes_the_blocker(db):
    db.rows["tasks"].append(make_task("t1"))
    await blockers.report_blocker("t1", report(), hk())

    done = await lifecycle.complete_task("t1", None, supervisor())

    assert done["data"]["status"] == "completed"
    assert db.rows["task_blockers"][0]["status"] == "resolved"
    assert db.rows["task_blockers"][0]["resolution"] == "completed"
    assert db.rows["task_blockers"][0]["resolved_by"] == SUP


@pytest.mark.asyncio
async def test_reassigning_a_blocked_task_closes_the_blocker(db):
    db.rows["tasks"].append(make_task("t1"))
    await blockers.report_blocker("t1", report(), hk())
    staff = "33333333-3333-4333-8333-333333333333"
    db.rows["user_roles"].append({"user_id": staff, "tenant_id": HOTEL, "role": "housekeeper", "is_active": True})
    db.rows["user_profiles"].append({"id": staff, "tenant_id": HOTEL, "full_name": "Lee", "preferred_name": None})

    await tasks_router.update_task("t1", UpdateTaskRequest(assigned_to=staff), supervisor())

    assert task_row(db, "t1")["assigned_to"] == staff
    blocker = db.rows["task_blockers"][0]
    assert blocker["status"] == "resolved" and blocker["resolution"] == "reassigned"
    assert "task.blocker_resolved" in audit_actions(db)


# --------------------------------------------------------------------------- resume


@pytest.mark.asyncio
async def test_resume_clears_the_blocker_and_keeps_history(db):
    db.rows["tasks"].append(make_task("t1"))
    reported = await blockers.report_blocker("t1", report(), hk())

    response = await blockers.resume_task("t1", ResumeTaskRequest(blocker_id=reported["data"]["blocker"]["id"]), hk())

    assert response["meta"]["replayed"] is False
    assert response["data"]["task"]["blocker"] is None and response["data"]["task"]["status"] == "in_progress"
    stored = db.rows["task_blockers"][0]
    assert stored["status"] == "resolved" and stored["resolution"] == "resumed"
    assert stored["resolved_by"] == ME and stored["resolved_at"] and stored["reason"] == "missing_supplies"
    assert audit_actions(db) == ["task.blocker_reported", "task.blocker_resumed"]


@pytest.mark.asyncio
async def test_resume_is_a_replay_when_a_supervisor_already_resolved_it(db):
    db.rows["tasks"].append(make_task("t1"))
    reported = await blockers.report_blocker("t1", report(), hk())
    blocker_id = reported["data"]["blocker"]["id"]
    await blockers.resolve_blocker("t1", blocker_id, None, supervisor())

    response = await blockers.resume_task("t1", ResumeTaskRequest(blocker_id=blocker_id), hk())

    assert response["meta"]["replayed"] is True
    assert db.rows["task_blockers"][0]["resolved_by"] == SUP  # the newer decision stands


@pytest.mark.asyncio
async def test_resume_with_a_stale_blocker_id_does_not_close_a_newer_report(db):
    db.rows["tasks"].append(make_task("t1"))
    first = await blockers.report_blocker("t1", report("missing_supplies"), hk())
    await blockers.resume_task("t1", None, hk())
    second = await blockers.report_blocker("t1", report("equipment_issue"), hk())

    exc = await err(blockers.resume_task("t1", ResumeTaskRequest(blocker_id=first["data"]["blocker"]["id"]), hk()))

    assert exc.status_code == 409 and code(exc) == "blocker_changed"
    assert exc.detail["blocker"]["id"] == second["data"]["blocker"]["id"]
    assert [b["status"] for b in db.rows["task_blockers"]] == ["resolved", "active"]


@pytest.mark.asyncio
async def test_resume_with_nothing_to_resume_is_a_conflict(db):
    db.rows["tasks"].append(make_task("t1"))

    exc = await err(blockers.resume_task("t1", None, hk()))

    assert exc.status_code == 409 and code(exc) == "no_active_blocker"


@pytest.mark.asyncio
async def test_only_the_assignee_can_resume(db):
    db.rows["tasks"].append(make_task("t1", created_by=COWORKER))
    await blockers.report_blocker("t1", report(), hk())

    exc = await err(blockers.resume_task("t1", None, hk(COWORKER)))  # can see it (creator), does not own it

    assert exc.status_code == 403 and code(exc) == "not_assignee"
    assert db.rows["task_blockers"][0]["status"] == "active"


# --------------------------------------------------------------------------- resolve / supervisor view


@pytest.mark.asyncio
async def test_supervisor_resolves_a_blocker_with_an_audited_note(db):
    db.rows["tasks"].append(make_task("t1"))
    reported = await blockers.report_blocker("t1", report(), hk())
    blocker_id = reported["data"]["blocker"]["id"]

    response = await blockers.resolve_blocker("t1", blocker_id, ResolveTaskBlockerRequest(note="Towels on the way"), supervisor())

    assert response["data"]["blocker"]["status"] == "resolved"
    assert response["data"]["blocker"]["resolved_by"] == SUP
    assert response["data"]["blocker"]["resolution_note"] == "Towels on the way"
    assert task_row(db, "t1")["assigned_to"] == ME and task_row(db, "t1")["status"] == "in_progress"
    assert audit_actions(db)[-1] == "task.blocker_resolved"


@pytest.mark.asyncio
async def test_resolving_twice_is_a_replay(db):
    db.rows["tasks"].append(make_task("t1"))
    blocker_id = (await blockers.report_blocker("t1", report(), hk()))["data"]["blocker"]["id"]
    await blockers.resolve_blocker("t1", blocker_id, None, supervisor())

    again = await blockers.resolve_blocker("t1", blocker_id, None, supervisor("sup-2"))

    assert again["meta"]["replayed"] is True
    assert db.rows["task_blockers"][0]["resolved_by"] == SUP
    assert audit_actions(db).count("task.blocker_resolved") == 1


@pytest.mark.asyncio
async def test_another_hotels_manager_can_not_resolve(db):
    db.rows["tasks"].append(make_task("t1"))
    blocker_id = (await blockers.report_blocker("t1", report(), hk()))["data"]["blocker"]["id"]

    exc = await err(blockers.resolve_blocker("t1", blocker_id, None, supervisor("sup-x", OTHER_HOTEL)))

    assert exc.status_code == 404
    assert db.rows["task_blockers"][0]["status"] == "active"


def _headers(role, user_id, hotel=HOTEL):
    payload = {"sub": user_id, "role": role, "email": "x@example.com", "aud": "authenticated", "hotel_id": hotel}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}", "X-Forwarded-For": "192.0.2.78"}


def test_http_roles_gate_resolution_and_the_supervisor_list(db):
    db.rows["tasks"].append(make_task("t1"))
    client = TestClient(app)
    created = client.post(
        "/v1/tasks/t1/blockers",
        json={"reason": "missing_supplies", "details": "No towels", "client_request_id": str(uuid4())},
        headers=_headers("housekeeper", ME),
    )
    assert created.status_code == 200
    blocker_id = created.json()["data"]["blocker"]["id"]

    # a housekeeper can neither resolve nor list
    assert client.post(f"/v1/tasks/t1/blockers/{blocker_id}/resolve", headers=_headers("housekeeper", ME)).status_code == 403
    assert client.get("/v1/tasks/blocked", headers=_headers("housekeeper", ME)).status_code == 403
    assert client.get("/v1/tasks/blocked", headers=_headers("engineer", "eng-1")).status_code == 403
    assert client.get("/v1/tasks/blocked").status_code == 401
    # a supervisor can; the static path is not swallowed by GET /tasks/{task_id}
    listed = client.get("/v1/tasks/blocked", headers=_headers("housekeeping_supervisor", SUP))
    assert listed.status_code == 200 and len(listed.json()["data"]) == 1
    resolved = client.post(f"/v1/tasks/t1/blockers/{blocker_id}/resolve", json={}, headers=_headers("housekeeping_supervisor", SUP))
    assert resolved.status_code == 200 and resolved.json()["data"]["blocker"]["status"] == "resolved"
    # validation errors surface as 422, not 500
    bad = client.post(
        "/v1/tasks/t1/blockers",
        json={"reason": "nope", "client_request_id": str(uuid4())},
        headers=_headers("housekeeper", ME),
    )
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_supervisor_list_shows_who_where_why_when_and_only_their_hotel(db):
    db.rows["rooms"].append({"id": "r1", "tenant_id": HOTEL})
    db.rows["tasks"].extend(
        [
            make_task("t1", location_text="Pool deck"),
            make_task("t-other", tenant_id=OTHER_HOTEL, assigned_to="hk-b", created_by="sup-b"),
            make_task("t-done"),
        ]
    )
    await blockers.report_blocker("t1", report("do_not_disturb", None), hk())
    await blockers.report_blocker("t-other", report(), hk("hk-b", OTHER_HOTEL))
    await blockers.report_blocker("t-done", report(), hk())
    task_row(db, "t-done")["status"] = "cancelled"

    mine = await blockers.list_blocked_tasks(limit=50, task_type=None, current_user=supervisor())
    theirs = await blockers.list_blocked_tasks(limit=50, task_type=None, current_user=supervisor("sup-b", OTHER_HOTEL))

    assert [i["task"]["id"] for i in mine["data"]] == ["t1"]
    item = mine["data"][0]
    assert item["blocker"]["reason"] == "do_not_disturb" and item["blocker"]["status"] == "active"
    assert item["blocker"]["reported_by_name"] == "Maria Lopez" and item["blocker"]["reported_at"]
    assert item["task"]["assigned_to"] == ME and item["task"]["location_text"] == "Pool deck"
    assert [i["task"]["id"] for i in theirs["data"]] == ["t-other"]
    resolved_id = item["blocker"]["id"]
    await blockers.resolve_blocker("t1", resolved_id, None, supervisor())
    after = await blockers.list_blocked_tasks(limit=50, task_type=None, current_user=supervisor())
    assert after["data"] == []  # resolved blockers leave the unresolved list


# --------------------------------------------------------------------------- visibility & activity


@pytest.mark.asyncio
async def test_activity_shows_persisted_blocker_events_in_order(db):
    db.rows["tasks"].append(make_task("t1"))
    reported = await blockers.report_blocker("t1", report(details="No towels"), hk())
    await blockers.resolve_blocker("t1", reported["data"]["blocker"]["id"], ResolveTaskBlockerRequest(note="Restocked"), supervisor())

    feed = await lifecycle.get_task_activity("t1", hk())

    events = [e for e in feed["data"]["events"] if e["kind"].startswith("blocker")]
    assert [e["kind"] for e in events] == ["blocker_reported", "blocker_resolved"]
    assert events[0]["reason"] == "missing_supplies" and events[0]["text"] == "No towels"
    assert events[0]["actor_id"] == ME and events[0]["actor_name"] == "Maria Lopez"
    assert events[1]["resolution"] == "resolved" and events[1]["actor_id"] == SUP and events[1]["text"] == "Restocked"


@pytest.mark.asyncio
async def test_a_housekeeper_who_only_created_the_task_does_not_see_the_blocker(db):
    db.rows["tasks"].append(make_task("t1", created_by=COWORKER))
    await blockers.report_blocker("t1", report(details="Private detail"), hk())

    feed = await lifecycle.get_task_activity("t1", hk(COWORKER))
    detail = await tasks_router.get_task("t1", hk(COWORKER))

    assert [e for e in feed["data"]["events"] if e["kind"].startswith("blocker")] == []
    assert feed["data"]["task"]["blocker"] is None
    assert detail["data"]["blocker"] is None
    managers = await tasks_router.get_task("t1", supervisor())
    assert managers["data"]["blocker"]["details"] == "Private detail"


@pytest.mark.asyncio
async def test_a_blocker_lookup_failure_does_not_take_the_task_list_down(db, monkeypatch):
    db.rows["tasks"].append(make_task("t1"))
    real_table = db.table

    def table(name):
        if name == "task_blockers":
            raise RuntimeError('relation "task_blockers" does not exist')
        return real_table(name)

    monkeypatch.setattr(db, "table", table)

    mine = await lifecycle.list_my_work(limit=10, cursor=None, current_user=hk())

    assert [t["id"] for t in mine["data"]] == ["t1"] and mine["data"][0]["blocker"] is None
