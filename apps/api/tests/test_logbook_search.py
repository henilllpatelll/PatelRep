"""Phase 6 Logbook discovery contract: server-side, tenant-scoped search."""

from fastapi.testclient import TestClient

from main import app
from routers import logbook as logbook_router
from tests.smoke.fake_supabase import FakeDB
from tests.test_logbook_foundation import DEPT_HK, DAY_SHIFT, _auth_header


def _entry(entry_id: str, **overrides):
    row = {
        "id": entry_id,
        "tenant_id": "hotel-a",
        "department_id": DEPT_HK,
        "shift_id": DAY_SHIFT,
        "entry_date": "2026-09-20",
        "author_id": "11111111-1111-4111-8111-111111111111",
        "assigned_to": None,
        "content": "Plumbing leak under bathroom sink",
        "category": "maintenance",
        "status": "follow_up",
        "priority": "important",
        "related_type": "room",
        "related_id": "33333333-3333-4333-8333-333333333333",
        "created_at": "2026-09-20T10:00:00+00:00",
        "expires_at": None,
        "archived_at": None,
    }
    row.update(overrides)
    return row


def _db():
    return FakeDB({
        "tenants": [{"id": "hotel-a", "timezone": "UTC"}],
        "logbook_entries": [
            _entry("match"),
            _entry("resolved", status="resolved", content="Boiler pressure restored", priority="normal", related_type=None, related_id=None),
            _entry("null-shift", shift_id=None, entry_date="2026-09-19", content="Plumbing follow-up remains", related_type=None, related_id=None),
            _entry("archive", archived_at="2026-09-20T12:00:00Z"),
            _entry("expired", expires_at="2020-01-01T00:00:00Z"),
            _entry("other-tenant", tenant_id="hotel-b", content="Plumbing leak at another hotel"),
        ],
        "user_profiles": [],
        "rooms": [{"id": "33333333-3333-4333-8333-333333333333", "tenant_id": "hotel-a", "room_number": "412"}],
    })


def test_search_is_case_insensitive_filters_on_server_and_has_truthful_total(monkeypatch):
    db = _db()
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).get(
        "/v1/logbook/entries",
        headers=_auth_header("gm"),
        params={"q": "PLUMB", "department_id": DEPT_HK, "category": "maintenance", "status": "follow_up", "priority": "important", "page": 1, "per_page": 1},
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["data"]] == ["match"]
    assert response.json()["meta"] == {"page": 1, "per_page": 1, "total": 2, "has_more": True}


def test_search_includes_linked_room_and_excludes_archived_expired_and_other_tenants(monkeypatch):
    db = _db()
    db.rows["logbook_entries"][0]["content"] = "Leak investigated; replacement ordered"
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).get("/v1/logbook/entries", headers=_auth_header("gm"), params={"q": "412"})

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["data"]] == ["match"]


def test_search_dates_owner_related_type_and_invalid_values_are_safe(monkeypatch):
    db = _db()
    db.rows["logbook_entries"][0]["assigned_to"] = "22222222-2222-4222-8222-222222222222"
    monkeypatch.setattr(logbook_router, "supabase", db)
    client = TestClient(app)

    filtered = client.get("/v1/logbook/entries", headers=_auth_header("gm"), params={
        "date_from": "2026-09-20", "date_to": "2026-09-20", "assigned_to": "22222222-2222-4222-8222-222222222222", "related_type": "room",
    })
    assert filtered.status_code == 200
    assert [item["id"] for item in filtered.json()["data"]] == ["match"]

    safe = client.get("/v1/logbook/entries", headers=_auth_header("gm"), params={"q": "%'_,()", "status": "banana"})
    assert safe.status_code == 200
    assert safe.json()["meta"]["total"] == 3

    reverse_dates = client.get("/v1/logbook/entries", headers=_auth_header("gm"), params={"date_from": "2026-09-21", "date_to": "2026-09-20"})
    assert reverse_dates.status_code == 422


def test_search_supports_author_shift_unassigned_and_resolved_history(monkeypatch):
    db = _db()
    monkeypatch.setattr(logbook_router, "supabase", db)
    client = TestClient(app)

    author_and_shift = client.get("/v1/logbook/entries", headers=_auth_header("gm"), params={
        "q": "plumb", "author_id": "11111111-1111-4111-8111-111111111111", "shift_id": DAY_SHIFT,
    })
    assert author_and_shift.status_code == 200
    assert [item["id"] for item in author_and_shift.json()["data"]] == ["match"]

    unassigned = client.get("/v1/logbook/entries", headers=_auth_header("gm"), params={"assigned_to": "__unassigned__", "status": "resolved"})
    assert unassigned.status_code == 200
    assert [item["id"] for item in unassigned.json()["data"]] == ["resolved"]

    resolved_search = client.get("/v1/logbook/entries", headers=_auth_header("gm"), params={"q": "boiler", "status": "resolved"})
    assert resolved_search.status_code == 200
    assert [item["id"] for item in resolved_search.json()["data"]] == ["resolved"]
