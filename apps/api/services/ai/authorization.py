"""Server-side authorization for the AI copilot.

Everything the client sends -- role, intent hint, context -- is untrusted. The
effective role comes from the verified JWT (``CurrentUser``); this module decides
which AI intents that role may run, which hints are acceptable, which context
keys survive, and whether a context identifier (room / task / document) is one
this person may reference. Nothing here calls a model, so a prompt can never
widen what a role is allowed to do.
"""
from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from typing import Any, Optional

from fastapi import HTTPException

from core.roles import ALL_ROLES, GM_ONLY_ROLES
from services.ai.sop_access import visible_document

# Roles that may create operational records through the domain routes
# (tasks, work orders and guest requests are all open to the floor roles).
CREATION_ROLES = frozenset(ALL_ROLES)

# Mirrors POST /ai/assignments/confirm, the route that executes the preview, which in turn mirrors the
# domain's own room-assignment authority (housekeeping.py: GM + housekeeping supervisor).
ASSIGNMENT_ROLES = frozenset({"housekeeping_supervisor", "gm"})
INSIGHT_ROLES = frozenset(GM_ONLY_ROLES)
TRIAGE_ROLES = frozenset({"engineer", "chief_engineer", "gm"})

# intent -> roles that may run it. ``None`` means any authenticated role.
INTENT_ROLES: dict[str, Optional[frozenset[str]]] = {
    "task_creation": CREATION_ROLES,
    "work_order_creation": CREATION_ROLES,
    "guest_request_creation": CREATION_ROLES,
    "sop_query": CREATION_ROLES,
    "task_assignment": ASSIGNMENT_ROLES,
    "insight_query": INSIGHT_ROLES,
    "work_order_triage": TRIAGE_ROLES,
    "general": None,
    "ambiguous": None,
}

# Intents a client may *ask for*. ``ambiguous`` is something only the server decides.
SUPPORTED_INTENT_HINTS = frozenset(INTENT_ROLES) - {"ambiguous"}

# Context keys that survive sanitising. Anything else (role, room_number, free text
# that would be spliced into a prompt) is dropped.
_ALLOWED_CONTEXT_KEYS = frozenset(
    {"source", "intent_hint", "room_id", "task_id", "document_id", "language", "work_orders"}
)
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_SOURCE_RE = re.compile(r"^[a-z0-9_\-]{1,32}$")
MAX_TRIAGE_WORK_ORDERS = 50
_TRIAGE_FIELDS = ("title", "priority", "due_at", "assigned_to", "room_number")

# Roles that may reference any task in the hotel as AI context.
_TASK_CONTEXT_ANY_ROLES = frozenset({"gm", "housekeeping_supervisor", "chief_engineer"})

# One message for "does not exist", "other hotel" and "not yours", so a probe
# cannot tell which records exist.
NOT_FOUND = "Record not found."
PERMISSION_DENIED = "Your role can't use that assistant action."


def role_may_run(intent: str, role: Optional[str]) -> bool:
    allowed = INTENT_ROLES.get(intent)
    if intent not in INTENT_ROLES:
        return False
    if allowed is None:
        return True
    return role in allowed


def require_creation_role(role: Optional[str]) -> None:
    """Gate for the AI confirm endpoints that mirror the domain create routes."""
    if role not in CREATION_ROLES:
        raise HTTPException(status_code=403, detail=PERMISSION_DENIED)


def parse_intent_hint(context: Optional[dict]) -> Optional[str]:
    """The client's intent hint, or ``None``; a malformed or unsupported hint is a 422."""
    if not context or "intent_hint" not in context or context["intent_hint"] is None:
        return None
    hint = context["intent_hint"]
    if not isinstance(hint, str) or hint.strip() not in SUPPORTED_INTENT_HINTS:
        raise HTTPException(status_code=422, detail="Unsupported intent hint.")
    return hint.strip()


def resolve_intent(detected: str, hint: Optional[str], role: Optional[str]) -> str:
    """Authorize the intent for this role.

    A hint for something the role may not do is refused outright. An intent that
    was only *guessed* from the wording of the message quietly becomes a general
    answer, so ordinary phrasing ("give me a summary") never errors and never
    runs a privileged flow.
    """
    if role_may_run(detected, role):
        return detected
    if hint:
        raise HTTPException(status_code=403, detail=PERMISSION_DENIED)
    return "general"


def _clean_uuid(value: Any, field: str) -> str:
    if not isinstance(value, str) or not _UUID_RE.match(value.strip()):
        raise HTTPException(status_code=422, detail=f"Invalid {field}.")
    return value.strip().lower()


def sanitize_context(context: Optional[dict]) -> dict:
    """Keep only known keys with well-formed values; reject malformed identifiers."""
    if not context:
        return {}
    if not isinstance(context, dict):
        raise HTTPException(status_code=422, detail="Invalid context.")
    clean: dict[str, Any] = {}
    for key in _ALLOWED_CONTEXT_KEYS:
        if key not in context or context[key] is None:
            continue
        value = context[key]
        if key == "source":
            if isinstance(value, str) and _SOURCE_RE.match(value):
                clean[key] = value
        elif key == "intent_hint":
            continue  # handled by parse_intent_hint
        elif key in ("room_id", "task_id", "document_id"):
            clean[key] = _clean_uuid(value, key)
        elif key == "language":
            if value in ("en", "es"):
                clean[key] = value
        elif key == "work_orders":
            if not isinstance(value, list):
                raise HTTPException(status_code=422, detail="Invalid work_orders.")
            rows = []
            for item in value[:MAX_TRIAGE_WORK_ORDERS]:
                if isinstance(item, dict):
                    rows.append({k: item.get(k) for k in _TRIAGE_FIELDS if isinstance(item.get(k), (str, type(None)))})
            clean[key] = rows
    return clean


def _hotel_tz(db: Any, hotel_id: str) -> tzinfo:
    from dateutil import tz as dtz
    from core.timezones import safe_gettz

    name = "America/Chicago"
    try:
        result = db.table("tenants").select("timezone").eq("id", hotel_id).maybe_single().execute()
        name = ((result.data if result else None) or {}).get("timezone") or name
    except Exception:
        pass
    return safe_gettz(name) or dtz.gettz("America/Chicago") or timezone.utc


def _on_open_shift_started_on(db: Any, hotel_id: str, user_id: str, day: date, tz: tzinfo) -> bool:
    """Is this person clocked in on a shift that began on the hotel-local ``day``?"""
    day_start = datetime.combine(day, time.min, tzinfo=tz)
    lo = (day_start - timedelta(hours=12)).astimezone(timezone.utc).isoformat()
    hi = (day_start + timedelta(days=1, hours=12)).astimezone(timezone.utc).isoformat()
    rows = (
        db.table("hk_shift_sessions").select("started_at, ended_at, status")
        .eq("tenant_id", hotel_id).eq("user_id", user_id)
        .gte("started_at", lo).lte("started_at", hi)
        .execute()
    ).data or []
    for row in rows:
        if row.get("ended_at") is not None or row.get("status") == "ended":
            continue
        try:
            started = datetime.fromisoformat(str(row.get("started_at")).replace("Z", "+00:00"))
        except ValueError:
            continue
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        if started.astimezone(tz).date() == day:
            return True
    return False


def _holds_current_assignment(db: Any, hotel_id: str, user_id: str, room_id: str, now: Optional[datetime]) -> bool:
    """Is this room on the person's CURRENT assignment?

    Assignments are keyed by the hotel-local date. Today's row is the room's current assignment: whoever it
    names holds the room, so a reassignment takes it away at once and a stale, expired or future-dated row never
    counts. The one carry-over is an overnight shift: a row dated yesterday still counts while the person is
    clocked in on a shift that began yesterday and nobody has been given the room today.
    """
    tz = _hotel_tz(db, hotel_id)
    today = (now or datetime.now(timezone.utc)).astimezone(tz).date()
    yesterday = today - timedelta(days=1)
    rows = (
        db.table("room_assignments").select("assigned_to, assignment_date")
        .eq("tenant_id", hotel_id).eq("room_id", room_id)
        .gte("assignment_date", yesterday.isoformat()).lte("assignment_date", today.isoformat())
        .execute()
    ).data or []
    by_date = {str(row.get("assignment_date") or "")[:10]: row for row in rows}
    current = by_date.get(today.isoformat())
    if current is not None:
        return current.get("assigned_to") == user_id
    carried = by_date.get(yesterday.isoformat())
    if carried is not None and carried.get("assigned_to") == user_id:
        return _on_open_shift_started_on(db, hotel_id, user_id, yesterday, tz)
    return False


def resolve_trusted_context(
    db: Any, hotel_id: str, user_id: str, role: Optional[str], context: dict, now: Optional[datetime] = None
) -> dict:
    """Verify every identifier in an already-sanitised context against this hotel.

    Returns facts the *server* looked up (never the client's claims). A record in
    another hotel, a record that does not exist and a record this person has no
    business with all answer the same 404.
    """
    trusted: dict[str, Any] = {}

    room_id = context.get("room_id")
    if room_id:
        room = (
            db.table("rooms").select("id, room_number")
            .eq("id", room_id).eq("tenant_id", hotel_id)
            .limit(1).execute()
        ).data or []
        if not room:
            raise HTTPException(status_code=404, detail=NOT_FOUND)
        if role == "housekeeper" and not _holds_current_assignment(db, hotel_id, user_id, room_id, now):
            raise HTTPException(status_code=404, detail=NOT_FOUND)
        trusted["room_id"] = room[0]["id"]
        trusted["room_number"] = room[0].get("room_number")

    task_id = context.get("task_id")
    if task_id:
        rows = (
            db.table("tasks").select("id, title, assigned_to, created_by")
            .eq("id", task_id).eq("tenant_id", hotel_id)
            .limit(1).execute()
        ).data or []
        if not rows:
            raise HTTPException(status_code=404, detail=NOT_FOUND)
        task = rows[0]
        if role not in _TASK_CONTEXT_ANY_ROLES and user_id not in (task.get("assigned_to"), task.get("created_by")):
            raise HTTPException(status_code=404, detail=NOT_FOUND)
        trusted["task_id"] = task["id"]

    document_id = context.get("document_id")
    if document_id:
        # The library's rule, plus approval: this hotel's, indexed, and approved and in force. An indexed upload
        # with no approval record can be browsed but never becomes assistant context presented as policy.
        doc = visible_document(db, hotel_id, document_id, require_indexed=True, require_approved=True)
        if not doc:
            raise HTTPException(status_code=404, detail=NOT_FOUND)
        trusted["document_id"] = doc["id"]
        trusted["document_title"] = doc.get("title")
        if doc.get("approval"):
            trusted["document_version"] = doc["approval"].get("version")

    return trusted
