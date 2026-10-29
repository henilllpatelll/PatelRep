"""Team Scheduling Phase 4: call-outs, coverage gaps, offers, open shifts and claims (FakeDB; handlers called directly)."""
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from core.errors import CodedHTTPException
from middleware.auth import CurrentUser
from models.coverage_requests import (
    AssignGapRequest, ClaimDecisionRequest, OfferResponseRequest, OfferShiftRequest, PostOpenShiftRequest,
    RecordAbsenceRequest, WaiveGapRequest, WithdrawAbsenceRequest,
)
from routers import scheduling as sched
from routers import scheduling_absences as absences
from routers import scheduling_coverage as coverage
from routers import scheduling_requests as requests_router
from routers import scheduling_team as team
from routers import shifts as shifts_router
from services import coverage_fill, coverage_store, scheduling_access as access
from services.scheduling_coverage import actor_kind, offer_expiry, transition_error

from .coverage_fakes import CoverageDB
from .test_scheduling_foundation import (
    CHIEF, D_HK, DAY, ENGINEER, GM, HK, HOTEL, OTHER, S_EVE, S_MORN, S_NIGHT, SUP, U_ENG, U_HK1, U_HK2, U_INACTIVE, U_OTHER,
    U_SUP, refused, role, seed, stored_id,
)

U_HK3 = "a0000009-0000-4000-8000-000000000009"
HK2 = CurrentUser(user_id=U_HK2, hotel_id=HOTEL, role="housekeeper", email="h2@x.test")
HK3 = CurrentUser(user_id=U_HK3, hotel_id=HOTEL, role="housekeeper", email="h3@x.test")
OTHER_SUP = CurrentUser(user_id="a00000aa-0000-4000-8000-0000000000aa", hotel_id=OTHER, role="gm", email="o@x.test")
ROUTES = [route for module in (absences, coverage, requests_router) for route in module.router.routes]
MODULES = (sched, team, access, shifts_router, absences, coverage, requests_router, coverage_store, coverage_fill)


def seed_coverage():
    rows = seed()
    rows["user_roles"].append(role(U_HK3, "housekeeper", D_HK))
    rows["user_profiles"].append({"id": U_HK3, "full_name": "Cy Diaz"})
    for table in ("absence_records", "coverage_gaps", "coverage_offers", "coverage_claims", "room_assignments", "room_status"):
        rows[table] = []
    return rows


@pytest.fixture
def db(monkeypatch):
    database = CoverageDB(seed_coverage(), unique_indexes=[("coverage_offers", "uq_offer_pending", ("gap_id", "user_id"), {"status": "pending"}),
                                                              ("coverage_claims", "uq_claim_pending", ("gap_id", "user_id"), {"status": "pending"})])
    for module in MODULES:
        monkeypatch.setattr(module, "supabase", database)
    monkeypatch.setattr(coverage_fill, "load_roster", lambda *a, **k: [])
    return database


async def scheduled(user=U_HK1, shift_id=S_MORN, day=DAY, **extra):
    return await stored_id(user=user, shift_id=shift_id, day=day, **extra)


async def call_out(assignment, actor=SUP, kind="called_out", version=1, **extra):
    return await absences.record_absence(RecordAbsenceRequest(assignment_id=assignment, expected_version=version, kind=kind, **extra), actor)


async def open_gap(db, user=U_HK1, shift_id=S_MORN):
    result = await call_out(await scheduled(user=user, shift_id=shift_id))
    return result["data"]["gap"]["id"], result


async def candidates(gap_id, actor=SUP, q=None, filter="all", role=None):
    return await coverage.find_candidates(gap_id, q=q, filter=filter, role=role, current_user=actor)


def by_user(result):
    return {c["user_id"]: c for c in result["data"]}


def gap_row(db, gap_id):
    return next(g for g in db.rows["coverage_gaps"] if g["id"] == gap_id)


# --- recording a call-out -------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_confirmed_call_out_opens_one_gap_and_leaves_the_original_shift_alone(db):
    assignment = await scheduled()
    before = dict(db.rows["shift_assignments"][0])
    data = (await call_out(assignment, note="Phoned in at 5am"))["data"]
    absence, gap = data["absence"], data["gap"]
    assert absence["status"] == "confirmed" and absence["user_id"] == U_HK1 and absence["note"] == "Phoned in at 5am"
    assert gap["status"] == "open" and gap["source"] == "absence" and gap["required_role"] == "housekeeper"
    assert (gap["start_time"], gap["end_time"], gap["starts_at"]) == ("07:00:00", "15:00:00", before["starts_at"])
    assert db.rows["shift_assignments"][0] == before            # the plan's history is untouched
    assert db.rows["hk_shift_sessions"] == [] and db.rows["room_assignments"] == []
    actions = [(e["resource_type"], e["action"]) for e in db.rows["operational_audit_events"]]
    assert ("absence", "reported") in actions and ("absence", "confirmed") in actions and ("coverage_gap", "opened") in actions


@pytest.mark.asyncio
async def test_a_second_call_out_for_the_same_shift_is_a_duplicate_and_a_retry_with_a_key_is_replayed(db):
    assignment = await scheduled()
    first = await call_out(assignment, idempotency_key="retry-key-1")
    again = await call_out(assignment, idempotency_key="retry-key-1")
    assert again["data"]["replayed"] and again["data"]["absence"]["id"] == first["data"]["absence"]["id"]
    with pytest.raises(CodedHTTPException) as exc:
        await call_out(assignment)
    assert refused(exc) == "duplicate_absence"
    assert len(db.rows["absence_records"]) == 1 and len(db.rows["coverage_gaps"]) == 1


@pytest.mark.asyncio
async def test_call_outs_are_scoped_to_the_hotel_department_and_current_version(db):
    assignment = await scheduled()
    with pytest.raises(CodedHTTPException) as exc:
        await call_out(assignment, actor=OTHER_SUP)
    assert refused(exc) == "assignment_not_found"
    with pytest.raises(CodedHTTPException) as exc:
        await call_out(assignment, actor=ENGINEER)
    assert refused(exc) == "department_forbidden"
    await sched.update_shift_assignment(assignment, sched_update(version=1, notes="moved"), SUP)
    with pytest.raises(CodedHTTPException) as exc:
        await call_out(assignment, version=1)
    assert refused(exc) == "version_conflict" and exc.value.extra["current"]["version"] == 2
    assert db.rows["absence_records"] == []


async def assert_gated(denied: CurrentUser, allowed: CurrentUser, paths) -> None:
    """Every route on `paths` carries a role gate that refuses `denied` (403) and admits `allowed`.
    The gate is invoked directly (not through TestClient) so the suite-wide HTTP rate limiter is not consumed."""
    from fastapi import HTTPException
    from middleware.auth import get_current_user

    routes = [r for r in ROUTES if r.path in paths]
    assert {r.path for r in routes} == set(paths)
    for route in routes:
        gates = [d.call for d in route.dependant.dependencies if d.call is not get_current_user]
        assert gates, f"{route.path} has no role gate"
        for gate in gates:
            assert (await gate(allowed)).user_id == allowed.user_id
            with pytest.raises(HTTPException) as exc:
                await gate(denied)
            assert exc.value.status_code == 403


def sched_update(**kw):
    from models.requests import UpdateShiftAssignmentRequest
    return UpdateShiftAssignmentRequest(expected_version=kw.pop("version"), **kw)


@pytest.mark.asyncio
async def test_a_shift_that_ended_was_cancelled_or_belongs_to_an_inactive_person_cannot_be_called_out(db):
    past = await scheduled(day=(datetime.now(timezone.utc) - timedelta(days=3)).date())
    with pytest.raises(CodedHTTPException) as exc:
        await call_out(past)
    assert refused(exc) in ("shift_ended", "historical_assignment_locked")
    cancelled = await scheduled(day=DAY + timedelta(days=1))
    next(r for r in db.rows["shift_assignments"] if r["id"] == cancelled)["publication_state"] = "cancelled"
    with pytest.raises(CodedHTTPException) as exc:
        await call_out(cancelled)
    assert refused(exc) == "shift_cancelled"
    other = await scheduled(user=U_HK2, day=DAY + timedelta(days=2))
    next(r for r in db.rows["user_roles"] if r["user_id"] == U_HK2)["is_active"] = False
    with pytest.raises(CodedHTTPException) as exc:
        await call_out(other)
    assert refused(exc) == "employee_inactive"


@pytest.mark.asyncio
async def test_leaving_early_needs_a_time_inside_the_shift_and_only_the_remainder_needs_cover(db):
    assignment = await scheduled()
    with pytest.raises(CodedHTTPException) as exc:
        await call_out(assignment, kind="leaving_early")
    assert refused(exc) == "leaving_at_required"
    with pytest.raises(CodedHTTPException) as exc:
        await call_out(assignment, kind="leaving_early", leaving_at=datetime(2030, 1, 8, 12, 0, tzinfo=timezone.utc))
    assert refused(exc) == "leaving_outside_shift"          # 12:00 UTC = 06:00 local, before the 07:00 start
    data = (await call_out(assignment, kind="leaving_early", leaving_at=datetime(2030, 1, 8, 18, 0, tzinfo=timezone.utc)))["data"]
    gap = data["gap"]
    assert gap["start_time"] == "12:00:00" and gap["end_time"] == "15:00:00" and gap["starts_at"].startswith("2030-01-08T18:00")


@pytest.mark.asyncio
async def test_a_missing_clock_in_never_creates_an_absence(db):
    await scheduled()
    result = await team.get_team_schedule(date_from=DAY, date_to=None, department_id=None, role=None, user_id=None,
                                          include_attendance=True, page=1, per_page=50, current_user=SUP)
    assert result["data"]["assignments"][0]["workforce_status"] in ("not_clocked_in", "unknown")
    assert db.rows["absence_records"] == [] and db.rows["coverage_gaps"] == []


@pytest.mark.asyncio
async def test_the_note_never_reaches_an_employee_and_housekeepers_cannot_call_the_manager_routes(db):
    assignment = await scheduled()
    await call_out(assignment, note="private detail")
    await assert_gated(HK, SUP, ("/schedules/absences", "/schedules/gaps", "/schedules/gaps/{gap_id}/candidates", "/schedules/open-shifts"))
    gap_id = db.rows["coverage_gaps"][0]["id"]
    await coverage.create_offer(gap_id, OfferShiftRequest(user_id=U_HK2, expected_version=1), SUP)
    mine = (await requests_router.my_offers(HK2))["data"]
    assert len(mine) == 1 and "private detail" not in str(mine) and "absence" not in str(mine) and U_HK1 not in str(mine)


@pytest.mark.asyncio
async def test_employee_routes_admit_staff_and_manager_routes_admit_only_managers(db):
    await assert_gated(CHIEF, SUP, ("/schedules/claims/{claim_id}/approve", "/schedules/claims/{claim_id}/decline",
                                    "/schedules/gaps/{gap_id}/assign", "/schedules/gaps/{gap_id}/waive", "/schedules/gaps/{gap_id}/history"))
    for route in ROUTES:
        if route.path in ("/schedules/me/offers", "/schedules/me/open-shifts", "/schedules/offers/{offer_id}/respond"):
            assert [d for d in route.dependant.dependencies], route.path   # authenticated, never anonymous


def test_a_call_out_request_is_validated():
    with pytest.raises(ValidationError):
        RecordAbsenceRequest(assignment_id="not-a-uuid", expected_version=1, kind="called_out")
    with pytest.raises(ValidationError):
        RecordAbsenceRequest(assignment_id="b0000001-0000-4000-8000-000000000001", expected_version=1, kind="diagnosis")


# --- impact ----------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_impact_counts_only_what_the_floor_data_proves(db):
    db.rows["room_assignments"] += [
        {"tenant_id": HOTEL, "assigned_to": U_HK1, "assignment_date": DAY.isoformat(), "room_id": f"r{i}", "clean_type": None,
         "rooms": {"room_number": str(100 + i), "room_types": {"base_clean_minutes": 30}}} for i in range(4)]
    db.rows["room_status"] += [{"tenant_id": HOTEL, "room_id": "r0", "status": "CLEAN"}, {"tenant_id": HOTEL, "room_id": "r1", "status": "IN_PROGRESS"},
                               {"tenant_id": HOTEL, "room_id": "r2", "status": "DIRTY"}, {"tenant_id": HOTEL, "room_id": "r3", "status": "DIRTY"}]
    impact = (await call_out(await scheduled()))["data"]["impact"]
    assert impact["verified"] and (impact["rooms_assigned"], impact["rooms_done"], impact["rooms_in_progress"], impact["rooms_remaining"]) == (4, 1, 1, 3)
    assert impact["estimated_minutes_remaining"] == 90
    assert db.rows["room_assignments"][0]["assigned_to"] == U_HK1          # nothing was reassigned


@pytest.mark.asyncio
async def test_impact_says_it_cannot_assess_instead_of_guessing(db, monkeypatch):
    assignment = await scheduled()

    class Broken(CoverageDB):
        def table(self, name):
            if name == "room_assignments":
                raise RuntimeError("down")
            return super().table(name)

    broken = Broken(db.rows)
    for module in MODULES:
        monkeypatch.setattr(module, "supabase", broken)
    impact = (await call_out(assignment))["data"]["impact"]
    assert impact == {**impact, "verified": False, "reason": "workload_unavailable"} and "rooms_assigned" not in impact


# --- withdrawing a call-out ------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_withdrawing_a_call_out_cancels_its_open_gap_and_offers_but_not_a_filled_one(db):
    gap_id, result = await open_gap(db)
    await coverage.create_offer(gap_id, OfferShiftRequest(user_id=U_HK2, expected_version=1), SUP)
    absence_id = result["data"]["absence"]["id"]
    with pytest.raises(ValidationError):
        WithdrawAbsenceRequest(expected_version=1, reason="")
    await absences.withdraw_absence(absence_id, WithdrawAbsenceRequest(expected_version=1, reason="Came in after all"), SUP)
    assert gap_row(db, gap_id)["status"] == "waived" and db.rows["coverage_offers"][0]["status"] == "withdrawn"
    assert db.rows["absence_records"][0]["status"] == "withdrawn"

    gap2, result2 = await open_gap(db, user=U_HK2)
    await coverage.assign_gap(gap2, AssignGapRequest(user_id=U_HK3, expected_version=1), SUP)
    with pytest.raises(CodedHTTPException) as exc:
        await absences.withdraw_absence(result2["data"]["absence"]["id"], WithdrawAbsenceRequest(expected_version=1, reason="Oops"), SUP)
    assert refused(exc) in ("already_covered", "absence_not_withdrawable")


# --- candidates ------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_candidates_are_explained_and_never_called_available(db):
    gap_id, _ = await open_gap(db)
    found = by_user(await candidates(gap_id))
    assert U_HK1 in found and "is_absent_employee" in found[U_HK1]["blockers"] and not found[U_HK1]["eligible"]
    assert U_ENG not in found and U_INACTIVE not in found and U_OTHER not in found      # other department, inactive, other hotel
    hk2 = found[U_HK2]
    assert hk2["eligible"] and hk2["reasons"] == ["eligible_by_schedule"] and hk2["availability"] == "unknown"
    assert "availability_unknown" in hk2["warnings"]


@pytest.mark.asyncio
async def test_an_overlapping_shift_blocks_and_an_adjacent_one_only_warns_about_rest(db):
    gap_id, _ = await open_gap(db)
    await scheduled(user=U_HK2, shift_id=S_EVE)                                         # 15:00-23:00 right after: no overlap
    await scheduled(user=U_HK3, shift_id=S_MORN, start_time="10:00", end_time="12:00")   # inside the gap window
    found = by_user(await candidates(gap_id))
    assert found[U_HK2]["eligible"] and "insufficient_rest" in found[U_HK2]["warnings"]
    assert not found[U_HK3]["eligible"] and "overlapping_shift" in found[U_HK3]["blockers"]
    assert [c["user_id"] for c in (await candidates(gap_id, filter="conflicts"))["data"]] == [U_HK3]
    assert U_HK3 not in [c["user_id"] for c in (await candidates(gap_id, filter="eligible"))["data"]]
    assert [c["user_id"] for c in (await candidates(gap_id, q="bea"))["data"]] == [U_HK2]


@pytest.mark.asyncio
async def test_a_pending_offer_elsewhere_is_a_warning_and_the_overnight_shift_is_covered_across_midnight(db):
    gap_id, _ = await open_gap(db)
    night_gap, night = await open_gap(db, user=U_HK3, shift_id=S_NIGHT)
    assert night["data"]["gap"]["end_time"] == "07:00:00" and night["data"]["gap"]["ends_at"].startswith("2030-01-09")
    await coverage.create_offer(night_gap, OfferShiftRequest(user_id=U_HK2, expected_version=1), SUP)
    found = by_user(await candidates(night_gap))
    assert found[U_HK2]["eligible"]
    other = by_user(await candidates(gap_id))                      # the morning gap does not overlap the night offer
    assert "pending_offer_elsewhere" not in other[U_HK2]["warnings"]


@pytest.mark.asyncio
async def test_other_departments_and_hotels_cannot_look_at_a_gap(db):
    gap_id, _ = await open_gap(db)
    for actor, code in ((ENGINEER, "department_forbidden"), (OTHER_SUP, "gap_not_found")):
        with pytest.raises(CodedHTTPException) as exc:
            await candidates(gap_id, actor=actor)
        assert refused(exc) == code
    assert (await coverage.list_gaps(status=None, date_from=None, date_to=None, source=None, claimable=None, per_page=50, current_user=OTHER_SUP))["data"] == []


# --- offers ----------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_an_offer_is_not_a_shift_and_is_never_reported_as_delivered(db):
    gap_id, _ = await open_gap(db)
    result = await coverage.create_offer(gap_id, OfferShiftRequest(user_id=U_HK2, expected_version=1), SUP)
    assert result["meta"]["delivered"] is False and result["data"]["status"] == "offered"
    offer = db.rows["coverage_offers"][0]
    assert offer["status"] == "pending" and offer["delivery"] == "not_sent"
    assert [r for r in db.rows["shift_assignments"] if r["user_id"] == U_HK2] == []      # nobody is scheduled by an offer
    assert gap_row(db, gap_id)["filled_assignment_id"] is None if "filled_assignment_id" in gap_row(db, gap_id) else True
    with pytest.raises(CodedHTTPException) as exc:
        await coverage.create_offer(gap_id, OfferShiftRequest(user_id=U_HK2, expected_version=2), SUP)
    assert refused(exc) == "duplicate_offer"


@pytest.mark.asyncio
async def test_offers_refuse_stale_versions_ineligible_people_and_closed_gaps(db):
    gap_id, _ = await open_gap(db)
    with pytest.raises(CodedHTTPException) as exc:
        await coverage.create_offer(gap_id, OfferShiftRequest(user_id=U_HK2, expected_version=5), SUP)
    assert refused(exc) == "version_conflict"
    for user, code in ((U_ENG, "candidate_ineligible"), (U_HK1, "candidate_ineligible"), (U_INACTIVE, "staff_not_found")):
        with pytest.raises(CodedHTTPException) as exc:
            await coverage.create_offer(gap_id, OfferShiftRequest(user_id=user, expected_version=1), SUP)
        assert refused(exc) == code
    await coverage.waive_gap(gap_id, WaiveGapRequest(expected_version=1, reason="Not needed"), SUP)
    with pytest.raises(CodedHTTPException) as exc:
        await coverage.create_offer(gap_id, OfferShiftRequest(user_id=U_HK2, expected_version=2), SUP)
    assert refused(exc) == "gap_waived"


@pytest.mark.asyncio
async def test_withdrawing_the_only_offer_returns_the_gap_to_open(db):
    gap_id, _ = await open_gap(db)
    await coverage.create_offer(gap_id, OfferShiftRequest(user_id=U_HK2, expected_version=1), SUP)
    offer_id = db.rows["coverage_offers"][0]["id"]
    await coverage.withdraw_offer(gap_id, offer_id, SUP)
    assert gap_row(db, gap_id)["status"] == "open" and db.rows["coverage_offers"][0]["status"] == "withdrawn"
    with pytest.raises(CodedHTTPException) as exc:
        await coverage.withdraw_offer(gap_id, offer_id, SUP)
    assert refused(exc) == "offer_not_withdrawable"


@pytest.mark.asyncio
async def test_declining_reopens_the_gap_and_an_expired_offer_cannot_be_accepted(db):
    gap_id, _ = await open_gap(db)
    await coverage.create_offer(gap_id, OfferShiftRequest(user_id=U_HK2, expected_version=1), SUP)
    offer = db.rows["coverage_offers"][0]
    await requests_router.respond_to_offer(offer["id"], OfferResponseRequest(accept=False), HK2)
    assert offer["status"] == "declined" and gap_row(db, gap_id)["status"] == "open"
    await coverage.create_offer(gap_id, OfferShiftRequest(user_id=U_HK3, expected_version=gap_row(db, gap_id)["version"]), SUP)
    second = db.rows["coverage_offers"][1]
    second["expires_at"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    with pytest.raises(CodedHTTPException) as exc:
        await requests_router.respond_to_offer(second["id"], OfferResponseRequest(accept=True), HK3)
    assert refused(exc) == "offer_expired" and db.rows["shift_assignments"][-1]["user_id"] == U_HK1


def test_offer_expiry_never_outlasts_the_shift_start_or_a_day():
    now = datetime(2030, 1, 8, 10, 0, tzinfo=timezone.utc)
    assert offer_expiry(now, now + timedelta(minutes=30)) == now + timedelta(minutes=30)
    assert offer_expiry(now, now + timedelta(days=3)) == now + timedelta(hours=2)
    assert offer_expiry(now, now + timedelta(days=3), 24 * 60 * 5) == now + timedelta(hours=24)


@pytest.mark.asyncio
async def test_accepting_an_offer_fills_the_gap_atomically_and_settles_everything_else(db):
    gap_id, result = await open_gap(db)
    await coverage.create_offer(gap_id, OfferShiftRequest(user_id=U_HK2, expected_version=1), SUP)
    await coverage.create_offer(gap_id, OfferShiftRequest(user_id=U_HK3, expected_version=gap_row(db, gap_id)["version"]), SUP)
    first = db.rows["coverage_offers"][0]
    answered = await requests_router.respond_to_offer(first["id"], OfferResponseRequest(accept=True), HK2)
    assert answered["data"]["status"] == "accepted"
    gap = gap_row(db, gap_id)
    assert gap["status"] == "filled" and gap["resolution"] == "offer_accepted" and gap["filled_user_id"] == U_HK2
    assert db.rows["absence_records"][0]["status"] == "covered"
    assert [o["status"] for o in db.rows["coverage_offers"]] == ["accepted", "superseded"]
    replacement = next(r for r in db.rows["shift_assignments"] if r["id"] == gap["filled_assignment_id"])
    assert (replacement["user_id"], replacement["starts_at"]) == (U_HK2, db.rows["shift_assignments"][0]["starts_at"])
    assert db.rows["shift_assignments"][0]["user_id"] == U_HK1 and db.rows["room_assignments"] == []
    with pytest.raises(CodedHTTPException) as exc:
        await requests_router.respond_to_offer(db.rows["coverage_offers"][1]["id"], OfferResponseRequest(accept=True), HK3)
    assert refused(exc) == "offer_not_pending"


@pytest.mark.asyncio
async def test_only_the_offered_person_or_a_supervisor_in_scope_can_answer(db):
    gap_id, _ = await open_gap(db)
    await coverage.create_offer(gap_id, OfferShiftRequest(user_id=U_HK2, expected_version=1), SUP)
    offer_id = db.rows["coverage_offers"][0]["id"]
    for stranger in (HK3, ENGINEER, OTHER_SUP):
        with pytest.raises(CodedHTTPException) as exc:
            await requests_router.respond_to_offer(offer_id, OfferResponseRequest(accept=True), stranger)
        assert refused(exc) == "offer_not_found"
    with pytest.raises(CodedHTTPException) as exc:
        await requests_router.respond_to_offer(offer_id, OfferResponseRequest(accept=False), SUP)
    assert refused(exc) == "use_withdraw"
    done = await requests_router.respond_to_offer(offer_id, OfferResponseRequest(accept=True), SUP)   # phone acceptance
    assert done["data"]["status"] == "accepted" and gap_row(db, gap_id)["status"] == "filled"
    assert any(e["action"] == "accepted" and e["actor_id"] == U_SUP for e in db.rows["operational_audit_events"])


# --- direct assignment, races and stale state -----------------------------------------------------------------

@pytest.mark.asyncio
async def test_direct_assignment_needs_acknowledgement_for_warnings_and_then_fills(db):
    gap_id, _ = await open_gap(db)
    other_gap, _ = await open_gap(db, user=U_HK3)
    await coverage.create_offer(other_gap, OfferShiftRequest(user_id=U_HK2, expected_version=1), SUP)   # same hours: warning
    with pytest.raises(CodedHTTPException) as exc:
        await coverage.assign_gap(gap_id, AssignGapRequest(user_id=U_HK2, expected_version=1), SUP)
    assert refused(exc) == "warnings_need_acknowledgement" and exc.value.extra["warnings"] == ["pending_offer_elsewhere"]
    done = await coverage.assign_gap(gap_id, AssignGapRequest(user_id=U_HK2, expected_version=1, acknowledge_warnings=True), SUP)
    assert done["data"]["status"] == "filled" and done["data"]["filled_user_id"] == U_HK2
    assert done["data"]["absence"]["status"] == "covered"


@pytest.mark.asyncio
async def test_two_supervisors_cannot_fill_the_same_shift_twice(db):
    gap_id, _ = await open_gap(db)
    await coverage.assign_gap(gap_id, AssignGapRequest(user_id=U_HK2, expected_version=1), SUP)
    with pytest.raises(CodedHTTPException) as exc:
        await coverage.assign_gap(gap_id, AssignGapRequest(user_id=U_HK3, expected_version=1), GM)
    assert refused(exc) in ("gap_filled", "version_conflict")
    assert len([r for r in db.rows["shift_assignments"] if r["user_id"] in (U_HK2, U_HK3)]) == 1


@pytest.mark.asyncio
async def test_a_fill_that_loses_the_race_inside_the_transaction_is_refused_with_current_state(db):
    gap_id, _ = await open_gap(db)

    def rival_wins():
        gap_row(db, gap_id).update(status="filled", version=2)

    db.fill_gate = rival_wins
    with pytest.raises(CodedHTTPException) as exc:
        await coverage.assign_gap(gap_id, AssignGapRequest(user_id=U_HK2, expected_version=1), SUP)
    assert refused(exc) == "gap_not_fillable" and exc.value.extra["current"]["status"] == "filled"
    assert [r for r in db.rows["shift_assignments"] if r["user_id"] == U_HK2] == []


@pytest.mark.asyncio
async def test_a_replacement_who_became_busy_is_refused_before_and_inside_the_transaction(db):
    gap_id, _ = await open_gap(db)
    db.fill_gate = lambda: db.rows["shift_assignments"].append({
        "id": "x", "tenant_id": HOTEL, "shift_id": S_EVE, "work_date": "2030-01-08", "user_id": U_HK2, "publication_state": "published", "starts_at": "2030-01-08T13:00:00+00:00", "ends_at": "2030-01-08T21:00:00+00:00"})
    with pytest.raises(CodedHTTPException) as exc:
        await coverage.assign_gap(gap_id, AssignGapRequest(user_id=U_HK2, expected_version=1), SUP)
    assert refused(exc) == "schedule_conflict" and gap_row(db, gap_id)["status"] == "open"
    db.fill_gate = None
    with pytest.raises(CodedHTTPException) as exc:
        await coverage.assign_gap(gap_id, AssignGapRequest(user_id=U_HK2, expected_version=1), SUP)
    assert refused(exc) == "candidate_ineligible" and "overlapping_shift" in exc.value.extra["blockers"]


@pytest.mark.asyncio
async def test_waiving_needs_a_reason_is_audited_and_is_final(db):
    gap_id, _ = await open_gap(db)
    with pytest.raises(ValidationError):
        WaiveGapRequest(expected_version=1, reason="")
    with pytest.raises(CodedHTTPException) as exc:
        await coverage.waive_gap(gap_id, WaiveGapRequest(expected_version=9, reason="Quiet day"), SUP)
    assert refused(exc) == "version_conflict"
    waived = await coverage.waive_gap(gap_id, WaiveGapRequest(expected_version=1, reason="Quiet day"), SUP)
    assert waived["data"]["status"] == "waived" and waived["data"]["resolution_reason"] == "Quiet day"
    with pytest.raises(CodedHTTPException) as exc:
        await coverage.waive_gap(gap_id, WaiveGapRequest(expected_version=2, reason="Again"), SUP)
    assert refused(exc) == "gap_not_waivable"
    assert any(e["action"] == "waived" and e["reason_note"] == "Quiet day" for e in db.rows["operational_audit_events"])


@pytest.mark.asyncio
async def test_history_lists_every_step_in_order_for_managers_in_scope(db):
    gap_id, _ = await open_gap(db)
    await coverage.create_offer(gap_id, OfferShiftRequest(user_id=U_HK2, expected_version=1), SUP)
    await requests_router.respond_to_offer(db.rows["coverage_offers"][0]["id"], OfferResponseRequest(accept=True), HK2)
    events = (await coverage.gap_history(gap_id, SUP))["data"]
    kinds = [(e["resource_type"], e["action"]) for e in events]
    for expected in (("absence", "confirmed"), ("coverage_gap", "opened"), ("coverage_offer", "created"), ("coverage_gap", "filled"), ("coverage_offer", "accepted")):
        assert expected in kinds
    with pytest.raises(CodedHTTPException):
        await coverage.gap_history(gap_id, OTHER_SUP)


# --- open shifts and claims ------------------------------------------------------------------------------------

async def post_open(db, claimable=True, day=DAY + timedelta(days=3), shift_id=S_MORN, **extra):
    return (await coverage.post_open_shift(PostOpenShiftRequest(shift_id=shift_id, work_date=day.isoformat(), claimable=claimable, **extra), SUP))["data"]


@pytest.mark.asyncio
async def test_posting_an_open_shift_validates_and_is_duplicate_safe(db):
    gap = await post_open(db, claimable=True, required_role="housekeeper")
    assert gap["source"] == "open_shift" and gap["open_shift_state"] == "open" and gap["claimable"]
    with pytest.raises(CodedHTTPException) as exc:
        await post_open(db)
    assert refused(exc) == "duplicate_open_shift"
    with pytest.raises(CodedHTTPException) as exc:
        await post_open(db, day=datetime(2020, 1, 1).date())
    assert refused(exc) == "historical_date"
    with pytest.raises(CodedHTTPException) as exc:
        await coverage.post_open_shift(PostOpenShiftRequest(shift_id=S_MORN, work_date="2030-02-02"), ENGINEER)
    assert refused(exc) == "department_forbidden"
    retry = await coverage.post_open_shift(PostOpenShiftRequest(shift_id=S_EVE, work_date="2030-02-03", idempotency_key="open-key-1"), SUP)
    again = await coverage.post_open_shift(PostOpenShiftRequest(shift_id=S_EVE, work_date="2030-02-03", idempotency_key="open-key-1"), SUP)
    assert again["meta"]["replayed"] and again["data"]["id"] == retry["data"]["id"]


@pytest.mark.asyncio
async def test_a_dst_night_shift_is_posted_with_its_real_length(db):
    gap = await post_open(db, day=datetime(2030, 3, 9).date(), shift_id=S_NIGHT)       # US clocks go forward the night of Mar 10
    assert gap["starts_at"].startswith("2030-03-10T05:00") and gap["ends_at"].startswith("2030-03-10T12:00")


@pytest.mark.asyncio
async def test_employees_only_see_and_claim_claimable_shifts_in_their_own_department(db):
    open_gap_ = await post_open(db, claimable=True)
    hidden = await post_open(db, claimable=False, day=DAY + timedelta(days=4))
    listing = (await requests_router.my_open_shifts(HK2))["data"]
    assert [row["shift"]["id"] for row in listing] == [open_gap_["id"]] and listing[0]["can_claim"] and "notes" not in listing[0]["shift"]
    assert (await requests_router.my_open_shifts(ENGINEER))["data"] == []
    for actor, gap_id in ((HK2, hidden["id"]), (ENGINEER, open_gap_["id"])):
        with pytest.raises(CodedHTTPException) as exc:
            await requests_router.claim_open_shift(gap_id, actor)
        assert refused(exc) == "gap_not_found"
    claim = await requests_router.claim_open_shift(open_gap_["id"], HK2)
    assert claim["data"]["status"] == "pending" and gap_row(db, open_gap_["id"])["status"] == "open"
    assert [r for r in db.rows["shift_assignments"] if r["user_id"] == U_HK2] == []     # a claim schedules nobody
    with pytest.raises(CodedHTTPException) as exc:
        await requests_router.claim_open_shift(open_gap_["id"], HK2)
    assert refused(exc) == "duplicate_claim"


@pytest.mark.asyncio
async def test_approving_a_claim_fills_the_shift_and_declines_the_other_claims(db):
    gap = await post_open(db)
    await requests_router.claim_open_shift(gap["id"], HK2)
    await requests_router.claim_open_shift(gap["id"], HK3)
    claim_id = db.rows["coverage_claims"][0]["id"]
    with pytest.raises(CodedHTTPException) as exc:
        await requests_router.approve_claim(claim_id, ClaimDecisionRequest(expected_version=7), SUP)
    assert refused(exc) == "version_conflict"
    approved = await requests_router.approve_claim(claim_id, ClaimDecisionRequest(expected_version=1), SUP)
    assert approved["data"]["status"] == "filled" and approved["data"]["resolution"] == "claim_approved"
    assert [c["status"] for c in db.rows["coverage_claims"]] == ["approved", "declined"]
    with pytest.raises(CodedHTTPException) as exc:
        await requests_router.approve_claim(db.rows["coverage_claims"][1]["id"], ClaimDecisionRequest(expected_version=2), SUP)
    assert refused(exc) == "claim_not_pending"


@pytest.mark.asyncio
async def test_a_claim_that_went_stale_is_declined_not_forced(db):
    gap = await post_open(db)
    await requests_router.claim_open_shift(gap["id"], HK2)
    await stored_id(user=U_HK2, shift_id=S_MORN, day=DAY + timedelta(days=3), start_time="08:00", end_time="10:00")   # now busy
    with pytest.raises(CodedHTTPException) as exc:
        await requests_router.approve_claim(db.rows["coverage_claims"][0]["id"], ClaimDecisionRequest(expected_version=1), SUP)
    assert refused(exc) == "claim_stale" and db.rows["coverage_claims"][0]["status"] == "declined"
    assert gap_row(db, gap["id"])["status"] == "open"
    gap2 = await post_open(db, day=DAY + timedelta(days=6))
    await requests_router.claim_open_shift(gap2["id"], HK3)
    await coverage.waive_gap(gap2["id"], WaiveGapRequest(expected_version=1, reason="Cancelled"), SUP)
    assert db.rows["coverage_claims"][1]["status"] == "declined"


@pytest.mark.asyncio
async def test_employees_can_withdraw_only_their_own_claim_and_supervisors_can_decline(db):
    gap = await post_open(db)
    await requests_router.claim_open_shift(gap["id"], HK2)
    await requests_router.claim_open_shift(gap["id"], HK3)
    mine, theirs = (c["id"] for c in db.rows["coverage_claims"])
    with pytest.raises(CodedHTTPException) as exc:
        await requests_router.withdraw_claim(theirs, HK2)
    assert refused(exc) == "claim_not_found"
    await requests_router.withdraw_claim(mine, HK2)
    await requests_router.decline_claim(theirs, ClaimDecisionRequest(expected_version=1, reason="Needs rest"), SUP)
    assert [c["status"] for c in db.rows["coverage_claims"]] == ["withdrawn", "declined"]
    with pytest.raises(CodedHTTPException) as exc:
        await requests_router.decline_claim(theirs, ClaimDecisionRequest(expected_version=1), OTHER_SUP)
    assert refused(exc) == "claim_not_found"


@pytest.mark.asyncio
async def test_the_gap_list_defaults_to_work_still_to_do(db):
    open_id, _ = await open_gap(db)
    done_id, _ = await open_gap(db, user=U_HK2)
    await coverage.assign_gap(done_id, AssignGapRequest(user_id=U_HK3, expected_version=1), SUP)
    listing = await coverage.list_gaps(status=None, date_from=None, date_to=None, source=None, claimable=None, per_page=50, current_user=SUP)
    assert [g["id"] for g in listing["data"]] == [open_id] and listing["data"][0]["absent_user_name"] == "Ana Lopez"
    filled = await coverage.list_gaps(status="filled", date_from=None, date_to=None, source=None, claimable=None, per_page=50, current_user=SUP)
    assert [g["id"] for g in filled["data"]] == [done_id]


# --- contracts -------------------------------------------------------------------------------------------------

def test_the_shared_workflow_contract_governs_every_transition():
    mgr, me = actor_kind(True), actor_kind(False, True)
    assert transition_error("absence", "confirmed", "withdrawn", mgr, "Mistake") is None
    assert transition_error("absence", "confirmed", "withdrawn", mgr) == "reason_required"
    assert transition_error("absence", "covered", "withdrawn", mgr, "x") == "invalid_transition"
    assert transition_error("coverage_gap", "filled", "waived", mgr, "x") == "invalid_transition"
    assert transition_error("coverage_offer", "pending", "declined", mgr) == "not_permitted"
    assert transition_error("coverage_offer", "pending", "declined", me) is None
    assert transition_error("coverage_claim", "pending", "approved", me) == "not_permitted"
    assert transition_error("coverage_claim", "pending", "withdrawn", me) is None
