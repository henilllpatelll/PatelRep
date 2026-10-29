"""Time-off requests: an employee asks, a supervisor in their department decides.

PENDING CHANGES NOTHING. Submitting a request never touches a shift. APPROVING one records the decision and turns the window
into a restriction (no new shift can be placed on that person inside it; migration 227's trigger refuses it for every write
path) but it NEVER deletes, moves or cancels a shift the person already holds. Those shifts stay on the schedule and are listed
as `impact` -- unresolved until a supervisor covers, reassigns or cancels them through shift management / coverage. The API
never says a schedule is "resolved" before that has actually happened.

PRIVACY. A request (and its note) is visible to its owner and to supervisors whose department covers the owner; everyone else
gets a 404. The reason is a coarse category so no one has to describe a health matter.

CONCURRENCY. Every decision is a compare-and-set on `version` AND the status it was made for, so two supervisors cannot both
win, an approve cannot land on a request the employee just withdrew, and a stale screen gets a 409 with the current record.
"""
import logging
from datetime import date, datetime

from fastapi import APIRouter, Depends
from postgrest.exceptions import APIError

from core.database import supabase
from core.roles import ALL_ROLES, GM_ONLY_ROLES, SCHEDULE_MANAGER_ROLES
from middleware.auth import CurrentUser, require_role
from models.leave_requests import CancelRequest, CreateTimeOffRequest, DecideTimeOffRequest
from routers.scheduling import _existing_rows, _occurrence
from services import coverage_store as store
from services.request_common import in_manager_scope, not_found, person, shift_brief, timeline
from services.scheduling import parse_clock
from services.scheduling_access import (
    err,
    hotel_today,
    hotel_zone,
    load_departments,
    load_staff,
    record_audit,
)
from services.scheduling_availability import leave_error, leave_window, shifts_overlapping
from services.scheduling_coverage import actor_kind, transition_error

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/schedules", tags=["scheduling-leave"])

LIVE = ("pending", "approved")
RESOLVED_GAP = ("filled", "waived")


def shape_leave(row: dict, people: dict[str, dict]) -> dict:
    keys = ("id", "department_id", "start_date", "end_date", "partial", "start_time", "end_time", "starts_at", "ends_at",
            "reason_category", "note", "status", "decision_reason", "cancel_reason", "decided_at", "cancelled_at", "version", "created_at")
    return {**{k: row.get(k) for k in keys}, "user": people.get(str(row["user_id"])) or {"id": str(row["user_id"]), "name": None, "role": None},
            "decided_by": people.get(str(row["decided_by"])) if row.get("decided_by") else None}


def load_leave(hotel_id: str, request_id: str) -> dict:
    found = supabase.table("time_off_requests").select("*").eq("tenant_id", hotel_id).eq("id", request_id).maybe_single().execute()
    if not found or not found.data:
        raise not_found("Time-off request", "request_not_found")
    return found.data


def access_for(current_user: CurrentUser, row: dict, departments=None) -> tuple[bool, bool]:
    """(is_self, is_manager). Neither = the caller may not know this request exists."""
    is_self = str(row["user_id"]) == current_user.user_id
    is_manager = False
    if current_user.role in SCHEDULE_MANAGER_ROLES:
        departments = departments or load_departments(current_user.hotel_id)
        department = row.get("department_id")
        if department is None:
            member = load_staff(current_user.hotel_id, departments, [str(row["user_id"])]).get(str(row["user_id"]))
            department = member.department_id if member else None
        is_manager = in_manager_scope(current_user, department, departments)
    return is_self, is_manager


def impact_of(hotel_id: str, row: dict) -> dict:
    """
    The staffing consequence of this leave, from the REAL schedule: the person's published shifts inside the window, whether
    each is full or partial overlap, and whether coverage has dealt with it. Nothing is estimated; an unreadable schedule is
    `verified: false`, never an empty list.
    """
    try:
        window = (datetime.fromisoformat(str(row["starts_at"]).replace("Z", "+00:00")),
                  datetime.fromisoformat(str(row["ends_at"]).replace("Z", "+00:00")))
        low, high = date.fromisoformat(str(row["start_date"])[:10]), date.fromisoformat(str(row["end_date"])[:10])
        rows = [r for r in _existing_rows(hotel_id, [str(row["user_id"])], low, high) if str(r["user_id"]) == str(row["user_id"])]
        hits = shifts_overlapping(window, rows)
        gaps: dict[str, dict] = {}
        if hits:
            found = (supabase.table("coverage_gaps").select("id, original_assignment_id, status, filled_user_id, resolution")
                     .eq("tenant_id", hotel_id).in_("original_assignment_id", [str(r["id"]) for r in hits]).execute().data or [])
            gaps = {str(g["original_assignment_id"]): g for g in found}
        filled = {str(g["filled_user_id"]) for g in gaps.values() if g.get("filled_user_id")}
        names = person(hotel_id, filled)
    except Exception:
        logger.warning("leave impact: schedule read failed hotel_id=%s request=%s", hotel_id, row.get("id"))
        return {"verified": False, "reason": "schedule_unavailable", "shifts": [], "shift_count": None, "unresolved_count": None}
    shifts, unresolved = [], 0
    for hit in hits:
        occ = _occurrence(hit)
        gap = gaps.get(str(hit["id"]))
        covered = bool(gap and gap["status"] in RESOLVED_GAP)
        unresolved += 0 if covered else 1
        shifts.append({
            **shift_brief(hit),
            "overlap": "full" if occ and window[0] <= occ.starts_at and occ.ends_at <= window[1] else "partial",
            "coverage": ({"gap_id": gap["id"], "status": gap["status"], "resolution": gap.get("resolution"),
                          "replacement": names.get(str(gap.get("filled_user_id") or ""))} if gap else None),
            "resolved": covered,
        })
    return {"verified": True, "reason": None, "shifts": shifts, "shift_count": len(shifts), "unresolved_count": unresolved}


def can_flags(row: dict, *, is_self: bool, is_manager: bool, now: datetime, own_request_blocks_decision: bool) -> dict:
    ended = datetime.fromisoformat(str(row["ends_at"]).replace("Z", "+00:00")) <= now
    actors = actor_kind(is_manager, is_self)
    status = row["status"]
    decide_ok = is_manager and not own_request_blocks_decision and not ended
    return {
        "approve": decide_ok and transition_error("time_off_request", status, "approved", actors) is None,
        "deny": decide_ok and transition_error("time_off_request", status, "denied", actors, "x") is None,
        "cancel": not ended and transition_error("time_off_request", status, "cancelled", actors, "x") is None,
        "cancel_needs_reason": status == "approved",
    }


def full_leave(current_user: CurrentUser, row: dict, *, is_self: bool, is_manager: bool) -> dict:
    hotel_id = current_user.hotel_id
    ids = [str(row["user_id"])] + ([str(row["decided_by"])] if row.get("decided_by") else [])
    staff = load_staff(hotel_id, load_departments(hotel_id), ids)
    shaped = shape_leave(row, person(hotel_id, ids, staff))
    blocks = is_self and current_user.role not in GM_ONLY_ROLES   # nobody decides their own request (a GM has no one above them)
    shaped["impact"] = impact_of(hotel_id, row)
    shaped["can"] = can_flags(row, is_self=is_self, is_manager=is_manager, now=store.now_utc(), own_request_blocks_decision=blocks)
    shaped["timeline"] = timeline(hotel_id, "time_off_request", [str(row["id"])])
    shaped["viewer"] = "manager" if is_manager else "self"
    return shaped


# ---------------------------------------------------------------------------
# Employee: submit
# ---------------------------------------------------------------------------

@router.post("/me/time-off")
async def create_time_off(body: CreateTimeOffRequest, current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    """
    Submit a request for the signed-in employee (never for anyone else: the person comes from the session). The request is
    PENDING; it changes no shift. A repeat with the same idempotency key returns the original request.
    """
    hotel_id, user_id = current_user.hotel_id, current_user.user_id
    departments = load_departments(hotel_id)
    member = load_staff(hotel_id, departments, [user_id]).get(user_id)
    if member is None:
        raise err(403, "not_active_staff", "Only active staff of this hotel can request time off.")
    if body.idempotency_key:
        prior = (supabase.table("time_off_requests").select("*").eq("tenant_id", hotel_id).eq("user_id", user_id)
                 .eq("idempotency_key", body.idempotency_key).maybe_single().execute())
        if prior and prior.data:
            return {"data": full_leave(current_user, prior.data, is_self=True, is_manager=False), "meta": {"replayed": True}}
    start_t, end_t = parse_clock(body.start_time) if body.start_time else None, parse_clock(body.end_time) if body.end_time else None
    if (body.start_time and start_t is None) or (body.end_time and end_t is None):
        raise err(422, "invalid_time", "Times must look like 09:00.")
    zone = hotel_zone(hotel_id)
    problem = leave_error(body.start_date, body.end_date, hotel_today(zone), partial=body.partial, start_time=start_t, end_time=end_t)
    if problem:
        raise err(422, problem, {
            "end_before_start": "The end date is before the start date.", "dates_in_past": "That time off is already over.",
            "range_too_long": "Time off can cover at most 60 days in one request.", "partial_must_be_one_day": "A partial day covers a single date.",
            "invalid_partial_times": "Enter different start and end times.", "times_need_partial": "Times only apply to a partial day.",
        }[problem])
    starts, ends = leave_window(body.start_date, body.end_date, zone, partial=body.partial, start_time=start_t, end_time=end_t)
    row = {
        "tenant_id": hotel_id, "user_id": user_id, "department_id": member.department_id, "start_date": body.start_date.isoformat(),
        "end_date": body.end_date.isoformat(), "partial": body.partial,
        "start_time": start_t.strftime("%H:%M:%S") if start_t else None, "end_time": end_t.strftime("%H:%M:%S") if end_t else None,
        "starts_at": starts.isoformat(), "ends_at": ends.isoformat(), "reason_category": body.reason_category, "note": body.note,
        "status": "pending", "idempotency_key": body.idempotency_key, "version": 1,
    }
    try:
        saved = store.insert_row("time_off_requests", row)
    except APIError as exc:
        code = getattr(exc, "code", None) or ""
        if code == "23P01":
            clash = (supabase.table("time_off_requests").select("id, start_date, end_date, status").eq("tenant_id", hotel_id)
                     .eq("user_id", user_id).in_("status", list(LIVE)).lt("starts_at", ends.isoformat()).gt("ends_at", starts.isoformat())
                     .execute().data or [])
            raise err(409, "leave_overlap", "You already have time off requested or approved for part of those dates.", conflicts=clash)
        if code == "23505" and body.idempotency_key:
            again = (supabase.table("time_off_requests").select("*").eq("tenant_id", hotel_id).eq("user_id", user_id)
                     .eq("idempotency_key", body.idempotency_key).maybe_single().execute())
            if again and again.data:
                return {"data": full_leave(current_user, again.data, is_self=True, is_manager=False), "meta": {"replayed": True}}
        raise
    record_audit(current_user, resource_type="time_off_request", resource_id=str(saved["id"]), action="created",
                 new_state={"status": "pending", "start_date": row["start_date"], "end_date": row["end_date"], "partial": body.partial})
    return {"data": full_leave(current_user, saved, is_self=True, is_manager=False), "meta": {"replayed": False}}


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

@router.get("/time-off/{request_id}")
async def get_time_off(request_id: str, current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    row = load_leave(current_user.hotel_id, request_id)
    is_self, is_manager = access_for(current_user, row)
    if not (is_self or is_manager):
        raise not_found("Time-off request", "request_not_found")
    return {"data": full_leave(current_user, row, is_self=is_self, is_manager=is_manager)}


@router.get("/time-off/{request_id}/history")
async def time_off_history(request_id: str, current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    row = load_leave(current_user.hotel_id, request_id)
    is_self, is_manager = access_for(current_user, row)
    if not (is_self or is_manager):
        raise not_found("Time-off request", "request_not_found")
    return {"data": timeline(current_user.hotel_id, "time_off_request", [request_id])}


# ---------------------------------------------------------------------------
# Decide / cancel
# ---------------------------------------------------------------------------

def _stale(hotel_id: str, request_id: str, wanted: str) -> Exception:
    latest = load_leave(hotel_id, request_id)
    if latest["status"] != wanted:
        return err(409, "request_not_pending", f"This request is already {latest['status']}. Reload to see the latest.", current_status=latest["status"], current_version=latest["version"])
    return store.version_conflict("time-off request", {"id": latest["id"], "status": latest["status"], "version": latest["version"]})


def _decide(current_user: CurrentUser, request_id: str, body, *, target: str):
    hotel_id = current_user.hotel_id
    row = load_leave(hotel_id, request_id)
    is_self, is_manager = access_for(current_user, row)
    if not is_manager:
        raise not_found("Time-off request", "request_not_found")  # an employee who is not in scope cannot tell it exists
    if is_self and current_user.role not in GM_ONLY_ROLES:
        raise err(403, "cannot_decide_own", "You cannot decide your own time-off request.")
    reason = (body.reason or "").strip() or None
    # Replay: the same decision by the same person on the version they sent is a success, not a conflict.
    if row["status"] == target and str(row.get("decided_by")) == current_user.user_id and int(row["version"]) == body.expected_version + 1:
        return row, True, is_self, is_manager
    problem = transition_error("time_off_request", row["status"], target, actor_kind(True), reason)
    if problem == "reason_required":
        raise err(422, "reason_required", "Say why you are denying this request.")
    if problem:
        raise _stale(hotel_id, request_id, "pending")
    if datetime.fromisoformat(str(row["ends_at"]).replace("Z", "+00:00")) <= store.now_utc():
        raise err(409, "leave_over", "That time off has already passed, so it can no longer be decided.")
    patch = {"status": target, "decided_by": current_user.user_id, "decided_at": store.now_utc().isoformat(),
             "decision_reason": reason}
    try:
        saved = store.cas_update("time_off_requests", hotel_id, request_id, body.expected_version, patch, where={"status": "pending"})
    except APIError as exc:
        if (getattr(exc, "code", None) or "") == "23P01":
            raise err(409, "leave_overlap", "Approving this would overlap other approved or pending time off for the same person.")
        raise
    if saved is None:
        raise _stale(hotel_id, request_id, "pending")
    record_audit(current_user, resource_type="time_off_request", resource_id=request_id, action=target,
                 old_state={"status": "pending"}, new_state={"status": target}, reason_note=reason)
    return saved, False, is_self, is_manager


@router.post("/time-off/{request_id}/approve")
async def approve_time_off(request_id: str, body: DecideTimeOffRequest, current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES))):
    """
    Approve. Revalidated on the server against the CURRENT status and version. Approval does not touch any shift: `data.impact`
    lists the person's shifts inside the window and which are still unresolved, so the supervisor can act on them next.
    """
    saved, replayed, is_self, is_manager = _decide(current_user, request_id, body, target="approved")
    data = full_leave(current_user, saved, is_self=is_self, is_manager=is_manager)
    return {"data": data, "meta": {"replayed": replayed, "follow_up_required": bool((data["impact"].get("unresolved_count") or 0) > 0)}}


@router.post("/time-off/{request_id}/deny")
async def deny_time_off(request_id: str, body: DecideTimeOffRequest, current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES))):
    saved, replayed, is_self, is_manager = _decide(current_user, request_id, body, target="denied")
    return {"data": full_leave(current_user, saved, is_self=is_self, is_manager=is_manager), "meta": {"replayed": replayed}}


@router.post("/time-off/{request_id}/cancel")
async def cancel_time_off(request_id: str, body: CancelRequest, current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    """
    Withdraw (pending, by the employee) or cancel (approved, by the employee or a supervisor, with a reason). Cancelling
    approved leave never restores shifts that were covered or cancelled while it was in force: `impact` shows any that need review.
    """
    hotel_id = current_user.hotel_id
    row = load_leave(hotel_id, request_id)
    is_self, is_manager = access_for(current_user, row)
    if not (is_self or is_manager):
        raise not_found("Time-off request", "request_not_found")
    reason = (body.reason or "").strip() or None
    if row["status"] == "cancelled" and str(row.get("cancelled_by")) == current_user.user_id and int(row["version"]) == body.expected_version + 1:
        return {"data": full_leave(current_user, row, is_self=is_self, is_manager=is_manager), "meta": {"replayed": True}}
    problem = transition_error("time_off_request", row["status"], "cancelled", actor_kind(is_manager, is_self), reason)
    if problem == "reason_required":
        raise err(422, "reason_required", "Say why you are cancelling approved time off.")
    if problem:
        raise err(409, "request_not_cancellable", f"This request is {row['status']} and cannot be cancelled by you.", current_status=row["status"])
    if datetime.fromisoformat(str(row["ends_at"]).replace("Z", "+00:00")) <= store.now_utc():
        raise err(409, "leave_over", "That time off has already passed.")
    saved = store.cas_update("time_off_requests", hotel_id, request_id, body.expected_version, {
        "status": "cancelled", "cancelled_by": current_user.user_id, "cancelled_at": store.now_utc().isoformat(), "cancel_reason": reason,
    }, where={"status": row["status"]})
    if saved is None:
        raise _stale(hotel_id, request_id, row["status"])
    record_audit(current_user, resource_type="time_off_request", resource_id=request_id, action="cancelled",
                 old_state={"status": row["status"]}, new_state={"status": "cancelled"}, reason_note=reason)
    return {"data": full_leave(current_user, saved, is_self=is_self, is_manager=is_manager), "meta": {"replayed": False, "was": row["status"]}}
