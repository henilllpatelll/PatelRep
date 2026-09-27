"""Focused Engineering vendor directory and work-order engagements."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from core.database import supabase
from middleware.auth import CurrentUser, get_current_user, require_role
from models.requests import (
    CreateEngineeringVendorRequest,
    CreateVendorEngagementRequest,
    UpdateEngineeringVendorRequest,
    UpdateVendorEngagementRequest,
)


router = APIRouter(prefix="/engineering/vendors", tags=["engineering-vendors"])
MANAGE_VENDOR_ROLES = ("gm", "chief_engineer")
ENGAGEMENT_ROLES = ("gm", "chief_engineer", "engineer")
_ALLOWED_ENGAGEMENT_TRANSITIONS = {
    "requested": {"accepted", "cancelled"},
    "accepted": {"en_route", "cancelled"},
    "en_route": {"on_site", "cancelled"},
    "on_site": {"completed", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}


def _vendor_or_404(vendor_id: str, user: CurrentUser) -> dict:
    result = supabase.table("engineering_vendors").select("*").eq("id", vendor_id).eq("tenant_id", user.hotel_id).maybe_single().execute()
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return result.data


def _work_order_or_404(work_order_id: str, user: CurrentUser) -> dict:
    result = supabase.table("work_orders").select("id, status").eq("id", work_order_id).eq("tenant_id", user.hotel_id).maybe_single().execute()
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Work order not found")
    return result.data


def _audit(*, user: CurrentUser, resource_type: str, resource_id: str, action: str, old_state: dict, new_state: dict) -> None:
    supabase.table("operational_audit_events").insert({
        "tenant_id": user.hotel_id, "resource_type": resource_type, "resource_id": resource_id,
        "action": action, "actor_id": user.user_id, "actor_role": user.role,
        "old_state": old_state, "new_state": new_state, "source": "web",
    }).execute()


def _metrics(engagements: list[dict]) -> dict:
    now = datetime.now(timezone.utc)
    year_ago = now.replace(year=now.year - 1)
    recent = [item for item in engagements if item.get("completed_at") and datetime.fromisoformat(item["completed_at"].replace("Z", "+00:00")) >= year_ago]
    def average(start: str, end: str) -> int | None:
        durations = []
        for item in recent:
            if item.get(start) and item.get(end):
                durations.append((datetime.fromisoformat(item[end].replace("Z", "+00:00")) - datetime.fromisoformat(item[start].replace("Z", "+00:00"))).total_seconds() / 60)
        return round(sum(durations) / len(durations)) if durations else None
    return {
        "jobs": len(recent),
        "average_acceptance_minutes": average("requested_at", "accepted_at"),
        "average_arrival_minutes": average("requested_at", "arrived_at"),
        "average_service_minutes": average("arrived_at", "completed_at"),
        "spend": sum(float(item.get("invoice_amount") or 0) for item in recent),
        "emergency_jobs": sum(item.get("service_type") == "emergency" for item in recent),
    }


@router.get("")
async def list_vendors(
    q: str | None = Query(None),
    trade: str | None = Query(None),
    active_only: bool = Query(True),
    current_user: CurrentUser = Depends(get_current_user),
):
    query = supabase.table("engineering_vendors").select("*").eq("tenant_id", current_user.hotel_id).order("name")
    if active_only:
        query = query.eq("is_active", True)
    if q:
        query = query.ilike("name", f"%{q}%")
    rows = query.execute().data or []
    if trade:
        rows = [row for row in rows if trade in (row.get("trades") or [])]
    engagements = supabase.table("work_order_vendor_engagements").select("vendor_id, requested_at, accepted_at, arrived_at, completed_at, invoice_amount, service_type").eq("tenant_id", current_user.hotel_id).execute().data or []
    by_vendor: dict[str, list[dict]] = {}
    for engagement in engagements:
        by_vendor.setdefault(engagement["vendor_id"], []).append(engagement)
    return {"data": [{**row, "performance": _metrics(by_vendor.get(row["id"], []))} for row in rows]}


@router.post("")
async def create_vendor(request: CreateEngineeringVendorRequest, current_user: CurrentUser = Depends(require_role(*MANAGE_VENDOR_ROLES))):
    payload = request.model_dump(exclude_none=True)
    payload["tenant_id"] = current_user.hotel_id
    if payload.get("insurance_expires_at"):
        payload["insurance_expires_at"] = payload["insurance_expires_at"].isoformat()
    result = supabase.table("engineering_vendors").insert(payload).execute()
    vendor = result.data[0]
    _audit(user=current_user, resource_type="engineering_vendor", resource_id=vendor["id"], action="vendor.created", old_state={}, new_state={"name": vendor["name"]})
    return {"data": vendor}


@router.get("/{vendor_id}")
async def get_vendor(vendor_id: str, current_user: CurrentUser = Depends(get_current_user)):
    vendor = _vendor_or_404(vendor_id, current_user)
    engagements = supabase.table("work_order_vendor_engagements").select("*, work_orders(id, work_order_number, title, status, asset_id)").eq("tenant_id", current_user.hotel_id).eq("vendor_id", vendor_id).order("requested_at", desc=True).execute().data or []
    return {"data": {**vendor, "performance": _metrics(engagements), "engagements": engagements}}


@router.patch("/{vendor_id}")
async def update_vendor(vendor_id: str, request: UpdateEngineeringVendorRequest, current_user: CurrentUser = Depends(require_role(*MANAGE_VENDOR_ROLES))):
    previous = _vendor_or_404(vendor_id, current_user)
    payload = request.model_dump(exclude_none=True)
    if not payload:
        return {"data": previous}
    if payload.get("insurance_expires_at"):
        payload["insurance_expires_at"] = payload["insurance_expires_at"].isoformat()
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = supabase.table("engineering_vendors").update(payload).eq("id", vendor_id).eq("tenant_id", current_user.hotel_id).execute()
    vendor = result.data[0]
    _audit(user=current_user, resource_type="engineering_vendor", resource_id=vendor_id, action="vendor.updated", old_state={key: previous.get(key) for key in payload}, new_state=payload)
    return {"data": vendor}


@router.get("/work-orders/{work_order_id}/engagements")
async def list_work_order_vendor_engagements(work_order_id: str, current_user: CurrentUser = Depends(get_current_user)):
    _work_order_or_404(work_order_id, current_user)
    result = supabase.table("work_order_vendor_engagements").select("*, engineering_vendors(*)").eq("tenant_id", current_user.hotel_id).eq("work_order_id", work_order_id).order("requested_at", desc=True).execute()
    return {"data": result.data or []}


@router.post("/work-orders/{work_order_id}/engagements")
async def contact_vendor(work_order_id: str, request: CreateVendorEngagementRequest, current_user: CurrentUser = Depends(require_role(*ENGAGEMENT_ROLES))):
    work_order = _work_order_or_404(work_order_id, current_user)
    _vendor_or_404(str(request.vendor_id), current_user)
    payload = request.model_dump(exclude={"mark_work_order_waiting"}, exclude_none=True)
    payload.update({"tenant_id": current_user.hotel_id, "work_order_id": work_order_id, "vendor_id": str(request.vendor_id), "created_by": current_user.user_id})
    if payload.get("expected_arrival_at"):
        payload["expected_arrival_at"] = payload["expected_arrival_at"].isoformat()
    result = supabase.table("work_order_vendor_engagements").insert(payload).execute()
    engagement = result.data[0]
    _audit(user=current_user, resource_type="work_order_vendor_engagement", resource_id=engagement["id"], action="vendor.requested", old_state={}, new_state={"work_order_id": work_order_id, "vendor_id": str(request.vendor_id)})
    if request.mark_work_order_waiting and work_order["status"] in {"open", "in_progress", "escalated"}:
        from routers.work_orders import _execute_work_order_transition
        from services.work_orders.transitions import TransitionRequest, validate_work_order_transition
        decision = validate_work_order_transition(current_status=work_order["status"], request=TransitionRequest(status="on_hold", reason_code="awaiting_vendor"), actor_role=current_user.role)
        _execute_work_order_transition(work_order_id=work_order_id, current_user=current_user, decision=decision, source="web")
    return {"data": engagement}


@router.patch("/engagements/{engagement_id}")
async def update_vendor_engagement(engagement_id: str, request: UpdateVendorEngagementRequest, current_user: CurrentUser = Depends(require_role(*ENGAGEMENT_ROLES))):
    existing_result = supabase.table("work_order_vendor_engagements").select("*").eq("id", engagement_id).eq("tenant_id", current_user.hotel_id).maybe_single().execute()
    existing = existing_result.data if existing_result else None
    if not existing:
        raise HTTPException(status_code=404, detail="Vendor engagement not found")
    payload = request.model_dump(exclude_none=True)
    requested_status = payload.get("status")
    if requested_status and requested_status != existing["status"]:
        if requested_status not in _ALLOWED_ENGAGEMENT_TRANSITIONS[existing["status"]]:
            raise HTTPException(status_code=409, detail="Vendor engagement status cannot move backward or skip a step")
        now = datetime.now(timezone.utc).isoformat()
        timestamp_field = {"accepted": "accepted_at", "on_site": "arrived_at", "completed": "completed_at"}.get(requested_status)
        if timestamp_field:
            payload[timestamp_field] = now
    if payload.get("expected_arrival_at"):
        payload["expected_arrival_at"] = payload["expected_arrival_at"].isoformat()
    if not payload:
        return {"data": existing}
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = supabase.table("work_order_vendor_engagements").update(payload).eq("id", engagement_id).eq("tenant_id", current_user.hotel_id).execute()
    engagement = result.data[0]
    _audit(user=current_user, resource_type="work_order_vendor_engagement", resource_id=engagement_id, action="vendor.engagement_updated", old_state={key: existing.get(key) for key in payload}, new_state=payload)
    return {"data": engagement}
