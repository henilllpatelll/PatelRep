"""Phase 3 Logbook handoff contracts: structure, tenant boundaries, and edits."""

from datetime import datetime, timezone

from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import logbook as logbook_router
from tests.smoke.fake_supabase import FakeDB

DEPARTMENT_ID = "11111111-1111-4111-8111-111111111111"
ASSIGNEE_ID = "33333333-3333-4333-8333-333333333333"
OTHER_ASSIGNEE_ID = "44444444-4444-4444-8444-444444444444"
WORK_ORDER_ID = "55555555-5555-4555-8555-555555555555"
OTHER_WORK_ORDER_ID = "66666666-6666-4666-8666-666666666666"


def _auth_header(role: str = "gm") -> dict[str, str]:
    token = jwt.encode(
        {"sub": "77777777-7777-4777-8777-777777777777", "role": role, "hotel_id": "hotel-a", "aud": "authenticated"},
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


def _db(extra_rows: dict | None = None) -> FakeDB:
    rows = {
        "tenants": [{"id": "hotel-a", "timezone": "UTC"}],
        "departments": [{"id": DEPARTMENT_ID, "tenant_id": "hotel-a", "name": "Engineering"}],
        "shifts": [],
        "logbook_entries": [],
        "user_profiles": [
            {"id": ASSIGNEE_ID, "tenant_id": "hotel-a", "preferred_name": "Kevin", "full_name": "Kevin Rodriguez"},
            {"id": OTHER_ASSIGNEE_ID, "tenant_id": "hotel-b", "full_name": "Outside Hotel"},
        ],
        "user_roles": [
            {"user_id": ASSIGNEE_ID, "tenant_id": "hotel-a", "role": "front_desk", "is_active": True},
            {"user_id": OTHER_ASSIGNEE_ID, "tenant_id": "hotel-b", "role": "front_desk", "is_active": True},
        ],
        "work_orders": [
            {"id": WORK_ORDER_ID, "tenant_id": "hotel-a", "title": "Plumbing leak"},
            {"id": OTHER_WORK_ORDER_ID, "tenant_id": "hotel-b", "title": "Private work order"},
        ],
        "rooms": [],
        "tasks": [],
        "guest_requests": [],
    }
    if extra_rows:
        rows.update(extra_rows)
    return FakeDB(rows)


def test_legacy_mobile_payload_gets_safe_structured_defaults(monkeypatch):
    db = _db()
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).post(
        "/v1/logbook/entries",
        headers=_auth_header(),
        json={"department_id": DEPARTMENT_ID, "content": "  Legacy handoff  "},
    )

    assert response.status_code == 200
    entry = response.json()["data"]
    assert entry["content"] == "Legacy handoff"
    assert entry["category"] == "general"
    assert entry["status"] == "informational"
    assert entry["priority"] == "normal"
    assert entry["follow_up_at"] is None
    assert entry["assigned_to"] is None
    assert entry["related_type"] is None
    assert entry["related_id"] is None


def test_structured_follow_up_validates_tenant_scoped_owner_and_work_order(monkeypatch):
    db = _db()
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).post(
        "/v1/logbook/entries",
        headers=_auth_header(),
        json={
            "department_id": DEPARTMENT_ID,
            "content": "Valve is on order.",
            "category": "maintenance",
            "priority": "important",
            "status": "follow_up",
            "follow_up_at": "2026-09-30T17:00:00Z",
            "assigned_to": ASSIGNEE_ID,
            "related_type": "work_order",
            "related_id": WORK_ORDER_ID,
        },
    )

    assert response.status_code == 200
    entry = response.json()["data"]
    assert entry["status"] == "follow_up"
    assert entry["assigned_to"] == ASSIGNEE_ID
    assert entry["related_type"] == "work_order"
    assert entry["related_id"] == WORK_ORDER_ID
    assert entry["assigned_user_profiles"]["preferred_name"] == "Kevin"


def test_create_rejects_cross_tenant_assignee_and_related_item(monkeypatch):
    db = _db()
    monkeypatch.setattr(logbook_router, "supabase", db)
    client = TestClient(app)

    bad_assignee = client.post(
        "/v1/logbook/entries",
        headers=_auth_header(),
        json={"department_id": DEPARTMENT_ID, "content": "Follow up", "status": "follow_up", "assigned_to": OTHER_ASSIGNEE_ID},
    )
    bad_related = client.post(
        "/v1/logbook/entries",
        headers=_auth_header(),
        json={"department_id": DEPARTMENT_ID, "content": "Follow up", "related_type": "work_order", "related_id": OTHER_WORK_ORDER_ID},
    )

    assert bad_assignee.status_code == 422
    assert bad_related.status_code == 422
    assert db.rows["logbook_entries"] == []


def test_update_structured_fields_marks_entry_edited_and_clears_informational_follow_up_data(monkeypatch):
    entry_id = "88888888-8888-4888-8888-888888888888"
    db = _db({"logbook_entries": [{
        "id": entry_id, "tenant_id": "hotel-a", "department_id": DEPARTMENT_ID,
        "author_id": "77777777-7777-4777-8777-777777777777", "content": "Old", "category": "general",
        "status": "informational", "priority": "normal", "created_at": "2026-09-29T12:00:00Z",
        # A real Postgres row always carries every column (NULL if unset) — seed the
        # rest of migration 117's columns explicitly so the fake DB's "no-op filter"
        # in update_logbook_entry can tell "already null" from "column never existed".
        "follow_up_at": None, "assigned_to": None, "related_type": None, "related_id": None,
        "resolved_at": None, "resolved_by": None, "edited_at": None, "archived_at": None,
        "expires_at": None,
    }]})
    monkeypatch.setattr(logbook_router, "supabase", db)
    frozen = type("FrozenDateTime", (datetime,), {"now": classmethod(lambda cls, tz=None: datetime(2026, 9, 29, 13, tzinfo=timezone.utc))})
    monkeypatch.setattr(logbook_router, "datetime", frozen)

    response = TestClient(app).patch(
        f"/v1/logbook/entries/{entry_id}",
        headers=_auth_header(),
        json={
            "content": "Updated", "category": "safety", "priority": "important", "status": "informational",
            "assigned_to": ASSIGNEE_ID, "follow_up_at": "2026-09-30T17:00:00Z",
        },
    )

    assert response.status_code == 200
    entry = response.json()["data"]
    assert entry["content"] == "Updated"
    assert entry["category"] == "safety"
    assert entry["priority"] == "important"
    assert entry["assigned_to"] is None
    assert entry["follow_up_at"] is None
    assert entry["edited_at"] == "2026-09-29T13:00:00+00:00"
