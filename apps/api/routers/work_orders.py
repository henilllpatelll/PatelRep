from fastapi import APIRouter, Depends, Query
from typing import Optional
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import CreateWorkOrderRequest, CompleteWorkOrderRequest, UpdateWorkOrderRequest, AddCommentRequest
from core.database import supabase
from datetime import datetime, timedelta

router = APIRouter(prefix="/work-orders", tags=["work-orders"])

SLA_MINUTES = {"urgent": 60, "normal": 240, "low": 480}


@router.post("")
async def create_work_order(
    request: CreateWorkOrderRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    sla = SLA_MINUTES.get(request.priority, 240)
    due_at = datetime.utcnow() + timedelta(minutes=sla)

    wo_data = {
        "tenant_id": current_user.hotel_id,
        "title": request.title or request.nl_input,
        "description": request.description,
        "original_nl_input": request.nl_input,
        "category": request.category,
        "priority": request.priority,
        "room_id": str(request.room_id) if request.room_id else None,
        "location_text": request.location_text,
        "asset_id": str(request.asset_id) if request.asset_id else None,
        "assigned_to": str(request.assigned_to) if request.assigned_to else None,
        "created_by": current_user.user_id,
        "sla_minutes": sla,
        "due_at": due_at.isoformat(),
    }
    result = supabase.table("work_orders").insert(wo_data).execute()
    return {"data": result.data[0] if result.data else None}


@router.get("")
async def list_work_orders(
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    assigned_to: Optional[str] = Query(None),
    page: int = Query(1),
    per_page: int = Query(20),
    current_user: CurrentUser = Depends(get_current_user)
):
    query = supabase.table("work_orders")\
        .select("*, rooms(room_number), assets(name)")\
        .eq("tenant_id", current_user.hotel_id)\
        .order("created_at", desc=True)\
        .range((page - 1) * per_page, page * per_page - 1)

    if status: query = query.eq("status", status)
    if category: query = query.eq("category", category)
    if priority: query = query.eq("priority", priority)

    if current_user.role == "engineer":
        query = query.or_(f"assigned_to.eq.{current_user.user_id},assigned_to.is.null")

    result = query.execute()
    return {"data": result.data, "meta": {"page": page, "per_page": per_page}}


@router.get("/{wo_id}")
async def get_work_order(wo_id: str, current_user: CurrentUser = Depends(get_current_user)):
    result = supabase.table("work_orders")\
        .select("*, rooms(room_number, floor), assets(*), work_order_photos(*), work_order_comments(*)")\
        .eq("id", wo_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .single()\
        .execute()
    return {"data": result.data}


@router.post("/{wo_id}/claim")
async def claim_work_order(
    wo_id: str,
    current_user: CurrentUser = Depends(require_role("engineer", "chief_engineer"))
):
    result = supabase.table("work_orders")\
        .update({"assigned_to": current_user.user_id, "status": "in_progress", "started_at": datetime.utcnow().isoformat()})\
        .eq("id", wo_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("status", "open")\
        .execute()
    return {"data": result.data[0] if result.data else None}


@router.post("/{wo_id}/complete")
async def complete_work_order(
    wo_id: str,
    request: CompleteWorkOrderRequest,
    current_user: CurrentUser = Depends(require_role("engineer", "chief_engineer", "gm"))
):
    result = supabase.table("work_orders")\
        .update({
            "status": "completed",
            "completed_at": datetime.utcnow().isoformat(),
            "notes": request.notes,
            "labor_hours": request.labor_hours,
            "parts_used": request.parts_used,
        })\
        .eq("id", wo_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()
    return {"data": result.data[0] if result.data else None}


@router.patch("/{wo_id}")
async def update_work_order(
    wo_id: str,
    request: UpdateWorkOrderRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    if request.status == "cancelled" and current_user.role not in ("gm", "chief_engineer"):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Only GM or Chief Engineer can cancel work orders")

    update_data = request.model_dump(exclude_none=True)
    if "assigned_to" in update_data:
        update_data["assigned_to"] = str(update_data["assigned_to"])

    result = supabase.table("work_orders") \
        .update(update_data) \
        .eq("id", wo_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
    return {"data": result.data[0] if result.data else None}


@router.post("/{wo_id}/comments")
async def add_comment(
    wo_id: str,
    request: AddCommentRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    result = supabase.table("work_order_comments").insert({
        "work_order_id": wo_id,
        "tenant_id": current_user.hotel_id,
        "user_id": current_user.user_id,
        "comment": request.comment,
        "is_system": False,
    }).execute()
    return {"data": result.data[0] if result.data else None}
