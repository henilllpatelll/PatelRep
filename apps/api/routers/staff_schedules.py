"""Temporary role coverage (day-of-week role schedules) for staff.

Schedules only change the *effective role* reported to the UI (`GET /staff/me/effective-role`); API
authorization always uses the role in the caller's JWT, so a schedule can never grant server access.
"""
from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException

from core.database import supabase
from middleware.auth import CurrentUser, require_role
from models.requests import CreateRoleScheduleRequest
from routers.staff import tenant_role_rows

router = APIRouter(prefix="/staff", tags=["staff"])

# base role -> roles it may be scheduled to cover. Anything else is a meaningless self-override
# (e.g. engineer -> engineer) or an unsupported transition.
COVERAGE_TRANSITIONS = {
    "housekeeper": frozenset({"housekeeping_supervisor"}),
}


def _ranges_overlap(a_start, a_end, b_start, b_end) -> bool:
    """Date ranges where None means unbounded on that side."""
    return (a_end is None or b_start is None or b_start <= a_end) and (b_end is None or a_start is None or a_start <= b_end)


def _as_date(value):
    return date_type.fromisoformat(value) if isinstance(value, str) else value


@router.get("/{user_id}/role-schedules")
async def get_role_schedules(
    user_id: str,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """List active role schedule overrides for a staff member."""
    if not tenant_role_rows(user_id, current_user.hotel_id):
        raise HTTPException(status_code=404, detail="Staff member not found")
    result = supabase.table("staff_role_schedules")\
        .select("id, override_role, days_of_week, start_date, end_date, created_at")\
        .eq("hotel_id", current_user.hotel_id)\
        .eq("user_id", user_id)\
        .eq("is_active", True)\
        .order("created_at")\
        .execute()
    return {"data": result.data or []}


@router.post("/{user_id}/role-schedules")
async def create_role_schedule(
    user_id: str,
    body: CreateRoleScheduleRequest,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """Create a day-of-week role schedule override for a staff member."""
    days = sorted(set(body.days_of_week))
    if not days or any(d < 0 or d > 6 for d in days):
        raise HTTPException(status_code=422, detail="days_of_week must contain values 0 (Sun) to 6 (Sat)")
    if body.start_date and body.end_date and body.start_date > body.end_date:
        raise HTTPException(status_code=422, detail="start_date must not be after end_date")
    if body.end_date and body.end_date < date_type.today():
        raise HTTPException(status_code=422, detail="end_date is in the past")

    rows = tenant_role_rows(user_id, current_user.hotel_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Staff member not found")
    active_roles = {r["role"] for r in rows if r.get("is_active")}
    if not active_roles:
        raise HTTPException(status_code=409, detail="Cannot schedule coverage for a deactivated person")
    if body.override_role in active_roles:
        raise HTTPException(status_code=422, detail="Person already holds this role; a self-override has no effect")
    if not any(body.override_role in COVERAGE_TRANSITIONS.get(role, ()) for role in active_roles):
        raise HTTPException(status_code=422, detail="This role cannot cover that role")

    existing = supabase.table("staff_role_schedules")\
        .select("id, days_of_week, start_date, end_date")\
        .eq("hotel_id", current_user.hotel_id)\
        .eq("user_id", user_id)\
        .eq("is_active", True)\
        .execute()
    for other in (existing.data or []):
        if set(other.get("days_of_week") or []) & set(days) and _ranges_overlap(
            body.start_date, body.end_date, _as_date(other.get("start_date")), _as_date(other.get("end_date"))
        ):
            raise HTTPException(status_code=409, detail="Conflicts with an existing coverage schedule for these days")

    row: dict = {
        "hotel_id": current_user.hotel_id,
        "user_id": user_id,
        "override_role": body.override_role,
        "days_of_week": days,
    }
    if body.start_date:
        row["start_date"] = body.start_date.isoformat()
    if body.end_date:
        row["end_date"] = body.end_date.isoformat()

    result = supabase.table("staff_role_schedules").insert(row).execute()
    return {"data": result.data[0] if result.data else None}


@router.delete("/{user_id}/role-schedules/{schedule_id}")
async def delete_role_schedule(
    user_id: str,
    schedule_id: str,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """Disable a role schedule override (soft delete). 404 if it is not this person's/hotel's."""
    result = supabase.table("staff_role_schedules")\
        .update({"is_active": False})\
        .eq("id", schedule_id)\
        .eq("hotel_id", current_user.hotel_id)\
        .eq("user_id", user_id)\
        .execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Role schedule not found")
    return {"data": {"success": True}}
