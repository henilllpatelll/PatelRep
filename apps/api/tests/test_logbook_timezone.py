"""Logbook hotel-local timezone tests (LOGBOOK-01).

Proves entry_date is stamped from hotel-local calendar day (DST-aware via the
tz database), not UTC CURRENT_DATE, and that the list filter queries the
corrected entry_date column instead of naive UTC created_at boundaries.

Mirrors the FakeDB + TestClient + real-JWT harness in test_lost_found_retention.py.
"""

from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from middleware.auth import CurrentUser
from routers import logbook as logbook_router
from tests.smoke.fake_supabase import FakeDB

GM = CurrentUser(user_id="gm-1", hotel_id="hotel-a", role="gm")
DEPT_ID = "11111111-1111-4111-8111-111111111111"


def _auth_header(role: str, hotel_id: str = "hotel-a", user_id: str = "user-a-1") -> dict[str, str]:
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _chicago_hotel_db(extra_rows: dict | None = None) -> FakeDB:
    rows = {
        "hotels": [{"id": "hotel-a", "timezone": "America/Chicago"}],
        "departments": [{"id": DEPT_ID, "name": "Housekeeping"}],
        "logbook_entries": [],
    }
    if extra_rows:
        rows.update(extra_rows)
    return FakeDB(rows)


class _FrozenDateTime(datetime):
    """datetime subclass whose .now() always returns a fixed UTC instant."""

    _frozen_instant = None

    @classmethod
    def now(cls, tz=None):
        instant = cls._frozen_instant
        if tz is not None:
            return instant.astimezone(tz)
        return instant


def _freeze(monkeypatch, utc_iso: str):
    frozen = type("_Frozen", (_FrozenDateTime,), {
        "_frozen_instant": datetime.fromisoformat(utc_iso).replace(tzinfo=timezone.utc),
    })
    monkeypatch.setattr(logbook_router, "datetime", frozen)


# ---------------------------------------------------------------------------
# Task 1: create path stamps entry_date in hotel-local time
# ---------------------------------------------------------------------------


def test_evening_entry_resolves_to_hotel_local_day_not_utc_next_day(monkeypatch):
    """2026-08-03T02:00:00Z is 2026-08-02 21:00 CDT -- entry_date must be 2026-08-02."""
    db = _chicago_hotel_db()
    monkeypatch.setattr(logbook_router, "supabase", db)
    _freeze(monkeypatch, "2026-08-03T02:00:00")
    client = TestClient(app)

    response = client.post(
        "/v1/logbook/entries",
        headers=_auth_header("gm"),
        json={"department_id": DEPT_ID, "content": "Evening shift note"},
    )

    assert response.status_code == 200
    entry = response.json()["data"]
    assert entry["entry_date"] == "2026-08-02"


def test_pre_midnight_entry_resolves_via_real_tz_conversion(monkeypatch):
    """2026-08-03T04:30:00Z is 2026-08-02 23:30 CDT (just before local midnight) --
    entry_date must still be 2026-08-02, proving real DST-aware tz conversion, not a
    hardcoded numeric offset."""
    db = _chicago_hotel_db()
    monkeypatch.setattr(logbook_router, "supabase", db)
    _freeze(monkeypatch, "2026-08-03T04:30:00")
    client = TestClient(app)

    response = client.post(
        "/v1/logbook/entries",
        headers=_auth_header("gm"),
        json={"department_id": DEPT_ID, "content": "Just before local midnight"},
    )

    assert response.status_code == 200
    entry = response.json()["data"]
    assert entry["entry_date"] == "2026-08-02"


# ---------------------------------------------------------------------------
# Task 2: list filter queries the local-day entry_date column
# ---------------------------------------------------------------------------


def test_list_filter_by_local_day_returns_evening_entry_not_utc_day(monkeypatch):
    """An entry created at a next-UTC-day instant but correctly stamped entry_date
    for the earlier hotel-local day: filtering by the local day returns it, filtering
    by the UTC day (old-bug behavior) does not."""
    db = _chicago_hotel_db({
        "logbook_entries": [
            {
                "id": "entry-1",
                "tenant_id": "hotel-a",
                "department_id": DEPT_ID,
                "shift_id": None,
                "author_id": "user-a-1",
                "content": "Evening shift note",
                "entry_date": "2026-08-02",
                "created_at": "2026-08-03T02:00:00+00:00",
                "expires_at": None,
            },
        ],
    })
    monkeypatch.setattr(logbook_router, "supabase", db)
    client = TestClient(app)

    local_day_response = client.get(
        "/v1/logbook/entries",
        headers=_auth_header("gm"),
        params={"entry_date": "2026-08-02"},
    )
    utc_day_response = client.get(
        "/v1/logbook/entries",
        headers=_auth_header("gm"),
        params={"entry_date": "2026-08-03"},
    )

    assert local_day_response.status_code == 200
    local_ids = [row["id"] for row in local_day_response.json()["data"]]
    assert local_ids == ["entry-1"]

    assert utc_day_response.status_code == 200
    utc_ids = [row["id"] for row in utc_day_response.json()["data"]]
    assert utc_ids == []
