"""Mobile Settings Phase 4 - notification preferences and the central push policy.

Exercises the real delivery decision (services.notify.send_push), not just the preference endpoints.
"""
import re
from pathlib import Path

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from models.requests import SetNotificationPreferenceRequest
from routers import notifications as notifications_router
from services import notify
from tests.smoke.fake_supabase import FakeDB

H1, H2 = "hotel-1", "hotel-2"
HK = CurrentUser(user_id="hk-1", hotel_id=H1, role="housekeeper", email="hk@h.com")
ENG = CurrentUser(user_id="eng-1", hotel_id=H1, role="engineer", email="eng@h.com")
GM = CurrentUser(user_id="gm-1", hotel_id=H1, role="gm", email="gm@h.com")
TOK_HK = "ExponentPushToken[hk]"
TOK_ENG = "ExponentPushToken[eng]"


class FakeExpo:
    sent: list = []
    status = 200
    reply = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json=None):
        type(self).sent.append(json)
        outer = self

        class Response:
            status_code = outer.status

            def json(self):
                return outer.reply if outer.reply is not None else {"data": [{"status": "ok", "id": f"t{i}"} for i, _ in enumerate(json)]}

        return Response()


def make_db(**extra):
    rows = {
        "user_roles": [
            {"tenant_id": H1, "user_id": "hk-1", "role": "housekeeper", "is_active": True},
            {"tenant_id": H1, "user_id": "eng-1", "role": "engineer", "is_active": True},
            {"tenant_id": H1, "user_id": "gm-1", "role": "gm", "is_active": True},
        ],
        "staff_role_schedules": [],
        "notification_preferences": [],
        "push_devices": [
            {"id": "d-hk", "tenant_id": H1, "user_id": "hk-1", "expo_push_token": TOK_HK, "revoked_at": None},
            {"id": "d-eng", "tenant_id": H1, "user_id": "eng-1", "expo_push_token": TOK_ENG, "revoked_at": None},
        ],
        "notifications": [],
        "notification_deliveries": [],
    }
    rows.update(extra)
    return FakeDB(rows)


@pytest.fixture
def db(monkeypatch):
    fake = make_db()
    monkeypatch.setattr(notify, "supabase", fake)
    monkeypatch.setattr(notifications_router, "supabase", fake)
    FakeExpo.sent = []
    FakeExpo.status = 200
    FakeExpo.reply = None
    monkeypatch.setattr(notify.httpx, "AsyncClient", FakeExpo)
    return fake


def opt_out(db, user_id, category, tenant=H1):
    db.rows["notification_preferences"].append(
        {"tenant_id": tenant, "user_id": user_id, "category": category, "enabled": False}
    )


async def push(event, ids, **kw):
    return await notify.send_push(tenant_id=H1, recipient_ids=ids, event_type=event, title="T", body="B", **kw)


# --------------------------------------------------------------------------- preference endpoints


@pytest.mark.asyncio
async def test_defaults_are_on_and_listed_per_role(db):
    hk = (await notifications_router.get_notification_preferences(HK))["data"]["categories"]
    assert [(c["key"], c["enabled"]) for c in hk] == [("room_assignments", True), ("tasks", True)]
    eng = (await notifications_router.get_notification_preferences(ENG))["data"]["categories"]
    assert [c["key"] for c in eng] == ["work_orders", "tasks"]
    gm = (await notifications_router.get_notification_preferences(GM))["data"]["categories"]
    assert [c["key"] for c in gm] == ["tasks"]


@pytest.mark.asyncio
async def test_only_the_tasks_category_is_flagged_as_containing_a_critical_alert(db):
    hk = (await notifications_router.get_notification_preferences(HK))["data"]["categories"]
    assert {c["key"]: c["has_critical"] for c in hk} == {"room_assignments": False, "tasks": True}


@pytest.mark.asyncio
async def test_a_saved_preference_persists_and_is_read_back(db):
    await notifications_router.set_notification_preference("tasks", SetNotificationPreferenceRequest(enabled=False), HK)
    cats = (await notifications_router.get_notification_preferences(HK))["data"]["categories"]
    assert {c["key"]: c["enabled"] for c in cats}["tasks"] is False
    await notifications_router.set_notification_preference("tasks", SetNotificationPreferenceRequest(enabled=True), HK)
    cats = (await notifications_router.get_notification_preferences(HK))["data"]["categories"]
    assert {c["key"]: c["enabled"] for c in cats}["tasks"] is True
    assert len(db.rows["notification_preferences"]) == 1  # one row per (person, category), never duplicated


@pytest.mark.asyncio
async def test_the_caller_can_only_ever_write_their_own_row(db):
    await notifications_router.set_notification_preference("tasks", SetNotificationPreferenceRequest(enabled=False), HK)
    assert [(r["tenant_id"], r["user_id"]) for r in db.rows["notification_preferences"]] == [(H1, "hk-1")]
    # Another employee's saved choice is neither visible to nor changed by someone else's calls.
    opt_out(db, "eng-1", "tasks")
    cats = (await notifications_router.get_notification_preferences(HK))["data"]["categories"]
    assert {c["key"]: c["enabled"] for c in cats}["tasks"] is False
    await notifications_router.set_notification_preference("tasks", SetNotificationPreferenceRequest(enabled=True), HK)
    eng_row = next(r for r in db.rows["notification_preferences"] if r["user_id"] == "eng-1")
    assert eng_row["enabled"] is False


@pytest.mark.asyncio
async def test_preferences_are_scoped_to_the_callers_hotel(db):
    opt_out(db, "hk-1", "tasks", tenant=H2)  # a row under another property is not this property's setting
    cats = (await notifications_router.get_notification_preferences(HK))["data"]["categories"]
    assert {c["key"]: c["enabled"] for c in cats}["tasks"] is True


@pytest.mark.asyncio
async def test_an_unknown_category_is_rejected(db):
    with pytest.raises(HTTPException) as err:
        await notifications_router.set_notification_preference("sms_blast", SetNotificationPreferenceRequest(enabled=False), HK)
    assert err.value.status_code == 404
    assert db.rows["notification_preferences"] == []


@pytest.mark.asyncio
async def test_a_category_outside_the_callers_role_is_forbidden(db):
    with pytest.raises(HTTPException) as err:
        await notifications_router.set_notification_preference("work_orders", SetNotificationPreferenceRequest(enabled=False), HK)
    assert err.value.status_code == 403
    with pytest.raises(HTTPException) as err:
        await notifications_router.set_notification_preference("room_assignments", SetNotificationPreferenceRequest(enabled=False), GM)
    assert err.value.status_code == 403


@pytest.mark.asyncio
async def test_a_schedule_override_changes_which_categories_are_visible_and_editable(db):
    from datetime import date

    db_day = (date.today().weekday() + 1) % 7
    db.rows["staff_role_schedules"].append(
        {"id": "s1", "hotel_id": H1, "user_id": "eng-1", "override_role": "housekeeper",
         "days_of_week": [db_day], "start_date": None, "end_date": None, "is_active": True}
    )
    cats = (await notifications_router.get_notification_preferences(ENG))["data"]["categories"]
    assert [c["key"] for c in cats] == ["room_assignments", "work_orders", "tasks"]
    await notifications_router.set_notification_preference("room_assignments", SetNotificationPreferenceRequest(enabled=False), ENG)


@pytest.mark.asyncio
async def test_unread_count_is_exact_beyond_the_list_cap(db):
    db.rows["notifications"] = [
        {"id": f"n{i}", "tenant_id": H1, "user_id": "hk-1", "is_read": False} for i in range(35)
    ] + [
        {"id": "r1", "tenant_id": H1, "user_id": "hk-1", "is_read": True},
        {"id": "other", "tenant_id": H1, "user_id": "eng-1", "is_read": False},
        {"id": "other-hotel", "tenant_id": H2, "user_id": "hk-1", "is_read": False},
    ]
    assert (await notifications_router.unread_count(HK))["data"]["count"] == 35


# --------------------------------------------------------------------------- delivery decisions


@pytest.mark.asyncio
async def test_default_recipient_with_a_device_receives_the_push(db):
    result = await push("room_assignment", ["hk-1"], data={"url": "/(app)/my-rooms/r1"})
    assert result["sent"] == 1
    message = FakeExpo.sent[0][0]
    assert message["to"] == TOK_HK and message["channelId"] == "alerts" and message["priority"] == "high"
    assert message["data"] == {"url": "/(app)/my-rooms/r1", "type": "room_assignment"}


@pytest.mark.asyncio
async def test_an_opt_out_stops_optional_push_but_never_touches_the_inbox_row(db):
    opt_out(db, "hk-1", "tasks")
    db.rows["notifications"].append({"id": "n1", "tenant_id": H1, "user_id": "hk-1", "type": "task_assigned", "is_read": False})
    result = await push("task_assigned", ["hk-1"], notification_ids={"hk-1": "n1"})
    assert result["opted_out"] == ["hk-1"] and result["sent"] == 0 and FakeExpo.sent == []
    assert [n["id"] for n in db.rows["notifications"]] == ["n1"]  # the inbox record is intact
    assert db.rows["notification_deliveries"] == []  # nothing claimed as sent


@pytest.mark.asyncio
async def test_an_opt_out_applies_only_to_its_own_category(db):
    opt_out(db, "hk-1", "tasks")
    assert (await push("room_assignment", ["hk-1"]))["sent"] == 1


@pytest.mark.asyncio
async def test_a_critical_alert_is_delivered_even_when_the_category_is_off(db):
    opt_out(db, "hk-1", "tasks")
    result = await push("task_assigned_urgent", ["hk-1"])
    assert result["sent"] == 1 and result["opted_out"] == []
    assert FakeExpo.sent[0][0]["channelId"] == "alerts"


@pytest.mark.asyncio
async def test_an_opt_out_for_a_category_the_person_no_longer_has_a_role_for_is_dormant(db):
    # An engineer once switched room_assignments off while acting as a housekeeper; today they only work as an
    # engineer, so that choice cannot silence anything and is simply not shown.
    opt_out(db, "eng-1", "room_assignments")
    assert (await push("room_assignment", ["eng-1"]))["sent"] == 1


@pytest.mark.asyncio
async def test_an_opt_out_applies_while_a_schedule_override_makes_the_category_relevant(db):
    from datetime import date

    opt_out(db, "eng-1", "room_assignments")
    db.rows["staff_role_schedules"].append(
        {"id": "s1", "hotel_id": H1, "user_id": "eng-1", "override_role": "housekeeper",
         "days_of_week": [(date.today().weekday() + 1) % 7], "start_date": None, "end_date": None, "is_active": True}
    )
    result = await push("room_assignment", ["eng-1"])
    assert result["opted_out"] == ["eng-1"] and FakeExpo.sent == []


@pytest.mark.asyncio
async def test_a_preference_never_creates_a_push_for_an_unclassified_or_inbox_only_event(db):
    assert (await push("made_up_event", ["hk-1"]))["sent"] == 0
    assert (await push("escalation_tier1", ["hk-1"]))["sent"] == 0  # inbox-only events never push
    assert FakeExpo.sent == []


@pytest.mark.asyncio
async def test_one_person_with_two_phones_gets_one_message_per_phone(db):
    db.rows["push_devices"].append(
        {"id": "d-hk2", "tenant_id": H1, "user_id": "hk-1", "expo_push_token": "ExponentPushToken[hk-tablet]", "revoked_at": None}
    )
    result = await push("task_assigned", ["hk-1"])
    assert result["sent"] == 2
    assert sorted(m["to"] for m in FakeExpo.sent[0]) == sorted([TOK_HK, "ExponentPushToken[hk-tablet]"])


@pytest.mark.asyncio
async def test_a_repeated_recipient_or_token_is_messaged_once(db):
    db.rows["push_devices"].append(
        {"id": "d-dup", "tenant_id": H1, "user_id": "hk-1", "expo_push_token": TOK_HK, "revoked_at": None}
    )
    result = await push("task_assigned", ["hk-1", "hk-1"])
    assert result["sent"] == 1 and len(FakeExpo.sent[0]) == 1


@pytest.mark.asyncio
async def test_revoked_devices_and_other_hotels_receive_nothing(db):
    db.rows["push_devices"][0]["revoked_at"] = "2026-10-01T00:00:00+00:00"
    db.rows["push_devices"].append(
        {"id": "d-other", "tenant_id": H2, "user_id": "hk-1", "expo_push_token": "ExponentPushToken[elsewhere]", "revoked_at": None}
    )
    result = await push("room_assignment", ["hk-1"])
    assert result["sent"] == 0 and result["no_device"] == ["hk-1"] and FakeExpo.sent == []


@pytest.mark.asyncio
async def test_a_provider_outage_or_malformed_reply_never_raises_or_claims_success(db):
    FakeExpo.status = 503
    result = await push("room_assignment", ["hk-1"], notification_ids={"hk-1": "n1"})
    assert result["sent"] == 0 and result["failed"] == 1
    assert db.rows["push_devices"][0]["revoked_at"] is None  # a transient failure does not detach the phone
    FakeExpo.status = 200
    FakeExpo.reply = {"data": "garbage"}
    assert (await push("room_assignment", ["hk-1"]))["failed"] == 1


@pytest.mark.asyncio
async def test_a_dead_install_is_detached_so_it_is_not_messaged_again(db):
    FakeExpo.reply = {"data": [{"status": "error", "message": "x", "details": {"error": "DeviceNotRegistered"}}]}
    await push("room_assignment", ["hk-1"])
    assert db.rows["push_devices"][0]["revoke_reason"] == "device_not_registered"
    FakeExpo.sent.clear()
    FakeExpo.reply = None
    assert (await push("room_assignment", ["hk-1"]))["no_device"] == ["hk-1"]


# --------------------------------------------------------------------------- policy contract

API_ROOT = Path(__file__).resolve().parents[1]
PRODUCER_DIRS = ("routers", "services")


def _py_files():
    for folder in PRODUCER_DIRS:
        yield from (API_ROOT / folder).rglob("*.py")


def test_every_notification_type_a_producer_writes_is_classified():
    """A new producer must add its type to notify.PUSH_EVENTS or INBOX_ONLY_EVENTS, so it can never get
    default push handling by accident."""
    written: set[str] = set()
    for path in _py_files():
        text = path.read_text(encoding="utf-8")
        if 'table("notifications").insert' not in text and "notifications\")\\" not in text and "_notify_role" not in text:
            continue
        for match in re.finditer(r'"type":\s*"([a-z][a-z0-9_]*)"', text):
            written.add(match.group(1))
        # _notify_role(hotel_id, role, "<type>", ...): the type is the third argument.
        for match in re.finditer(r'_notify_role\(\s*[^,]+,\s*[^,]+,\s*"([a-z][a-z0-9_]*)"', text):
            written.add(match.group(1))
    from routers.tasks import TASK_EVENT_TEXT  # the task producers pick one of these event names
    # Not notification types: JSON-schema style "type" keys that happen to live in the same files.
    written -= {"object", "string", "number", "integer", "array", "boolean"}
    written |= set(TASK_EVENT_TEXT)
    unknown = sorted(t for t in written if not notify.known_event(t))
    assert unknown == [], f"notification types missing from services/notify.py: {unknown}"


def test_no_producer_sends_push_around_the_central_policy():
    offenders = [
        str(p.relative_to(API_ROOT))
        for p in _py_files()
        if p.name != "notify.py" and "exp.host" in p.read_text(encoding="utf-8")
    ]
    assert offenders == [], f"push must go through services.notify.send_push: {offenders}"


def test_policy_registry_is_internally_consistent():
    for event, policy in notify.PUSH_EVENTS.items():
        assert policy.category in notify.CATEGORIES, event
        assert policy.channel in (notify.CHANNEL_ALERTS, notify.CHANNEL_UPDATES), event
    assert not (set(notify.PUSH_EVENTS) & notify.INBOX_ONLY_EVENTS)
    assert notify.critical_category_keys() == {"tasks"}
    for category in notify.CATEGORIES.values():
        assert category.roles and all(r in notify.ALL_STAFF_ROLES for r in category.roles)
