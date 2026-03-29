from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from datetime import date, datetime, timedelta, timezone
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import CreateLogbookEntryRequest, UpdateLogbookEntryRequest
from core.database import supabase

router = APIRouter(prefix="/logbook", tags=["logbook"])


def _expires_at(hours: Optional[int]) -> Optional[str]:
    if hours and hours > 0:
        return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
    return None


@router.post("/entries")
async def create_logbook_entry(
    request: CreateLogbookEntryRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Create a new logbook entry for a department/shift."""
    payload = {
        "tenant_id": current_user.hotel_id,
        "department_id": str(request.department_id),
        "shift_id": str(request.shift_id) if request.shift_id else None,
        "author_id": current_user.user_id,
        "content": request.content,
    }
    expires = _expires_at(request.expires_hours)
    if expires:
        payload["expires_at"] = expires

    result = supabase.table("logbook_entries").insert(payload).execute()
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
    """List logbook entries — expired entries are excluded automatically."""
    now = datetime.now(timezone.utc).isoformat()

    query = supabase.table("logbook_entries")\
        .select("*, departments(name)")\
        .eq("tenant_id", current_user.hotel_id)\
        .or_(f"expires_at.is.null,expires_at.gt.{now}")\
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


@router.patch("/entries/{entry_id}")
async def update_logbook_entry(
    entry_id: str,
    request: UpdateLogbookEntryRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Update content or expiry. Author or supervisor/GM only."""
    row = supabase.table("logbook_entries")\
        .select("author_id, tenant_id")\
        .eq("id", entry_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    if not row.data:
        raise HTTPException(status_code=404, detail="Entry not found")

    is_author = row.data["author_id"] == current_user.user_id
    is_privileged = current_user.role in ("gm", "housekeeping_supervisor", "chief_engineer")
    if not (is_author or is_privileged):
        raise HTTPException(status_code=403, detail="Not allowed to edit this entry")

    updates: dict = {}
    if request.content is not None:
        updates["content"] = request.content
    if request.expires_hours is not None:
        updates["expires_at"] = _expires_at(request.expires_hours)  # None when 0 = remove expiry

    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")

    result = supabase.table("logbook_entries")\
        .update(updates)\
        .eq("id", entry_id)\
        .execute()
    return {"data": result.data[0] if result.data else None}


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_logbook_entry(
    entry_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Delete a logbook entry. Author or supervisor/GM only."""
    row = supabase.table("logbook_entries")\
        .select("author_id, tenant_id")\
        .eq("id", entry_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    if not row.data:
        raise HTTPException(status_code=404, detail="Entry not found")

    is_author = row.data["author_id"] == current_user.user_id
    is_privileged = current_user.role in ("gm", "housekeeping_supervisor", "chief_engineer")
    if not (is_author or is_privileged):
        raise HTTPException(status_code=403, detail="Not allowed to delete this entry")

    supabase.table("logbook_entries").delete().eq("id", entry_id).execute()
    return None


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
        .maybe_single()\
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
        raise HTTPException(status_code=422, detail="shift_id and shift_date are required")

    from services.ai.shift_summary import generate_shift_summary
    result = generate_shift_summary(current_user.hotel_id, shift_id, shift_date)
    return {"data": result}
