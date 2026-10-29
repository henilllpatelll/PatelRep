"""Employee-side coverage: answering an offer, claiming an open shift, plus the supervisor's decision on a claim.

PRIVACY. An employee sees only their OWN offers and claims and the shift they are about (date, times, role) -- never the
called-out person, the absence note, other candidates or other people's claims. Someone else's offer or claim is a 404.

A CLAIM IS NOT A SHIFT. Claiming records interest; a supervisor approves it (or declines it). Approval runs the same
eligibility re-check and atomic fill as every other path, and a claim whose person or shift changed in the meantime is
declined as stale instead of being force-fitted.

There is no employee-facing UI for any of this in Phase 4 (the supervisor app owns these screens and no notification
channel exists to tell an employee about an offer); the endpoints exist so the response foundation is real and tested.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends

from core.database import supabase
from core.roles import ALL_ROLES, SCHEDULE_MANAGER_ROLES
from middleware.auth import CurrentUser, require_role
from models.coverage_requests import ClaimDecisionRequest, OfferResponseRequest
from services import coverage_fill as fill
from services import coverage_store as store
from services.scheduling_access import ensure_can_manage, err, load_departments, load_staff, record_audit
from services.scheduling_coverage import actor_kind, effective_offer_status, gap_is_actionable, offer_is_live, transition_error

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/schedules", tags=["scheduling-coverage"])


def _employee_gap_view(gap: dict) -> dict:
    """The only fields of a gap an employee may see."""
    return {k: gap.get(k) for k in ("id", "shift_name", "work_date", "start_time", "end_time", "starts_at", "ends_at", "required_role", "status", "version")}


def _own_offer(current_user: CurrentUser, offer_id: str) -> dict:
    found = supabase.table("coverage_offers").select("*").eq("tenant_id", current_user.hotel_id).eq("id", offer_id).maybe_single().execute()
    return found.data if found and found.data else {}


@router.get("/me/offers")
async def my_offers(current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    hotel_id, now = current_user.hotel_id, store.now_utc()
    offers = (supabase.table("coverage_offers").select("*").eq("tenant_id", hotel_id).eq("user_id", current_user.user_id)
              .eq("status", "pending").execute().data or [])
    live = [o for o in offers if offer_is_live(o, now)]
    gaps = {str(g["id"]): g for g in (supabase.table("coverage_gaps").select("*").eq("tenant_id", hotel_id)
            .in_("id", sorted({str(o["gap_id"]) for o in live})).execute().data or [])} if live else {}
    return {"data": [
        {"id": o["id"], "expires_at": o.get("expires_at"), "status": "pending", "shift": _employee_gap_view(gaps[str(o["gap_id"])])}
        for o in live if str(o["gap_id"]) in gaps and gaps[str(o["gap_id"])]["status"] in ("open", "offered")]}


@router.post("/offers/{offer_id}/respond")
async def respond_to_offer(offer_id: str, body: OfferResponseRequest, current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    """
    The offered employee accepts or declines. A supervisor in scope may also record an ACCEPT given by phone or in person
    (contract: accepted -> SELF or MANAGER); recording a decline is a withdrawal on the supervisor side. Accepting
    re-validates everything and fills the gap in one transaction, or fails without changing anything.
    """
    hotel_id = current_user.hotel_id
    offer = _own_offer(current_user, offer_id)
    if not offer:
        raise err(404, "offer_not_found", "Offer not found")
    gap = store.load_gap(hotel_id, str(offer["gap_id"]))
    is_self = str(offer["user_id"]) == current_user.user_id
    is_manager = False
    if not is_self:
        if current_user.role not in SCHEDULE_MANAGER_ROLES:
            raise err(404, "offer_not_found", "Offer not found")  # somebody else's offer: indistinguishable from missing
        try:
            ensure_can_manage(current_user, str(gap["department_id"]), load_departments(hotel_id))
        except Exception:
            raise err(404, "offer_not_found", "Offer not found")  # a manager of another department is a stranger too
        is_manager = True
        if not body.accept:
            raise err(422, "use_withdraw", "To cancel an offer on the employee's behalf, withdraw it.")

    now = store.now_utc()
    state = effective_offer_status(offer, now)
    if state != "pending":
        raise err(409, "offer_expired" if state == "expired" else "offer_not_pending", f"This offer is {state}.", status=state)
    actors = actor_kind(is_manager, is_self)
    target = "accepted" if body.accept else "declined"
    problem = transition_error("coverage_offer", "pending", target, actors)
    if problem:
        raise err(403, problem, "You cannot answer this offer.")

    if not body.accept:
        saved = store.cas_update("coverage_offers", hotel_id, offer_id, int(offer.get("version") or 1),
                                 {"status": "declined", "responded_at": now.isoformat(), "response_note": body.note})
        if saved is None:
            raise err(409, "offer_not_pending", "This offer changed. Reload to see the latest.")
        record_audit(current_user, resource_type="coverage_offer", resource_id=offer_id, action="declined",
                     old_state={"status": "pending"}, new_state={"status": "declined"})
        fill.reopen_if_idle(hotel_id, str(gap["id"]))
        return {"data": {"offer_id": offer_id, "status": "declined"}}

    why = gap_is_actionable(gap, now)
    if why:
        raise err(409, "gap_not_fillable", "This shift was filled or closed before the offer was accepted.", status=gap["status"])
    departments = load_departments(hotel_id)
    fill.require_eligible(hotel_id, gap, str(offer["user_id"]), departments, acknowledge=True)
    result = fill.commit_fill(current_user, gap, str(offer["user_id"]), resolution="offer_accepted",
                              expected_version=int(gap["version"]), offer_id=offer_id)
    record_audit(current_user, resource_type="coverage_offer", resource_id=offer_id, action="accepted",
                 old_state={"status": "pending"}, new_state={"status": "accepted", "recorded_by_manager": is_manager})
    return {"data": {"offer_id": offer_id, "status": "accepted", "assignment_id": result["assignment_id"]}}


# ---------------------------------------------------------------------------
# Open-shift claims
# ---------------------------------------------------------------------------

@router.get("/me/open-shifts")
async def my_open_shifts(current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    """Claimable open shifts in the caller's own department, each with whether they could take it right now."""
    hotel_id = current_user.hotel_id
    departments = load_departments(hotel_id)
    me = load_staff(hotel_id, departments, [current_user.user_id])
    member = me.get(current_user.user_id)
    if member is None or member.department_id is None:
        return {"data": []}
    gaps = (supabase.table("coverage_gaps").select("*").eq("tenant_id", hotel_id).eq("department_id", member.department_id)
            .eq("claimable", True).in_("status", ["open", "offered"]).order("starts_at").limit(50).execute().data or [])
    now = store.now_utc()
    mine = {str(c["gap_id"]): c for c in (supabase.table("coverage_claims").select("*").eq("tenant_id", hotel_id)
            .eq("user_id", current_user.user_id).eq("status", "pending").execute().data or [])}
    out = []
    for gap in gaps:
        if gap_is_actionable(gap, now):
            continue
        cand = fill.evaluate_users(hotel_id, gap, me, departments)[0]
        out.append({"shift": _employee_gap_view(gap), "can_claim": cand.eligible and str(gap["id"]) not in mine,
                    "blockers": cand.blockers, "my_claim_id": mine.get(str(gap["id"]), {}).get("id")})
    return {"data": out}


@router.post("/gaps/{gap_id}/claims")
async def claim_open_shift(gap_id: str, current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    """Express interest. Never schedules anybody; a supervisor must approve."""
    hotel_id = current_user.hotel_id
    departments = load_departments(hotel_id)
    member = load_staff(hotel_id, departments, [current_user.user_id]).get(current_user.user_id)
    found = supabase.table("coverage_gaps").select("*").eq("tenant_id", hotel_id).eq("id", gap_id).maybe_single().execute()
    gap = found.data if found else None
    if not gap or member is None or str(gap["department_id"]) != str(member.department_id) or not gap.get("claimable"):
        raise err(404, "gap_not_found", "Open shift not found")  # not claimable by this person = not visible to them
    why = gap_is_actionable(gap, store.now_utc())
    if why:
        raise err(409, why, "This shift is no longer open.")
    cand = fill.evaluate_users(hotel_id, gap, {current_user.user_id: member}, departments)[0]
    if not cand.eligible:
        raise err(409, "candidate_ineligible", "You cannot take this shift.", blockers=cand.blockers)
    try:
        claim = store.insert_row("coverage_claims", {"tenant_id": hotel_id, "gap_id": gap_id, "user_id": current_user.user_id, "status": "pending"})
    except Exception as exc:
        if store.is_unique_violation(exc):
            raise err(409, "duplicate_claim", "You have already claimed this shift.")
        raise
    record_audit(current_user, resource_type="coverage_claim", resource_id=str(claim["id"]), action="created",
                 new_state={"gap_id": gap_id, "status": "pending"})
    return {"data": {"claim_id": claim["id"], "status": "pending", "shift": _employee_gap_view(gap)}}


@router.post("/claims/{claim_id}/withdraw")
async def withdraw_claim(claim_id: str, current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    claim = _claim(current_user.hotel_id, claim_id)
    if not claim or str(claim["user_id"]) != current_user.user_id:
        raise err(404, "claim_not_found", "Claim not found")
    if claim["status"] != "pending":
        raise err(409, "claim_not_pending", f"This claim is already {claim['status']}.")
    supabase.table("coverage_claims").update({"status": "withdrawn", "updated_at": store.now_utc().isoformat()}).eq("tenant_id", current_user.hotel_id).eq("id", claim_id).eq("status", "pending").execute()
    record_audit(current_user, resource_type="coverage_claim", resource_id=claim_id, action="withdrawn",
                 old_state={"status": "pending"}, new_state={"status": "withdrawn"})
    return {"data": {"claim_id": claim_id, "status": "withdrawn"}}


def _claim(hotel_id: str, claim_id: str) -> Optional[dict]:
    found = supabase.table("coverage_claims").select("*").eq("tenant_id", hotel_id).eq("id", claim_id).maybe_single().execute()
    return found.data if found and found.data else None


def _decide_stale(current_user: CurrentUser, claim: dict, reason: str) -> None:
    supabase.table("coverage_claims").update({
        "status": "declined", "decided_by": current_user.user_id, "decided_at": store.now_utc().isoformat(),
        "decision_reason": reason, "updated_at": store.now_utc().isoformat()}).eq("tenant_id", current_user.hotel_id).eq("id", claim["id"]).eq("status", "pending").execute()
    record_audit(current_user, resource_type="coverage_claim", resource_id=str(claim["id"]), action="declined",
                 old_state={"status": "pending"}, new_state={"status": "declined"}, reason_note=reason)


@router.post("/claims/{claim_id}/approve")
async def approve_claim(claim_id: str, body: ClaimDecisionRequest, current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES))):
    hotel_id = current_user.hotel_id
    claim = _claim(hotel_id, claim_id)
    if not claim:
        raise err(404, "claim_not_found", "Claim not found")
    departments = load_departments(hotel_id)
    gap = store.load_gap(hotel_id, str(claim["gap_id"]))
    ensure_can_manage(current_user, str(gap["department_id"]), departments)
    problem = transition_error("coverage_claim", claim["status"], "approved", actor_kind(True))
    if problem:
        raise err(409, "claim_not_pending", f"This claim is already {claim['status']}.")
    if gap_is_actionable(gap, store.now_utc()):
        _decide_stale(current_user, claim, "Shift was filled or closed")
        raise err(409, "claim_stale", "This shift was filled or closed, so the claim was declined.", status=gap["status"])
    if int(gap["version"]) != body.expected_version:
        raise store.version_conflict("coverage gap", fill.full_gap(hotel_id, str(gap["id"])))
    try:
        fill.require_eligible(hotel_id, gap, str(claim["user_id"]), departments, acknowledge=body.acknowledge_warnings)
    except Exception as exc:
        if getattr(exc, "code", None) == "candidate_ineligible":
            _decide_stale(current_user, claim, "No longer eligible")
            raise err(409, "claim_stale", "That employee can no longer take this shift, so the claim was declined.",
                      blockers=getattr(exc, "extra", {}).get("blockers", []))
        raise
    result = fill.commit_fill(current_user, gap, str(claim["user_id"]), resolution="claim_approved",
                              expected_version=body.expected_version, claim_id=claim_id)
    record_audit(current_user, resource_type="coverage_claim", resource_id=claim_id, action="approved",
                 old_state={"status": "pending"}, new_state={"status": "approved"})
    return {"data": fill.full_gap(hotel_id, str(gap["id"])), "meta": {"assignment_id": result["assignment_id"]}}


@router.post("/claims/{claim_id}/decline")
async def decline_claim(claim_id: str, body: ClaimDecisionRequest, current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES))):
    hotel_id = current_user.hotel_id
    claim = _claim(hotel_id, claim_id)
    if not claim:
        raise err(404, "claim_not_found", "Claim not found")
    gap = store.load_gap(hotel_id, str(claim["gap_id"]))
    ensure_can_manage(current_user, str(gap["department_id"]), load_departments(hotel_id))
    if claim["status"] != "pending":
        raise err(409, "claim_not_pending", f"This claim is already {claim['status']}.")
    _decide_stale(current_user, claim, body.reason or "Declined by supervisor")
    return {"data": fill.full_gap(hotel_id, str(gap["id"]))}
