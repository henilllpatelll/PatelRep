"""Mobile Settings Phase 3 — push tokens on shared devices.

A token identifies a phone. Registering it must detach it from whoever used the phone before, and
sign-out must detach it from the signed-out person without touching anyone else's token.
"""
import pytest

from middleware.auth import CurrentUser
from models.requests import UpdatePushTokenRequest
from routers import staff as staff_router
from tests.smoke.fake_supabase import FakeDB

H1 = "hotel-1"
ALICE = CurrentUser(user_id="alice", hotel_id=H1, role="housekeeper", email="a@h.com")
BOB = CurrentUser(user_id="bob", hotel_id=H1, role="engineer", email="b@h.com")
TOKEN = "ExponentPushToken[phone-1]"


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB({
        "user_profiles": [
            {"id": "alice", "tenant_id": H1, "full_name": "Alice", "expo_push_token": TOKEN},
            {"id": "bob", "tenant_id": H1, "full_name": "Bob", "expo_push_token": None},
            {"id": "carol", "tenant_id": "hotel-2", "full_name": "Carol", "expo_push_token": "ExponentPushToken[carol]"},
        ],
    })
    monkeypatch.setattr(staff_router, "supabase", fake)
    return fake


def _token(db, uid):
    return next(r for r in db.rows["user_profiles"] if r["id"] == uid)["expo_push_token"]


@pytest.mark.asyncio
async def test_registering_a_phones_token_detaches_it_from_the_previous_employee(db):
    await staff_router.update_push_token(UpdatePushTokenRequest(token=TOKEN), BOB)
    assert _token(db, "bob") == TOKEN
    assert _token(db, "alice") is None  # alice's alerts can no longer reach bob's phone
    assert _token(db, "carol") == "ExponentPushToken[carol]"  # unrelated tokens untouched


@pytest.mark.asyncio
async def test_registering_again_for_the_same_person_is_idempotent(db):
    await staff_router.update_push_token(UpdatePushTokenRequest(token=TOKEN), ALICE)
    assert _token(db, "alice") == TOKEN


@pytest.mark.asyncio
async def test_sign_out_revoke_clears_only_the_callers_matching_token(db):
    await staff_router.revoke_push_token(UpdatePushTokenRequest(token=TOKEN), ALICE)
    assert _token(db, "alice") is None
    assert _token(db, "carol") == "ExponentPushToken[carol]"


@pytest.mark.asyncio
async def test_revoke_cannot_clear_someone_elses_token(db):
    await staff_router.revoke_push_token(UpdatePushTokenRequest(token=TOKEN), BOB)
    assert _token(db, "alice") == TOKEN  # bob naming alice's token changes nothing


@pytest.mark.asyncio
async def test_revoke_keeps_a_newer_device_token(db):
    db.rows["user_profiles"][0]["expo_push_token"] = "ExponentPushToken[phone-2]"
    await staff_router.revoke_push_token(UpdatePushTokenRequest(token=TOKEN), ALICE)
    assert _token(db, "alice") == "ExponentPushToken[phone-2]"
