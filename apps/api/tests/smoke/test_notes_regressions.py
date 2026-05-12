from types import SimpleNamespace

import pytest
from postgrest.exceptions import APIError
from starlette.requests import Request

import main
from middleware.auth import CurrentUser
from models.requests import CreateGuestRequestRequest, UpdateTaskRequest
from routers import guest_requests as guest_requests_router
from routers import tasks as tasks_router


USER = CurrentUser(
    user_id="user-1",
    hotel_id="hotel-1",
    role="gm",
    email="gm@example.com",
)


class FakeSupabase:
    def __init__(self):
        self.calls = []
        self.comments = []
        self.tasks = {
            "task-1": {
                "id": "task-1",
                "tenant_id": "hotel-1",
                "title": "Original task",
                "status": "open",
            }
        }
        self.guest_requests = {
            "gr-1": {
                "id": "gr-1",
                "tenant_id": "hotel-1",
                "title": "Original request",
                "status": "open",
                "task_id": "task-1",
            }
        }

    def table(self, name):
        return FakeQuery(self, name)

    def execute(self, query):
        self.calls.append((query.table_name, query.action, query.payload, query.filters))

        if query.table_name == "tasks":
            return self._execute_tasks(query)
        if query.table_name == "guest_requests":
            return self._execute_guest_requests(query)
        if query.table_name == "task_comments":
            row = {"id": f"comment-{len(self.comments) + 1}", **query.payload}
            self.comments.append(row)
            return SimpleNamespace(data=[row])

        return SimpleNamespace(data=[])

    def _execute_tasks(self, query):
        if query.action == "insert":
            row = {"id": f"task-{len(self.tasks) + 1}", **query.payload}
            self.tasks[row["id"]] = row
            return SimpleNamespace(data=[row])

        task_id = query.filters.get("id")
        row = self.tasks.get(task_id)
        if not row:
            return SimpleNamespace(data=None if query.single else [])

        if query.action == "update":
            row.update(query.payload)
            return SimpleNamespace(data=[row])

        return SimpleNamespace(data=row if query.single else [row])

    def _execute_guest_requests(self, query):
        if query.action == "insert":
            row = {"id": f"gr-{len(self.guest_requests) + 1}", "task_id": None, **query.payload}
            self.guest_requests[row["id"]] = row
            return SimpleNamespace(data=[row])

        request_id = query.filters.get("id")
        row = self.guest_requests.get(request_id)
        if not row:
            return SimpleNamespace(data=None if query.single else [])

        if query.action == "update":
            row.update(query.payload)
            return SimpleNamespace(data=[row])

        return SimpleNamespace(data=row if query.single else [row])


class FakeQuery:
    def __init__(self, supabase, table_name):
        self.supabase = supabase
        self.table_name = table_name
        self.action = "select"
        self.payload = None
        self.filters = {}
        self.single = False

    def insert(self, payload):
        self.action = "insert"
        self.payload = payload
        return self

    def update(self, payload):
        self.action = "update"
        self.payload = payload
        return self

    def select(self, _columns):
        self.action = "select"
        return self

    def eq(self, column, value):
        self.filters[column] = value
        return self

    def maybe_single(self):
        self.single = True
        return self

    def execute(self):
        return self.supabase.execute(self)


@pytest.mark.asyncio
async def test_task_update_maps_notes_to_task_comments(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(tasks_router, "supabase", fake)

    response = await tasks_router.update_task(
        "task-1",
        UpdateTaskRequest(status="completed", notes="Finished at front desk"),
        current_user=USER,
    )

    task_update = next(call for call in fake.calls if call[0] == "tasks" and call[1] == "update")
    assert "notes" not in task_update[2]
    assert response["data"]["status"] == "completed"
    assert fake.comments[0]["comment"] == "Finished at front desk"
    assert fake.comments[0]["task_id"] == "task-1"


@pytest.mark.asyncio
async def test_guest_request_update_does_not_forward_notes_or_assigned_to(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(guest_requests_router, "supabase", fake)

    response = await guest_requests_router.update_guest_request(
        "gr-1",
        {
            "status": "resolved",
            "notes": "Guest confirmed delivery",
            "assigned_to": "user-2",
        },
        current_user=USER,
    )

    guest_update = next(
        call for call in fake.calls if call[0] == "guest_requests" and call[1] == "update"
    )
    assert "notes" not in guest_update[2]
    assert "assigned_to" not in guest_update[2]
    assert response["data"]["status"] == "resolved"
    assert response["data"]["resolved_by"] == USER.user_id
    assert fake.comments[0]["comment"] == "Guest confirmed delivery"
    assert fake.comments[0]["task_id"] == "task-1"


@pytest.mark.asyncio
async def test_guest_request_create_returns_refreshed_task_id(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(guest_requests_router, "supabase", fake)

    response = await guest_requests_router.create_guest_request(
        CreateGuestRequestRequest(title="Need towels", description="Room asked for towels"),
        current_user=USER,
    )

    assert response["data"]["task_id"] == "task-2"


@pytest.mark.asyncio
async def test_postgrest_schema_error_returns_safe_422():
    request = Request(
        {
            "type": "http",
            "method": "PATCH",
            "path": "/v1/tasks/task-1",
            "headers": [],
        }
    )
    exc = APIError(
        {
            "code": "PGRST204",
            "message": "Could not find the notes column of tasks in the schema cache",
            "details": None,
            "hint": None,
        }
    )

    response = await main.postgrest_exception_handler(request, exc)

    assert response.status_code == 422
    assert b"notes column" not in response.body
    assert b"One or more fields are not supported" in response.body
