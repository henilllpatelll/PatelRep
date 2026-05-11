import re
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from middleware.auth import get_current_user, get_current_user_no_hotel, require_role, CurrentUser
from models.requests import CreateHotelRequest, UpdateHotelRequest
from core.database import supabase

router = APIRouter(prefix="/hotels", tags=["hotels"])

ALL_STAFF_ROLES = ("gm", "housekeeping_supervisor", "chief_engineer", "front_desk", "housekeeper", "engineer")

DEFAULT_DEPARTMENTS = [
    {"name": "Housekeeping", "code": "HK",   "color": "#059669"},
    {"name": "Engineering",  "code": "ENG",  "color": "#2563EB"},
    {"name": "Front Desk",   "code": "FD",   "color": "#D97706"},
    {"name": "Management",   "code": "MGMT", "color": "#7C3AED"},
]


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
    if not update_data:
        raise HTTPException(status_code=422, detail="No valid fields to update")

    result = supabase.table("tenants").update(update_data).eq("id", hotel_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Hotel not found")

    return {"data": result.data[0]}


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
