from fastapi import APIRouter, Body, Depends, HTTPException, Query
from middleware.auth import get_current_user, require_role, CurrentUser
from core.database import supabase

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(
    is_read: bool = Query(False),
    limit: int = Query(20),
    current_user: CurrentUser = Depends(get_current_user)
):
    query = supabase.table("notifications")\
        .select("*")\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("user_id", current_user.user_id)\
        .order("created_at", desc=True)\
        .limit(limit)

    if not is_read:
        query = query.eq("is_read", False)

    result = query.execute()
    return {"data": result.data}


@router.patch("/{notification_id}/read")
async def mark_read(notification_id: str, current_user: CurrentUser = Depends(get_current_user)):
    supabase.table("notifications")\
        .update({"is_read": True})\
        .eq("id", notification_id)\
        .eq("user_id", current_user.user_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()
    return {"data": {"success": True}}


@router.post("/mark-all-read")
async def mark_all_read(current_user: CurrentUser = Depends(get_current_user)):
    supabase.table("notifications")\
        .update({"is_read": True})\
        .eq("user_id", current_user.user_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()
    return {"data": {"success": True}}


@router.post("/broadcast")
async def broadcast_message(
    body: dict = Body(...),
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor")
    ),
):
    """Send a message to all active housekeeping staff on this property."""
    message = (body.get("message") or "").strip()
    roles = body.get("roles") or ["housekeeper", "housekeeping_supervisor"]
    if not message:
        raise HTTPException(status_code=422, detail="message is required")

    staff_result = (
        supabase.table("user_roles")
        .select("user_id")
        .eq("tenant_id", current_user.hotel_id)
        .eq("is_active", True)
        .in_("role", roles)
        .execute()
    )
    recipients = [
        r["user_id"]
        for r in (staff_result.data or [])
        if r["user_id"] != current_user.user_id
    ]

    if not recipients:
        return {"data": {"sent": 0}}

    rows = [
        {
            "tenant_id": current_user.hotel_id,
            "user_id": uid,
            "type": "broadcast",
            "title": "Team message",
            "body": message,
            "is_read": False,
        }
        for uid in recipients
    ]
    supabase.table("notifications").insert(rows).execute()
    return {"data": {"sent": len(rows)}}


@router.post("/direct")
async def send_direct_message(
    body: dict = Body(...),
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor", "engineer")
    ),
):
    """Send a direct in-app message to one staff member."""
    recipient_id = body.get("recipient_id")
    message = (body.get("message") or "").strip()
    if not recipient_id or not message:
        raise HTTPException(status_code=422, detail="recipient_id and message are required")

    # Confirm recipient belongs to the same tenant
    staff_row = (
        supabase.table("user_roles")
        .select("user_id")
        .eq("user_id", recipient_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not staff_row or not staff_row.data:
        raise HTTPException(status_code=404, detail="Recipient not found in this property")

    supabase.table("notifications").insert({
        "tenant_id": current_user.hotel_id,
        "user_id": recipient_id,
        "type": "direct_message",
        "title": "Message from supervisor",
        "body": message,
        "is_read": False,
    }).execute()

    return {"data": {"success": True}}
