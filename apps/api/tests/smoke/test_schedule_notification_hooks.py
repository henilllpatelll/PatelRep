"""Team Scheduling Phase 7: which workflow events queue a message, for whom, and with what (FakeDB)."""
import pytest

from models.coverage_requests import OfferShiftRequest, OfferResponseRequest, PostOpenShiftRequest
from models.leave_requests import CreateSwapRequest, CreateTimeOffRequest, DecideSwapRequest, DecideTimeOffRequest, RespondSwapRequest
from routers import scheduling_coverage as coverage
from routers import scheduling_leave as leave
from routers import scheduling_requests as requests_router
from routers import scheduling_swaps as swaps

from .request_support import D2, D3, DAY, HK1, HK2, S_MORN, SUP, U_HK1, U_HK2, scheduled
from .test_scheduling_coverage import open_gap


@pytest.fixture
def db(revisions_db):
    return revisions_db


def queued(db, event=None):
    return [(n["event_type"], n["user_id"]) for n in db.rows["schedule_notifications"] if event is None or n["event_type"] == event]


def blob(db) -> str:
    return " ".join(str(n["payload"]) for n in db.rows["schedule_notifications"]).lower()


REQUEST_EVENTS = {
    "schedule_time_off_requested", "schedule_time_off_approved", "schedule_time_off_denied", "schedule_swap_proposed",
    "schedule_swap_accepted", "schedule_swap_declined", "schedule_swap_needs_approval", "schedule_swap_approved",
    "schedule_swap_denied", "schedule_offer_received", "schedule_offer_withdrawn", "schedule_offer_accepted",
    "schedule_offer_declined", "schedule_claim_submitted", "schedule_claim_approved", "schedule_claim_declined",
}


def request_messages(db):
    return [n for n in db.rows["schedule_notifications"] if n["event_type"] in REQUEST_EVENTS]


@pytest.mark.asyncio
async def test_request_workflows_leave_their_messages_to_the_database_transaction(db):
    """
    Time-off, swap, offer and claim messages are written by migration 229's triggers in the SAME transaction as the
    change (proved against real Postgres in tests/integration/test_schedule_notification_triggers.py). The API must not
    queue a second, post-commit copy: that is the crash window the triggers close. The fake database has no triggers,
    so after walking every one of those flows the outbox must hold nothing from the API.
    """
    made = (await leave.create_time_off(CreateTimeOffRequest(start_date=DAY, end_date=DAY, reason_category="health", note="chemotherapy"), HK1))["data"]
    await leave.deny_time_off(made["id"], DecideTimeOffRequest(expected_version=1, reason="coverage is too thin that week"), SUP)
    gap_id, _ = await open_gap(db, user=U_HK1)
    sent = await coverage.create_offer(gap_id, OfferShiftRequest(user_id=U_HK2, expected_version=1), SUP)
    assert sent["meta"]["delivered"] is False                                # an offer row is not a delivery
    await coverage.withdraw_offer(gap_id, sent["meta"]["offer_id"], SUP)
    a, b = await scheduled(user=U_HK1, day=D2), await scheduled(user=U_HK2, day=D3)
    swap = (await swaps.propose_swap(CreateSwapRequest(requester_assignment_id=a, counterpart_assignment_id=b), HK1))["data"]
    await swaps.respond_to_swap(swap["id"], RespondSwapRequest(accept=True, expected_version=1), HK2)
    await swaps.approve_swap(swap["id"], DecideSwapRequest(expected_version=2), SUP)
    assert request_messages(db) == []


@pytest.mark.asyncio
async def test_a_withdrawn_offer_still_reopens_the_gap_without_any_api_message(db):
    gap_id, _ = await open_gap(db, user=U_HK1)
    offer_id = (await coverage.create_offer(gap_id, OfferShiftRequest(user_id=U_HK2, expected_version=1), SUP))["meta"]["offer_id"]
    await coverage.withdraw_offer(gap_id, offer_id, SUP)
    assert next(o for o in db.rows["coverage_offers"] if o["id"] == offer_id)["status"] == "withdrawn"
    assert request_messages(db) == []


@pytest.mark.asyncio
async def test_a_claimable_open_shift_is_announced_only_to_people_who_can_take_it(db):
    busy = await scheduled(user=U_HK1, shift_id=S_MORN, day=DAY)             # already holds the morning shift on that day
    assert busy
    await coverage.post_open_shift(PostOpenShiftRequest(shift_id=S_MORN, work_date=DAY.isoformat(), claimable=True), SUP)
    recipients = {u for _, u in queued(db, "schedule_open_shift")}
    assert U_HK2 in recipients and U_HK1 not in recipients                  # the person already working it is not told
    before = len(queued(db))
    await coverage.post_open_shift(PostOpenShiftRequest(shift_id=S_MORN, work_date=D2.isoformat(), claimable=False), SUP)
    assert len(queued(db)) == before                                         # a non-claimable posting announces nothing


@pytest.mark.asyncio
async def test_the_offer_row_records_in_app_delivery_only_after_the_inbox_message_exists(db, monkeypatch):
    from services import schedule_outbox

    async def accepted(**kw):
        return {"sent": 1, "opted_out": [], "no_device": [], "failed": 0}

    monkeypatch.setattr(schedule_outbox.notify, "send_push", accepted)
    gap_id, _ = await open_gap(db, user=U_HK1)
    offer_id = (await coverage.create_offer(gap_id, OfferShiftRequest(user_id=U_HK2, expected_version=1), SUP))["meta"]["offer_id"]
    offer = next(o for o in db.rows["coverage_offers"] if o["id"] == offer_id)
    assert offer["delivery"] == "not_sent"
    schedule_outbox.enqueue(HK2.hotel_id, [U_HK2], "schedule_offer_received", offer_id, {"offer_id": offer_id, "gap_id": gap_id})  # what migration 229's trigger writes
    await schedule_outbox.process_batch(50)
    assert offer["delivery"] == "sent" and db.rows["notifications"][0]["data"]["offer_id"] == offer_id


@pytest.mark.asyncio
async def test_an_employee_sees_how_their_offers_and_claims_ended_and_nothing_about_anyone_else(db):
    gap_id, call_out = await open_gap(db, user=U_HK1)
    offer_id = (await coverage.create_offer(gap_id, OfferShiftRequest(user_id=U_HK2, expected_version=1), SUP))["meta"]["offer_id"]
    live = (await requests_router.my_offers(HK2, history=True))["data"]
    assert [(o["id"], o["status"]) for o in live] == [(offer_id, "pending")]
    assert set(live[0]["shift"]) == {"id", "shift_name", "work_date", "start_time", "end_time", "starts_at", "ends_at", "required_role", "status", "version"}
    await requests_router.respond_to_offer(offer_id, OfferResponseRequest(accept=False, note="can't"), HK2)
    after = (await requests_router.my_offers(HK2, history=True))["data"]
    assert [(o["id"], o["status"]) for o in after] == [(offer_id, "declined")]       # how it ended, still visible
    assert (await requests_router.my_offers(HK2))["data"] == []                       # the live list is unchanged
    assert (await requests_router.my_offers(HK1, history=True))["data"] == []         # another employee sees none of it
    assert "absent" not in str(after).lower() and call_out is not None


@pytest.mark.asyncio
async def test_my_claims_lists_only_the_callers_own_requests_without_the_supervisors_note(db):
    posted = (await coverage.post_open_shift(PostOpenShiftRequest(shift_id=S_MORN, work_date=DAY.isoformat(), claimable=True), SUP))["data"]
    claim = await requests_router.claim_open_shift(posted["id"], HK2)
    mine = (await requests_router.my_claims(HK2))["data"]
    assert [(c["id"], c["status"]) for c in mine] == [(claim["data"]["claim_id"], "pending")]
    assert (await requests_router.my_claims(HK1))["data"] == []
    from models.coverage_requests import ClaimDecisionRequest
    await requests_router.decline_claim(claim["data"]["claim_id"], ClaimDecisionRequest(expected_version=1, reason="staffing is full"), SUP)
    decided = (await requests_router.my_claims(HK2))["data"]
    assert decided[0]["status"] == "declined" and "staffing" not in str(decided)
