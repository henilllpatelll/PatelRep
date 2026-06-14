from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException

from core.database import supabase as default_supabase
from middleware.auth import CurrentUser
from models.task_engine import (
    AuditActorType,
    TaskCreateInput,
    TaskStatus,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _client(client=None):
    return client or default_supabase


def _actor_id(actor: CurrentUser | str | None) -> Optional[str]:
    if isinstance(actor, CurrentUser):
        return actor.user_id
    return actor


def _property_id(actor: CurrentUser | None, property_id: Optional[str] = None) -> str:
    if property_id:
        return property_id
    if actor:
        return actor.hotel_id
    raise ValueError("property_id is required when actor is not a CurrentUser")


def _select_one(client, table: str, property_id: str, row_id: str):
    result = (
        client.table(table)
        .select("*")
        .eq("id", row_id)
        .eq("tenant_id", property_id)
        .maybe_single()
        .execute()
    )
    return result.data if result else None


def _get_task(client, task_id: str, property_id: str) -> dict[str, Any]:
    task = _select_one(client, "tasks", property_id, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _ensure_room(client, room_id: Optional[str], property_id: str) -> None:
    if not room_id:
        return
    room = _select_one(client, "rooms", property_id, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")


def _ensure_staff(client, user_id: Optional[str], property_id: str) -> None:
    if not user_id:
        return
    result = (
        client.table("user_roles")
        .select("id")
        .eq("user_id", user_id)
        .eq("tenant_id", property_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Staff member not found")


def _insert_audit_event(
    *,
    client,
    property_id: str,
    actor: CurrentUser | str | None,
    event_type: str,
    before: Optional[dict[str, Any]] = None,
    after: Optional[dict[str, Any]] = None,
    action_attempted: Optional[str] = None,
    verifier_result: Optional[dict[str, Any]] = None,
    confidence: Optional[float] = None,
    error_message: Optional[str] = None,
) -> dict[str, Any] | None:
    snapshot = after or before or {}
    row = {
        "tenant_id": property_id,
        "property_id": property_id,
        "actor_type": AuditActorType.USER.value
        if isinstance(actor, CurrentUser)
        else AuditActorType.SYSTEM.value,
        "actor_id": _actor_id(actor),
        "room_id": snapshot.get("room_id"),
        "task_id": snapshot.get("id") or snapshot.get("task_id"),
        "event_type": event_type,
        "before_snapshot_ref": before,
        "after_snapshot_ref": after,
        "action_attempted": action_attempted,
        "verifier_result": verifier_result,
        "confidence": confidence,
        "error_message": error_message,
        "timestamp": _now_iso(),
    }
    result = client.table("audit_events").insert(row).execute()
    return result.data[0] if result.data else None


def _update_task(
    *,
    client,
    task_id: str,
    property_id: str,
    actor: CurrentUser | str | None,
    update_data: dict[str, Any],
    event_type: str,
    action_attempted: str,
    verifier_result: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    before = _get_task(client, task_id, property_id)
    row = {**update_data, "updated_at": _now_iso()}
    result = (
        client.table("tasks")
        .update(row)
        .eq("id", task_id)
        .eq("tenant_id", property_id)
        .execute()
    )
    after = result.data[0] if result.data else None
    if not after:
        raise HTTPException(status_code=404, detail="Task not found")
    _insert_audit_event(
        client=client,
        property_id=property_id,
        actor=actor,
        event_type=event_type,
        before=before,
        after=after,
        action_attempted=action_attempted,
        verifier_result=verifier_result,
    )
    return dict(after)


def create_task(
    request: TaskCreateInput,
    *,
    actor: CurrentUser,
    client=None,
) -> dict[str, Any]:
    db = _client(client)
    property_id = actor.hotel_id
    payload = request.model_dump(mode="json", by_alias=False, exclude_none=True)
    _ensure_room(db, payload.get("room_id"), property_id)
    _ensure_staff(db, payload.get("assigned_to"), property_id)
    _ensure_staff(db, payload.get("assigned_tech"), property_id)

    task_data = {
        "tenant_id": property_id,
        "title": payload["title"],
        "description": payload.get("description"),
        "task_type": payload["category"],
        "priority": payload.get("priority", "normal"),
        "status": TaskStatus.NEW.value,
        "room_id": payload.get("room_id"),
        "department_id": payload.get("department_id"),
        "assigned_to": payload.get("assigned_to"),
        "created_by": actor.user_id,
        "due_at": payload.get("due_at"),
        "room_or_area": payload.get("room_or_area"),
        "issue_category": payload.get("issue_category"),
        "guest_facing": payload.get("guest_facing", False),
        "blocked_reason": payload.get("blocked_reason"),
        "assigned_tech": payload.get("assigned_tech"),
        "completion_verification": payload.get("completion_verification", {}),
        "metadata": payload.get("metadata", {}),
    }
    result = db.table("tasks").insert(task_data).execute()
    task = result.data[0] if result.data else None
    if not task:
        raise HTTPException(status_code=500, detail="Task was not created")

    _insert_audit_event(
        client=db,
        property_id=property_id,
        actor=actor,
        event_type="task.created",
        after=task,
        action_attempted="create_task",
    )
    return dict(task)


def assign_task(
    task_id: str,
    assigned_to: str,
    *,
    actor: CurrentUser,
    client=None,
) -> dict[str, Any]:
    db = _client(client)
    property_id = actor.hotel_id
    _ensure_staff(db, assigned_to, property_id)
    after = _update_task(
        client=db,
        task_id=task_id,
        property_id=property_id,
        actor=actor,
        update_data={
            "assigned_to": assigned_to,
            "assigned_by": actor.user_id,
            "assigned_at": _now_iso(),
            "status": TaskStatus.ASSIGNED.value,
        },
        event_type="task.assigned",
        action_attempted="assign_task",
    )
    db.table("task_assignments").insert(
        {
            "tenant_id": property_id,
            "task_id": task_id,
            "assigned_to": assigned_to,
            "assigned_by": actor.user_id,
            "status": "active",
        }
    ).execute()
    return after


def acknowledge_task(
    task_id: str,
    *,
    actor: CurrentUser,
    client=None,
) -> dict[str, Any]:
    db = _client(client)
    return _update_task(
        client=db,
        task_id=task_id,
        property_id=actor.hotel_id,
        actor=actor,
        update_data={
            "status": TaskStatus.ACKNOWLEDGED.value,
            "acknowledged_at": _now_iso(),
        },
        event_type="task.acknowledged",
        action_attempted="acknowledge_task",
    )


def start_task(
    task_id: str,
    *,
    actor: CurrentUser,
    client=None,
) -> dict[str, Any]:
    db = _client(client)
    return _update_task(
        client=db,
        task_id=task_id,
        property_id=actor.hotel_id,
        actor=actor,
        update_data={"status": TaskStatus.IN_PROGRESS.value, "started_at": _now_iso()},
        event_type="task.started",
        action_attempted="start_task",
    )


def block_task(
    task_id: str,
    reason: str,
    *,
    actor: CurrentUser,
    client=None,
) -> dict[str, Any]:
    db = _client(client)
    return _update_task(
        client=db,
        task_id=task_id,
        property_id=actor.hotel_id,
        actor=actor,
        update_data={
            "status": TaskStatus.BLOCKED.value,
            "blocked_reason": reason,
        },
        event_type="task.blocked",
        action_attempted="block_task",
    )


def complete_task(
    task_id: str,
    *,
    actor: CurrentUser,
    completion_verification: Optional[dict[str, Any]] = None,
    client=None,
) -> dict[str, Any]:
    db = _client(client)
    return _update_task(
        client=db,
        task_id=task_id,
        property_id=actor.hotel_id,
        actor=actor,
        update_data={
            "status": TaskStatus.COMPLETED.value,
            "completed_at": _now_iso(),
            "completion_verification": completion_verification or {},
        },
        event_type="task.completed",
        action_attempted="complete_task",
        verifier_result=completion_verification,
    )


def verify_task(
    task_id: str,
    *,
    actor: CurrentUser,
    verifier_result: Optional[dict[str, Any]] = None,
    client=None,
) -> dict[str, Any]:
    db = _client(client)
    return _update_task(
        client=db,
        task_id=task_id,
        property_id=actor.hotel_id,
        actor=actor,
        update_data={"status": TaskStatus.VERIFIED.value, "verified_at": _now_iso()},
        event_type="task.verified",
        action_attempted="verify_task",
        verifier_result=verifier_result,
    )


def escalate_task(
    task_id: str,
    reason: str,
    *,
    actor: CurrentUser,
    client=None,
) -> dict[str, Any]:
    db = _client(client)
    after = _update_task(
        client=db,
        task_id=task_id,
        property_id=actor.hotel_id,
        actor=actor,
        update_data={
            "status": TaskStatus.ESCALATED.value,
            "escalated_at": _now_iso(),
            "escalation_reason": reason,
        },
        event_type="task.escalated",
        action_attempted="escalate_task",
    )
    db.table("escalation_events").insert(
        {
            "tenant_id": actor.hotel_id,
            "property_id": actor.hotel_id,
            "task_id": task_id,
            "room_id": after.get("room_id"),
            "reason": reason,
            "created_by_actor_type": AuditActorType.USER.value,
            "created_by_actor_id": actor.user_id,
        }
    ).execute()
    return after


def add_note(
    task_id: str,
    body: str,
    *,
    actor: CurrentUser,
    client=None,
) -> dict[str, Any]:
    db = _client(client)
    task = _get_task(db, task_id, actor.hotel_id)
    result = (
        db.table("task_notes")
        .insert(
            {
                "tenant_id": actor.hotel_id,
                "task_id": task_id,
                "author_user_id": actor.user_id,
                "body": body,
            }
        )
        .execute()
    )
    note = result.data[0] if result.data else None
    if not note:
        raise HTTPException(status_code=500, detail="Task note was not created")
    _insert_audit_event(
        client=db,
        property_id=actor.hotel_id,
        actor=actor,
        event_type="task.note_added",
        before=task,
        after={"task_id": task_id, **note},
        action_attempted="add_note",
    )
    return dict(note)


def attach_photo_metadata(
    task_id: str,
    *,
    url: str,
    content_type: Optional[str] = None,
    byte_size: Optional[int] = None,
    actor: CurrentUser,
    client=None,
) -> dict[str, Any]:
    db = _client(client)
    task = _get_task(db, task_id, actor.hotel_id)
    result = (
        db.table("task_photos")
        .insert(
            {
                "tenant_id": actor.hotel_id,
                "task_id": task_id,
                "uploaded_by": actor.user_id,
                "storage_url": url,
                "content_type": content_type,
                "byte_size": byte_size,
            }
        )
        .execute()
    )
    photo = result.data[0] if result.data else None
    if not photo:
        raise HTTPException(status_code=500, detail="Task photo was not attached")
    _insert_audit_event(
        client=db,
        property_id=actor.hotel_id,
        actor=actor,
        event_type="task.photo_attached",
        before=task,
        after={"task_id": task_id, **photo},
        action_attempted="attach_photo_metadata",
    )
    return dict(photo)
