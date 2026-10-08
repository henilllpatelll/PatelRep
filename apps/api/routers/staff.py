import logging
import secrets
from datetime import date as date_type
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException

from core.config import settings
from core.database import supabase
from core.roles import ALL_ROLES, GM_ONLY_ROLES
from middleware.auth import CurrentUser, get_current_user, require_role
from models.requests import (
    AddStaffDirectRequest,
    CreateCustomRoleRequest,
    UpdateCustomRoleRequest,
    UpdatePushTokenRequest,
    UpdateStaffMemberProfileRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/staff", tags=["staff"])

STAFF_DIRECTORY_ROLES = ("gm", "housekeeping_supervisor", "engineer", "chief_engineer", "front_desk")
STAFF_STATUSES = ("active", "inactive", "all")


# ---------------------------------------------------------------------------
# Shared helpers (also imported by staff_invitations.py / staff_schedules.py)
# ---------------------------------------------------------------------------
def validate_department(department_id, hotel_id: str) -> str:
    """Return the department id only if it belongs to this hotel; never trust client-supplied ids."""
    result = supabase.table("departments")\
        .select("id")\
        .eq("id", str(department_id))\
        .eq("tenant_id", hotel_id)\
        .execute()
    if not result.data:
        raise HTTPException(status_code=422, detail="Department not found for this hotel")
    return str(department_id)


def validate_custom_role(custom_role_id, hotel_id: str) -> str:
    result = supabase.table("custom_roles")\
        .select("id")\
        .eq("id", str(custom_role_id))\
        .eq("hotel_id", hotel_id)\
        .eq("is_active", True)\
        .execute()
    if not result.data:
        raise HTTPException(status_code=422, detail="Custom role not found for this hotel")
    return str(custom_role_id)


def assert_custom_role_fits(custom_role_id, roles, hotel_id: str) -> None:
    """A custom access policy is a variant of one base role; it can only sit on someone who holds that role."""
    result = supabase.table("custom_roles")        .select("id, base_role")        .eq("id", str(custom_role_id))        .eq("hotel_id", hotel_id)        .execute()
    base_role = (result.data or [{}])[0].get("base_role")
    held = set(roles)
    if "chief_engineer" in held:
        held.add("engineer")  # the Roles screen saves chief-engineer policies against the engineer base role
    if base_role and base_role not in held:
        raise HTTPException(status_code=422, detail="This custom access policy does not match the person's base role")


def tenant_role_rows(user_id: str, hotel_id: str) -> list:
    """Every user_roles row (active or not) this person has in this hotel."""
    result = supabase.table("user_roles")\
        .select("id, user_id, tenant_id, role, department_id, is_active, created_at, custom_role_id, hourly_rate")\
        .eq("user_id", user_id)\
        .eq("tenant_id", hotel_id)\
        .execute()
    return result.data or []


def _departments_map(hotel_id: str) -> dict:
    result = supabase.table("departments").select("id, name").eq("tenant_id", hotel_id).execute()
    return {d["id"]: d["name"] for d in (result.data or [])}


def _load_emails(user_ids: list) -> dict:
    """Map auth user id -> email, paging through the admin API (it returns one small page by default)."""
    wanted = {str(u) for u in user_ids}
    found: dict = {}
    if not wanted:
        return found
    try:
        per_page = 1000
        for page in range(1, 21):
            res = supabase.auth.admin.list_users(page=page, per_page=per_page)
            users = res if isinstance(res, list) else getattr(res, "users", [])
            for u in users:
                uid = str(getattr(u, "id", ""))
                if uid in wanted:
                    found[uid] = getattr(u, "email", "") or ""
            if len(users) < per_page or wanted <= found.keys():
                break
    except Exception as exc:
        logger.warning("staff email lookup failed: %s", exc)
    return found


def _other_active_gm_exists(hotel_id: str, excluding_user_id: str) -> bool:
    result = supabase.table("user_roles")\
        .select("user_id")\
        .eq("tenant_id", hotel_id)\
        .eq("role", "gm")\
        .eq("is_active", True)\
        .execute()
    return any(str(r["user_id"]) != str(excluding_user_id) for r in (result.data or []))


def _guard_admin_access(current_user: CurrentUser, rows: list, *, deactivating: bool = False, new_role: Optional[str] = None):
    """Never let the last active GM be removed, and never let a GM remove their own admin access."""
    target_id = str(rows[0]["user_id"])
    is_self = target_id == str(current_user.user_id)
    holds_gm = any(r["role"] == "gm" and r.get("is_active") for r in rows)
    if deactivating and is_self:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
    if new_role is not None and new_role != "gm" and is_self and holds_gm:
        raise HTTPException(status_code=400, detail="Cannot remove your own GM access")
    if holds_gm and (deactivating or (new_role is not None and new_role != "gm")):
        if not _other_active_gm_exists(current_user.hotel_id, target_id):
            raise HTTPException(status_code=409, detail="This is the hotel's last active GM; promote another GM first")


def _assert_not_active_elsewhere(user_id: str, hotel_id: str):
    """Reactivation must not silently pull someone who now works at another hotel back into this one."""
    result = supabase.table("user_roles")\
        .select("tenant_id")\
        .eq("user_id", user_id)\
        .eq("is_active", True)\
        .execute()
    if any(str(r["tenant_id"]) != str(hotel_id) for r in (result.data or [])):
        raise HTTPException(status_code=409, detail="This person has an active account at another hotel")


def _set_active(current_user: CurrentUser, user_id: str, active: bool) -> list:
    rows = tenant_role_rows(user_id, current_user.hotel_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Staff member not found")
    if active:
        _assert_not_active_elsewhere(user_id, current_user.hotel_id)
    else:
        _guard_admin_access(current_user, rows, deactivating=True)
    result = supabase.table("user_roles")\
        .update({"is_active": active})\
        .eq("user_id", user_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Staff member not found")
    return result.data


def _staff_entry(r: dict, profile: dict, email: str, custom_roles_map: dict, dept_map: dict, is_gm: bool, status: Optional[str] = None) -> dict:
    entry = {
        "id": r["id"],
        "user_id": r["user_id"],
        "hotel_id": r["tenant_id"],
        "full_name": profile.get("full_name") or "",
        "preferred_name": profile.get("preferred_name"),
        "email": email,
        "role": r["role"],
        "department_id": r.get("department_id"),
        "department_name": dept_map.get(r.get("department_id")),
        "status": status or ("active" if r.get("is_active") else "inactive"),
        "avatar_url": profile.get("avatar_url"),
        "created_at": r["created_at"],
        "custom_role_id": r.get("custom_role_id"),
        "custom_role_name": custom_roles_map.get(r.get("custom_role_id")),
    }
    if is_gm:
        entry["phone"] = profile.get("phone")
        entry["hourly_rate"] = r.get("hourly_rate")
    return entry


def _collapse_by_person(roles: list) -> list:
    """One row per person for lifecycle views: active if any role row is active, else newest row."""
    by_user: dict = {}
    for r in roles:
        by_user.setdefault(r["user_id"], []).append(r)
    collapsed = []
    for rows in by_user.values():
        rows = sorted(rows, key=lambda x: x.get("created_at") or "", reverse=True)
        active_rows = [x for x in rows if x.get("is_active")]
        pick = dict((active_rows or rows)[0])
        pick["is_active"] = bool(active_rows)
        collapsed.append(pick)
    return collapsed


# ---------------------------------------------------------------------------
# Caller-scoped endpoints
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Directory
# ---------------------------------------------------------------------------
@router.get("")
async def list_staff(
    current_user: CurrentUser = Depends(require_role(*STAFF_DIRECTORY_ROLES)),
    status: str = "active",
    department_id: Optional[str] = None,
):
    """List staff for the hotel.

    Default (`status=active`) is the operational-picker contract used by Tasks, Engineering and
    Housekeeping and is unchanged: one row per active role assignment. `status=inactive|all` is a
    GM-only management view with one row per person.
    """
    if status not in STAFF_STATUSES:
        raise HTTPException(status_code=422, detail="status must be one of: active, inactive, all")
    lifecycle_view = status != "active"
    if lifecycle_view and current_user.role not in GM_ONLY_ROLES:
        raise HTTPException(status_code=403, detail="Only a GM can view inactive staff")

    query = supabase.table("user_roles")\
        .select("id, user_id, tenant_id, role, department_id, is_active, created_at, custom_role_id, hourly_rate")\
        .eq("tenant_id", current_user.hotel_id)
    if not lifecycle_view:
        query = query.eq("is_active", True)
    roles = query.order("role").execute().data or []

    if lifecycle_view:
        roles = _collapse_by_person(roles)
        if status == "inactive":
            roles = [r for r in roles if not r["is_active"]]
    if department_id:
        roles = [r for r in roles if str(r.get("department_id")) == department_id]

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

    emails_map = _load_emails(user_ids)
    dept_map = _departments_map(current_user.hotel_id)
    is_gm = current_user.role in GM_ONLY_ROLES

    staff_list = [
        _staff_entry(
            r, profiles_map.get(r["user_id"], {}), emails_map.get(str(r["user_id"]), ""),
            custom_roles_map, dept_map, is_gm,
        )
        for r in roles
    ]
    return {"data": {"staff": staff_list, "total": len(staff_list)}}


@router.get("/departments")
async def list_staff_departments(
    current_user: CurrentUser = Depends(require_role(*STAFF_DIRECTORY_ROLES))
):
    """The hotel's real departments, for People filters and assignment pickers."""
    result = supabase.table("departments")\
        .select("id, name, code, color")\
        .eq("tenant_id", current_user.hotel_id)\
        .order("name")\
        .execute()
    return {"data": result.data or []}


@router.post("/add-direct")
async def add_staff_direct(
    body: AddStaffDirectRequest,
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Create a staff member directly without sending an invite email."""
    department_id = validate_department(body.department_id, current_user.hotel_id) if body.department_id else None
    custom_role_id = None
    if body.custom_role_id:
        custom_role_id = validate_custom_role(body.custom_role_id, current_user.hotel_id)
        assert_custom_role_fits(custom_role_id, [body.role], current_user.hotel_id)
    temp_password = body.password if body.password else secrets.token_urlsafe(12)
    created_auth_user = False

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
        created_auth_user = True
    except Exception as e:
        err_str = str(e)
        if "already been registered" in err_str or "already registered" in err_str:
            # An auth user with this email exists. Only an orphan (no profile and no role anywhere,
            # i.e. a previous half-finished add) may be adopted; anyone else belongs to a hotel and
            # must never have their password reset or profile re-pointed by another hotel's GM.
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
            except Exception:
                raise HTTPException(status_code=400, detail="Could not verify the existing account for this email")
            if not existing:
                raise HTTPException(status_code=400, detail="This email already exists but could not be located. Please contact support.")
            user_id = str(existing["id"])
            has_profile = supabase.table("user_profiles").select("id").eq("id", user_id).execute().data
            has_role = supabase.table("user_roles").select("id").eq("user_id", user_id).execute().data
            if has_profile or has_role:
                raise HTTPException(status_code=409, detail="This email already belongs to an existing account")
            try:
                supabase.auth.admin.update_user_by_id(user_id, {"password": temp_password})
            except Exception:
                raise HTTPException(status_code=400, detail="Could not set up the existing account")
        else:
            raise HTTPException(status_code=400, detail="Could not create the account")

    try:
        profile_row = {
            "id": user_id,
            "tenant_id": current_user.hotel_id,
            "full_name": body.full_name,
            "preferred_name": body.preferred_name or (body.full_name.split()[0] if body.full_name else body.full_name),
        }
        if body.phone:
            profile_row["phone"] = body.phone
        supabase.table("user_profiles").upsert(profile_row).execute()

        role_data = {
            "user_id": user_id,
            "tenant_id": current_user.hotel_id,
            "role": body.role,
            "is_active": True,
        }
        if department_id:
            role_data["department_id"] = department_id
        if custom_role_id:
            role_data["custom_role_id"] = custom_role_id
        supabase.table("user_roles").upsert(role_data, on_conflict="user_id,tenant_id,role").execute()
    except Exception:
        if created_auth_user:
            try:
                supabase.auth.admin.delete_user(user_id)
            except Exception:
                logger.warning("add-direct cleanup failed for a partially created account")
        raise HTTPException(status_code=500, detail="Failed to create staff record")
    return {"data": {"success": True, "user_id": user_id, "full_name": body.full_name, "temp_password": temp_password}}


# ---------------------------------------------------------------------------
# Custom roles
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Per-person endpoints (keep after all static /staff/* GET routes)
# ---------------------------------------------------------------------------
@router.get("/{user_id}")
async def get_staff_member(
    user_id: str,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """Full profile for one person in this hotel (active or deactivated). 404 across tenants."""
    rows = tenant_role_rows(user_id, current_user.hotel_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Staff member not found")
    person = _collapse_by_person(rows)[0]

    profile_res = supabase.table("user_profiles")\
        .select("id, full_name, preferred_name, avatar_url, phone")\
        .eq("id", user_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()
    profile = (profile_res.data or [{}])[0]

    custom_roles_map: dict = {}
    if person.get("custom_role_id"):
        cr = supabase.table("custom_roles").select("id, name").eq("id", person["custom_role_id"]).execute()
        custom_roles_map = {c["id"]: c["name"] for c in (cr.data or [])}

    emails = _load_emails([user_id])
    entry = _staff_entry(
        person, profile, emails.get(str(user_id), ""),
        custom_roles_map, _departments_map(current_user.hotel_id), True,
    )
    return {"data": entry}


@router.patch("/{user_id}/profile")
async def update_staff_profile(
    user_id: str,
    body: UpdateStaffMemberProfileRequest,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """Edit name, preferred name, phone or avatar. Email is intentionally not editable here."""
    update_data = body.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(status_code=422, detail="No valid fields to update")
    if "full_name" in update_data and not update_data["full_name"]:
        raise HTTPException(status_code=422, detail="full_name cannot be empty")
    avatar = update_data.get("avatar_url")
    if avatar and not avatar.lower().startswith(("https://", "http://")):
        raise HTTPException(status_code=422, detail="avatar_url must be an http(s) URL")

    if not tenant_role_rows(user_id, current_user.hotel_id):
        raise HTTPException(status_code=404, detail="Staff member not found")

    result = supabase.table("user_profiles")\
        .update(update_data)\
        .eq("id", user_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Staff profile not found")
    row = result.data[0]
    return {"data": {k: row.get(k) for k in ("id", "full_name", "preferred_name", "phone", "avatar_url")}}


@router.post("/{user_id}/reactivate")
async def reactivate_staff(
    user_id: str,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """Restore a deactivated person's access. History and relationships were never removed."""
    _set_active(current_user, user_id, True)
    return {"data": {"success": True, "reactivated_user_id": user_id, "status": "active"}}


@router.patch("/{staff_id}")
async def update_staff(
    staff_id: str,
    body: dict,
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Update a staff member's role, department, active status, custom role, or hourly_rate."""
    allowed_fields = {"role", "department_id", "is_active", "custom_role_id", "hourly_rate"}
    update_data = {k: v for k, v in body.items() if k in allowed_fields}

    if "hourly_rate" in update_data and update_data["hourly_rate"] is not None:
        try:
            rate = float(update_data["hourly_rate"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="hourly_rate must be a number")
        if rate < 0 or rate > 500:
            raise HTTPException(status_code=422, detail="hourly_rate must be between 0 and 500")
        update_data["hourly_rate"] = rate

    if not update_data:
        raise HTTPException(status_code=422, detail="No valid fields to update")

    if update_data.keys() & {"role", "is_active", "department_id", "custom_role_id"}:
        rows = tenant_role_rows(staff_id, current_user.hotel_id)
        if not rows:
            raise HTTPException(status_code=404, detail="Staff member not found")

        if "role" in update_data:
            new_role = update_data["role"]
            if new_role not in ALL_ROLES:
                raise HTTPException(status_code=422, detail="Unknown role")
            if len(rows) > 1:
                raise HTTPException(status_code=409, detail="This person has multiple role assignments; change them individually")
            _guard_admin_access(current_user, rows, new_role=new_role)
        if "is_active" in update_data:
            if not isinstance(update_data["is_active"], bool):
                raise HTTPException(status_code=422, detail="is_active must be true or false")
            if update_data["is_active"]:
                _assert_not_active_elsewhere(staff_id, current_user.hotel_id)
            else:
                _guard_admin_access(current_user, rows, deactivating=True)
        if update_data.get("department_id") is not None:
            update_data["department_id"] = validate_department(update_data["department_id"], current_user.hotel_id)
        if update_data.get("custom_role_id") is not None:
            update_data["custom_role_id"] = validate_custom_role(update_data["custom_role_id"], current_user.hotel_id)
        if "role" in update_data or update_data.get("custom_role_id") is not None:
            resulting_roles = [update_data["role"]] if "role" in update_data else [r["role"] for r in rows if r.get("is_active")]
            effective_custom = update_data["custom_role_id"] if "custom_role_id" in update_data else rows[0].get("custom_role_id")
            if effective_custom:
                assert_custom_role_fits(effective_custom, resulting_roles, current_user.hotel_id)

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
    _set_active(current_user, staff_id, False)
    return {"data": {"success": True, "deactivated_user_id": staff_id}}
