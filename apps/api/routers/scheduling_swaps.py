"""Shift swaps: a TWO-WAY exchange of shifts between two employees, finalised only by a supervisor.

    proposed --(coworker accepts)--> accepted --(supervisor approves)--> approved
         |  \\--declines / lapses / withdrawn                \\--denies (reason)

NOT AN OPEN-SHIFT CLAIM. A swap exchanges two published shifts that BOTH people hold; offering an uncovered shift for someone
to take is a coverage offer/claim (routers/scheduling_coverage.py, scheduling_requests.py) and is a different thing.

ACCEPTANCE IS NOT APPROVAL. The coworker saying yes changes no schedule. Only POST /swaps/{id}/approve does, through the
database function approve_shift_swap() (migration 227): it locks the request and BOTH shifts, re-validates both people and both
shift versions, exchanges the two assignments, settles the request and writes the audit rows in ONE transaction. If anything
fails neither person's schedule has changed. There are never two independent client updates.

PRIVACY. Participants see the minimum needed to decide: the two shifts (date, name, times) and each other's name/role. They never
see each other's availability, leave or notes. Supervisors see the full analysis for their own departments; everyone else gets a 404.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from postgrest.exceptions import APIError

from core.database import supabase
from core.roles import ALL_ROLES, GM_ONLY_ROLES, SCHEDULE_MANAGER_ROLES
from middleware.auth import CurrentUser, require_role
from models.leave_requests import CancelRequest, CreateSwapRequest, DecideSwapRequest, RespondSwapRequest
from routers.scheduling import ASSIGNMENT_COLUMNS, _existing_rows, _occurrence
from services import coverage_store as store
from services.availability_store import load_contexts
from services.request_common import in_manager_scope, not_found, person, shift_brief, timeline
from services.scheduling import Occurrence, compute_warnings, find_conflicts
from services.scheduling_access import err, hotel_today, hotel_zone, load_departments, load_staff, record_audit
from services.scheduling_availability import (
    ACK_AVAILABILITY_WARNINGS,
    AVAILABILITY_UNKNOWN,
    assess_window,
    effective_swap_status,
    swap_expiry,
    swap_problem,
)
from services.scheduling_coverage import actor_kind, transition_error

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/schedules", tags=["scheduling-swaps"])

SWAP_WINDOW_DAYS = 14        # how far around their own shift a coworker's shift is offered as a swap
OPTION_CAP = 60
LIVE = ("proposed", "accepted")
ACK_WARNINGS = frozenset({"insufficient_rest", "weekly_overtime", "long_shift"}) | ACK_AVAILABILITY_WARNINGS
SW_ERRORS = {
    "SW002": (409, "swap_not_approvable", "This swap is not waiting for a decision."),
    "SW004": (409, "shift_missing", "One of the shifts no longer exists."),
    "SW005": (409, "shift_changed", "One of the shifts changed after both people agreed. Ask for a new swap."),
    "SW006": (409, "shift_started", "One of the shifts has already started."),
    "SW007": (409, "employee_inactive", "One of the employees is no longer active."),
    "SW008": (409, "different_departments", "The shifts belong to different departments."),
    "SW009": (409, "shifts_overlap", "The two shifts overlap each other, so they cannot be exchanged."),
    "SW010": (409, "shift_has_callout", "One of the shifts has a call-out on file. Resolve coverage first."),
    "SW011": (409, "shift_in_live_swap", "One of these shifts is already part of another swap request."),
    "TO001": (409, "approved_time_off", "One of the employees has approved time off during the shift they would receive."),
}


# ---------------------------------------------------------------------------
# Loading and shaping
# ---------------------------------------------------------------------------

def load_swap(hotel_id: str, swap_id: str) -> dict:
    found = supabase.table("shift_swap_requests").select("*").eq("tenant_id", hotel_id).eq("id", swap_id).maybe_single().execute()
    if not found or not found.data:
        raise not_found("Swap request", "swap_not_found")
    return found.data


def _shift_rows(hotel_id: str, ids: list[str]) -> dict[str, dict]:
    rows = supabase.table("shift_assignments").select(ASSIGNMENT_COLUMNS).eq("tenant_id", hotel_id).in_("id", ids).execute().data or []
    return {str(r["id"]): r for r in rows}


def access_for(current_user: CurrentUser, swap: dict, departments=None) -> tuple[bool, bool, bool]:
    """(is_requester, is_counterpart, is_manager)."""
    is_req = str(swap["requester_id"]) == current_user.user_id
    is_cp = str(swap["counterpart_id"]) == current_user.user_id
    is_manager = False
    if current_user.role in SCHEDULE_MANAGER_ROLES:
        is_manager = in_manager_scope(current_user, swap.get("department_id"), departments or load_departments(current_user.hotel_id))
    return is_req, is_cp, is_manager


def _incoming(row: dict, receiver: str) -> Optional[Occurrence]:
    occ = _occurrence(row)
    return Occurrence(receiver, occ.shift_id, occ.work_date, occ.starts_at, occ.ends_at, occ.id) if occ else None


def analyse(hotel_id: str, swap: dict, a: dict, b: dict, zone, now: datetime, staff: dict) -> dict:
    """
    Would exchanging shift `a` (requester's) and `b` (counterpart's) be valid RIGHT NOW? Hard problems are `blockers` (the
    exchange must not happen); `warnings` are advisory (a supervisor acknowledges them). Both people are judged on the shift they
    would RECEIVE, ignoring the one they would give up. Every code is data a screen can translate; nothing is invented.
    """
    blockers: list[dict] = []
    warnings: list[dict] = []
    requester, counterpart = str(swap["requester_id"]), str(swap["counterpart_id"])
    for uid in (requester, counterpart):
        if uid not in staff:
            blockers.append({"code": "employee_inactive", "user_id": uid})
    problem = swap_problem(a, b, now) if now else None
    if problem:
        blockers.append({"code": problem, "user_id": None})
    if swap.get("requester_assignment_version") is not None and (
        a.get("version") != swap["requester_assignment_version"] or b.get("version") != swap["counterpart_assignment_version"]
        or str(a["user_id"]) != requester or str(b["user_id"]) != counterpart
    ):
        blockers.append({"code": "shift_changed", "user_id": None})
    occ_a, occ_b = _incoming(a, counterpart), _incoming(b, requester)    # counterpart receives a, requester receives b
    if occ_a is None or occ_b is None:
        return {"blockers": blockers + [{"code": "shift_times_unknown", "user_id": None}], "warnings": warnings}
    low = min(occ_a.work_date, occ_b.work_date)
    high = max(occ_a.work_date, occ_b.work_date)
    stored = _existing_rows(hotel_id, [requester, counterpart], low, high)
    try:
        contexts = load_contexts(hotel_id, [requester, counterpart], min(occ_a.starts_at, occ_b.starts_at), max(occ_a.ends_at, occ_b.ends_at))
    except Exception:
        logger.warning("swap analysis: availability read failed hotel_id=%s", hotel_id)
        contexts = None
    today = hotel_today(zone)
    for receiver, incoming, giving in ((counterpart, occ_a, b), (requester, occ_b, a)):
        others = [o for o in (_occurrence(r) for r in stored if str(r["user_id"]) == receiver and str(r["id"]) != str(giving["id"]))
                  if o is not None]
        if find_conflicts([incoming], others):
            blockers.append({"code": "overlapping_shift", "user_id": receiver})
        for w in compute_warnings([incoming], others, hotel_today=today):
            (blockers if w.severity == "block" else warnings).append({"code": w.code, "user_id": receiver})
        if contexts is not None:
            ctx = contexts[receiver]
            verdict = assess_window(incoming.starts_at, incoming.ends_at, weekly=ctx.weekly, exceptions=ctx.exceptions, leave=ctx.leave, zone=zone)
            blockers += [{"code": c, "user_id": receiver} for c in verdict.blockers]
            warnings += [{"code": c, "user_id": receiver} for c in verdict.warnings if c != AVAILABILITY_UNKNOWN]
    return {"blockers": blockers, "warnings": warnings}


def shape_swap(swap: dict, people: dict[str, dict], shifts: dict[str, dict], now: datetime) -> dict:
    a, b = shifts.get(str(swap["requester_assignment_id"])), shifts.get(str(swap["counterpart_assignment_id"]))
    keys = ("id", "department_id", "note", "response_note", "decision_reason", "cancel_reason", "expires_at", "responded_at",
            "decided_at", "version", "created_at")
    return {
        **{k: swap.get(k) for k in keys},
        "status": effective_swap_status(swap, now), "stored_status": swap["status"],
        "requester": people.get(str(swap["requester_id"])), "counterpart": people.get(str(swap["counterpart_id"])),
        "requester_shift": shift_brief(a) if a else None, "counterpart_shift": shift_brief(b) if b else None,
        "decided_by": people.get(str(swap["decided_by"])) if swap.get("decided_by") else None,
    }


def full_swap(current_user: CurrentUser, swap: dict, *, with_history: bool = True) -> dict:
    hotel_id = current_user.hotel_id
    departments = load_departments(hotel_id)
    is_req, is_cp, is_manager = access_for(current_user, swap, departments)
    now = store.now_utc()
    ids = [str(swap["requester_id"]), str(swap["counterpart_id"])] + ([str(swap["decided_by"])] if swap.get("decided_by") else [])
    staff = load_staff(hotel_id, departments, ids)
    shifts = _shift_rows(hotel_id, [str(swap["requester_assignment_id"]), str(swap["counterpart_assignment_id"])])
    shaped = shape_swap(swap, person(hotel_id, ids, staff), shifts, now)
    state = shaped["status"]
    shaped["analysis"] = None
    if state in LIVE and len(shifts) == 2:
        zone = hotel_zone(hotel_id)
        shaped["analysis"] = analyse(hotel_id, swap, shifts[str(swap["requester_assignment_id"])], shifts[str(swap["counterpart_assignment_id"])],
                                     zone, now, staff)
    own_swap = (is_req or is_cp) and current_user.role not in GM_ONLY_ROLES
    actors = actor_kind(is_manager, is_req or is_cp)
    shaped["can"] = {
        "respond": is_cp and state == "proposed",
        "cancel": (is_req and state in LIVE) or (is_cp and state == "accepted"),
        "approve": is_manager and not own_swap and state == "accepted" and transition_error("shift_swap", "accepted", "approved", actors) is None,
        "deny": is_manager and not own_swap and state == "accepted" and transition_error("shift_swap", "accepted", "denied", actors, "x") is None,
    }
    shaped["viewer"] = "manager" if is_manager and not (is_req or is_cp) else ("requester" if is_req else ("counterpart" if is_cp else "manager"))
    if with_history:
        shaped["timeline"] = timeline(hotel_id, "shift_swap", [str(swap["id"])])
    return shaped


def _guard_change(current_user: CurrentUser, swap_id: str, wanted: str) -> Exception:
    latest = load_swap(current_user.hotel_id, swap_id)
    if latest["status"] != wanted:
        return err(409, "swap_not_" + wanted, f"This swap is already {latest['status']}. Reload to see the latest.", current_status=latest["status"], current_version=latest["version"])
    return store.version_conflict("swap request", {"id": latest["id"], "status": latest["status"], "version": latest["version"]})


# ---------------------------------------------------------------------------
# Employee: options, propose, list
# ---------------------------------------------------------------------------

def _own_shift(current_user: CurrentUser, assignment_id: str) -> dict:
    rows = _shift_rows(current_user.hotel_id, [assignment_id])
    row = rows.get(assignment_id)
    if not row or str(row["user_id"]) != current_user.user_id:
        raise not_found("Shift", "assignment_not_found")  # someone else's shift is not yours to swap, or to know about
    return row


def _live_swap_ids(hotel_id: str, assignment_ids: list[str]) -> set[str]:
    if not assignment_ids:
        return set()
    out: set[str] = set()
    for column in ("requester_assignment_id", "counterpart_assignment_id"):
        for row in supabase.table("shift_swap_requests").select("requester_assignment_id, counterpart_assignment_id").eq("tenant_id", hotel_id).in_("status", list(LIVE)).in_(column, assignment_ids).execute().data or []:
            out |= {str(row["requester_assignment_id"]), str(row["counterpart_assignment_id"])}
    return out


def _callout_ids(hotel_id: str, assignment_ids: list[str]) -> set[str]:
    if not assignment_ids:
        return set()
    rows = (supabase.table("absence_records").select("assignment_id").eq("tenant_id", hotel_id).in_("assignment_id", assignment_ids)
            .in_("status", ["reported", "confirmed", "covered"]).execute().data or [])
    return {str(r["assignment_id"]) for r in rows}


@router.get("/me/swap-options")
async def swap_options(assignment_id: str = Query(...), current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    """
    For ONE of the signed-in employee's own shifts: coworkers' shifts they could exchange it for (same department, published,
    not started, no call-out, no overlap or approved leave for either person). Only name, role and the shift itself are shown.
    """
    hotel_id = current_user.hotel_id
    mine = _own_shift(current_user, assignment_id)
    zone, now = hotel_zone(hotel_id), store.now_utc()
    departments = load_departments(hotel_id)
    staff = load_staff(hotel_id, departments)
    if current_user.user_id not in staff:
        raise err(403, "not_active_staff", "Only active staff can swap shifts.")
    occ = _occurrence(mine)
    if occ is None:
        return {"data": [], "meta": {"reason": "shift_times_unknown"}}
    low, high = occ.work_date - timedelta(days=SWAP_WINDOW_DAYS), occ.work_date + timedelta(days=SWAP_WINDOW_DAYS)
    pool = (supabase.table("shift_assignments").select(ASSIGNMENT_COLUMNS).eq("tenant_id", hotel_id).eq("department_id", str(mine["department_id"]))
            .neq("publication_state", "cancelled").neq("user_id", current_user.user_id)
            .gte("work_date", max(low, hotel_today(zone)).isoformat()).lte("work_date", high.isoformat()).limit(2000).execute().data or [])
    pool = [r for r in pool if str(r["user_id"]) in staff]
    blocked = _live_swap_ids(hotel_id, [str(mine["id"])] + [str(r["id"]) for r in pool]) | _callout_ids(hotel_id, [str(mine["id"])] + [str(r["id"]) for r in pool])
    if str(mine["id"]) in blocked:
        return {"data": [], "meta": {"reason": "shift_unavailable_for_swap"}}
    info = person(hotel_id, {str(r["user_id"]) for r in pool}, staff)
    grouped: dict[str, list[dict]] = {}
    shown = 0
    for row in sorted(pool, key=lambda r: (str(r["work_date"]), str(r["starts_at"]))):
        if str(row["id"]) in blocked or shown >= OPTION_CAP:
            continue
        if swap_problem(mine, row, now):
            continue
        fake = {"requester_id": current_user.user_id, "counterpart_id": str(row["user_id"]),
                "requester_assignment_version": None, "counterpart_assignment_version": None}
        verdict = analyse(hotel_id, fake, mine, row, zone, now, staff)
        if verdict["blockers"]:
            continue
        grouped.setdefault(str(row["user_id"]), []).append({**shift_brief(row), "warnings": sorted({w["code"] for w in verdict["warnings"]})})
        shown += 1
    data = [{"person": info[uid], "shifts": shifts} for uid, shifts in sorted(grouped.items(), key=lambda kv: (info[kv[0]]["name"] or "~").casefold())]
    return {"data": data, "meta": {"my_shift": shift_brief(mine), "count": shown}}


@router.post("/me/swaps")
async def propose_swap(body: CreateSwapRequest, current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    """Propose exchanging MY shift for a coworker's. The requester is the signed-in employee; nothing about the schedule changes yet."""
    hotel_id, me = current_user.hotel_id, current_user.user_id
    if body.idempotency_key:
        prior = (supabase.table("shift_swap_requests").select("*").eq("tenant_id", hotel_id).eq("requester_id", me)
                 .eq("idempotency_key", body.idempotency_key).maybe_single().execute())
        if prior and prior.data:
            return {"data": full_swap(current_user, prior.data), "meta": {"replayed": True}}
    mine = _own_shift(current_user, str(body.requester_assignment_id))
    theirs = _shift_rows(hotel_id, [str(body.counterpart_assignment_id)]).get(str(body.counterpart_assignment_id))
    if not theirs:
        raise not_found("Shift", "assignment_not_found")
    counterpart = str(theirs["user_id"])
    departments = load_departments(hotel_id)
    staff = load_staff(hotel_id, departments, [me, counterpart])
    zone, now = hotel_zone(hotel_id), store.now_utc()
    swap = {"requester_id": me, "counterpart_id": counterpart, "requester_assignment_version": mine.get("version"),
            "counterpart_assignment_version": theirs.get("version"), "department_id": mine.get("department_id")}
    if me not in staff or counterpart not in staff:
        raise err(409, "employee_inactive", "Both employees must be active staff of this hotel.")
    if str(mine["id"]) in _callout_ids(hotel_id, [str(mine["id"]), str(theirs["id"])]) or str(theirs["id"]) in _callout_ids(hotel_id, [str(theirs["id"])]):
        raise err(409, "shift_has_callout", "A shift with a call-out on file cannot be swapped.")
    verdict = analyse(hotel_id, swap, mine, theirs, zone, now, staff)
    if verdict["blockers"]:
        raise err(409, "swap_invalid", "These two shifts cannot be exchanged.", blockers=verdict["blockers"], warnings=verdict["warnings"])
    expiry = swap_expiry(now, _occurrence(mine).starts_at, _occurrence(theirs).starts_at)
    row = {
        "tenant_id": hotel_id, "department_id": mine.get("department_id"), "requester_id": me, "counterpart_id": counterpart,
        "requester_assignment_id": str(mine["id"]), "counterpart_assignment_id": str(theirs["id"]),
        "requester_assignment_version": mine["version"], "counterpart_assignment_version": theirs["version"],
        "status": "proposed", "note": body.note, "expires_at": expiry.isoformat(), "idempotency_key": body.idempotency_key, "version": 1,
    }
    try:
        saved = store.insert_row("shift_swap_requests", row)
    except APIError as exc:
        code = getattr(exc, "code", None) or ""
        if code == "SW011":
            raise err(409, "shift_in_live_swap", "One of these shifts is already part of another swap request.")
        if code == "23505" and body.idempotency_key:
            again = (supabase.table("shift_swap_requests").select("*").eq("tenant_id", hotel_id).eq("requester_id", me)
                     .eq("idempotency_key", body.idempotency_key).maybe_single().execute())
            if again and again.data:
                return {"data": full_swap(current_user, again.data), "meta": {"replayed": True}}
        raise
    record_audit(current_user, resource_type="shift_swap", resource_id=str(saved["id"]), action="proposed",
                 new_state={"status": "proposed", "counterpart_id": counterpart})
    return {"data": full_swap(current_user, saved), "meta": {"replayed": False, "warnings": verdict["warnings"]}}


@router.get("/me/swaps")
async def my_swaps(current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    """Swaps I proposed or was asked to respond to, newest first."""
    hotel_id, me = current_user.hotel_id, current_user.user_id
    rows = {}
    for column in ("requester_id", "counterpart_id"):
        for row in supabase.table("shift_swap_requests").select("*").eq("tenant_id", hotel_id).eq(column, me).order("created_at", desc=True).limit(100).execute().data or []:
            rows[str(row["id"])] = row
    swaps = sorted(rows.values(), key=lambda r: str(r.get("created_at") or ""), reverse=True)[:100]
    return {"data": [full_swap(current_user, s, with_history=False) for s in swaps]}


# ---------------------------------------------------------------------------
# Detail, respond, cancel
# ---------------------------------------------------------------------------

@router.get("/swaps/{swap_id}")
async def get_swap(swap_id: str, current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    swap = load_swap(current_user.hotel_id, swap_id)
    if not any(access_for(current_user, swap)):
        raise not_found("Swap request", "swap_not_found")
    return {"data": full_swap(current_user, swap)}


@router.get("/swaps/{swap_id}/history")
async def swap_history(swap_id: str, current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    swap = load_swap(current_user.hotel_id, swap_id)
    if not any(access_for(current_user, swap)):
        raise not_found("Swap request", "swap_not_found")
    return {"data": timeline(current_user.hotel_id, "shift_swap", [swap_id])}


@router.post("/swaps/{swap_id}/respond")
async def respond_to_swap(swap_id: str, body: RespondSwapRequest, current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    """The coworker accepts or declines. Accepting records willingness only; the schedule does not change until a supervisor approves."""
    hotel_id = current_user.hotel_id
    swap = load_swap(hotel_id, swap_id)
    is_req, is_cp, is_manager = access_for(current_user, swap)
    if not (is_req or is_cp or is_manager):
        raise not_found("Swap request", "swap_not_found")
    if not is_cp:
        raise err(403, "not_counterpart", "Only the coworker who was asked can answer this swap.")
    target = "accepted" if body.accept else "declined"
    if swap["status"] == target and int(swap["version"]) == body.expected_version + 1:
        return {"data": full_swap(current_user, swap), "meta": {"replayed": True}}
    state = effective_swap_status(swap, store.now_utc())
    if state == "expired":
        raise err(409, "swap_expired", "This swap request has expired.", current_status="expired")
    if state != "proposed":
        raise err(409, "swap_not_proposed", f"This swap is already {state}.", current_status=state)
    if body.accept:
        departments = load_departments(hotel_id)
        shifts = _shift_rows(hotel_id, [str(swap["requester_assignment_id"]), str(swap["counterpart_assignment_id"])])
        if len(shifts) != 2:
            raise err(409, "shift_missing", "One of the shifts no longer exists.")
        staff = load_staff(hotel_id, departments, [str(swap["requester_id"]), str(swap["counterpart_id"])])
        verdict = analyse(hotel_id, swap, shifts[str(swap["requester_assignment_id"])], shifts[str(swap["counterpart_assignment_id"])],
                          hotel_zone(hotel_id), store.now_utc(), staff)
        if verdict["blockers"]:
            raise err(409, "swap_invalid", "This swap can no longer go ahead.", blockers=verdict["blockers"])
    note = (body.note or "").strip() or None
    saved = store.cas_update("shift_swap_requests", hotel_id, swap_id, body.expected_version,
                             {"status": target, "responded_at": store.now_utc().isoformat(), "response_note": note}, where={"status": "proposed"})
    if saved is None:
        raise _guard_change(current_user, swap_id, "proposed")
    record_audit(current_user, resource_type="shift_swap", resource_id=swap_id, action=target,
                 old_state={"status": "proposed"}, new_state={"status": target}, reason_note=note)
    return {"data": full_swap(current_user, saved), "meta": {"replayed": False}}


@router.post("/swaps/{swap_id}/cancel")
async def cancel_swap(swap_id: str, body: CancelRequest, current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    """Withdraw a swap before it is approved. The requester may at any live stage; the coworker only after accepting (before that, decline)."""
    hotel_id = current_user.hotel_id
    swap = load_swap(hotel_id, swap_id)
    is_req, is_cp, is_manager = access_for(current_user, swap)
    if not (is_req or is_cp or is_manager):
        raise not_found("Swap request", "swap_not_found")
    if not (is_req or is_cp):
        raise err(403, "not_participant", "Only the two people in this swap can cancel it.")
    if swap["status"] == "cancelled" and str(swap.get("cancelled_by")) == current_user.user_id and int(swap["version"]) == body.expected_version + 1:
        return {"data": full_swap(current_user, swap), "meta": {"replayed": True}}
    state = effective_swap_status(swap, store.now_utc())
    problem = transition_error("shift_swap", state, "cancelled", actor_kind(False, True)) if state in LIVE else "invalid_transition"
    if problem or (is_cp and not is_req and state != "accepted"):
        raise err(409, "swap_not_cancellable", f"This swap is {state} and cannot be cancelled by you.", current_status=state)
    reason = (body.reason or "").strip() or None
    saved = store.cas_update("shift_swap_requests", hotel_id, swap_id, body.expected_version,
                             {"status": "cancelled", "cancelled_by": current_user.user_id, "cancel_reason": reason}, where={"status": swap["status"]})
    if saved is None:
        raise _guard_change(current_user, swap_id, swap["status"])
    record_audit(current_user, resource_type="shift_swap", resource_id=swap_id, action="cancelled",
                 old_state={"status": swap["status"]}, new_state={"status": "cancelled"}, reason_note=reason)
    return {"data": full_swap(current_user, saved), "meta": {"replayed": False}}


# ---------------------------------------------------------------------------
# Supervisor decision
# ---------------------------------------------------------------------------

def _manager_swap(current_user: CurrentUser, swap_id: str) -> dict:
    swap = load_swap(current_user.hotel_id, swap_id)
    is_req, is_cp, is_manager = access_for(current_user, swap)
    if not is_manager:
        raise not_found("Swap request", "swap_not_found")
    if (is_req or is_cp) and current_user.role not in GM_ONLY_ROLES:
        raise err(403, "cannot_decide_own", "You cannot decide a swap you are part of.")
    return swap


@router.post("/swaps/{swap_id}/approve")
async def approve_swap(swap_id: str, body: DecideSwapRequest, current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES))):
    """
    Final approval. Pre-checks give friendly, specific refusals; the database function then re-checks everything under lock and
    exchanges BOTH shifts in one transaction -- there is no state in which only one person's schedule changed.
    """
    hotel_id = current_user.hotel_id
    swap = _manager_swap(current_user, swap_id)
    if swap["status"] == "approved" and str(swap.get("decided_by")) == current_user.user_id and int(swap["version"]) == body.expected_version + 1:
        return {"data": full_swap(current_user, swap), "meta": {"replayed": True}}
    state = effective_swap_status(swap, store.now_utc())
    if state != "accepted":
        raise err(409, "swap_not_approvable", "This swap is not waiting for a supervisor's decision." if state == "proposed"
                  else f"This swap is already {state}.", current_status=state)
    if int(swap["version"]) != body.expected_version:
        raise store.version_conflict("swap request", {"id": swap["id"], "status": swap["status"], "version": swap["version"]})
    departments = load_departments(hotel_id)
    shifts = _shift_rows(hotel_id, [str(swap["requester_assignment_id"]), str(swap["counterpart_assignment_id"])])
    if len(shifts) != 2:
        raise err(409, "shift_missing", "One of the shifts no longer exists.")
    staff = load_staff(hotel_id, departments, [str(swap["requester_id"]), str(swap["counterpart_id"])])
    verdict = analyse(hotel_id, swap, shifts[str(swap["requester_assignment_id"])], shifts[str(swap["counterpart_assignment_id"])],
                      hotel_zone(hotel_id), store.now_utc(), staff)
    if verdict["blockers"]:
        raise err(409, "swap_invalid", "This swap can no longer be approved.", blockers=verdict["blockers"], warnings=verdict["warnings"])
    needs = [w for w in verdict["warnings"] if w["code"] in ACK_WARNINGS]
    if needs and not body.acknowledge_warnings:
        raise err(409, "warnings_need_acknowledgement", "Review the warnings before approving this swap.", warnings=verdict["warnings"])
    note = (body.reason or "").strip() or None
    try:
        supabase.rpc("approve_shift_swap", {
            "p_tenant_id": hotel_id, "p_swap_id": swap_id, "p_expected_version": body.expected_version,
            "p_actor": current_user.user_id, "p_actor_role": current_user.role, "p_note": note,
        }).execute()
    except APIError as exc:
        code = getattr(exc, "code", None) or ""
        if code == "SW001":
            raise store.version_conflict("swap request", {"id": swap["id"], "status": swap["status"], "version": swap["version"]})
        if code == "SW003":
            raise not_found("Swap request", "swap_not_found")
        if code in SW_ERRORS:
            status, short, message = SW_ERRORS[code]
            raise err(status, short, message)
        if code == "23P01" or "overlap" in str(exc).lower():
            raise err(409, "schedule_conflict", "One of the schedules changed at the same moment. Reload and try again.", conflicts=[{"code": "overlapping_shift"}])
        raise
    return {"data": full_swap(current_user, load_swap(hotel_id, swap_id)), "meta": {"replayed": False}}


@router.post("/swaps/{swap_id}/deny")
async def deny_swap(swap_id: str, body: DecideSwapRequest, current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES))):
    hotel_id = current_user.hotel_id
    swap = _manager_swap(current_user, swap_id)
    reason = (body.reason or "").strip() or None
    if swap["status"] == "denied" and str(swap.get("decided_by")) == current_user.user_id and int(swap["version"]) == body.expected_version + 1:
        return {"data": full_swap(current_user, swap), "meta": {"replayed": True}}
    state = effective_swap_status(swap, store.now_utc())
    problem = transition_error("shift_swap", state, "denied", actor_kind(True), reason)
    if problem == "reason_required":
        raise err(422, "reason_required", "Say why you are denying this swap.")
    if problem:
        raise err(409, "swap_not_approvable", f"This swap is {state} and cannot be denied.", current_status=state)
    saved = store.cas_update("shift_swap_requests", hotel_id, swap_id, body.expected_version,
                             {"status": "denied", "decided_by": current_user.user_id, "decided_at": store.now_utc().isoformat(),
                              "decision_reason": reason}, where={"status": "accepted"})
    if saved is None:
        raise _guard_change(current_user, swap_id, "accepted")
    record_audit(current_user, resource_type="shift_swap", resource_id=swap_id, action="denied",
                 old_state={"status": "accepted"}, new_state={"status": "denied"}, reason_note=reason)
    return {"data": full_swap(current_user, saved), "meta": {"replayed": False}}
