"""Engineering inbox events: room availability changes, PM due, and repair follow-up needed.

Inbox rows for the chief engineers (and the engineer on a linked repair). One unread row per (person, event,
subject); the person who made the change is never alerted about their own action; a notification problem never
fails the change it reports.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from models.requests import CompleteWorkOrderRequest, CreateRoomUnavailabilityRequest, ReleaseRoomUnavailabilityRequest
from routers import internal as internal_router
from routers import room_unavailability as ru_router
from routers import work_orders as wo_router
from services import engineering_notify, notify
from services import pm_schedules as pm_service
from tests.smoke.fake_supabase import FakeDB

H1, H2 = "hotel-1", "hotel-2"
CHIEF, CHIEF2, ENG, GM, OTHER_HOTEL_CHIEF = "chief-1", "chief-2", "eng-1", "gm-1", "chief-h2"
ROOM = str(uuid.uuid4())
WO = str(uuid.uuid4())
ACTOR = CurrentUser(user_id=ENG, hotel_id=H1, role="engineer", email="e@h.com")
CHIEF_USER = CurrentUser(user_id=CHIEF, hotel_id=H1, role="chief_engineer", email="c@h.com")


def _db(**extra):
    rows = {
        "user_roles": [
            {"tenant_id": H1, "user_id": CHIEF, "role": "chief_engineer", "is_active": True},
            {"tenant_id": H1, "user_id": CHIEF2, "role": "chief_engineer", "is_active": True},
            {"tenant_id": H1, "user_id": ENG, "role": "engineer", "is_active": True},
            {"tenant_id": H1, "user_id": GM, "role": "gm", "is_active": True},
            {"tenant_id": H2, "user_id": OTHER_HOTEL_CHIEF, "role": "chief_engineer", "is_active": True},
        ],
        "rooms": [{"id": ROOM, "tenant_id": H1, "room_number": "415"}],
        "work_orders": [{"id": WO, "tenant_id": H1, "assigned_to": ENG, "status": "in_progress", "title": "Sink leak", "category": "plumbing"}],
        "room_unavailability_periods": [{"id": "p1", "tenant_id": H1, "room_id": ROOM, "primary_work_order_id": WO}],
        "notifications": [], "operational_audit_events": [],
    }
    rows.update(extra)
    db = FakeDB(rows)
    db.rpc = lambda name, params: SimpleNamespace(execute=lambda: SimpleNamespace(data={"id": "p1"}))
    return db


def _install(monkeypatch, db):
    for module in (engineering_notify, ru_router, wo_router, internal_router, pm_service):
        monkeypatch.setattr(module, "supabase", db)


def _by_type(db, event):
    return [(n["user_id"], n["data"]) for n in db.rows["notifications"] if n["type"] == event]


def _create(user, wo=WO):
    return ru_router.create_period(
        CreateRoomUnavailabilityRequest(
            room_id=ROOM, reason_code="PLUMBING", reason_label="Plumbing",
            expected_return_at=datetime.now(timezone.utc) + timedelta(hours=6), primary_work_order_id=wo,
        ),
        user,
    )


def test_events_are_registered_as_inbox_only():
    for event in ("wo_verification_required", "room_availability_changed", "pm_due", "wo_reassigned"):
        assert event in notify.INBOX_ONLY_EVENTS and event not in notify.PUSH_EVENTS


@pytest.mark.asyncio
async def test_room_down_alerts_the_chiefs_and_the_repair_engineer_but_not_the_actor(monkeypatch):
    db = _db()
    _install(monkeypatch, db)
    await _create(CHIEF_USER)  # the chief makes the change
    rows = _by_type(db, "room_availability_changed")
    assert {user for user, _ in rows} == {CHIEF2, ENG}  # not the actor, not another hotel, not the GM
    assert all(data["url"] == f"/(app)/room-status/{ROOM}" and data["room_id"] == ROOM for _, data in rows)
    assert "415" in db.rows["notifications"][0]["body"]


@pytest.mark.asyncio
async def test_a_repeated_change_does_not_stack_unread_alerts(monkeypatch):
    db = _db()
    _install(monkeypatch, db)
    await _create(CHIEF_USER)
    await _create(CHIEF_USER)
    assert len(_by_type(db, "room_availability_changed")) == 2  # still one per person


@pytest.mark.asyncio
async def test_release_alerts_with_a_release_message(monkeypatch):
    db = _db()
    _install(monkeypatch, db)
    await ru_router.release_period("p1", ReleaseRoomUnavailabilityRequest(release_notes="Fixed", source="WEB"), ACTOR)
    assert {user for user, _ in _by_type(db, "room_availability_changed")} == {CHIEF, CHIEF2}
    assert db.rows["notifications"][0]["title"] == "Room back in availability"


@pytest.mark.asyncio
async def test_a_notification_failure_never_fails_the_availability_change(monkeypatch):
    db = _db()
    _install(monkeypatch, db)
    monkeypatch.setattr(engineering_notify, "supabase", None)  # every notification call would raise
    result = await _create(CHIEF_USER)
    assert result["data"] == {"id": "p1"}


@pytest.mark.asyncio
async def test_pm_generated_work_order_alerts_the_chiefs_once(monkeypatch):
    pm = {"id": "pm-1", "name": "Quarterly HVAC", "description": "", "interval_type": "monthly", "interval_days": None,
          "next_due_at": "2026-01-01T00:00:00+00:00", "recurrence_basis": "scheduled_date", "is_active": True,
          "assets": {"tenant_id": H1, "id": "asset-1", "name": "AHU"}}
    db = _db(pm_schedules=[pm], work_orders=[])
    _install(monkeypatch, db)
    response = await internal_router.check_due_pm(x_cron_secret=internal_router.settings.cron_secret)
    assert response["pm_work_orders_created"] == 1
    rows = _by_type(db, "pm_due")
    assert {user for user, _ in rows} == {CHIEF, CHIEF2}
    new_wo = db.rows["work_orders"][0]["id"]
    assert all(data["url"] == f"/(app)/work-orders/{new_wo}" and data["pm_schedule_id"] == "pm-1" for _, data in rows)
    # the next run finds the open PM work order and neither duplicates it nor alerts again
    again = await internal_router.check_due_pm(x_cron_secret=internal_router.settings.cron_secret)
    assert again["pm_work_orders_created"] == 0 and len(_by_type(db, "pm_due")) == 2


@pytest.mark.asyncio
async def test_failed_verification_asks_the_chiefs_to_follow_up(monkeypatch):
    db = _db()
    _install(monkeypatch, db)
    with pytest.raises(HTTPException) as err:
        await wo_router.complete_work_order(WO, CompleteWorkOrderRequest(verification_result="failed", verification_notes="Still leaking"), ACTOR)
    assert err.value.status_code == 409
    rows = _by_type(db, "wo_verification_required")
    assert {user for user, _ in rows} == {CHIEF, CHIEF2}
    assert all(data["url"] == f"/(app)/work-orders/{WO}" for _, data in rows)
    assert db.rows["work_orders"][0]["status"] == "in_progress"  # still a repair in progress, never a false close


@pytest.mark.asyncio
async def test_a_passed_verification_sends_no_follow_up_alert(monkeypatch):
    db = _db()
    _install(monkeypatch, db)
    monkeypatch.setattr(wo_router, "_execute_work_order_transition", lambda **_k: SimpleNamespace(data=[{"id": WO}]), raising=False)
    try:
        await wo_router.complete_work_order(WO, CompleteWorkOrderRequest(verification_result="passed"), ACTOR)
    except Exception:  # noqa: BLE001 - the rest of the completion flow is not under test here
        pass
    await asyncio.sleep(0)
    assert _by_type(db, "wo_verification_required") == []
