"""Supervisor Today Phase 4 - team broadcasts and direct messages stay inside the caller's hotel.

Both endpoints only add inbox rows. They must never reach another property, an inactive account, a role the
caller may not message, or the sender, and a broadcast must report exactly how many inboxes it wrote.
"""
import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from routers import notifications as notifications_router
from tests.smoke.fake_supabase import FakeDB

H1, H2 = "hotel-1", "hotel-2"
SUP = CurrentUser(user_id="sup-1", hotel_id=H1, role="housekeeping_supervisor", email="s@h.com")
GM = CurrentUser(user_id="gm-1", hotel_id=H1, role="gm", email="g@h.com")


def _role(user_id, role, tenant=H1, active=True):
    return {"user_id": user_id, "tenant_id": tenant, "role": role, "is_active": active}


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB(
        {
            "user_roles": [
                _role("sup-1", "housekeeping_supervisor"),
                _role("hk-1", "housekeeper"),
                _role("hk-2", "housekeeper"),
                _role("hk-off", "housekeeper", active=False),
                _role("hk-other", "housekeeper", tenant=H2),
                _role("eng-1", "engineer"),
                _role("sup-2", "housekeeping_supervisor"),
                _role("gm-1", "gm"),
            ],
            "notifications": [],
        }
    )
    monkeypatch.setattr(notifications_router, "supabase", fake)
    return fake


def _inbox(db):
    return sorted((row["user_id"], row["type"], row["tenant_id"]) for row in db.rows["notifications"])


@pytest.mark.asyncio
async def test_a_housekeeper_broadcast_reaches_only_active_housekeepers_in_this_hotel(db):
    result = await notifications_router.broadcast_message(
        body={"message": "  Check your assignments  ", "roles": ["housekeeper"]}, current_user=SUP
    )
    assert result == {"data": {"sent": 2}}
    assert _inbox(db) == [("hk-1", "broadcast", H1), ("hk-2", "broadcast", H1)]
    assert {row["body"] for row in db.rows["notifications"]} == {"Check your assignments"}


@pytest.mark.asyncio
async def test_a_broadcast_never_creates_a_task_and_never_messages_the_sender(db):
    await notifications_router.broadcast_message(body={"message": "Hi"}, current_user=SUP)
    assert "tasks" not in db.rows
    assert "sup-1" not in {row["user_id"] for row in db.rows["notifications"]}
    # The default audience is housekeepers plus the other housekeeping supervisor.
    assert [row["user_id"] for row in db.rows["notifications"] if row["user_id"].startswith("sup")] == ["sup-2"]


@pytest.mark.asyncio
async def test_a_broadcast_with_nobody_to_reach_reports_zero_and_writes_nothing(db):
    db.rows["user_roles"] = [_role("sup-1", "housekeeping_supervisor")]
    result = await notifications_router.broadcast_message(body={"message": "Hi", "roles": ["housekeeper"]}, current_user=SUP)
    assert result == {"data": {"sent": 0}}
    assert db.rows["notifications"] == []


@pytest.mark.asyncio
async def test_a_broadcast_counts_a_person_with_two_matching_role_rows_once(db):
    db.rows["user_roles"].append(_role("hk-1", "housekeeping_supervisor"))
    result = await notifications_router.broadcast_message(body={"message": "Hi"}, current_user=SUP)
    assert [row["user_id"] for row in db.rows["notifications"]].count("hk-1") == 1
    assert result["data"]["sent"] == len(db.rows["notifications"])


@pytest.mark.asyncio
@pytest.mark.parametrize("roles", [["engineer"], ["gm"], ["housekeeper", "engineer"]])
async def test_a_supervisor_cannot_broadcast_to_non_housekeeping_roles(db, roles):
    with pytest.raises(HTTPException) as err:
        await notifications_router.broadcast_message(body={"message": "Hi", "roles": roles}, current_user=SUP)
    assert err.value.status_code == 403
    assert db.rows["notifications"] == []


@pytest.mark.asyncio
async def test_a_gm_may_broadcast_to_engineers(db):
    result = await notifications_router.broadcast_message(body={"message": "Hi", "roles": ["engineer"]}, current_user=GM)
    assert result == {"data": {"sent": 1}}


@pytest.mark.asyncio
@pytest.mark.parametrize("roles", [[], "housekeeper", [1], ["not_a_role"]])
async def test_a_broadcast_rejects_malformed_roles(db, roles):
    with pytest.raises(HTTPException) as err:
        await notifications_router.broadcast_message(body={"message": "Hi", "roles": roles}, current_user=SUP)
    assert err.value.status_code in (403, 422)
    assert db.rows["notifications"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("message", [None, "", "   ", 5, "x" * 1001])
async def test_a_broadcast_rejects_empty_or_oversized_messages(db, message):
    with pytest.raises(HTTPException) as err:
        await notifications_router.broadcast_message(body={"message": message}, current_user=SUP)
    assert err.value.status_code == 422
    assert db.rows["notifications"] == []


@pytest.mark.asyncio
async def test_a_direct_message_is_stored_for_the_chosen_housekeeper_only(db):
    result = await notifications_router.send_direct_message(
        body={"recipient_id": "hk-1", "message": " Skip 207 "}, current_user=SUP
    )
    assert result == {"data": {"success": True}}
    assert _inbox(db) == [("hk-1", "direct_message", H1)]
    assert db.rows["notifications"][0]["body"] == "Skip 207"


@pytest.mark.asyncio
@pytest.mark.parametrize("recipient", ["hk-other", "hk-off", "nobody", "eng-1", "gm-1"])
async def test_a_supervisor_cannot_message_another_hotel_an_inactive_account_or_a_non_housekeeping_role(db, recipient):
    with pytest.raises(HTTPException) as err:
        await notifications_router.send_direct_message(body={"recipient_id": recipient, "message": "Hi"}, current_user=SUP)
    assert err.value.status_code == 404
    assert db.rows["notifications"] == []


@pytest.mark.asyncio
async def test_a_gm_can_message_any_active_person_in_their_own_hotel_but_not_another_hotel(db):
    await notifications_router.send_direct_message(body={"recipient_id": "eng-1", "message": "Hi"}, current_user=GM)
    assert _inbox(db) == [("eng-1", "direct_message", H1)]
    with pytest.raises(HTTPException) as err:
        await notifications_router.send_direct_message(body={"recipient_id": "hk-other", "message": "Hi"}, current_user=GM)
    assert err.value.status_code == 404


@pytest.mark.asyncio
async def test_you_cannot_message_yourself(db):
    with pytest.raises(HTTPException) as err:
        await notifications_router.send_direct_message(body={"recipient_id": "sup-1", "message": "Hi"}, current_user=SUP)
    assert err.value.status_code == 422
    assert db.rows["notifications"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        {"message": "Hi"},
        {"recipient_id": "", "message": "Hi"},
        {"recipient_id": 7, "message": "Hi"},
        {"recipient_id": "hk-1"},
        {"recipient_id": "hk-1", "message": "   "},
        {"recipient_id": "hk-1", "message": "x" * 1001},
    ],
)
async def test_a_direct_message_needs_a_recipient_and_a_reasonable_message(db, body):
    with pytest.raises(HTTPException) as err:
        await notifications_router.send_direct_message(body=body, current_user=SUP)
    assert err.value.status_code == 422
    assert db.rows["notifications"] == []


@pytest.mark.asyncio
async def test_a_person_holding_two_role_rows_is_still_a_valid_recipient(db):
    db.rows["user_roles"].append(_role("hk-1", "front_desk"))
    result = await notifications_router.send_direct_message(body={"recipient_id": "hk-1", "message": "Hi"}, current_user=SUP)
    assert result == {"data": {"success": True}}
