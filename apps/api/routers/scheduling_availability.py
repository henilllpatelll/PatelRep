"""Employee availability: employees keep their own, supervisors read their team's.

AVAILABILITY IS EVIDENCE, NOT A PROMISE. What is stored here is what an employee SAYS they can work. It is never
attendance, never approved leave, and a day with nothing submitted is UNKNOWN (not "available"). Saving availability never
edits, moves or deletes a published shift: if the new hours clash with shifts the employee already holds, the response
lists those shifts as an explicit warning and the supervisor resolves them in shift management (services/scheduling_availability.py).

WHO IS ACTING comes from the verified session. No endpoint here accepts a user id for a self-service write; the only
route that names another person is the supervisor's read of their own department's team.
"""
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from postgrest.exceptions import APIError

from core.database import supabase
from core.roles import ALL_ROLES, SCHEDULE_VIEWER_ROLES
from middleware.auth import CurrentUser, require_role
from models.leave_requests import (
    AvailabilityExceptionRequest,
    ReplaceAvailabilityRequest,
    RetireAvailabilityRequest,
)
from routers.scheduling import _existing_rows, _occurrence
from services import coverage_store as store
from services.request_common import in_manager_scope, not_found, person, shift_brief
from services.scheduling_access import (
    err,
    hotel_today,
    hotel_zone,
    load_departments,
    load_staff,
    manager_scope,
    record_audit,
)
from services.scheduling_availability import (
    assess_window,
    format_window,
    freshness,
    parse_window,
    weekly_summary,
    window_error,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/schedules", tags=["scheduling-availability"])

TEAM_CAP = 300
LOOKAHEAD_DAYS = 60
EXCEPTION_HORIZON_DAYS = 400


def _shape_rule(row: dict) -> dict:
    return {k: row.get(k) for k in ("id", "kind", "weekday", "exception_date", "mode", "windows", "effective_from",
                                    "effective_to", "note", "version", "created_at")}


def _normalise_windows(mode: str, windows) -> list[dict]:
    """Validate one day's windows and return them in canonical HH:MM form."""
    parsed = []
    for window in windows:
        value = parse_window({"start": window.start, "end": window.end})
        if value is None:
            raise err(422, "invalid_time", "Availability times must look like 07:00.")
        parsed.append(value)
    if mode == "unavailable":
        if parsed:
            raise err(422, "windows_not_allowed", "A day marked unavailable has no hours.")
        return []
    problem = window_error(parsed)
    if problem:
        raise err(422, problem, {"windows_required": "Add the hours this day.", "too_many_windows": "At most 4 time windows per day.",
                                 "windows_overlap": "Time windows on one day cannot overlap."}[problem])
    return [format_window(w) for w in sorted(parsed)]


def _load_rows(hotel_id: str, user_id: str) -> list[dict]:
    return (
        supabase.table("employee_availability").select("*").eq("tenant_id", hotel_id).eq("user_id", user_id)
        .order("created_at", desc=True).limit(500).execute().data or []
    )


def _state(hotel_id: str, user_id: str, today: date, now: datetime) -> dict:
    rows = _load_rows(hotel_id, user_id)
    active = [r for r in rows if r.get("status") == "active"]
    weekly = [r for r in active if r.get("kind") == "weekly"]
    exceptions = sorted((r for r in active if r.get("kind") == "exception" and str(r["exception_date"])[:10] >= today.isoformat()),
                        key=lambda r: str(r["exception_date"]))
    revision = max((int(r.get("revision") or 0) for r in rows if r.get("kind") == "weekly"), default=0)
    later = sorted({str(r["effective_from"])[:10] for r in weekly if str(r["effective_from"])[:10] > today.isoformat()})
    upcoming = None
    if later:
        starts = date.fromisoformat(later[0])
        upcoming = {"effective_from": later[0], "weekly": weekly_summary(starts, weekly)}
    created = [datetime.fromisoformat(str(r["created_at"]).replace("Z", "+00:00")) for r in rows if r.get("created_at")]
    last = max(created) if created else None
    return {
        "revision": revision, "weekly": weekly_summary(today, weekly), "upcoming_change": upcoming,
        "exceptions": [_shape_rule(r) for r in exceptions], "submitted": bool(weekly or exceptions),
        "last_updated_at": last.isoformat() if last else None, "freshness": freshness(last, now) if (weekly or exceptions) else "none",
        "hotel_today": today.isoformat(),
    }


def _shift_clashes(hotel_id: str, user_id: str, zone, start_day: date) -> list[dict]:
    """The employee's own upcoming published shifts that today's rules put outside / against their availability."""
    rules = [r for r in _load_rows(hotel_id, user_id) if r.get("status") == "active"]
    weekly = [r for r in rules if r.get("kind") == "weekly"]
    exceptions = [r for r in rules if r.get("kind") == "exception"]
    out = []
    for row in _existing_rows(hotel_id, [user_id], start_day, start_day + timedelta(days=LOOKAHEAD_DAYS)):
        occ = _occurrence(row)
        if occ is None or occ.work_date < start_day:
            continue
        verdict = assess_window(occ.starts_at, occ.ends_at, weekly=weekly, exceptions=exceptions, leave=[], zone=zone)
        if verdict.status in ("unavailable", "outside"):
            out.append({**shift_brief(row), "availability": verdict.status})
    return sorted(out, key=lambda r: (r["work_date"], str(r["starts_at"])))


# ---------------------------------------------------------------------------
# The signed-in employee's own availability
# ---------------------------------------------------------------------------

@router.get("/me/availability")
async def get_my_availability(current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    zone = hotel_zone(current_user.hotel_id)
    return {"data": _state(current_user.hotel_id, current_user.user_id, hotel_today(zone), datetime.now(timezone.utc))}


@router.put("/me/availability")
async def replace_my_availability(body: ReplaceAvailabilityRequest, current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    """
    Replace the whole recurring week as one set, atomically, effective from a (hotel-local) date. `expected_revision` is the
    revision the employee was looking at: a stale one is a 409 with the current state, never a silent overwrite. Re-sending
    an identical set after a lost answer is recognised and returned as success.
    """
    hotel_id, user_id = current_user.hotel_id, current_user.user_id
    zone = hotel_zone(hotel_id)
    today = hotel_today(zone)
    effective = body.effective_from or today
    if effective < today:
        raise err(422, "effective_in_past", "Availability can only start today or later.")
    if effective > today + timedelta(days=EXCEPTION_HORIZON_DAYS):
        raise err(422, "effective_too_far", "That start date is too far ahead.")
    seen: set[int] = set()
    days = []
    for day in body.days:
        if day.weekday in seen:
            raise err(422, "duplicate_weekday", "Each weekday can appear once.")
        seen.add(day.weekday)
        days.append({"weekday": day.weekday, "mode": day.mode, "windows": _normalise_windows(day.mode, day.windows)})
    try:
        supabase.rpc("replace_weekly_availability", {
            "p_tenant_id": hotel_id, "p_user_id": user_id, "p_actor": user_id, "p_expected_revision": body.expected_revision,
            "p_effective_from": effective.isoformat(), "p_days": days,
        }).execute()
    except APIError as exc:
        if (getattr(exc, "code", None) or "") != "AV001":
            raise
        current = _state(hotel_id, user_id, today, datetime.now(timezone.utc))
        if _same_week(current["weekly"], days) and current["revision"] == body.expected_revision + 1:
            return {"data": current, "meta": {"replayed": True, "shift_clashes": _shift_clashes(hotel_id, user_id, zone, max(today, effective))}}
        raise err(409, "availability_changed", "Your availability changed on another device. Reload to see the latest.", current=current)
    record_audit(current_user, resource_type="availability", resource_id=user_id, action="weekly_replaced",
                 new_state={"effective_from": effective.isoformat(), "days": days})
    return {"data": _state(hotel_id, user_id, today, datetime.now(timezone.utc)),
            "meta": {"replayed": False, "shift_clashes": _shift_clashes(hotel_id, user_id, zone, max(today, effective))}}


def _same_week(current: list[dict], requested: list[dict]) -> bool:
    mine = {d["weekday"]: (d["mode"], d["windows"]) for d in requested}
    now = {d["weekday"]: (d["state"], d["windows"]) for d in current if d["state"] != "unset"}
    return mine == now


@router.post("/me/availability/exceptions")
async def add_my_exception(body: AvailabilityExceptionRequest, current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    """One date that differs from the usual week. A second exception for the same date is a 409: retire the first, then add."""
    hotel_id, user_id = current_user.hotel_id, current_user.user_id
    zone = hotel_zone(hotel_id)
    today = hotel_today(zone)
    if body.exception_date < today:
        raise err(422, "date_in_past", "Exceptions can only be added for today or later.")
    if body.exception_date > today + timedelta(days=EXCEPTION_HORIZON_DAYS):
        raise err(422, "date_too_far", "That date is too far ahead.")
    windows = _normalise_windows(body.mode, body.windows)
    row = {
        "tenant_id": hotel_id, "user_id": user_id, "kind": "exception", "exception_date": body.exception_date.isoformat(),
        "mode": body.mode, "windows": windows, "effective_from": body.exception_date.isoformat(),
        "effective_to": body.exception_date.isoformat(), "note": body.note, "created_by": user_id,
        "status": "active", "version": 1, "revision": 0,
    }
    try:
        saved = store.insert_row("employee_availability", row)
    except Exception as exc:
        if store.is_unique_violation(exc):
            raise err(409, "exception_exists", "You already have an exception for that date. Remove it first.")
        raise
    record_audit(current_user, resource_type="availability", resource_id=str(saved["id"]), action="exception_added",
                 new_state={"exception_date": row["exception_date"], "mode": body.mode})
    return {"data": _shape_rule(saved), "meta": {"shift_clashes": _shift_clashes(hotel_id, user_id, zone, max(today, body.exception_date))}}


# ---------------------------------------------------------------------------
# Retire (the owner, or a supervisor whose department covers the owner)
# ---------------------------------------------------------------------------

@router.post("/availability/{row_id}/retire")
async def retire_availability(row_id: str, body: RetireAvailabilityRequest, current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    hotel_id = current_user.hotel_id
    found = supabase.table("employee_availability").select("*").eq("tenant_id", hotel_id).eq("id", row_id).maybe_single().execute()
    row = found.data if found else None
    if not row:
        raise not_found("Availability", "availability_not_found")
    if str(row["user_id"]) != current_user.user_id:
        departments = load_departments(hotel_id)
        member = load_staff(hotel_id, departments, [str(row["user_id"])]).get(str(row["user_id"]))
        if member is None or not in_manager_scope(current_user, member.department_id, departments):
            raise not_found("Availability", "availability_not_found")  # somebody else's record = no such record
    if row["status"] != "active":
        raise err(409, "availability_not_active", "That availability is already retired.", current=_shape_rule(row))
    now = datetime.now(timezone.utc).isoformat()
    saved = store.cas_update("employee_availability", hotel_id, row_id, body.expected_version,
                             {"status": "retired", "retired_by": current_user.user_id, "retired_at": now}, where={"status": "active"})
    if saved is None:
        latest = supabase.table("employee_availability").select("*").eq("tenant_id", hotel_id).eq("id", row_id).maybe_single().execute()
        raise store.version_conflict("availability", _shape_rule(latest.data) if latest and latest.data else None)
    record_audit(current_user, resource_type="availability", resource_id=row_id, action="retired",
                 old_state={"status": "active"}, new_state={"status": "retired"})
    return {"data": _shape_rule(saved)}


# ---------------------------------------------------------------------------
# Supervisors: the team's availability
# ---------------------------------------------------------------------------

def _team_scope(current_user: CurrentUser):
    departments = load_departments(current_user.hotel_id)
    allowed = departments.ids_in_scope(manager_scope(current_user))
    staff = {uid: m for uid, m in load_staff(current_user.hotel_id, departments).items()
             if m.department_id in allowed and uid != current_user.user_id}
    return departments, staff


def _leave_for(hotel_id: str, user_ids: list[str], today: date) -> dict[str, list[dict]]:
    if not user_ids:
        return {}
    rows = (
        supabase.table("time_off_requests").select("id, user_id, start_date, end_date, partial, start_time, end_time, status")
        .eq("tenant_id", hotel_id).in_("user_id", user_ids).in_("status", ["pending", "approved"])
        .gte("end_date", today.isoformat()).order("start_date").execute().data or []
    )
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(str(row["user_id"]), []).append(row)
    return grouped


@router.get("/availability/team")
async def team_availability(
    q: Optional[str] = Query(None, max_length=80),
    filter: str = Query("all", pattern="^(all|submitted|none|stale)$"),
    current_user: CurrentUser = Depends(require_role(*SCHEDULE_VIEWER_ROLES)),
):
    """Each person in the caller's departments with a weekly summary. 'none' = nothing submitted (unknown, not available)."""
    hotel_id = current_user.hotel_id
    zone = hotel_zone(hotel_id)
    today, now = hotel_today(zone), datetime.now(timezone.utc)
    _, staff = _team_scope(current_user)
    info = person(hotel_id, staff, staff)
    if q:
        needle = q.casefold()
        staff = {uid: m for uid, m in staff.items() if needle in (info[uid]["name"] or "").casefold()}
    ids = sorted(staff, key=lambda u: (info[u]["name"] or "~").casefold())[:TEAM_CAP]
    rules = (
        supabase.table("employee_availability").select("*").eq("tenant_id", hotel_id).in_("user_id", ids).limit(5000).execute().data or []
    ) if ids else []
    by_user: dict[str, list[dict]] = {}
    for row in rules:
        by_user.setdefault(str(row["user_id"]), []).append(row)
    leave = _leave_for(hotel_id, ids, today)
    items = []
    for uid in ids:
        rows = by_user.get(uid, [])
        active = [r for r in rows if r["status"] == "active"]
        weekly = [r for r in active if r["kind"] == "weekly"]
        upcoming = [r for r in active if r["kind"] == "exception" and str(r["exception_date"])[:10] >= today.isoformat()]
        stamps = [datetime.fromisoformat(str(r["created_at"]).replace("Z", "+00:00")) for r in rows if r.get("created_at")]
        last = max(stamps) if stamps else None
        submitted = bool(weekly or upcoming)
        state = freshness(last, now) if submitted else "none"
        if filter == "submitted" and not submitted or filter == "none" and submitted or filter == "stale" and state != "stale":
            continue
        items.append({
            **info[uid], "weekly": weekly_summary(today, weekly), "exception_count": len(upcoming),
            "exceptions": [_shape_rule(r) for r in sorted(upcoming, key=lambda r: str(r["exception_date"]))[:5]],
            "submitted": submitted, "freshness": state, "last_updated_at": last.isoformat() if last else None,
            "leave": [{k: r.get(k) for k in ("id", "start_date", "end_date", "partial", "status")} for r in leave.get(uid, [])[:3]],
        })
    return {"data": items, "meta": {"total": len(staff), "shown": len(items), "hotel_today": today.isoformat(), "truncated": len(staff) > TEAM_CAP}}


@router.get("/availability/team/{user_id}")
async def team_member_availability(user_id: str, current_user: CurrentUser = Depends(require_role(*SCHEDULE_VIEWER_ROLES))):
    """One person's full availability, their live leave and the upcoming shifts that clash with what they submitted."""
    hotel_id = current_user.hotel_id
    _, staff = _team_scope(current_user)
    member = staff.get(user_id)
    if member is None:
        raise not_found("Employee", "employee_not_found")  # another department / hotel / an inactive person all look the same
    zone = hotel_zone(hotel_id)
    today = hotel_today(zone)
    state = _state(hotel_id, user_id, today, datetime.now(timezone.utc))
    return {"data": {
        **person(hotel_id, [user_id], staff)[user_id], **state,
        "leave": [{k: r.get(k) for k in ("id", "start_date", "end_date", "partial", "start_time", "end_time", "status")}
                  for r in _leave_for(hotel_id, [user_id], today).get(user_id, [])],
        "shift_clashes": _shift_clashes(hotel_id, user_id, zone, today),
    }}
