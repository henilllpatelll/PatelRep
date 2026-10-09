import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from dateutil import tz as dateutil_tz

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import (
    CleanSessionBlockerRequest,
    CompleteCleanSessionRequest,
    CreateCleanSessionRequest,
    UpdateCleanSessionRequest,
)
from core.database import supabase
from core.roles import MANAGER_ROLES
from routers.cleaning_checklists import get_checklist_template_for_clean_type
from services.housekeeping_assignments import effective_room_status
from services.room_status_transitions import (
    SESSION_STARTABLE_STATUSES,
    apply_status_transition,
    update_housekeeper_profile,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/clean-sessions", tags=["clean-sessions"])

SESSION_ROLES = ("housekeeper", "housekeeping_supervisor")
ALLOWED_PHOTO_TYPES = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
MAX_PHOTO_BYTES = 5 * 1024 * 1024
MAX_CLEAN_MINUTES = 240


def _checklist_counts(checklist: list[dict]) -> tuple[int, int]:
    done = sum(1 for item in checklist if item.get("checked"))
    return done, len(checklist)


def _serialize_checklist(items) -> list[dict]:
    return [item.model_dump(mode="json") for item in items]


def _get_session(session_id: str, hotel_id: str) -> dict:
    result = (
        supabase.table("room_clean_sessions")
        .select("*")
        .eq("id", session_id)
        .eq("tenant_id", hotel_id)
        .maybe_single()
        .execute()
    )
    session = (result.data if result else None) or None
    if not session:
        raise HTTPException(status_code=404, detail="Clean session not found")
    return session


def _require_session_owner(session: dict, current_user: CurrentUser) -> None:
    if session.get("housekeeper_id") == current_user.user_id:
        return
    if current_user.role in ("gm", "housekeeping_supervisor"):
        return
    raise HTTPException(status_code=403, detail="Not your clean session")


def _duration_seconds(started_at: str, ended_at: datetime) -> int:
    try:
        start_dt = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
        seconds = int((ended_at - start_dt).total_seconds())
    except (ValueError, TypeError):
        return 0
    return max(0, min(seconds, MAX_CLEAN_MINUTES * 60))


def _get_hotel_tz(hotel_id: str):
    # Best-effort lookup — a missing row/table or PostgREST hiccup must fall back to
    # the default tz rather than crash the caller (maybe_single() raises on 204).
    tz_name = "America/Chicago"
    try:
        result = (
            supabase.table("tenants")
            .select("timezone")
            .eq("id", hotel_id)
            .maybe_single()
            .execute()
        )
        tz_name = ((result.data if result else None) or {}).get("timezone") or tz_name
    except Exception:
        logger.warning("Failed to resolve hotel timezone for hotel_id=%s; using default", hotel_id)
    return dateutil_tz.gettz(tz_name) or dateutil_tz.gettz("America/Chicago")


def _get_signed_url(path: str) -> str:
    try:
        res = supabase.storage.from_("clean-photos").create_signed_url(path, 3600)
        return (res or {}).get("signedURL") or ""
    except Exception:
        logger.warning("Failed to create signed URL for path=%s", path)
        return ""



MAX_CLOCK_SKEW_SECONDS = 120
ASSIGNMENT_LOOKBACK_DAYS = 1


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _clamp_client_time(value: datetime, now: datetime) -> datetime:
    """Client clocks drift and queued offline writes replay late.

    A queued timestamp in the past is a legitimate offline capture, but a time
    in the future is never valid — the server clock wins in that case.
    """
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    if value > now + timedelta(seconds=MAX_CLOCK_SKEW_SECONDS):
        return now
    return value


def _conflict(code: str, message: str, status_code: int = 409, **extra) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message, **extra})


def _item_key(item: dict) -> str:
    item_id = item.get("item_id")
    if item_id:
        return f"id:{item_id}"
    return f"label:{item.get('section') or 'General'}|{item.get('label')}"


def _merge_checklist(stored: list[dict], incoming, now: datetime) -> list[dict]:
    """Apply checked-state changes onto the server-side snapshot.

    The snapshot taken at session start is authoritative for labels, sections,
    ordering and required flags. A client can only flip `checked` on items that
    exist in the snapshot — it can neither add items nor downgrade a required
    item to optional.
    """
    merged = [dict(item) for item in stored]
    by_key = {_item_key(item): item for item in merged}
    for entry in incoming:
        data = entry.model_dump(mode="json") if hasattr(entry, "model_dump") else dict(entry)
        target = by_key.get(_item_key(data))
        if target is None:
            raise _conflict(
                "CHECKLIST_ITEM_UNKNOWN",
                "Checklist item is not part of this clean session",
                status_code=422,
            )
        checked = bool(data.get("checked"))
        if checked and not target.get("checked"):
            raw = entry.checked_at if hasattr(entry, "checked_at") else data.get("checked_at")
            stamp = _clamp_client_time(raw, now) if isinstance(raw, datetime) else now
            target["checked_at"] = stamp.isoformat()
        elif not checked:
            target["checked_at"] = None
        target["checked"] = checked
    return merged


def _missing_required(checklist: list[dict]) -> list[dict]:
    return [item for item in checklist if item.get("is_required") and not item.get("checked")]


def _hotel_today(hotel_id: str) -> date:
    return datetime.now(_get_hotel_tz(hotel_id)).date()


def _resolve_assignment(hotel_id: str, room_id: str, room_status: dict, current_user: CurrentUser) -> dict:
    """Return the caller's current assignment for the room or raise 403.

    A housekeeper may only start rooms assigned to them. The most recent
    assignment row for the room wins, so a reassignment between opening the
    room screen and tapping Start is rejected instead of silently honoured.
    Supervisors may start any room (they can cover for staff).
    """
    floor = (_hotel_today(hotel_id) - timedelta(days=ASSIGNMENT_LOOKBACK_DAYS)).isoformat()
    rows = (
        supabase.table("room_assignments")
        .select("id, clean_type, assigned_to, assignment_date")
        .eq("tenant_id", hotel_id)
        .eq("room_id", room_id)
        .gte("assignment_date", floor)
        .execute()
    ).data or []
    if rows:
        latest = max(str(row.get("assignment_date") or "") for row in rows)
        current = [row for row in rows if str(row.get("assignment_date") or "") == latest]
        mine = next((row for row in current if row.get("assigned_to") == current_user.user_id), None)
        if mine:
            return mine
        if current_user.role in MANAGER_ROLES:
            return {}
        raise _conflict("ROOM_NOT_ASSIGNED", "This room is assigned to someone else", status_code=403)
    if room_status.get("assigned_to") == current_user.user_id:
        return {}
    if current_user.role in MANAGER_ROLES:
        return {}
    raise _conflict("ROOM_NOT_ASSIGNED", "This room is not assigned to you", status_code=403)


def _guest_may_be_inside(room_status: dict, effective_status: str | None) -> bool:
    """Server mirror of the mobile knock-protocol rule (roomWorkflow.ts)."""
    if room_status.get("actual_checkout_at"):
        return False
    if effective_status in ("PICKUP", "OCCUPIED"):
        return True
    return room_status.get("fo_status") == "OCC"


def _enforce_entry_safety(room_status: dict, effective_status: str | None, acknowledged: bool) -> None:
    if room_status.get("dnd_flag"):
        raise _conflict("DND_ACTIVE", "Do Not Disturb is active — do not enter until front desk clears it")
    if room_status.get("do_not_service") and effective_status == "PICKUP":
        raise _conflict("SERVICE_DECLINED", "The guest declined service for this room")
    if _guest_may_be_inside(room_status, effective_status) and not acknowledged:
        raise _conflict(
            "ENTRY_PROTOCOL_REQUIRED",
            "Knock and announce before entering — confirm the entry protocol to start",
        )


def _release_stale_sessions(hotel_id: str, room_id: str, user_id: str, now: datetime) -> None:
    """Enforce one active room per attendant, without letting a dead session block them.

    A session whose room is no longer IN_PROGRESS (supervisor reset, legacy
    undo, another flow) can never be completed, so it is closed as abandoned.
    A session on a room that is still IN_PROGRESS is a real conflict.
    """
    others = (
        supabase.table("room_clean_sessions")
        .select("id, room_id")
        .eq("tenant_id", hotel_id)
        .eq("housekeeper_id", user_id)
        .eq("status", "active")
        .execute()
    ).data or []
    for other in others:
        if other.get("room_id") == room_id:
            continue
        status_row = (
            supabase.table("room_status")
            .select("status")
            .eq("room_id", other["room_id"])
            .eq("tenant_id", hotel_id)
            .maybe_single()
            .execute()
        )
        if ((status_row.data if status_row else None) or {}).get("status") == "IN_PROGRESS":
            raise _conflict(
                "ACTIVE_SESSION_EXISTS",
                "Finish your current room before starting another",
                active_session_id=other["id"],
                active_room_id=other["room_id"],
            )
        supabase.table("room_clean_sessions").update({
            "status": "abandoned",
            "ended_at": now.isoformat(),
            "notes": "Superseded: room was no longer in progress",
        }).eq("id", other["id"]).eq("tenant_id", hotel_id).execute()


# ---------------------------------------------------------------------------
# POST /clean-sessions  (idempotent — id is client-generated)
# ---------------------------------------------------------------------------

@router.post("")
async def start_clean_session(
    request: CreateCleanSessionRequest,
    current_user: CurrentUser = Depends(require_role(*SESSION_ROLES)),
):
    session_id = str(request.id)
    room_id = str(request.room_id)
    now = _now()

    # Idempotent replay: offline queue may retry the same start
    existing = (
        supabase.table("room_clean_sessions")
        .select("*")
        .eq("id", session_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if existing and existing.data:
        _require_session_owner(existing.data, current_user)
        return {"data": existing.data}

    # Conflict guard: another housekeeper already cleaning this room?
    active = (
        supabase.table("room_clean_sessions")
        .select("id, housekeeper_id")
        .eq("tenant_id", current_user.hotel_id)
        .eq("room_id", room_id)
        .eq("status", "active")
        .execute()
    )
    for row in (active.data or []):
        if row.get("housekeeper_id") != current_user.user_id:
            raise _conflict(
                "ROOM_IN_USE",
                "Another housekeeper already has an active session on this room",
            )
        return {"data": _get_session(row["id"], current_user.hotel_id)}

    # Room status + tenant check
    status_row = (
        supabase.table("room_status")
        .select("*")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    room_status = (status_row.data if status_row else None) or None
    if not room_status:
        raise HTTPException(status_code=404, detail="Room not found")

    previous_status = room_status.get("status")
    if previous_status == "IN_PROGRESS":
        # Legacy start already flipped the status; allow the session to attach.
        previous_status_for_revert = "DIRTY"
    elif previous_status in SESSION_STARTABLE_STATUSES:
        previous_status_for_revert = previous_status
    else:
        raise _conflict(
            "ROOM_NOT_STARTABLE",
            f"Cannot start a clean from status {previous_status}",
            status_code=400,
        )

    # Ownership: a housekeeper may only clean rooms assigned to them
    assignment = _resolve_assignment(current_user.hotel_id, room_id, room_status, current_user)
    clean_type = assignment.get("clean_type") or room_status.get("clean_type")

    # Before-entry safety is enforced here, not only in the app UI. A room that
    # a legacy start already moved to IN_PROGRESS has been entered, so skip it.
    if previous_status != "IN_PROGRESS":
        effective = effective_room_status(previous_status, clean_type, room_status.get("fo_status"))
        _enforce_entry_safety(room_status, effective, request.entry_acknowledged)

    _release_stale_sessions(current_user.hotel_id, room_id, current_user.user_id, now)

    # Snapshot the checklist template and base clean minutes
    template = get_checklist_template_for_clean_type(current_user.hotel_id, clean_type)
    checklist = [
        {
            "item_id": item.get("id"),
            "section": item.get("section") or "General",
            "label": item.get("label"),
            "is_required": bool(item.get("is_required")),
            "checked": False,
            "checked_at": None,
        }
        for item in ((template or {}).get("items") or [])
    ]

    room_row = (
        supabase.table("rooms")
        .select("room_type_id, room_types(base_clean_minutes)")
        .eq("id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    room_data = (room_row.data if room_row else None) or {}
    base_clean_minutes = (room_data.get("room_types") or {}).get("base_clean_minutes")

    done, total = _checklist_counts(checklist)
    insert_payload = {
        "id": session_id,
        "tenant_id": current_user.hotel_id,
        "room_id": room_id,
        "assignment_id": assignment.get("id"),
        "housekeeper_id": current_user.user_id,
        "clean_type": clean_type,
        "previous_status": previous_status_for_revert,
        "base_clean_minutes": base_clean_minutes,
        "started_at": _clamp_client_time(request.started_at, now).isoformat(),
        "status": "active",
        "checklist": checklist,
        "checklist_done": done,
        "checklist_total": total,
    }
    result = supabase.table("room_clean_sessions").insert(insert_payload).execute()
    session = (result.data or [insert_payload])[0]

    # Flip the room to IN_PROGRESS through the shared validated transition
    if previous_status != "IN_PROGRESS":
        apply_status_transition(
            room_id=room_id,
            hotel_id=current_user.hotel_id,
            user_id=current_user.user_id,
            role=current_user.role,
            to_status="IN_PROGRESS",
            current_row=room_status,
        )

    return {"data": session}


# ---------------------------------------------------------------------------
# GET /clean-sessions?room_id=
# ---------------------------------------------------------------------------

@router.get("")
async def list_clean_sessions(
    room_id: str = Query(...),
    limit: int = Query(20, ge=1, le=50),
    current_user: CurrentUser = Depends(get_current_user),
):
    result = (
        supabase.table("room_clean_sessions")
        .select("id, room_id, housekeeper_id, clean_type, duration_seconds, started_at, ended_at, status, checklist_done, checklist_total, notes")
        .eq("tenant_id", current_user.hotel_id)
        .eq("room_id", room_id)
        .order("started_at", desc=True)
        .limit(limit)
        .execute()
    )
    return {"data": result.data or []}


# ---------------------------------------------------------------------------
# GET /clean-sessions/active
# ---------------------------------------------------------------------------

@router.get("/active")
async def get_active_session(
    current_user: CurrentUser = Depends(require_role(*SESSION_ROLES)),
):
    result = (
        supabase.table("room_clean_sessions")
        .select("*")
        .eq("tenant_id", current_user.hotel_id)
        .eq("housekeeper_id", current_user.user_id)
        .eq("status", "active")
        .order("started_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    return {"data": rows[0] if rows else None}


# ---------------------------------------------------------------------------
# GET /clean-sessions/summary?date=
# ---------------------------------------------------------------------------

@router.get("/summary")
async def get_sessions_summary(
    target_date: Optional[date] = Query(None, alias="date"),
    current_user: CurrentUser = Depends(require_role(*SESSION_ROLES)),
):
    hotel_tz = _get_hotel_tz(current_user.hotel_id)
    if target_date:
        local_midnight = datetime(target_date.year, target_date.month, target_date.day, tzinfo=hotel_tz)
    else:
        local_midnight = datetime.now(hotel_tz).replace(hour=0, minute=0, second=0, microsecond=0)
    utc_start = local_midnight.astimezone(timezone.utc)
    utc_end = (local_midnight + timedelta(days=1)).astimezone(timezone.utc)
    result = (
        supabase.table("room_clean_sessions")
        .select("duration_seconds, base_clean_minutes, status, started_at")
        .eq("tenant_id", current_user.hotel_id)
        .eq("housekeeper_id", current_user.user_id)
        .eq("status", "completed")
        .gte("started_at", utc_start.isoformat())
        .lt("started_at", utc_end.isoformat())
        .execute()
    )
    completed = result.data or []
    total_actual_seconds = sum(int(row.get("duration_seconds") or 0) for row in completed)
    total_base_minutes = sum(int(row.get("base_clean_minutes") or 0) for row in completed)
    return {
        "data": {
            "completed_count": len(completed),
            "total_actual_minutes": round(total_actual_seconds / 60, 1),
            "total_base_minutes": total_base_minutes,
        }
    }


# ---------------------------------------------------------------------------
# GET /clean-sessions/hotel-avg-clean-time
# ---------------------------------------------------------------------------
# Hotel-wide average clean time for the dashboard hero. Unlike /summary (scoped
# to the calling housekeeper), this aggregates every completed session across the
# property so a GM/front-desk view gets one headline number plus a 7-day trend.

# Everyone who sees the Simplified Dashboard board can read this headline metric.
_AVG_CLEAN_TIME_ROLES = (
    "housekeeper",
    "housekeeping_supervisor",
    "front_desk",
    "engineer",
    "chief_engineer",
    "gm",
)


@router.get("/hotel-avg-clean-time")
async def get_hotel_avg_clean_time(
    current_user: CurrentUser = Depends(require_role(*_AVG_CLEAN_TIME_ROLES)),
):
    hotel_tz = _get_hotel_tz(current_user.hotel_id)
    today_midnight = datetime.now(hotel_tz).replace(hour=0, minute=0, second=0, microsecond=0)
    today_start = today_midnight.astimezone(timezone.utc)
    tomorrow_start = (today_midnight + timedelta(days=1)).astimezone(timezone.utc)
    # Trailing 7 days *before* today, so the comparison excludes the in-progress day.
    week_start = (today_midnight - timedelta(days=7)).astimezone(timezone.utc)

    result = (
        supabase.table("room_clean_sessions")
        .select("duration_seconds, started_at")
        .eq("tenant_id", current_user.hotel_id)
        .eq("status", "completed")
        .gte("started_at", week_start.isoformat())
        .lt("started_at", tomorrow_start.isoformat())
        .execute()
    )

    today_minutes: list[float] = []
    prior_minutes: list[float] = []
    for row in result.data or []:
        duration = row.get("duration_seconds")
        started = row.get("started_at")
        if not duration or not started:
            continue
        try:
            started_dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            continue
        minutes = duration / 60
        if started_dt >= today_start:
            today_minutes.append(minutes)
        else:
            prior_minutes.append(minutes)

    def _avg(values: list[float]) -> Optional[int]:
        return round(sum(values) / len(values)) if values else None

    today_avg = _avg(today_minutes)
    seven_day_avg = _avg(prior_minutes)
    delta = (
        today_avg - seven_day_avg
        if today_avg is not None and seven_day_avg is not None
        else None
    )
    return {
        "data": {
            "today_avg_minutes": today_avg,
            "seven_day_avg_minutes": seven_day_avg,
            "delta_minutes": delta,
            "today_count": len(today_minutes),
        }
    }


# ---------------------------------------------------------------------------
# GET /clean-sessions/{session_id}
# ---------------------------------------------------------------------------

@router.get("/{session_id}")
async def get_clean_session(
    session_id: str,
    current_user: CurrentUser = Depends(require_role(*SESSION_ROLES, "gm")),
):
    session = _get_session(session_id, current_user.hotel_id)
    _require_session_owner(session, current_user)
    photos_result = (
        supabase.table("room_clean_photos")
        .select("id, kind, url, storage_path, created_at")
        .eq("session_id", session_id)
        .eq("tenant_id", current_user.hotel_id)
        .order("created_at")
        .execute()
    )
    photos = []
    for photo in (photos_result.data or []):
        if photo.get("storage_path"):
            photo = {**photo, "url": _get_signed_url(photo["storage_path"])}
        photos.append(photo)
    return {"data": {**session, "photos": photos}}


# ---------------------------------------------------------------------------
# PATCH /clean-sessions/{session_id}  (checklist/notes sync — last write wins)
# ---------------------------------------------------------------------------

@router.patch("/{session_id}")
async def update_clean_session(
    session_id: str,
    request: UpdateCleanSessionRequest,
    current_user: CurrentUser = Depends(require_role(*SESSION_ROLES)),
):
    session = _get_session(session_id, current_user.hotel_id)
    _require_session_owner(session, current_user)
    if session.get("status") != "active":
        raise _conflict(
            "SESSION_NOT_ACTIVE",
            f"Clean session is {session.get('status')}; it can no longer be edited",
            session_status=session.get("status"),
        )

    update_payload: dict = {}
    if request.checklist is not None:
        checklist = _merge_checklist(session.get("checklist") or [], request.checklist, _now())
        done, total = _checklist_counts(checklist)
        update_payload.update({
            "checklist": checklist,
            "checklist_done": done,
            "checklist_total": total,
        })
    if request.notes is not None:
        update_payload["notes"] = request.notes

    if not update_payload:
        return {"data": session}

    result = (
        supabase.table("room_clean_sessions")
        .update(update_payload)
        .eq("id", session_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )
    rows = result.data or []
    return {"data": rows[0] if rows else {**session, **update_payload}}


# ---------------------------------------------------------------------------
# POST /clean-sessions/{session_id}/complete  (idempotent)
# ---------------------------------------------------------------------------

@router.post("/{session_id}/complete")
async def complete_clean_session(
    session_id: str,
    request: CompleteCleanSessionRequest,
    current_user: CurrentUser = Depends(require_role(*SESSION_ROLES)),
):
    session = _get_session(session_id, current_user.hotel_id)
    _require_session_owner(session, current_user)

    if session.get("status") == "completed":
        return {"data": session}  # idempotent replay
    if session.get("status") == "abandoned":
        raise _conflict("SESSION_ABANDONED", "Session was abandoned")

    now = _now()

    # 1. Validate against the server-side snapshot before mutating anything, so
    #    a rejected completion leaves the session and the room untouched.
    checklist = session.get("checklist") or []
    if request.checklist is not None:
        checklist = _merge_checklist(checklist, request.checklist, now)
    missing = _missing_required(checklist)
    if missing:
        labels = [str(item.get("label")) for item in missing]
        raise _conflict(
            "REQUIRED_ITEMS_INCOMPLETE",
            f"{len(missing)} required checklist item(s) unfinished: " + "; ".join(labels[:5]),
            status_code=422,
            missing=labels,
            missing_item_ids=[item.get("item_id") for item in missing],
        )

    # 2. Move the room first. If the room changed under us (supervisor reset,
    #    OOO, ...) the completion is rejected with the session still active; if
    #    the session write below fails, a retry finds the room already CLEAN and
    #    simply finishes the session.
    room_id = session["room_id"]
    status_row = (
        supabase.table("room_status")
        .select("*")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    room_status = (status_row.data if status_row else None) or {}
    room_state = room_status.get("status")
    if room_state == "IN_PROGRESS":
        apply_status_transition(
            room_id=room_id,
            hotel_id=current_user.hotel_id,
            user_id=current_user.user_id,
            role=current_user.role,
            to_status="CLEAN",
            current_row=room_status,
        )
    elif room_state != "CLEAN":
        raise _conflict(
            "ROOM_STATE_CHANGED",
            f"Room is {room_state}, not in progress — cleaning cannot be completed",
            room_status=room_state,
        )

    # 3. Server-backed timing: never trust a future client clock, never end
    #    before the session started.
    ended_at = _clamp_client_time(request.ended_at, now)
    try:
        started = datetime.fromisoformat(str(session.get("started_at")).replace("Z", "+00:00"))
        if ended_at < started:
            ended_at = started
    except (ValueError, TypeError):
        pass
    duration = _duration_seconds(session.get("started_at"), ended_at)

    done, total = _checklist_counts(checklist)
    update_payload: dict = {
        "status": "completed",
        "ended_at": ended_at.isoformat(),
        "duration_seconds": duration,
        "checklist": checklist,
        "checklist_done": done,
        "checklist_total": total,
    }
    if request.notes is not None:
        update_payload["notes"] = request.notes

    result = (
        supabase.table("room_clean_sessions")
        .update(update_payload)
        .eq("id", session_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )
    rows = result.data or []
    updated = rows[0] if rows else {**session, **update_payload}

    # Rolling average uses the TRUE session duration
    try:
        update_housekeeper_profile(
            hotel_id=current_user.hotel_id,
            room_id=room_id,
            user_id=session.get("housekeeper_id"),
            elapsed_minutes=duration / 60 if duration else None,
        )
    except Exception:
        logger.warning(
            "Failed to update housekeeper profile from session=%s", session_id,
            exc_info=True,
        )

    actual_minutes = round(duration / 60, 1) if duration else 0
    return {
        "data": {
            **updated,
            "actual_minutes": actual_minutes,
            "base_minutes": session.get("base_clean_minutes"),
        }
    }


# ---------------------------------------------------------------------------
# POST /clean-sessions/{session_id}/blocker  (abandon + revert room status)
# ---------------------------------------------------------------------------

@router.post("/{session_id}/blocker")
async def report_session_blocker(
    session_id: str,
    request: CleanSessionBlockerRequest,
    current_user: CurrentUser = Depends(require_role(*SESSION_ROLES)),
):
    session = _get_session(session_id, current_user.hotel_id)
    _require_session_owner(session, current_user)

    if session.get("status") != "active":
        return {"data": session}  # already resolved; idempotent

    note = request.note or f"Blocked: {request.reason}"
    result = (
        supabase.table("room_clean_sessions")
        .update({
            "status": "abandoned",
            "blocked_reason": request.reason,
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "notes": note,
        })
        .eq("id", session_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )

    # Revert the room to its pre-session status with a history entry
    room_id = session["room_id"]
    previous_status = session.get("previous_status") or "DIRTY"
    now_iso = datetime.now(timezone.utc).isoformat()
    status_update: dict = {
        "status": previous_status,
        "notes": note,
        "updated_at": now_iso,
    }
    if request.reason == "dnd":
        prior_dnd = (
            supabase.table("room_status").select("dnd_flag, dnd_attempt_count")
            .eq("room_id", room_id).eq("tenant_id", current_user.hotel_id)
            .maybe_single().execute()
        )
        was_dnd = bool(prior_dnd and prior_dnd.data and prior_dnd.data.get("dnd_flag"))
        status_update["dnd_flag"] = True
        if not was_dnd:
            status_update["dnd_started_at"] = now_iso
        status_update["dnd_attempt_count"] = ((prior_dnd.data or {}).get("dnd_attempt_count") or 0) + 1 if prior_dnd and prior_dnd.data else 1
        status_update["dnd_last_attempt_at"] = now_iso
        # Phase 8: keep the structured attempt log in sync with this mobile
        # entry point (POST /clean-sessions/{id}/blocker) so Room Detail's
        # attempt history is complete regardless of where DND was reported.
        supabase.table("room_service_attempts").insert({
            "tenant_id": current_user.hotel_id,
            "room_id": room_id,
            "result": "dnd_no_response",
            "attempted_at": now_iso,
            "note": note,
            "recorded_by": current_user.user_id,
        }).execute()
    supabase.table("room_status").update(status_update)\
        .eq("room_id", room_id).eq("tenant_id", current_user.hotel_id).execute()
    supabase.table("room_status_history").insert({
        "room_id": room_id,
        "tenant_id": current_user.hotel_id,
        "from_status": "IN_PROGRESS",
        "to_status": previous_status,
        "changed_by": current_user.user_id,
        "change_source": "app",
        "notes": note,
    }).execute()

    rows = result.data or []
    return {"data": rows[0] if rows else session}


# ---------------------------------------------------------------------------
# POST /clean-sessions/{session_id}/photos  (multipart upload)
# ---------------------------------------------------------------------------

@router.post("/{session_id}/photos")
async def upload_session_photo(
    session_id: str,
    file: UploadFile = File(...),
    kind: str = Form("proof"),
    current_user: CurrentUser = Depends(require_role(*SESSION_ROLES)),
):
    session = _get_session(session_id, current_user.hotel_id)
    _require_session_owner(session, current_user)

    if kind not in ("proof", "issue"):
        raise HTTPException(status_code=400, detail="kind must be 'proof' or 'issue'")
    if file.content_type not in ALLOWED_PHOTO_TYPES:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, or WebP images are allowed")

    contents = await file.read(MAX_PHOTO_BYTES + 1)
    if len(contents) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Photo must be 5 MB or smaller")

    ext = ALLOWED_PHOTO_TYPES[file.content_type]
    ts = int(datetime.now(timezone.utc).timestamp() * 1000)
    path = f"{current_user.hotel_id}/{session_id}/{ts}.{ext}"
    try:
        supabase.storage.from_("clean-photos").upload(
            path, contents, {"content-type": file.content_type, "upsert": "false"}
        )
    except Exception:
        logger.warning("Clean photo upload failed for session=%s", session_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Photo upload failed")

    signed_url = _get_signed_url(path)
    insert = supabase.table("room_clean_photos").insert({
        "tenant_id": current_user.hotel_id,
        "session_id": session_id,
        "room_id": session["room_id"],
        "kind": kind,
        "storage_path": path,
        "url": signed_url,
        "created_by": current_user.user_id,
    }).execute()
    photo = (insert.data or [{}])[0]
    return {"data": {"id": photo.get("id"), "url": signed_url, "kind": kind}}
