"""GET /schedules/team -- the team-wide schedule read behind the supervisor's staffing views.

One bounded, tenant- and department-scoped read of who is scheduled when, optionally combined (for a single day) with
who is actually working. The plan comes from shift_assignments; attendance comes ONLY from hk_shift_sessions via
routers/shifts.load_roster and is interpreted by services/scheduling.derive_workforce_status. If attendance cannot be
read the response says so (`meta.attendance.verified = false`, every status `unknown`) instead of guessing.
"""
import hashlib
import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query

from core.database import supabase
from middleware.auth import CurrentUser, require_role
from routers.scheduling import ASSIGNMENT_COLUMNS, TEAM_VIEW_ROLES, _day, _shape
from routers.shifts import load_roster
from services.scheduling import derive_workforce_status
from services.scheduling_access import (
    err,
    hotel_today,
    hotel_zone,
    load_departments,
    load_names,
    load_staff,
    manager_scope,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/schedules", tags=["scheduling"])

TEAM_MAX_DAYS = 42
STAFF_CAP = 1000          # most people considered for one hotel's team read
ASSIGNMENT_CAP = 5000
DEFAULT_PER_PAGE = 50
MAX_PER_PAGE = 200


@router.get("/team")
async def get_team_schedule(
    date_from: date = Query(...),
    date_to: Optional[date] = Query(None),
    department_id: Optional[str] = Query(None),
    role: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    include_attendance: bool = Query(False),
    page: int = Query(1, ge=1),
    per_page: int = Query(DEFAULT_PER_PAGE, ge=1, le=MAX_PER_PAGE),
    current_user: CurrentUser = Depends(require_role(*TEAM_VIEW_ROLES)),
):
    """
    The team's schedule for `date_from`..`date_to` (hotel-local dates, at most 42 days; default one day). People are
    paginated (`page`/`per_page`, ordered by name); their shifts for the range are returned in full. A shift that
    began the day before `date_from` and runs past midnight is included and marked `carried_from_previous_day`.

    Visibility: gm sees every department; other managers only their own department(s). Drafts are visible here,
    cancelled shifts are not.

    `include_attendance=true` (single day only) adds a verified `workforce_status` per person and per shift; see
    services/scheduling.py for what each status means. Nothing is inferred from rooms or from the plan.
    """
    hotel_id = current_user.hotel_id
    date_to = date_to or date_from
    if date_to < date_from:
        raise err(422, "invalid_range", "date_to must not be before date_from.")
    if (date_to - date_from).days + 1 > TEAM_MAX_DAYS:
        raise err(422, "range_too_large", f"Ask for at most {TEAM_MAX_DAYS} days at a time.", max_days=TEAM_MAX_DAYS)
    if include_attendance and date_from != date_to:
        raise err(422, "attendance_requires_single_day", "Attendance can only be combined with a single day.")

    zone = hotel_zone(hotel_id)
    today = hotel_today(zone)
    now = datetime.now(timezone.utc)
    departments = load_departments(hotel_id)

    allowed = departments.ids_in_scope(manager_scope(current_user))
    if department_id is not None:
        if department_id not in departments.code_by_id:
            raise err(404, "department_not_found", "Department not found")
        if department_id not in allowed:
            raise err(403, "department_forbidden", "You can only view schedules for your own department.")
        allowed = {department_id}

    # --- people (the grid's rows), paginated ---------------------------------------------------------------
    staff = load_staff(hotel_id, departments)
    people = [
        m for m in staff.values()
        if m.department_id in allowed
        and (role is None or role in m.roles)
        and (user_id is None or m.user_id == user_id)
    ]
    people = people[:STAFF_CAP]
    names = load_names([m.user_id for m in people])
    people.sort(key=lambda m: (names.get(m.user_id) or "~").casefold())
    start = (page - 1) * per_page
    page_people = people[start:start + per_page]
    page_ids = [m.user_id for m in page_people]

    # --- shifts for those people over the range (+ the previous evening, for overnight carry-over) -----------
    rows: list[dict] = []
    if page_ids:
        rows = (
            supabase.table("shift_assignments").select(ASSIGNMENT_COLUMNS)
            .eq("tenant_id", hotel_id).in_("user_id", page_ids)
            .neq("publication_state", "cancelled")
            .gte("work_date", (date_from - timedelta(days=1)).isoformat())
            .lte("work_date", date_to.isoformat())
            .order("work_date").order("starts_at")
            .limit(ASSIGNMENT_CAP).execute().data or []
        )
    window_start = datetime.combine(date_from, time.min, tzinfo=zone).astimezone(timezone.utc)
    assignments = []
    for row in rows:
        work_date = _day(row.get("work_date"))
        if work_date is None:
            continue
        carried = work_date < date_from
        if carried:
            ends = row.get("ends_at")
            try:
                still_running = ends is not None and datetime.fromisoformat(str(ends).replace("Z", "+00:00")) > window_start
            except ValueError:
                still_running = False
            if not still_running:
                continue
        shaped = _shape(row)
        shaped["carried_from_previous_day"] = carried
        # Legacy clock columns are not attendance; do not leak them into the verified view.
        for legacy in ("is_on_shift", "clocked_in_at", "clocked_out_at"):
            shaped.pop(legacy, None)
        assignments.append(shaped)

    # --- attendance (single day only) -----------------------------------------------------------------------
    attendance = {"requested": include_attendance, "verified": False, "source": "hk_shift_sessions", "as_of": None}
    status_by_user: dict[str, str] = {}
    if include_attendance:
        sessions: dict[str, dict] = {}
        try:
            sessions = {str(r["user_id"]): r for r in load_roster(hotel_id, date_from, zone) if r.get("user_id")}
            attendance.update(verified=True, as_of=now.isoformat())
        except Exception:
            logger.warning("scheduling team: attendance read failed hotel_id=%s; reporting unknown", hotel_id)
        scheduled_users = {a["user_id"] for a in assignments}
        for member in page_people:
            status_by_user[member.user_id] = derive_workforce_status(
                scheduled=member.user_id in scheduled_users,
                session=sessions.get(member.user_id),
                attendance_verified=attendance["verified"],
                now=now,
            )
        for a in assignments:
            a["workforce_status"] = status_by_user[a["user_id"]]

    scheduled_ids = {a["user_id"] for a in assignments}
    staff_rows = []
    for member in page_people:
        entry = {
            "user_id": member.user_id,
            "full_name": names.get(member.user_id, ""),
            "roles": list(member.roles),
            "department_id": member.department_id,
            "department_code": departments.code_by_id.get(member.department_id or ""),
            "scheduled": member.user_id in scheduled_ids,
        }
        if include_attendance:
            entry["workforce_status"] = status_by_user[member.user_id]
        staff_rows.append(entry)

    counts: dict = {"staff_total": len(people), "staff_scheduled": len(scheduled_ids), "assignments": len(assignments)}
    if include_attendance and attendance["verified"]:
        tally: dict[str, int] = {}
        for status in status_by_user.values():
            tally[status] = tally.get(status, 0) + 1
        counts["by_status"] = tally
    # (when attendance is not verified, by_status is omitted: unknown is never reported as zero)

    revision = hashlib.sha256(
        "|".join(sorted(f"{a['id']}:{a.get('version', 1)}" for a in assignments)).encode()
    ).hexdigest()[:16]
    return {
        "data": {"staff": staff_rows, "assignments": assignments},
        "meta": {
            "state": "empty" if not staff_rows else "ok",
            "generated_at": now.isoformat(),
            "hotel_today": today.isoformat(),
            "date_from": date_from.isoformat(),
            "date_to": date_to.isoformat(),
            "revision": revision,
            "attendance": attendance,
            "counts": counts,
            "pagination": {"page": page, "per_page": per_page, "total": len(people), "has_more": start + per_page < len(people)},
            "truncated": len(rows) >= ASSIGNMENT_CAP or len(staff) > STAFF_CAP,
            "staff_without_department": sum(1 for m in staff.values() if m.department_id is None),
            "max_range_days": TEAM_MAX_DAYS,
        },
    }
