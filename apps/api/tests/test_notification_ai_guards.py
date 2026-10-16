"""Mobile Housekeeper AI V2, Phase 6 - the notification path stays rule-based.

An AI feature may explain a notification, but it must never create, escalate or push one on its own, and
the inbox must never cross hotels or people. These pin the existing central policy against that drift;
they do not change it.
"""
import re
from pathlib import Path

import pytest

from middleware.auth import CurrentUser
from routers import notifications as notifications_router
from services import notify
from tests.smoke.fake_supabase import FakeDB

H1, H2 = "hotel-1", "hotel-2"
HK = CurrentUser(user_id="hk-1", hotel_id=H1, role="housekeeper", email="hk@h.com")


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB(
        {
            "notifications": [
                {"id": "mine-new", "tenant_id": H1, "user_id": "hk-1", "is_read": False, "type": "task_assigned", "created_at": "2026-10-15T10:00:00+00:00"},
                {"id": "mine-read", "tenant_id": H1, "user_id": "hk-1", "is_read": True, "type": "broadcast", "created_at": "2026-10-15T09:00:00+00:00"},
                {"id": "colleague", "tenant_id": H1, "user_id": "hk-2", "is_read": False, "type": "task_assigned", "created_at": "2026-10-15T10:00:00+00:00"},
                {"id": "other-hotel", "tenant_id": H2, "user_id": "hk-1", "is_read": False, "type": "task_assigned", "created_at": "2026-10-15T10:00:00+00:00"},
            ]
        }
    )
    monkeypatch.setattr(notifications_router, "supabase", fake)
    return fake


@pytest.mark.asyncio
async def test_the_inbox_lists_only_this_persons_rows_in_this_hotel(db):
    unread = (await notifications_router.list_notifications(is_read=False, limit=20, current_user=HK))["data"]
    everything = (await notifications_router.list_notifications(is_read=True, limit=20, current_user=HK))["data"]
    assert [row["id"] for row in unread] == ["mine-new"]
    assert sorted(row["id"] for row in everything) == ["mine-new", "mine-read"]


@pytest.mark.asyncio
async def test_marking_read_cannot_touch_a_colleagues_or_another_hotels_row(db):
    await notifications_router.mark_read("colleague", HK)
    await notifications_router.mark_read("other-hotel", HK)
    flags = {row["id"]: row["is_read"] for row in db.rows["notifications"]}
    assert flags["colleague"] is False and flags["other-hotel"] is False
    await notifications_router.mark_read("mine-new", HK)
    assert {row["id"]: row["is_read"] for row in db.rows["notifications"]}["mine-new"] is True


def test_the_only_critical_push_is_the_reviewed_urgent_task_alert():
    critical = {event for event, policy in notify.PUSH_EVENTS.items() if policy.critical}
    assert critical == {"task_assigned_urgent"}


def test_no_notification_type_is_ai_generated():
    events = set(notify.PUSH_EVENTS) | set(notify.INBOX_ONLY_EVENTS)
    assert not [event for event in events if re.match(r"^(ai|llm|copilot|assistant)[_-]", event)]


def test_ai_modules_never_choose_push_or_criticality():
    """AI services may write an inbox row from a numeric rule (risk over a threshold); they may not push,
    and no model output may decide a notification's channel or criticality."""
    root = Path(__file__).resolve().parent.parent / "services" / "ai"
    offenders = []
    for path in sorted(root.glob("*.py")):
        source = path.read_text(encoding="utf-8")
        if re.search(r"\bsend_push\b|PushPolicy|\bcritical\s*=|CHANNEL_ALERTS", source):
            offenders.append(path.name)
    assert offenders == []


def test_the_shift_recap_and_assistant_write_no_notification():
    root = Path(__file__).resolve().parent.parent
    for relative in ("services/ai/housekeeper_shift_recap.py", "services/ai/sop_rag.py", "services/ai/sop_access.py"):
        source = (root / relative).read_text(encoding="utf-8")
        assert not re.search(r'table\(\s*"notifications"\s*\)', source), relative
