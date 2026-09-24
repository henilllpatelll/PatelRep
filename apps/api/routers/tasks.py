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
    "assigned_by",
    "location_text",
    "due_at",
    "started_at",
    "completed_at",
    "cancelled_at",
    "escalated_at",
}


def _attach_profiles(tasks: list[dict], hotel_id: str) -> list[dict]:
    """Batch-resolve assigned_to/assigned_by/created_by into display names.

    tasks.assigned_to/assigned_by/created_by reference auth.users, not
    user_profiles, so PostgREST can't embed user_profiles via a `select`
    join (no FK between the two tables) — resolve it with one extra query
    instead, scoped to the tenant like every other lookup here.
    """
    user_ids = {
        uid
        for row in tasks
        for uid in (row.get("assigned_to"), row.get("assigned_by"), row.get("created_by"))
        if uid
    }
    if not user_ids:
        return tasks

    profiles = (
        supabase.table("user_profiles")
        .select("id, full_name, preferred_name")
        .eq("tenant_id", hotel_id)
        .in_("id", list(user_ids))
        .execute()
    )
    by_id = {p["id"]: p for p in (profiles.data or [])}

    for row in tasks:
        row["user_profiles"] = by_id.get(row.get("assigned_to")) if row.get("assigned_to") else None
        row["creator_profile"] = by_id.get(row.get("created_by")) if row.get("created_by") else None
        row["assigner_profile"] = by_id.get(row.get("assigned_by")) if row.get("assigned_by") else None
    return tasks


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
        require_role("gm", "housekeeping_supervisor", "front_desk", "engineer", "housekeeper", "chief_engineer")
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
        "assigned_by": current_user.user_id if request.assigned_to else None,
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

    # Housekeeper sees tasks assigned to them, tasks they created, OR the open
    # housekeeping broadcast pool (unassigned — claimed by whoever starts it first,
    # see POST /{task_id}/claim) so unassigned housekeeping work is discoverable
    # instead of sitting invisible until a supervisor hand-assigns it.
    if current_user.role == "housekeeper":
        uid = current_user.user_id
        query = query.or_(
            f"assigned_to.eq.{uid},created_by.eq.{uid},"
            "and(assigned_to.is.null,status.eq.open,task_type.eq.housekeeping)"
        )

    result = query.execute()
    tasks = _attach_profiles(result.data or [], current_user.hotel_id)
    return {"data": tasks, "meta": {"page": page, "per_page": per_page}}


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
    return {"data": _attach_profiles(result.data, current_user.hotel_id)[0]}


@router.post("/{task_id}/claim")
async def claim_task(
    task_id: str,
    current_user: CurrentUser = Depends(require_role("housekeeper")),
):
    """Self-assign an open, unassigned housekeeping task and start it in one tap —
    whoever claims a broadcast task first gets it, no separate assign step. The
    conditional .eq/.is_ guard on the update makes this atomic: if two housekeepers
    tap it at once, only the first update matches a row, the second gets 409.
    """
    task_check = (
        supabase.table("tasks")
        .select("id, status, assigned_to, task_type")
        .eq("id", task_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not task_check or not task_check.data:
        raise HTTPException(status_code=404, detail="Task not found")
    if task_check.data["task_type"] != "housekeeping":
        raise HTTPException(status_code=403, detail="Only housekeeping tasks can be claimed")
    if task_check.data["status"] != "open" or task_check.data["assigned_to"] is not None:
        raise HTTPException(status_code=409, detail="Task is no longer open for claiming")

    result = (
        supabase.table("tasks")
        .update(
            {
                "assigned_to": current_user.user_id,
                "assigned_by": current_user.user_id,
                "status": "in_progress",
                "started_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", task_id)
        .eq("tenant_id", current_user.hotel_id)
        .eq("status", "open")
        .is_("assigned_to", "null")
        .execute()
    )
    task = result.data[0] if result.data else None
    if not task:
        raise HTTPException(status_code=409, detail="Task was just claimed by someone else")
    return {"data": _attach_profiles([task], current_user.hotel_id)[0]}


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
        update_data["assigned_by"] = current_user.user_id
    if "due_at" in update_data and hasattr(update_data["due_at"], "isoformat"):
        update_data["due_at"] = update_data["due_at"].isoformat()

    if request.status == "in_progress":
        update_data["started_at"] = datetime.now(timezone.utc).isoformat()
    elif request.status == "completed":
        update_data["completed_at"] = datetime.now(timezone.utc).isoformat()
    elif request.status == "cancelled":
        update_data["cancelled_at"] = datetime.now(timezone.utc).isoformat()
    elif request.status == "escalated":
        update_data["escalated_at"] = datetime.now(timezone.utc).isoformat()

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

    return {"data": _attach_profiles([task], current_user.hotel_id)[0]}


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
