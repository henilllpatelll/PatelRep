import asyncio
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import CreateWorkOrderRequest, CompleteWorkOrderRequest, UpdateWorkOrderRequest, AddCommentRequest
from core.database import supabase
from datetime import datetime, timedelta, timezone

router = APIRouter(prefix="/work-orders", tags=["work-orders"])

SLA_MINUTES = {"urgent": 60, "normal": 240, "low": 480}


@router.post("")
async def create_work_order(
    request: CreateWorkOrderRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    sla = SLA_MINUTES.get(request.priority, 240)
    due_at = datetime.now(timezone.utc) + timedelta(minutes=sla)

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
    if current_user.role == "engineer":
        # OR-filter (assigned_to=me OR assigned_to IS NULL) forces a seq-scan.
        # Two indexed queries + Python merge is faster under concurrent load.
        fetch_up_to = page * per_page  # enough rows to slice the requested page

        def _base():
            q = supabase.table("work_orders") \
                .select("*, rooms(room_number), assets(name)") \
                .eq("tenant_id", current_user.hotel_id) \
                .order("created_at", desc=True) \
                .range(0, fetch_up_to - 1)
            if status:
                q = q.eq("status", status)
            if category:
                q = q.eq("category", category)
            if priority:
                q = q.eq("priority", priority)
            return q

        r_mine = _base().eq("assigned_to", current_user.user_id).execute()
        r_open = _base().is_("assigned_to", "null").execute()

        seen: set = set()
        merged = []
        for row in (r_mine.data or []) + (r_open.data or []):
            if row["id"] not in seen:
                seen.add(row["id"])
                merged.append(row)
        merged.sort(key=lambda r: r["created_at"], reverse=True)

        start = (page - 1) * per_page
        return {"data": merged[start: start + per_page], "meta": {"page": page, "per_page": per_page}}

    query = supabase.table("work_orders") \
        .select("*, rooms(room_number), assets(name)") \
        .eq("tenant_id", current_user.hotel_id) \
        .order("created_at", desc=True) \
        .range((page - 1) * per_page, page * per_page - 1)

    if status:
        query = query.eq("status", status)
    if category:
        query = query.eq("category", category)
    if priority:
        query = query.eq("priority", priority)
    if assigned_to:
        query = query.eq("assigned_to", assigned_to)

    result = query.execute()
    return {"data": result.data, "meta": {"page": page, "per_page": per_page}}


@router.get("/{wo_id}")
async def get_work_order(wo_id: str, current_user: CurrentUser = Depends(get_current_user)):
    result = supabase.table("work_orders")\
        .select("*, rooms(room_number, floor), assets(*), work_order_photos(*), work_order_comments(*)")\
        .eq("id", wo_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Work order not found")
    return {"data": result.data[0]}


async def _send_wo_assignment_push(engineer_id: str, wo_id: str, title: str) -> None:
    """Fire-and-forget push notification to engineer on work order assignment."""
    try:
        profile = supabase.table("user_profiles")\
            .select("expo_push_token")\
            .eq("id", engineer_id)\
            .maybe_single().execute()
        token = (profile.data or {}).get("expo_push_token")
        if not token:
            return
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post("https://exp.host/--/api/v2/push/send", json={
                "to": token,
                "title": "Work Order Assigned",
                "body": title,
                "data": {
                    "type": "wo_assignment",
                    "url": f"/(app)/work-orders/{wo_id}",
                    "wo_id": wo_id,
                },
            })
    except Exception:
        pass  # Never block claim response on push failure


@router.post("/{wo_id}/claim")
async def claim_work_order(
    wo_id: str,
    current_user: CurrentUser = Depends(require_role("engineer", "chief_engineer", "gm"))
):
    wo_check = supabase.table("work_orders")\
        .select("id, status")\
        .eq("id", wo_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()
    if not wo_check.data:
        raise HTTPException(status_code=404, detail="Work order not found")
    if wo_check.data["status"] != "open":
        raise HTTPException(status_code=409, detail="Work order is no longer open")

    result = supabase.table("work_orders")\
        .update({"assigned_to": current_user.user_id, "status": "in_progress", "started_at": datetime.now(timezone.utc).isoformat()})\
        .eq("id", wo_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()
    wo = result.data[0] if result.data else None
    if wo:
        asyncio.create_task(_send_wo_assignment_push(
            current_user.user_id,
            wo_id,
            wo.get("title", "Work order assigned")
        ))
    return {"data": wo}


@router.post("/{wo_id}/complete")
async def complete_work_order(
    wo_id: str,
    request: CompleteWorkOrderRequest,
    current_user: CurrentUser = Depends(require_role("engineer", "chief_engineer", "gm"))
):
    wo_check = supabase.table("work_orders")\
        .select("id")\
        .eq("id", wo_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()
    if not wo_check.data:
        raise HTTPException(status_code=404, detail="Work order not found")

    result = supabase.table("work_orders")\
        .update({
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
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
        raise HTTPException(status_code=403, detail="Only GM or Chief Engineer can cancel work orders")

    wo_check = supabase.table("work_orders")\
        .select("id")\
        .eq("id", wo_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()
    if not (wo_check and wo_check.data):
        raise HTTPException(status_code=404, detail="Work order not found")

    update_data = request.model_dump(exclude_none=True)
    if "assigned_to" in update_data:
        update_data["assigned_to"] = str(update_data["assigned_to"])

    result = supabase.table("work_orders") \
        .update(update_data) \
        .eq("id", wo_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
    return {"data": result.data[0] if result.data else None}


@router.delete("/{wo_id}", status_code=204)
async def delete_work_order(
    wo_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    wo_check = supabase.table("work_orders") \
        .select("id") \
        .eq("id", wo_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .maybe_single() \
        .execute()
    if not wo_check.data:
        raise HTTPException(status_code=404, detail="Work order not found")

    supabase.table("work_order_comments") \
        .delete() \
        .eq("work_order_id", wo_id) \
        .execute()
    supabase.table("work_order_photos") \
        .delete() \
        .eq("work_order_id", wo_id) \
        .execute()
    supabase.table("work_orders") \
        .delete() \
        .eq("id", wo_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()


@router.post("/{wo_id}/comments")
async def add_comment(
    wo_id: str,
    request: AddCommentRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    wo_check = supabase.table("work_orders").select("id")\
        .eq("id", wo_id).eq("tenant_id", current_user.hotel_id)\
        .maybe_single().execute()
    if not wo_check.data:
        raise HTTPException(status_code=404, detail="Work order not found")

    result = supabase.table("work_order_comments").insert({
        "work_order_id": wo_id,
        "tenant_id": current_user.hotel_id,
        "user_id": current_user.user_id,
        "comment": request.comment,
        "is_system": False,
    }).execute()
    return {"data": result.data[0] if result.data else None}
