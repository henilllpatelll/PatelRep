from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, Literal
from datetime import datetime, timezone
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import CreateLateCheckoutRequest, ResolveLateCheckoutRequest
from core.database import supabase

router = APIRouter(prefix="/late-checkout", tags=["late-checkout"])


@router.post("/requests")
async def create_late_checkout_request(
    request: CreateLateCheckoutRequest,
    current_user: CurrentUser = Depends(
        require_role("housekeeper", "housekeeping_supervisor", "front_desk", "gm")
    ),
):
    # Validate room belongs to this tenant
    room = (
        supabase.table("rooms")
        .select("id")
        .eq("id", str(request.room_id))
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not room or not room.data:
        raise HTTPException(status_code=404, detail="Room not found")

    result = (
        supabase.table("late_checkout_requests")
        .insert({
            "tenant_id": current_user.hotel_id,
            "room_id": str(request.room_id),
            "room_number": request.room_number,
            "requested_by": current_user.user_id,
            "requested_time": request.requested_time,
        })
        .execute()
    )
    return {"data": result.data[0] if result.data else None}


@router.get("/requests")
async def list_late_checkout_requests(
    status: Optional[Literal["pending", "approved", "denied"]] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    query = (
        supabase.table("late_checkout_requests")
        .select("*")
        .eq("tenant_id", current_user.hotel_id)
        .order("created_at", desc=True)
        .limit(50)
    )

    if status:
        query = query.eq("status", status)

    # Housekeepers only see their own requests
    if current_user.role == "housekeeper":
        query = query.eq("requested_by", current_user.user_id)

    result = query.execute()
    return {"data": result.data}


@router.patch("/requests/{request_id}")
async def resolve_late_checkout_request(
    request_id: str,
    request: ResolveLateCheckoutRequest,
    current_user: CurrentUser = Depends(
        require_role("front_desk", "gm", "housekeeping_supervisor")
    ),
):
    existing = (
        supabase.table("late_checkout_requests")
        .select("id, status, requested_by, room_number, requested_time")
        .eq("id", request_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not existing or not existing.data:
        raise HTTPException(status_code=404, detail="Late checkout request not found")
    if existing.data["status"] != "pending":
        raise HTTPException(status_code=409, detail="Request already resolved")

    update = {
        "status": request.status,
        "resolved_by": current_user.user_id,
        "resolved_at": datetime.now(timezone.utc).isoformat(),
    }
    if request.confirmed_time:
        update["confirmed_time"] = request.confirmed_time
    if request.notes:
        update["notes"] = request.notes

    result = (
        supabase.table("late_checkout_requests")
        .update(update)
        .eq("id", request_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )

    # Notify the requesting housekeeper
    try:
        rec = existing.data
        confirmed = request.confirmed_time or rec["requested_time"]
        body = (
            f"Approved — Room {rec['room_number']} late checkout confirmed for {confirmed}."
            if request.status == "approved"
            else f"Denied — Room {rec['room_number']} late checkout not available."
        )
        supabase.table("notifications").insert({
            "tenant_id": current_user.hotel_id,
            "user_id": rec["requested_by"],
            "title": "Late checkout " + request.status,
            "body": body,
            "type": "housekeeping",
            "read": False,
        }).execute()
    except Exception:
        pass  # Notification failure must not block the resolution response

    return {"data": result.data[0] if result.data else None}
