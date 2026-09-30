"""Phase 4 Logbook shift-continuity contracts: resolve, carry forward, archive,
continuity chain, and the operational-history event log."""

from datetime import datetime

from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import logbook as logbook_router
from tests.smoke.fake_supabase import FakeDB

DEPARTMENT_ID = "11111111-1111-4111-8111-111111111111"
AUTHOR_ID = "77777777-7777-4777-8777-777777777777"
OTHER_STAFF_ID = "22222222-2222-4222-8222-222222222222"
ASSIGNEE_ID = "33333333-3333-4333-8333-333333333333"
MORNING_SHIFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
EVENING_SHIFT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
NIGHT_SHIFT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
ENTRY_ID = "88888888-8888-4888-8888-888888888888"


def _auth_header(role: str = "gm", user_id: str = AUTHOR_ID) -> dict[str, str]:
    token = jwt.encode(
        {"sub": user_id, "role": role, "hotel_id": "hotel-a", "aud": "authenticated"},
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


def _base_entry(**overrides) -> dict:
    entry = {
        "id": ENTRY_ID, "tenant_id": "hotel-a", "department_id": DEPARTMENT_ID,
        "shift_id": EVENING_SHIFT_ID, "entry_date": "2026-09-28",
        "author_id": AUTHOR_ID, "content": "Plumbing leak under bathroom sink.",
        "category": "maintenance", "status": "follow_up", "priority": "important",
        "created_at": "2026-09-28T20:00:00Z",
        "follow_up_at": "2026-09-28T23:00:00Z", "assigned_to": ASSIGNEE_ID,
        "related_type": None, "related_id": None,
        "resolved_at": None, "resolved_by": None, "resolution_note": None,
        "edited_at": None, "archived_at": None, "expires_at": None,
        "carried_from_entry_id": None, "carried_forward_at": None, "carried_forward_by": None,
    }
    entry.update(overrides)
    return entry


def _db(extra_rows: dict | None = None) -> FakeDB:
    rows = {
        "tenants": [{"id": "hotel-a", "timezone": "UTC"}],
        "departments": [{"id": DEPARTMENT_ID, "tenant_id": "hotel-a", "name": "Housekeeping"}],
        "shifts": [
            {"id": MORNING_SHIFT_ID, "tenant_id": "hotel-a", "department_id": DEPARTMENT_ID, "name": "AM", "start_time": "07:00:00", "end_time": "15:00:00", "is_active": True},
            {"id": EVENING_SHIFT_ID, "tenant_id": "hotel-a", "department_id": DEPARTMENT_ID, "name": "PM", "start_time": "15:00:00", "end_time": "23:00:00", "is_active": True},
            {"id": NIGHT_SHIFT_ID, "tenant_id": "hotel-a", "department_id": DEPARTMENT_ID, "name": "Overnight", "start_time": "23:00:00", "end_time": "07:00:00", "is_active": True},
        ],
        "logbook_entries": [],
        "logbook_entry_events": [],
        "user_profiles": [
            {"id": AUTHOR_ID, "tenant_id": "hotel-a", "full_name": "Maria"},
            {"id": ASSIGNEE_ID, "tenant_id": "hotel-a", "preferred_name": "Kevin", "full_name": "Kevin Rodriguez"},
            {"id": OTHER_STAFF_ID, "tenant_id": "hotel-a", "full_name": "Sarah"},
        ],
        "user_roles": [
            {"user_id": ASSIGNEE_ID, "tenant_id": "hotel-a", "role": "front_desk", "is_active": True},
            {"user_id": OTHER_STAFF_ID, "tenant_id": "hotel-a", "role": "front_desk", "is_active": True},
        ],
    }
    if extra_rows:
        for key, value in extra_rows.items():
            if key in rows and isinstance(rows[key], list) and isinstance(value, list):
                rows[key] = value
            else:
                rows[key] = value
    return FakeDB(rows)


def _freeze(monkeypatch, iso: str) -> None:
    fixed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    frozen = type("FrozenDateTime", (datetime,), {"now": classmethod(lambda cls, tz=None: fixed)})
    monkeypatch.setattr(logbook_router, "datetime", frozen)


# ── Single entry fetch ──────────────────────────────────────────────────────

def test_get_entry_returns_hydrated_entry(monkeypatch):
    db = _db({"logbook_entries": [_base_entry()]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).get(f"/v1/logbook/entries/{ENTRY_ID}", headers=_auth_header())
    assert response.status_code == 200
    entry = response.json()["data"]
    assert entry["id"] == ENTRY_ID
    assert entry["assigned_user_profiles"]["preferred_name"] == "Kevin"


def test_get_entry_cross_tenant_is_not_found(monkeypatch):
    db = _db({"logbook_entries": [_base_entry(tenant_id="hotel-b")]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).get(f"/v1/logbook/entries/{ENTRY_ID}", headers=_auth_header())
    assert response.status_code == 404


# ── Resolve ───────────────────────────────────────────────────────────────

def test_resolve_marks_entry_resolved_with_note_and_event(monkeypatch):
    db = _db({"logbook_entries": [_base_entry()]})
    monkeypatch.setattr(logbook_router, "supabase", db)
    _freeze(monkeypatch, "2026-09-29T16:18:00Z")

    response = TestClient(app).post(
        f"/v1/logbook/entries/{ENTRY_ID}/resolve",
        headers=_auth_header(),
        json={"resolution_note": "Replacement valve installed. Leak tested."},
    )

    assert response.status_code == 200
    entry = response.json()["data"]
    assert entry["status"] == "resolved"
    assert entry["resolved_at"] == "2026-09-29T16:18:00+00:00"
    assert entry["resolved_by"] == AUTHOR_ID
    assert entry["resolution_note"] == "Replacement valve installed. Leak tested."
    # logbook_entries_follow_up_data_check (migration 117) requires these null
    # once status leaves follow_up — a real Postgres CHECK constraint the fake
    # DB doesn't enforce, so this must be asserted explicitly here.
    assert entry["follow_up_at"] is None
    assert entry["assigned_to"] is None

    events = [row for row in db.rows["logbook_entry_events"] if row["entry_id"] == ENTRY_ID]
    assert len(events) == 1 and events[0]["event_type"] == "resolved"


def test_resolve_is_idempotent_and_does_not_duplicate_event(monkeypatch):
    db = _db({"logbook_entries": [_base_entry(status="resolved", resolved_at="2026-09-29T16:00:00Z", resolved_by=AUTHOR_ID)]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).post(
        f"/v1/logbook/entries/{ENTRY_ID}/resolve",
        headers=_auth_header(),
        json={"resolution_note": "second attempt"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["already_resolved"] is True
    assert db.rows["logbook_entry_events"] == []


def test_resolve_rejects_informational_status(monkeypatch):
    db = _db({"logbook_entries": [_base_entry(status="informational")]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).post(f"/v1/logbook/entries/{ENTRY_ID}/resolve", headers=_auth_header(), json={})
    assert response.status_code == 422


def test_resolve_blocked_for_unauthorized_role(monkeypatch):
    db = _db({"logbook_entries": [_base_entry()]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).post(
        f"/v1/logbook/entries/{ENTRY_ID}/resolve",
        headers=_auth_header(role="front_desk", user_id=OTHER_STAFF_ID),
        json={},
    )
    assert response.status_code == 403


def test_resolve_cross_tenant_entry_is_not_found(monkeypatch):
    db = _db({"logbook_entries": [_base_entry(tenant_id="hotel-b")]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).post(f"/v1/logbook/entries/{ENTRY_ID}/resolve", headers=_auth_header(), json={})
    assert response.status_code == 404


# ── Carry forward ─────────────────────────────────────────────────────────

def test_carry_forward_creates_new_entry_on_next_shift_and_preserves_source(monkeypatch):
    db = _db({"logbook_entries": [_base_entry()]})
    monkeypatch.setattr(logbook_router, "supabase", db)
    _freeze(monkeypatch, "2026-09-28T22:55:00Z")

    response = TestClient(app).post(f"/v1/logbook/entries/{ENTRY_ID}/carry-forward", headers=_auth_header(), json={})

    assert response.status_code == 200
    new_entry = response.json()["data"]
    assert new_entry["shift_id"] == NIGHT_SHIFT_ID
    assert new_entry["entry_date"] == "2026-09-28"  # PM -> Overnight, same calendar day
    assert new_entry["status"] == "follow_up"
    assert new_entry["carried_from_entry_id"] == ENTRY_ID
    assert new_entry["author_id"] == AUTHOR_ID
    assert new_entry["assigned_to"] == ASSIGNEE_ID  # owner preserved by default
    assert new_entry["follow_up_at"] == "2026-09-28T23:00:00Z"  # original due date preserved
    assert new_entry["content"] == "Plumbing leak under bathroom sink."

    source = next(row for row in db.rows["logbook_entries"] if row["id"] == ENTRY_ID)
    assert source["status"] == "follow_up"  # source stays follow_up, never mutated to resolved
    assert source["resolved_at"] is None

    event_types = sorted(
        (row["event_type"], row["entry_id"]) for row in db.rows["logbook_entry_events"]
    )
    assert ("carried_forward", ENTRY_ID) in event_types
    assert ("created", new_entry["id"]) in event_types


def test_carry_forward_across_midnight_advances_destination_date(monkeypatch):
    db = _db({"logbook_entries": [_base_entry(shift_id=NIGHT_SHIFT_ID, entry_date="2026-09-28", follow_up_at=None)]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).post(f"/v1/logbook/entries/{ENTRY_ID}/carry-forward", headers=_auth_header(), json={})

    assert response.status_code == 200
    new_entry = response.json()["data"]
    assert new_entry["shift_id"] == MORNING_SHIFT_ID
    assert new_entry["entry_date"] == "2026-09-29"


def test_carry_forward_owner_can_be_changed(monkeypatch):
    db = _db({"logbook_entries": [_base_entry()]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).post(
        f"/v1/logbook/entries/{ENTRY_ID}/carry-forward",
        headers=_auth_header(),
        json={"assigned_to": OTHER_STAFF_ID},
    )

    assert response.status_code == 200
    assert response.json()["data"]["assigned_to"] == OTHER_STAFF_ID
    source = next(row for row in db.rows["logbook_entries"] if row["id"] == ENTRY_ID)
    assert source["assigned_to"] == ASSIGNEE_ID  # original entry's owner untouched


def test_carry_forward_blocks_duplicate_successor(monkeypatch):
    successor_id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    db = _db({"logbook_entries": [
        _base_entry(),
        _base_entry(id=successor_id, shift_id=NIGHT_SHIFT_ID, carried_from_entry_id=ENTRY_ID),
    ]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).post(f"/v1/logbook/entries/{ENTRY_ID}/carry-forward", headers=_auth_header(), json={})
    assert response.status_code == 409


def test_carry_forward_rejects_resolved_or_informational_entries(monkeypatch):
    db = _db({"logbook_entries": [_base_entry(status="informational")]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).post(f"/v1/logbook/entries/{ENTRY_ID}/carry-forward", headers=_auth_header(), json={})
    assert response.status_code == 422


def test_carry_forward_with_no_configured_next_shift_is_a_safe_error(monkeypatch):
    db = _db({"shifts": [
        {"id": EVENING_SHIFT_ID, "tenant_id": "hotel-a", "department_id": DEPARTMENT_ID, "name": "Only Shift", "start_time": "15:00:00", "end_time": "23:00:00", "is_active": True},
    ], "logbook_entries": [_base_entry()]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).post(f"/v1/logbook/entries/{ENTRY_ID}/carry-forward", headers=_auth_header(), json={})
    assert response.status_code == 422


def test_carry_forward_blocked_for_unauthorized_role(monkeypatch):
    db = _db({"logbook_entries": [_base_entry()]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).post(
        f"/v1/logbook/entries/{ENTRY_ID}/carry-forward",
        headers=_auth_header(role="front_desk", user_id=OTHER_STAFF_ID),
        json={},
    )
    assert response.status_code == 403


def test_carry_forward_cross_tenant_entry_is_not_found(monkeypatch):
    db = _db({"logbook_entries": [_base_entry(tenant_id="hotel-b")]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).post(f"/v1/logbook/entries/{ENTRY_ID}/carry-forward", headers=_auth_header(), json={})
    assert response.status_code == 404


# ── Archive ───────────────────────────────────────────────────────────────

def test_archive_sets_archived_at_and_writes_event(monkeypatch):
    db = _db({"logbook_entries": [_base_entry(status="informational")]})
    monkeypatch.setattr(logbook_router, "supabase", db)
    _freeze(monkeypatch, "2026-09-29T18:00:00Z")

    response = TestClient(app).post(f"/v1/logbook/entries/{ENTRY_ID}/archive", headers=_auth_header())
    assert response.status_code == 200
    assert response.json()["data"]["archived_at"] == "2026-09-29T18:00:00+00:00"
    events = [row for row in db.rows["logbook_entry_events"] if row["event_type"] == "archived"]
    assert len(events) == 1


def test_archive_is_idempotent(monkeypatch):
    db = _db({"logbook_entries": [_base_entry(archived_at="2026-09-29T10:00:00Z")]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).post(f"/v1/logbook/entries/{ENTRY_ID}/archive", headers=_auth_header())
    assert response.status_code == 200
    assert response.json()["data"]["already_archived"] is True
    assert db.rows["logbook_entry_events"] == []


# ── Continuity + events ────────────────────────────────────────────────────

def test_continuity_returns_full_chain_in_chronological_order(monkeypatch):
    entry_b = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    entry_c = "ffffffff-ffff-4fff-8fff-ffffffffffff"
    db = _db({"logbook_entries": [
        _base_entry(shift_id=EVENING_SHIFT_ID, entry_date="2026-09-28", status="follow_up"),
        _base_entry(id=entry_b, shift_id=NIGHT_SHIFT_ID, entry_date="2026-09-28", status="follow_up", carried_from_entry_id=ENTRY_ID),
        _base_entry(id=entry_c, shift_id=MORNING_SHIFT_ID, entry_date="2026-09-29", status="resolved", resolved_at="2026-09-29T16:00:00Z", carried_from_entry_id=entry_b),
    ]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).get(f"/v1/logbook/entries/{entry_b}/continuity", headers=_auth_header())
    assert response.status_code == 200
    chain = response.json()["data"]
    assert [row["id"] for row in chain] == [ENTRY_ID, entry_b, entry_c]
    assert chain[-1]["status"] == "resolved"


def test_continuity_of_single_entry_returns_empty_chain(monkeypatch):
    db = _db({"logbook_entries": [_base_entry()]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).get(f"/v1/logbook/entries/{ENTRY_ID}/continuity", headers=_auth_header())
    assert response.status_code == 200
    assert response.json()["data"] == []


def test_continuity_survives_a_corrupted_self_reference_cycle(monkeypatch):
    """A manufactured cycle (never reachable through the real carry-forward
    endpoint) must not hang the traversal."""
    entry_b = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    db = _db({"logbook_entries": [
        _base_entry(carried_from_entry_id=entry_b),
        _base_entry(id=entry_b, carried_from_entry_id=ENTRY_ID),
    ]})
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).get(f"/v1/logbook/entries/{ENTRY_ID}/continuity", headers=_auth_header())
    assert response.status_code == 200  # returns instead of hanging


def test_events_lists_newest_first_with_actor_names(monkeypatch):
    db = _db({
        "logbook_entries": [_base_entry()],
        "logbook_entry_events": [
            {"id": "ev-1", "tenant_id": "hotel-a", "entry_id": ENTRY_ID, "event_type": "created", "actor_id": AUTHOR_ID, "created_at": "2026-09-28T20:00:00Z", "metadata": {}},
            {"id": "ev-2", "tenant_id": "hotel-a", "entry_id": ENTRY_ID, "event_type": "edited", "actor_id": OTHER_STAFF_ID, "created_at": "2026-09-28T21:00:00Z", "metadata": {"fields": ["priority"]}},
        ],
    })
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).get(f"/v1/logbook/entries/{ENTRY_ID}/events", headers=_auth_header())
    assert response.status_code == 200
    events = response.json()["data"]
    assert [event["event_type"] for event in events] == ["edited", "created"]
    assert events[0]["actor_name"] == "Sarah"


def test_events_are_tenant_isolated(monkeypatch):
    db = _db({
        "logbook_entries": [_base_entry()],
        "logbook_entry_events": [
            {"id": "ev-1", "tenant_id": "hotel-b", "entry_id": ENTRY_ID, "event_type": "created", "actor_id": AUTHOR_ID, "created_at": "2026-09-28T20:00:00Z", "metadata": {}},
        ],
    })
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).get(f"/v1/logbook/entries/{ENTRY_ID}/events", headers=_auth_header())
    assert response.status_code == 200
    assert response.json()["data"] == []


def test_create_and_edit_write_events(monkeypatch):
    db = _db()
    monkeypatch.setattr(logbook_router, "supabase", db)
    client = TestClient(app)

    created = client.post(
        "/v1/logbook/entries",
        headers=_auth_header(),
        json={"department_id": DEPARTMENT_ID, "content": "New note"},
    )
    entry_id = created.json()["data"]["id"]
    assert [row["event_type"] for row in db.rows["logbook_entry_events"]] == ["created"]

    client.patch(f"/v1/logbook/entries/{entry_id}", headers=_auth_header(), json={"priority": "important"})
    event_types = [row["event_type"] for row in db.rows["logbook_entry_events"]]
    assert event_types == ["created", "edited"]
