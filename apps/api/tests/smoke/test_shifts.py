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

SUPERVISOR = CurrentUser(
    user_id="sup-1",
    hotel_id="hotel-a",
    role="housekeeping_supervisor",
    email="sup@example.com",
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


@pytest.mark.asyncio
async def test_roster_returns_latest_session_per_housekeeper(monkeypatch):
    db = make_db()
    monkeypatch.setattr(shifts_router, "supabase", db)
    roster_day = datetime.now(timezone.utc).replace(
        hour=12, minute=0, second=0, microsecond=0
    )

    db.rows["hk_shift_sessions"].extend([
        {
            "id": "s-old",
            "tenant_id": "hotel-a",
            "user_id": "hk-1",
            "status": "ended",
            "started_at": (roster_day - timedelta(hours=8)).isoformat(),
            "on_break_since": None,
            "break_seconds": 0,
        },
        {
            "id": "s-new",
            "tenant_id": "hotel-a",
            "user_id": "hk-1",
            "status": "on_break",
            "started_at": (roster_day - timedelta(hours=1)).isoformat(),
            "on_break_since": roster_day.isoformat(),
            "break_seconds": 0,
        },
        {
            "id": "s-other-hotel",
            "tenant_id": "hotel-b",
            "user_id": "hk-2",
            "status": "active",
            "started_at": roster_day.isoformat(),
            "on_break_since": None,
            "break_seconds": 0,
        },
    ])

    response = await shifts_router.get_shift_roster(roster_day.date(), SUPERVISOR)
    rows = response["data"]

    assert len(rows) == 1
    assert rows[0]["user_id"] == "hk-1"
    assert rows[0]["status"] == "on_break"


SECOND_SHIFT_ID = "55555555-5555-4555-8555-555555555555"


@pytest.mark.asyncio
async def test_current_reports_last_ended_shift_after_clock_out(monkeypatch):
    db = make_db()
    monkeypatch.setattr(shifts_router, "supabase", db)

    # Never clocked in: nothing open and nothing ended.
    never = await shifts_router.get_current_shift(HOUSEKEEPER)
    assert never["data"] is None
    assert never["meta"]["last_ended"] is None

    await shifts_router.start_shift(start_request(), HOUSEKEEPER)
    open_now = await shifts_router.get_current_shift(HOUSEKEEPER)
    assert open_now["data"]["id"] == SHIFT_ID
    assert open_now["meta"]["last_ended"] is None

    await shifts_router.end_shift(EndShiftRequest(ended_at=datetime.now(timezone.utc)), HOUSEKEEPER)

    # Clocked out: no open shift, but the client can tell it already ended.
    after = await shifts_router.get_current_shift(HOUSEKEEPER)
    assert after["data"] is None
    assert after["meta"]["last_ended"]["id"] == SHIFT_ID
    assert after["meta"]["last_ended"]["status"] == "ended"
    # Reading state never opens a shift.
    assert len(db.rows["hk_shift_sessions"]) == 1


@pytest.mark.asyncio
async def test_last_ended_is_scoped_to_the_caller_and_hotel(monkeypatch):
    db = make_db()
    monkeypatch.setattr(shifts_router, "supabase", db)
    now = datetime.now(timezone.utc)
    db.rows["hk_shift_sessions"].extend([
        {"id": "other-user", "tenant_id": "hotel-a", "user_id": "hk-2", "status": "ended",
         "started_at": (now - timedelta(hours=9)).isoformat(), "ended_at": (now - timedelta(hours=1)).isoformat(),
         "on_break_since": None, "break_seconds": 0},
        {"id": "other-hotel", "tenant_id": "hotel-b", "user_id": "hk-1", "status": "ended",
         "started_at": (now - timedelta(hours=9)).isoformat(), "ended_at": (now - timedelta(hours=1)).isoformat(),
         "on_break_since": None, "break_seconds": 0},
    ])

    response = await shifts_router.get_current_shift(HOUSEKEEPER)

    assert response["data"] is None
    assert response["meta"]["last_ended"] is None


@pytest.mark.asyncio
async def test_new_shift_after_clock_out_is_an_explicit_start(monkeypatch):
    db = make_db()
    monkeypatch.setattr(shifts_router, "supabase", db)
    await shifts_router.start_shift(start_request(), HOUSEKEEPER)
    await shifts_router.end_shift(EndShiftRequest(ended_at=datetime.now(timezone.utc)), HOUSEKEEPER)

    second = await shifts_router.start_shift(
        StartShiftRequest(id=SECOND_SHIFT_ID, started_at=datetime.now(timezone.utc)), HOUSEKEEPER
    )

    assert second["data"]["id"] == SECOND_SHIFT_ID
    assert second["data"]["status"] == "active"
    assert len(db.rows["hk_shift_sessions"]) == 2
    # A retried start for the first (ended) id never reopens it.
    replay = await shifts_router.start_shift(start_request(), HOUSEKEEPER)
    assert replay["data"]["status"] == "ended"


@pytest.mark.asyncio
async def test_start_from_a_second_device_returns_the_open_shift(monkeypatch):
    db = make_db()
    monkeypatch.setattr(shifts_router, "supabase", db)
    await shifts_router.start_shift(start_request(), HOUSEKEEPER)

    other_device = await shifts_router.start_shift(
        StartShiftRequest(id=SECOND_SHIFT_ID, started_at=datetime.now(timezone.utc)), HOUSEKEEPER
    )

    assert other_device["data"]["id"] == SHIFT_ID
    assert len(db.rows["hk_shift_sessions"]) == 1


@pytest.mark.asyncio
async def test_end_shift_never_ends_before_it_started(monkeypatch):
    db = make_db()
    monkeypatch.setattr(shifts_router, "supabase", db)
    started = datetime.now(timezone.utc)
    await shifts_router.start_shift(StartShiftRequest(id=SHIFT_ID, started_at=started), HOUSEKEEPER)

    response = await shifts_router.end_shift(
        EndShiftRequest(ended_at=started - timedelta(hours=2)), HOUSEKEEPER
    )

    assert response["data"]["status"] == "ended"
    assert datetime.fromisoformat(response["data"]["ended_at"]) >= started
