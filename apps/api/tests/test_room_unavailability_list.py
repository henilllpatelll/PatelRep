import pytest

from middleware.auth import CurrentUser
from routers import room_unavailability as router
from tests.smoke.fake_supabase import FakeDB


USER = CurrentUser(user_id="engineer-1", hotel_id="hotel-1", role="engineer", email="engineer@example.com")


@pytest.mark.asyncio
async def test_list_periods_can_scope_released_history_to_one_room(monkeypatch):
    db = FakeDB({
        "room_unavailability_periods": [
            {"id": "target", "tenant_id": "hotel-1", "room_id": "room-a", "status": "RELEASED", "started_at": "2026-09-25T10:00:00Z", "expected_return_at": None},
            {"id": "other-room", "tenant_id": "hotel-1", "room_id": "room-b", "status": "RELEASED", "started_at": "2026-09-25T11:00:00Z", "expected_return_at": None},
            {"id": "active", "tenant_id": "hotel-1", "room_id": "room-a", "status": "ACTIVE", "started_at": "2026-09-25T12:00:00Z", "expected_return_at": None},
        ]
    })
    monkeypatch.setattr(router, "supabase", db)

    response = await router.list_periods(status="RELEASED", room_id="room-a", returned_today=False, current_user=USER)

    assert [row["id"] for row in response["data"]] == ["target"]
