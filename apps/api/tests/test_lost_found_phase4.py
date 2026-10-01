"""Lost & Found Phase 4: returns (pickup/shipping), disposition eligibility, and Void Record.

Mirrors the direct-router-call + FakeDB harness used in test_lost_found_claims.py /
test_lost_found_phase2.py for logic/state assertions, and the TestClient + real-JWT
harness for RBAC-level checks.
"""

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from fastapi.testclient import TestClient
from jose import jwt
import pytest

from core.config import settings
from main import app
from middleware.auth import CurrentUser
from routers import lost_found as lost_found_router
from tests.smoke.fake_supabase import FakeDB

GM = CurrentUser(user_id="gm-1", hotel_id="hotel-a", role="gm")
SUPERVISOR = CurrentUser(user_id="sup-1", hotel_id="hotel-a", role="housekeeping_supervisor")
FRONT_DESK = CurrentUser(user_id="fd-1", hotel_id="hotel-a", role="front_desk")


def _auth_header(role: str, hotel_id: str = "hotel-a", user_id: str = "user-a-1") -> dict[str, str]:
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _item(**overrides):
    return {
        "id": "item-1", "tenant_id": "hotel-a", "status": "unclaimed",
        "description": "Black iPhone 15 Pro", "retention_due_at": None, "voided_at": None,
        **overrides,
    }


def _claim(**overrides):
    return {
        "id": "claim-1", "tenant_id": "hotel-a", "status": "matched",
        "matched_item_id": "item-1", "guest_name": "Emily Carter",
        **overrides,
    }


def _return(**overrides):
    return {
        "id": "return-1", "tenant_id": "hotel-a", "item_id": "item-1", "claim_id": "claim-1",
        "method": "pickup", "status": "awaiting_details",
        **overrides,
    }


# ---------------------------------------------------------------------------
# Prepare return
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_prepare_return_requires_confirmed_claim(monkeypatch):
    db = FakeDB({"lost_found_items": [_item()]})
    monkeypatch.setattr(lost_found_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await lost_found_router.prepare_lost_found_return(
            "item-1",
            lost_found_router.PrepareLostFoundReturnRequest(method=None),
            current_user=GM,
        )
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_prepare_return_succeeds_once_claim_confirmed(monkeypatch):
    db = FakeDB({"lost_found_items": [_item()], "lost_found_claims": [_claim()]})
    monkeypatch.setattr(lost_found_router, "supabase", db)

    response = await lost_found_router.prepare_lost_found_return(
        "item-1", lost_found_router.PrepareLostFoundReturnRequest(method="pickup"), current_user=GM,
    )

    assert response["data"]["status"] == "awaiting_details"
    assert response["data"]["claim_id"] == "claim-1"
    events = db.rows["lost_found_return_events"]
    assert events[0]["event_type"] == "started"


@pytest.mark.asyncio
async def test_prepare_return_rejects_duplicate_active_return(monkeypatch):
    db = FakeDB({
        "lost_found_items": [_item()],
        "lost_found_claims": [_claim()],
        "lost_found_returns": [_return(status="ready_for_pickup")],
    })
    monkeypatch.setattr(lost_found_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await lost_found_router.prepare_lost_found_return(
            "item-1", lost_found_router.PrepareLostFoundReturnRequest(method=None), current_user=GM,
        )
    assert exc.value.status_code == 409


# ---------------------------------------------------------------------------
# Pickup workflow
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pickup_complete_requires_ready_status(monkeypatch):
    db = FakeDB({
        "lost_found_items": [_item()],
        "lost_found_returns": [_return(status="awaiting_details")],
    })
    monkeypatch.setattr(lost_found_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await lost_found_router.complete_lost_found_pickup(
            "return-1",
            lost_found_router.CompleteLostFoundPickupRequest(
                recipient_name="Emily Carter", verification_method="Photo ID",
                verification_notes="Matched ID", verified=True,
            ),
            current_user=GM,
        )
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_pickup_complete_releases_item_closes_claim_completes_return(monkeypatch):
    db = FakeDB({
        "lost_found_items": [_item()],
        "lost_found_claims": [_claim()],
        "lost_found_returns": [_return(status="ready_for_pickup", recipient_name="Emily Carter", pickup_location="Front Desk")],
        "lost_found_custody_events": [],
    })
    monkeypatch.setattr(lost_found_router, "supabase", db)

    response = await lost_found_router.complete_lost_found_pickup(
        "return-1",
        lost_found_router.CompleteLostFoundPickupRequest(
            recipient_name="Emily Carter", verification_method="Photo ID",
            verification_notes="Matched ID; guest identified lock screen", verified=True,
        ),
        current_user=GM,
    )

    assert response["data"]["status"] == "completed"
    item = db.rows["lost_found_items"][0]
    assert item["status"] == "claimed"
    assert item["claimed_by_name"] == "Emily Carter"
    claim = db.rows["lost_found_claims"][0]
    assert claim["status"] == "closed"
    custody = db.rows["lost_found_custody_events"][0]
    assert custody["event_type"] == "released"
    assert any(event["event_type"] == "completed" for event in db.rows["lost_found_return_events"])


@pytest.mark.asyncio
async def test_pickup_complete_is_not_double_releasable(monkeypatch):
    """Two staff racing to release the same item: only the first succeeds."""
    db = FakeDB({
        "lost_found_items": [_item(status="claimed")],  # already released by the "other" request
        "lost_found_claims": [_claim(status="closed")],
        "lost_found_returns": [_return(status="ready_for_pickup")],
    })
    monkeypatch.setattr(lost_found_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await lost_found_router.complete_lost_found_pickup(
            "return-1",
            lost_found_router.CompleteLostFoundPickupRequest(
                recipient_name="Emily Carter", verification_method="Photo ID",
                verification_notes="Matched ID", verified=True,
            ),
            current_user=GM,
        )
    assert exc.value.status_code == 409
    assert "already released" in exc.value.detail


def test_pickup_complete_requires_explicit_verification_checkbox():
    with pytest.raises(Exception):
        lost_found_router.CompleteLostFoundPickupRequest(
            recipient_name="Emily Carter", verification_method="Photo ID",
            verification_notes="Matched ID", verified=False,
        )


# ---------------------------------------------------------------------------
# Shipping workflow
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ship_requires_shipping_address_first(monkeypatch):
    db = FakeDB({
        "lost_found_items": [_item()],
        "lost_found_returns": [_return(method="shipping", status="shipping_preparation")],
    })
    monkeypatch.setattr(lost_found_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await lost_found_router.mark_lost_found_shipped(
            "return-1",
            lost_found_router.MarkLostFoundShippedRequest(carrier="fedex", tracking_number="7734", shipping_cost_cents=None),
            current_user=GM,
        )
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_ship_releases_item_and_closes_claim_then_mark_complete(monkeypatch):
    db = FakeDB({
        "lost_found_items": [_item()],
        "lost_found_claims": [_claim()],
        "lost_found_returns": [_return(
            method="shipping", status="shipping_preparation",
            shipping_name="Sophia Garcia", shipping_address_line1="4120 Example Drive",
        )],
        "lost_found_custody_events": [],
    })
    monkeypatch.setattr(lost_found_router, "supabase", db)

    shipped = await lost_found_router.mark_lost_found_shipped(
        "return-1",
        lost_found_router.MarkLostFoundShippedRequest(carrier="fedex", tracking_number="7734 1234 5678", shipping_cost_cents=None),
        current_user=GM,
    )
    assert shipped["data"]["status"] == "shipped"
    item = db.rows["lost_found_items"][0]
    assert item["status"] == "claimed"
    assert db.rows["lost_found_claims"][0]["status"] == "closed"

    completed = await lost_found_router.complete_lost_found_shipment("return-1", current_user=GM)
    assert completed["data"]["status"] == "completed"


# ---------------------------------------------------------------------------
# Disposition eligibility + approval
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_disposition_queue_excludes_matched_and_active_return_items(monkeypatch):
    now = datetime.now(timezone.utc)
    overdue = (now - timedelta(days=4)).isoformat()
    db = FakeDB({
        "lost_found_items": [
            _item(id="due-plain", retention_due_at=overdue),
            _item(id="due-matched", retention_due_at=overdue),
            _item(id="due-returning", retention_due_at=overdue),
        ],
        "lost_found_claims": [_claim(id="c1", matched_item_id="due-matched", status="matched")],
        "lost_found_returns": [_return(id="r1", item_id="due-returning", status="shipping_preparation")],
    })
    monkeypatch.setattr(lost_found_router, "supabase", db)

    response = await lost_found_router.list_lost_found_disposition_queue(
        bucket="due_now", search=None, page=1, per_page=20, current_user=SUPERVISOR,
    )

    ids = [item["id"] for item in response["data"]]
    assert ids == ["due-plain"]


@pytest.mark.asyncio
async def test_approve_disposition_blocked_by_active_match(monkeypatch):
    db = FakeDB({
        "lost_found_items": [_item()],
        "lost_found_claims": [_claim()],
    })
    monkeypatch.setattr(lost_found_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await lost_found_router.approve_lost_found_disposition(
            "item-1",
            lost_found_router.ApproveLostFoundDispositionRequest(outcome="donated", reason="Retention expired"),
            current_user=SUPERVISOR,
        )
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_approve_disposition_succeeds_and_records_custody_event(monkeypatch):
    db = FakeDB({"lost_found_items": [_item()], "lost_found_custody_events": []})
    monkeypatch.setattr(lost_found_router, "supabase", db)

    response = await lost_found_router.approve_lost_found_disposition(
        "item-1",
        lost_found_router.ApproveLostFoundDispositionRequest(outcome="donated", reason="Retention period expired"),
        current_user=SUPERVISOR,
    )

    assert response["data"]["status"] == "donated"
    assert response["data"]["derived_status"] == "donated"  # D-44: response is lifecycle-attached, not a bare row
    assert response["data"]["disposed_at"] is not None
    custody = db.rows["lost_found_custody_events"][0]
    assert custody["event_type"] == "disposition"
    assert custody["disposition"] == "donated"


def test_disposition_approval_rejects_front_desk_role():
    """canApproveDisposition is supervisor/GM only — narrower than the general manager-roles set."""
    client = TestClient(app)
    response = client.post(
        "/v1/lost-found/item-1/disposition",
        headers=_auth_header("front_desk"),
        json={"outcome": "donated", "reason": "Retention expired"},
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# Void Record
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_void_succeeds_and_is_not_double_voidable(monkeypatch):
    db = FakeDB({"lost_found_items": [_item()]})
    monkeypatch.setattr(lost_found_router, "supabase", db)

    response = await lost_found_router.void_lost_found_item(
        "item-1",
        lost_found_router.VoidLostFoundRequest(reason="duplicate_record", notes="Duplicate of LF-1041"),
        current_user=SUPERVISOR,
    )
    assert response["data"]["voided_at"] is not None
    assert response["data"]["derived_status"] == "voided"  # D-44: response is lifecycle-attached, not a bare row

    with pytest.raises(HTTPException) as exc:
        await lost_found_router.void_lost_found_item(
            "item-1",
            lost_found_router.VoidLostFoundRequest(reason="duplicate_record", notes="again"),
            current_user=SUPERVISOR,
        )
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_void_blocked_by_active_match_or_return(monkeypatch):
    db = FakeDB({
        "lost_found_items": [_item()],
        "lost_found_claims": [_claim()],
    })
    monkeypatch.setattr(lost_found_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await lost_found_router.void_lost_found_item(
            "item-1",
            lost_found_router.VoidLostFoundRequest(reason="test_record", notes="n/a"),
            current_user=SUPERVISOR,
        )
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_void_blocked_once_item_reached_a_final_outcome(monkeypatch):
    """Void is for catching a mistaken record early -- not for undoing a completed
    return/donation/discard, which is a real-world event that already happened."""
    db = FakeDB({"lost_found_items": [_item(status="claimed")]})
    monkeypatch.setattr(lost_found_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await lost_found_router.void_lost_found_item(
            "item-1",
            lost_found_router.VoidLostFoundRequest(reason="duplicate_record", notes="n/a"),
            current_user=SUPERVISOR,
        )
    assert exc.value.status_code == 409


def test_void_rejects_front_desk_role():
    client = TestClient(app)
    response = client.post(
        "/v1/lost-found/item-1/void",
        headers=_auth_header("front_desk"),
        json={"reason": "duplicate_record", "notes": "n/a"},
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# _single() regression guard — supabase-py 2.31's maybe_single().execute() returns a
# bare None (not SingleAPIResponse(data=None)) when zero rows match. FakeDB cannot
# reproduce this quirk (it always returns a SimpleNamespace), so this stubs the real
# library's exact shape directly to guard against the regression found via manual
# browser verification (item intake crashed 500 on a brand-new tenant's first tag).
# ---------------------------------------------------------------------------


class _StubMaybeSingleQuery:
    """Mimics postgrest-py 2.31's SyncMaybeSingleRequestBuilder.execute() contract."""

    def __init__(self, execute_result):
        self._execute_result = execute_result

    def execute(self):
        return self._execute_result


def test_single_returns_none_when_library_returns_bare_none():
    assert lost_found_router._single(_StubMaybeSingleQuery(None)) is None


def test_single_unwraps_data_from_a_real_response():
    response = type("Response", (), {"data": {"id": "item-1"}})()
    assert lost_found_router._single(_StubMaybeSingleQuery(response)) == {"id": "item-1"}


# ---------------------------------------------------------------------------
# Centralized derived status (D-44)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_items_attaches_centralized_derived_status(monkeypatch):
    now = datetime.now(timezone.utc)
    db = FakeDB({
        "lost_found_items": [
            _item(id="held", created_at=now.isoformat()),
            _item(id="matched", created_at=now.isoformat()),
            _item(id="returning", created_at=now.isoformat()),
            _item(id="due", retention_due_at=(now - timedelta(days=1)).isoformat(), created_at=now.isoformat()),
            _item(id="returned", status="claimed", created_at=now.isoformat()),
            _item(id="voided", voided_at=now.isoformat(), created_at=now.isoformat()),
        ],
        "lost_found_claims": [_claim(id="c1", matched_item_id="matched")],
        "lost_found_returns": [_return(id="r1", item_id="returning", status="awaiting_details")],
    })
    monkeypatch.setattr(lost_found_router, "supabase", db)

    response = await lost_found_router.list_lost_found_items(
        status=None, date_from=None, date_to=None, search=None, category=None, storage=None,
        disposition_due=False, include_voided=True, page=1, per_page=20, current_user=GM,
    )

    by_id = {item["id"]: item["derived_status"] for item in response["data"]}
    assert by_id["held"] == "held"
    assert by_id["matched"] == "matched"
    assert by_id["returning"] == "return_in_progress"
    assert by_id["due"] == "due_for_disposition"
    assert by_id["returned"] == "returned"
    assert by_id["voided"] == "voided"


@pytest.mark.asyncio
async def test_list_items_excludes_voided_by_default(monkeypatch):
    db = FakeDB({
        "lost_found_items": [
            _item(id="active"),
            _item(id="voided", voided_at=datetime.now(timezone.utc).isoformat()),
        ],
    })
    monkeypatch.setattr(lost_found_router, "supabase", db)

    response = await lost_found_router.list_lost_found_items(
        status=None, date_from=None, date_to=None, search=None, category=None, storage=None,
        disposition_due=False, include_voided=False, page=1, per_page=20, current_user=GM,
    )

    ids = [item["id"] for item in response["data"]]
    assert ids == ["active"]
