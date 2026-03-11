from fastapi import APIRouter, Depends, Query
from typing import Optional
from middleware.auth import get_current_user, CurrentUser
from models.requests import CreateTaskRequest, UpdateTaskRequest
from core.database import supabase
from datetime import datetime, timedelta

router = APIRouter(prefix="/tasks", tags=["tasks"])

SLA_MINUTES = {"urgent": 60, "normal": 240, "low": 480}


@router.post("")
async def create_task(
    request: CreateTaskRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    if request.use_ai and request.nl_input:
        # Defer to AI copilot for NL parsing — return preview
        return {
            "data": {
                "requires_ai_confirmation": True,
                "nl_input": request.nl_input,
                "message": "Use POST /ai/copilot/chat with use_ai=true for NL task creation"
            }
        }

    sla = SLA_MINUTES.get(request.priority, 240)
    due_at = request.due_at or (datetime.utcnow() + timedelta(minutes=sla))

    task_data = {
        "tenant_id": current_user.hotel_id,
        "title": request.title,
        "description": request.description,
        "task_type": request.task_type,
        "priority": request.priority,
        "room_id": str(request.room_id) if request.room_id else None,
        "location_text": request.location_text,
        "department_id": str(request.department_id) if request.department_id else None,
        "assigned_to": str(request.assigned_to) if request.assigned_to else None,
        "created_by": current_user.user_id,
        "sla_minutes": sla,
        "due_at": due_at.isoformat(),
    }

    result = supabase.table("tasks").insert(task_data).execute()
    return {"data": result.data[0] if result.data else None}


@router.get("")
async def list_tasks(
    status: Optional[str] = Query(None),
    task_type: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    assigned_to: Optional[str] = Query(None),
    room_id: Optional[str] = Query(None),
    page: int = Query(1),
    per_page: int = Query(20),
    current_user: CurrentUser = Depends(get_current_user)
):
    query = supabase.table("tasks")\
        .select("*, rooms(room_number), user_profiles(preferred_name)")\
        .eq("tenant_id", current_user.hotel_id)\
        .order("created_at", desc=True)\
        .range((page - 1) * per_page, page * per_page - 1)

    if status: query = query.eq("status", status)
    if task_type: query = query.eq("task_type", task_type)
    if priority: query = query.eq("priority", priority)
    if assigned_to: query = query.eq("assigned_to", assigned_to)
    if room_id: query = query.eq("room_id", room_id)

    # Housekeeper sees only their tasks
    if current_user.role == "housekeeper":
        query = query.eq("assigned_to", current_user.user_id)

    result = query.execute()
    return {"data": result.data, "meta": {"page": page, "per_page": per_page}}


@router.get("/{task_id}")
async def get_task(task_id: str, current_user: CurrentUser = Depends(get_current_user)):
    result = supabase.table("tasks")\
        .select("*, rooms(room_number, floor), task_comments(*)")\
        .eq("id", task_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .single()\
        .execute()
    return {"data": result.data}


@router.patch("/{task_id}")
async def update_task(
    task_id: str,
    request: UpdateTaskRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    update_data = request.model_dump(exclude_none=True)
    if "assigned_to" in update_data:
        update_data["assigned_to"] = str(update_data["assigned_to"])

    if request.status == "in_progress":
        update_data["started_at"] = datetime.utcnow().isoformat()
    elif request.status == "completed":
        update_data["completed_at"] = datetime.utcnow().isoformat()

    result = supabase.table("tasks")\
        .update(update_data)\
        .eq("id", task_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()
    return {"data": result.data[0] if result.data else None}


@router.post("/{task_id}/comments")
async def add_task_comment(
    task_id: str,
    comment: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    result = supabase.table("task_comments").insert({
        "task_id": task_id,
        "tenant_id": current_user.hotel_id,
        "user_id": current_user.user_id,
        "comment": comment,
    }).execute()
    return {"data": result.data[0] if result.data else None}


@router.post("/batch")
async def batch_create_tasks(
    tasks: list[dict],
    current_user: CurrentUser = Depends(get_current_user)
):
    """Batch create multiple tasks (used after AI copilot confirmation)."""
    sla = {"urgent": 60, "normal": 240, "low": 480}
    created = []
    for t in tasks:
        priority = t.get("priority", "normal")
        due_at = t.get("due_at") or (datetime.utcnow() + timedelta(minutes=sla.get(priority, 240))).isoformat()
        row = {
            "tenant_id": current_user.hotel_id,
            "title": t["title"],
            "description": t.get("description"),
            "task_type": t.get("task_type", "general"),
            "priority": priority,
            "room_id": t.get("room_id"),
            "due_at": due_at,
            "sla_minutes": sla.get(priority, 240),
            "created_by": current_user.user_id,
            "is_ai_created": True,
        }
        result = supabase.table("tasks").insert(row).execute()
        if result.data:
            created.append(result.data[0])
    return {"data": {"created_count": len(created), "tasks": created}}
