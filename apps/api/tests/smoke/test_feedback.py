from types import SimpleNamespace

import pytest

from middleware.auth import CurrentUser
from models.requests import CreateFeedbackRequest
from routers import feedback as feedback_router


USER = CurrentUser(
    user_id="staff-1",
    hotel_id="hotel-1",
    role="housekeeper",
    email="housekeeper@example.com",
)


class FakeSupabase:
    def __init__(self):
        self.calls = []
        self.feedback_rows = []
        self.notifications = []
        self.user_roles = [
            {"user_id": "gm-1", "role": "gm"},
            {"user_id": "supervisor-1", "role": "housekeeping_supervisor"},
            {"user_id": "staff-1", "role": "housekeeper"},
        ]

    def table(self, name):
        return FakeQuery(self, name)

    def execute(self, query):
        self.calls.append((query.table_name, query.action, query.payload, query.filters))

        if query.table_name == "feedback_submissions":
            if query.action == "insert":
                row = {"id": "feedback-1", "created_at": "2026-05-28T17:10:00Z", **query.payload}
                self.feedback_rows.append(row)
                return SimpleNamespace(data=[row])
            if query.action == "update":
                for row in self.feedback_rows:
                    if row["id"] == query.filters.get("id"):
                        row.update(query.payload)
                        return SimpleNamespace(data=[row])
                return SimpleNamespace(data=[])

        if query.table_name == "user_roles":
            role_filter = query.filters.get("role")
            rows = [
                row
                for row in self.user_roles
                if row["role"] == role_filter and query.filters.get("tenant_id") == "hotel-1"
            ]
            return SimpleNamespace(data=rows)

        if query.table_name == "notifications":
            rows = []
            for payload in query.payload:
                row = {"id": f"notification-{len(self.notifications) + 1}", **payload}
                self.notifications.append(row)
                rows.append(row)
            return SimpleNamespace(data=rows)

        return SimpleNamespace(data=[])


class FakeQuery:
    def __init__(self, supabase, table_name):
        self.supabase = supabase
        self.table_name = table_name
        self.action = "select"
        self.payload = None
        self.filters = {}

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

    def execute(self):
        return self.supabase.execute(self)


@pytest.mark.asyncio
async def test_submit_feedback_stores_tenant_scoped_context_and_notifies_gms(monkeypatch):
    fake = FakeSupabase()
    webhook_payloads = []

    async def fake_notify(row):
        webhook_payloads.append(row)
        return "sent", None

    monkeypatch.setattr(feedback_router, "supabase", fake)
    monkeypatch.setattr(feedback_router, "_send_feedback_webhook", fake_notify)

    response = await feedback_router.submit_feedback(
        CreateFeedbackRequest(
            category="bug",
            severity="blocking",
            message="Room 214 button did not work",
            page_url="https://app.patelrep.com/housekeeping?x=1",
            pathname="/housekeeping",
            user_agent="Mozilla/5.0",
            browser_language="en-US",
            viewport_width=390,
            viewport_height=844,
            client_context={"room_id": "room-214", "screen": "room-board"},
        ),
        current_user=USER,
    )

    assert response["data"]["id"] == "feedback-1"
    row = fake.feedback_rows[0]
    assert row["tenant_id"] == "hotel-1"
    assert row["user_id"] == "staff-1"
    assert row["user_role"] == "housekeeper"
    assert row["pathname"] == "/housekeeping"
    assert row["viewport_width"] == 390
    assert row["client_context"]["room_id"] == "room-214"
    assert fake.notifications[0]["user_id"] == "gm-1"
    assert fake.notifications[0]["type"] == "feedback_submitted"
    assert fake.notifications[0]["tenant_id"] == "hotel-1"
    assert webhook_payloads[0]["message"] == "Room 214 button did not work"


@pytest.mark.asyncio
async def test_submit_feedback_does_not_fail_when_webhook_notification_fails(monkeypatch):
    fake = FakeSupabase()

    async def failing_notify(_row):
        return "failed", "timeout-secret-detail"

    monkeypatch.setattr(feedback_router, "supabase", fake)
    monkeypatch.setattr(feedback_router, "_send_feedback_webhook", failing_notify)

    response = await feedback_router.submit_feedback(
        CreateFeedbackRequest(
            category="confusing",
            severity="annoying",
            message="I was not sure where to tap next",
            pathname="/tasks",
        ),
        current_user=USER,
    )

    assert response["data"]["id"] == "feedback-1"
    assert fake.feedback_rows[0]["notification_status"] == "failed"
    assert "timeout-secret-detail" not in response["data"].get("notification_error", "")


@pytest.mark.asyncio
async def test_submit_feedback_accepts_message_only_payload(monkeypatch):
    fake = FakeSupabase()

    async def fake_notify(_row):
        return "not_configured", None

    monkeypatch.setattr(feedback_router, "supabase", fake)
    monkeypatch.setattr(feedback_router, "_send_feedback_webhook", fake_notify)

    response = await feedback_router.submit_feedback(
        CreateFeedbackRequest(message="The room board filter confused me"),
        current_user=USER,
    )

    assert response["data"]["id"] == "feedback-1"
    assert fake.feedback_rows[0]["category"] == "other"
    assert fake.feedback_rows[0]["severity"] == "annoying"
