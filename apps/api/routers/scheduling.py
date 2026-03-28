from fastapi import APIRouter, Depends, Query, HTTPException
from typing import Optional
from datetime import date, datetime, timedelta, timezone
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import (
    CreateShiftAssignmentRequest,
    CreateShiftRequest,
    UpdateShiftRequest,
    BulkShiftAssignmentRequest,
)
from core.database import supabase

router = APIRouter(prefix="/schedules", tags=["scheduling"])

SUPERVISOR_ROLES = ("gm", "housekeeping_supervisor", "chief_engineer")


# ---------------------------------------------------------------------------
# Shifts
# ---------------------------------------------------------------------------

@router.get("/shifts")
async def list_shifts(
    department_id: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    current_user: CurrentUser = Depends(get_current_user)
):
    """List all shift definitions, optionally filtered by department or active status."""
    query = supabase.table("shifts")\
        .select("*")\
        .eq("tenant_id", current_user.hotel_id)\
        .order("start_time")

    if department_id:
        query = query.eq("department_id", department_id)
    if is_active is not None:
        query = query.eq("is_active", is_active)

    result = query.execute()
    return {"data": result.data}


@router.post("/shifts")
async def create_shift(
    body: CreateShiftRequest,
    current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES))
):
    """Create a new shift definition."""
    shift_data = {
        "tenant_id": current_user.hotel_id,
        "name": body.name,
        "department_id": str(body.department_id),
        "start_time": body.start_time,
        "end_time": body.end_time,
    }
    result = supabase.table("shifts").insert(shift_data).execute()
    return {"data": result.data[0] if result.data else None}


@router.patch("/shifts/{shift_id}")
async def update_shift(
    shift_id: str,
    body: UpdateShiftRequest,
    current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES))
):
    """Update a shift definition (name, start_time, end_time, is_active)."""
    update_data = body.model_dump(exclude_none=True)
    if not update_data:
        raise HTTPException(status_code=422, detail="No valid fields to update")

    result = supabase.table("shifts")\
        .update(update_data)\
        .eq("id", shift_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Shift not found")

    return {"data": result.data[0]}


# ---------------------------------------------------------------------------
# Assignments
# ---------------------------------------------------------------------------

@router.get("/assignments/my-schedule")
async def get_my_schedule(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    current_user: CurrentUser = Depends(get_current_user)
):
    """Get the current user's shift assignments for a date range (default: today + 7 days)."""
    today = date.today()
    from_date = date_from or today
    to_date = date_to or (today + timedelta(days=7))

    result = supabase.table("shift_assignments")\
        .select("*, shifts(name, start_time, end_time)")\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("user_id", current_user.user_id)\
        .gte("work_date", from_date.isoformat())\
        .lte("work_date", to_date.isoformat())\
        .order("work_date")\
        .execute()

    return {"data": result.data}


@router.get("/assignments")
async def list_assignments(
    work_date: Optional[date] = Query(None),
    shift_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user)
):
    """List shift assignments, optionally filtered by date, shift, or user."""
    query = supabase.table("shift_assignments")\
        .select("*, shifts(name, start_time, end_time)")\
        .eq("tenant_id", current_user.hotel_id)\
        .order("work_date", desc=True)

    if work_date:
        query = query.eq("work_date", work_date.isoformat())
    if shift_id:
        query = query.eq("shift_id", shift_id)
    if user_id:
        query = query.eq("user_id", user_id)

    result = query.execute()
    return {"data": result.data}


@router.post("/assignments")
async def create_shift_assignment(
    request: CreateShiftAssignmentRequest,
    current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES))
):
    """Assign a staff member to a shift on a specific date."""
    result = supabase.table("shift_assignments").insert({
        "tenant_id": current_user.hotel_id,
        "user_id": str(request.user_id),
        "shift_id": str(request.shift_id),
        "work_date": request.work_date.isoformat(),
        "assigned_by": current_user.user_id,
    }).execute()
    return {"data": result.data[0] if result.data else None}


@router.post("/assignments/bulk")
async def bulk_create_assignments(
    body: BulkShiftAssignmentRequest,
    current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES))
):
    """
    Bulk create/upsert shift assignments.
    Conflict resolution: on duplicate (user_id + shift_id + work_date) the existing row is updated.
    """
    rows = [
        {
            "tenant_id": current_user.hotel_id,
            "user_id": str(item.user_id),
            "shift_id": str(item.shift_id),
            "work_date": item.work_date.isoformat(),
            "assigned_by": current_user.user_id,
        }
        for item in body.assignments
    ]

    result = supabase.table("shift_assignments")\
        .upsert(rows, on_conflict="user_id,shift_id,work_date")\
        .execute()

    # supabase-py upsert returns all affected rows; we can't easily split
    # created vs updated without a before-snapshot, so we report total.
    total = len(result.data) if result.data else 0
    return {"data": {"created_count": total, "updated_count": 0}}


@router.delete("/assignments/{assignment_id}")
async def delete_assignment(
    assignment_id: str,
    current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES))
):
    """Remove a shift assignment."""
    result = supabase.table("shift_assignments")\
        .delete()\
        .eq("id", assignment_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Assignment not found")

    return {"data": {"success": True, "deleted_id": assignment_id}}


@router.patch("/assignments/{assignment_id}/clock-in")
async def clock_in(
    assignment_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Record clock-in time for a shift assignment."""
    # Fetch the assignment first to verify ownership / role.
    fetch = supabase.table("shift_assignments")\
        .select("user_id")\
        .eq("id", assignment_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    if not fetch.data:
        raise HTTPException(status_code=404, detail="Assignment not found")

    is_supervisor = current_user.role in SUPERVISOR_ROLES
    is_own = fetch.data["user_id"] == current_user.user_id
    if not is_own and not is_supervisor:
        raise HTTPException(status_code=403, detail="Not authorized to clock in for another user")

    result = supabase.table("shift_assignments")\
        .update({
            "clocked_in_at": datetime.now(timezone.utc).isoformat(),
            "is_on_shift": True,
        })\
        .eq("id", assignment_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    return {"data": result.data[0] if result.data else None}


@router.patch("/assignments/{assignment_id}/clock-out")
async def clock_out(
    assignment_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Record clock-out time for a shift assignment."""
    fetch = supabase.table("shift_assignments")\
        .select("user_id")\
        .eq("id", assignment_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    if not fetch.data:
        raise HTTPException(status_code=404, detail="Assignment not found")

    is_supervisor = current_user.role in SUPERVISOR_ROLES
    is_own = fetch.data["user_id"] == current_user.user_id
    if not is_own and not is_supervisor:
        raise HTTPException(status_code=403, detail="Not authorized to clock out for another user")

    result = supabase.table("shift_assignments")\
        .update({
            "clocked_out_at": datetime.now(timezone.utc).isoformat(),
            "is_on_shift": False,
        })\
        .eq("id", assignment_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    return {"data": result.data[0] if result.data else None}


# ---------------------------------------------------------------------------
# Roster
# ---------------------------------------------------------------------------

@router.get("/today-roster")
async def today_roster(
    current_user: CurrentUser = Depends(require_role(*SUPERVISOR_ROLES))
):
    """
    Get all staff on shift today: either is_on_shift=True or
    work_date=today and not yet clocked out.
    """
    today_str = date.today().isoformat()

    result = supabase.table("shift_assignments")\
        .select(
            "user_id, is_on_shift, clocked_in_at, clocked_out_at, "
            "shifts(name, start_time, end_time)"
        )\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("work_date", today_str)\
        .is_("clocked_out_at", "null")\
        .execute()

    roster = []
    for row in (result.data or []):
        shift = row.get("shifts") or {}

        # Include rows where staff is currently on shift OR clocked in but not out.
        if not row.get("is_on_shift") and not row.get("clocked_in_at"):
            continue

        roster.append({
            "user_id": row["user_id"],
            "full_name": None,
            "role": None,
            "shift": {
                "name": shift.get("name"),
                "start_time": shift.get("start_time"),
                "end_time": shift.get("end_time"),
            },
            "clocked_in_at": row.get("clocked_in_at"),
            "is_on_shift": row.get("is_on_shift", False),
        })

    return {"data": roster}
