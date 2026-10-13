"""Employee-facing Task lifecycle and retrieval contract (mobile Housekeeper Tasks).

Everything here is authenticated, tenant-scoped and decided on the server:

* ``GET  /tasks/mine``            My Work — active tasks assigned to the caller.
* ``GET  /tasks/available``       Available — open, unassigned housekeeping pool (housekeeper).
* ``GET  /tasks/mine/completed``  Completion history — caller's completed tasks, newest first.
* ``POST /tasks/{id}/start``      Start a task already assigned to the caller.
* ``POST /tasks/{id}/complete``   Complete a task (assignee, or a manager role).
* ``GET  /tasks/{id}/activity``   Authoritative task + its persisted activity feed.

Claiming stays in ``routers/tasks.py`` (``POST /tasks/{id}/claim``). Generic
``PATCH /tasks/{id}`` is unchanged and stays manager-only for status changes — these
dedicated verbs are how non-managers move a task they own, without being able to edit
its assignment, priority or any other field.

Replay semantics (no migration / idempotency-key column needed — the task row is the key):
repeating a transition that already happened to the same task returns ``200`` with the
current authoritative task and ``meta.replayed = true``, and performs **no** write, audit
row or comment. Any other transition from a non-eligible state is a ``409``.

This module must be included in ``main.py`` before ``tasks.router`` so the static
``/tasks/mine`` and ``/tasks/available`` paths win over ``GET /tasks/{task_id}``.
"""

import base64
import binascii
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from core.database import supabase
from core.roles import ASSIGNMENT_BOUND_ROLES, MANAGER_ROLES
from middleware.auth import CurrentUser, get_current_user, require_role
from models.requests import CompleteTaskRequest
from routers.tasks import (
    ACTIVE_TASK_STATUSES,
    _assignment_bound_may_access,
    _attach_profiles,
    _record_task_audit,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tasks", tags=["tasks"])

TASK_SELECT = "*, rooms(room_number, floor)"
FETCH_PAGE_SIZE = 500
# Upper bound on rows scanned per request. Reaching it is reported (meta.truncated),
# never swallowed, so active work can not disappear silently.
FETCH_HARD_CAP = 2000
DEFAULT_PAGE_LIMIT = 100
MAX_PAGE_LIMIT = 200
PRIORITY_RANK = {"urgent": 0, "normal": 1, "low": 2}
NO_DUE_SORT_VALUE = 253402300799.0  # 9999-12-31, sorts after every real due time


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(value) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _encode_cursor(payload: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()


def _decode_cursor(cursor: str) -> dict:
    try:
        payload = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
    except (binascii.Error, ValueError, UnicodeError):
        raise HTTPException(status_code=422, detail="Invalid cursor")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="Invalid cursor")
    return payload


def _sort_key(task: dict, as_of: datetime) -> list:
    """Deterministic work order: overdue first, then in-progress/escalated, then the rest;
    inside a group urgent -> low, earliest due first, oldest created first, id as tiebreak.

    ``as_of`` is frozen into the cursor so a task that becomes overdue mid-scroll never
    moves between pages.
    """
    due = _parse_ts(task.get("due_at"))
    created = _parse_ts(task.get("created_at"))
    overdue = due is not None and due < as_of
    if overdue:
        bucket = 0
    elif task.get("status") in ("in_progress", "escalated"):
        bucket = 1
    else:
        bucket = 2
    return [
        bucket,
        PRIORITY_RANK.get(task.get("priority"), 1),
        due.timestamp() if due else NO_DUE_SORT_VALUE,
        created.timestamp() if created else 0.0,
        str(task.get("id")),
    ]


def _fetch_all(query_factory) -> tuple[list[dict], bool]:
    """Sequentially page through a deterministic query. Returns (rows, truncated)."""
    rows: list[dict] = []
    offset = 0
    while offset < FETCH_HARD_CAP:
        page = query_factory().range(offset, offset + FETCH_PAGE_SIZE - 1).execute().data or []
        rows.extend(page)
        if len(page) < FETCH_PAGE_SIZE:
            return rows, False
        offset += FETCH_PAGE_SIZE
    return rows, True


def _attach_guest_requests(tasks: list[dict], hotel_id: str) -> list[dict]:
    """Expose only the existence/status of a linked guest request — never guest name,
    notes or messages, which have their own role rules in the guest-requests router."""
    task_ids = [t["id"] for t in tasks if t.get("id")]
    for task in tasks:
        task["guest_request"] = None
    if not task_ids:
        return tasks
    linked = (
        supabase.table("guest_requests")
        .select("id, status, task_id")
        .eq("tenant_id", hotel_id)
        .in_("task_id", task_ids)
        .execute()
        .data
        or []
    )
    by_task = {row["task_id"]: {"id": row["id"], "status": row.get("status")} for row in linked}
    for task in tasks:
        task["guest_request"] = by_task.get(task["id"])
    return tasks


def _decorate(tasks: list[dict], hotel_id: str) -> list[dict]:
    return _attach_guest_requests(_attach_profiles(tasks, hotel_id), hotel_id)


def _load_task(task_id: str, hotel_id: str) -> dict:
    result = (
        supabase.table("tasks")
        .select(TASK_SELECT)
        .eq("id", task_id)
        .eq("tenant_id", hotel_id)
        .maybe_single()
        .execute()
    )
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Task not found")
    return result.data


def _authoritative(task_id: str, hotel_id: str) -> dict:
    return _decorate([_load_task(task_id, hotel_id)], hotel_id)[0]


def _page_limit(limit: int) -> int:
    return max(1, min(int(limit), MAX_PAGE_LIMIT))


def _paginate_sorted(
    tasks: list[dict], cursor: Optional[str], limit: int, truncated: bool, as_of_default: datetime
) -> dict:
    as_of = as_of_default
    after_key: Optional[list] = None
    if cursor:
        payload = _decode_cursor(cursor)
        parsed_as_of = _parse_ts(payload.get("as_of"))
        key = payload.get("k")
        if parsed_as_of is None or not isinstance(key, list) or len(key) != 5:
            raise HTTPException(status_code=422, detail="Invalid cursor")
        as_of, after_key = parsed_as_of, key

    keyed = sorted(((_sort_key(t, as_of), t) for t in tasks), key=lambda pair: pair[0])
    if after_key is not None:
        try:
            keyed = [pair for pair in keyed if pair[0] > after_key]
        except TypeError:
            raise HTTPException(status_code=422, detail="Invalid cursor")
    window = keyed[:limit]
    has_more = len(keyed) > limit
    next_cursor = (
        _encode_cursor({"as_of": as_of.isoformat(), "k": window[-1][0]}) if has_more and window else None
    )
    return {
        "items": [task for _, task in window],
        "meta": {
            "limit": limit,
            "has_more": has_more,
            "next_cursor": next_cursor,
            "total": len(tasks),
            "truncated": truncated,
        },
    }


# ---------------------------------------------------------------------------
# retrieval
# ---------------------------------------------------------------------------


@router.get("/mine")
async def list_my_work(
    limit: int = Query(DEFAULT_PAGE_LIMIT, ge=1, le=MAX_PAGE_LIMIT),
    cursor: Optional[str] = Query(None, max_length=512),
    current_user: CurrentUser = Depends(get_current_user),
):
    """My Work: active (open / in_progress / escalated) tasks assigned to the caller.

    Tasks the caller merely *created* for someone else, or that are unassigned, are not
    personally actionable and are excluded. Completed/cancelled work never appears here.
    """
    def base():
        return (
            supabase.table("tasks")
            .select(TASK_SELECT)
            .eq("tenant_id", current_user.hotel_id)
            .eq("assigned_to", current_user.user_id)
            .in_("status", ACTIVE_TASK_STATUSES)
            .order("created_at")
            .order("id")
        )

    rows, truncated = _fetch_all(base)
    page = _paginate_sorted(rows, cursor, _page_limit(limit), truncated, _now())
    return {"data": _decorate(page["items"], current_user.hotel_id), "meta": page["meta"]}


@router.get("/available")
async def list_available_tasks(
    limit: int = Query(DEFAULT_PAGE_LIMIT, ge=1, le=MAX_PAGE_LIMIT),
    cursor: Optional[str] = Query(None, max_length=512),
    current_user: CurrentUser = Depends(require_role("housekeeper")),
):
    """Available: the open, unassigned housekeeping pool a housekeeper may claim."""
    def base():
        return (
            supabase.table("tasks")
            .select(TASK_SELECT)
            .eq("tenant_id", current_user.hotel_id)
            .eq("status", "open")
            .eq("task_type", "housekeeping")
            .is_("assigned_to", "null")
            .order("created_at")
            .order("id")
        )

    rows, truncated = _fetch_all(base)
    page = _paginate_sorted(rows, cursor, _page_limit(limit), truncated, _now())
    return {"data": _decorate(page["items"], current_user.hotel_id), "meta": page["meta"]}


@router.get("/mine/completed")
async def list_my_completed(
    limit: int = Query(30, ge=1, le=100),
    cursor: Optional[str] = Query(None, max_length=512),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Completion history: the caller's own completed tasks, newest completion first.

    Keyset-paginated on (completed_at desc, id desc). Completed rows without a
    completed_at (legacy data) have no position in a history and are not listed.
    """
    limit = max(1, min(int(limit), 100))

    def base():
        return (
            supabase.table("tasks")
            .select(TASK_SELECT)
            .eq("tenant_id", current_user.hotel_id)
            .eq("assigned_to", current_user.user_id)
            .eq("status", "completed")
            .order("completed_at", desc=True)
            .order("id", desc=True)
        )

    want = limit + 1
    if cursor:
        payload = _decode_cursor(cursor)
        completed_at, row_id = payload.get("t"), payload.get("i")
        if not isinstance(completed_at, str) or not isinstance(row_id, str):
            raise HTTPException(status_code=422, detail="Invalid cursor")
        same_instant = (
            base().eq("completed_at", completed_at).lt("id", row_id).limit(want).execute().data or []
        )
        older = []
        if len(same_instant) < want:
            older = base().lt("completed_at", completed_at).limit(want - len(same_instant)).execute().data or []
        rows = same_instant + older
    else:
        rows = base().gte("completed_at", "1970-01-01T00:00:00+00:00").limit(want).execute().data or []

    has_more = len(rows) > limit
    window = rows[:limit]
    next_cursor = (
        _encode_cursor({"t": window[-1]["completed_at"], "i": window[-1]["id"]}) if has_more and window else None
    )
    return {
        "data": _decorate(window, current_user.hotel_id),
        "meta": {"limit": limit, "has_more": has_more, "next_cursor": next_cursor},
    }


# ---------------------------------------------------------------------------
# lifecycle verbs
# ---------------------------------------------------------------------------


@router.post("/{task_id}/start")
async def start_task(task_id: str, current_user: CurrentUser = Depends(get_current_user)):
    """Start a task that is already assigned to the caller (open/escalated -> in_progress).

    Only the status and started_at move; this endpoint can not change assignment,
    priority or any other field. Unassigned tasks must be claimed instead."""
    task = _load_task(task_id, current_user.hotel_id)

    if task.get("assigned_to") is None:
        raise HTTPException(status_code=409, detail="Task is unassigned; claim it instead")
    if task["assigned_to"] != current_user.user_id:
        raise HTTPException(status_code=403, detail="This task is assigned to someone else")

    if task["status"] == "in_progress":
        return {"data": _authoritative(task_id, current_user.hotel_id), "meta": {"replayed": True}}
    if task["status"] not in ("open", "escalated"):
        raise HTTPException(status_code=409, detail=f"A {task['status']} task can not be started")

    result = (
        supabase.table("tasks")
        .update({"status": "in_progress", "started_at": _now().isoformat()})
        .eq("id", task_id)
        .eq("tenant_id", current_user.hotel_id)
        .eq("assigned_to", current_user.user_id)
        .in_("status", ["open", "escalated"])
        .execute()
    )
    if not result.data:
        # Lost a race with another request; judge the task as it is now.
        current = _load_task(task_id, current_user.hotel_id)
        if current["status"] == "in_progress" and current.get("assigned_to") == current_user.user_id:
            return {"data": _authoritative(task_id, current_user.hotel_id), "meta": {"replayed": True}}
        raise HTTPException(status_code=409, detail="Task state changed; refresh and try again")

    _record_task_audit(current_user, task, "task.started", {"status": "in_progress"})
    return {"data": _authoritative(task_id, current_user.hotel_id), "meta": {"replayed": False}}


@router.post("/{task_id}/complete")
async def complete_task(
    task_id: str,
    request: Optional[CompleteTaskRequest] = Body(default=None),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Complete a task. Allowed for its assignee, or for a manager role (matching the
    existing PATCH authority). Completion time is the server clock, never client input.

    A task that was never started is completed directly and gets started_at = completed_at.
    Completing an already-completed task is a no-op replay (200, ``meta.replayed``); a
    cancelled task is a 409. An optional ``note`` is stored as a task comment only when
    this call performs the transition."""
    task = _load_task(task_id, current_user.hotel_id)

    is_assignee = task.get("assigned_to") == current_user.user_id
    is_manager = current_user.role in MANAGER_ROLES
    if not (is_assignee or is_manager):
        raise HTTPException(status_code=403, detail="Not authorized to complete this task")

    if task["status"] == "completed":
        return {"data": _authoritative(task_id, current_user.hotel_id), "meta": {"replayed": True}}
    if task["status"] == "cancelled":
        raise HTTPException(status_code=409, detail="A cancelled task can not be completed")

    completed_at = _now().isoformat()
    changes = {"status": "completed", "completed_at": completed_at}
    if not task.get("started_at"):
        changes["started_at"] = completed_at

    query = (
        supabase.table("tasks")
        .update(changes)
        .eq("id", task_id)
        .eq("tenant_id", current_user.hotel_id)
        .in_("status", ACTIVE_TASK_STATUSES)
    )
    if not is_manager:
        query = query.eq("assigned_to", current_user.user_id)
    result = query.execute()
    if not result.data:
        current = _load_task(task_id, current_user.hotel_id)
        if current["status"] == "completed":
            return {"data": _authoritative(task_id, current_user.hotel_id), "meta": {"replayed": True}}
        raise HTTPException(status_code=409, detail="Task state changed; refresh and try again")

    meta = {"replayed": False}
    note = request.note.strip() if request and request.note else ""
    if note:
        try:
            supabase.table("task_comments").insert(
                {
                    "task_id": task_id,
                    "tenant_id": current_user.hotel_id,
                    "user_id": current_user.user_id,
                    "comment": note,
                }
            ).execute()
            meta["note_saved"] = True
        except Exception:  # noqa: BLE001 - completion already committed; tell the client
            logger.error("TASK_COMPLETE_NOTE_FAILED task=%s", task_id, exc_info=True)
            meta["note_saved"] = False

    _record_task_audit(current_user, task, "task.completed", {"status": "completed", "completed_at": completed_at})
    return {"data": _authoritative(task_id, current_user.hotel_id), "meta": meta}


# ---------------------------------------------------------------------------
# activity feed
# ---------------------------------------------------------------------------

ACTIVITY_COMMENT_LIMIT = 200
# audit actions that tell us *who* did a transition recorded on the task row
_AUDIT_ACTIONS = ("task.claimed", "task.started", "task.completed")


def _actor_names(user_ids: set, hotel_id: str) -> dict:
    ids = [uid for uid in user_ids if uid]
    if not ids:
        return {}
    rows = (
        supabase.table("user_profiles")
        .select("id, full_name, preferred_name")
        .eq("tenant_id", hotel_id)
        .in_("id", ids)
        .execute()
        .data
        or []
    )
    return {r["id"]: (r.get("preferred_name") or r.get("full_name")) for r in rows}


def _build_activity(task: dict, comments: list[dict], audits: list[dict], names: dict) -> list[dict]:
    """Only persisted facts: the task row's own timestamps (created / started / completed /
    cancelled), the audit rows that say who claimed / started / completed it, and its
    comments. Nothing is inferred — assignment has no timestamp, so it is not an event."""
    audit_by_action: dict = {}
    for row in audits:  # newest audit row per action wins
        audit_by_action[row["action"]] = row

    def actor(user_id):
        return {"actor_id": user_id, "actor_name": names.get(user_id) if user_id else None}

    events: list[dict] = []
    if task.get("created_at"):
        events.append({"id": "created", "kind": "created", "at": task["created_at"], **actor(task.get("created_by"))})
    if task.get("started_at"):
        claimed = audit_by_action.get("task.claimed")
        started = audit_by_action.get("task.started")
        source = claimed or started
        kind = "claimed" if claimed else "started"
        events.append({"id": kind, "kind": kind, "at": task["started_at"], **actor(source.get("actor_id") if source else None)})
    if task.get("status") == "completed" and task.get("completed_at"):
        done = audit_by_action.get("task.completed")
        events.append({"id": "completed", "kind": "completed", "at": task["completed_at"], **actor(done.get("actor_id") if done else None)})
    if task.get("status") == "cancelled" and task.get("cancelled_at"):
        events.append({"id": "cancelled", "kind": "cancelled", "at": task["cancelled_at"], "actor_id": None, "actor_name": None})
    for c in comments:
        events.append(
            {
                "id": f"comment-{c['id']}",
                "kind": "system_note" if c.get("is_system") else "comment",
                "at": c.get("created_at"),
                "text": c.get("comment"),
                **actor(c.get("user_id")),
            }
        )
    events = [e for e in events if e.get("at")]
    events.sort(key=lambda e: (_parse_ts(e["at"]) or datetime.min.replace(tzinfo=timezone.utc), e["id"]))
    return events


@router.get("/{task_id}/activity")
async def get_task_activity(task_id: str, current_user: CurrentUser = Depends(get_current_user)):
    """The task as it is now, plus its persisted activity (oldest first).

    Visibility is exactly that of ``GET /tasks/{id}``: a housekeeper only reaches tasks
    assigned to / created by them or in the open housekeeping pool; everything else, and
    every other tenant's task, is an indistinguishable 404."""
    task = _load_task(task_id, current_user.hotel_id)
    if current_user.role in ASSIGNMENT_BOUND_ROLES and not _assignment_bound_may_access(task, current_user.user_id):
        raise HTTPException(status_code=404, detail="Task not found")

    comments = (
        supabase.table("task_comments")
        .select("id, comment, user_id, is_system, created_at")
        .eq("task_id", task_id)
        .eq("tenant_id", current_user.hotel_id)
        .order("created_at", desc=True)
        .limit(ACTIVITY_COMMENT_LIMIT + 1)
        .execute()
        .data
        or []
    )
    truncated = len(comments) > ACTIVITY_COMMENT_LIMIT
    comments = list(reversed(comments[:ACTIVITY_COMMENT_LIMIT]))
    audits = (
        supabase.table("operational_audit_events")
        .select("action, actor_id, created_at")
        .eq("tenant_id", current_user.hotel_id)
        .eq("resource_type", "task")
        .eq("resource_id", task_id)
        .in_("action", list(_AUDIT_ACTIONS))
        .order("created_at")
        .execute()
        .data
        or []
    )
    user_ids = {task.get("created_by")} | {c.get("user_id") for c in comments} | {a.get("actor_id") for a in audits}
    names = _actor_names(user_ids, current_user.hotel_id)
    decorated = _decorate([task], current_user.hotel_id)[0]
    return {
        "data": {"task": decorated, "events": _build_activity(task, comments, audits, names)},
        "meta": {"truncated": truncated},
    }
