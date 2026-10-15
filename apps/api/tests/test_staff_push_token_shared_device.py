"""Mobile Settings Phases 3-4 - push registration on shared and multiple devices.

A token identifies a phone. Registering it must detach it from whoever used the phone before, sign-out
must detach it from the signed-out person without touching anyone else's registration, and one person may
hold several phones at once (push_devices).
"""
import pytest
from pydantic import ValidationError

from middleware.auth import CurrentUser
from models.requests import UpdatePushTokenRequest
from routers import staff as staff_router
from services import notify
from tests.smoke.fake_supabase import FakeDB

H1 = "hotel-1"
ALICE = CurrentUser(user_id="alice", hotel_id=H1, role="housekeeper", email="a@h.com")
BOB = CurrentUser(user_id="bob", hotel_id=H1, role="engineer", email="b@h.com")
TOKEN = "ExponentPushToken[phone-1]"
TOKEN2 = "ExponentPushToken[phone-2]"


def _row(uid, token, **extra):
    return {"tenant_id": H1, "user_id": uid, "expo_push_token": token, "revoked_at": None, **extra}


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB({
        "push_devices": [
            _row("alice", TOKEN, id="d1"),
            _row("carol", "ExponentPushToken[carol]", id="d2", tenant_id="hotel-2"),
        ],
    })
    monkeypatch.setattr(notify, "supabase", fake)
    return fake


def _active(db, uid):
    return sorted(r["expo_push_token"] for r in db.rows["push_devices"] if r["user_id"] == uid and r.get("revoked_at") is None)


def _reg(token, **kw):
    return UpdatePushTokenRequest(token=token, **kw)


@pytest.mark.asyncio
async def test_registering_a_phones_token_detaches_it_from_the_previous_employee(db):
    await staff_router.update_push_token(_reg(TOKEN), BOB)
    assert _active(db, "bob") == [TOKEN]
    assert _active(db, "alice") == []  # alice's alerts can no longer reach bob's phone
    assert _active(db, "carol") == ["ExponentPushToken[carol]"]  # unrelated registrations untouched
    old = next(r for r in db.rows["push_devices"] if r["id"] == "d1")
    assert old["revoke_reason"] == "reassigned"  # kept for diagnostics, not deleted


@pytest.mark.asyncio
async def test_registering_again_for_the_same_person_is_idempotent(db):
    await staff_router.update_push_token(_reg(TOKEN), ALICE)
    await staff_router.update_push_token(_reg(TOKEN), ALICE)
    assert _active(db, "alice") == [TOKEN]
    assert len([r for r in db.rows["push_devices"] if r["user_id"] == "alice"]) == 1


@pytest.mark.asyncio
async def test_one_person_can_hold_several_phones(db):
    await staff_router.update_push_token(_reg(TOKEN2, installation_id="tablet-install-1", platform="android"), ALICE)
    assert _active(db, "alice") == sorted([TOKEN, TOKEN2])


@pytest.mark.asyncio
async def test_a_rotated_token_replaces_the_old_one_for_the_same_install(db):
    await staff_router.update_push_token(_reg(TOKEN, installation_id="phone-install-1"), ALICE)
    await staff_router.update_push_token(_reg(TOKEN2, installation_id="phone-install-1"), ALICE)
    assert _active(db, "alice") == [TOKEN2]
    assert next(r for r in db.rows["push_devices"] if r["expo_push_token"] == TOKEN)["revoke_reason"] == "rotated"


@pytest.mark.asyncio
async def test_sign_out_revoke_clears_only_the_callers_matching_registration(db):
    await staff_router.revoke_push_token(_reg(TOKEN), ALICE)
    assert _active(db, "alice") == []
    assert _active(db, "carol") == ["ExponentPushToken[carol]"]


@pytest.mark.asyncio
async def test_revoke_cannot_clear_someone_elses_registration(db):
    await staff_router.revoke_push_token(_reg(TOKEN), BOB)
    assert _active(db, "alice") == [TOKEN]  # bob naming alice's token changes nothing


@pytest.mark.asyncio
async def test_revoke_keeps_a_newer_device_of_the_same_person(db):
    await staff_router.update_push_token(_reg(TOKEN2, installation_id="tablet-install-1"), ALICE)
    await staff_router.revoke_push_token(_reg(TOKEN), ALICE)
    assert _active(db, "alice") == [TOKEN2]


@pytest.mark.parametrize("bad", ["", "not-a-token", "https://evil.example/x", "ExponentPushToken[a b]", "ExponentPushToken[]"])
def test_only_expo_push_tokens_are_accepted(bad):
    with pytest.raises(ValidationError):
        UpdatePushTokenRequest(token=bad)


def test_legacy_clients_that_send_only_a_token_still_validate():
    assert UpdatePushTokenRequest(token=TOKEN).installation_id is None
