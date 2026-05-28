import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from middleware.auth import get_current_user, CurrentUser
from models.requests import CreateGuestRequestRequest
from core.database import supabase
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/guest-requests", tags=["guest-requests"])
GUEST_REQUEST_UPDATE_COLUMNS = {
    "title",
    "description",
    "room_id",
    "guest_name",
    "status",
    "resolved_at",
    "resolved_by",
}


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
            refreshed = supabase.table("guest_requests")\
                .update({"task_id": task_id})\
                .eq("id", gr_id)\
                .eq("tenant_id", current_user.hotel_id)\
                .execute()
            if refreshed.data:
                result = refreshed
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
    """Update guest request — full edit with cascade to linked task."""
    notes = body.get("notes")
    update_data = {k: v for k, v in body.items() if k in GUEST_REQUEST_UPDATE_COLUMNS}

    if update_data.get("status") == "resolved" and "resolved_at" not in update_data:
        update_data["resolved_at"] = datetime.now(timezone.utc).isoformat()
    if update_data.get("status") == "resolved" and "resolved_by" not in update_data:
        update_data["resolved_by"] = current_user.user_id

    if update_data:
        result = supabase.table("guest_requests")\
            .update(update_data)\
            .eq("id", request_id)\
            .eq("tenant_id", current_user.hotel_id)\
            .execute()
    else:
        result = supabase.table("guest_requests")\
            .select("*")\
            .eq("id", request_id)\
            .eq("tenant_id", current_user.hotel_id)\
            .maybe_single()\
            .execute()

    gr = result.data[0] if isinstance(result.data, list) and result.data else result.data
    if not gr:
        raise HTTPException(status_code=404, detail="Guest request not found")

    # Cascade title/description edits to the linked task
    task_id = gr.get("task_id")
    task_cascade: dict = {}
    if "title" in update_data:
        task_cascade["title"] = update_data["title"]
    if "description" in update_data:
        task_cascade["description"] = update_data["description"]
    if task_id and task_cascade:
        supabase.table("tasks") \
            .update(task_cascade) \
            .eq("id", task_id) \
            .eq("tenant_id", current_user.hotel_id) \
            .execute()

    if task_id and isinstance(notes, str) and notes.strip():
        supabase.table("task_comments").insert({
            "task_id": task_id,
            "tenant_id": current_user.hotel_id,
            "user_id": current_user.user_id,
            "comment": notes.strip(),
        }).execute()

    return {"data": gr}


@router.delete("/{request_id}", status_code=204)
async def delete_guest_request(
    request_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    gr = supabase.table("guest_requests") \
        .select("task_id") \
        .eq("id", request_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .maybe_single() \
        .execute()

    if not gr or not gr.data:
        raise HTTPException(status_code=404, detail="Guest request not found")

    task_id = gr.data.get("task_id")

    supabase.table("guest_requests") \
        .delete() \
        .eq("id", request_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()

    if task_id:
        supabase.table("task_comments") \
            .delete() \
            .eq("task_id", task_id) \
            .eq("tenant_id", current_user.hotel_id) \
            .execute()
        supabase.table("tasks") \
            .delete() \
            .eq("id", task_id) \
            .eq("tenant_id", current_user.hotel_id) \
            .execute()
