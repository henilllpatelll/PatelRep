"""Task blockers: "Unable to Complete" reports, resume, supervisor resolution and visibility.

A task is *blocked* while it has an active ``task_blockers`` row. ``tasks.status`` is never
touched, so the escalation cron, SLA/overdue maths, assignment and every other tasks consumer are
unaffected; the task stays assigned, stays in the assignee's My Work and never counts as completed.

* ``POST /tasks/{id}/blockers``                      assignee reports why the task can not be finished.
* ``POST /tasks/{id}/resume``                        assignee clears their own blocker and carries on.
* ``POST /tasks/{id}/blockers/{blocker_id}/resolve`` a manager closes a blocker (MANAGER_ROLES).
* ``GET  /tasks/blocked``                            managers: unresolved blockers of their hotel.

Errors that a client must tell apart carry ``detail = {"code", "message", ...}``.
Replay semantics mirror ``task_lifecycle``: repeating something that already happened returns
``200`` with ``meta.replayed = true`` and writes nothing (reports are keyed by ``client_request_id``).

This module must be included in ``main.py`` before ``tasks.router`` so the static
``/tasks/blocked`` path wins over ``GET /tasks/{task_id}``.
"""

import logging
from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from core.database import supabase
from core.roles import ASSIGNMENT_BOUND_ROLES, MANAGER_ROLES
from middleware.auth import CurrentUser, get_current_user, require_role
from models.requests import ReportTaskBlockerRequest, ResolveTaskBlockerRequest, ResumeTaskRequest
from routers.task_lifecycle import _authoritative, _load_task
from routers.tasks import (
    ACTIVE_TASK_STATUSES,
    BLOCKER_SELECT,
    _assignment_bound_may_access,
    _is_duplicate_key,
    _record_task_audit,
    get_active_blocker,
    profile_names,
    public_blocker,
    resolve_active_blocker,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tasks", tags=["task-blockers"])

DEFAULT_LIST_LIMIT = 100
MAX_LIST_LIMIT = 200
# English text for the in-app/push alert only (no guest details, no task title); the app
# localises everything it renders itself.
REASON_ALERT_TEXT = {
    "guest_unavailable": "Guest unavailable",
    "do_not_disturb": "Do Not Disturb",
    "missing_supplies": "Missing supplies",
    "access_issue": "Access problem",
    "assistance_needed": "Needs assistance",
    "equipment_issue": "Equipment issue",
    "other": "Other problem",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _error(status_code: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message, **extra})


def _visible_task(task_id: str, current_user: CurrentUser) -> dict:
    """The task, or the same indistinguishable 404 a housekeeper gets for any task they may not see."""
    task = _load_task(task_id, current_user.hotel_id)
    if current_user.role in ASSIGNMENT_BOUND_ROLES and not _assignment_bound_may_access(task, current_user.user_id):
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _blocker_by_request(client_request_id: str, hotel_id: str) -> Optional[dict]:
    rows = (
        supabase.table("task_blockers")
        .select(BLOCKER_SELECT)
        .eq("tenant_id", hotel_id)
        .eq("client_request_id", client_request_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def _blocker_by_id(blocker_id: str, task_id: str, hotel_id: str) -> Optional[dict]:
    rows = (
        supabase.table("task_blockers")
        .select(BLOCKER_SELECT)
        .eq("tenant_id", hotel_id)
        .eq("task_id", task_id)
        .eq("id", blocker_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def _present(row: dict, hotel_id: str) -> dict:
    names = profile_names({row.get("reported_by"), row.get("resolved_by")}, hotel_id)
    return public_blocker(row, names)


def _response(task_id: str, blocker: Optional[dict], current_user: CurrentUser, replayed: bool, **meta) -> dict:
    return {
        "data": {
            "task": _authoritative(task_id, current_user),
            "blocker": _present(blocker, current_user.hotel_id) if blocker else None,
        },
        "meta": {"replayed": replayed, **meta},
    }


def _place(task: dict) -> str:
    room = (task.get("rooms") or {}).get("room_number") if isinstance(task.get("rooms"), dict) else None
    return f"Room {room}" if room else (task.get("location_text") or "A task")


def _notify_supervisors(current_user: CurrentUser, task: dict, blocker: dict, reporter_name: Optional[str]) -> tuple:
    """Write an in-app notification (the existing push worker picks up ``push_sent = false`` rows)
    for the supervisors who own this kind of work. Returns (notification_status, recipient_count);
    "queued" only ever means notification rows were actually written."""
    primary = ("chief_engineer",) if task.get("task_type") == "engineering" else ("housekeeping_supervisor",)
    written = 0
    try:
        for roles in (primary, ("gm",)):
            rows = (
                supabase.table("user_roles")
                .select("user_id")
                .eq("tenant_id", current_user.hotel_id)
                .in_("role", list(roles))
                .eq("is_active", True)
                .execute()
                .data
                or []
            )
            recipients = sorted({r["user_id"] for r in rows if r.get("user_id") and r["user_id"] != current_user.user_id})
            if not recipients:
                continue  # nobody holds the primary role: fall back to the GM
            reason = REASON_ALERT_TEXT.get(blocker["reason"], "Problem reported")
            body = f"{_place(task)}: {reason}" + (f" (reported by {reporter_name})" if reporter_name else "")
            for user_id in recipients:
                notification = (
                    supabase.table("notifications")
                    .insert(
                        {
                            "tenant_id": current_user.hotel_id,
                            "user_id": user_id,
                            "type": "task_blocked",
                            "title": "Task needs attention",
                            "body": body,
                            "data": {"task_id": task["id"], "blocker_id": blocker["id"], "reason": blocker["reason"]},
                        }
                    )
                    .execute()
                )
                row = (notification.data or [None])[0]
                written += 1
                if row:
                    supabase.table("notification_deliveries").insert(
                        {
                            "tenant_id": current_user.hotel_id,
                            "notification_id": row["id"],
                            "user_id": user_id,
                            "channel": "in_app",
                            "status": "delivered",
                        }
                    ).execute()
            return "queued", written
        return "not_available", 0
    except Exception:  # noqa: BLE001 - the blocker is already saved; report the alert honestly
        logger.error("TASK_BLOCKER_NOTIFY_FAILED task=%s blocker=%s", task.get("id"), blocker.get("id"), exc_info=True)
        return "failed", written


# ---------------------------------------------------------------------------
# report
# ---------------------------------------------------------------------------


@router.post("/{task_id}/blockers")
async def report_blocker(
    task_id: str,
    request: ReportTaskBlockerRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """The assignee reports why an active task can not be finished.

    Only the reason, details and reporter are stored; the task row is not modified. One unresolved
    blocker per task: a retry with the same ``client_request_id`` replays the stored report, a
    different report while one is active is ``409 blocker_already_active`` (with that blocker)."""
    task = _visible_task(task_id, current_user)
    key = str(request.client_request_id)

    existing = _blocker_by_request(key, current_user.hotel_id)
    if existing:
        if existing["task_id"] != task_id or existing["reported_by"] != current_user.user_id:
            raise _error(409, "request_id_reused", "This request id belongs to a different report")
        return _response(task_id, existing, current_user, replayed=True)

    if task.get("assigned_to") != current_user.user_id:
        raise _error(403, "not_assignee", "Only the person this task is assigned to can report a problem with it")
    if task.get("status") not in ACTIVE_TASK_STATUSES:
        raise _error(409, "task_closed", f"A {task.get('status')} task can not be blocked")

    active = get_active_blocker(task_id, current_user.hotel_id)
    if active:
        raise _error(
            409,
            "blocker_already_active",
            "A problem has already been reported on this task",
            blocker=_present(active, current_user.hotel_id),
        )

    row = {
        "id": str(uuid4()),
        "tenant_id": current_user.hotel_id,
        "task_id": task_id,
        "reason": request.reason,
        "details": (request.details or "").strip() or None,
        "reported_by": current_user.user_id,
        "reported_at": _now().isoformat(),
        "client_request_id": key,
        "task_status": task["status"],
        "assigned_to": task.get("assigned_to"),
        "status": "active",
        "notification_status": "pending",
        "notified_count": 0,
    }
    try:
        inserted = supabase.table("task_blockers").insert(row).execute()
    except Exception as exc:  # noqa: BLE001
        if not _is_duplicate_key(exc):
            raise
        # Lost a race with an identical retry or another report: judge what is stored now.
        winner = _blocker_by_request(key, current_user.hotel_id)
        if winner and winner["reported_by"] == current_user.user_id and winner["task_id"] == task_id:
            return _response(task_id, winner, current_user, replayed=True)
        current = get_active_blocker(task_id, current_user.hotel_id)
        raise _error(
            409,
            "blocker_already_active",
            "A problem has already been reported on this task",
            blocker=_present(current, current_user.hotel_id) if current else None,
        )
    blocker = inserted.data[0]

    # Reassigned / closed in the instant between the check and the insert: do not leave a report
    # hanging on someone else's task.
    latest = _load_task(task_id, current_user.hotel_id)
    if latest.get("assigned_to") != current_user.user_id or latest.get("status") not in ACTIVE_TASK_STATUSES:
        resolve_active_blocker(current_user, task_id, "reassigned" if latest.get("assigned_to") != current_user.user_id else "completed")
        raise _error(409, "task_changed", "This task changed while you were reporting; nothing was sent")

    _record_task_audit(
        current_user, task, "task.blocker_reported", {"blocker_id": blocker["id"], "reason": request.reason}
    )
    names = profile_names({current_user.user_id}, current_user.hotel_id)
    notification_status, notified = _notify_supervisors(current_user, task, blocker, names.get(current_user.user_id))
    try:
        supabase.table("task_blockers").update(
            {"notification_status": notification_status, "notified_count": notified}
        ).eq("id", blocker["id"]).eq("tenant_id", current_user.hotel_id).execute()
        blocker["notification_status"] = notification_status
        blocker["notified_count"] = notified
    except Exception:  # noqa: BLE001 - report what happened even if recording it failed
        logger.error("TASK_BLOCKER_NOTIFY_STATUS_FAILED blocker=%s", blocker["id"], exc_info=True)
        blocker["notification_status"] = notification_status
    return _response(task_id, blocker, current_user, replayed=False)


# ---------------------------------------------------------------------------
# resume / resolve
# ---------------------------------------------------------------------------


@router.post("/{task_id}/resume")
async def resume_task(
    task_id: str,
    request: Optional[ResumeTaskRequest] = Body(default=None),
    current_user: CurrentUser = Depends(get_current_user),
):
    """The assignee clears the problem and continues. The task status is unchanged: an unstarted
    task can be started again, an in-progress one completed.

    ``blocker_id`` (optional) pins the blocker the employee was looking at: a different active
    blocker is ``409 blocker_changed``; one that is already resolved replays as ``200``."""
    task = _visible_task(task_id, current_user)
    if task.get("assigned_to") != current_user.user_id:
        raise _error(403, "not_assignee", "Only the person this task is assigned to can resume it")

    wanted = str(request.blocker_id) if request and request.blocker_id else None
    active = get_active_blocker(task_id, current_user.hotel_id)
    if not active:
        previous = _blocker_by_id(wanted, task_id, current_user.hotel_id) if wanted else None
        if previous and previous.get("status") == "resolved":
            return _response(task_id, previous, current_user, replayed=True)
        raise _error(409, "no_active_blocker", "This task has no reported problem to resume")
    if wanted and active["id"] != wanted:
        raise _error(
            409, "blocker_changed", "A different problem is reported on this task now",
            blocker=_present(active, current_user.hotel_id),
        )

    closed = resolve_active_blocker(current_user, task_id, "resumed")
    if not closed:
        # Someone (a supervisor, or a second tap) closed it first; the outcome is what was wanted.
        settled = _blocker_by_id(active["id"], task_id, current_user.hotel_id)
        return _response(task_id, settled, current_user, replayed=True)
    _record_task_audit(current_user, task, "task.blocker_resumed", {"blocker_id": closed["id"], "resolution": "resumed"})
    return _response(task_id, closed, current_user, replayed=False)


@router.post("/{task_id}/blockers/{blocker_id}/resolve")
async def resolve_blocker(
    task_id: str,
    blocker_id: str,
    request: Optional[ResolveTaskBlockerRequest] = Body(default=None),
    current_user: CurrentUser = Depends(require_role(*MANAGER_ROLES)),
):
    """A manager closes a blocker (problem fixed, or dismissed). Ownership and status of the task
    are untouched; reassigning stays the existing PATCH /tasks/{id}. Already resolved: replay."""
    _load_task(task_id, current_user.hotel_id)  # 404 for another hotel's task
    blocker = _blocker_by_id(blocker_id, task_id, current_user.hotel_id)
    if not blocker:
        raise HTTPException(status_code=404, detail="Blocker not found")
    if blocker.get("status") == "resolved":
        return _response(task_id, blocker, current_user, replayed=True)

    note = (request.note or "").strip() if request else ""
    closed = resolve_active_blocker(current_user, task_id, "resolved", note or None)
    if not closed or closed["id"] != blocker_id:
        settled = _blocker_by_id(blocker_id, task_id, current_user.hotel_id)
        return _response(task_id, settled, current_user, replayed=True)
    task = _load_task(task_id, current_user.hotel_id)
    _record_task_audit(current_user, task, "task.blocker_resolved", {"blocker_id": closed["id"], "resolution": "resolved"})
    return _response(task_id, closed, current_user, replayed=False)


# ---------------------------------------------------------------------------
# supervisor visibility
# ---------------------------------------------------------------------------


@router.get("/blocked")
async def list_blocked_tasks(
    limit: int = Query(DEFAULT_LIST_LIMIT, ge=1, le=MAX_LIST_LIMIT),
    task_type: Optional[Literal["housekeeping", "engineering", "guest_request", "lost_found", "general"]] = Query(None),
    current_user: CurrentUser = Depends(require_role(*MANAGER_ROLES)),
):
    """Unresolved blockers of the caller's hotel with the task, room, reporter and reason —
    longest-waiting first. Only the caller's tenant is ever read."""
    rows = (
        supabase.table("task_blockers")
        .select(BLOCKER_SELECT)
        .eq("tenant_id", current_user.hotel_id)
        .eq("status", "active")
        .order("reported_at")
        .execute()
        .data
        or []
    )
    task_ids = [r["task_id"] for r in rows]
    tasks = {}
    if task_ids:
        query = (
            supabase.table("tasks")
            .select("id, title, task_type, priority, status, assigned_to, room_id, location_text, due_at, rooms(room_number, floor)")
            .eq("tenant_id", current_user.hotel_id)
            .in_("id", task_ids)
            .in_("status", ACTIVE_TASK_STATUSES)
        )
        if task_type:
            query = query.eq("task_type", task_type)
        tasks = {t["id"]: t for t in (query.execute().data or [])}
    rows = [r for r in rows if r["task_id"] in tasks]
    has_more = len(rows) > limit
    rows = rows[:limit]

    names = profile_names(
        {r.get("reported_by") for r in rows} | {tasks[r["task_id"]].get("assigned_to") for r in rows},
        current_user.hotel_id,
    )
    items = []
    for r in rows:
        task = tasks[r["task_id"]]
        room = task.get("rooms") if isinstance(task.get("rooms"), dict) else {}
        items.append(
            {
                "blocker": public_blocker(r, names),
                "task": {
                    "id": task["id"],
                    "title": task.get("title"),
                    "task_type": task.get("task_type"),
                    "priority": task.get("priority"),
                    "status": task.get("status"),
                    "assigned_to": task.get("assigned_to"),
                    "assigned_to_name": names.get(task.get("assigned_to")),
                    "room_number": room.get("room_number"),
                    "room_floor": room.get("floor"),
                    "location_text": task.get("location_text"),
                    "due_at": task.get("due_at"),
                },
            }
        )
    return {"data": items, "meta": {"limit": limit, "has_more": has_more, "total": len(items)}}
