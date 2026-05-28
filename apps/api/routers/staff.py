from fastapi import APIRouter, Depends, HTTPException
from middleware.auth import require_role, get_current_user, get_current_user_no_hotel, CurrentUser
from models.requests import InviteStaffRequest, AddStaffDirectRequest, UpdatePushTokenRequest, CreateRoleScheduleRequest, CreateCustomRoleRequest, UpdateCustomRoleRequest
from core.database import supabase
from core.config import settings
from datetime import date as date_type
import httpx

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


@router.get("/me/effective-role")
async def get_effective_role(current_user: CurrentUser = Depends(get_current_user)):
    """Returns today's effective role for the caller, applying any day-of-week schedule override."""
    today = date_type.today()
    # Python weekday(): 0=Mon…6=Sun → our DB convention: 0=Sun, 1=Mon…6=Sat
    db_day = (today.weekday() + 1) % 7

    result = supabase.table("staff_role_schedules")\
        .select("id, override_role, days_of_week, start_date, end_date")\
        .eq("hotel_id", current_user.hotel_id)\
        .eq("user_id", current_user.user_id)\
        .eq("is_active", True)\
        .execute()

    effective_role = current_user.role
    schedule_id = None

    for s in (result.data or []):
        if s.get("start_date") and date_type.fromisoformat(s["start_date"]) > today:
            continue
        if s.get("end_date") and date_type.fromisoformat(s["end_date"]) < today:
            continue
        if db_day in (s.get("days_of_week") or []):
            effective_role = s["override_role"]
            schedule_id = s["id"]
            break

    # Look up custom role assignment for this user
    ur_result = supabase.table("user_roles")\
        .select("custom_role_id")\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("user_id", current_user.user_id)\
        .eq("is_active", True)\
        .limit(1)\
        .execute()

    custom_role = None
    if ur_result.data and ur_result.data[0].get("custom_role_id"):
        cr_result = supabase.table("custom_roles")\
            .select("id, name, allowed_modules")\
            .eq("id", ur_result.data[0]["custom_role_id"])\
            .eq("is_active", True)\
            .single()\
            .execute()
        if cr_result.data:
            custom_role = cr_result.data

    return {
        "data": {
            "base_role": current_user.role,
            "effective_role": effective_role,
            "schedule_id": schedule_id,
            "is_overridden": effective_role != current_user.role,
            "custom_role": custom_role,
        }
    }


@router.get("")
async def list_staff(
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor", "chief_engineer"))
):
    """List all active staff members for the hotel."""
    roles_result = supabase.table("user_roles")\
        .select("id, user_id, tenant_id, role, department_id, is_active, created_at, custom_role_id")\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("is_active", True)\
        .order("role")\
        .execute()

    roles = roles_result.data or []
    user_ids = list({r["user_id"] for r in roles})

    # Batch-fetch custom role names
    custom_role_ids = list({r["custom_role_id"] for r in roles if r.get("custom_role_id")})
    custom_roles_map: dict = {}
    if custom_role_ids:
        cr_result = supabase.table("custom_roles")\
            .select("id, name")\
            .in_("id", custom_role_ids)\
            .execute()
        custom_roles_map = {cr["id"]: cr["name"] for cr in (cr_result.data or [])}

    profiles_map: dict = {}
    if user_ids:
        profiles_result = supabase.table("user_profiles")\
            .select("id, full_name, preferred_name, avatar_url, phone")\
            .in_("id", user_ids)\
            .execute()
        profiles_map = {p["id"]: p for p in (profiles_result.data or [])}

    # Fetch emails from auth admin API
    emails_map: dict = {}
    if user_ids:
        try:
            auth_users = supabase.auth.admin.list_users()
            uid_set = set(user_ids)
            for u in (auth_users if isinstance(auth_users, list) else getattr(auth_users, "users", [])):
                uid = str(getattr(u, "id", ""))
                if uid in uid_set:
                    emails_map[uid] = getattr(u, "email", "") or ""
        except Exception:
            pass

    staff_list = []
    for r in roles:
        profile = profiles_map.get(r["user_id"], {})
        staff_list.append({
            "id": r["id"],
            "user_id": r["user_id"],
            "hotel_id": r["tenant_id"],
            "full_name": profile.get("full_name", ""),
            "email": emails_map.get(str(r["user_id"]), ""),
            "role": r["role"],
            "department_id": r.get("department_id"),
            "status": "active" if r.get("is_active") else "inactive",
            "avatar_url": profile.get("avatar_url"),
            "created_at": r["created_at"],
            "custom_role_id": r.get("custom_role_id"),
            "custom_role_name": custom_roles_map.get(r.get("custom_role_id")),
        })

    return {"data": {"staff": staff_list, "total": len(staff_list)}}


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
    invitations = result.data or []
    return {"data": {"invitations": invitations, "total": len(invitations)}}


def _create_staff_invitation(body: InviteStaffRequest, hotel_id: str, invited_by: str):
    invitation_row = {
        "tenant_id": hotel_id,
        "email": body.email,
        "role": body.role,
        "invited_by": invited_by,
    }
    if body.department_id is not None:
        invitation_row["department_id"] = str(body.department_id)

    inv_result = supabase.table("staff_invitations").insert(invitation_row).execute()

    if not inv_result.data:
        raise HTTPException(status_code=500, detail="Failed to create invitation record")

    invitation = inv_result.data[0]

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

    return invitation


@router.post("/invite")
async def invite_staff(
    body: InviteStaffRequest,
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """
    Invite a new staff member by email.
    - Inserts a record into staff_invitations (token and expires_at use DB defaults).
    - Sends the invite email via Supabase Auth admin API.
    - If the user already exists in auth, the invitation record is still created.
    """
    invitation = _create_staff_invitation(body, current_user.hotel_id, current_user.user_id)
    return {"data": invitation}


@router.post("/onboarding-invite")
async def invite_staff_during_onboarding(
    body: InviteStaffRequest,
    current_user: CurrentUser = Depends(get_current_user_no_hotel)
):
    """
    Invite staff during first-run onboarding before the user's refreshed JWT has hotel_id.
    The body hotel_id is accepted only after proving this caller is that hotel's active GM.
    """
    if not body.hotel_id:
        raise HTTPException(status_code=400, detail="hotel_id required")

    owner_role = supabase.table("user_roles")\
        .select("id")\
        .eq("tenant_id", body.hotel_id)\
        .eq("user_id", current_user.user_id)\
        .eq("role", "gm")\
        .eq("is_active", True)\
        .maybe_single()\
        .execute()

    if not owner_role or not owner_role.data:
        raise HTTPException(status_code=403, detail="Not authorized to invite staff for this hotel")

    invitation = _create_staff_invitation(body, body.hotel_id, current_user.user_id)
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
        user_id = str(auth_response.user.id)
    except Exception as e:
        err_str = str(e)
        if "already been registered" in err_str or "already registered" in err_str:
            # Auth user exists from a previous partial attempt — look them up by email
            # via the GoTrue admin REST API (more reliable than list_users pagination)
            try:
                resp = httpx.get(
                    f"{settings.supabase_url}/auth/v1/admin/users",
                    headers={
                        "apikey": settings.supabase_service_role_key,
                        "Authorization": f"Bearer {settings.supabase_service_role_key}",
                    },
                    params={"filter": body.email, "per_page": 1000},
                    timeout=10.0,
                )
                resp.raise_for_status()
                raw = resp.json()
                users_list = raw.get("users", raw) if isinstance(raw, dict) else raw
                existing = next(
                    (u for u in users_list if u.get("email", "").lower() == body.email.lower()),
                    None,
                )
                if not existing:
                    raise HTTPException(status_code=400, detail=f"'{body.email}' already exists in auth but could not be located. Please contact support.")
                user_id = str(existing["id"])
                # Update their password to the one being set now
                supabase.auth.admin.update_user_by_id(user_id, {"password": temp_password})
            except HTTPException:
                raise
            except Exception as inner_e:
                raise HTTPException(status_code=400, detail=str(inner_e))
        else:
            raise HTTPException(status_code=400, detail=err_str)

    supabase.table("user_profiles").upsert({
        "id": user_id,
        "tenant_id": current_user.hotel_id,
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

    supabase.table("user_roles").upsert(role_data, on_conflict="user_id,tenant_id,role").execute()
    return {"data": {"success": True, "user_id": user_id, "full_name": body.full_name, "temp_password": temp_password}}


@router.get("/custom-roles")
async def list_custom_roles(
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """List all active custom roles for the hotel."""
    result = supabase.table("custom_roles")\
        .select("id, name, description, base_role, allowed_modules, created_at")\
        .eq("hotel_id", current_user.hotel_id)\
        .eq("is_active", True)\
        .order("created_at")\
        .execute()
    return {"data": result.data or []}


@router.post("/custom-roles")
async def create_custom_role(
    body: CreateCustomRoleRequest,
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Create a named custom role with a module permission set."""
    result = supabase.table("custom_roles").insert({
        "hotel_id": current_user.hotel_id,
        "name": body.name,
        "description": body.description,
        "base_role": body.base_role,
        "allowed_modules": body.allowed_modules,
    }).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create custom role")
    return {"data": result.data[0]}


@router.patch("/custom-roles/{role_id}")
async def update_custom_role(
    role_id: str,
    body: UpdateCustomRoleRequest,
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Update a custom role's name, description, base role, or module set."""
    update_data = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not update_data:
        raise HTTPException(status_code=422, detail="No fields to update")
    result = supabase.table("custom_roles")\
        .update(update_data)\
        .eq("id", role_id)\
        .eq("hotel_id", current_user.hotel_id)\
        .execute()
    return {"data": result.data[0] if result.data else None}


@router.delete("/custom-roles/{role_id}")
async def delete_custom_role(
    role_id: str,
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Soft-delete a custom role (sets is_active=false)."""
    supabase.table("custom_roles")\
        .update({"is_active": False})\
        .eq("id", role_id)\
        .eq("hotel_id", current_user.hotel_id)\
        .execute()
    return {"data": {"success": True}}


@router.get("/{user_id}/role-schedules")
async def get_role_schedules(
    user_id: str,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """List active role schedule overrides for a staff member."""
    result = supabase.table("staff_role_schedules")\
        .select("id, override_role, days_of_week, start_date, end_date, created_at")\
        .eq("hotel_id", current_user.hotel_id)\
        .eq("user_id", user_id)\
        .eq("is_active", True)\
        .order("created_at")\
        .execute()
    return {"data": result.data or []}


@router.post("/{user_id}/role-schedules")
async def create_role_schedule(
    user_id: str,
    body: CreateRoleScheduleRequest,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """Create a day-of-week role schedule override for a staff member."""
    if not body.days_of_week:
        raise HTTPException(status_code=422, detail="At least one day_of_week is required")
    member_check = supabase.table("user_roles")\
        .select("user_id")\
        .eq("user_id", user_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()
    if not member_check or not member_check.data:
        raise HTTPException(status_code=404, detail="Staff member not found")

    row: dict = {
        "hotel_id": current_user.hotel_id,
        "user_id": user_id,
        "override_role": body.override_role,
        "days_of_week": body.days_of_week,
    }
    if body.start_date:
        row["start_date"] = body.start_date.isoformat()
    if body.end_date:
        row["end_date"] = body.end_date.isoformat()

    result = supabase.table("staff_role_schedules").insert(row).execute()
    return {"data": result.data[0] if result.data else None}


@router.delete("/{user_id}/role-schedules/{schedule_id}")
async def delete_role_schedule(
    user_id: str,
    schedule_id: str,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """Soft-delete a role schedule override."""
    supabase.table("staff_role_schedules")\
        .update({"is_active": False})\
        .eq("id", schedule_id)\
        .eq("hotel_id", current_user.hotel_id)\
        .eq("user_id", user_id)\
        .execute()
    return {"data": {"success": True}}


@router.patch("/{staff_id}")
async def update_staff(
    staff_id: str,
    body: dict,
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Update a staff member's role, department, or active status."""
    allowed_fields = {"role", "department_id", "is_active", "custom_role_id"}
    update_data = {k: v for k, v in body.items() if k in allowed_fields}

    if not update_data:
        raise HTTPException(status_code=422, detail="No valid fields to update")

    result = supabase.table("user_roles")\
        .update(update_data)\
        .eq("user_id", staff_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Staff member not found")

    return {"data": result.data[0] if result.data else None}


@router.delete("/{staff_id}")
async def deactivate_staff(
    staff_id: str,
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Deactivate a staff member (soft delete — sets is_active=false)."""
    if staff_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")

    result = supabase.table("user_roles")\
        .update({"is_active": False})\
        .eq("user_id", staff_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Staff member not found")

    return {"data": {"success": True, "deactivated_user_id": staff_id}}
