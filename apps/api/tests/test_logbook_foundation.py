"""Contract coverage for the Phase 1 Logbook data foundation."""

from datetime import datetime, timezone

from fastapi.testclient import TestClient
from jose import jwt
import pytest

from core.config import settings
from main import app
from routers import logbook as logbook_router
from tests.smoke.fake_supabase import FakeDB

DEPT_HK = "11111111-1111-4111-8111-111111111111"
DEPT_ENG = "22222222-2222-4222-8222-222222222222"
DAY_SHIFT = "aaaaaaaa-0000-4000-8000-000000000001"
EVENING_SHIFT = "aaaaaaaa-0000-4000-8000-000000000002"
NIGHT_SHIFT = "aaaaaaaa-0000-4000-8000-000000000003"


def _auth_header(role: str, hotel_id: str = "hotel-a", user_id: str = "user-a") -> dict[str, str]:
    token = jwt.encode(
        {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"},
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


class _FrozenDateTime(datetime):
    _instant: datetime

    @classmethod
    def now(cls, tz=None):
        return cls._instant.astimezone(tz) if tz is not None else cls._instant


def _freeze(monkeypatch, utc_iso: str):
    frozen = type("_Frozen", (_FrozenDateTime,), {
        "_instant": datetime.fromisoformat(utc_iso).replace(tzinfo=timezone.utc),
    })
    monkeypatch.setattr(logbook_router, "datetime", frozen)


def _db(extra_rows: dict | None = None) -> FakeDB:
    rows = {
        "tenants": [{"id": "hotel-a", "timezone": "UTC"}],
        "departments": [
            {"id": DEPT_HK, "tenant_id": "hotel-a", "name": "Housekeeping"},
            {"id": DEPT_ENG, "tenant_id": "hotel-a", "name": "Engineering"},
        ],
        "shifts": [
            {"id": DAY_SHIFT, "tenant_id": "hotel-a", "department_id": DEPT_HK,
             "name": "Day", "start_time": "07:00:00", "end_time": "15:00:00", "is_active": True},
            {"id": EVENING_SHIFT, "tenant_id": "hotel-a", "department_id": DEPT_HK,
             "name": "Evening", "start_time": "15:00:00", "end_time": "23:00:00", "is_active": True},
            {"id": NIGHT_SHIFT, "tenant_id": "hotel-a", "department_id": DEPT_HK,
             "name": "Night", "start_time": "23:00:00", "end_time": "07:00:00", "is_active": True},
        ],
        "logbook_entries": [],
        "shift_summaries": [],
        "user_profiles": [],
    }
    if extra_rows:
        rows.update(extra_rows)
    return FakeDB(rows)


@pytest.mark.parametrize(("instant", "expected_shift"), [
    ("2026-09-20T08:00:00", DAY_SHIFT),
    ("2026-09-20T16:00:00", EVENING_SHIFT),
    ("2026-09-21T01:00:00", NIGHT_SHIFT),
    ("2026-09-20T07:00:00", DAY_SHIFT),
    ("2026-09-20T15:00:00", EVENING_SHIFT),
    ("2026-09-20T23:00:00", NIGHT_SHIFT),
])
def test_create_entry_resolves_active_department_shift(monkeypatch, instant, expected_shift):
    db = _db()
    monkeypatch.setattr(logbook_router, "supabase", db)
    _freeze(monkeypatch, instant)

    response = TestClient(app).post(
        "/v1/logbook/entries",
        headers=_auth_header("gm"),
        json={"department_id": DEPT_HK, "content": "Shift handoff note"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["shift_id"] == expected_shift


def test_create_entry_leaves_shift_null_without_matching_department_shift(monkeypatch):
    db = _db({"shifts": [{
        "id": DAY_SHIFT, "tenant_id": "hotel-a", "department_id": DEPT_ENG,
        "name": "Engineering day", "start_time": "07:00:00", "end_time": "15:00:00", "is_active": True,
    }]})
    monkeypatch.setattr(logbook_router, "supabase", db)
    _freeze(monkeypatch, "2026-09-20T08:00:00")

    response = TestClient(app).post(
        "/v1/logbook/entries", headers=_auth_header("gm"),
        json={"department_id": DEPT_HK, "content": "No safe shift match"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["shift_id"] is None


def test_create_entry_leaves_shift_null_when_no_shifts_are_configured(monkeypatch):
    db = _db({"shifts": []})
    monkeypatch.setattr(logbook_router, "supabase", db)
    _freeze(monkeypatch, "2026-09-20T08:00:00")

    response = TestClient(app).post(
        "/v1/logbook/entries", headers=_auth_header("gm"),
        json={"department_id": DEPT_HK, "content": "No shifts configured"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["shift_id"] is None


def test_create_entry_preserves_explicit_shift_id(monkeypatch):
    db = _db()
    monkeypatch.setattr(logbook_router, "supabase", db)
    _freeze(monkeypatch, "2026-09-20T08:00:00")

    response = TestClient(app).post(
        "/v1/logbook/entries", headers=_auth_header("gm"),
        json={"department_id": DEPT_HK, "shift_id": NIGHT_SHIFT, "content": "Explicit compatibility"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["shift_id"] == NIGHT_SHIFT


def _entry(entry_id: str, *, author_id: str, department_id: str = DEPT_HK,
           shift_id: str | None = DAY_SHIFT, entry_date: str = "2026-09-20",
           expires_at: str | None = None, tenant_id: str = "hotel-a") -> dict:
    return {
        "id": entry_id, "tenant_id": tenant_id, "department_id": department_id,
        "shift_id": shift_id, "entry_date": entry_date, "author_id": author_id,
        "content": entry_id, "created_at": f"2026-09-20T0{entry_id[-1]}:00:00+00:00",
        "expires_at": expires_at, "departments": {"name": "Housekeeping"},
    }


def test_entry_list_hydrates_authors_and_returns_truthful_pagination(monkeypatch):
    db = _db({
        "logbook_entries": [
            _entry("entry-1", author_id="author-a"),
            _entry("entry-2", author_id="author-b"),
            _entry("entry-3", author_id="author-a"),
            _entry("entry-expired", author_id="author-a", expires_at="2020-01-01T00:00:00+00:00"),
            _entry("entry-other-hotel", author_id="author-other", tenant_id="hotel-b"),
        ],
        "user_profiles": [
            {"id": "author-a", "preferred_name": "Avery", "full_name": "Avery Adams"},
            {"id": "author-b", "full_name": "Blair Brown"},
        ],
    })
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).get(
        "/v1/logbook/entries", headers=_auth_header("gm"), params={"page": 1, "per_page": 2},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["meta"] == {"page": 1, "per_page": 2, "total": 3, "has_more": True}
    assert len(body["data"]) == 2
    profiles = {entry["author_id"]: entry.get("user_profiles") for entry in body["data"]}
    assert profiles["author-a"]["preferred_name"] == "Avery"
    assert profiles["author-b"]["full_name"] == "Blair Brown"
    assert len([call for call in db.select_calls if call[0] == "user_profiles"]) == 1


def test_entry_list_filters_apply_to_total_and_missing_profiles_are_safe(monkeypatch):
    db = _db({"logbook_entries": [
        _entry("entry-1", author_id="missing", shift_id=DAY_SHIFT, entry_date="2026-09-20"),
        _entry("entry-2", author_id="missing", shift_id=EVENING_SHIFT, entry_date="2026-09-20"),
        _entry("entry-3", author_id="missing", shift_id=DAY_SHIFT, entry_date="2026-09-19"),
        _entry("entry-4", author_id="missing", department_id=DEPT_ENG, shift_id=DAY_SHIFT),
    ]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).get(
        "/v1/logbook/entries", headers=_auth_header("gm"),
        params={"department_id": DEPT_HK, "shift_id": DAY_SHIFT, "entry_date": "2026-09-20"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["total"] == 1
    assert body["meta"]["has_more"] is False
    assert body["data"][0].get("user_profiles") is None


def test_chief_engineer_can_edit_another_author_entry_without_cross_tenant_leak(monkeypatch):
    db = _db({"logbook_entries": [
        _entry("entry-1", author_id="different-user"),
        _entry("entry-other-hotel", author_id="other", tenant_id="hotel-b"),
    ]})
    monkeypatch.setattr(logbook_router, "supabase", db)
    client = TestClient(app)

    allowed = client.patch(
        "/v1/logbook/entries/entry-1", headers=_auth_header("chief_engineer"), json={"content": "Updated"},
    )
    denied = client.patch(
        "/v1/logbook/entries/entry-other-hotel", headers=_auth_header("chief_engineer"), json={"content": "Nope"},
    )

    assert allowed.status_code == 200
    assert denied.status_code == 404


def test_chief_engineer_cannot_permanently_delete_another_author_entry(monkeypatch):
    db = _db({"logbook_entries": [_entry("entry-1", author_id="different-user")]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).delete(
        "/v1/logbook/entries/entry-1", headers=_auth_header("chief_engineer"),
    )

    assert response.status_code == 403
    assert len(db.rows["logbook_entries"]) == 1


def test_gm_can_permanently_delete_a_logbook_entry(monkeypatch):
    db = _db({"logbook_entries": [_entry("entry-1", author_id="different-user")]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).delete("/v1/logbook/entries/entry-1", headers=_auth_header("gm"))

    assert response.status_code == 204
    assert db.rows["logbook_entries"] == []


def test_summary_generation_contract_is_full_for_existing_and_fresh_summaries(monkeypatch):
    """Phase 5: the caller now supplies the exact shift_id/shift_date it's
    viewing (see test_shift_summary_generate.py for the full contract suite);
    this test only re-proves the response shape is complete either way."""
    from services.ai import shift_summary
    from middleware import credits as credits_module
    from types import SimpleNamespace

    db = _db({
        "shift_summaries": [{
            "id": "summary-1", "tenant_id": "hotel-a", "shift_id": DAY_SHIFT,
            "shift_date": "2026-09-20", "summary_text": "Stored", "stats": {"tasks_completed": 2},
        }],
        "credit_ledger": [{
            "id": "ledger-1", "tenant_id": "hotel-a",
            "period_start": "2026-01-01", "period_end": "2026-12-31",
            "credits_included": 5000, "overage_cost_cents": 0,
        }],
    })
    db.rpc = lambda name, params: SimpleNamespace(execute=lambda: SimpleNamespace(data=[]))
    monkeypatch.setattr(logbook_router, "supabase", db)
    monkeypatch.setattr(shift_summary, "supabase", db)
    monkeypatch.setattr(credits_module, "supabase", db)
    monkeypatch.setattr(settings, "ai_provider", "hosted")
    _freeze(monkeypatch, "2026-09-20T16:00:00")
    client = TestClient(app)

    existing = client.post(
        "/v1/logbook/shift-summary/generate", headers=_auth_header("chief_engineer"),
        json={"shift_id": DAY_SHIFT, "shift_date": "2026-09-20"},
    )
    assert existing.status_code == 200
    assert existing.json()["data"]["stats"]["tasks_completed"] == 2
    assert existing.json()["data"]["stats"]["sla_breaches_count"] == 0

    db.rows["shift_summaries"] = []
    monkeypatch.setattr(shift_summary, "get_anthropic_client", lambda: SimpleNamespace(
        messages=SimpleNamespace(create=lambda **_kw: SimpleNamespace(
            content=[SimpleNamespace(text="Fresh")],
            usage=SimpleNamespace(input_tokens=10, output_tokens=5),
        )),
    ))
    fresh = client.post(
        "/v1/logbook/shift-summary/generate", headers=_auth_header("chief_engineer"),
        json={"shift_id": DAY_SHIFT, "shift_date": "2026-09-20"},
    )
    assert fresh.status_code == 200
    data = fresh.json()["data"]
    assert data["summary_text"] == "Fresh"
    for key in (
        "tasks_completed", "open_work_orders", "logbook_entries_count",
        "vip_arrivals_count", "pending_guest_issues_count",
        "low_stock_parts_count", "sla_breaches_count", "follow_up_count",
    ):
        assert key in data["stats"]
    assert "handoff_data" in data
