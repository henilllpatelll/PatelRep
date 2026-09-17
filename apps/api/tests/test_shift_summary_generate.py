"""Shift-summary generate/lookup tests.

Covers the fix for the "Generate for today" button, which used to send the
literal string 'today' as `shift_id` straight into a `.eq("id", "today")`
lookup against the UUID-typed `shifts` table (Postgres 22P02, before ever
reaching the AI call) — introduced in bf9dd630, found+documented (not fixed)
during Phase 39's close-out (39-05-SUMMARY.md).

The fix resolves the real shift server-side (`_resolve_current_shift`: the
shift template whose window most recently closed, hotel-local time) instead
of requiring the caller to know a `shifts.id` up front, and adds a lookup-only
`GET /shift-summary` endpoint so the UI can show an already-generated summary
without regenerating.

Mirrors the FakeDB + TestClient + real-JWT + frozen-datetime harness shared
with test_logbook_timezone.py / test_shift_summary_acknowledgment.py.
"""

from datetime import datetime, timezone

from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import logbook as logbook_router
from tests.smoke.fake_supabase import FakeDB

DEPT_ID = "11111111-1111-4111-8111-111111111111"
MORNING_SHIFT_ID = "aaaaaaaa-0000-4000-8000-000000000001"
EVENING_SHIFT_ID = "aaaaaaaa-0000-4000-8000-000000000002"
NIGHT_SHIFT_ID = "aaaaaaaa-0000-4000-8000-000000000003"


def _auth_header(role: str, hotel_id: str = "hotel-a", user_id: str = "user-a-1") -> dict[str, str]:
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


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


def _db_with_shifts(extra_rows: dict | None = None) -> FakeDB:
    rows = {
        "tenants": [{"id": "hotel-a", "timezone": "UTC"}],
        "shifts": [
            {"id": MORNING_SHIFT_ID, "tenant_id": "hotel-a", "name": "Morning",
             "department_id": DEPT_ID, "end_time": "15:00:00", "is_active": True},
            {"id": EVENING_SHIFT_ID, "tenant_id": "hotel-a", "name": "Evening",
             "department_id": DEPT_ID, "end_time": "23:00:00", "is_active": True},
            {"id": NIGHT_SHIFT_ID, "tenant_id": "hotel-a", "name": "Night",
             "department_id": DEPT_ID, "end_time": "07:00:00", "is_active": True},
        ],
        "shift_summaries": [],
    }
    if extra_rows:
        rows.update(extra_rows)
    return FakeDB(rows)


# ---------------------------------------------------------------------------
# GET /shift-summary — lookup-only, resolves the shift server-side
# ---------------------------------------------------------------------------

def test_get_current_shift_summary_resolves_most_recently_ended_shift(monkeypatch):
    """At 16:00 UTC, Morning (ends 15:00) is the most recently ended shift —
    not Evening (ends 23:00, still in the future) or Night (ends 07:00, ~9h ago)."""
    db = _db_with_shifts({
        "shift_summaries": [{
            "id": "sum-1", "tenant_id": "hotel-a", "shift_id": MORNING_SHIFT_ID,
            "shift_date": "2026-09-17", "department_id": DEPT_ID,
            "summary_text": "Morning handoff.", "stats": {"tasks_completed": 5, "open_work_orders": 2},
            "acknowledged_by": None, "acknowledged_at": None,
        }],
    })
    monkeypatch.setattr(logbook_router, "supabase", db)
    _freeze(monkeypatch, "2026-09-17T16:00:00")
    client = TestClient(app)

    response = client.get(
        "/v1/logbook/shift-summary",
        params={"shift_date": "2026-09-17"},
        headers=_auth_header("gm"),
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["shift_id"] == MORNING_SHIFT_ID
    assert data["summary_text"] == "Morning handoff."


def test_get_current_shift_summary_defaults_date_to_hotel_today(monkeypatch):
    db = _db_with_shifts({
        "shift_summaries": [{
            "id": "sum-1", "tenant_id": "hotel-a", "shift_id": MORNING_SHIFT_ID,
            "shift_date": "2026-09-17", "department_id": DEPT_ID,
            "summary_text": "Morning handoff.", "stats": {},
            "acknowledged_by": None, "acknowledged_at": None,
        }],
    })
    monkeypatch.setattr(logbook_router, "supabase", db)
    _freeze(monkeypatch, "2026-09-17T16:00:00")
    client = TestClient(app)

    response = client.get("/v1/logbook/shift-summary", headers=_auth_header("gm"))

    assert response.status_code == 200
    assert response.json()["data"]["summary_text"] == "Morning handoff."


def test_get_current_shift_summary_404_when_none_stored(monkeypatch):
    db = _db_with_shifts()
    monkeypatch.setattr(logbook_router, "supabase", db)
    _freeze(monkeypatch, "2026-09-17T16:00:00")
    client = TestClient(app)

    response = client.get(
        "/v1/logbook/shift-summary",
        params={"shift_date": "2026-09-17"},
        headers=_auth_header("gm"),
    )

    assert response.status_code == 404


def test_get_current_shift_summary_404_when_no_shifts_configured(monkeypatch):
    db = FakeDB({"tenants": [{"id": "hotel-a", "timezone": "UTC"}], "shifts": [], "shift_summaries": []})
    monkeypatch.setattr(logbook_router, "supabase", db)
    _freeze(monkeypatch, "2026-09-17T16:00:00")
    client = TestClient(app)

    response = client.get("/v1/logbook/shift-summary", headers=_auth_header("gm"))

    assert response.status_code == 404


# ---------------------------------------------------------------------------
# POST /shift-summary/generate — no longer requires (or accepts) a client-
# supplied shift_id; resolves it server-side and dedupes against an existing row.
# ---------------------------------------------------------------------------

def test_generate_no_longer_requires_shift_id_in_body(monkeypatch):
    """Regression guard for the literal 'today' bug: omitting shift_id must not 422."""
    db = _db_with_shifts({
        "shift_summaries": [{
            "id": "sum-1", "tenant_id": "hotel-a", "shift_id": MORNING_SHIFT_ID,
            "shift_date": "2026-09-17", "department_id": DEPT_ID,
            "summary_text": "Morning handoff.", "stats": {"tasks_completed": 3, "open_work_orders": 1},
            "acknowledged_by": None, "acknowledged_at": None,
        }],
    })
    monkeypatch.setattr(logbook_router, "supabase", db)
    _freeze(monkeypatch, "2026-09-17T16:00:00")
    client = TestClient(app)

    response = client.post(
        "/v1/logbook/shift-summary/generate",
        json={"shift_date": "2026-09-17"},
        headers=_auth_header("gm"),
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["summary_text"] == "Morning handoff."
    assert data["tasks_completed"] == 3
    assert data["open_work_orders"] == 1


def test_generate_dedupes_existing_summary_without_calling_ai(monkeypatch):
    """A second click (or the cron already having run) must not insert a duplicate row."""
    db = _db_with_shifts({
        "shift_summaries": [{
            "id": "sum-1", "tenant_id": "hotel-a", "shift_id": MORNING_SHIFT_ID,
            "shift_date": "2026-09-17", "department_id": DEPT_ID,
            "summary_text": "Already generated.", "stats": {},
            "acknowledged_by": None, "acknowledged_at": None,
        }],
    })
    monkeypatch.setattr(logbook_router, "supabase", db)
    _freeze(monkeypatch, "2026-09-17T16:00:00")
    client = TestClient(app)

    response = client.post(
        "/v1/logbook/shift-summary/generate",
        json={"shift_date": "2026-09-17"},
        headers=_auth_header("gm"),
    )

    assert response.status_code == 200
    assert response.json()["data"]["summary_text"] == "Already generated."
    assert len(db.rows["shift_summaries"]) == 1  # no duplicate inserted


def test_generate_422_when_no_shifts_configured(monkeypatch):
    db = FakeDB({"tenants": [{"id": "hotel-a", "timezone": "UTC"}], "shifts": [], "shift_summaries": []})
    monkeypatch.setattr(logbook_router, "supabase", db)
    _freeze(monkeypatch, "2026-09-17T16:00:00")
    client = TestClient(app)

    response = client.post(
        "/v1/logbook/shift-summary/generate",
        json={"shift_date": "2026-09-17"},
        headers=_auth_header("gm"),
    )

    assert response.status_code == 422
