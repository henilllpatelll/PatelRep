"""Coverage gaps: find a replacement, offer a shift, assign directly, post an open shift, waive.

OFFER != SHIFT. Creating an offer never schedules anybody and never says the employee was told: `delivery` stays
`not_sent` until a notification channel (Phase 7) reports otherwise. A gap is `filled` only by fill_coverage_gap(),
which inserts the replacement's shift_assignments row in the same transaction. Direct assignment, accepted offers and
approved claims all go through that one function (services/coverage_fill.py).

A replacement does NOT inherit the absent employee's rooms; that is a separate, explicit decision made in Assignments.
"""
import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query

from core.database import supabase
from core.roles import SCHEDULE_MANAGER_ROLES
from middleware.auth import CurrentUser, require_role
from models.coverage_requests import AssignGapRequest, OfferShiftRequest, PostOpenShiftRequest, WaiveGapRequest
from routers.scheduling import _clock, _load_template
from services import schedule_outbox as notices
from services import coverage_fill as fill
from services import coverage_store as store
from services.scheduling import format_clock, parse_clock, resolve_occurrence
from services.scheduling_access import (
    ensure_can_manage, err, hotel_today, hotel_zone, load_departments, load_names, load_staff, manager_scope, record_audit,
)
from services.scheduling_coverage import (
    actor_kind, gap_is_actionable, offer_expiry, sort_candidates, transition_error,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/schedules", tags=["scheduling-coverage"])

MAX_GAPS = 200
CANDIDATE_CAP = 300


def _managed_gap(current_user: CurrentUser, gap_id: str, departments=None) -> dict:
    gap = store.load_gap(current_user.hotel_id, gap_id)
    ensure_can_manage(current_user, str(gap["department_id"]), departments or load_departments(current_user.hotel_id))
    return gap


def _must_be_actionable(gap: dict) -> None:
    why = gap_is_actionable(gap, store.now_utc())
    if why:
        raise err(409, why, "This shift is no longer open for coverage." if why != "shift_ended" else "This shift has already ended.",
                  current=gap)


@router.get("/gaps")
async def list_gaps(
    status: Optional[str] = Query(None, description="open | offered | filled | waived; default: open and offered"),
    date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None),
    source: Optional[str] = Query(None), claimable: Optional[bool] = Query(None),
    per_page: int = Query(100, ge=1, le=MAX_GAPS),
    current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES)),
):
    hotel_id = current_user.hotel_id
    departments = load_departments(hotel_id)
    allowed = sorted(departments.ids_in_scope(manager_scope(current_user)))
    query = supabase.table("coverage_gaps").select("*").eq("tenant_id", hotel_id).in_("department_id", allowed)
    query = query.in_("status", [status] if status else ["open", "offered"])
    if date_from:
        query = query.gte("work_date", date_from.isoformat())
    if date_to:
        query = query.lte("work_date", date_to.isoformat())
    if source:
        query = query.eq("source", source)
    if claimable is not None:
        query = query.eq("claimable", claimable)
    gaps = query.order("starts_at").limit(per_page).execute().data or []
    ids = [str(g["id"]) for g in gaps]
    offers, claims = store.gap_children(ids, hotel_id)
    absence_ids = [str(g["absence_id"]) for g in gaps if g.get("absence_id")]
    absences = {str(a["id"]): a for a in (supabase.table("absence_records").select("*").eq("tenant_id", hotel_id).in_("id", absence_ids).execute().data or [])} if absence_ids else {}
    names = load_names(sorted({str(a["user_id"]) for a in absences.values()} | {str(o["user_id"]) for v in offers.values() for o in v}
                              | {str(c["user_id"]) for v in claims.values() for c in v}))
    now = store.now_utc()
    return {"data": [
        store.shape_gap(g, offers.get(str(g["id"]), []), claims.get(str(g["id"]), []), names, now,
                        absence=store.shape_absence(absences[str(g["absence_id"])], names) if str(g.get("absence_id")) in absences else None)
        for g in gaps], "meta": {"count": len(gaps), "per_page": per_page}}


@router.get("/gaps/{gap_id}")
async def get_gap(gap_id: str, current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES))):
    _managed_gap(current_user, gap_id)
    return {"data": fill.full_gap(current_user.hotel_id, gap_id)}


@router.get("/gaps/{gap_id}/history")
async def gap_history(gap_id: str, current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES))):
    """Everything that happened to this gap, its call-out, offers and claims, oldest first (append-only audit)."""
    hotel_id = current_user.hotel_id
    gap = _managed_gap(current_user, gap_id)
    offers, claims = store.gap_children([gap_id], hotel_id)
    resource_ids = [gap_id] + [str(o["id"]) for o in offers.get(gap_id, [])] + [str(c["id"]) for c in claims.get(gap_id, [])]
    if gap.get("absence_id"):
        resource_ids.append(str(gap["absence_id"]))
    events = (
        supabase.table("operational_audit_events").select("*").eq("tenant_id", hotel_id)
        .in_("resource_id", resource_ids).in_("resource_type", ["coverage_gap", "coverage_offer", "coverage_claim", "absence"])
        .order("created_at").limit(500).execute().data or []
    )
    names = load_names(sorted({str(e["actor_id"]) for e in events if e.get("actor_id")}))
    return {"data": [{
        "id": e.get("id"), "resource_type": e["resource_type"], "action": e["action"], "at": e.get("created_at"),
        "actor_id": e.get("actor_id"), "actor_name": names.get(str(e.get("actor_id")), "") if e.get("actor_id") else None,
        "actor_role": e.get("actor_role"), "old_state": e.get("old_state") or {}, "new_state": e.get("new_state") or {},
        "reason": e.get("reason_note"),
    } for e in events]}


@router.post("/open-shifts")
async def post_open_shift(body: PostOpenShiftRequest, current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES))):
    """Post a shift nobody holds (a vacancy, not a call-out). Claimable only when the supervisor chooses."""
    hotel_id = current_user.hotel_id
    if body.idempotency_key:
        prior = supabase.table("coverage_gaps").select("*").eq("tenant_id", hotel_id).eq("idempotency_key", body.idempotency_key).maybe_single().execute()
        if prior and prior.data:
            return {"data": fill.full_gap(hotel_id, str(prior.data["id"])), "meta": {"replayed": True}}
    departments = load_departments(hotel_id)
    template = _load_template(hotel_id, str(body.shift_id))
    ensure_can_manage(current_user, str(template["department_id"]), departments)
    if template.get("archived_at") or not template.get("is_active", True):
        raise err(409, "shift_inactive", f"Shift '{template.get('name')}' is inactive and cannot be scheduled.")
    zone = hotel_zone(hotel_id)
    day = date.fromisoformat(body.work_date)
    if day < hotel_today(zone):
        raise err(409, "historical_date", "An open shift cannot be posted for a date that has passed.")
    start_t = _clock(body.start_time, "start_time") or parse_clock(template["start_time"])
    end_t = _clock(body.end_time, "end_time") or parse_clock(template["end_time"])
    if start_t is None or end_t is None or start_t == end_t:
        raise err(422, "invalid_time", "The shift times are not valid.")
    starts, ends = resolve_occurrence(day, start_t, end_t, zone)
    if ends <= store.now_utc():
        raise err(409, "shift_ended", "That shift has already ended.")
    duplicate = (supabase.table("coverage_gaps").select("id").eq("tenant_id", hotel_id).eq("shift_id", str(body.shift_id))
                 .eq("work_date", body.work_date).eq("source", "open_shift").in_("status", ["open", "offered"]).execute().data or [])
    if duplicate:
        raise err(409, "duplicate_open_shift", "This shift is already posted as open.", gap_id=duplicate[0]["id"])
    row = {
        "tenant_id": hotel_id, "department_id": str(template["department_id"]), "source": "open_shift", "shift_id": str(body.shift_id),
        "shift_name": template["name"], "work_date": body.work_date, "start_time": format_clock(start_t), "end_time": format_clock(end_t),
        "starts_at": starts.isoformat(), "ends_at": ends.isoformat(), "required_role": body.required_role, "status": "open",
        "claimable": body.claimable, "notes": body.notes, "created_by": current_user.user_id, "version": 1,
        "idempotency_key": body.idempotency_key,
    }
    gap = store.insert_row("coverage_gaps", row)
    record_audit(current_user, resource_type="coverage_gap", resource_id=str(gap["id"]), action="opened",
                 new_state={"status": "open", "source": "open_shift", "claimable": body.claimable, "work_date": body.work_date})
    if body.claimable:
        # Tell the people who could actually take it (same eligibility the Open Shifts screen applies), never everyone.
        try:
            staff = {u: m for u, m in load_staff(hotel_id, departments).items() if m.department_id == str(template["department_id"])}
            eligible = [c.user_id for c in fill.evaluate_users(hotel_id, gap, staff, departments) if c.eligible]
        except Exception:
            eligible = []
        notices.enqueue(hotel_id, eligible, "schedule_open_shift", str(gap["id"]), {"gap_id": str(gap["id"]), "work_date": body.work_date})
    return {"data": fill.full_gap(hotel_id, str(gap["id"]))}


@router.get("/gaps/{gap_id}/candidates")
async def find_candidates(
    gap_id: str,
    q: Optional[str] = Query(None, max_length=80),
    filter: str = Query("all", pattern="^(all|eligible|warnings|conflicts)$"),
    role: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES)),
):
    """
    Replacement candidates for a gap. Deterministic and explained: every person carries the reasons they qualify, the
    warnings a supervisor should weigh and the blockers that rule them out. `availability` is what the employee
    submitted (available / outside / unavailable) and stays `unknown` when nothing was submitted; approved time off is
    a blocker. Nobody is called available merely for having no shift.
    """
    hotel_id = current_user.hotel_id
    departments = load_departments(hotel_id)
    gap = _managed_gap(current_user, gap_id, departments)
    staff = {uid: m for uid, m in load_staff(hotel_id, departments).items() if m.department_id == str(gap["department_id"])}
    names = load_names(sorted(staff))
    if q:
        needle = q.casefold()
        staff = {uid: m for uid, m in staff.items() if needle in (names.get(uid) or "").casefold()}
    if role:
        staff = {uid: m for uid, m in staff.items() if role in m.roles}
    capped = len(staff) > CANDIDATE_CAP
    staff = dict(list(staff.items())[:CANDIDATE_CAP])
    ranked = sort_candidates(fill.evaluate_users(hotel_id, gap, staff, departments), names)

    def keep(c) -> bool:
        warned = [w for w in c.warnings if w != "availability_unknown"]
        return {"all": True, "eligible": c.eligible, "warnings": c.eligible and bool(warned),
                "conflicts": "overlapping_shift" in c.blockers}[filter]
    shaped = [{**c.as_dict(), "name": names.get(c.user_id, "")} for c in ranked if keep(c)]
    return {"data": shaped, "meta": {
        "gap_version": gap["version"], "total": len(ranked), "eligible": sum(1 for c in ranked if c.eligible),
        "availability_source": "submitted", "truncated": capped}}


@router.post("/gaps/{gap_id}/offers")
async def create_offer(gap_id: str, body: OfferShiftRequest, current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES))):
    """Ask an employee to take the shift. They are NOT scheduled and are NOT notified by this call."""
    hotel_id = current_user.hotel_id
    departments = load_departments(hotel_id)
    gap = _managed_gap(current_user, gap_id, departments)
    _must_be_actionable(gap)
    if int(gap["version"]) != body.expected_version:
        raise store.version_conflict("coverage gap", fill.full_gap(hotel_id, gap_id))
    fill.require_eligible(hotel_id, gap, str(body.user_id), departments, acknowledge=True)  # warnings are shown before the offer
    now = store.now_utc()
    starts = fill.gap_occurrence(gap).starts_at
    expires = offer_expiry(now, starts if starts > now else fill.gap_occurrence(gap).ends_at, body.expires_in_minutes)
    row = {"tenant_id": hotel_id, "gap_id": gap_id, "user_id": str(body.user_id), "status": "pending",
           "expires_at": expires.isoformat(), "offered_by": current_user.user_id, "delivery": "not_sent", "version": 1}
    try:
        # ONE transaction (migration 229): the gap is locked and version-checked, the offer is inserted and the gap moves
        # open -> offered together. A lost race therefore leaves no offer behind (and no message to take back).
        made = supabase.rpc("create_coverage_offer", {
            "p_tenant_id": hotel_id, "p_gap_id": gap_id, "p_expected_version": body.expected_version, "p_user_id": str(body.user_id),
            "p_offered_by": current_user.user_id, "p_expires_at": row["expires_at"],
        }).execute().data
        offer = made[0] if isinstance(made, list) and made else made
    except Exception as exc:
        code = getattr(exc, "code", None) or ""
        if code == "CV001":
            raise store.version_conflict("coverage gap", fill.full_gap(hotel_id, gap_id))
        if code == "CV002":
            raise err(409, "gap_not_fillable", "This shift was just filled or closed by someone else.", current=store.load_gap(hotel_id, gap_id))
        if code == "CV003":
            raise err(404, "gap_not_found", "Coverage gap not found")
        if store.is_unique_violation(exc):
            raise err(409, "duplicate_offer", "That employee already has a pending offer for this shift.")
        raise
    record_audit(current_user, resource_type="coverage_offer", resource_id=str(offer["id"]), action="created",
                 new_state={"gap_id": gap_id, "user_id": str(body.user_id), "status": "pending", "delivery": "not_sent"})
    # The employee's "offer received" message is queued by migration 229's trigger inside the offer insert's transaction.
    if gap["status"] == "open":
        record_audit(current_user, resource_type="coverage_gap", resource_id=gap_id, action="offered",
                     old_state={"status": "open"}, new_state={"status": "offered"})
    return {"data": fill.full_gap(hotel_id, gap_id), "meta": {"offer_id": offer["id"], "delivered": False}}


@router.post("/gaps/{gap_id}/offers/{offer_id}/withdraw")
async def withdraw_offer(gap_id: str, offer_id: str, current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES))):
    hotel_id = current_user.hotel_id
    _managed_gap(current_user, gap_id)
    found = supabase.table("coverage_offers").select("*").eq("tenant_id", hotel_id).eq("gap_id", gap_id).eq("id", offer_id).maybe_single().execute()
    offer = found.data if found else None
    if not offer:
        raise err(404, "offer_not_found", "Offer not found")
    problem = transition_error("coverage_offer", offer["status"], "withdrawn", actor_kind(True))
    if problem:
        raise err(409, "offer_not_withdrawable", f"This offer is already {offer['status']}.", current=offer)
    saved = store.cas_update("coverage_offers", hotel_id, offer_id, int(offer.get("version") or 1), {"status": "withdrawn"})
    if saved is None:
        raise store.version_conflict("offer", offer)
    record_audit(current_user, resource_type="coverage_offer", resource_id=offer_id, action="withdrawn",
                 old_state={"status": "pending"}, new_state={"status": "withdrawn"})
    # The employee's "withdrawn" message is queued by migration 229's trigger in the status update's transaction.
    fill.reopen_if_idle(hotel_id, gap_id)
    return {"data": fill.full_gap(hotel_id, gap_id)}


@router.post("/gaps/{gap_id}/assign")
async def assign_gap(gap_id: str, body: AssignGapRequest, current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES))):
    """Direct assignment by an authorised supervisor: re-checks eligibility, then fills the gap atomically."""
    hotel_id = current_user.hotel_id
    departments = load_departments(hotel_id)
    gap = _managed_gap(current_user, gap_id, departments)
    _must_be_actionable(gap)
    if int(gap["version"]) != body.expected_version:
        raise store.version_conflict("coverage gap", fill.full_gap(hotel_id, gap_id))
    fill.require_eligible(hotel_id, gap, str(body.user_id), departments, acknowledge=body.acknowledge_warnings)
    result = fill.commit_fill(current_user, gap, str(body.user_id), resolution="direct_assignment",
                              expected_version=body.expected_version, notes=body.notes)
    return {"data": fill.full_gap(hotel_id, gap_id), "meta": {"assignment_id": result["assignment_id"]}}


@router.post("/gaps/{gap_id}/waive")
async def waive_gap(gap_id: str, body: WaiveGapRequest, current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES))):
    """Decide the shift will not be covered (or, for an open shift, cancel it). A reason is required and audited."""
    hotel_id = current_user.hotel_id
    gap = _managed_gap(current_user, gap_id)
    problem = transition_error("coverage_gap", gap["status"], "waived", actor_kind(True), body.reason)
    if problem:
        raise err(409, "gap_not_waivable", "This shift is already resolved.", current=gap)
    resolution = "cancelled" if gap["source"] == "open_shift" else "waived"
    saved = store.cas_update("coverage_gaps", hotel_id, gap_id, body.expected_version, {
        "status": "waived", "resolution": resolution, "resolution_reason": body.reason,
        "resolved_by": current_user.user_id, "resolved_at": store.now_utc().isoformat()})
    if saved is None:
        raise store.version_conflict("coverage gap", fill.full_gap(hotel_id, gap_id))
    now = store.now_utc().isoformat()
    supabase.table("coverage_offers").update({"status": "withdrawn", "updated_at": now}).eq("tenant_id", hotel_id).eq("gap_id", gap_id).eq("status", "pending").execute()
    supabase.table("coverage_claims").update({"status": "declined", "decision_reason": body.reason, "decided_by": current_user.user_id, "decided_at": now, "updated_at": now}).eq("tenant_id", hotel_id).eq("gap_id", gap_id).eq("status", "pending").execute()
    record_audit(current_user, resource_type="coverage_gap", resource_id=gap_id, action="waived" if resolution == "waived" else "cancelled",
                 old_state={"status": gap["status"]}, new_state={"status": "waived", "resolution": resolution}, reason_note=body.reason)
    return {"data": fill.full_gap(hotel_id, gap_id)}
