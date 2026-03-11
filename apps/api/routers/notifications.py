from fastapi import APIRouter, Depends, Query
from middleware.auth import get_current_user, CurrentUser
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
