from datetime import datetime, timedelta, timezone

import pytest

from middleware.auth import CurrentUser
from models.requests import EndShiftRequest, ShiftBreakRequest, StartShiftRequest
from routers import shifts as shifts_router

from .fake_supabase import FakeDB


HOUSEKEEPER = CurrentUser(
    user_id="hk-1",
    hotel_id="hotel-a",
    role="housekeeper",
    email="hk@example.com",
)

SHIFT_ID = "44444444-4444-4444-8444-444444444444"


def make_db():
    return FakeDB({"hk_shift_sessions": []})


def start_request():
    return StartShiftRequest(id=SHIFT_ID, started_at=datetime.now(timezone.utc))


@pytest.mark.asyncio
async def test_start_shift_creates_active_session(monkeypatch):
    db = make_db()
    monkeypatch.setattr(shifts_router, "supabase", db)

    response = await shifts_router.start_shift(start_request(), HOUSEKEEPER)
    shift = response["data"]

    assert shift["id"] == SHIFT_ID
    assert shift["status"] == "active"

    current = await shifts_router.get_current_shift(HOUSEKEEPER)
    assert current["data"]["id"] == SHIFT_ID


@pytest.mark.asyncio
async def test_start_shift_is_idempotent(monkeypatch):
    db = make_db()
    monkeypatch.setattr(shifts_router, "supabase", db)

    await shifts_router.start_shift(start_request(), HOUSEKEEPER)
    again = await shifts_router.start_shift(start_request(), HOUSEKEEPER)

    assert again["data"]["id"] == SHIFT_ID
    assert len(db.rows["hk_shift_sessions"]) == 1


@pytest.mark.asyncio
async def test_break_accrues_seconds(monkeypatch):
    db = make_db()
    monkeypatch.setattr(shifts_router, "supabase", db)
    await shifts_router.start_shift(start_request(), HOUSEKEEPER)

    await shifts_router.toggle_break(ShiftBreakRequest(action="start"), HOUSEKEEPER)
    shift = db.rows["hk_shift_sessions"][0]
    assert shift["status"] == "on_break"

    # Simulate a 10-minute break by backdating on_break_since
    shift["on_break_since"] = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()

    response = await shifts_router.toggle_break(ShiftBreakRequest(action="end"), HOUSEKEEPER)
    resumed = response["data"]
    assert resumed["status"] == "active"
    assert 590 <= resumed["break_seconds"] <= 610


@pytest.mark.asyncio
async def test_end_shift_closes_session(monkeypatch):
    db = make_db()
    monkeypatch.setattr(shifts_router, "supabase", db)
    await shifts_router.start_shift(start_request(), HOUSEKEEPER)

    response = await shifts_router.end_shift(
        EndShiftRequest(ended_at=datetime.now(timezone.utc)), HOUSEKEEPER
    )
    assert response["data"]["status"] == "ended"

    current = await shifts_router.get_current_shift(HOUSEKEEPER)
    assert current["data"] is None

    # Ending again is a no-op
    again = await shifts_router.end_shift(
        EndShiftRequest(ended_at=datetime.now(timezone.utc)), HOUSEKEEPER
    )
    assert again["data"] is None
