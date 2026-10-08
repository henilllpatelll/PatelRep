import re
from datetime import datetime, timedelta, timezone
from typing import Any
from fastapi import APIRouter, Body, Depends, HTTPException
from middleware.auth import get_current_user, get_current_user_no_hotel, require_role, CurrentUser
from models.requests import CreateHotelRequest, UpdateHotelRequest, UpdateHousekeepingSettingsRequest
from core.database import supabase
from core.roles import ALL_STAFF_ROLES, LEGACY_MODULE_ALIASES, unsupported_modules
from services.settings_audit import record_settings_event

router = APIRouter(prefix="/hotels", tags=["hotels"])

DEFAULT_DEPARTMENTS = [
    {"name": "Housekeeping", "code": "HK",   "color": "#059669"},
    {"name": "Engineering",  "code": "ENG",  "color": "#2563EB"},
    {"name": "Front Desk",   "code": "FD",   "color": "#D97706"},
    {"name": "Management",   "code": "MGMT", "color": "#7C3AED"},
]

DEFAULT_HOUSEKEEPING_CREDIT_WEIGHTS = {"DEP": 3, "FULL": 2, "LIGHT": 1}
DEFAULT_HOUSEKEEPING_TARGET_CREDITS = 16
DEFAULT_HOUSEKEEPING_ASSIGNMENT_PREFERENCES = {
    "prioritize_guest_waiting": True,
    "prioritize_rush": True,
    "prioritize_earliest_arrival": True,
    "balance_workload": True,
    "minimize_reassignment": True,
    "avoid_on_break": True,
    "exclude_off_shift": True,
    "exclude_unavailable": True,
    "prefer_same_building": True,
    "prefer_same_floor": True,
}


def _housekeeping_settings_payload(row: dict[str, Any] | None) -> dict[str, Any]:
    row = row or {}
    target = row.get("housekeeping_target_credits")
    weights = row.get("housekeeping_credit_weights")
    overrides = row.get("housekeeping_capacity_overrides")
    saved_preferences = row.get("housekeeping_assignment_preferences")
    preferences = {
        **DEFAULT_HOUSEKEEPING_ASSIGNMENT_PREFERENCES,
        **({key: value for key, value in saved_preferences.items() if key in DEFAULT_HOUSEKEEPING_ASSIGNMENT_PREFERENCES and isinstance(value, bool)} if isinstance(saved_preferences, dict) else {}),
    }
    return {
        "default_target_credits": target if isinstance(target, (int, float)) and target > 0 else DEFAULT_HOUSEKEEPING_TARGET_CREDITS,
        "credit_weights": weights if isinstance(weights, dict) and set(weights) == set(DEFAULT_HOUSEKEEPING_CREDIT_WEIGHTS) else DEFAULT_HOUSEKEEPING_CREDIT_WEIGHTS,
        "capacity_overrides": overrides if isinstance(overrides, dict) else {},
        "assignment_preferences": preferences,
    }


def _slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")


@router.post("")
async def create_hotel(
    body: CreateHotelRequest,
    current_user: CurrentUser = Depends(get_current_user_no_hotel),
):
    base_slug = _slugify(body.name)

    # Ensure slug uniqueness by appending a counter if needed
    slug = base_slug
    counter = 1
    while True:
        existing = supabase.table("tenants").select("id").eq("slug", slug).execute()
        if not existing.data:
            break
        slug = f"{base_slug}-{counter}"
        counter += 1

    trial_ends_at = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()

    # 1. Create the tenant row
    tenant_result = supabase.table("tenants").insert({
        "name": body.name,
        "slug": slug,
        "address": body.address,
        "city": body.city,
        "state": body.state,
        "zip": body.zip,
        "phone": body.phone,
        "room_count": body.room_count,
        "timezone": body.timezone,
        "is_active": True,
        "trial_ends_at": trial_ends_at,
    }).execute()

    if not tenant_result.data:
        raise HTTPException(status_code=500, detail="Failed to create hotel")

    hotel = tenant_result.data[0]
    hotel_id = hotel["id"]

    # 2. Create default departments
    dept_rows = [{"tenant_id": hotel_id, **dept} for dept in DEFAULT_DEPARTMENTS]
    supabase.table("departments").insert(dept_rows).execute()

    # 3. Link the creator as GM for this hotel
    supabase.table("user_roles").insert({
        "user_id": current_user.user_id,
        "tenant_id": hotel_id,
        "role": "gm",
        "is_active": True,
    }).execute()

    # 4. Create trial subscription
    supabase.table("subscriptions").insert({
        "tenant_id": hotel_id,
        "stripe_customer_id": "",
        "plan_status": "trialing",
        "trial_end": trial_ends_at,
        "base_fee_cents": 9900,
        "credits_included": 5000,
        "cap_cents": body.room_count * 250,
    }).execute()

    # 5. Create Stripe customer (non-blocking — don't fail hotel creation if Stripe fails)
    try:
        import stripe
        from core.config import settings
        stripe.api_key = settings.stripe_secret_key
        customer = stripe.Customer.create(
            email=current_user.email or "",
            name=body.name,
            metadata={"hotel_id": hotel_id, "room_count": str(body.room_count)},
        )
        # Update subscription with stripe_customer_id
        supabase.table("subscriptions").update({
            "stripe_customer_id": customer.id
        }).eq("tenant_id", hotel_id).execute()
    except Exception:
        pass  # Don't fail hotel creation if Stripe is unavailable

    sub_result = supabase.table("subscriptions").select("plan_status, credits_included, cap_cents").eq("tenant_id", hotel_id).maybe_single().execute()
    subscription = sub_result.data or {"plan_status": "trialing", "credits_included": 5000}

    return {"data": {"hotel": hotel, "subscription": subscription}}


@router.get("/{hotel_id}")
async def get_hotel(
    hotel_id: str,
    current_user: CurrentUser = Depends(require_role(*ALL_STAFF_ROLES)),
):
    if current_user.hotel_id != hotel_id:
        raise HTTPException(status_code=403, detail="Access denied to this hotel")

    result = supabase.table("tenants").select("*").eq("id", hotel_id).maybe_single().execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Hotel not found")

    return {"data": result.data}


@router.patch("/{hotel_id}")
async def update_hotel(
    hotel_id: str,
    body: UpdateHotelRequest,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    if current_user.hotel_id != hotel_id:
        raise HTTPException(status_code=403, detail="Access denied to this hotel")

    update_data = body.model_dump(exclude_none=True)
    # average_daily_rate_cents is nullable: a GM can clear it by sending explicit null,
    # which exclude_none would otherwise drop, stranding a stale ADR on the D-07 estimate.
    fields_set = body.model_dump(exclude_unset=True)
    if "average_daily_rate_cents" in fields_set and fields_set["average_daily_rate_cents"] is None:
        update_data["average_daily_rate_cents"] = None
    if not update_data:
        raise HTTPException(status_code=422, detail="No valid fields to update")
    if "front_desk_modules" in update_data:
        # Front Desk can only be given modules its role can actually open; the rest would show in the
        # sidebar and then bounce at the route guard.
        bad = unsupported_modules(update_data["front_desk_modules"], "front_desk")
        if bad:
            raise HTTPException(status_code=422, detail=f"These modules are not available to Front Desk: {', '.join(bad)}")
        update_data["front_desk_modules"] = sorted({LEGACY_MODULE_ALIASES.get(m, m) for m in update_data["front_desk_modules"]})

    before = _tenant_snapshot(hotel_id, list(update_data))
    result = supabase.table("tenants").update(update_data).eq("id", hotel_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Hotel not found")

    after = result.data[0]
    profile_keys = [k for k in update_data if k != "front_desk_modules"]
    if profile_keys:
        record_settings_event(
            db=supabase, current_user=current_user, action="settings.property.updated",
            resource_type="property_profile", resource_id=hotel_id,
            old_state={k: before[k] for k in profile_keys if k in before},
            new_state={k: after.get(k) for k in profile_keys},
        )
    if "front_desk_modules" in update_data:
        record_settings_event(
            db=supabase, current_user=current_user, action="settings.front_desk_access.updated",
            resource_type="front_desk_access", resource_id=hotel_id,
            old_state={"modules": before["front_desk_modules"]} if "front_desk_modules" in before else {},
            new_state={"modules": after.get("front_desk_modules")},
        )

    return {"data": after}


def _tenant_snapshot(hotel_id: str, columns: list[str]) -> dict:
    """Current values of ``columns`` for the audit 'before' state. Empty when it can't be read (then 'before' is simply not recorded)."""
    try:
        res = supabase.table("tenants").select(", ".join(columns)).eq("id", hotel_id).maybe_single().execute()
        return dict(res.data) if res and res.data else {}
    except Exception:  # noqa: BLE001 - never block the mutation on an audit read
        return {}


@router.get("/{hotel_id}/housekeeping-settings")
async def get_housekeeping_settings(
    hotel_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    if current_user.hotel_id != hotel_id:
        raise HTTPException(status_code=403, detail="Access denied to this hotel")
    result = supabase.table("tenants").select(
        "housekeeping_target_credits, housekeeping_credit_weights, housekeeping_capacity_overrides, housekeeping_assignment_preferences"
    ).eq("id", hotel_id).maybe_single().execute()
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Hotel not found")
    return {"data": _housekeeping_settings_payload(result.data)}


@router.put("/{hotel_id}/housekeeping-settings")
async def update_housekeeping_settings(
    hotel_id: str,
    body: UpdateHousekeepingSettingsRequest,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    if current_user.hotel_id != hotel_id:
        raise HTTPException(status_code=403, detail="Access denied to this hotel")
    fields = body.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(status_code=422, detail="No valid settings to update")
    column_map = {
        "default_target_credits": "housekeeping_target_credits",
        "credit_weights": "housekeeping_credit_weights",
        "capacity_overrides": "housekeeping_capacity_overrides",
        "assignment_preferences": "housekeeping_assignment_preferences",
    }
    update_data = {column_map[key]: value for key, value in fields.items()}
    before = _tenant_snapshot(hotel_id, list(update_data))
    result = supabase.table("tenants").update(update_data).eq("id", hotel_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Hotel not found")
    after = result.data[0]

    workload_old: dict = {}
    workload_new: dict = {}
    if "housekeeping_target_credits" in update_data:
        if "housekeeping_target_credits" in before:
            workload_old["default_target_credits"] = before["housekeeping_target_credits"]
        workload_new["default_target_credits"] = after.get("housekeeping_target_credits")
    if "housekeeping_credit_weights" in update_data:
        if "housekeeping_credit_weights" in before:
            workload_old["credit_weights"] = before["housekeeping_credit_weights"]
        workload_new["credit_weights"] = after.get("housekeeping_credit_weights")
    if "housekeeping_capacity_overrides" in update_data:
        # Only the number of overrides is recorded (not per-staff values) to keep this log free of staff-level detail.
        if "housekeeping_capacity_overrides" in before:
            workload_old["capacity_override_count"] = len(before["housekeeping_capacity_overrides"] or {})
        workload_new["capacity_override_count"] = len(after.get("housekeeping_capacity_overrides") or {})
    if workload_new:
        record_settings_event(
            db=supabase, current_user=current_user, action="settings.housekeeping_workload.updated",
            resource_type="housekeeping_workload", resource_id=hotel_id,
            old_state=workload_old, new_state=workload_new,
        )
    if "housekeeping_assignment_preferences" in update_data:
        record_settings_event(
            db=supabase, current_user=current_user, action="settings.housekeeping_assignment.updated",
            resource_type="housekeeping_assignment", resource_id=hotel_id,
            old_state={"preferences": before["housekeeping_assignment_preferences"] or {}} if "housekeeping_assignment_preferences" in before else {},
            new_state={"preferences": after.get("housekeeping_assignment_preferences") or {}},
        )
    return {"data": _housekeeping_settings_payload(after)}


@router.get("/{hotel_id}/layout")
async def get_hotel_layout(
    hotel_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    if current_user.hotel_id != hotel_id:
        raise HTTPException(status_code=403, detail="Access denied to this hotel")
    result = supabase.table("tenants").select("layout").eq("id", hotel_id).maybe_single().execute()
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Hotel not found")
    return {"data": {"layout": result.data.get("layout")}}


@router.put("/{hotel_id}/layout")
async def set_hotel_layout(
    hotel_id: str,
    layout: Any = Body(...),
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """
    Store or replace the hotel's spatial layout JSON.
    The layout is injected into AI assignment suggestions and copilot context
    so the AI can reason about building proximity and optimal routing.
    """
    if current_user.hotel_id != hotel_id:
        raise HTTPException(status_code=403, detail="Access denied to this hotel")
    if not isinstance(layout, dict):
        raise HTTPException(status_code=422, detail="Layout must be a JSON object")
    result = supabase.table("tenants").update({"layout": layout}).eq("id", hotel_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Hotel not found")
    record_settings_event(
        db=supabase, current_user=current_user, action="settings.property.layout_updated",
        resource_type="property_layout", resource_id=hotel_id,
        new_state={"section_count": len(layout)}, only_changes=False,
    )
    return {"data": {"updated": True}}


@router.get("/{hotel_id}/stats")
async def get_hotel_stats(
    hotel_id: str,
    current_user: CurrentUser = Depends(require_role(*ALL_STAFF_ROLES)),
):
    if current_user.hotel_id != hotel_id:
        raise HTTPException(status_code=403, detail="Access denied to this hotel")

    # Count active rooms
    rooms_result = supabase.table("rooms")\
        .select("id", count="exact")\
        .eq("tenant_id", hotel_id)\
        .eq("is_active", True)\
        .execute()
    room_count = rooms_result.count if rooms_result.count is not None else 0

    # Count active staff
    staff_result = supabase.table("user_roles")\
        .select("id", count="exact")\
        .eq("tenant_id", hotel_id)\
        .eq("is_active", True)\
        .execute()
    staff_count = staff_result.count if staff_result.count is not None else 0

    # Count open tasks (open + in_progress)
    tasks_result = supabase.table("tasks")\
        .select("id", count="exact")\
        .eq("tenant_id", hotel_id)\
        .in_("status", ["open", "in_progress"])\
        .execute()
    open_tasks = tasks_result.count if tasks_result.count is not None else 0

    # Count open work orders (open + in_progress + on_hold)
    wo_result = supabase.table("work_orders")\
        .select("id", count="exact")\
        .eq("tenant_id", hotel_id)\
        .in_("status", ["open", "in_progress", "on_hold"])\
        .execute()
    open_work_orders = wo_result.count if wo_result.count is not None else 0

    return {
        "data": {
            "hotel_id": hotel_id,
            "room_count": room_count,
            "active_staff": staff_count,
            "open_tasks": open_tasks,
            "open_work_orders": open_work_orders,
        }
    }


@router.get("/{hotel_id}/departments")
async def list_hotel_departments(
    hotel_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    """List all departments for a hotel."""
    if current_user.hotel_id != hotel_id:
        raise HTTPException(status_code=403, detail="Access denied to this hotel")

    result = supabase.table("departments")\
        .select("id, name, code")\
        .eq("tenant_id", hotel_id)\
        .order("name")\
        .execute()
    return {"data": result.data}
