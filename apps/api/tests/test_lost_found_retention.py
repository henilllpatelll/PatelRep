"""Lost & found retention clock (D-10), disposition review queue (D-11), and disposition RBAC (D-12).

Mirrors the TestClient + real-JWT harness used in tests/test_programs_routes.py for
HTTP-level RBAC checks, and the direct-router-call + FakeDB harness for logic checks
that need database-state assertions (mirrors tests/test_internal_escalations.py for
cron-endpoint conventions).
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from middleware.auth import CurrentUser
from routers import internal as internal_router
from routers import lost_found as lost_found_router
from tests.smoke.fake_supabase import FakeDB

GM = CurrentUser(user_id="gm-1", hotel_id="hotel-a", role="gm")


def _auth_header(role: str, hotel_id: str = "hotel-a", user_id: str = "user-a-1") -> dict[str, str]:
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _seeded_item_db(status: str = "unclaimed") -> FakeDB:
    return FakeDB({
        "lost_found_items": [{"id": "item-1", "tenant_id": "hotel-a", "status": status}],
        "lost_found_custody_events": [],
    })


# ---------------------------------------------------------------------------
# Task 1: retention clock at intake (D-10) + disposition_due review queue (D-11)
# ---------------------------------------------------------------------------


def test_intake_sets_retention_due_at_ninety_days_out(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(lost_found_router, "supabase", db)
    client = TestClient(app)

    before = datetime.now(timezone.utc)
    response = client.post(
        "/v1/lost-found",
        headers=_auth_header("front_desk"),
        json={"description": "Black wallet", "location_found": "Lobby"},
    )
    after = datetime.now(timezone.utc)

    assert response.status_code == 200
    item = response.json()["data"]
    retention_due_at = datetime.fromisoformat(item["retention_due_at"])
    assert before + timedelta(days=90) <= retention_due_at <= after + timedelta(days=90)


def test_retention_due_at_is_not_taken_from_request_body(monkeypatch):
    """CreateLostFoundRequest has no retention_due_at field, so a spoofed value is dropped."""
    db = FakeDB()
    monkeypatch.setattr(lost_found_router, "supabase", db)
    client = TestClient(app)

    spoofed_short_clock = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    response = client.post(
        "/v1/lost-found",
        headers=_auth_header("front_desk"),
        json={"description": "Phone charger", "retention_due_at": spoofed_short_clock},
    )

    assert response.status_code == 200
    item = response.json()["data"]
    retention_due_at = datetime.fromisoformat(item["retention_due_at"])
    assert retention_due_at > datetime.now(timezone.utc) + timedelta(days=85)


@pytest.mark.asyncio
async def test_disposition_due_filter_returns_only_expired_unclaimed(monkeypatch):
    now = datetime.now(timezone.utc)
    db = FakeDB({
        "lost_found_items": [
            {
                "id": "item-expired-unclaimed",
                "tenant_id": "hotel-a",
                "status": "unclaimed",
                "retention_due_at": (now - timedelta(days=1)).isoformat(),
                "created_at": now.isoformat(),
            },
            {
                "id": "item-not-yet-due",
                "tenant_id": "hotel-a",
                "status": "unclaimed",
                "retention_due_at": (now + timedelta(days=1)).isoformat(),
                "created_at": now.isoformat(),
            },
            {
                "id": "item-expired-claimed",
                "tenant_id": "hotel-a",
                "status": "claimed",
                "retention_due_at": (now - timedelta(days=5)).isoformat(),
                "created_at": now.isoformat(),
            },
        ],
    })
    monkeypatch.setattr(lost_found_router, "supabase", db)

    response = await lost_found_router.list_lost_found_items(
        status=None,
        date_from=None,
        date_to=None,
        search=None,
        disposition_due=True,
        page=1,
        per_page=20,
        current_user=GM,
    )

    ids = [item["id"] for item in response["data"]]
    assert ids == ["item-expired-unclaimed"]


@pytest.mark.asyncio
async def test_disposition_due_combined_with_claimed_status_returns_empty(monkeypatch):
    """disposition_due implies unclaimed, so combining it with status=claimed yields nothing (no error)."""
    now = datetime.now(timezone.utc)
    db = FakeDB({
        "lost_found_items": [
            {
                "id": "item-expired-claimed",
                "tenant_id": "hotel-a",
                "status": "claimed",
                "retention_due_at": (now - timedelta(days=5)).isoformat(),
                "created_at": now.isoformat(),
            },
        ],
    })
    monkeypatch.setattr(lost_found_router, "supabase", db)

    response = await lost_found_router.list_lost_found_items(
        status="claimed",
        date_from=None,
        date_to=None,
        search=None,
        disposition_due=True,
        page=1,
        per_page=20,
        current_user=GM,
    )

    assert response["data"] == []


def test_disposition_rbac_allows_front_desk(monkeypatch):
    db = _seeded_item_db()
    monkeypatch.setattr(lost_found_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/lost-found/item-1/custody-events",
        headers=_auth_header("front_desk"),
        json={"event_type": "disposition", "disposition": "donated"},
    )

    assert response.status_code == 200
    assert db.rows["lost_found_items"][0]["status"] == "donated"


def test_disposition_rbac_allows_gm_and_supervisor(monkeypatch):
    for role in ("gm", "housekeeping_supervisor"):
        db = _seeded_item_db()
        monkeypatch.setattr(lost_found_router, "supabase", db)
        client = TestClient(app)

        response = client.post(
            "/v1/lost-found/item-1/custody-events",
            headers=_auth_header(role),
            json={"event_type": "disposition", "disposition": "discarded"},
        )

        assert response.status_code == 200, f"{role} should be allowed to record a disposition"


def test_disposition_rbac_rejects_engineer_with_403(monkeypatch):
    db = _seeded_item_db()
    monkeypatch.setattr(lost_found_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/lost-found/item-1/custody-events",
        headers=_auth_header("engineer"),
        json={"event_type": "disposition", "disposition": "donated"},
    )

    assert response.status_code == 403
    assert db.rows["lost_found_items"][0]["status"] == "unclaimed"


# ---------------------------------------------------------------------------
# Task 2: retention-check cron endpoint (flag only, never dispose) — D-11
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_retention_check_rejects_bad_cron_secret():
    with pytest.raises(HTTPException) as exc:
        await internal_router.check_lost_found_retention(x_cron_secret="wrong-secret")

    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_retention_check_flags_expired_unclaimed_items(monkeypatch):
    now = datetime.now(timezone.utc)
    db = FakeDB({
        "lost_found_items": [
            {
                "id": "item-a",
                "tenant_id": "hotel-a",
                "status": "unclaimed",
                "retention_due_at": (now - timedelta(days=1)).isoformat(),
                "disposition_flagged_at": None,
            },
            {
                "id": "item-b",
                "tenant_id": "hotel-a",
                "status": "unclaimed",
                "retention_due_at": (now + timedelta(days=1)).isoformat(),
                "disposition_flagged_at": None,
            },
        ],
    })
    monkeypatch.setattr(internal_router, "supabase", db)

    result = await internal_router.check_lost_found_retention(x_cron_secret=settings.cron_secret)

    assert result == {"status": "ok", "flagged": 1}
    flagged = next(row for row in db.rows["lost_found_items"] if row["id"] == "item-a")
    not_due = next(row for row in db.rows["lost_found_items"] if row["id"] == "item-b")
    assert flagged["disposition_flagged_at"] is not None
    assert not_due["disposition_flagged_at"] is None


@pytest.mark.asyncio
async def test_retention_check_does_not_change_status_or_create_custody_event(monkeypatch):
    now = datetime.now(timezone.utc)
    db = FakeDB({
        "lost_found_items": [
            {
                "id": "item-a",
                "tenant_id": "hotel-a",
                "status": "unclaimed",
                "retention_due_at": (now - timedelta(days=1)).isoformat(),
                "disposition_flagged_at": None,
            },
        ],
        "lost_found_custody_events": [],
    })
    monkeypatch.setattr(internal_router, "supabase", db)

    await internal_router.check_lost_found_retention(x_cron_secret=settings.cron_secret)

    assert db.rows["lost_found_items"][0]["status"] == "unclaimed"
    assert db.rows["lost_found_items"][0]["disposition_flagged_at"] is not None
    assert db.rows["lost_found_custody_events"] == []
    assert all(table != "lost_found_custody_events" for table, _ in db.inserts)
    # db.updates records the post-update row snapshot; confirm status was never
    # written to anything but its original value on every lost_found_items update.
    assert all(
        row_snapshot.get("status") == "unclaimed"
        for table, row_snapshot in db.updates
        if table == "lost_found_items"
    )


@pytest.mark.asyncio
async def test_retention_check_is_idempotent_on_second_run(monkeypatch):
    now = datetime.now(timezone.utc)
    db = FakeDB({
        "lost_found_items": [
            {
                "id": "item-a",
                "tenant_id": "hotel-a",
                "status": "unclaimed",
                "retention_due_at": (now - timedelta(days=1)).isoformat(),
                "disposition_flagged_at": None,
            },
        ],
    })
    monkeypatch.setattr(internal_router, "supabase", db)

    first = await internal_router.check_lost_found_retention(x_cron_secret=settings.cron_secret)
    second = await internal_router.check_lost_found_retention(x_cron_secret=settings.cron_secret)

    assert first == {"status": "ok", "flagged": 1}
    assert second == {"status": "ok", "flagged": 0}
