"""Housekeeping tasks left unassigned are a broadcast pool: any housekeeper can
see one and claim it by starting it, first tap wins. Mirrors the engineering
work-order claim pattern in routers/work_orders.py.
"""

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from routers import tasks as tasks_router


class _FakeQuery:
    """Minimal chainable fake for one supabase .table(...) call."""

    def __init__(self, rows):
        self._rows = rows
        self.update_payload: dict | None = None
        self.calls: list[tuple] = []

    def select(self, *args, **kwargs):
        self.calls.append(("select", args, kwargs))
        return self

    def update(self, payload):
        self.update_payload = payload
        self.calls.append(("update", payload))
        return self

    def eq(self, *args, **kwargs):
        self.calls.append(("eq", args, kwargs))
        return self

    def is_(self, *args, **kwargs):
        self.calls.append(("is_", args, kwargs))
        return self

    def in_(self, *args, **kwargs):
        self.calls.append(("in_", args, kwargs))
        return self

    def order(self, *args, **kwargs):
        return self

    def range(self, *args, **kwargs):
        return self

    def or_(self, arg):
        self.calls.append(("or_", arg))
        self.or_arg = arg
        return self

    def maybe_single(self):
        return self

    def execute(self):
        return type("Result", (), {"data": self._rows})()


class _ClaimDatabase:
    """First .table('tasks') call is the existence/state check, second is the
    conditional update. A third call (user_profiles) may follow via
    _attach_profiles when the update returns a row."""

    def __init__(self, check_rows, update_rows):
        self._tasks_queries = [_FakeQuery(check_rows), _FakeQuery(update_rows)]
        self.profiles_query = _FakeQuery([])

    def table(self, name):
        if name == "tasks":
            return self._tasks_queries.pop(0)
        if name == "user_profiles":
            return self.profiles_query
        raise AssertionError(f"unexpected table {name}")


def _housekeeper(user_id="hk-1"):
    return CurrentUser(user_id=user_id, hotel_id="hotel-1", role="housekeeper", email="hk@example.com")


@pytest.mark.asyncio
async def test_claim_self_assigns_and_starts_an_open_unassigned_housekeeping_task(monkeypatch):
    database = _ClaimDatabase(
        check_rows={"id": "task-1", "status": "open", "assigned_to": None, "task_type": "housekeeping"},
        update_rows=[{"id": "task-1", "status": "in_progress", "assigned_to": "hk-1", "task_type": "housekeeping"}],
    )
    monkeypatch.setattr(tasks_router, "supabase", database)

    response = await tasks_router.claim_task("task-1", _housekeeper())

    assert response["data"]["status"] == "in_progress"
    assert response["data"]["assigned_to"] == "hk-1"


@pytest.mark.asyncio
async def test_claim_writes_assignee_assigner_and_started_at_on_the_conditional_update(monkeypatch):
    check_query_rows = {"id": "task-1", "status": "open", "assigned_to": None, "task_type": "housekeeping"}
    update_query_rows = [{"id": "task-1", "status": "in_progress", "assigned_to": "hk-1", "task_type": "housekeeping"}]
    database = _ClaimDatabase(check_query_rows, update_query_rows)
    # Capture the update query object before it's consumed by claim_task.
    second_query = database._tasks_queries[1]
    monkeypatch.setattr(tasks_router, "supabase", database)

    await tasks_router.claim_task("task-1", _housekeeper())

    assert second_query.update_payload["assigned_to"] == "hk-1"
    assert second_query.update_payload["assigned_by"] == "hk-1"
    assert second_query.update_payload["status"] == "in_progress"
    assert "started_at" in second_query.update_payload
    # The atomic race guard: update only matches a still-open, still-unassigned row.
    eq_calls = [c for c in second_query.calls if c[0] == "eq"]
    is_calls = [c for c in second_query.calls if c[0] == "is_"]
    assert ("status", "open") in [c[1] for c in eq_calls]
    assert ("assigned_to", "null") in [c[1] for c in is_calls]


@pytest.mark.asyncio
async def test_claim_rejects_a_task_that_is_already_assigned(monkeypatch):
    database = _ClaimDatabase(
        check_rows={"id": "task-1", "status": "open", "assigned_to": "other-hk", "task_type": "housekeeping"},
        update_rows=[],
    )
    monkeypatch.setattr(tasks_router, "supabase", database)

    with pytest.raises(HTTPException) as exc_info:
        await tasks_router.claim_task("task-1", _housekeeper())
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_claim_rejects_non_housekeeping_task_types(monkeypatch):
    database = _ClaimDatabase(
        check_rows={"id": "task-1", "status": "open", "assigned_to": None, "task_type": "engineering"},
        update_rows=[],
    )
    monkeypatch.setattr(tasks_router, "supabase", database)

    with pytest.raises(HTTPException) as exc_info:
        await tasks_router.claim_task("task-1", _housekeeper())
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_claim_returns_409_when_someone_else_wins_the_race(monkeypatch):
    # The precheck sees it as open+unassigned, but the conditional update matches
    # zero rows — another housekeeper's claim landed in between.
    database = _ClaimDatabase(
        check_rows={"id": "task-1", "status": "open", "assigned_to": None, "task_type": "housekeeping"},
        update_rows=[],
    )
    monkeypatch.setattr(tasks_router, "supabase", database)

    with pytest.raises(HTTPException) as exc_info:
        await tasks_router.claim_task("task-1", _housekeeper())
    assert exc_info.value.status_code == 409


class _ListDatabase:
    def __init__(self, rows):
        self.query = _FakeQuery(rows)

    def table(self, name):
        assert name == "tasks"
        return self.query


@pytest.mark.asyncio
async def test_housekeeper_task_list_includes_the_open_housekeeping_broadcast_pool(monkeypatch):
    database = _ListDatabase([])
    monkeypatch.setattr(tasks_router, "supabase", database)

    await tasks_router.list_tasks(
        status=None,
        task_type=None,
        priority=None,
        assigned_to=None,
        room_id=None,
        page=1,
        per_page=20,
        current_user=_housekeeper(),
    )

    assert "assigned_to.eq.hk-1" in database.query.or_arg
    assert "created_by.eq.hk-1" in database.query.or_arg
    assert "and(assigned_to.is.null,status.eq.open,task_type.eq.housekeeping)" in database.query.or_arg
