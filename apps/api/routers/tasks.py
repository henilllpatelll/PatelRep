from fastapi import APIRouter, Body, Depends, HTTPException, Query
from typing import Literal, Optional
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import (
    CreateTaskRequest,
    CreateTaskScheduleRequest,
    TaskCommentRequest,
    UpdateTaskRequest,
    UpdateTaskScheduleRequest,
)
from core.database import supabase
from core.roles import ASSIGNMENT_BOUND_ROLES, FLOOR_STAFF_ROLES, MANAGER_ROLES, TASK_ASSIGNMENT_ROLES
from datetime import datetime, timedelta, timezone
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tasks", tags=["tasks"])

SLA_MINUTES = {"urgent": 60, "normal": 240, "low": 480}
ACTIVE_TASK_STATUSES = ["open", "in_progress", "escalated"]
TERMINAL_TASK_STATUSES = ["completed", "cancelled"]
ACTIVE_GUEST_REQUEST_STATUSES = ["open", "acknowledged", "dispatched", "arrived", "guest_contacted", "resolved", "reopened"]
TERMINAL_GUEST_REQUEST_STATUSES = ["verified", "cancelled"]
ACTIVE_FETCH_PAGE_SIZE = 500
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
def _record_task_audit(current_user: CurrentUser, task: dict, action: str, new_state: dict) -> None:
    """Append-only operational audit row for a task lifecycle transition (same table and
    columns as routers/programs.py). Written after the transition committed; a failed
    audit write is logged loudly but never turns a committed transition into an error."""
    try:
        supabase.table("operational_audit_events").insert(
            {
                "tenant_id": current_user.hotel_id,
                "resource_type": "task",
                "resource_id": task["id"],
                "action": action,
                "actor_id": current_user.user_id,
                "actor_role": current_user.role,
                "old_state": {"status": task.get("status"), "assigned_to": task.get("assigned_to")},
                "new_state": new_state,
                "source": "api",
            }
        ).execute()
    except Exception:  # noqa: BLE001 - audit must not mask the committed transition
        logger.error("TASK_AUDIT_WRITE_FAILED task=%s action=%s", task.get("id"), action, exc_info=True)


def _assignment_bound_may_access(task: dict, user_id: str) -> bool:
    """Same visibility the list/workspace queries give a housekeeper: tasks assigned to
    them, created by them, or sitting in the open housekeeping pool."""
    return bool(
        task.get("assigned_to") == user_id
        or task.get("created_by") == user_id
        or (
            task.get("assigned_to") is None
            and task.get("status") == "open"
            and task.get("task_type") == "housekeeping"
        )
    )


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


def _attach_comment_profiles(task: dict, hotel_id: str) -> dict:
    """Resolve each task_comments row's user_id into a display name, same join
    workaround as _attach_profiles (task_comments.user_id references auth.users,
    not user_profiles, so PostgREST can't embed it)."""
    comments = task.get("task_comments") or []
    user_ids = {c["user_id"] for c in comments if c.get("user_id")}
    if not user_ids:
        return task

    profiles = (
        supabase.table("user_profiles")
        .select("id, full_name, preferred_name")
        .eq("tenant_id", hotel_id)
        .in_("id", list(user_ids))
        .execute()
    )
    by_id = {p["id"]: p for p in (profiles.data or [])}
    for comment in comments:
        comment["user_profiles"] = by_id.get(comment.get("user_id"))
    return task


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


def _escape_ilike(term: str) -> str:
    """Escape characters PostgREST's ilike operator would otherwise treat as
    wildcards/delimiters when a raw search term is interpolated into an or_() filter string."""
    return term.replace("%", r"\%").replace(",", r"\,")


def _task_workspace_task_query(statuses: list[str], current_user: CurrentUser, search: str | None = None):
    query = (
        supabase.table("tasks")
        .select("*, rooms(room_number)")
        .eq("tenant_id", current_user.hotel_id)
        .in_("status", statuses)
        .order("created_at", desc=True)
    )
    if current_user.role == "housekeeper":
        uid = current_user.user_id
        query = query.or_(
            f"assigned_to.eq.{uid},created_by.eq.{uid},"
            "and(assigned_to.is.null,status.eq.open,task_type.eq.housekeeping)"
        )
    if search:
        term = _escape_ilike(search)
        query = query.or_(f"title.ilike.%{term}%,description.ilike.%{term}%")
    return query


def _task_workspace_guest_request_query(statuses: list[str], current_user: CurrentUser, search: str | None = None):
    query = (
        supabase.table("guest_requests")
        .select("*, rooms(room_number), work_orders(id, status, work_order_number, title, category)")
        .eq("tenant_id", current_user.hotel_id)
        .in_("status", statuses)
        .order("created_at", desc=True)
    )
    if search:
        term = _escape_ilike(search)
        query = query.or_(f"title.ilike.%{term}%,description.ilike.%{term}%,guest_name.ilike.%{term}%")
    return query


def _fetch_all_workspace_records(query_factory) -> list[dict]:
    """Fetch every active row in bounded API pages, not a single arbitrary limit."""
    rows: list[dict] = []
    offset = 0
    while True:
        page = query_factory().range(offset, offset + ACTIVE_FETCH_PAGE_SIZE - 1).execute().data or []
        rows.extend(page)
        if len(page) < ACTIVE_FETCH_PAGE_SIZE:
            return rows
        offset += ACTIVE_FETCH_PAGE_SIZE


def _is_duplicate_key(exc: Exception) -> bool:
    text = str(exc)
    return "23505" in text or "duplicate key" in text


def _find_task_by_request_key(request_key: str, current_user: CurrentUser) -> Optional[dict]:
    """The task already stored under this idempotency key.

    The key is the task id, so it is looked up by id alone first: a row that belongs to another
    hotel or creator is a 409 (key already used), never a replay and never a leak of that row.
    """
    existing = supabase.table("tasks").select("*").eq("id", request_key).limit(1).execute()
    row = (existing.data or [None])[0] if existing else None
    if row is None:
        return None
    if row.get("tenant_id") != current_user.hotel_id or row.get("created_by") != current_user.user_id:
        raise HTTPException(status_code=409, detail="This request id has already been used")
    return row


def _task_create_response(row: Optional[dict], replayed: bool = False, hotel_id: Optional[str] = None) -> dict:
    """`{data, meta}`; the row carries its verified room (`rooms`) the way list reads do."""
    if row and row.get("room_id") and not row.get("rooms"):
        room = (
            supabase.table("rooms")
            .select("room_number, floor")
            .eq("id", row["room_id"])
            .eq("tenant_id", hotel_id or row.get("tenant_id"))
            .limit(1)
            .execute()
        )
        if room and room.data:
            row = {**row, "rooms": room.data[0]}
    return {"data": row, "meta": {"replayed": replayed}}


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

    if current_user.role in FLOOR_STAFF_ROLES:
        # Floor staff create tasks for the team or for themselves; assigning someone else or
        # filing under a department is a management action.
        if request.assigned_to and str(request.assigned_to) != current_user.user_id:
            raise HTTPException(status_code=403, detail="You can only assign a task to yourself")
        if request.department_id:
            raise HTTPException(status_code=403, detail="Your role cannot set a task department")

    request_key = str(request.client_request_id) if request.client_request_id else None
    if request_key:
        replayed = _find_task_by_request_key(request_key, current_user)
        if replayed:
            return _task_create_response(replayed, replayed=True)

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
    if request.ai_suggested:
        task_data["is_ai_created"] = True
    if request_key:
        task_data["id"] = request_key

    try:
        result = supabase.table("tasks").insert(task_data).execute()
    except Exception as exc:
        # Two attempts with the same key raced: the loser returns the winner's task.
        if request_key and _is_duplicate_key(exc):
            replayed = _find_task_by_request_key(request_key, current_user)
            if replayed:
                return _task_create_response(replayed, replayed=True)
        raise
    return _task_create_response(result.data[0] if result.data else None, hotel_id=current_user.hotel_id)


@router.post("/schedules")
async def create_task_schedule(
    request: CreateTaskScheduleRequest,
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor", "front_desk", "engineer", "housekeeper", "chief_engineer")
    ),
):
    """Create a recurrence rule and immediately generate its first task.

    First-occurrence generation reuses generate_task_from_schedule so the
    create path and the tasks.generate-recurring cron can never diverge.
    """
    from services.task_schedules import generate_task_from_schedule

    if request.room_id:
        _ensure_tenant_row("rooms", str(request.room_id), current_user.hotel_id, "Room")
    if request.assigned_to:
        _ensure_tenant_staff(str(request.assigned_to), current_user.hotel_id)

    start_at = datetime.combine(request.start_date, datetime.min.time(), tzinfo=timezone.utc)
    schedule_data = {
        "tenant_id": current_user.hotel_id,
        "title": request.title,
        "description": request.description,
        "task_type": request.task_type,
        "priority": request.priority,
        "room_id": str(request.room_id) if request.room_id else None,
        "location_text": request.location_text,
        "assigned_to": str(request.assigned_to) if request.assigned_to else None,
        "interval_type": request.interval_type,
        "interval_days": request.interval_days,
        "next_due_at": start_at.isoformat(),
        "end_type": request.end_type,
        "end_count": request.end_count,
        "end_date": request.end_date.isoformat() if request.end_date else None,
        "created_by": current_user.user_id,
    }
    result = supabase.table("task_schedules").insert(schedule_data).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create recurring task rule")
    schedule = result.data[0]

    first_task = generate_task_from_schedule(schedule)
    return {"data": {"schedule": schedule, "task": first_task}}


@router.patch("/schedules/{schedule_id}")
async def update_task_schedule(
    schedule_id: str,
    request: UpdateTaskScheduleRequest,
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor", "front_desk", "engineer", "housekeeper", "chief_engineer")
    ),
):
    """Deactivate (stop) a recurring task rule. Already-generated tasks are untouched."""
    result = (
        supabase.table("task_schedules")
        .update({"is_active": request.is_active})
        .eq("id", schedule_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Recurring task rule not found")
    return {"data": result.data[0]}


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


@router.get("/workspace")
async def get_task_workspace(
    history_page: int = Query(1, ge=1),
    history_per_page: int = Query(50, ge=1, le=100),
    history_search: str | None = Query(None, min_length=1, max_length=200),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Return complete actionable work and a separately paginated terminal History.

    Active records are intentionally fetched through bounded sequential requests so
    an old-but-open task cannot disappear behind a historical page window. Active work
    is always returned in full regardless of history_search — that filter only narrows
    the paginated History query itself, since Active is never paginated and the UI
    already has every active row loaded to filter client-side.
    """
    # Route handlers called directly (as in unit tests, bypassing FastAPI's DI)
    # receive the raw Query(...) sentinel for any param the caller omits.
    search_term = history_search if isinstance(history_search, str) else None
    active_tasks = _attach_profiles(
        _fetch_all_workspace_records(
            lambda: _task_workspace_task_query(ACTIVE_TASK_STATUSES, current_user)
        ),
        current_user.hotel_id,
    )
    active_guest_requests = _fetch_all_workspace_records(
        lambda: _task_workspace_guest_request_query(ACTIVE_GUEST_REQUEST_STATUSES, current_user)
    )

    history_start = (history_page - 1) * history_per_page
    history_tasks = _attach_profiles(
        _task_workspace_task_query(TERMINAL_TASK_STATUSES, current_user, search=search_term)
        .range(history_start, history_start + history_per_page - 1)
        .execute()
        .data
        or [],
        current_user.hotel_id,
    )
    history_guest_requests = (
        _task_workspace_guest_request_query(TERMINAL_GUEST_REQUEST_STATUSES, current_user, search=search_term)
        .range(history_start, history_start + history_per_page - 1)
        .execute()
        .data
        or []
    )

    return {
        "data": {
            "active": {"tasks": active_tasks, "guest_requests": active_guest_requests},
            "history": {"tasks": history_tasks, "guest_requests": history_guest_requests},
        },
        "meta": {"history_page": history_page, "history_per_page": history_per_page},
    }


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
    if current_user.role in ASSIGNMENT_BOUND_ROLES and not _assignment_bound_may_access(
        result.data[0], current_user.user_id
    ):
        raise HTTPException(status_code=404, detail="Task not found")
    task = _attach_profiles(result.data, current_user.hotel_id)[0]
    return {"data": _attach_comment_profiles(task, current_user.hotel_id)}


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
        .select("*, rooms(room_number, floor)")
        .eq("id", task_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not task_check or not task_check.data:
        raise HTTPException(status_code=404, detail="Task not found")
    existing = task_check.data
    if existing["task_type"] != "housekeeping":
        raise HTTPException(status_code=403, detail="Only housekeeping tasks can be claimed")
    if existing["assigned_to"] == current_user.user_id and existing["status"] == "in_progress":
        # Replay of a claim this housekeeper already won (e.g. a retry after a dropped
        # response): no second write, same authoritative task.
        return {"data": _attach_profiles([existing], current_user.hotel_id)[0], "meta": {"replayed": True}}
    if existing["status"] != "open" or existing["assigned_to"] is not None:
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
    task["rooms"] = existing.get("rooms")
    _record_task_audit(
        current_user,
        existing,
        "task.claimed",
        {"status": "in_progress", "assigned_to": current_user.user_id},
    )
    return {"data": _attach_profiles([task], current_user.hotel_id)[0], "meta": {"replayed": False}}


@router.patch("/{task_id}")
async def update_task(
    task_id: str,
    request: UpdateTaskRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    raw_update = request.model_dump(exclude_none=True)
    notes = raw_update.pop("notes", None)
    update_data = {k: v for k, v in raw_update.items() if k in TASK_UPDATE_COLUMNS}

    # These guards make list-view bulk actions as safe as their individual
    # counterparts. The UI also hides unavailable actions, but client state is
    # never an authorization boundary.
    if "assigned_to" in update_data and current_user.role not in TASK_ASSIGNMENT_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized to assign tasks")
    if "priority" in update_data and current_user.role not in MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized to reprioritize tasks")
    if "status" in update_data and current_user.role not in MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized to update task status")
    editable_fields = {"title", "description", "task_type", "due_at", "location_text", "department_id"}
    if editable_fields.intersection(update_data) and current_user.role not in MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized to edit tasks")
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
    comment: Optional[str] = Query(None, max_length=2000),
    current_user: CurrentUser = Depends(get_current_user),
    body: Optional[TaskCommentRequest] = Body(default=None),
):
    """Add a note to a task. Text comes from the JSON body (mobile) or the legacy ``comment``
    query parameter (web). It is trimmed; blank notes are rejected."""
    text = body.comment if isinstance(body, TaskCommentRequest) else (comment if isinstance(comment, str) else None)
    text = text.strip() if text else ""
    if not text:
        raise HTTPException(status_code=422, detail="A note can not be empty")
    if len(text) > 2000:
        raise HTTPException(status_code=422, detail="A note can be at most 2000 characters")

    task = (
        supabase.table("tasks")
        .select("id, status, task_type, assigned_to, created_by")
        .eq("id", task_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not task or not task.data:
        raise HTTPException(status_code=404, detail="Task not found")
    if current_user.role in ASSIGNMENT_BOUND_ROLES and not _assignment_bound_may_access(
        task.data, current_user.user_id
    ):
        raise HTTPException(status_code=404, detail="Task not found")

    result = (
        supabase.table("task_comments")
        .insert(
            {
                "task_id": task_id,
                "tenant_id": current_user.hotel_id,
                "user_id": current_user.user_id,
                "comment": text,
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
