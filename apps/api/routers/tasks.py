from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Literal, Optional
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import CreateTaskRequest, UpdateTaskRequest
from core.database import supabase
from datetime import datetime, timedelta, timezone

router = APIRouter(prefix="/tasks", tags=["tasks"])

SLA_MINUTES = {"urgent": 60, "normal": 240, "low": 480}
TASK_UPDATE_COLUMNS = {
    "title",
    "description",
    "task_type",
    "priority",
    "status",
    "assigned_to",
    "location_text",
    "due_at",
    "started_at",
    "completed_at",
}


def _ensure_tenant_row(table: str, row_id: str, hotel_id: str, label: str) -> None:
    result = (
        supabase.table(table)
        .select("id")
        .eq("id", row_id)
        .eq("tenant_id", hotel_id)
        .maybe_single()
        .execute()
    )
    if not result or not result.data:
        raise HTTPException(status_code=404, detail=f"{label} not found")


def _ensure_tenant_staff(
    user_id: str, hotel_id: str, label: str = "Staff member"
) -> None:
    result = (
        supabase.table("user_roles")
        .select("id")
        .eq("user_id", user_id)
        .eq("tenant_id", hotel_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail=f"{label} not found")


def _validate_task_references(request: CreateTaskRequest, hotel_id: str) -> None:
    if request.room_id:
        _ensure_tenant_row("rooms", str(request.room_id), hotel_id, "Room")
    if request.department_id:
        _ensure_tenant_row(
            "departments", str(request.department_id), hotel_id, "Department"
        )
    if request.assigned_to:
        _ensure_tenant_staff(str(request.assigned_to), hotel_id)


@router.post("")
async def create_task(
    request: CreateTaskRequest,
    current_user: CurrentUser = Depends(
        # housekeeper included so floor quick-blockers (ozone delegation,
        # late-checkout confirmation) can create tasks from the room screen
        require_role("gm", "housekeeping_supervisor", "front_desk", "chief_engineer", "engineer", "housekeeper")
    ),
):
    if request.use_ai and request.nl_input:
        # Defer to AI copilot for NL parsing — return preview
        return {
            "data": {
                "requires_ai_confirmation": True,
                "nl_input": request.nl_input,
                "message": "Use POST /ai/copilot/chat with use_ai=true for NL task creation",
            }
        }

    sla = SLA_MINUTES.get(request.priority, 240)
    due_at = request.due_at or (datetime.now(timezone.utc) + timedelta(minutes=sla))
    _validate_task_references(request, current_user.hotel_id)

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
    status: Optional[
        Literal["open", "in_progress", "completed", "cancelled", "escalated"]
    ] = Query(None),
    task_type: Optional[
        Literal["housekeeping", "engineering", "guest_request", "lost_found", "general"]
    ] = Query(None),
    priority: Optional[Literal["urgent", "normal", "low"]] = Query(None),
    assigned_to: Optional[str] = Query(None),
    room_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
):
    query = (
        supabase.table("tasks")
        .select("*, rooms(room_number)")
        .eq("tenant_id", current_user.hotel_id)
        .order("created_at", desc=True)
        .range((page - 1) * per_page, page * per_page - 1)
    )

    if status:
        query = query.eq("status", status)
    if task_type:
        query = query.eq("task_type", task_type)
    if priority:
        query = query.eq("priority", priority)
    if assigned_to:
        query = query.eq("assigned_to", assigned_to)
    if room_id:
        query = query.eq("room_id", room_id)

    # Housekeeper sees tasks assigned to them OR tasks they created
    if current_user.role == "housekeeper":
        uid = current_user.user_id
        query = query.or_(f"assigned_to.eq.{uid},created_by.eq.{uid}")

    result = query.execute()
    return {"data": result.data, "meta": {"page": page, "per_page": per_page}}


@router.get("/{task_id}")
async def get_task(task_id: str, current_user: CurrentUser = Depends(get_current_user)):
    result = (
        supabase.table("tasks")
        .select("*, rooms(room_number, floor), task_comments(*)")
        .eq("id", task_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"data": result.data[0]}


@router.patch("/{task_id}")
async def update_task(
    task_id: str,
    request: UpdateTaskRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    raw_update = request.model_dump(exclude_none=True)
    notes = raw_update.pop("notes", None)
    update_data = {k: v for k, v in raw_update.items() if k in TASK_UPDATE_COLUMNS}
    if "assigned_to" in update_data:
        update_data["assigned_to"] = str(update_data["assigned_to"])
        _ensure_tenant_staff(update_data["assigned_to"], current_user.hotel_id)
    if "due_at" in update_data and hasattr(update_data["due_at"], "isoformat"):
        update_data["due_at"] = update_data["due_at"].isoformat()

    if request.status == "in_progress":
        update_data["started_at"] = datetime.now(timezone.utc).isoformat()
    elif request.status == "completed":
        update_data["completed_at"] = datetime.now(timezone.utc).isoformat()

    if update_data:
        result = (
            supabase.table("tasks")
            .update(update_data)
            .eq("id", task_id)
            .eq("tenant_id", current_user.hotel_id)
            .execute()
        )
    else:
        result = (
            supabase.table("tasks")
            .select("*")
            .eq("id", task_id)
            .eq("tenant_id", current_user.hotel_id)
            .maybe_single()
            .execute()
        )

    task = (
        result.data[0] if isinstance(result.data, list) and result.data else result.data
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if isinstance(notes, str) and notes.strip():
        supabase.table("task_comments").insert(
            {
                "task_id": task_id,
                "tenant_id": current_user.hotel_id,
                "user_id": current_user.user_id,
                "comment": notes.strip(),
            }
        ).execute()

    return {"data": task}


@router.delete("/{task_id}", status_code=204)
async def delete_task(
    task_id: str, current_user: CurrentUser = Depends(get_current_user)
):
    result = (
        supabase.table("tasks")
        .delete()
        .eq("id", task_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Task not found")
    # Belt-and-suspenders: delete orphaned comments if cascade FK not set
    supabase.table("task_comments").delete().eq("task_id", task_id).eq(
        "tenant_id", current_user.hotel_id
    ).execute()


@router.post("/{task_id}/comments")
async def add_task_comment(
    task_id: str,
    comment: str = Query(..., min_length=1, max_length=2000),
    current_user: CurrentUser = Depends(get_current_user),
):
    task = (
        supabase.table("tasks")
        .select("id")
        .eq("id", task_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not task.data:
        raise HTTPException(status_code=404, detail="Task not found")

    result = (
        supabase.table("task_comments")
        .insert(
            {
                "task_id": task_id,
                "tenant_id": current_user.hotel_id,
                "user_id": current_user.user_id,
                "comment": comment,
            }
        )
        .execute()
    )
    return {"data": result.data[0] if result.data else None}


@router.post("/batch")
async def batch_create_tasks(
    tasks: list[dict], current_user: CurrentUser = Depends(get_current_user)
):
    """Batch create multiple tasks (used after AI copilot confirmation)."""
    sla = {"urgent": 60, "normal": 240, "low": 480}
    created = []
    for t in tasks:
        priority = t.get("priority", "normal")
        due_at = (
            t.get("due_at")
            or (
                datetime.now(timezone.utc) + timedelta(minutes=sla.get(priority, 240))
            ).isoformat()
        )
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
