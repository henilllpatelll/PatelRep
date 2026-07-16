"""Escalation notifications retain a delivery record for operational review."""

from routers import internal as internal_router
from tests.smoke.fake_supabase import FakeDB


def test_role_notification_records_a_successful_in_app_delivery(monkeypatch):
    db = FakeDB({
        "user_roles": [{
            "user_id": "gm-1",
            "tenant_id": "hotel-a",
            "role": "gm",
            "is_active": True,
        }],
        "notifications": [],
        "notification_deliveries": [],
    })
    monkeypatch.setattr(internal_router, "supabase", db)

    internal_router._notify_role(
        "hotel-a",
        "gm",
        "escalation_auto",
        "Auto-escalated: Room 214 leak",
        "Work order is overdue.",
        {"work_order_id": "wo-1"},
    )

    assert db.rows["notifications"][0]["user_id"] == "gm-1"
    assert db.rows["notification_deliveries"] == [{
        "id": "notification_deliveries-2",
        "tenant_id": "hotel-a",
        "notification_id": "notifications-1",
        "user_id": "gm-1",
        "channel": "in_app",
        "status": "delivered",
    }]
