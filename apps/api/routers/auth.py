from fastapi import APIRouter, Depends, HTTPException
from middleware.auth import get_current_user, CurrentUser
from core.database import supabase

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me")
async def get_me(current_user: CurrentUser = Depends(get_current_user)):
    """Returns current user profile and hotel context."""
    profile = supabase.table("user_profiles")\
        .select("id, full_name, preferred_name, phone, avatar_url, language_pref, is_active")\
        .eq("id", current_user.user_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    hotel = supabase.table("tenants")\
        .select("id, name, timezone, room_count, logo_url")\
        .eq("id", current_user.hotel_id)\
        .single()\
        .execute()

    user_data = profile.data or {}
    user_data["id"] = current_user.user_id
    user_data["email"] = current_user.email
    user_data["role"] = current_user.role

    return {
        "user": user_data,
        "hotel": hotel.data,
        "subscription": {},
    }


@router.post("/hotel-context")
async def set_hotel_context(hotel_id: str, current_user: CurrentUser = Depends(get_current_user)):
    """Validates user has access to the specified hotel."""
    role_check = supabase.table("user_roles")\
        .select("role")\
        .eq("user_id", current_user.user_id)\
        .eq("tenant_id", hotel_id)\
        .eq("is_active", True)\
        .single()\
        .execute()

    if not role_check.data:
        raise HTTPException(status_code=403, detail="No access to this hotel")

    return {"data": {"hotel_id": hotel_id, "role": role_check.data["role"]}}
