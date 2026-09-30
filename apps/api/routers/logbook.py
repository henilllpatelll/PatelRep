from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from datetime import date, datetime, timedelta, timezone
import hashlib
import re
from uuid import UUID

from dateutil import tz as dateutil_tz

from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import (
    CreateLogbookEntryRequest,
    UpdateLogbookEntryRequest,
    ResolveLogbookEntryRequest,
    CarryForwardLogbookEntryRequest,
    CreateLogbookCommentRequest,
    GenerateShiftSummaryRequest,
    UpdateLogbookCommentRequest,
    LogbookTranslationRequest,
)
from core.database import supabase
from core.roles import PROGRAM_MANAGER_ROLES
from services.ai.shift_summary import STATS_KEYS as _SUMMARY_STAT_KEYS
from services.ai.logbook_translation import translate_logbook_content

router = APIRouter(prefix="/logbook", tags=["logbook"])

_CONTINUITY_MAX_DEPTH = 25

_RELATED_TABLES = {
    "room": "rooms",
    "task": "tasks",
    "work_order": "work_orders",
    "guest_request": "guest_requests",
}

_ACK_RESET_FIELDS = {"content", "priority", "status", "follow_up_at", "assigned_to", "related_type", "related_id"}


def can_permanently_delete_logbook_entry(role: str) -> bool:
    """A handoff's permanent removal is a GM-only audit exception."""
    return role == "gm"


def logbook_translation_source_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_logbook_attachment_metadata(record: dict) -> dict:
    """Safe attachment representation: storage paths and signed URLs never persist."""
    profile = record.get("collector_profile") or {}
    return {
        "id": record["id"],
        "label": record.get("label") or "Attachment",
        "file_name": record.get("file_name"),
        "file_content_type": record.get("file_content_type"),
        "evidence_type": record.get("evidence_type"),
        "collected_at": record.get("collected_at"),
        "collector_name": profile.get("preferred_name") or profile.get("full_name"),
    }


def _delete_logbook_evidence(hotel_id: str, entry_id: str) -> None:
    """Delete only records owned by this Logbook entry; never shared evidence."""
    records = supabase.table("evidence_records").select("id, storage_path").eq("tenant_id", hotel_id)\
        .eq("related_entity_type", "logbook_entry").eq("related_entity_id", entry_id).execute().data or []
    for record in records:
        if record.get("storage_path"):
            supabase.storage.from_("evidence-files").remove([record["storage_path"]])
        supabase.table("evidence_records").delete().eq("id", record["id"]).eq("tenant_id", hotel_id).execute()


def should_reset_acknowledgments(changed_fields: dict) -> bool:
    """Only changes that alter the handoff's operational meaning reset acceptance."""
    return bool(_ACK_RESET_FIELDS.intersection(changed_fields))


def _entry_or_404(hotel_id: str, entry_id: str, columns: str = "*") -> dict:
    result = supabase.table("logbook_entries").select(columns).eq("id", entry_id).eq("tenant_id", hotel_id).maybe_single().execute()
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Entry not found")
    return result.data


def _validate_ack_targets(hotel_id: str, target_ids: list[str]) -> list[str]:
    unique = sorted(set(target_ids))
    if not unique:
        raise HTTPException(status_code=422, detail="Select at least one staff member for acknowledgment")
    members = supabase.table("user_roles").select("user_id").eq("tenant_id", hotel_id).eq("is_active", True).in_("user_id", unique).execute()
    valid = {str(row["user_id"]) for row in (members.data or [])}
    if valid != set(unique):
        raise HTTPException(status_code=422, detail="One or more selected staff members are unavailable")
    return unique


def _notification_rows(tenant_id: str, recipient_ids: list[str], notification_type: str, title: str, body: str, entry_id: str) -> list[dict]:
    return [{"tenant_id": tenant_id, "user_id": user_id, "type": notification_type, "title": title, "body": body, "data": {"href": f"/logbook?entry={entry_id}"}, "is_read": False} for user_id in sorted(set(recipient_ids))]


def _entry_label(entry: dict) -> str:
    content = (entry.get("content") or "Logbook handoff").strip().replace("\n", " ")
    return content[:80]


def _set_ack_targets(hotel_id: str, entry_id: str, version: int, target_ids: list[str], actor_id: str, entry: dict) -> None:
    rows = [{"tenant_id": hotel_id, "entry_id": entry_id, "user_id": user_id, "version": version} for user_id in target_ids]
    if rows:
        supabase.table("logbook_entry_ack_targets").insert(rows).execute()
        notifications = _notification_rows(hotel_id, [uid for uid in target_ids if uid != actor_id], "logbook_acknowledgment_requested", "Important Logbook handoff requires acknowledgment.", _entry_label(entry), entry_id)
        if notifications:
            supabase.table("notifications").insert(notifications).execute()
    _record_event(hotel_id, entry_id, "acknowledgment_requested", actor_id, {"target_count": len(target_ids), "version": version})


def _record_read(hotel_id: str, entry_id: str, user_id: str) -> dict:
    """Preserve first_read_at while refreshing last_read_at on repeated opens."""
    now = datetime.now(timezone.utc).isoformat()
    existing = supabase.table("logbook_entry_reads").select("id").eq("tenant_id", hotel_id).eq("entry_id", entry_id).eq("user_id", user_id).maybe_single().execute()
    if existing and existing.data:
        result = supabase.table("logbook_entry_reads").update({"last_read_at": now}).eq("id", existing.data["id"]).eq("tenant_id", hotel_id).execute()
    else:
        result = supabase.table("logbook_entry_reads").insert({"tenant_id": hotel_id, "entry_id": entry_id, "user_id": user_id, "first_read_at": now, "last_read_at": now}).execute()
    return (result.data or [{}])[0]


def _normalize_structured_fields(status: str, follow_up_at, assigned_to):
    """Keep informational/resolved notes free of accidental follow-up ownership."""
    if status != "follow_up":
        return None, None
    return follow_up_at, assigned_to


def _validate_assignee(hotel_id: str, assigned_to: Optional[str]) -> None:
    if not assigned_to:
        return
    result = (
        supabase.table("user_roles")
        .select("user_id")
        .eq("tenant_id", hotel_id)
        .eq("user_id", assigned_to)
        .eq("is_active", True)
        .maybe_single()
        .execute()
    )
    if not result or not result.data:
        raise HTTPException(status_code=422, detail="Selected staff member is no longer active")


def _validate_related_item(hotel_id: str, related_type: Optional[str], related_id: Optional[str]) -> None:
    if (related_type is None) != (related_id is None):
        raise HTTPException(status_code=422, detail="Invalid related item")
    if related_type is None:
        return
    table = _RELATED_TABLES.get(related_type)
    if table is None:
        raise HTTPException(status_code=422, detail="Invalid related item")
    result = (
        supabase.table(table)
        .select("id")
        .eq("id", related_id)
        .eq("tenant_id", hotel_id)
        .maybe_single()
        .execute()
    )
    if not result or not result.data:
        raise HTTPException(status_code=422, detail="Invalid related item")


def _expires_at(hours: Optional[int]) -> Optional[str]:
    if hours and hours > 0:
        return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
    return None


def _get_hotel_tz(hotel_id: str):
    result = (
        supabase.table("tenants")
        .select("timezone")
        .eq("id", hotel_id)
        .maybe_single()
        .execute()
    )
    tz_name = ((result.data if result else None) or {}).get("timezone") or "America/Chicago"
    return dateutil_tz.gettz(tz_name) or dateutil_tz.gettz("America/Chicago")


def _hotel_today(hotel_id: str) -> str:
    return datetime.now(_get_hotel_tz(hotel_id)).date().isoformat()


def _resolve_current_shift(hotel_id: str) -> Optional[dict]:
    """Pick the shift template whose window most recently closed, hotel-local time.

    Used by the manual "generate summary" flow so the caller never has to know a
    real `shifts.id` up front — mirrors the cron's per-shift generation semantics
    (routers/internal.py's generate_shift_summaries), just resolved on demand for
    whichever shift last ended relative to now instead of iterating every shift.
    """
    tz = _get_hotel_tz(hotel_id)
    now_minutes = datetime.now(tz).hour * 60 + datetime.now(tz).minute

    shifts_result = supabase.table("shifts")\
        .select("id, name, department_id, end_time")\
        .eq("tenant_id", hotel_id)\
        .eq("is_active", True)\
        .execute()
    shifts = shifts_result.data or []
    if not shifts:
        return None

    def _end_minutes(shift: dict) -> int:
        hours, minutes, *_ = str(shift["end_time"]).split(":")
        return int(hours) * 60 + int(minutes)

    return min(shifts, key=lambda s: (now_minutes - _end_minutes(s)) % (24 * 60))


def _time_to_minutes(value: str) -> int:
    hours, minutes, *_ = str(value).split(":")
    return int(hours) * 60 + int(minutes)


def _is_shift_active_at(local_minutes: int, shift: dict) -> bool:
    """Return whether the hotel-local time is inside a [start, end) shift window."""
    start_minutes = _time_to_minutes(shift["start_time"])
    end_minutes = _time_to_minutes(shift["end_time"])
    if start_minutes == end_minutes:
        return False
    if start_minutes < end_minutes:
        return start_minutes <= local_minutes < end_minutes
    return local_minutes >= start_minutes or local_minutes < end_minutes


def _resolve_active_shift(hotel_id: str, department_id: str) -> Optional[dict]:
    """Safely resolve this department's currently active shift template.

    This deliberately differs from ``_resolve_current_shift``: manual entries
    belong to the shift in progress, while summary generation targets the shift
    that most recently ended.
    """
    hotel_now = datetime.now(_get_hotel_tz(hotel_id))
    local_minutes = hotel_now.hour * 60 + hotel_now.minute
    result = (
        supabase.table("shifts")
        .select("id, name, department_id, start_time, end_time")
        .eq("tenant_id", hotel_id)
        .eq("department_id", department_id)
        .eq("is_active", True)
        .execute()
    )
    active_shifts = [
        shift for shift in (result.data or [])
        if _is_shift_active_at(local_minutes, shift)
    ]
    # Overlapping templates are ambiguous configuration. Prefer no association to
    # attaching a handoff entry to the wrong shift.
    return active_shifts[0] if len(active_shifts) == 1 else None


def _record_event(tenant_id: str, entry_id: str, event_type: str, actor_id: Optional[str], metadata: Optional[dict] = None) -> None:
    supabase.table("logbook_entry_events").insert({
        "tenant_id": tenant_id,
        "entry_id": entry_id,
        "event_type": event_type,
        "actor_id": actor_id,
        "metadata": metadata or {},
    }).execute()


def _get_shift(hotel_id: str, shift_id: str) -> Optional[dict]:
    result = (
        supabase.table("shifts")
        .select("id, name, department_id, start_time, end_time")
        .eq("tenant_id", hotel_id)
        .eq("id", shift_id)
        .maybe_single()
        .execute()
    )
    return result.data if result else None


def _resolve_next_shift(hotel_id: str, department_id: str, current_shift_id: str) -> Optional[dict]:
    """Next shift in this department's rotation, ordered by start_time and
    wrapping around — mirrors the web client's getNextShift (logbookWorkspace.ts)
    so Carry Forward always targets the same shift the UI would show as "next"."""
    result = (
        supabase.table("shifts")
        .select("id, name, department_id, start_time, end_time")
        .eq("tenant_id", hotel_id)
        .eq("department_id", department_id)
        .eq("is_active", True)
        .execute()
    )
    shifts = sorted(result.data or [], key=lambda s: _time_to_minutes(s["start_time"]))
    if len(shifts) < 2:
        return None
    index = next((i for i, s in enumerate(shifts) if s["id"] == current_shift_id), None)
    if index is None:
        return None
    return shifts[(index + 1) % len(shifts)]


def _fetch_entry_for_continuity(hotel_id: str, entry_id: str) -> Optional[dict]:
    result = (
        supabase.table("logbook_entries")
        .select("id, shift_id, entry_date, status, created_at, resolved_at, carried_from_entry_id, author_id, shifts(name)")
        .eq("id", entry_id)
        .eq("tenant_id", hotel_id)
        .maybe_single()
        .execute()
    )
    return result.data if result else None


def _resolve_user_name(user_id: Optional[str]) -> Optional[str]:
    if not user_id:
        return None
    result = (
        supabase.table("user_profiles")
        .select("preferred_name, full_name")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    data = (result.data if result else None) or {}
    return data.get("preferred_name") or data.get("full_name")


_LOGBOOK_CATEGORIES = {"guest", "room", "maintenance", "safety", "general"}
_LOGBOOK_STATUSES = {"informational", "follow_up", "resolved"}
_LOGBOOK_PRIORITIES = {"normal", "important"}
_LOGBOOK_RELATED_TYPES = set(_RELATED_TABLES)


def _valid_uuid(value: Optional[str], *, allow_unassigned: bool = False) -> Optional[str]:
    if allow_unassigned and value == "__unassigned__":
        return value
    if not value:
        return None
    try:
        return str(UUID(value))
    except (ValueError, AttributeError, TypeError):
        return None


def _valid_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def _safe_search_text(value: Optional[str]) -> str:
    """Keep PostgREST's raw `or` expression free of user syntax.

    The primary `.ilike` path is already parameterized by the SDK. Room lookup
    needs an OR expression, so it receives only letters, digits, and spaces.
    This deliberately treats punctuation as word separators rather than trying
    to interpret PostgREST's filter grammar from user input.
    """
    if not isinstance(value, str):
        return ""
    return re.sub(r"[^a-zA-Z0-9]+", " ", value).strip()[:160]


def _room_ids_matching_search(hotel_id: str, search_text: str) -> list[str]:
    numeric_tokens = [token for token in search_text.split() if any(char.isdigit() for char in token)]
    if not numeric_tokens:
        return []
    # Searching room numbers is a common operational-memory workflow. This
    # tenant-scoped lookup is bounded and is combined into the main query, not
    # expanded into one request per entry.
    result = (
        supabase.table("rooms")
        .select("id")
        .eq("tenant_id", hotel_id)
        .ilike("room_number", f"%{numeric_tokens[-1]}%")
        .limit(25)
        .execute()
    )
    return [str(row["id"]) for row in (result.data or []) if row.get("id")]


def _build_entries_query(hotel_id: str, department_id, shift_id, entry_date, date_from, date_to, page, per_page):
    q = supabase.table("logbook_entries")\
        .select("*, departments(name)", count="exact")\
        .eq("tenant_id", hotel_id)\
        .is_("archived_at", "null")\
        .order("created_at", desc=True)\
        .range((page - 1) * per_page, page * per_page - 1)
    if department_id:
        q = q.eq("department_id", department_id)
    if shift_id:
        q = q.eq("shift_id", shift_id)
    if entry_date:
        q = q.eq("entry_date", entry_date.isoformat())
    elif date_from or date_to:
        if date_from:
            q = q.gte("entry_date", date_from.isoformat())
        if date_to:
            q = q.lte("entry_date", date_to.isoformat())
    return q


def _attach_author_profiles(entries: list[dict]) -> list[dict]:
    """Batch-hydrate the existing ``user_profiles`` response field.

    Profiles are keyed globally by user id. The only requested ids come from an
    already tenant-scoped entry result, so this never broadens tenant visibility.
    """
    profile_ids = sorted({
        profile_id
        for entry in entries
        for profile_id in (entry.get("author_id"), entry.get("assigned_to"), entry.get("resolved_by"))
        if profile_id
    })
    if not profile_ids:
        return entries

    profiles_result = (
        supabase.table("user_profiles")
        .select("id, preferred_name, full_name")
        .in_("id", profile_ids)
        .execute()
    )
    profiles = {
        profile["id"]: {
            key: profile[key]
            for key in ("preferred_name", "full_name")
            if profile.get(key) is not None
        }
        for profile in (profiles_result.data or [])
        if profile.get("id")
    }
    hydrated = []
    for entry in entries:
        item = dict(entry)
        if entry.get("author_id") in profiles:
            item["user_profiles"] = profiles[entry["author_id"]]
        if entry.get("assigned_to") in profiles:
            item["assigned_user_profiles"] = profiles[entry["assigned_to"]]
        if entry.get("resolved_by") in profiles:
            item["resolved_by_profile"] = profiles[entry["resolved_by"]]
        hydrated.append(item)
    return hydrated


def _attach_collaboration(entries: list[dict], hotel_id: str, current_user_id: str) -> list[dict]:
    """Batch collaboration metadata for list/detail responses; never one query per card."""
    ids = [str(entry["id"]) for entry in entries if entry.get("id")]
    if not ids:
        return entries
    comments = supabase.table("logbook_entry_comments").select("entry_id").eq("tenant_id", hotel_id).in_("entry_id", ids).is_("deleted_at", "null").execute().data or []
    reads = supabase.table("logbook_entry_reads").select("entry_id,user_id").eq("tenant_id", hotel_id).in_("entry_id", ids).execute().data or []
    targets = supabase.table("logbook_entry_ack_targets").select("entry_id,user_id,version").eq("tenant_id", hotel_id).in_("entry_id", ids).execute().data or []
    acknowledgments = supabase.table("logbook_entry_acknowledgments").select("entry_id,user_id,version").eq("tenant_id", hotel_id).in_("entry_id", ids).execute().data or []
    attachments = supabase.table("evidence_records").select("related_entity_id").eq("tenant_id", hotel_id)\
        .eq("related_entity_type", "logbook_entry").in_("related_entity_id", ids).execute().data or []
    comment_counts: dict[str, int] = {}
    read_users: dict[str, set] = {}
    attachment_counts: dict[str, int] = {}
    for row in comments: comment_counts[row["entry_id"]] = comment_counts.get(row["entry_id"], 0) + 1
    for row in reads: read_users.setdefault(row["entry_id"], set()).add(str(row["user_id"]))
    for row in attachments:
        related_id = str(row.get("related_entity_id"))
        attachment_counts[related_id] = attachment_counts.get(related_id, 0) + 1
    hydrated = []
    for entry in entries:
        item = dict(entry)
        entry_id, version = str(entry["id"]), int(entry.get("acknowledgment_version") or 1)
        current_targets = {str(row["user_id"]) for row in targets if str(row["entry_id"]) == entry_id and int(row.get("version") or 1) == version}
        current_acks = {str(row["user_id"]) for row in acknowledgments if str(row["entry_id"]) == entry_id and int(row.get("version") or 1) == version}
        item.update({
            "comment_count": comment_counts.get(entry_id, 0),
            "read_count": len(read_users.get(entry_id, set())),
            "attachment_count": attachment_counts.get(entry_id, 0),
            "acknowledgment": {"required": bool(entry.get("requires_acknowledgment")), "total_required": len(current_targets), "acknowledged_count": len(current_acks), "current_user_required": current_user_id in current_targets, "current_user_acknowledged": current_user_id in current_acks},
        })
        hydrated.append(item)
    return hydrated


def _hydrate_comments(comments: list[dict]) -> list[dict]:
    author_ids = sorted({str(comment["author_id"]) for comment in comments if comment.get("author_id")})
    profiles = supabase.table("user_profiles").select("id,preferred_name,full_name").in_("id", author_ids).execute().data or [] if author_ids else []
    by_id = {str(profile["id"]): {"id": profile["id"], "preferred_name": profile.get("preferred_name"), "full_name": profile.get("full_name")} for profile in profiles}
    return [{**comment, "author": by_id.get(str(comment.get("author_id")), {"id": comment.get("author_id"), "preferred_name": None, "full_name": None})} for comment in comments]


def _complete_summary_stats(stats: Optional[dict]) -> dict:
    source = stats or {}
    completed = {key: int(source.get(key) or 0) for key in _SUMMARY_STAT_KEYS}
    if source.get("model_used"):
        completed["model_used"] = source["model_used"]
    return completed


def _summary_with_stats(summary: dict) -> dict:
    stats = _complete_summary_stats(summary.get("stats"))
    return {**summary, **stats, "stats": stats}


@router.post("/entries")
async def create_logbook_entry(
    request: CreateLogbookEntryRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    if request.status == "resolved":
        raise HTTPException(status_code=422, detail="New logbook entries cannot be created as resolved")
    follow_up_at, assigned_to = _normalize_structured_fields(
        request.status, request.follow_up_at, str(request.assigned_to) if request.assigned_to else None,
    )
    _validate_assignee(current_user.hotel_id, assigned_to)
    related_type = request.related_type
    related_id = str(request.related_id) if request.related_id else None
    _validate_related_item(current_user.hotel_id, related_type, related_id)
    ack_targets: list[str] = []
    if request.requires_acknowledgment:
        if request.priority != "important":
            raise HTTPException(status_code=422, detail="Acknowledgment is available for important handoffs")
        ack_targets = _validate_ack_targets(current_user.hotel_id, [str(item) for item in request.acknowledgment_target_ids])
    payload = {
        "tenant_id": current_user.hotel_id,
        "department_id": str(request.department_id),
        "shift_id": str(request.shift_id) if request.shift_id else None,
        "author_id": current_user.user_id,
        "content": request.content.strip(),
        "entry_date": _hotel_today(current_user.hotel_id),
        "category": request.category,
        "status": request.status,
        "priority": request.priority,
        "follow_up_at": follow_up_at.isoformat() if follow_up_at else None,
        "assigned_to": assigned_to,
        "related_type": related_type,
        "related_id": related_id,
        "requires_acknowledgment": request.requires_acknowledgment,
    }
    if payload["shift_id"] is None:
        active_shift = _resolve_active_shift(current_user.hotel_id, payload["department_id"])
        payload["shift_id"] = active_shift["id"] if active_shift else None
    expires = _expires_at(request.expires_hours)
    if expires:
        payload["expires_at"] = expires

    try:
        result = supabase.table("logbook_entries").insert(payload).execute()
    except Exception:
        payload.pop("expires_at", None)
        result = supabase.table("logbook_entries").insert(payload).execute()

    entry = result.data[0] if result.data else None
    if entry:
        _record_event(current_user.hotel_id, entry["id"], "created", current_user.user_id)
        if request.requires_acknowledgment:
            _set_ack_targets(current_user.hotel_id, entry["id"], 1, ack_targets, current_user.user_id, entry)
    return {"data": _attach_author_profiles([entry])[0] if entry else None}


@router.get("/entries")
async def list_logbook_entries(
    department_id: Optional[str] = Query(None),
    shift_id: Optional[str] = Query(None),
    entry_date: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    q: Optional[str] = Query(None, max_length=160),
    category: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    author_id: Optional[str] = Query(None),
    assigned_to: Optional[str] = Query(None),
    related_type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user)
):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")
    normalized_entry_date = _valid_date(entry_date)
    normalized_date_from = _valid_date(date_from)
    normalized_date_to = _valid_date(date_to)
    if entry_date and normalized_entry_date is None:
        normalized_entry_date = None
    if normalized_date_from and normalized_date_to and normalized_date_from > normalized_date_to:
        raise HTTPException(status_code=422, detail="date_from must be on or before date_to")
    # Exact-date navigation is deliberately authoritative if both styles arrive
    # through an old/shared URL; broad date ranges are search-only constraints.
    normalized_department_id = _valid_uuid(department_id)
    normalized_shift_id = _valid_uuid(shift_id)
    normalized_author_id = _valid_uuid(author_id)
    normalized_assigned_to = _valid_uuid(assigned_to, allow_unassigned=True)
    normalized_category = category if category in _LOGBOOK_CATEGORIES else None
    normalized_status = status if status in _LOGBOOK_STATUSES else None
    normalized_priority = priority if priority in _LOGBOOK_PRIORITIES else None
    normalized_related_type = related_type if related_type in _LOGBOOK_RELATED_TYPES else None
    search_text = _safe_search_text(q)
    kwargs = dict(
        hotel_id=current_user.hotel_id,
        department_id=normalized_department_id,
        shift_id=normalized_shift_id,
        entry_date=normalized_entry_date,
        date_from=normalized_date_from,
        date_to=normalized_date_to,
        page=page,
        per_page=per_page,
    )

    q = _build_entries_query(**kwargs)
    if normalized_category:
        q = q.eq("category", normalized_category)
    if normalized_status:
        q = q.eq("status", normalized_status)
    if normalized_priority:
        q = q.eq("priority", normalized_priority)
    if normalized_author_id:
        q = q.eq("author_id", normalized_author_id)
    if normalized_assigned_to == "__unassigned__":
        q = q.is_("assigned_to", "null")
    elif normalized_assigned_to:
        q = q.eq("assigned_to", normalized_assigned_to)
    if normalized_related_type:
        q = q.eq("related_type", normalized_related_type)
    if search_text:
        room_ids = _room_ids_matching_search(current_user.hotel_id, search_text)
        if room_ids:
            # `search_text` is normalized to alphanumerics/spaces above, and ids
            # originate from a tenant-scoped database lookup, so this expression
            # cannot be used to inject PostgREST filter syntax.
            q = q.or_(f"content.ilike.*{search_text}*,related_id.in.({','.join(room_ids)})")
        else:
            q = q.ilike("content", f"%{search_text}%")

    result = q.or_(f"expires_at.is.null,expires_at.gt.{now}").execute()
    result_count = getattr(result, "count", None)
    total = result_count if result_count is not None else len(result.data or [])
    return {
        "data": _attach_collaboration(_attach_author_profiles(result.data or []), current_user.hotel_id, current_user.user_id),
        "meta": {"page": page, "per_page": per_page, "total": total, "has_more": page * per_page < total},
    }


@router.get("/entries/{entry_id}/comments")
async def list_logbook_comments(entry_id: str, current_user: CurrentUser = Depends(get_current_user)):
    _entry_or_404(current_user.hotel_id, entry_id, "id")
    result = supabase.table("logbook_entry_comments").select("*").eq("tenant_id", current_user.hotel_id).eq("entry_id", entry_id).is_("deleted_at", "null").order("created_at").execute()
    return {"data": _hydrate_comments(result.data or [])}


@router.post("/entries/{entry_id}/comments")
async def create_logbook_comment(entry_id: str, request: CreateLogbookCommentRequest, current_user: CurrentUser = Depends(get_current_user)):
    entry = _entry_or_404(current_user.hotel_id, entry_id)
    content = request.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="Comment cannot be empty")
    mentioned_ids = _validate_ack_targets(current_user.hotel_id, [str(item) for item in request.mentioned_user_ids]) if request.mentioned_user_ids else []
    result = supabase.table("logbook_entry_comments").insert({"tenant_id": current_user.hotel_id, "entry_id": entry_id, "author_id": current_user.user_id, "content": content}).execute()
    comment = (result.data or [None])[0]
    if not comment:
        raise HTTPException(status_code=500, detail="Unable to save comment")
    if mentioned_ids:
        supabase.table("logbook_comment_mentions").insert([{"tenant_id": current_user.hotel_id, "comment_id": comment["id"], "mentioned_user_id": user_id} for user_id in mentioned_ids]).execute()
        rows = _notification_rows(current_user.hotel_id, [user_id for user_id in mentioned_ids if user_id != current_user.user_id], "logbook_mention", "You were mentioned in a Logbook handoff.", _entry_label(entry), entry_id)
        if rows: supabase.table("notifications").insert(rows).execute()
    _record_event(current_user.hotel_id, entry_id, "comment_added", current_user.user_id)
    return {"data": _hydrate_comments([comment])[0]}


@router.patch("/comments/{comment_id}")
async def update_logbook_comment(comment_id: str, request: UpdateLogbookCommentRequest, current_user: CurrentUser = Depends(get_current_user)):
    current = supabase.table("logbook_entry_comments").select("*").eq("id", comment_id).eq("tenant_id", current_user.hotel_id).is_("deleted_at", "null").maybe_single().execute()
    if not current or not current.data: raise HTTPException(status_code=404, detail="Comment not found")
    comment = current.data
    if comment["author_id"] != current_user.user_id: raise HTTPException(status_code=403, detail="Not allowed to edit this comment")
    content = request.content.strip()
    if not content: raise HTTPException(status_code=422, detail="Comment cannot be empty")
    mentioned_ids = _validate_ack_targets(current_user.hotel_id, [str(item) for item in request.mentioned_user_ids]) if request.mentioned_user_ids else []
    existing = supabase.table("logbook_comment_mentions").select("mentioned_user_id").eq("tenant_id", current_user.hotel_id).eq("comment_id", comment_id).execute().data or []
    existing_ids = {str(row["mentioned_user_id"]) for row in existing}
    supabase.table("logbook_comment_mentions").delete().eq("tenant_id", current_user.hotel_id).eq("comment_id", comment_id).execute()
    if mentioned_ids: supabase.table("logbook_comment_mentions").insert([{"tenant_id": current_user.hotel_id, "comment_id": comment_id, "mentioned_user_id": user_id} for user_id in mentioned_ids]).execute()
    result = supabase.table("logbook_entry_comments").update({"content": content, "edited_at": datetime.now(timezone.utc).isoformat()}).eq("id", comment_id).eq("tenant_id", current_user.hotel_id).execute()
    updated = (result.data or [None])[0]
    newly_mentioned = [user_id for user_id in mentioned_ids if user_id not in existing_ids and user_id != current_user.user_id]
    if newly_mentioned:
        entry = _entry_or_404(current_user.hotel_id, comment["entry_id"])
        supabase.table("notifications").insert(_notification_rows(current_user.hotel_id, newly_mentioned, "logbook_mention", "You were mentioned in a Logbook handoff.", _entry_label(entry), comment["entry_id"])).execute()
    return {"data": _hydrate_comments([updated])[0] if updated else None}


@router.delete("/comments/{comment_id}")
async def delete_logbook_comment(comment_id: str, current_user: CurrentUser = Depends(get_current_user)):
    current = supabase.table("logbook_entry_comments").select("author_id").eq("id", comment_id).eq("tenant_id", current_user.hotel_id).is_("deleted_at", "null").maybe_single().execute()
    if not current or not current.data: raise HTTPException(status_code=404, detail="Comment not found")
    if current.data["author_id"] != current_user.user_id and current_user.role not in PROGRAM_MANAGER_ROLES: raise HTTPException(status_code=403, detail="Not allowed to delete this comment")
    supabase.table("logbook_entry_comments").update({"deleted_at": datetime.now(timezone.utc).isoformat()}).eq("id", comment_id).eq("tenant_id", current_user.hotel_id).execute()
    return {"data": {"success": True}}


@router.post("/entries/{entry_id}/read")
async def mark_logbook_entry_read(entry_id: str, current_user: CurrentUser = Depends(get_current_user)):
    _entry_or_404(current_user.hotel_id, entry_id, "id")
    return {"data": _record_read(current_user.hotel_id, entry_id, current_user.user_id)}


@router.get("/entries/{entry_id}/reads")
async def list_logbook_entry_reads(entry_id: str, current_user: CurrentUser = Depends(get_current_user)):
    _entry_or_404(current_user.hotel_id, entry_id, "id")
    reads = supabase.table("logbook_entry_reads").select("user_id,first_read_at,last_read_at").eq("tenant_id", current_user.hotel_id).eq("entry_id", entry_id).order("last_read_at", desc=True).execute().data or []
    profiles = supabase.table("user_profiles").select("id,preferred_name,full_name").in_("id", [row["user_id"] for row in reads]).execute().data or [] if reads else []
    names = {str(row["id"]): row.get("preferred_name") or row.get("full_name") or "Team member" for row in profiles}
    return {"data": [{**row, "name": names.get(str(row["user_id"]), "Team member")} for row in reads]}


@router.post("/entries/{entry_id}/acknowledge")
async def acknowledge_logbook_entry(entry_id: str, current_user: CurrentUser = Depends(get_current_user)):
    entry = _entry_or_404(current_user.hotel_id, entry_id)
    version = int(entry.get("acknowledgment_version") or 1)
    target = supabase.table("logbook_entry_ack_targets").select("id").eq("tenant_id", current_user.hotel_id).eq("entry_id", entry_id).eq("version", version).eq("user_id", current_user.user_id).maybe_single().execute()
    if not entry.get("requires_acknowledgment") or not target or not target.data: raise HTTPException(status_code=403, detail="You are not required to acknowledge this handoff")
    now = datetime.now(timezone.utc).isoformat()
    supabase.table("logbook_entry_acknowledgments").upsert({"tenant_id": current_user.hotel_id, "entry_id": entry_id, "user_id": current_user.user_id, "version": version, "acknowledged_at": now}, on_conflict="entry_id,user_id,version").execute()
    _record_read(current_user.hotel_id, entry_id, current_user.user_id)
    return {"data": {"success": True, "version": version}}


@router.post("/entries/{entry_id}/acknowledgment-reminder")
async def remind_logbook_ack_targets(entry_id: str, current_user: CurrentUser = Depends(get_current_user)):
    if current_user.role not in PROGRAM_MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="Not allowed to send acknowledgment reminders")
    entry = _entry_or_404(current_user.hotel_id, entry_id)
    if not entry.get("requires_acknowledgment") or entry.get("status") == "resolved":
        raise HTTPException(status_code=422, detail="This handoff has no actionable acknowledgments")
    version = int(entry.get("acknowledgment_version") or 1)
    targets = supabase.table("logbook_entry_ack_targets").select("user_id").eq("tenant_id", current_user.hotel_id).eq("entry_id", entry_id).eq("version", version).execute().data or []
    acknowledgments = supabase.table("logbook_entry_acknowledgments").select("user_id").eq("tenant_id", current_user.hotel_id).eq("entry_id", entry_id).eq("version", version).execute().data or []
    acknowledged = {str(row["user_id"]) for row in acknowledgments}
    pending = [str(row["user_id"]) for row in targets if str(row["user_id"]) not in acknowledged]
    if not pending: return {"data": {"sent": 0, "rate_limited": False}}
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    recent = supabase.table("notifications").select("id").eq("tenant_id", current_user.hotel_id).eq("type", "logbook_acknowledgment_reminder").gte("created_at", cutoff).contains("data", {"entry_id": entry_id, "version": version}).limit(1).execute()
    if recent and recent.data:
        return {"data": {"sent": 0, "rate_limited": True}}
    rows = [{"tenant_id": current_user.hotel_id, "user_id": user_id, "type": "logbook_acknowledgment_reminder", "title": "Reminder: Logbook handoff requires acknowledgment.", "body": _entry_label(entry), "data": {"href": f"/logbook?entry={entry_id}", "entry_id": entry_id, "version": version}, "is_read": False} for user_id in pending]
    supabase.table("notifications").insert(rows).execute()
    return {"data": {"sent": len(rows), "rate_limited": False}}


@router.get("/entries/{entry_id}")
async def get_logbook_entry(
    entry_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    result = supabase.table("logbook_entries")\
        .select("*, departments(name)")\
        .eq("id", entry_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"data": _attach_collaboration(_attach_author_profiles([result.data]), current_user.hotel_id, current_user.user_id)[0]}


@router.get("/entries/{entry_id}/attachments")
async def list_logbook_attachments(
    entry_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Return attachment metadata only. Viewing always obtains a fresh Evidence URL."""
    _entry_or_404(current_user.hotel_id, entry_id, "id")
    records = supabase.table("evidence_records").select(
        "id, label, evidence_type, file_name, file_content_type, collected_by, collected_at"
    ).eq("tenant_id", current_user.hotel_id).eq("related_entity_type", "logbook_entry")\
        .eq("related_entity_id", entry_id).order("collected_at", desc=True).execute().data or []
    collector_ids = [record["collected_by"] for record in records if record.get("collected_by")]
    profiles = supabase.table("user_profiles").select("id, preferred_name, full_name").eq(
        "tenant_id", current_user.hotel_id
    ).in_("id", collector_ids).execute().data or [] if collector_ids else []
    profiles_by_id = {str(profile["id"]): profile for profile in profiles}
    return {"data": [build_logbook_attachment_metadata({
        **record, "collector_profile": profiles_by_id.get(str(record.get("collected_by"))),
    }) for record in records]}


@router.delete("/entries/{entry_id}/attachments/{record_id}", status_code=204)
async def remove_logbook_attachment(
    entry_id: str,
    record_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    entry = _entry_or_404(current_user.hotel_id, entry_id, "author_id")
    if not (entry["author_id"] == current_user.user_id or current_user.role in PROGRAM_MANAGER_ROLES):
        raise HTTPException(status_code=403, detail="Not allowed to remove this attachment")
    record = supabase.table("evidence_records").select("id, storage_path").eq("id", record_id)\
        .eq("tenant_id", current_user.hotel_id).eq("related_entity_type", "logbook_entry")\
        .eq("related_entity_id", entry_id).maybe_single().execute()
    if not record or not record.data:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if record.data.get("storage_path"):
        supabase.storage.from_("evidence-files").remove([record.data["storage_path"]])
    supabase.table("evidence_records").delete().eq("id", record_id).eq("tenant_id", current_user.hotel_id).execute()
    _record_event(current_user.hotel_id, entry_id, "attachment_removed", current_user.user_id, {"attachment_id": record_id})
    return None


def _translated_logbook_text(
    *, source_type: str, source_id: str, source_text: str, target_language: str, hotel_id: str,
) -> dict:
    source_hash = logbook_translation_source_hash(source_text)
    cached = supabase.table("logbook_content_translations").select(
        "translated_text, source_language"
    ).eq("tenant_id", hotel_id).eq("source_type", source_type).eq("source_id", source_id)\
        .eq("source_hash", source_hash).eq("target_language", target_language).maybe_single().execute()
    if cached and cached.data:
        return {"translated_text": cached.data["translated_text"], "source_language": cached.data.get("source_language"), "cached": True}
    translation = translate_logbook_content(source_text, target_language)
    payload = {
        "tenant_id": hotel_id, "source_type": source_type, "source_id": source_id,
        "source_hash": source_hash, "source_language": translation["source_language"],
        "target_language": target_language, "translated_text": translation["translated_text"],
        "provider": "openai:gpt-4o-mini",
    }
    supabase.table("logbook_content_translations").insert(payload).execute()
    return {"translated_text": payload["translated_text"], "source_language": payload["source_language"], "cached": False}


@router.post("/entries/{entry_id}/translate")
async def translate_logbook_entry(
    entry_id: str,
    request: LogbookTranslationRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    entry = _entry_or_404(current_user.hotel_id, entry_id, "content, resolution_note")
    source_text = entry.get(request.source_field)
    if not source_text:
        raise HTTPException(status_code=422, detail="There is no text to translate")
    return {"data": _translated_logbook_text(
        source_type=f"entry_{request.source_field}", source_id=entry_id, source_text=source_text,
        target_language=request.target_language, hotel_id=current_user.hotel_id,
    )}


@router.post("/comments/{comment_id}/translate")
async def translate_logbook_comment(
    comment_id: str,
    request: LogbookTranslationRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    if request.source_field != "content":
        raise HTTPException(status_code=422, detail="Comments only have comment text to translate")
    comment = supabase.table("logbook_entry_comments").select("id, content").eq("id", comment_id)\
        .eq("tenant_id", current_user.hotel_id).is_("deleted_at", "null").maybe_single().execute()
    if not comment or not comment.data:
        raise HTTPException(status_code=404, detail="Comment not found")
    return {"data": _translated_logbook_text(
        source_type="comment", source_id=comment_id, source_text=comment.data["content"],
        target_language=request.target_language, hotel_id=current_user.hotel_id,
    )}


@router.patch("/entries/{entry_id}")
async def update_logbook_entry(
    entry_id: str,
    request: UpdateLogbookEntryRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    row = supabase.table("logbook_entries")\
        .select("author_id, tenant_id, content, category, status, priority, follow_up_at, assigned_to, related_type, related_id, expires_at, requires_acknowledgment, acknowledgment_version")\
        .eq("id", entry_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    if not row or not row.data:
        raise HTTPException(status_code=404, detail="Entry not found")

    is_author = row.data["author_id"] == current_user.user_id
    is_privileged = current_user.role in PROGRAM_MANAGER_ROLES
    if not (is_author or is_privileged):
        raise HTTPException(status_code=403, detail="Not allowed to edit this entry")

    submitted = request.model_dump(exclude_unset=True)
    updates: dict = {}
    current = row.data
    for field in ("content", "category", "priority", "status"):
        if field in submitted:
            updates[field] = submitted[field].strip() if field == "content" and submitted[field] is not None else submitted[field]

    if "requires_acknowledgment" in submitted:
        if submitted["requires_acknowledgment"] and updates.get("priority", current.get("priority")) != "important":
            raise HTTPException(status_code=422, detail="Acknowledgment is available for important handoffs")
        updates["requires_acknowledgment"] = submitted["requires_acknowledgment"]

    status = updates.get("status", current.get("status") or "informational")
    requested_assignee = submitted.get("assigned_to", current.get("assigned_to"))
    requested_follow_up_at = submitted.get("follow_up_at", current.get("follow_up_at"))
    follow_up_at, assigned_to = _normalize_structured_fields(
        status,
        requested_follow_up_at,
        str(requested_assignee) if requested_assignee else None,
    )
    if any(field in submitted for field in ("status", "assigned_to", "follow_up_at")):
        updates["follow_up_at"] = follow_up_at.isoformat() if hasattr(follow_up_at, "isoformat") else follow_up_at
        updates["assigned_to"] = assigned_to
        _validate_assignee(current_user.hotel_id, assigned_to)

    related_type = submitted.get("related_type", current.get("related_type"))
    related_id = submitted.get("related_id", current.get("related_id"))
    if any(field in submitted for field in ("related_type", "related_id")):
        related_id = str(related_id) if related_id else None
        _validate_related_item(current_user.hotel_id, related_type, related_id)
        updates["related_type"] = related_type
        updates["related_id"] = related_id

    if status == "resolved" and current.get("status") != "resolved":
        updates["resolved_at"] = datetime.now(timezone.utc).isoformat()
        updates["resolved_by"] = current_user.user_id

    if "expires_hours" in submitted:
        updates["expires_at"] = _expires_at(submitted["expires_hours"])

    meaningful_updates = {
        key: value for key, value in updates.items()
        if current.get(key) != value
    }
    if not meaningful_updates:
        raise HTTPException(status_code=422, detail="No fields to update")

    resolved_now = meaningful_updates.get("status") == "resolved" and current.get("status") != "resolved"
    target_ids = submitted.get("acknowledgment_target_ids")
    must_reset_acks = bool(current.get("requires_acknowledgment")) and should_reset_acknowledgments(meaningful_updates)
    if target_ids is not None and (submitted.get("requires_acknowledgment", current.get("requires_acknowledgment"))):
        targets = _validate_ack_targets(current_user.hotel_id, [str(item) for item in target_ids])
        must_reset_acks = True
    else:
        targets = []
    if must_reset_acks:
        meaningful_updates["acknowledgment_version"] = int(current.get("acknowledgment_version") or 1) + 1
    if not resolved_now:
        meaningful_updates["edited_at"] = datetime.now(timezone.utc).isoformat()

    result = (
        supabase.table("logbook_entries")
        .update(meaningful_updates)
        .eq("id", entry_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )

    entry = result.data[0] if result.data else None
    if entry:
        if resolved_now:
            _record_event(current_user.hotel_id, entry_id, "resolved", current_user.user_id)
        else:
            changed_fields = [key for key in meaningful_updates if key != "edited_at"]
            _record_event(current_user.hotel_id, entry_id, "edited", current_user.user_id, {"fields": changed_fields})
        if must_reset_acks:
            version = int(entry.get("acknowledgment_version") or current.get("acknowledgment_version", 1) + 1)
            if not targets:
                prior = supabase.table("logbook_entry_ack_targets").select("user_id").eq("tenant_id", current_user.hotel_id).eq("entry_id", entry_id).eq("version", version - 1).execute()
                targets = [str(row["user_id"]) for row in (prior.data or [])]
            _set_ack_targets(current_user.hotel_id, entry_id, version, targets, current_user.user_id, entry)
            _record_event(current_user.hotel_id, entry_id, "acknowledgment_reset", current_user.user_id, {"version": version})
    return {"data": _attach_author_profiles([entry])[0] if entry else None}


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_logbook_entry(
    entry_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    row = supabase.table("logbook_entries")\
        .select("author_id, tenant_id")\
        .eq("id", entry_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    if not row or not row.data:
        raise HTTPException(status_code=404, detail="Entry not found")

    if not can_permanently_delete_logbook_entry(current_user.role):
        raise HTTPException(status_code=403, detail="Only a general manager can permanently delete a handoff")

    _delete_logbook_evidence(current_user.hotel_id, entry_id)
    supabase.table("logbook_entries")\
        .delete()\
        .eq("id", entry_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()
    return None


@router.post("/entries/{entry_id}/resolve")
async def resolve_logbook_entry(
    entry_id: str,
    request: ResolveLogbookEntryRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    row = supabase.table("logbook_entries")\
        .select("author_id, tenant_id, status, resolved_at, resolved_by, resolution_note")\
        .eq("id", entry_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()
    if not row or not row.data:
        raise HTTPException(status_code=404, detail="Entry not found")

    current = row.data
    is_author = current["author_id"] == current_user.user_id
    is_privileged = current_user.role in PROGRAM_MANAGER_ROLES
    if not (is_author or is_privileged):
        raise HTTPException(status_code=403, detail="Not allowed to resolve this entry")

    if current["status"] == "resolved":
        name = _resolve_user_name(current.get("resolved_by"))
        return {"data": {**current, "id": entry_id, "resolved_by_name": name, "already_resolved": True}}

    if current["status"] != "follow_up":
        raise HTTPException(status_code=422, detail="Only follow-up handoffs can be resolved")

    now_iso = datetime.now(timezone.utc).isoformat()
    updates = {
        "status": "resolved",
        "resolved_at": now_iso,
        "resolved_by": current_user.user_id,
        "resolution_note": request.resolution_note,
        # logbook_entries_follow_up_data_check (migration 117) requires these
        # null once status leaves follow_up — same invariant the generic PATCH
        # handler already enforces via _normalize_structured_fields.
        "follow_up_at": None,
        "assigned_to": None,
    }
    result = supabase.table("logbook_entries")\
        .update(updates)\
        .eq("id", entry_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    entry = result.data[0] if result.data else None
    _record_event(current_user.hotel_id, entry_id, "resolved", current_user.user_id, {"has_note": bool(request.resolution_note)})
    return {"data": _attach_author_profiles([entry])[0] if entry else None}


@router.post("/entries/{entry_id}/archive")
async def archive_logbook_entry(
    entry_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    row = supabase.table("logbook_entries")\
        .select("author_id, tenant_id, archived_at")\
        .eq("id", entry_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()
    if not row or not row.data:
        raise HTTPException(status_code=404, detail="Entry not found")

    current = row.data
    is_author = current["author_id"] == current_user.user_id
    is_privileged = current_user.role in PROGRAM_MANAGER_ROLES
    if not (is_author or is_privileged):
        raise HTTPException(status_code=403, detail="Not allowed to archive this entry")

    if current.get("archived_at"):
        return {"data": {"id": entry_id, "archived_at": current["archived_at"], "already_archived": True}}

    now_iso = datetime.now(timezone.utc).isoformat()
    supabase.table("logbook_entries")\
        .update({"archived_at": now_iso, "archive_reason": "manual", "archived_by": current_user.user_id})\
        .eq("id", entry_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()
    _record_event(current_user.hotel_id, entry_id, "archived", current_user.user_id, {"reason": "manual"})
    return {"data": {"id": entry_id, "archived_at": now_iso, "archive_reason": "manual"}}


@router.post("/entries/{entry_id}/carry-forward")
async def carry_forward_logbook_entry(
    entry_id: str,
    request: CarryForwardLogbookEntryRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    row = supabase.table("logbook_entries")\
        .select("*")\
        .eq("id", entry_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()
    if not row or not row.data:
        raise HTTPException(status_code=404, detail="Entry not found")
    source = row.data

    is_author = source["author_id"] == current_user.user_id
    is_privileged = current_user.role in PROGRAM_MANAGER_ROLES
    if not (is_author or is_privileged):
        raise HTTPException(status_code=403, detail="Not allowed to carry this handoff forward")

    if source.get("archived_at"):
        raise HTTPException(status_code=422, detail="Archived handoffs cannot be carried forward")
    if source["status"] != "follow_up":
        raise HTTPException(status_code=422, detail="Only follow-up handoffs can be carried forward")
    if not source.get("shift_id"):
        raise HTTPException(status_code=422, detail="This handoff has no shift to carry forward from")

    existing_successor = supabase.table("logbook_entries")\
        .select("id")\
        .eq("carried_from_entry_id", entry_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()
    if existing_successor and existing_successor.data:
        raise HTTPException(status_code=409, detail="This handoff has already been carried forward")

    current_shift = _get_shift(current_user.hotel_id, source["shift_id"])
    if not current_shift:
        raise HTTPException(status_code=422, detail="Shift is no longer configured")
    next_shift = _resolve_next_shift(current_user.hotel_id, source["department_id"], source["shift_id"])
    if not next_shift:
        raise HTTPException(status_code=422, detail="No next shift is configured for this department")

    rolls_to_next_day = _time_to_minutes(next_shift["start_time"]) <= _time_to_minutes(current_shift["start_time"])
    source_date = date.fromisoformat(str(source["entry_date"]))
    destination_date = source_date + timedelta(days=1) if rolls_to_next_day else source_date

    assigned_to = str(request.assigned_to) if request.assigned_to else source.get("assigned_to")
    if assigned_to:
        _validate_assignee(current_user.hotel_id, assigned_to)

    now_iso = datetime.now(timezone.utc).isoformat()
    payload = {
        "tenant_id": current_user.hotel_id,
        "department_id": source["department_id"],
        "shift_id": next_shift["id"],
        "author_id": current_user.user_id,
        "content": source["content"],
        "entry_date": destination_date.isoformat(),
        "category": source["category"],
        "status": "follow_up",
        "priority": source["priority"],
        "follow_up_at": source.get("follow_up_at"),
        "assigned_to": assigned_to,
        "related_type": source.get("related_type"),
        "related_id": source.get("related_id"),
        "carried_from_entry_id": entry_id,
        "carried_forward_at": now_iso,
        "carried_forward_by": current_user.user_id,
    }

    try:
        result = supabase.table("logbook_entries").insert(payload).execute()
    except Exception as exc:
        if "idx_logbook_entries_carried_from_unique" in str(exc) or "duplicate key" in str(exc).lower():
            raise HTTPException(status_code=409, detail="This handoff has already been carried forward")
        raise

    new_entry = result.data[0] if result.data else None
    if new_entry:
        _record_event(current_user.hotel_id, new_entry["id"], "created", current_user.user_id)
        _record_event(current_user.hotel_id, entry_id, "carried_forward", current_user.user_id, {
            "destination_entry_id": new_entry["id"],
            "destination_shift_id": next_shift["id"],
        })

    return {"data": _attach_author_profiles([new_entry])[0] if new_entry else None}


@router.get("/entries/{entry_id}/continuity")
async def get_logbook_entry_continuity(
    entry_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    root = _fetch_entry_for_continuity(current_user.hotel_id, entry_id)
    if not root:
        raise HTTPException(status_code=404, detail="Entry not found")

    # Walk backward to the original entry, then forward to the newest successor.
    # Iterative with a depth cap and a seen-set — a corrupted self-reference must
    # not hang the API.
    chain_ids = [entry_id]
    seen = {entry_id}
    cursor = root
    depth = 0
    while cursor.get("carried_from_entry_id") and depth < _CONTINUITY_MAX_DEPTH:
        parent_id = cursor["carried_from_entry_id"]
        if parent_id in seen:
            break
        parent = _fetch_entry_for_continuity(current_user.hotel_id, parent_id)
        if not parent:
            break
        chain_ids.insert(0, parent_id)
        seen.add(parent_id)
        cursor = parent
        depth += 1

    cursor_id = entry_id
    depth = 0
    while depth < _CONTINUITY_MAX_DEPTH:
        successor = supabase.table("logbook_entries")\
            .select("id")\
            .eq("carried_from_entry_id", cursor_id)\
            .eq("tenant_id", current_user.hotel_id)\
            .maybe_single()\
            .execute()
        successor_id = successor.data["id"] if successor and successor.data else None
        if not successor_id or successor_id in seen:
            break
        chain_ids.append(successor_id)
        seen.add(successor_id)
        cursor_id = successor_id
        depth += 1

    if len(chain_ids) < 2:
        return {"data": []}

    result = supabase.table("logbook_entries")\
        .select("id, shift_id, entry_date, status, created_at, resolved_at, author_id, shifts(name)")\
        .in_("id", chain_ids)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()
    entries_by_id = {row["id"]: row for row in (result.data or [])}
    ordered = [entries_by_id[entry] for entry in chain_ids if entry in entries_by_id]
    hydrated = _attach_author_profiles(ordered)

    data = [{
        "id": entry["id"],
        "shift_id": entry.get("shift_id"),
        "shift_name": (entry.get("shifts") or {}).get("name") if entry.get("shifts") else None,
        "entry_date": entry.get("entry_date"),
        "created_at": entry.get("created_at"),
        "status": entry.get("status"),
        "resolved_at": entry.get("resolved_at"),
        "author": entry.get("user_profiles"),
    } for entry in hydrated]

    return {"data": data}


@router.get("/entries/{entry_id}/events")
async def get_logbook_entry_events(
    entry_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    entry = supabase.table("logbook_entries")\
        .select("id")\
        .eq("id", entry_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()
    if not entry or not entry.data:
        raise HTTPException(status_code=404, detail="Entry not found")

    result = supabase.table("logbook_entry_events")\
        .select("*")\
        .eq("entry_id", entry_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .order("created_at", desc=True)\
        .execute()
    events = result.data or []

    actor_ids = sorted({event["actor_id"] for event in events if event.get("actor_id")})
    profiles: dict = {}
    if actor_ids:
        profiles_result = supabase.table("user_profiles").select("id, preferred_name, full_name").in_("id", actor_ids).execute()
        profiles = {
            profile["id"]: (profile.get("preferred_name") or profile.get("full_name"))
            for profile in (profiles_result.data or [])
        }

    data = [{**event, "actor_name": profiles.get(event.get("actor_id"))} for event in events]
    return {"data": data}


@router.get("/shift-summary")
async def get_current_shift_summary(
    shift_date: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user)
):
    """Look up (without generating) the summary for whichever shift most recently
    ended, on the given date. Lets the UI show an already-generated summary
    (cron- or manually-triggered) without the caller knowing its shift_id."""
    resolved_date = shift_date or _hotel_today(current_user.hotel_id)

    shift = _resolve_current_shift(current_user.hotel_id)
    if not shift:
        raise HTTPException(status_code=404, detail="No shifts configured for this hotel")

    result = supabase.table("shift_summaries")\
        .select("*")\
        .eq("shift_id", shift["id"])\
        .eq("shift_date", resolved_date)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Shift summary not found")

    row = result.data
    name = _resolve_user_name(row.get("acknowledged_by"))
    return {"data": {**_summary_with_stats(row), "acknowledged_by_name": name}}


@router.get("/shift-summary/{shift_id}")
async def get_shift_summary(
    shift_id: str,
    shift_date: Optional[str] = Query(None, description="Required for deterministic selected-shift retrieval. Legacy callers retain hotel-local current-date behavior."),
    current_user: CurrentUser = Depends(get_current_user)
):
    resolved_date = shift_date or _hotel_today(current_user.hotel_id)
    result = supabase.table("shift_summaries")\
        .select("*")\
        .eq("shift_id", shift_id)\
        .eq("shift_date", resolved_date)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Shift summary not found")

    row = result.data
    name = _resolve_user_name(row.get("acknowledged_by"))
    return {"data": {**_summary_with_stats(row), "acknowledged_by_name": name}}


@router.post("/shift-summary/{summary_id}/acknowledge")
async def acknowledge_shift_summary(
    summary_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    result = supabase.table("shift_summaries")\
        .select("id, acknowledged_by, acknowledged_at")\
        .eq("id", summary_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Shift summary not found")

    row = result.data
    if row.get("acknowledged_at"):
        name = _resolve_user_name(row.get("acknowledged_by"))
        return {"data": {
            "id": summary_id,
            "acknowledged_by": row.get("acknowledged_by"),
            "acknowledged_at": row.get("acknowledged_at"),
            "acknowledged_by_name": name,
            "already_acknowledged": True,
        }}

    now_iso = datetime.now(timezone.utc).isoformat()
    supabase.table("shift_summaries")\
        .update({"acknowledged_by": current_user.user_id, "acknowledged_at": now_iso})\
        .eq("id", summary_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    name = _resolve_user_name(current_user.user_id)
    return {"data": {
        "id": summary_id,
        "acknowledged_by": current_user.user_id,
        "acknowledged_at": now_iso,
        "acknowledged_by_name": name,
    }}


@router.post("/shift-summary/generate")
async def generate_shift_summary_endpoint(
    request: GenerateShiftSummaryRequest,
    current_user: CurrentUser = Depends(require_role(*PROGRAM_MANAGER_ROLES))
):
    """Generate (idempotent — returns the existing summary without a new AI
    call) or, with `regenerate: true`, force a fresh AI call that replaces the
    existing summary row in place and clears any prior acknowledgment.

    The caller always supplies the exact shift being viewed — this endpoint
    never resolves a different "current" shift on the server's behalf."""
    shift_date = request.shift_date.isoformat()
    # The redesigned workspace always supplies this exact selected shift. Keep
    # date-only callers working by retaining the former most-recently-ended
    # fallback only when the identifier is absent.
    if request.shift_id is None:
        legacy_shift = _resolve_current_shift(current_user.hotel_id)
        if not legacy_shift:
            raise HTTPException(status_code=404, detail="No shifts configured for this hotel")
        shift_id = legacy_shift["id"]
    else:
        shift_id = str(request.shift_id)

    shift_result = supabase.table("shifts")\
        .select("id")\
        .eq("id", shift_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()
    if not shift_result or not shift_result.data:
        raise HTTPException(status_code=404, detail="Shift not found for this hotel")

    from services.ai.shift_summary import generate_or_get_shift_summary, regenerate_shift_summary

    if request.regenerate:
        result = await regenerate_shift_summary(
            current_user.hotel_id, shift_id, shift_date, user_id=current_user.user_id,
        )
    else:
        result = await generate_or_get_shift_summary(
            current_user.hotel_id, shift_id, shift_date, user_id=current_user.user_id,
        )
    return {"data": _summary_with_stats(result)}
