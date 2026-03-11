from fastapi import APIRouter, Depends, Query
from typing import Optional
from datetime import date
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import CreateLogbookEntryRequest
from core.database import supabase

router = APIRouter(prefix="/logbook", tags=["logbook"])


@router.post("/entries")
async def create_logbook_entry(
    request: CreateLogbookEntryRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Create a new logbook entry for a department/shift."""
    result = supabase.table("logbook_entries").insert({
        "tenant_id": current_user.hotel_id,
        "department_id": str(request.department_id),
        "shift_id": str(request.shift_id) if request.shift_id else None,
        "author_id": current_user.user_id,
        "content": request.content,
    }).execute()
    return {"data": result.data[0] if result.data else None}


@router.get("/entries")
async def list_logbook_entries(
    department_id: Optional[str] = Query(None),
    shift_id: Optional[str] = Query(None),
    entry_date: Optional[date] = Query(None),
    page: int = Query(1),
    per_page: int = Query(20),
    current_user: CurrentUser = Depends(get_current_user)
):
    """List logbook entries with optional filters."""
    query = supabase.table("logbook_entries")\
        .select("*, user_profiles(preferred_name, full_name), departments(name)")\
        .eq("tenant_id", current_user.hotel_id)\
        .order("created_at", desc=True)\
        .range((page - 1) * per_page, page * per_page - 1)

    if department_id:
        query = query.eq("department_id", department_id)
    if shift_id:
        query = query.eq("shift_id", shift_id)
    if entry_date:
        date_start = f"{entry_date.isoformat()}T00:00:00"
        date_end = f"{entry_date.isoformat()}T23:59:59"
        query = query.gte("created_at", date_start).lte("created_at", date_end)

    result = query.execute()
    return {"data": result.data, "meta": {"page": page, "per_page": per_page}}


@router.get("/shift-summary/{shift_id}")
async def get_shift_summary(
    shift_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Get AI-generated summary for a specific shift."""
    result = supabase.table("shift_summaries")\
        .select("*")\
        .eq("shift_id", shift_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .single()\
        .execute()

    if not result.data:
        return {"data": {"message": "No summary available. Generate one using POST /logbook/shift-summary/generate"}}

    return {"data": result.data}


@router.post("/shift-summary/generate")
async def generate_shift_summary_endpoint(
    body: dict,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor", "chief_engineer"))
):
    """Generate AI shift summary using Claude Sonnet."""
    shift_id = body.get("shift_id")
    shift_date = body.get("shift_date")

    if not shift_id or not shift_date:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail="shift_id and shift_date are required")

    from services.ai.shift_summary import generate_shift_summary
    result = generate_shift_summary(current_user.hotel_id, shift_id, shift_date)
    return {"data": result}
