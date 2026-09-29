"""Task workspace contract: active work is complete, history is separately paginated."""

import pytest

from middleware.auth import CurrentUser
from routers import tasks as tasks_router
from tests.smoke.fake_supabase import FakeDB


class _OrAwareQuery:
    """Minimal chainable fake that understands a simple `.or_("col.ilike.%x%,col2.ilike.%x%")`
    clause (OR of ilike-substring checks) on top of plain `.eq`/`.in_` — just enough to
    exercise Phase 6's History search filter without touching the shared FakeQuery used
    by every other test in this file/module."""

    def __init__(self, rows):
        self._rows = list(rows)
        self._eq: list[tuple] = []
        self._in: list[tuple] = []
        self._or_clauses: list[tuple[str, str]] | None = None
        self._range: tuple[int, int] | None = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, column, value):
        self._eq.append((column, value))
        return self

    def in_(self, column, values):
        self._in.append((column, list(values)))
        return self

    def order(self, *_args, **_kwargs):
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def or_(self, arg: str):
        clauses = []
        for clause in arg.split(","):
            column, op, pattern = clause.split(".", 2)
            assert op == "ilike"
            clauses.append((column, pattern.strip("%").lower()))
        self._or_clauses = clauses
        return self

    def _matches(self, row: dict) -> bool:
        for column, value in self._eq:
            if row.get(column) != value:
                return False
        for column, values in self._in:
            if row.get(column) not in values:
                return False
        if self._or_clauses:
            if not any(term in (row.get(column) or "").lower() for column, term in self._or_clauses):
                return False
        return True

    def execute(self):
        matched = [row for row in self._rows if self._matches(row)]
        if self._range:
            start, end = self._range
            matched = matched[start : end + 1]
        return type("Result", (), {"data": matched})()


class _WorkspaceSearchDB:
    def __init__(self, tasks, guest_requests):
        self._tasks = tasks
        self._guest_requests = guest_requests

    def table(self, name):
        if name == "tasks":
            return _OrAwareQuery(self._tasks)
        if name == "guest_requests":
            return _OrAwareQuery(self._guest_requests)
        if name == "user_profiles":
            return _OrAwareQuery([])
        raise AssertionError(f"unexpected table {name}")


@pytest.mark.asyncio
async def test_workspace_returns_every_active_task_without_using_the_history_page_window(monkeypatch):
    old_active_task = {"id": "task-000", "tenant_id": "hotel-1", "status": "open", "created_at": "2020-01-01T00:00:00Z"}
    recent_active_tasks = [
        {"id": f"task-{index:03}", "tenant_id": "hotel-1", "status": "open", "created_at": f"2026-09-{index % 28 + 1:02}T00:00:00Z"}
        for index in range(1, 151)
    ]
    db = FakeDB({"tasks": [old_active_task, *recent_active_tasks], "guest_requests": [], "user_profiles": []})
    monkeypatch.setattr(tasks_router, "supabase", db)

    response = await tasks_router.get_task_workspace(
        history_page=1,
        history_per_page=20,
        current_user=CurrentUser(user_id="user-1", hotel_id="hotel-1", role="gm", email="gm@example.com"),
    )

    active_ids = {task["id"] for task in response["data"]["active"]["tasks"]}
    assert len(active_ids) == 151
    assert "task-000" in active_ids
    assert response["data"]["history"] == {"tasks": [], "guest_requests": []}


@pytest.mark.asyncio
async def test_get_task_attaches_display_names_to_comments(monkeypatch):
    """Task Detail Drawer Comments tab (Phase 4) needs a name per comment, not a
    raw auth.users id — and must never leak one comment's author onto another."""
    task = {
        "id": "task-1", "tenant_id": "hotel-1", "status": "open", "created_at": "2026-09-01T00:00:00Z",
        "task_comments": [
            {"id": "comment-1", "task_id": "task-1", "user_id": "staff-1", "comment": "On it", "is_system": False, "created_at": "2026-09-01T01:00:00Z"},
            {"id": "comment-2", "task_id": "task-1", "user_id": "staff-2", "comment": "Reassigned", "is_system": True, "created_at": "2026-09-01T02:00:00Z"},
        ],
    }
    db = FakeDB({
        "tasks": [task],
        "user_profiles": [
            {"id": "staff-1", "tenant_id": "hotel-1", "full_name": "Maria Santos", "preferred_name": None},
            {"id": "staff-2", "tenant_id": "hotel-1", "full_name": "Sarah Lopez", "preferred_name": None},
        ],
    })
    monkeypatch.setattr(tasks_router, "supabase", db)

    response = await tasks_router.get_task(
        "task-1",
        current_user=CurrentUser(user_id="gm-1", hotel_id="hotel-1", role="gm", email="gm@example.com"),
    )

    comments = {c["id"]: c for c in response["data"]["task_comments"]}
    assert comments["comment-1"]["user_profiles"]["full_name"] == "Maria Santos"
    assert comments["comment-2"]["user_profiles"]["full_name"] == "Sarah Lopez"


@pytest.mark.asyncio
async def test_workspace_history_search_filters_the_history_page_not_active_work(monkeypatch):
    """Phase 6: History search must be server-side (so a match outside the loaded
    history page is still found) and must never narrow Active, which is always
    fetched in full and filtered client-side instead."""
    active_task = {
        "id": "task-active", "tenant_id": "hotel-1", "status": "open",
        "title": "Unrelated open task", "description": None, "created_at": "2026-09-29T00:00:00Z",
    }
    history_tasks = [
        {"id": "task-h1", "tenant_id": "hotel-1", "status": "completed", "title": "Fix leaking sink",
         "description": None, "created_at": "2026-09-01T00:00:00Z"},
        {"id": "task-h2", "tenant_id": "hotel-1", "status": "completed", "title": "Replace lightbulb",
         "description": "Room 214 fixture", "created_at": "2026-09-02T00:00:00Z"},
    ]
    db = _WorkspaceSearchDB(tasks=[active_task, *history_tasks], guest_requests=[])
    monkeypatch.setattr(tasks_router, "supabase", db)

    response = await tasks_router.get_task_workspace(
        history_page=1,
        history_per_page=50,
        history_search="leak",
        current_user=CurrentUser(user_id="user-1", hotel_id="hotel-1", role="gm", email="gm@example.com"),
    )

    active_ids = {task["id"] for task in response["data"]["active"]["tasks"]}
    history_ids = {task["id"] for task in response["data"]["history"]["tasks"]}
    assert active_ids == {"task-active"}
    assert history_ids == {"task-h1"}

    # A term matching description, not title, still matches (Room 214 fixture).
    response = await tasks_router.get_task_workspace(
        history_page=1,
        history_per_page=50,
        history_search="214",
        current_user=CurrentUser(user_id="user-1", hotel_id="hotel-1", role="gm", email="gm@example.com"),
    )
    assert {task["id"] for task in response["data"]["history"]["tasks"]} == {"task-h2"}
