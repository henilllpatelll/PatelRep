"""Phase 8 (housekeeping redesign): Rush/priority, DND attempts, service
declined, and occupancy discrepancy workflows in routers/rooms.py."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from models.requests import (
    RecordServiceAttemptRequest,
    ReportOccupancyDiscrepancyRequest,
    ResolveOccupancyDiscrepancyRequest,
    ServiceDeclinedRequest,
    SetRoomPriorityRequest,
)
from routers import rooms as rooms_router

from .fake_supabase import FakeDB

HOTEL = "hotel-a"
ROOM_ID = "room-1"

SUPERVISOR = CurrentUser(user_id="sup-1", hotel_id=HOTEL, role="housekeeping_supervisor", email="sup@example.com")
FRONT_DESK = CurrentUser(user_id="fd-1", hotel_id=HOTEL, role="front_desk", email="fd@example.com")
HOUSEKEEPER = CurrentUser(user_id="hk-1", hotel_id=HOTEL, role="housekeeper", email="hk@example.com")


def make_db(room_overrides: dict | None = None):
    room_row = {
        "room_id": ROOM_ID,
        "tenant_id": HOTEL,
        "status": "DIRTY",
        "priority": 5,
        "priority_reason": None,
        "dnd_flag": False,
        "dnd_attempt_count": 0,
        "fo_status": "VAC",
        **(room_overrides or {}),
    }
    return FakeDB({
        "room_status": [room_row],
        "rooms": [{"id": ROOM_ID, "tenant_id": HOTEL, "room_number": "101"}],
        "room_service_attempts": [],
        "room_occupancy_discrepancies": [],
        "operational_audit_events": [],
        "room_status_history": [],
        "user_roles": [],
        "notifications": [],
        "notification_deliveries": [],
    })


def current_room(db):
    return db.rows["room_status"][0]


# ---------------------------------------------------------------------------
# Rush / priority
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_set_priority_rush_requires_reason():
    with pytest.raises(ValueError):
        SetRoomPriorityRequest(priority_state="rush")


@pytest.mark.asyncio
async def test_set_priority_rush_sets_priority_one_and_metadata(monkeypatch):
    db = make_db()
    monkeypatch.setattr(rooms_router, "supabase", db)

    body = SetRoomPriorityRequest(priority_state="rush", reason="guest_waiting", note="Guest in lobby")
    result = await rooms_router.set_room_priority(ROOM_ID, body, SUPERVISOR)

    assert result["data"]["priority"] == 1
    assert current_room(db)["priority"] == 1
    assert current_room(db)["priority_reason"] == "guest_waiting"
    assert current_room(db)["priority_set_by"] == SUPERVISOR.user_id
    events = db.rows["operational_audit_events"]
    assert any(e["resource_type"] == "room" and e["action"] == "rush_set" for e in events)


@pytest.mark.asyncio
async def test_clear_priority_resets_to_normal_and_nulls_metadata(monkeypatch):
    db = make_db(room_overrides={"priority": 1, "priority_reason": "vip"})
    monkeypatch.setattr(rooms_router, "supabase", db)

    body = SetRoomPriorityRequest(priority_state="normal")
    await rooms_router.set_room_priority(ROOM_ID, body, SUPERVISOR)

    room = current_room(db)
    assert room["priority"] == 5
    assert room["priority_reason"] is None


@pytest.mark.asyncio
async def test_set_priority_404_for_unknown_room(monkeypatch):
    db = make_db()
    monkeypatch.setattr(rooms_router, "supabase", db)

    with pytest.raises(HTTPException) as exc_info:
        await rooms_router.set_room_priority(
            "missing-room", SetRoomPriorityRequest(priority_state="rush", reason="vip"), SUPERVISOR,
        )
    assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# DND attempts
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_no_response_attempt_activates_dnd_and_anchors_start(monkeypatch):
    db = make_db()
    monkeypatch.setattr(rooms_router, "supabase", db)

    body = RecordServiceAttemptRequest(result="dnd_no_response", note="Sign on door")
    result = await rooms_router.record_service_attempt(ROOM_ID, body, HOUSEKEEPER)

    room = current_room(db)
    assert room["dnd_flag"] is True
    assert room["dnd_started_at"] is not None
    assert room["dnd_attempt_count"] == 1
    assert result["data"]["result"] == "dnd_no_response"
    assert len(db.rows["room_service_attempts"]) == 1


@pytest.mark.asyncio
async def test_second_no_response_attempt_does_not_reset_start_time(monkeypatch):
    db = make_db(room_overrides={"dnd_flag": True, "dnd_started_at": "2026-09-30T10:00:00+00:00", "dnd_attempt_count": 1})
    monkeypatch.setattr(rooms_router, "supabase", db)

    body = RecordServiceAttemptRequest(result="dnd_no_response")
    await rooms_router.record_service_attempt(ROOM_ID, body, HOUSEKEEPER)

    room = current_room(db)
    assert room["dnd_started_at"] == "2026-09-30T10:00:00+00:00"
    assert room["dnd_attempt_count"] == 2


@pytest.mark.asyncio
async def test_return_later_requires_return_at():
    with pytest.raises(ValueError):
        RecordServiceAttemptRequest(result="return_later")


@pytest.mark.asyncio
async def test_return_later_sets_retry_time_without_forcing_dnd(monkeypatch):
    db = make_db()
    monkeypatch.setattr(rooms_router, "supabase", db)

    return_at = datetime.now(timezone.utc) + timedelta(hours=2)
    body = RecordServiceAttemptRequest(result="return_later", return_at=return_at, note="Guest asked to return later")
    await rooms_router.record_service_attempt(ROOM_ID, body, HOUSEKEEPER)

    room = current_room(db)
    assert room["dnd_retry_at"] == return_at.isoformat()
    assert room["dnd_flag"] is False


@pytest.mark.asyncio
async def test_dnd_cleared_result_clears_dnd_state(monkeypatch):
    db = make_db(room_overrides={"dnd_flag": True, "dnd_started_at": "2026-09-30T10:00:00+00:00", "dnd_retry_at": "2026-09-30T13:00:00+00:00"})
    monkeypatch.setattr(rooms_router, "supabase", db)

    body = RecordServiceAttemptRequest(result="dnd_cleared")
    await rooms_router.record_service_attempt(ROOM_ID, body, SUPERVISOR)

    room = current_room(db)
    assert room["dnd_flag"] is False
    assert room["dnd_started_at"] is None
    assert room["dnd_retry_at"] is None


@pytest.mark.asyncio
async def test_list_service_attempts_returns_tenant_scoped_rows(monkeypatch):
    db = make_db()
    monkeypatch.setattr(rooms_router, "supabase", db)
    await rooms_router.record_service_attempt(ROOM_ID, RecordServiceAttemptRequest(result="dnd_no_response"), HOUSEKEEPER)

    result = await rooms_router.list_service_attempts(ROOM_ID, 20, HOUSEKEEPER)
    assert len(result["data"]) == 1
    assert result["data"][0]["room_id"] == ROOM_ID


# ---------------------------------------------------------------------------
# Service declined
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_service_declined_sets_reason_and_flag(monkeypatch):
    db = make_db()
    monkeypatch.setattr(rooms_router, "supabase", db)

    body = ServiceDeclinedRequest(reason="guest_declined_housekeeping", note="Do not enter")
    result = await rooms_router.set_service_declined(ROOM_ID, body, HOUSEKEEPER)

    assert result["data"]["do_not_service"] is True
    room = current_room(db)
    assert room["do_not_service"] is True
    assert room["service_declined_reason"] == "guest_declined_housekeeping"
    assert room["service_declined_by"] == HOUSEKEEPER.user_id


# ---------------------------------------------------------------------------
# Occupancy discrepancy
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_report_discrepancy_snapshots_pms_status_and_notifies_front_desk(monkeypatch):
    db = make_db(room_overrides={"fo_status": "VAC"})
    db.rows["user_roles"] = [
        {"user_id": "fd-1", "tenant_id": HOTEL, "role": "front_desk", "is_active": True},
        {"user_id": "sup-1", "tenant_id": HOTEL, "role": "housekeeping_supervisor", "is_active": True},
    ]
    monkeypatch.setattr(rooms_router, "supabase", db)

    body = ReportOccupancyDiscrepancyRequest(housekeeping_observed="occupied", note="Luggage in room")
    result = await rooms_router.report_occupancy_discrepancy(ROOM_ID, body, HOUSEKEEPER)

    row = result["data"]
    assert row["housekeeping_observed"] == "occupied"
    assert row["pms_status_at_report"] == "VAC"
    assert row["status"] == "open"
    assert len(db.rows["notifications"]) == 2  # front_desk + housekeeping_supervisor


@pytest.mark.asyncio
async def test_never_writes_fo_status_directly(monkeypatch):
    db = make_db(room_overrides={"fo_status": "VAC"})
    monkeypatch.setattr(rooms_router, "supabase", db)

    await rooms_router.report_occupancy_discrepancy(
        ROOM_ID, ReportOccupancyDiscrepancyRequest(housekeeping_observed="occupied"), HOUSEKEEPER,
    )

    assert current_room(db)["fo_status"] == "VAC"  # PMS state untouched


@pytest.mark.asyncio
async def test_resolve_discrepancy_marks_resolved_and_is_idempotent(monkeypatch):
    db = make_db()
    monkeypatch.setattr(rooms_router, "supabase", db)
    report = await rooms_router.report_occupancy_discrepancy(
        ROOM_ID, ReportOccupancyDiscrepancyRequest(housekeeping_observed="occupied"), HOUSEKEEPER,
    )
    discrepancy_id = report["data"]["id"]

    resolve_body = ResolveOccupancyDiscrepancyRequest(resolution="pms_confirmed", note="Front desk verified")
    first = await rooms_router.resolve_occupancy_discrepancy(discrepancy_id, resolve_body, FRONT_DESK)
    assert first["data"]["status"] == "resolved"
    assert first["data"]["resolved_by"] == FRONT_DESK.user_id

    second = await rooms_router.resolve_occupancy_discrepancy(discrepancy_id, resolve_body, FRONT_DESK)
    assert second["data"]["status"] == "resolved"  # unchanged, not double-processed


@pytest.mark.asyncio
async def test_resolve_discrepancy_404_for_unknown_id(monkeypatch):
    db = make_db()
    monkeypatch.setattr(rooms_router, "supabase", db)

    with pytest.raises(HTTPException) as exc_info:
        await rooms_router.resolve_occupancy_discrepancy(
            "missing", ResolveOccupancyDiscrepancyRequest(resolution="false_alarm"), FRONT_DESK,
        )
    assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# Legacy PATCH /{room_id}/dnd toggle (mobile) — additive dnd_started_at anchor
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_legacy_dnd_toggle_true_anchors_start_time(monkeypatch):
    db = make_db()
    monkeypatch.setattr(rooms_router, "supabase", db)

    await rooms_router.update_room_dnd(ROOM_ID, rooms_router.DndToggleRequest(dnd=True), HOUSEKEEPER)

    room = current_room(db)
    assert room["dnd_flag"] is True
    assert room["dnd_started_at"] is not None


@pytest.mark.asyncio
async def test_legacy_dnd_toggle_false_clears_start_and_retry(monkeypatch):
    db = make_db(room_overrides={"dnd_flag": True, "dnd_started_at": "2026-09-30T10:00:00+00:00", "dnd_retry_at": "2026-09-30T13:00:00+00:00"})
    monkeypatch.setattr(rooms_router, "supabase", db)

    await rooms_router.update_room_dnd(ROOM_ID, rooms_router.DndToggleRequest(dnd=False), HOUSEKEEPER)

    room = current_room(db)
    assert room["dnd_flag"] is False
    assert room["dnd_started_at"] is None
    assert room["dnd_retry_at"] is None


@pytest.mark.asyncio
async def test_legacy_dnd_toggle_true_twice_does_not_reset_start_time(monkeypatch):
    db = make_db(room_overrides={"dnd_flag": True, "dnd_started_at": "2026-09-30T10:00:00+00:00"})
    monkeypatch.setattr(rooms_router, "supabase", db)

    await rooms_router.update_room_dnd(ROOM_ID, rooms_router.DndToggleRequest(dnd=True), HOUSEKEEPER)

    assert current_room(db)["dnd_started_at"] == "2026-09-30T10:00:00+00:00"
