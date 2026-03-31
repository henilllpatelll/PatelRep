from fastapi import APIRouter, Depends, HTTPException
from middleware.auth import require_role, get_current_user, get_current_user_no_hotel, CurrentUser
from models.requests import InviteStaffRequest, AddStaffDirectRequest, UpdatePushTokenRequest
from core.database import supabase

router = APIRouter(prefix="/staff", tags=["staff"])


@router.patch("/me/push-token")
async def update_push_token(
    body: UpdatePushTokenRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Register or update the caller's Expo push token. Called on every login."""
    supabase.table("user_profiles")\
        .update({"expo_push_token": body.token})\
        .eq("id", current_user.user_id)\
        .execute()
    return {"data": {"success": True}}


@router.get("")
async def list_staff(
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor", "chief_engineer"))
):
    """List all active staff members for the hotel."""
    roles_result = supabase.table("user_roles")\
        .select("id, user_id, tenant_id, role, department_id, is_active, created_at")\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("is_active", True)\
        .order("role")\
        .execute()

    roles = roles_result.data or []
    user_ids = list({r["user_id"] for r in roles})

    profiles_map: dict = {}
    if user_ids:
        profiles_result = supabase.table("user_profiles")\
            .select("id, full_name, preferred_name, avatar_url, phone")\
            .in_("id", user_ids)\
            .execute()
        profiles_map = {p["id"]: p for p in (profiles_result.data or [])}

    for r in roles:
        r["user_profiles"] = profiles_map.get(r["user_id"], {})

    return {"data": roles}


@router.get("/invitations")
async def list_invitations(
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """List all pending (not yet accepted) staff invitations for this hotel."""
    result = supabase.table("staff_invitations")\
        .select("*")\
        .eq("tenant_id", current_user.hotel_id)\
        .is_("accepted_at", "null")\
        .order("created_at", desc=True)\
        .execute()
    return {"data": result.data}


@router.post("/invite")
async def invite_staff(
    body: InviteStaffRequest,
    current_user: CurrentUser = Depends(get_current_user_no_hotel)
):
    """
    Invite a new staff member by email.
    - Inserts a record into staff_invitations (token and expires_at use DB defaults).
    - Sends the invite email via Supabase Auth admin API.
    - If the user already exists in auth, the invitation record is still created.
    """
    # hotel_id comes from JWT claims (normal flow) or request body (onboarding wizard)
    hotel_id = current_user.hotel_id or body.hotel_id
    if not hotel_id:
        raise HTTPException(status_code=400, detail="hotel_id required")
    invitation_row = {
        "tenant_id": hotel_id,
        "email": body.email,
        "role": body.role,
        "invited_by": current_user.user_id,
    }
    if body.department_id is not None:
        invitation_row["department_id"] = str(body.department_id)

    inv_result = supabase.table("staff_invitations").insert(invitation_row).execute()

    if not inv_result.data:
        raise HTTPException(status_code=500, detail="Failed to create invitation record")

    invitation = inv_result.data[0]

    # Send the actual invite email via Supabase Auth admin API.
    # If the user already exists the API raises an exception; we catch it and continue.
    user_metadata: dict = {
        "hotel_id": hotel_id,
        "role": body.role,
        "full_name": body.full_name,
    }
    if body.phone:
        user_metadata["phone"] = body.phone

    try:
        supabase.auth.admin.invite_user_by_email(
            body.email,
            options={"data": user_metadata},
        )
    except Exception:
        # User may already exist in Supabase Auth; invitation record is still valid.
        pass

    return {"data": invitation}


@router.post("/add-direct")
async def add_staff_direct(
    body: AddStaffDirectRequest,
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Create a staff member directly without sending an invite email."""
    import secrets
    temp_password = body.password if body.password else secrets.token_urlsafe(12)

    try:
        auth_response = supabase.auth.admin.create_user({
            "email": body.email,
            "password": temp_password,
            "email_confirm": True,
            "user_metadata": {
                "hotel_id": current_user.hotel_id,
                "role": body.role,
                "full_name": body.full_name,
            }
        })
        user_id = auth_response.user.id
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    supabase.table("user_profiles").upsert({
        "id": user_id,
        "full_name": body.full_name,
        "preferred_name": body.full_name.split()[0] if body.full_name else body.full_name,
    }).execute()

    role_data = {
        "user_id": user_id,
        "tenant_id": current_user.hotel_id,
        "role": body.role,
        "is_active": True,
    }
    if body.department_id:
        role_data["department_id"] = str(body.department_id)

    supabase.table("user_roles").insert(role_data).execute()
    return {"data": {"success": True, "user_id": user_id, "full_name": body.full_name, "temp_password": temp_password}}


@router.patch("/{staff_id}")
async def update_staff(
    staff_id: str,
    body: dict,
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Update a staff member's role, department, or active status."""
    allowed_fields = {"role", "department_id", "is_active"}
    update_data = {k: v for k, v in body.items() if k in allowed_fields}

    if not update_data:
        raise HTTPException(status_code=422, detail="No valid fields to update")

    result = supabase.table("user_roles")\
        .update(update_data)\
        .eq("user_id", staff_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    return {"data": result.data[0] if result.data else None}


@router.delete("/{staff_id}")
async def deactivate_staff(
    staff_id: str,
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Deactivate a staff member (soft delete — sets is_active=false)."""
    if staff_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")

    supabase.table("user_roles")\
        .update({"is_active": False})\
        .eq("user_id", staff_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    return {"data": {"success": True, "deactivated_user_id": staff_id}}
