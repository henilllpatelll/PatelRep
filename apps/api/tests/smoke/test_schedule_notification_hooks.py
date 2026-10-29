"""Team Scheduling Phase 7: which workflow events queue a message, for whom, and with what (FakeDB)."""
import pytest

from models.coverage_requests import OfferShiftRequest, OfferResponseRequest, PostOpenShiftRequest
from models.leave_requests import CreateSwapRequest, CreateTimeOffRequest, DecideSwapRequest, DecideTimeOffRequest, RespondSwapRequest
from routers import scheduling_coverage as coverage
from routers import scheduling_leave as leave
from routers import scheduling_requests as requests_router
from routers import scheduling_swaps as swaps

from .request_support import D2, DAY, HK1, HK2, S_MORN, SUP, U_HK1, U_HK2, U_SUP, scheduled
from .test_scheduling_coverage import open_gap


@pytest.fixture
def db(revisions_db):
    return revisions_db


def queued(db, event=None):
    return [(n["event_type"], n["user_id"]) for n in db.rows["schedule_notifications"] if event is None or n["event_type"] == event]


def blob(db) -> str:
    return " ".join(str(n["payload"]) for n in db.rows["schedule_notifications"]).lower()


@pytest.mark.asyncio
async def test_a_time_off_request_tells_managers_it_exists_but_never_why(db):
    made = (await leave.create_time_off(CreateTimeOffRequest(start_date=DAY, end_date=DAY, reason_category="health", note="chemotherapy"), HK1))["data"]
    recipients = {user for _, user in queued(db, "schedule_time_off_requested")}
    assert U_SUP in recipients and U_HK1 not in recipients
    assert "chemotherapy" not in blob(db) and "health" not in blob(db)
    await leave.deny_time_off(made["id"], DecideTimeOffRequest(expected_version=1, reason="coverage is too thin that week"), SUP)
    assert queued(db, "schedule_time_off_denied") == [("schedule_time_off_denied", U_HK1)]
    assert "thin" not in blob(db)                                           # the decision reason stays with the request


@pytest.mark.asyncio
async def test_approval_notifies_the_requester_only(db):
    made = (await leave.create_time_off(CreateTimeOffRequest(start_date=DAY, end_date=DAY, reason_category="personal"), HK1))["data"]
    await leave.approve_time_off(made["id"], DecideTimeOffRequest(expected_version=1), SUP)
    assert queued(db, "schedule_time_off_approved") == [("schedule_time_off_approved", U_HK1)]


@pytest.mark.asyncio
async def test_a_swap_notifies_each_party_at_the_moment_it_matters(db):
    a, b = await scheduled(user=U_HK1, day=DAY), await scheduled(user=U_HK2, day=D2)
    swap = (await swaps.propose_swap(CreateSwapRequest(requester_assignment_id=a, counterpart_assignment_id=b), HK1))["data"]
    assert queued(db, "schedule_swap_proposed") == [("schedule_swap_proposed", U_HK2)]
    await swaps.respond_to_swap(swap["id"], RespondSwapRequest(accept=True, expected_version=1), HK2)
    assert queued(db, "schedule_swap_accepted") == [("schedule_swap_accepted", U_HK1)]
    assert U_SUP in {u for _, u in queued(db, "schedule_swap_needs_approval")}
    await swaps.approve_swap(swap["id"], DecideSwapRequest(expected_version=2), SUP)
    assert {u for _, u in queued(db, "schedule_swap_approved")} == {U_HK1, U_HK2}
    # a retried request cannot message twice
    from services import schedule_outbox
    assert schedule_outbox.enqueue(HK1.hotel_id, [U_HK2], "schedule_swap_proposed", swap["id"]) >= 0
    assert len(queued(db, "schedule_swap_proposed")) == 1


@pytest.mark.asyncio
async def test_an_offer_reaches_the_offered_employee_and_the_response_reaches_the_supervisor(db):
    gap_id, _ = await open_gap(db, user=U_HK1)
    sent = await coverage.create_offer(gap_id, OfferShiftRequest(user_id=U_HK2, expected_version=1), SUP)
    offer_id = sent["meta"]["offer_id"]
    assert queued(db, "schedule_offer_received") == [("schedule_offer_received", U_HK2)]
    assert sent["meta"]["delivered"] is False                                # queued is not delivered
    await requests_router.respond_to_offer(offer_id, OfferResponseRequest(accept=True), HK2)
    assert queued(db, "schedule_offer_accepted") == [("schedule_offer_accepted", U_SUP)]


@pytest.mark.asyncio
async def test_a_withdrawn_offer_tells_the_employee(db):
    gap_id, _ = await open_gap(db, user=U_HK1)
    offer_id = (await coverage.create_offer(gap_id, OfferShiftRequest(user_id=U_HK2, expected_version=1), SUP))["meta"]["offer_id"]
    await coverage.withdraw_offer(gap_id, offer_id, SUP)
    assert queued(db, "schedule_offer_withdrawn") == [("schedule_offer_withdrawn", U_HK2)]


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
    assert queued(db, "schedule_claim_declined") == [("schedule_claim_declined", U_HK2)]
