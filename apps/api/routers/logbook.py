from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from datetime import date, datetime, timedelta, timezone

from dateutil import tz as dateutil_tz

from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import CreateLogbookEntryRequest, UpdateLogbookEntryRequest
from core.database import supabase

router = APIRouter(prefix="/logbook", tags=["logbook"])


def _expires_at(hours: Optional[int]) -> Optional[str]:
    if hours and hours > 0:
        return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
    return None


def _get_hotel_tz(hotel_id: str):
    result = (
        supabase.table("tenants")
        .select("timezone")
        .eq("id", hotel_id)
        .maybe_single()
        .execute()
    )
    tz_name = ((result.data if result else None) or {}).get("timezone") or "America/Chicago"
    return dateutil_tz.gettz(tz_name) or dateutil_tz.gettz("America/Chicago")


def _hotel_today(hotel_id: str) -> str:
    return datetime.now(_get_hotel_tz(hotel_id)).date().isoformat()


def _resolve_current_shift(hotel_id: str) -> Optional[dict]:
    """Pick the shift template whose window most recently closed, hotel-local time.

    Used by the manual "generate summary" flow so the caller never has to know a
    real `shifts.id` up front — mirrors the cron's per-shift generation semantics
    (routers/internal.py's generate_shift_summaries), just resolved on demand for
    whichever shift last ended relative to now instead of iterating every shift.
    """
    tz = _get_hotel_tz(hotel_id)
    now_minutes = datetime.now(tz).hour * 60 + datetime.now(tz).minute

    shifts_result = supabase.table("shifts")\
        .select("id, name, department_id, end_time")\
        .eq("tenant_id", hotel_id)\
        .eq("is_active", True)\
        .execute()
    shifts = shifts_result.data or []
    if not shifts:
        return None

    def _end_minutes(shift: dict) -> int:
        hours, minutes, *_ = str(shift["end_time"]).split(":")
        return int(hours) * 60 + int(minutes)

    return min(shifts, key=lambda s: (now_minutes - _end_minutes(s)) % (24 * 60))


def _resolve_user_name(user_id: Optional[str]) -> Optional[str]:
    if not user_id:
        return None
    result = (
        supabase.table("user_profiles")
        .select("preferred_name, full_name")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    data = (result.data if result else None) or {}
    return data.get("preferred_name") or data.get("full_name")


def _build_entries_query(hotel_id: str, department_id, shift_id, entry_date, page, per_page):
    q = supabase.table("logbook_entries")\
        .select("*, departments(name)")\
        .eq("tenant_id", hotel_id)\
        .order("created_at", desc=True)\
        .range((page - 1) * per_page, page * per_page - 1)
    if department_id:
        q = q.eq("department_id", department_id)
    if shift_id:
        q = q.eq("shift_id", shift_id)
    if entry_date:
        q = q.eq("entry_date", entry_date.isoformat())
    return q


@router.post("/entries")
async def create_logbook_entry(
    request: CreateLogbookEntryRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    payload = {
        "tenant_id": current_user.hotel_id,
        "department_id": str(request.department_id),
        "shift_id": str(request.shift_id) if request.shift_id else None,
        "author_id": current_user.user_id,
        "content": request.content,
        "entry_date": _hotel_today(current_user.hotel_id),
    }
    expires = _expires_at(request.expires_hours)
    if expires:
        payload["expires_at"] = expires

    try:
        result = supabase.table("logbook_entries").insert(payload).execute()
    except Exception:
        payload.pop("expires_at", None)
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
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")
    kwargs = dict(
        hotel_id=current_user.hotel_id,
        department_id=department_id,
        shift_id=shift_id,
        entry_date=entry_date,
        page=page,
        per_page=per_page,
    )

    try:
        result = _build_entries_query(**kwargs)\
            .or_(f"expires_at.is.null,expires_at.gt.{now}")\
            .execute()
    except Exception:
        # expires_at column not yet migrated — fetch without filter
        result = _build_entries_query(**kwargs).execute()

    return {"data": result.data, "meta": {"page": page, "per_page": per_page}}


@router.patch("/entries/{entry_id}")
async def update_logbook_entry(
    entry_id: str,
    request: UpdateLogbookEntryRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    row = supabase.table("logbook_entries")\
        .select("author_id, tenant_id")\
        .eq("id", entry_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    if not row or not row.data:
        raise HTTPException(status_code=404, detail="Entry not found")

    is_author = row.data["author_id"] == current_user.user_id
    is_privileged = current_user.role in ("gm", "housekeeping_supervisor", "engineer")
    if not (is_author or is_privileged):
        raise HTTPException(status_code=403, detail="Not allowed to edit this entry")

    updates: dict = {}
    if request.content is not None:
        updates["content"] = request.content
    if request.expires_hours is not None:
        updates["expires_at"] = _expires_at(request.expires_hours)

    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")

    try:
        result = (
            supabase.table("logbook_entries")
            .update(updates)
            .eq("id", entry_id)
            .eq("tenant_id", current_user.hotel_id)
            .execute()
        )
    except Exception:
        updates.pop("expires_at", None)
        if not updates:
            raise HTTPException(status_code=422, detail="No fields to update (expires_at column not yet migrated)")
        result = (
            supabase.table("logbook_entries")
            .update(updates)
            .eq("id", entry_id)
            .eq("tenant_id", current_user.hotel_id)
            .execute()
        )

    return {"data": result.data[0] if result.data else None}


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_logbook_entry(
    entry_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    row = supabase.table("logbook_entries")\
        .select("author_id, tenant_id")\
        .eq("id", entry_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    if not row or not row.data:
        raise HTTPException(status_code=404, detail="Entry not found")

    is_author = row.data["author_id"] == current_user.user_id
    is_privileged = current_user.role in ("gm", "housekeeping_supervisor", "engineer")
    if not (is_author or is_privileged):
        raise HTTPException(status_code=403, detail="Not allowed to delete this entry")

    supabase.table("logbook_entries")\
        .delete()\
        .eq("id", entry_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()
    return None


@router.get("/shift-summary")
async def get_current_shift_summary(
    shift_date: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user)
):
    """Look up (without generating) the summary for whichever shift most recently
    ended, on the given date. Lets the UI show an already-generated summary
    (cron- or manually-triggered) without the caller knowing its shift_id."""
    resolved_date = shift_date or _hotel_today(current_user.hotel_id)

    shift = _resolve_current_shift(current_user.hotel_id)
    if not shift:
        raise HTTPException(status_code=404, detail="No shifts configured for this hotel")

    result = supabase.table("shift_summaries")\
        .select("*")\
        .eq("shift_id", shift["id"])\
        .eq("shift_date", resolved_date)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Shift summary not found")

    row = result.data
    name = _resolve_user_name(row.get("acknowledged_by"))
    return {"data": {**row, "acknowledged_by_name": name}}


@router.get("/shift-summary/{shift_id}")
async def get_shift_summary(
    shift_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    result = supabase.table("shift_summaries")\
        .select("*")\
        .eq("shift_id", shift_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Shift summary not found")

    row = result.data
    name = _resolve_user_name(row.get("acknowledged_by"))
    return {"data": {**row, "acknowledged_by_name": name}}


@router.post("/shift-summary/{summary_id}/acknowledge")
async def acknowledge_shift_summary(
    summary_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    result = supabase.table("shift_summaries")\
        .select("id, acknowledged_by, acknowledged_at")\
        .eq("id", summary_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Shift summary not found")

    row = result.data
    if row.get("acknowledged_at"):
        name = _resolve_user_name(row.get("acknowledged_by"))
        return {"data": {
            "id": summary_id,
            "acknowledged_by": row.get("acknowledged_by"),
            "acknowledged_at": row.get("acknowledged_at"),
            "acknowledged_by_name": name,
            "already_acknowledged": True,
        }}

    now_iso = datetime.now(timezone.utc).isoformat()
    supabase.table("shift_summaries")\
        .update({"acknowledged_by": current_user.user_id, "acknowledged_at": now_iso})\
        .eq("id", summary_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    name = _resolve_user_name(current_user.user_id)
    return {"data": {
        "id": summary_id,
        "acknowledged_by": current_user.user_id,
        "acknowledged_at": now_iso,
        "acknowledged_by_name": name,
    }}


@router.post("/shift-summary/generate")
async def generate_shift_summary_endpoint(
    body: dict,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor", "engineer"))
):
    shift_date = body.get("shift_date") or _hotel_today(current_user.hotel_id)

    shift = _resolve_current_shift(current_user.hotel_id)
    if not shift:
        raise HTTPException(status_code=422, detail="No shifts configured for this hotel")

    # Avoid a duplicate AI call (and a duplicate row — shift_id+shift_date has no
    # unique constraint) if a summary for this shift/date already exists, e.g. the
    # cron already ran or the user double-clicks Generate.
    existing = supabase.table("shift_summaries")\
        .select("summary_text, stats")\
        .eq("shift_id", shift["id"])\
        .eq("shift_date", shift_date)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()
    if existing and existing.data:
        row = existing.data
        stats = row.get("stats") or {}
        return {"data": {
            "summary_text": row["summary_text"],
            "tasks_completed": stats.get("tasks_completed", 0),
            "open_work_orders": stats.get("open_work_orders", 0),
        }}

    from services.ai.shift_summary import generate_shift_summary
    result = generate_shift_summary(current_user.hotel_id, shift["id"], shift_date)
    return {"data": result}
