"""Shift-summary generate/lookup tests (Phase 5 — Full AI Shift Handoff).

Covers the corrected contract: the redesigned caller supplies an explicit
shift_id + shift_date (so it never silently resolves a different "current"
shift), while the date-only POST compatibility path remains available. Generate
is idempotent (no AI call / no credit charge
when a summary already exists), and Regenerate always calls the AI again and
upserts the same logical row in place, clearing any prior acknowledgment.

`GET /shift-summary` (no shift_id) is untouched by this phase — it still
resolves "whichever shift most recently ended" for the legacy compact-card
lookup, so those tests are kept as-is.

Mirrors the FakeDB + TestClient + real-JWT + frozen-datetime harness shared
with test_logbook_timezone.py / test_shift_summary_acknowledgment.py, plus the
`.rpc()`-extended FakeDB from test_ai_copilot_credits.py since generate/
regenerate now go through the real middleware.credits accounting path instead
of a hardcoded credit charge.
"""

from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from middleware import credits as credits_module
from routers import logbook as logbook_router
from services.ai import shift_summary as shift_summary_module
from tests.smoke.fake_supabase import FakeDB, FakeQuery

DEPT_ID = "11111111-1111-4111-8111-111111111111"
MORNING_SHIFT_ID = "aaaaaaaa-0000-4000-8000-000000000001"
EVENING_SHIFT_ID = "aaaaaaaa-0000-4000-8000-000000000002"
NIGHT_SHIFT_ID = "aaaaaaaa-0000-4000-8000-000000000003"
FOREIGN_SHIFT_ID = "aaaaaaaa-0000-4000-8000-0000000000ff"


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
    monkeypatch.setattr(shift_summary_module, "datetime", frozen)


class _RpcQuery:
    def __init__(self, db, name, params):
        self.db = db
        self.name = name
        self.params = params

    def execute(self):
        self.db.rpc_calls.append((self.name, self.params))
        return SimpleNamespace(data=[])


class CreditAwareFakeDB(FakeDB):
    """FakeDB extended with .rpc() (increment_credits_used) — generate/
    regenerate now spend real AI credits via middleware.credits."""

    def __init__(self, rows=None):
        super().__init__(rows)
        self.rpc_calls = []

    def table(self, name):
        return FakeQuery(self, name)

    def rpc(self, name, params):
        return _RpcQuery(self, name, params)


class _FakeMessages:
    def create(self, **_kw):
        return SimpleNamespace(
            content=[SimpleNamespace(text="Fresh AI handoff text.")],
            usage=SimpleNamespace(input_tokens=500, output_tokens=200),
        )


class _FakeAnthropic:
    def __init__(self, *_a, **_kw):
        self.messages = _FakeMessages()


def _db_with_shifts(extra_rows: dict | None = None) -> CreditAwareFakeDB:
    rows = {
        "tenants": [{"id": "hotel-a", "timezone": "UTC"}],
        "shifts": [
            {"id": MORNING_SHIFT_ID, "tenant_id": "hotel-a", "name": "Morning",
             "department_id": DEPT_ID, "start_time": "07:00", "end_time": "15:00", "is_active": True},
            {"id": EVENING_SHIFT_ID, "tenant_id": "hotel-a", "name": "Evening",
             "department_id": DEPT_ID, "start_time": "15:00", "end_time": "23:00", "is_active": True},
            {"id": NIGHT_SHIFT_ID, "tenant_id": "hotel-a", "name": "Night",
             "department_id": DEPT_ID, "start_time": "23:00", "end_time": "07:00", "is_active": True},
        ],
        "shift_summaries": [],
        "logbook_entries": [],
        "tasks": [],
        "work_orders": [],
        "room_status": [],
        "guest_requests": [],
        "engineering_parts": [],
        "engineering_part_stock": [],
        "credit_ledger": [{
            "id": "ledger-1", "tenant_id": "hotel-a",
            "period_start": date(date.today().year, 1, 1).isoformat(),
            "period_end": date(date.today().year, 12, 31).isoformat(),
            "credits_included": 5000, "overage_cost_cents": 0,
        }],
    }
    if extra_rows:
        rows.update(extra_rows)
    return CreditAwareFakeDB(rows)


def _patch_all(monkeypatch, db):
    monkeypatch.setattr(logbook_router, "supabase", db)
    monkeypatch.setattr(shift_summary_module, "supabase", db)
    monkeypatch.setattr(credits_module, "supabase", db)
    monkeypatch.setattr(settings, "ai_provider", "hosted")
    monkeypatch.setattr(shift_summary_module, "get_anthropic_client", lambda: _FakeAnthropic())


# ---------------------------------------------------------------------------
# GET /shift-summary — unaffected by Phase 5, still resolves the shift server-side
# ---------------------------------------------------------------------------

def test_get_current_shift_summary_resolves_most_recently_ended_shift(monkeypatch):
    db = _db_with_shifts({
        "shift_summaries": [{
            "id": "sum-1", "tenant_id": "hotel-a", "shift_id": MORNING_SHIFT_ID,
            "shift_date": "2026-09-17", "department_id": DEPT_ID,
            "summary_text": "Morning handoff.", "stats": {"tasks_completed": 5, "open_work_orders": 2},
            "acknowledged_by": None, "acknowledged_at": None,
        }],
    })
    _patch_all(monkeypatch, db)
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


def test_get_current_shift_summary_404_when_none_stored(monkeypatch):
    db = _db_with_shifts()
    _patch_all(monkeypatch, db)
    _freeze(monkeypatch, "2026-09-17T16:00:00")
    client = TestClient(app)

    response = client.get(
        "/v1/logbook/shift-summary",
        params={"shift_date": "2026-09-17"},
        headers=_auth_header("gm"),
    )

    assert response.status_code == 404


# ---------------------------------------------------------------------------
# POST /shift-summary/generate — explicit shift_id + shift_date required
# ---------------------------------------------------------------------------

def test_generate_without_shift_id_retains_legacy_current_shift_behavior(monkeypatch):
    """Older date-only callers remain supported; the redesigned web client
    always supplies an exact selected shift so it never takes this path."""
    db = _db_with_shifts()
    _patch_all(monkeypatch, db)
    _freeze(monkeypatch, "2026-09-17T16:00:00")
    client = TestClient(app)

    response = client.post(
        "/v1/logbook/shift-summary/generate",
        json={"shift_date": "2026-09-17"},
        headers=_auth_header("gm"),
    )

    assert response.status_code == 200
    assert response.json()["data"]["shift_id"] == MORNING_SHIFT_ID


def test_generate_404_for_shift_not_belonging_to_tenant(monkeypatch):
    db = _db_with_shifts()
    _patch_all(monkeypatch, db)
    _freeze(monkeypatch, "2026-09-17T16:00:00")
    client = TestClient(app)

    response = client.post(
        "/v1/logbook/shift-summary/generate",
        json={"shift_id": FOREIGN_SHIFT_ID, "shift_date": "2026-09-17"},
        headers=_auth_header("gm"),
    )

    assert response.status_code == 404


def test_generate_creates_fresh_summary_when_none_exists(monkeypatch):
    db = _db_with_shifts()
    _patch_all(monkeypatch, db)
    _freeze(monkeypatch, "2026-09-17T16:00:00")
    client = TestClient(app)

    response = client.post(
        "/v1/logbook/shift-summary/generate",
        json={"shift_id": MORNING_SHIFT_ID, "shift_date": "2026-09-17"},
        headers=_auth_header("gm"),
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["summary_text"] == "Fresh AI handoff text."
    assert len(db.rows["shift_summaries"]) == 1
    # Real token-derived credit charge, not the old hardcoded 3.0
    interaction = [row for table, row in db.inserts if table == "ai_interactions"][0]
    assert interaction["prompt_tokens"] == 500
    assert interaction["completion_tokens"] == 200
    assert interaction["success"] is True


def test_generate_dedupes_existing_summary_without_calling_ai(monkeypatch):
    """A second click (or the cron already having run) must not insert a
    duplicate row or spend a second AI credit."""
    db = _db_with_shifts({
        "shift_summaries": [{
            "id": "sum-1", "tenant_id": "hotel-a", "shift_id": MORNING_SHIFT_ID,
            "shift_date": "2026-09-17", "department_id": DEPT_ID,
            "summary_text": "Already generated.", "stats": {},
            "acknowledged_by": None, "acknowledged_at": None,
        }],
    })
    _patch_all(monkeypatch, db)
    _freeze(monkeypatch, "2026-09-17T16:00:00")
    client = TestClient(app)

    response = client.post(
        "/v1/logbook/shift-summary/generate",
        json={"shift_id": MORNING_SHIFT_ID, "shift_date": "2026-09-17"},
        headers=_auth_header("gm"),
    )

    assert response.status_code == 200
    assert response.json()["data"]["summary_text"] == "Already generated."
    assert len(db.rows["shift_summaries"]) == 1  # no duplicate inserted
    assert not db.inserts and not db.rpc_calls  # no AI credit call at all


def test_generate_does_not_clear_existing_acknowledgment(monkeypatch):
    db = _db_with_shifts({
        "shift_summaries": [{
            "id": "sum-1", "tenant_id": "hotel-a", "shift_id": MORNING_SHIFT_ID,
            "shift_date": "2026-09-17", "department_id": DEPT_ID,
            "summary_text": "Already generated.", "stats": {},
            "acknowledged_by": "user-a-1", "acknowledged_at": "2026-09-17T15:10:00+00:00",
        }],
    })
    _patch_all(monkeypatch, db)
    _freeze(monkeypatch, "2026-09-17T16:00:00")
    client = TestClient(app)

    response = client.post(
        "/v1/logbook/shift-summary/generate",
        json={"shift_id": MORNING_SHIFT_ID, "shift_date": "2026-09-17"},
        headers=_auth_header("gm"),
    )

    assert response.status_code == 200
    assert response.json()["data"]["acknowledged_by"] == "user-a-1"


# ---------------------------------------------------------------------------
# POST /shift-summary/generate {regenerate: true} — always fresh, upserts in place
# ---------------------------------------------------------------------------

def test_regenerate_calls_ai_again_and_replaces_same_row(monkeypatch):
    db = _db_with_shifts({
        "shift_summaries": [{
            "id": "sum-1", "tenant_id": "hotel-a", "shift_id": MORNING_SHIFT_ID,
            "shift_date": "2026-09-17", "department_id": DEPT_ID,
            "summary_text": "Stale handoff.", "stats": {},
            "acknowledged_by": "user-a-1", "acknowledged_at": "2026-09-17T15:10:00+00:00",
        }],
    })
    _patch_all(monkeypatch, db)
    _freeze(monkeypatch, "2026-09-17T16:00:00")
    client = TestClient(app)

    response = client.post(
        "/v1/logbook/shift-summary/generate",
        json={"shift_id": MORNING_SHIFT_ID, "shift_date": "2026-09-17", "regenerate": True},
        headers=_auth_header("gm"),
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["summary_text"] == "Fresh AI handoff text."
    assert len(db.rows["shift_summaries"]) == 1  # updated in place, not duplicated
    assert db.rows["shift_summaries"][0]["id"] == "sum-1"


def test_regenerate_clears_prior_acknowledgment(monkeypatch):
    db = _db_with_shifts({
        "shift_summaries": [{
            "id": "sum-1", "tenant_id": "hotel-a", "shift_id": MORNING_SHIFT_ID,
            "shift_date": "2026-09-17", "department_id": DEPT_ID,
            "summary_text": "Stale handoff.", "stats": {},
            "acknowledged_by": "user-a-1", "acknowledged_at": "2026-09-17T15:10:00+00:00",
        }],
    })
    _patch_all(monkeypatch, db)
    _freeze(monkeypatch, "2026-09-17T16:00:00")
    client = TestClient(app)

    response = client.post(
        "/v1/logbook/shift-summary/generate",
        json={"shift_id": MORNING_SHIFT_ID, "shift_date": "2026-09-17", "regenerate": True},
        headers=_auth_header("gm"),
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["acknowledged_by"] is None
    assert data["acknowledged_at"] is None


def test_regenerate_charges_a_fresh_ai_credit(monkeypatch):
    db = _db_with_shifts({
        "shift_summaries": [{
            "id": "sum-1", "tenant_id": "hotel-a", "shift_id": MORNING_SHIFT_ID,
            "shift_date": "2026-09-17", "department_id": DEPT_ID,
            "summary_text": "Stale handoff.", "stats": {},
            "acknowledged_by": None, "acknowledged_at": None,
        }],
    })
    _patch_all(monkeypatch, db)
    _freeze(monkeypatch, "2026-09-17T16:00:00")
    client = TestClient(app)

    client.post(
        "/v1/logbook/shift-summary/generate",
        json={"shift_id": MORNING_SHIFT_ID, "shift_date": "2026-09-17", "regenerate": True},
        headers=_auth_header("gm"),
    )

    interactions = [row for table, row in db.inserts if table == "ai_interactions"]
    assert len(interactions) == 1
    assert interactions[0]["success"] is True
    assert db.rpc_calls  # increment_credits_used was called
