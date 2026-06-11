from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from models.requests import (
    CleanSessionBlockerRequest,
    CompleteCleanSessionRequest,
    CreateCleanSessionRequest,
)
from routers import clean_sessions as sessions_router
from routers import cleaning_checklists as checklists_router
from services import room_status_transitions as transitions_service

from .fake_supabase import FakeDB


HOUSEKEEPER = CurrentUser(
    user_id="hk-1",
    hotel_id="hotel-a",
    role="housekeeper",
    email="hk@example.com",
)
OTHER_HOUSEKEEPER = CurrentUser(
    user_id="hk-2",
    hotel_id="hotel-a",
    role="housekeeper",
    email="hk2@example.com",
)

SESSION_ID = "11111111-1111-4111-8111-111111111111"
ROOM_ID = "22222222-2222-4222-8222-222222222222"


def make_db(room_status="DIRTY"):
    return FakeDB({
        "room_status": [{
            "id": "rs-1",
            "room_id": ROOM_ID,
            "tenant_id": "hotel-a",
            "status": room_status,
            "clean_type": "DEP",
            "assigned_to": "hk-1",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }],
        "rooms": [{
            "id": ROOM_ID,
            "tenant_id": "hotel-a",
            "room_type_id": "rt-1",
            "room_types": {"base_clean_minutes": 30},
        }],
        "room_assignments": [{
            "id": "as-1",
            "tenant_id": "hotel-a",
            "room_id": ROOM_ID,
            "assigned_to": "hk-1",
            "assignment_date": datetime.now(timezone.utc).date().isoformat(),
            "clean_type": "DEP",
        }],
        "cleaning_checklist_templates": [],
        "cleaning_checklist_items": [],
        "room_clean_sessions": [],
        "room_clean_photos": [],
        "room_status_history": [],
        "housekeeper_profiles": [],
    })


def patch_db(monkeypatch, db):
    monkeypatch.setattr(sessions_router, "supabase", db)
    monkeypatch.setattr(checklists_router, "supabase", db)
    monkeypatch.setattr(transitions_service, "supabase", db)


def start_request(started_at=None):
    return CreateCleanSessionRequest(
        id=SESSION_ID,
        room_id=ROOM_ID,
        started_at=started_at or datetime.now(timezone.utc),
    )


@pytest.mark.asyncio
async def test_start_session_snapshots_checklist_and_flips_in_progress(monkeypatch):
    db = make_db()
    patch_db(monkeypatch, db)

    response = await sessions_router.start_clean_session(start_request(), HOUSEKEEPER)
    session = response["data"]

    assert session["id"] == SESSION_ID
    assert session["status"] == "active"
    assert session["clean_type"] == "DEP"
    assert session["previous_status"] == "DIRTY"
    assert session["base_clean_minutes"] == 30
    assert session["checklist_total"] > 0
    assert all(item["checked"] is False for item in session["checklist"])

    room = db.rows["room_status"][0]
    assert room["status"] == "IN_PROGRESS"
    history = db.rows["room_status_history"]
    assert history and history[-1]["to_status"] == "IN_PROGRESS"


@pytest.mark.asyncio
async def test_start_session_is_idempotent(monkeypatch):
    db = make_db()
    patch_db(monkeypatch, db)

    first = await sessions_router.start_clean_session(start_request(), HOUSEKEEPER)
    second = await sessions_router.start_clean_session(start_request(), HOUSEKEEPER)

    assert first["data"]["id"] == second["data"]["id"]
    assert len(db.rows["room_clean_sessions"]) == 1


@pytest.mark.asyncio
async def test_start_session_conflicts_when_other_housekeeper_active(monkeypatch):
    db = make_db()
    patch_db(monkeypatch, db)
    await sessions_router.start_clean_session(start_request(), HOUSEKEEPER)

    other_request = CreateCleanSessionRequest(
        id="33333333-3333-4333-8333-333333333333",
        room_id=ROOM_ID,
        started_at=datetime.now(timezone.utc),
    )
    with pytest.raises(HTTPException) as exc:
        await sessions_router.start_clean_session(other_request, OTHER_HOUSEKEEPER)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_complete_session_transitions_clean_and_updates_profile(monkeypatch):
    db = make_db()
    patch_db(monkeypatch, db)
    started_at = datetime.now(timezone.utc) - timedelta(minutes=25)
    await sessions_router.start_clean_session(start_request(started_at), HOUSEKEEPER)

    response = await sessions_router.complete_clean_session(
        SESSION_ID,
        CompleteCleanSessionRequest(ended_at=datetime.now(timezone.utc)),
        HOUSEKEEPER,
    )
    completed = response["data"]

    assert completed["status"] == "completed"
    assert 24 <= completed["actual_minutes"] <= 26
    assert completed["base_minutes"] == 30

    room = db.rows["room_status"][0]
    assert room["status"] == "CLEAN"
    assert db.rows["room_status_history"][-1]["to_status"] == "CLEAN"

    profiles = db.rows["housekeeper_profiles"]
    assert len(profiles) == 1
    assert profiles[0]["completion_count"] == 1
    assert 24 <= profiles[0]["avg_clean_minutes"] <= 26


@pytest.mark.asyncio
async def test_complete_session_is_idempotent(monkeypatch):
    db = make_db()
    patch_db(monkeypatch, db)
    started_at = datetime.now(timezone.utc) - timedelta(minutes=25)
    await sessions_router.start_clean_session(start_request(started_at), HOUSEKEEPER)
    body = CompleteCleanSessionRequest(ended_at=datetime.now(timezone.utc))

    first = await sessions_router.complete_clean_session(SESSION_ID, body, HOUSEKEEPER)
    second = await sessions_router.complete_clean_session(SESSION_ID, body, HOUSEKEEPER)

    assert first["data"]["status"] == "completed"
    assert second["data"]["status"] == "completed"
    # Profile only updated once
    assert len(db.rows["housekeeper_profiles"]) == 1
    assert db.rows["housekeeper_profiles"][0]["completion_count"] == 1


@pytest.mark.asyncio
async def test_blocker_abandons_session_and_reverts_room(monkeypatch):
    db = make_db()
    patch_db(monkeypatch, db)
    await sessions_router.start_clean_session(start_request(), HOUSEKEEPER)

    response = await sessions_router.report_session_blocker(
        SESSION_ID,
        CleanSessionBlockerRequest(reason="dnd"),
        HOUSEKEEPER,
    )
    session = response["data"]

    assert session["status"] == "abandoned"
    assert session["blocked_reason"] == "dnd"
    room = db.rows["room_status"][0]
    assert room["status"] == "DIRTY"  # reverted to previous_status
    assert room["dnd_flag"] is True
    assert db.rows["room_status_history"][-1]["to_status"] == "DIRTY"


@pytest.mark.asyncio
async def test_other_housekeeper_cannot_touch_session(monkeypatch):
    db = make_db()
    patch_db(monkeypatch, db)
    await sessions_router.start_clean_session(start_request(), HOUSEKEEPER)

    with pytest.raises(HTTPException) as exc:
        await sessions_router.complete_clean_session(
            SESSION_ID,
            CompleteCleanSessionRequest(ended_at=datetime.now(timezone.utc)),
            OTHER_HOUSEKEEPER,
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_legacy_status_patch_closes_active_session(monkeypatch):
    db = make_db()
    patch_db(monkeypatch, db)
    await sessions_router.start_clean_session(start_request(), HOUSEKEEPER)

    # Simulate a stale offline queue flush via the legacy endpoint helper
    transitions_service.close_active_sessions_for_room("hotel-a", ROOM_ID)

    session = db.rows["room_clean_sessions"][0]
    assert session["status"] == "completed"
    assert session["ended_at"]
