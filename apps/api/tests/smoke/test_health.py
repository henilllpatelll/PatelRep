from fastapi.testclient import TestClient
import pytest

from middleware.auth import CurrentUser
from main import app
from routers import ai_copilot

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] in ("ok", "degraded")  # degraded is expected without real DB


def test_protected_endpoint_without_auth():
    response = client.get("/v1/rooms")
    assert response.status_code == 401  # No auth header


def test_protected_endpoint_with_invalid_token():
    response = client.get("/v1/rooms", headers={"Authorization": "Bearer invalid-token"})
    assert response.status_code == 401
    assert "Invalid token:" not in response.text


def test_health_does_not_return_database_exception(monkeypatch):
    class BrokenQuery:
        def select(self, *_args):
            return self

        def limit(self, *_args):
            return self

        def execute(self):
            raise RuntimeError("database-password-secret")

    class BrokenSupabase:
        def table(self, *_args):
            return BrokenQuery()

    import core.database as database
    monkeypatch.setattr(database, "supabase", BrokenSupabase())

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["db"] == "unavailable"
    assert "database-password-secret" not in response.text


@pytest.mark.asyncio
async def test_ai_copilot_generic_exception_uses_client_safe_message(monkeypatch):
    async def noop_log(**_kwargs):
        return None

    monkeypatch.setattr(ai_copilot, "_get_hotel_context", lambda _hotel_id: {
        "hotel_name": "Hotel A",
        "shift_name": "AM",
        "shift_start": "07:00",
        "shift_end": "15:00",
    })
    monkeypatch.setattr(ai_copilot, "parse_nl_tasks", lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("provider-secret-detail")))
    monkeypatch.setattr(ai_copilot, "log_ai_interaction", noop_log)

    with pytest.raises(Exception) as exc:
        await ai_copilot.copilot_chat(
            ai_copilot.CopilotChatRequest(message="Room 101 needs towels"),
            current_user=CurrentUser(user_id="user-a", hotel_id="hotel-a", role="gm"),
        )

    assert getattr(exc.value, "status_code", None) == 500
    assert "provider-secret-detail" not in exc.value.detail
