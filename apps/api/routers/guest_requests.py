import logging
from fastapi import APIRouter, Depends, Query
from typing import Optional
from middleware.auth import get_current_user, CurrentUser
from models.requests import CreateGuestRequestRequest
from core.database import supabase
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/guest-requests", tags=["guest-requests"])


@router.post("")
async def create_guest_request(
    request: CreateGuestRequestRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Create a new guest request and auto-create a task."""
    # Insert guest request record
    gr_data = {
        "tenant_id": current_user.hotel_id,
        "title": request.title,
        "description": request.description,
        "room_id": str(request.room_id) if request.room_id else None,
        "guest_name": request.guest_name,
        "created_by": current_user.user_id,
        "status": "open",
    }
    result = supabase.table("guest_requests").insert(gr_data).execute()

    if result.data:
        gr_id = result.data[0]["id"]
        # Auto-create a housekeeping task linked to this guest request
        task_result = supabase.table("tasks").insert({
            "tenant_id": current_user.hotel_id,
            "title": request.title,
            "description": request.description,
            "task_type": "guest_request",
            "priority": "normal",
            "room_id": str(request.room_id) if request.room_id else None,
            "created_by": current_user.user_id,
            "sla_minutes": 240,
            "due_at": (datetime.now(timezone.utc) + timedelta(minutes=240)).isoformat(),
        }).execute()
        if task_result.data:
            task_id = task_result.data[0]["id"]
            supabase.table("guest_requests").update({"task_id": task_id}).eq("id", gr_id).execute()
        else:
            logger.error("Auto-task creation failed for guest_request=%s", gr_id)

    return {"data": result.data[0] if result.data else None}


@router.get("")
async def list_guest_requests(
    status: Optional[str] = Query(None),
    room_id: Optional[str] = Query(None),
    page: int = Query(1),
    per_page: int = Query(20),
    current_user: CurrentUser = Depends(get_current_user)
):
    """List guest requests with optional filters."""
    query = supabase.table("guest_requests")\
        .select("*, rooms(room_number)")\
        .eq("tenant_id", current_user.hotel_id)\
        .order("created_at", desc=True)\
        .range((page - 1) * per_page, page * per_page - 1)

    if status:
        query = query.eq("status", status)
    if room_id:
        query = query.eq("room_id", room_id)

    result = query.execute()
    return {"data": result.data, "meta": {"page": page, "per_page": per_page}}


@router.patch("/{request_id}")
async def update_guest_request(
    request_id: str,
    body: dict,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Update guest request status or notes."""
    allowed_fields = {"status", "notes", "resolved_at", "assigned_to"}
    update_data = {k: v for k, v in body.items() if k in allowed_fields}

    if update_data.get("status") == "resolved" and "resolved_at" not in update_data:
        update_data["resolved_at"] = datetime.now(timezone.utc).isoformat()

    result = supabase.table("guest_requests")\
        .update(update_data)\
        .eq("id", request_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()
    return {"data": result.data[0] if result.data else None}
