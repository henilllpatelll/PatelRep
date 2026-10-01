"""Lost & Found Phase 3 guest-claim and explainable-match contracts."""

from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import lost_found as lost_found_router
from routers.lost_found import rank_lost_found_matches
from tests.smoke.fake_supabase import FakeDB


def _found_item(**overrides):
    return {
        "id": "22222222-2222-4222-8222-222222222222",
        "tenant_id": "hotel-a",
        "status": "unclaimed",
        "description": "Black Apple iPhone 15 Pro",
        "category": "electronics",
        "room_id": "room-214",
        "found_at": "2026-09-29T10:42:00+00:00",
        "distinguishing_details": "Crack near rear camera and clear case",
        **overrides,
    }


def _claim(**overrides):
    return {
        "id": "claim-1",
        "tenant_id": "hotel-a",
        "status": "open",
        "description": "black iphone 15 pro",
        "category": "electronics",
        "room_id": "room-214",
        "last_seen_at": "2026-09-29T08:00:00+00:00",
        "distinguishing_details": "clear case, cracked camera area",
        **overrides,
    }


def test_ranked_matches_prefer_same_room_date_category_and_description():
    ranked = rank_lost_found_matches(
        _claim(),
        [
            _found_item(),
            _found_item(
                id="item-2",
                room_id="room-999",
                found_at="2026-08-03T10:42:00+00:00",
                description="Black iPhone 15 Pro",
            ),
        ],
    )

    assert ranked[0]["item"]["id"] == "22222222-2222-4222-8222-222222222222"
    assert ranked[0]["score"] >= 80
    assert ranked[0]["score"] > ranked[1]["score"]
    assert any(signal["key"] == "room" for signal in ranked[0]["signals"])
    assert any(signal["key"] == "date" for signal in ranked[0]["signals"])


def test_ranked_matches_penalize_category_mismatch_and_ignore_terminal_items():
    ranked = rank_lost_found_matches(
        _claim(),
        [
            _found_item(id="terminal", status="claimed"),
            _found_item(id="different-category", category="jewelry"),
        ],
    )

    assert [candidate["item"]["id"] for candidate in ranked] == ["different-category"]
    assert ranked[0]["score"] < 40


def _auth_header(role: str, hotel_id: str = "hotel-a", user_id: str = "staff-1") -> dict[str, str]:
    token = jwt.encode(
        {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"},
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


def test_claim_creation_is_role_gated_and_persists_a_tenant_scoped_record(monkeypatch):
    db = FakeDB({"rooms": [{"id": "11111111-1111-4111-8111-111111111111", "tenant_id": "hotel-a", "room_number": "214"}]})
    monkeypatch.setattr(lost_found_router, "supabase", db)
    client = TestClient(app)
    payload = {
        "guest_name": "Emily Carter",
        "guest_phone": "555-0104",
        "room_id": "11111111-1111-4111-8111-111111111111",
        "description": "Black iPhone 15 Pro",
        "category": "electronics",
        "last_seen_at": "2026-09-29T08:00:00Z",
    }

    forbidden = client.post("/v1/lost-found/claims", headers=_auth_header("engineer"), json=payload)
    created = client.post("/v1/lost-found/claims", headers=_auth_header("front_desk"), json=payload)

    assert forbidden.status_code == 403
    assert created.status_code == 200
    claim = created.json()["data"]
    assert claim["tenant_id"] == "hotel-a"
    assert claim["status"] == "open"
    assert claim["claim_code"].startswith("CL-")
    assert db.rows["lost_found_claim_events"][0]["event_type"] == "created"


def test_confirm_match_requires_notes_and_prevents_duplicate_item_assignment(monkeypatch):
    db = FakeDB({
        "lost_found_items": [_found_item()],
        "lost_found_claims": [_claim(), _claim(id="claim-2", guest_name="Jordan Lee")],
        "lost_found_claim_events": [],
        "lost_found_match_rejections": [],
    })
    monkeypatch.setattr(lost_found_router, "supabase", db)
    client = TestClient(app)

    item_id = "22222222-2222-4222-8222-222222222222"
    missing_notes = client.post("/v1/lost-found/claims/claim-1/match", headers=_auth_header("gm"), json={"item_id": item_id})
    confirmed = client.post("/v1/lost-found/claims/claim-1/match", headers=_auth_header("gm"), json={"item_id": item_id, "verification_notes": "Guest named the lock-screen image and rear-camera crack."})
    conflict = client.post("/v1/lost-found/claims/claim-2/match", headers=_auth_header("gm"), json={"item_id": item_id, "verification_notes": "Another detail."})

    assert missing_notes.status_code == 422
    assert confirmed.status_code == 200
    assert confirmed.json()["data"]["status"] == "matched"
    assert db.rows["lost_found_items"][0]["status"] == "unclaimed"
    assert conflict.status_code == 409
