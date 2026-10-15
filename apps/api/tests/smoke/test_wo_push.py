"""ENG-06: a claimed work order pushes to the engineer through the central policy."""
import pytest

from routers import work_orders as wo_module
from services import notify
from tests.smoke.fake_supabase import FakeDB

HOTEL = "hotel-a"


class _FakeExpo:
    sent: list = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json=None):
        type(self).sent.append((url, json))

        class Response:
            status_code = 200

            def json(self):
                return {"data": [{"status": "ok", "id": f"t{i}"} for i, _ in enumerate(json)]}

        return Response()


@pytest.mark.asyncio
async def test_send_wo_assignment_push_posts_to_expo(monkeypatch):
    db = FakeDB({
        "push_devices": [
            {"id": "d1", "tenant_id": HOTEL, "user_id": "engineer-1", "expo_push_token": "ExponentPushToken[test]", "revoked_at": None}
        ],
        "notification_preferences": [],
        "user_roles": [],
        "staff_role_schedules": [],
    })
    monkeypatch.setattr(notify, "supabase", db)
    _FakeExpo.sent = []
    monkeypatch.setattr(notify.httpx, "AsyncClient", _FakeExpo)

    await wo_module._send_wo_assignment_push(HOTEL, "engineer-1", "wo-abc", "Fix broken AC")

    assert len(_FakeExpo.sent) == 1
    message = _FakeExpo.sent[0][1][0]
    assert message["to"] == "ExponentPushToken[test]"
    assert message["data"]["url"] == "/(app)/work-orders/wo-abc"
    assert message["data"]["wo_id"] == "wo-abc"
    assert message["data"]["type"] == "wo_assignment"
    assert message["channelId"] == "alerts" and message["priority"] == "high"


@pytest.mark.asyncio
async def test_work_order_push_respects_an_engineers_opt_out(monkeypatch):
    db = FakeDB({
        "push_devices": [
            {"id": "d1", "tenant_id": HOTEL, "user_id": "engineer-1", "expo_push_token": "ExponentPushToken[test]", "revoked_at": None}
        ],
        "notification_preferences": [
            {"tenant_id": HOTEL, "user_id": "engineer-1", "category": "work_orders", "enabled": False}
        ],
        "user_roles": [{"tenant_id": HOTEL, "user_id": "engineer-1", "role": "engineer", "is_active": True}],
        "staff_role_schedules": [],
    })
    monkeypatch.setattr(notify, "supabase", db)
    _FakeExpo.sent = []
    monkeypatch.setattr(notify.httpx, "AsyncClient", _FakeExpo)

    await wo_module._send_wo_assignment_push(HOTEL, "engineer-1", "wo-abc", "Fix broken AC")

    assert _FakeExpo.sent == []
